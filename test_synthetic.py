"""Offline synthetic tests. Generated controllers are never imported or run."""
import ast
import copy
from datetime import datetime
import hashlib
import importlib.util
import json
import pathlib
import re
import shutil
import subprocess
import tempfile
import types
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('source_renderer', str(HERE / 'render.py'))
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
SYNTHETIC = json.loads((HERE / 'synthetic.bindings.json').read_text())
RECORDS = renderer.reconstruct(HERE, SYNTHETIC)


def need(condition, code):
    if not condition:
        raise RuntimeError(code)


def functions(component, names, namespace):
    # Extract function definitions only from synthetic bytes. No imports,
    # module-level guards, paths or operational entrypoints are evaluated.
    tree = ast.parse(RECORDS[component]['bytes'])
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(selected) == len(names)
    module = ast.Module(body=selected, type_ignores=[])
    exec(compile(module, '<synthetic-selected-functions>', 'exec'), namespace)
    return namespace


def literal(component, name):
    tree = ast.parse(RECORDS[component]['bytes'])
    return next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == name for target in node.targets))


class ReconstructionTests(unittest.TestCase):
    def test_exact_source_count_and_dependency_chain(self):
        self.assertEqual(len(RECORDS), 10)
        recipe = json.loads((HERE / 'recipe.json').read_text())
        for item in recipe['components']:
            with self.subTest(component=item['id']):
                raw = RECORDS[item['id']]['bytes']
                ast.parse(raw, feature_version=(3, 6))
                self.assertNotIn(b'__BIND_', raw)
                template = (HERE / item['template']).read_text()
                for dependency in recipe['components']:
                    if '__SHA_' + dependency['token'] + '__' in template:
                        self.assertIn(RECORDS[dependency['id']]['sha256'].encode(), raw)
                    if '__FILE_' + dependency['token'] + '__' in template:
                        self.assertIn(RECORDS[dependency['id']]['filename'].encode(), raw)

    def test_every_missing_binding_refused(self):
        for key in SYNTHETIC['values']:
            with self.subTest(key=key):
                supplied = copy.deepcopy(SYNTHETIC)
                del supplied['values'][key]
                with self.assertRaisesRegex(ValueError, 'BINDING_KEYS'):
                    renderer.reconstruct(HERE, supplied)

    def test_unknown_or_computed_override_refused(self):
        for key in ('PRIOR_STATUS', 'SHA_STATE', 'UNKNOWN_RECEIPT_UNLOCK'):
            supplied = copy.deepcopy(SYNTHETIC)
            supplied['values'][key] = 'PASS'
            with self.assertRaisesRegex(ValueError, 'BINDING_KEYS'):
                renderer.reconstruct(HERE, supplied)

    def test_injection_and_unset_values_refused(self):
        for value in ('', None, '__BIND_UNSET__', 'x\nimport os', "x';import os;#", '${HOME}', '../x\\y'):
            with self.subTest(value=value):
                supplied = copy.deepcopy(SYNTHETIC)
                supplied['values']['RELEASE_ROOT'] = value
                with self.assertRaisesRegex(ValueError, 'BINDING_VALUE'):
                    renderer.reconstruct(HERE, supplied)

    def test_changed_template_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            target = pathlib.Path(temp) / 'package'
            shutil.copytree(str(HERE), str(target), ignore=shutil.ignore_patterns('__pycache__'))
            recipe = json.loads((target / 'recipe.json').read_text())
            path = target / recipe['components'][0]['template']
            path.write_bytes(path.read_bytes() + b'\n# changed\n')
            with self.assertRaisesRegex(ValueError, 'TEMPLATE_HASH'):
                renderer.reconstruct(target, SYNTHETIC)

    def test_expected_original_mismatch_refused(self):
        expected = {key: {'filename': value['filename'], 'sha256': value['sha256']}
                    for key, value in RECORDS.items() if key != 'facet'}
        expected['state']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'EXPECTED_SOURCE_HASH_state'):
            renderer.reconstruct(HERE, SYNTHETIC, expected)

    def test_unbound_templates_refuse_before_import_or_io(self):
        for path in sorted((HERE / 'templates').glob('*.in')):
            with self.subTest(template=path.name):
                tree = ast.parse(path.read_bytes(), feature_version=(3, 6))
                self.assertIsInstance(tree.body[0], ast.Raise)
                # No import builtin, filesystem object or process object exists.
                with self.assertRaisesRegex(RuntimeError, 'UNBOUND_SOURCE_TEMPLATE'):
                    exec(compile(tree, '<unbound-template>', 'exec'),
                         {'__builtins__': {}, 'RuntimeError': RuntimeError})

    def test_quality_and_failure_policies_remain_literal(self):
        roles = RECORDS['roll-roles']['bytes'].decode()
        switch = RECORDS['switch-traffic']['bytes'].decode()
        http = RECORDS['http-accept-refresh']['bytes'].decode()
        state = RECORDS['state']['bytes'].decode()
        self.assertIn('memory()>=614400', roles)
        self.assertIn('memory()>=196608', roles)
        self.assertIn('time.time()-s.st_mtime<=300', switch)
        self.assertIn("expectation.get('jobCount') == 181", http)
        self.assertIn("'priorInvocationStatus':'Failed'", state)
        self.assertIn("'PREDECESSOR_NOT_CONFIRMED_RESTORED'", state)
        self.assertNotIn('__BIND_PRIOR_STATUS__', state)


class TimestampTests(unittest.TestCase):
    def test_aggregate_max_and_invalid_dates(self):
        ns = functions('http-accept-refresh', ['global_last_updated_at'],
                       {'require': need, 're': re, 'datetime': datetime})
        maximum = ns['global_last_updated_at']
        early = '2042-06-01T09:25:02.925Z'
        coverage = '2042-06-01T10:30:26.271Z'
        self.assertEqual(maximum(early, coverage), coverage)
        self.assertEqual(maximum(coverage, early), coverage)
        self.assertNotEqual(maximum(early, coverage), '2042-06-01T10:30:15.407Z')
        for invalid in ('2042-02-30T00:00:00Z', 'unknown', '', None):
            with self.subTest(invalid=invalid):
                with self.assertRaises((ValueError, RuntimeError)):
                    maximum(early, invalid)


class PriorAttemptTests(unittest.TestCase):
    def fixture(self, change=None, advanced=False):
        values = SYNTHETIC['values']
        failure = {'status': 'HTTP_ACCEPTANCE_STOPPED', 'phase': 'main-precut',
                   'reason': 'HTTP_ACCEPTANCE_FAILED', 'rollback': {
                       'state': 'ORIGINAL_BACKUP_RESTORED_HEALTHY',
                       'newMainStop': 'confirmed-stopped', 'oldBackupRestore': 'restarted',
                       'restoredPid': int(values['OLD_BACKUP_PID'])}}
        launch = {'status': 'NEW_MAIN_HEALTHY_TRAFFIC_UNCHANGED',
                  'pid': int(values['PRIOR_CANDIDATE_PID']),
                  'startTicks': values['PRIOR_CANDIDATE_START_TICKS'], 'port': 3036}
        if change:
            change(failure, launch)
        objects = {'accept-main-failed.json': failure, 'launch-main-result.json': launch,
                   'launch-main-intent.json': {'synthetic': True}}
        pins = literal('state', 'PRIOR_FILES')
        encoded = {name: json.dumps(value).encode() for name, value in objects.items()}
        digests = {raw: pins[name] for name, raw in encoded.items()}
        class FakePath:
            def __init__(self, name=''): self.name = name
            def __truediv__(self, name): return FakePath(name)
            def exists(self): return advanced
            def is_symlink(self): return False
        ns = {'need': need, 'root_guard': lambda: None, 'ROOT': FakePath(), 'PRIOR_FILES': pins,
              'regular': lambda path: encoded[path.name], 'sha': lambda raw: digests[raw], 'json': json}
        return functions('state', ['predecessor'], ns)['predecessor']

    def test_known_terminal_restored_pair_accepted(self):
        self.assertEqual(len(self.fixture()()), 3)

    def test_unknown_failure_or_unconfirmed_restore_refused(self):
        mutations = [lambda f, l: f.update(status='UNKNOWN'),
                     lambda f, l: f.update(phase='main-final'),
                     lambda f, l: f['rollback'].update(state='READBACK_REQUIRED'),
                     lambda f, l: f['rollback'].update(newMainStop='unknown'),
                     lambda f, l: f['rollback'].update(restoredPid=999),
                     lambda f, l: l.update(pid=999)]
        for change in mutations:
            with self.subTest(change=mutations.index(change)):
                with self.assertRaisesRegex(RuntimeError, 'PREDECESSOR_'):
                    self.fixture(change)()
        with self.assertRaisesRegex(RuntimeError, 'ADVANCED_BEYOND_FAILURE'):
            self.fixture(advanced=True)()


class EvidenceTests(unittest.TestCase):
    def test_result_error_parse_and_timeout_are_saved(self):
        names = ['error_summary', 'helper_bytes', 'stream_evidence', 'recognized_helper_report',
                 'reject_json_constant', 'observe_helper']
        phases = {'main-precut': ('accept-main.json', 'web-main')}
        for case in ('mismatch', 'invalid', 'unknown-schema', 'timeout', 'execution-error'):
            with self.subTest(case=case):
                saved = []
                raw = json.dumps({'status': 'MISMATCH', 'phase': 'main-precut',
                                  'role': 'web-main', 'helperExitCode': 1}).encode()
                if case == 'invalid': raw = b'not-json-private-response'
                if case == 'unknown-schema': raw = b'{"privateBody":"not-an-allowed-envelope"}'
                def run(*args, **kwargs):
                    self.assertEqual(kwargs['timeout'], 480)
                    if case == 'timeout':
                        raise subprocess.TimeoutExpired('synthetic', 480, output=raw, stderr=b'private-stderr')
                    if case == 'execution-error': raise OSError('private-exception-detail')
                    return types.SimpleNamespace(stdout=raw, stderr=b'private-stderr', returncode=1)
                def save(name, report):
                    saved.append((name, report))
                    return {'state': 'SAVED'}
                ns = {'H': types.SimpleNamespace(sha=renderer.sha, ENV={}), 'ERROR_CODES': frozenset(),
                      'PHASES': phases, 'HTTP_FILE': 'synthetic.py', 'HTTP_SHA': '0' * 64,
                      'subprocess': types.SimpleNamespace(run=run, PIPE=-1, TimeoutExpired=subprocess.TimeoutExpired),
                      'json': json, 'save_helper_report': save}
                observe = functions('accept-controller', names, ns)['observe_helper']
                value, report, diagnostics = observe(['never-executed'], 'main-precut', 'web-main', 'accept-main.json')
                self.assertEqual(len(saved), 1)
                self.assertEqual(diagnostics['state'], 'SAVED')
                self.assertEqual(report['stdout']['sha256'], renderer.sha(raw if case != 'execution-error' else b''))
                self.assertNotIn('private-stderr', json.dumps(report))
                self.assertNotIn('private-exception-detail', json.dumps(report))
                if case != 'mismatch': self.assertIsNone(report['helperReport'])
                if case == 'timeout':
                    self.assertIsNone(report['returncode'])
                    self.assertFalse(report['returncodeAvailable'])

    def test_acceptance_saves_evidence_before_output_validation(self):
        tree = ast.parse(RECORDS['accept-controller']['bytes'])
        accept = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'accept')
        source = ast.get_source_segment(RECORDS['accept-controller']['bytes'].decode(), accept)
        self.assertLess(source.index('observe_helper('), source.index("diagnostics['state']=='SAVED'"))
        self.assertLess(source.index("diagnostics['state']=='SAVED'"), source.index("value.get('status')=='PASS'"))
        self.assertIn('rollback=recover(phase)', source)


class DrainTests(unittest.TestCase):
    def simulate(self, exit_after, changed_route=False):
        original = b'proxy_pass http://127.0.0.1:3031;'
        candidate = original.replace(b':3031;', b':3036;')
        world = {'time': 0.0, 'reload': False, 'conf': b'unknown' if changed_route else candidate}
        class Config:
            def read_bytes(self): return world['conf']
            def is_symlink(self): return False
        def token(pid):
            if pid == 201: return '101'
            if pid == 301: return '202' if world['time'] < exit_after else None
            if pid == 302 and world['reload']: return '203'
            return None
        def listener(pid, port):
            return (pid == 201 and port == 3031) or (pid == 302 and port == 443 and world['reload'])
        def run(argv):
            if 'reload' in argv: world['reload'] = True
        def processes():
            workers = {301: '202'} if token(301) else {}
            if world['reload']: workers[302] = '203'
            return {100: '100'}, workers
        def sleep(seconds): world['time'] += seconds
        H = types.SimpleNamespace(OLD_MAIN={}, find=lambda spec: {'pid': 201, 'pm2_env': {'restart_time': 0}},
              process_token=token, owns_listener=listener, require=need, health=lambda port: None,
              sha=renderer.sha, CONF_SHA=renderer.sha(original), CONF=Config(), run=run)
        ns = {'H': H, 'processes': processes, 'write_config': lambda expected, content, label: world.update(conf=content),
              'time': types.SimpleNamespace(monotonic=lambda: world['time'], sleep=sleep), 'domain_index': lambda: b'old-index'}
        restore = functions('switch-traffic', ['restore_original_route'], ns)['restore_original_route']
        return restore, world, (renderer.sha(candidate), original, renderer.sha(b'old-index'), 'synthetic')

    def test_long_request_drains_before_success(self):
        restore, world, args = self.simulate(4)
        result = restore(*args)
        self.assertEqual(result['state'], 'ORIGINAL_ROUTE_VERIFIED_AND_WORKERS_DRAINED')
        self.assertGreaterEqual(world['time'], 4)

    def test_never_drained_refuses_success(self):
        restore, world, args = self.simulate(float('inf'))
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_NGINX_WORKERS_NOT_DRAINED'):
            restore(*args)

    def test_unknown_route_refuses_change(self):
        restore, world, args = self.simulate(4, changed_route=True)
        with self.assertRaisesRegex(RuntimeError, 'CONFIG_EXTERNAL_CHANGE_NO_ROLLBACK'):
            restore(*args)
        self.assertEqual(world['conf'], b'unknown')
        self.assertFalse(world['reload'])


if __name__ == '__main__':
    unittest.main()
