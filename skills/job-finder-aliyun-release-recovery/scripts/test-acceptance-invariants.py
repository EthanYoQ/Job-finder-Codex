"""Offline synthetic examples, not production reader or deployment verification."""
import copy
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import tempfile
import unittest


def utc(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value):
        raise ValueError('invalid UTC time')
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def expected_global(old, certificate):
    return max((old, certificate), key=utc)


def observation_time(row, observation, quality_valid=True):
    if not quality_valid or len(observation) != 1:
        raise ValueError('quality or observation count')
    obs = observation[0]
    for key in ('source', 'result', 'batch', 'candidate', 'config', 'adapter', 'output'):
        if obs[key] != row[key]:
            raise ValueError('identity drift')
    if any(obs[key] is not True for key in ('success', 'transport', 'adapterOk', 'complete', 'committed')):
        raise ValueError('failed observation')
    if obs['from'] != row['start'] or obs['to'] != row['finish']:
        raise ValueError('range drift')
    if not utc(row['start']) <= utc(obs['crawl']) <= utc(row['finish']):
        raise ValueError('crawl outside interval')
    return obs['crawl']


def projection(old, target, certificate):
    expected = copy.deepcopy(old)
    expected['companies'].append(copy.deepcopy(target))
    expected['lastUpdatedAt'] = expected_global(old['lastUpdatedAt'], certificate)
    return expected


def check_delta(row, observations, delta_observed_at):
    if delta_observed_at != observation_time(row, observations):
        raise ValueError('delta observation drift')


def check_projection(old, target, certificate, candidate):
    if candidate != projection(old, target, certificate):
        raise ValueError('projection drift')


def publish_report(directory, value):
    """Complete report before final name becomes visible; never replace a receipt."""
    raw = (json.dumps(value, allow_nan=False) + '\n').encode()
    fd, temporary = tempfile.mkstemp(prefix='.report-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, directory / 'report.json', follow_symlinks=False)
        parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        os.unlink(temporary)


def finish(directory, exit_code, matched, saver=publish_report):
    result = {'status': 'PASS' if exit_code == 0 and matched else 'MISMATCH', 'exitCode': exit_code}
    saver(directory, result)
    if result['status'] != 'PASS':
        raise RuntimeError('acceptance failed')
    return result


class Invariants(unittest.TestCase):
    def setUp(self):
        self.row = dict(source='synthetic-source', result='synthetic-result', batch='synthetic-batch',
                        candidate='synthetic-candidate', config='synthetic-config', adapter='synthetic-adapter',
                        output='synthetic-output', start='2000-01-01T00:00:00Z', finish='2000-01-01T00:01:00Z')
        self.obs = {**{k: self.row[k] for k in ('source', 'result', 'batch', 'candidate', 'config', 'adapter', 'output')},
                    'from': self.row['start'], 'to': self.row['finish'], 'crawl': '2000-01-01T00:00:20Z',
                    **{k: True for k in ('success', 'transport', 'adapterOk', 'complete', 'committed')}}
        self.cert = '2000-01-01T00:00:30Z'

    def test_different_event_times_preserved(self):
        before = copy.deepcopy((self.row, self.obs))
        self.assertNotEqual(observation_time(self.row, [self.obs]), self.cert)
        self.assertEqual(before, (self.row, self.obs))

    def test_exact_interval_boundaries(self):
        for value in (self.row['start'], self.row['finish']):
            self.assertEqual(observation_time(self.row, [{**self.obs, 'crawl': value}]), value)

    def test_each_identity_rejected(self):
        for key in ('source', 'result', 'batch', 'candidate', 'config', 'adapter', 'output'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                observation_time(self.row, [{**self.obs, key: 'other'}])

    def test_each_failure_rejected(self):
        for key in ('success', 'transport', 'adapterOk', 'complete', 'committed'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                observation_time(self.row, [{**self.obs, key: False}])

    def test_observation_count_and_quality(self):
        for rows in ([], [self.obs, self.obs]):
            with self.assertRaises(ValueError):
                observation_time(self.row, rows)
        with self.assertRaises(ValueError):
            observation_time(self.row, [self.obs], quality_valid=False)

    def test_range_and_invalid_times(self):
        for key, value in (('from', '1999-01-01T00:00:00Z'), ('to', self.row['start']),
                           ('crawl', '1999-12-31T23:59:59Z'), ('crawl', '2000-01-01T00:01:01Z'),
                           ('crawl', 'not-a-date'), ('crawl', '2000-02-30T00:00:00Z')):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                observation_time(self.row, [{**self.obs, key: value}])

    def test_wrapper_cannot_substitute_certificate_time(self):
        check_delta(self.row, [self.obs], self.obs['crawl'])
        with self.assertRaises(ValueError):
            check_delta(self.row, [self.obs], self.cert)

    def test_max_older_newer_equal_and_precision(self):
        self.assertEqual(expected_global(self.cert, self.row['start']), self.cert)
        self.assertEqual(expected_global(self.row['start'], self.cert), self.cert)
        self.assertEqual(expected_global(self.cert, self.cert), self.cert)
        self.assertEqual(expected_global('2000-01-01T00:00:00Z', '2000-01-01T00:00:00.1Z'), '2000-01-01T00:00:00.1Z')
        self.assertEqual(expected_global('2000-01-01T00:00:00Z', '2000-01-01T00:00:00.000Z'), '2000-01-01T00:00:00Z')

    def test_max_rejects_invalid_or_missing(self):
        for value in (None, '', '2000-02-30T00:00:00Z', '2000-01-01', math.nan):
            with self.assertRaises(ValueError):
                expected_global(self.cert, value)

    def test_only_expected_projection_changes(self):
        old = {'companies': [{'id': 'existing', 'originalTime': self.row['start'], 'unknownField': 7}], 'lastUpdatedAt': self.row['start']}
        new = projection(old, {'id': 'recovered', 'jobs': ['synthetic-job']}, self.cert)
        target = copy.deepcopy(new['companies'][1])
        check_projection(old, target, self.cert, new)
        for mutate in (lambda x: x['companies'][0].update(unknownField=8),
                       lambda x: x.update(lastUpdatedAt=self.row['finish']),
                       lambda x: x['companies'][1].update(jobs=[]),
                       lambda x: x['companies'][0].pop('originalTime')):
            changed = copy.deepcopy(new)
            mutate(changed)
            with self.assertRaises(ValueError):
                check_projection(old, target, self.cert, changed)
        self.assertEqual(old['lastUpdatedAt'], self.row['start'])

    def test_failure_saved_before_raise(self):
        with tempfile.TemporaryDirectory() as path:
            directory = Path(path)
            with self.assertRaises(RuntimeError):
                finish(directory, 2, True)
            self.assertEqual(json.loads((directory / 'report.json').read_text()), {'status': 'MISMATCH', 'exitCode': 2})

    def test_mismatch_even_with_zero_exit(self):
        with tempfile.TemporaryDirectory() as path:
            with self.assertRaises(RuntimeError):
                finish(Path(path), 0, False)
            self.assertEqual(json.loads((Path(path) / 'report.json').read_text())['status'], 'MISMATCH')

    def test_pass_saved(self):
        with tempfile.TemporaryDirectory() as path:
            self.assertEqual(finish(Path(path), 0, True)['status'], 'PASS')
            self.assertEqual((Path(path) / 'report.json').stat().st_mode & 0o777, 0o600)

    def test_no_overwrite_or_symlink_follow(self):
        for symlink in (False, True):
            with tempfile.TemporaryDirectory() as path:
                directory = Path(path)
                retained = directory / 'original'
                retained.write_text('keep')
                destination = directory / 'report.json'
                if symlink:
                    destination.symlink_to(retained)
                else:
                    destination.write_text('keep')
                with self.assertRaises(FileExistsError):
                    finish(directory, 0, True)
                self.assertEqual(destination.read_text(), 'keep')
                self.assertEqual(retained.read_text(), 'keep')
                self.assertFalse(list(directory.glob('.report-*')))

    def test_save_failure_cannot_return_pass(self):
        def denied(*_):
            raise OSError('synthetic storage failure')
        with self.assertRaises(OSError):
            finish(Path('/unused-synthetic'), 0, True, saver=denied)


if __name__ == '__main__':
    unittest.main(verbosity=2)
