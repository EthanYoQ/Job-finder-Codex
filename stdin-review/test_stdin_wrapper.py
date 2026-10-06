#!/usr/bin/env python3
"""Execute shell/Python stdin wrappers only in explicit temporary fixtures.

Embedded module bytes and SHA remain unchanged in tests. Test-only source edits
substitute the local parent, UID and parent-chain length; production templates
have no parameters for any of those. No complete_part000 call is permitted.
"""
import base64
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
MODULE_BYTES = (HERE / 'fence_module.py').read_bytes()
MODULE_SHA = hashlib.sha256(MODULE_BYTES).hexdigest()
spec = importlib.util.spec_from_file_location('reviewed_stdin_module', HERE / 'fence_module.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)
CREATE = (HERE / 'create-fence.template.sh').read_text()
READ = (HERE / 'read-fence.template.sh').read_text()
NONCE = '9ea1a70f1fe043c6b5ee03eebd42aff6'


class StdinTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='fixture-stdin-', dir=HERE)
        self.root = Path(self.tmp.name)
        self.parent = self.root / 'paired'
        self.parent.mkdir(mode=0o700)
        self.target = self.parent / M.RELEASE
        M.PARENT = self.parent
        M.TRUSTED_UID = os.geteuid()
        self.snapshot = M.parent_snapshot()
        self.processes = []

    def tearDown(self):
        for proc in self.processes:
            if proc.poll() is None:
                proc.kill()
            proc.communicate(timeout=5)
        self.tmp.cleanup()

    def fixture_payload(self, template, snapshot=None, receipt=None, pause=None):
        snapshot = self.snapshot if snapshot is None else snapshot
        payload = template.replace('EXPECTED_PARENT_CHAIN = None  # PIN_FROM_AUTHORIZED_READ_ONLY_SERVER_SNAPSHOT',
                                   'EXPECTED_PARENT_CHAIN = ' + repr(snapshot))
        payload = payload.replace('len(EXPECTED_PARENT_CHAIN) != 3',
                                  'len(EXPECTED_PARENT_CHAIN) != ' + str(len(self.snapshot)))
        payload = payload.replace('row[2] != 0', 'row[2] != ' + str(os.geteuid()))
        injection = ("module['PARENT'] = module['Path'](" + repr(str(self.parent)) + ")\n" +
                     "module['TRUSTED_UID'] = " + str(os.geteuid()) + "\n" +
                     "def reject_part(*args, **kwargs):\n    raise AssertionError('PART_CALL_FORBIDDEN')\n" +
                     "module['complete_part000'] = reject_part\n")
        self.assertEqual(payload.count('# REVIEWED_MODULE_READY'), 1)
        payload = payload.replace('# REVIEWED_MODULE_READY', injection + '# REVIEWED_MODULE_READY')
        if receipt is not None:
            payload = payload.replace('SUCCESS_RECEIPT = None  # PIN_EXACT_INDEPENDENTLY_PERSISTED_CREATE_SUCCESS',
                                      'SUCCESS_RECEIPT = ' + repr(receipt))
        if pause:
            matches = [i for i, line in enumerate(MODULE_BYTES.decode().splitlines(), 1)
                       if '# ' + pause in line]
            self.assertEqual(len(matches), 1)
            tracer = ("import os,signal,sys\ntrace_fired = False\n" +
                      "def trace(frame, event, arg):\n    global trace_fired\n" +
                      "    if not trace_fired and event == 'line' and frame.f_code.co_filename == '<pinned-fence-module>' and frame.f_lineno == " + str(matches[0]) + ":\n" +
                      "        trace_fired = True\n        os.write(2, b'BARRIER_READY\\n')\n        os.kill(os.getpid(), signal.SIGSTOP)\n" +
                      "    return trace\nsys.settrace(trace)\n")
            payload = payload.replace('# REVIEWED_MODULE_READY', tracer + '# REVIEWED_MODULE_READY')
        return payload

    def start(self, payload, paused=False):
        proc = subprocess.Popen(['/bin/sh'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE)
        self.processes.append(proc)
        proc.stdin.write(payload.encode())
        proc.stdin.close()
        proc.stdin = None
        if paused:
            with selectors.DefaultSelector() as sel:
                sel.register(proc.stderr, selectors.EVENT_READ)
                self.assertTrue(sel.select(5), 'barrier timeout')
                self.assertEqual(proc.stderr.readline(), b'BARRIER_READY\n')
            pid, status = os.waitpid(proc.pid, os.WUNTRACED)
            self.assertEqual(pid, proc.pid)
            self.assertTrue(os.WIFSTOPPED(status))
        return proc

    def finish(self, proc, success=True):
        out, err = proc.communicate(timeout=10)
        if success:
            self.assertEqual(proc.returncode, 0, err.decode())
            return json.loads(out)
        self.assertNotEqual(proc.returncode, 0, out.decode())
        return err.decode()

    def run_payload(self, payload, success=True):
        return self.finish(self.start(payload), success)

    def create(self):
        return self.run_payload(self.fixture_payload(CREATE))

    def test_module_adaptation_changes_only_two_digest_expressions(self):
        original = (HERE.parent / 'fence_candidate.py').read_bytes()
        expression = b'hashlib.sha256(Path(__file__).read_bytes()).hexdigest()'
        self.assertEqual(original.count(expression), 2)
        self.assertEqual(MODULE_BYTES, original.replace(expression, b'VERIFIED_MODULE_SHA256'))
        self.assertNotIn(b'__file__', MODULE_BYTES)
        self.assertIn("PARENT = Path('/opt/jobfinder-paired')", MODULE_BYTES.decode())
        for template in (CREATE, READ):
            self.assertNotIn('sys.argv', template)
            self.assertNotIn('os.environ', template)
            self.assertIn("MODULE_SHA256 = '" + MODULE_SHA + "'", template)
            self.assertEqual(template.count("base64.b64decode(MODULE_B64, validate=True)"), 1)
            self.assertLess(len(template.encode()), 12288)

    def test_unfilled_templates_reject_before_any_target_access(self):
        for template in (CREATE, READ):
            error = self.run_payload(template, False)
            self.assertIn('REAL_PARENT_SNAPSHOT_NOT_PINNED', error)
        self.assertFalse(self.target.exists())

    def test_stdin_create_and_independent_readback(self):
        receipt = self.create()
        self.assertEqual(receipt['state'], 'FENCE_CREATED')
        self.assertEqual(receipt['marker']['fenceSourceSha256'], MODULE_SHA)
        self.assertEqual(receipt['marker']['nonce'], NONCE)
        result = self.run_payload(self.fixture_payload(READ, receipt=receipt))
        self.assertEqual(result['state'], 'FENCE_VERIFIED')
        self.assertEqual(result['markerSha256'], receipt['markerSha256'])
        self.assertFalse((self.target / 'bootstrap.part000').exists())

    def test_wrong_module_digest_rejects_before_mkdir(self):
        payload = self.fixture_payload(CREATE).replace("MODULE_SHA256 = '" + MODULE_SHA + "'",
                                                      "MODULE_SHA256 = '" + '0' * 64 + "'")
        self.assertIn('EMBEDDED_MODULE_HASH_MISMATCH', self.run_payload(payload, False))
        self.assertFalse(self.target.exists())

    def test_wrong_embedded_module_bytes_reject_before_exec(self):
        encoded = base64.b64encode(MODULE_BYTES).decode()
        altered = base64.b64encode(MODULE_BYTES + b'\nraise Exception("SHOULD_NEVER_EXECUTE")\n').decode()
        payload = self.fixture_payload(CREATE).replace(encoded, altered)
        self.assertIn('EMBEDDED_MODULE_HASH_MISMATCH', self.run_payload(payload, False))
        self.assertFalse(self.target.exists())

    def test_wrong_parent_snapshot_rejects_before_mkdir(self):
        changed = copy.deepcopy(self.snapshot)
        changed[-1][1] += 1
        payload = self.fixture_payload(CREATE, snapshot=changed)
        self.assertIn('PARENT_IDENTITY_CHANGED', self.run_payload(payload, False))
        self.assertFalse(self.target.exists())

    def test_wrong_receipt_source_binding_rejects(self):
        receipt = self.create()
        receipt['marker']['fenceSourceSha256'] = '0' * 64
        self.assertIn('RECEIPT_BINDING_MISMATCH',
                      self.run_payload(self.fixture_payload(READ, receipt=receipt), False))

    def test_wrong_receipt_nonce_binding_rejects(self):
        receipt = self.create()
        receipt['marker']['nonce'] = '0' * 32
        self.assertIn('RECEIPT_BINDING_MISMATCH',
                      self.run_payload(self.fixture_payload(READ, receipt=receipt), False))

    def test_wrong_receipt_parent_binding_rejects(self):
        receipt = self.create()
        receipt['marker']['parentChain'][-1][1] += 1
        self.assertIn('RECEIPT_BINDING_MISMATCH',
                      self.run_payload(self.fixture_payload(READ, receipt=receipt), False))

    def test_missing_success_receipt_rejects(self):
        self.create()
        error = self.run_payload(self.fixture_payload(READ), False)
        self.assertIn('NO_SUCCESS_RECEIPT', error)

    def test_existing_directory_is_never_adopted(self):
        self.target.mkdir(mode=0o700)
        self.run_payload(self.fixture_payload(CREATE), False)
        self.assertEqual(os.listdir(self.target), [])

    def test_kill_after_mkdir_is_unknown_and_no_retry(self):
        payload = self.fixture_payload(CREATE, pause='PHASE_AFTER_MKDIR')
        proc = self.start(payload, True)
        proc.kill()
        self.finish(proc, False)
        self.assertEqual(os.listdir(self.target), [])
        self.run_payload(self.fixture_payload(CREATE), False)
        self.assertIn('NO_SUCCESS_RECEIPT',
                      self.run_payload(self.fixture_payload(READ, receipt={'state': 'UNKNOWN'}), False))
        self.assertEqual(os.listdir(self.target), [])

    def test_kill_after_marker_open_is_unknown_and_no_repair(self):
        payload = self.fixture_payload(CREATE, pause='PHASE_AFTER_EXCLUSIVE_OPEN')
        proc = self.start(payload, True)
        proc.kill()
        self.finish(proc, False)
        self.assertEqual((self.target / M.MARKER).read_bytes(), b'')
        self.run_payload(self.fixture_payload(CREATE), False)
        self.assertEqual((self.target / M.MARKER).read_bytes(), b'')

    def test_lost_receipt_is_not_adopted(self):
        payload = self.fixture_payload(CREATE, pause='PHASE_BEFORE_RECEIPT')
        proc = self.start(payload, True)
        proc.kill()
        self.finish(proc, False)
        self.assertEqual(set(os.listdir(self.target)), {M.MARKER, M.HASH_FILE})
        self.assertIn('NO_SUCCESS_RECEIPT',
                      self.run_payload(self.fixture_payload(READ, receipt={'state': 'UNKNOWN'}), False))
        self.run_payload(self.fixture_payload(CREATE), False)

    def test_same_directory_mkdir_race_only_one_wrapper_wins(self):
        payload = self.fixture_payload(CREATE, pause='PHASE_BEFORE_MKDIR')
        workers = [self.start(payload, True) for _ in range(3)]
        for proc in workers:
            proc.send_signal(signal.SIGCONT)
        results = [proc.communicate(timeout=10) for proc in workers]
        self.assertEqual(sum(proc.returncode == 0 for proc in workers), 1, results)
        self.assertFalse((self.target / 'bootstrap.part000').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
