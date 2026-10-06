"""Synthetic replay-tool regression tests. No Node, network, engine or DB execution."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main
import copy
import gzip
import hashlib
import importlib.util
import json
import subprocess
import sys

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE))


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), SOURCE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CURRENT = load('run-current-sanofi-comparison')
ENGINES = load('prepare-prisma-engines')
RUNNERS = [(CURRENT, 'CURRENT_SANOFI_EXECUTION_RESULTS.json', 3),
           (load('run-server-verification'), 'execution-results.json', 6),
           (load('generate-prisma-client'), 'prisma-generation-results.json', 2),
           (load('probe-prisma-client'), 'prisma-client-runtime-probes.json', 2)]


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def setup(root):
    for candidate in ['a775', 'main', 'fallback']:
        schema = root / candidate / 'prisma/schema.prisma'
        schema.parent.mkdir(parents=True)
        schema.write_text('// Synthetic schema placeholder; never executed\n')
    accepted = '2026-01-01T01:02:03.000Z'
    observed = '2026-01-01T01:00:00.000Z'
    captured = '2026-01-02T00:00:00.123456+00:00'
    jobs = [{'id': f'synthetic-job-{i}', 'title': f'Synthetic role {i}',
             'sourceResultId': 'synthetic-result', 'lastSeenAt': accepted} for i in range(88)]
    packet = {'exportStatus': 'COMPLETE_SINGLE_SOURCE_EXPORT', 'sourceId': CURRENT.SOURCE,
              'isHistoricalFixture': False, 'capturedAt': captured,
              'snapshot': {'jobs': copy.deepcopy(jobs), 'results': [{'id': 'synthetic-result',
                  'sourceId': CURRENT.SOURCE, 'finishedAt': accepted,
                  'completenessCertificate': {'observedAt': observed}}]}}
    put(root / CURRENT.INPUT_NAME, {'packet': packet, 'syntheticTestData': True})
    input_sha = hashlib.sha256((root / CURRENT.INPUT_NAME).read_bytes()).hexdigest()
    put(root / 'RUNTIME_REQUIREMENTS.json', {'privateInputSha256': input_sha})
    source = {'sourceId': CURRENT.SOURCE, 'companyId': CURRENT.COMPANY, 'state': 'PUBLISHING',
              'selectedSourceResultId': 'synthetic-result', 'lastAcceptedAt': accepted,
              'visibilityFloor': accepted, 'lastSuccessAt': observed, 'visibleJobCount': 88, 'jobs': jobs}
    projection = {'source': source, 'company': {'id': CURRENT.COMPANY, 'jobs': copy.deepcopy(jobs)},
                  'totalJobs': 88, 'lastUpdatedAt': observed, 'generatedAt': CURRENT.utc_milliseconds(captured)}
    payload = {'inputSha256': input_sha, 'inputUnchanged': True, 'capturedAt': captured,
               'comparisonTime': CURRENT.utc_milliseconds(captured), 'state': 'PUBLISHING',
               'visibleJobCount': 88, 'lastAcceptedAt': accepted, 'visibilityFloor': accepted,
               'lastSuccessAt': observed, 'lastUpdatedAt': observed, 'projection': projection}
    rehash(payload)
    return payload


def rehash(payload):
    payload['jobsSha256'] = CURRENT.digest(payload['projection']['source']['jobs'])
    payload['projectionSha256'] = CURRENT.digest(payload['projection'])


class FakeChild:
    def __init__(self, payload, failure=None, mutate=None):
        self.payload, self.failure, self.mutate = payload, failure, mutate
        self.calls = 0

    def __call__(self, args, **kwargs):
        self.calls += 1
        assert kwargs['env']['PATH'].endswith(':/usr/bin:/bin')
        assert 'DATABASE_URL' not in kwargs['env']
        if kwargs.get('stdout'):
            kwargs['stdout'].write('complete synthetic child diagnostic\n')
        if self.calls == 1 and self.failure == 'timeout':
            raise subprocess.TimeoutExpired(args, kwargs['timeout'], output='synthetic timeout output', stderr='synthetic timeout error')
        if self.calls == 1 and self.failure == 'spawn':
            raise FileNotFoundError('synthetic missing child executable')
        code = 9 if self.calls == 1 and self.failure == 'exit' else 0
        if code == 0 and any(str(x).endswith('compare-current-sanofi.mts') for x in args):
            candidate = Path(kwargs['cwd']).name
            payload = copy.deepcopy(self.payload)
            if self.mutate:
                self.mutate(candidate, payload)
            rehash(payload)
            put(Path(args[-1]), payload)
        return SimpleNamespace(returncode=code, stdout='complete synthetic stdout\n', stderr='complete synthetic stderr\n')


def engine_fixture(root, mismatch=None):
    commit = 'synthetic-engine-commit'
    platform = 'debian-openssl-3.0.x'
    base = f'https://binaries.prisma.sh/all_commits/{commit}/{platform}/'
    pins, downloads = [], {}
    for name in ['schema-engine', 'libquery_engine.so.node']:
        binary = ('synthetic bytes only: ' + name).encode()
        compressed = gzip.compress(binary, mtime=0)
        zipped_sha, binary_sha = ENGINES.digest(compressed), ENGINES.digest(binary)
        pin = {'official_url': base + name + '.gz', 'compressed_sha256': zipped_sha,
               'binary_sha256': binary_sha, 'size': len(binary)}
        if name == 'schema-engine' and mismatch:
            pin[mismatch] = '0' * 64
        pins.append(pin)
        downloads[base + name + '.gz'] = compressed
        downloads[base + name + '.gz.sha256'] = zipped_sha.encode()
        downloads[base + name + '.sha256'] = binary_sha.encode()
    put(root / 'RUNTIME_REQUIREMENTS.json', {'prisma': {'client': 'synthetic-test-version',
        'engineCommit': commit, 'platform': platform, 'engines': pins}})
    put(root / 'main/node_modules/@prisma/engines-version/package.json', {'prisma': {'enginesVersion': commit}})
    for candidate in ['main', 'fallback']:
        (root / candidate / 'node_modules/@prisma/engines').mkdir(parents=True, exist_ok=True)
    def fake_download(url, destination):
        destination.write_bytes(downloads[url])
    return fake_download


class ReplayToolTests(TestCase):
    def test_one_child_failure_propagates_and_preserves_diagnostics(self):
        for module, report_name, count in RUNNERS:
            for failure in ['exit', 'timeout', 'spawn']:
                with self.subTest(runner=module.__name__, failure=failure), TemporaryDirectory() as temp:
                    root = Path(temp)
                    payload = setup(root)
                    prior = b'[{"priorResult":"must remain recoverable"}]\n'
                    (root / report_name).write_bytes(prior)
                    # A stale top-level success must never substitute for the failed fresh child.
                    put(root / 'CURRENT_SANOFI_a775_PRIVATE_COMPARISON.json', payload)
                    fake = FakeChild(payload, failure=failure)
                    self.assertEqual(module.main(root=root, runner=fake), 1)
                    results = json.loads((root / report_name).read_text())
                    self.assertEqual(len(results), count)
                    self.assertNotEqual(results[0]['exit_code'], 0)
                    self.assertTrue(all(item['exit_code'] == 0 for item in results[1:]))
                    self.assertEqual(fake.calls, count)
                    archived = list((root / 'logs').glob('*/previous-' + report_name))
                    self.assertEqual(len(archived), 1)
                    self.assertEqual(archived[0].read_bytes(), prior)
                    self.assertTrue(Path(results[0]['log']).read_text())
                    if module is CURRENT:
                        self.assertEqual(json.loads((root / 'CURRENT_SANOFI_AUTOMATED_ACCEPTANCE.json').read_text())['status'], 'FAILED_CHILD')

    def test_same_count_different_fields_or_rewritten_source_time_fails(self):
        def different_content(candidate, payload):
            if candidate == 'main':
                payload['projection']['source']['jobs'][0]['title'] = 'Different synthetic content'
                payload['projection']['company']['jobs'][0]['title'] = 'Different synthetic content'
        def rewritten_time(candidate, payload):
            payload['lastUpdatedAt'] = payload['comparisonTime']
            payload['projection']['lastUpdatedAt'] = payload['comparisonTime']
        for mutation, expected in [(different_content, 'FULL_PROJECTION_FIELDS_DIFFER'),
                                   (rewritten_time, 'ORIGINAL_UPDATE_TIME_CHANGED')]:
            with self.subTest(expected=expected), TemporaryDirectory() as temp:
                root = Path(temp)
                payload = setup(root)
                self.assertEqual(CURRENT.main(root=root, runner=FakeChild(payload, mutate=mutation)), 1)
                report = json.loads((root / 'CURRENT_SANOFI_AUTOMATED_ACCEPTANCE.json').read_text())
                self.assertEqual(report['status'], 'FAILED_VALIDATION')
                self.assertIn(expected, report['message'])
                self.assertEqual(len(json.loads((root / 'CURRENT_SANOFI_EXECUTION_RESULTS.json').read_text())), 3)

    def test_remote_consistent_engine_bytes_cannot_override_fixed_pin(self):
        for field in ['compressed_sha256', 'binary_sha256']:
            with self.subTest(pin=field), TemporaryDirectory() as temp:
                root = Path(temp)
                download = engine_fixture(root, mismatch=field)
                report = root / 'prisma-engine-verification.json'
                prior = b'{"priorEngineReport":"preserve"}\n'
                report.write_bytes(prior)
                self.assertEqual(ENGINES.main(root=root, downloader=download), 1)
                result = json.loads(report.read_text())
                self.assertEqual(result['status'], 'FAILED')
                self.assertTrue(result['errors'])
                self.assertFalse((root / 'runtime/prisma-engines').exists())
                self.assertEqual(next((root / 'logs').glob('*/previous-prisma-engine-verification.json')).read_bytes(), prior)

    def test_all_success_produces_automatic_acceptance_and_zero_exit(self):
        for module, report_name, count in RUNNERS:
            with self.subTest(runner=module.__name__), TemporaryDirectory() as temp:
                root = Path(temp)
                payload = setup(root)
                self.assertEqual(module.main(root=root, runner=FakeChild(payload)), 0)
                results = json.loads((root / report_name).read_text())
                self.assertEqual(len(results), count)
                self.assertTrue(all(item['exit_code'] == 0 for item in results))
                if module is CURRENT:
                    acceptance = json.loads((root / 'CURRENT_SANOFI_AUTOMATED_ACCEPTANCE.json').read_text())
                    self.assertEqual(acceptance['status'], 'PASS')
                    self.assertTrue(acceptance['completeProjectionEqual'])
                    self.assertTrue(acceptance['originalSourceTimesPreserved'])
                    self.assertEqual(acceptance['uniqueJobs'], 88)
        with TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(ENGINES.main(root=root, downloader=engine_fixture(root)), 0)
            result = json.loads((root / 'prisma-engine-verification.json').read_text())
            self.assertEqual(result['status'], 'PASS')
            self.assertEqual(len(result['engines']), 2)
            self.assertTrue(all(item['pinned_checksums_verified'] for item in result['engines']))


if __name__ == '__main__':
    main()
