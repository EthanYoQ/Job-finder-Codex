#!/usr/bin/env python3
"""Execute shell/Python stdin wrappers only in explicit temporary fixtures.

Embedded r4 module bytes and SHA remain unchanged in tests. Test-only source edits
substitute the local parent, UID and parent-chain length; production templates
have no parameters for any of those. No complete_part000 call is permitted.
"""
import base64
import copy
import hashlib
import types
import zlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import unittest
import sys

def forbid_network(event, args):
    if event.startswith('socket.'):
        raise RuntimeError('NETWORK_FORBIDDEN_IN_OFFLINE_TEST')
sys.addaudithook(forbid_network)

HERE = Path(__file__).resolve().parent
MODULE_PATH = HERE / 'fence_module.py'
MODULE_BYTES = MODULE_PATH.read_bytes()
MODULE_SHA = hashlib.sha256(MODULE_BYTES).hexdigest()
M = types.ModuleType('reviewed_stdin_module')
exec(compile(MODULE_BYTES, '<frozen-r2-module>', 'exec'), M.__dict__)
PACKED = zlib.compress(MODULE_BYTES, level=9)
PACKED_SHA = hashlib.sha256(PACKED).hexdigest()
CREATE = (HERE / 'create-fence.template.sh').read_text()
READ = (HERE / 'read-fence.template.sh').read_text()
NONCE = '749339f6066e43fe8ed0110650f17c35'


def filled_uint64_payloads(absent=False):
    """Size fixture only; these are not actual server identities or receipts."""
    maximum = (1 << 64) - 1
    chain = [[maximum, maximum, 0, 0o7755] for _ in range(3)]
    if absent:
        chain[-1][-1] = 0o700
    marker = {'version': 1, 'release': M.RELEASE, 'nonce': NONCE,
              'oldScriptSha256': M.OLD_SHA, 'fenceSourceSha256': MODULE_SHA,
              'parentChain': chain, 'targetIdentity': [maximum, maximum, 0, 0o700],
              'parentCreated': absent}
    marker_bytes = (json.dumps(marker, sort_keys=True, separators=(',', ':')) + '\n').encode()
    receipt = {'state': 'FENCE_CREATED', 'markerSha256': hashlib.sha256(marker_bytes).hexdigest(),
               'marker': marker}
    payloads = {}
    for name, template in [('create', CREATE), ('read', READ)]:
        text = template.replace('EXPECTED_PARENT_CHAIN = None  # PIN_EXISTING_PARENT_CHAIN_OR_LEAVE_NONE',
                                'EXPECTED_PARENT_CHAIN = ' + json.dumps(chain, separators=(',', ':')))
        text = text.replace('SUCCESS_RECEIPT = None  # PIN_EXACT_INDEPENDENTLY_PERSISTED_CREATE_SUCCESS',
                            'SUCCESS_RECEIPT = ' + repr(receipt))
        if absent:
            text = text.replace('EXPECTED_PARENT_CHAIN = ' + json.dumps(chain, separators=(',', ':')),
                                'EXPECTED_PARENT_CHAIN = None')
            text = text.replace('EXPECTED_ANCESTOR_CHAIN = None  # PIN_ANCESTORS_ONLY_FOR_APPROVED_ABSENT_PARENT',
                                'EXPECTED_ANCESTOR_CHAIN = ' + repr(chain[:-1]))
        payloads[name] = text
    return payloads


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
        payload = template.replace('EXPECTED_PARENT_CHAIN = None  # PIN_EXISTING_PARENT_CHAIN_OR_LEAVE_NONE',
                                   'EXPECTED_PARENT_CHAIN = ' + repr(snapshot))
        payload = payload.replace('valid_chain(EXPECTED_PARENT_CHAIN, 3)',
                                  'valid_chain(EXPECTED_PARENT_CHAIN, ' + str(len(self.snapshot)) + ')')
        payload = payload.replace('valid_chain(EXPECTED_ANCESTOR_CHAIN, 2)',
                                  'valid_chain(EXPECTED_ANCESTOR_CHAIN, ' + str(len(self.snapshot)-1) + ')')
        payload = payload.replace('valid_chain(chain, 3)',
                                  'valid_chain(chain, ' + str(len(self.snapshot)) + ')')
        payload = payload.replace('row[2] == 0', 'row[2] == ' + str(os.geteuid()))
        payload = payload.replace('chain[-1][2:] == [0, 0o700]',
                                  'chain[-1][2:] == [' + str(os.geteuid()) + ', 0o700]')
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

    def test_module_adaptation_only_digest_binding_and_early_checks(self):
        original = (HERE / 'fence_candidate.py').read_bytes()
        expression = b'hashlib.sha256(Path(__file__).read_bytes()).hexdigest()'
        self.assertEqual(original.count(expression), 2)
        helper = ("def verified_source_digest():\n"
                  "    digest = globals().get('VERIFIED_MODULE_SHA256')\n"
                  "    require(isinstance(digest, str) and len(digest) == 64 and\n"
                  "            all(c in '0123456789abcdef' for c in digest),\n"
                  "            'SOURCE_BINDING_MISSING_OR_INVALID')\n"
                  "    return digest\n\n\n")
        expected = original.decode().replace(expression.decode(), 'verified_source_digest()')
        expected = expected.replace('def create_fence(expected_chain, nonce, expected_ancestor_chain=None):\n',
                                    helper + 'def create_fence(expected_chain, nonce, expected_ancestor_chain=None):\n    verified_source_digest()\n')
        expected = expected.replace('    """Run independently. A missing/unknown receipt is never adopted."""\n',
                                    '    """Run independently. A missing/unknown receipt is never adopted."""\n    verified_source_digest()\n')
        expected = expected.replace('    """Separately authorized operation; never call after any new UNKNOWN."""\n',
                                    '    """Separately authorized operation; never call after any new UNKNOWN."""\n    verified_source_digest()\n')
        self.assertEqual(MODULE_BYTES, expected.encode())
        self.assertNotIn(b'__file__', MODULE_BYTES)
        self.assertEqual(MODULE_SHA, 'd420bd7bb06bc1f4303f24433054ae203f2228532b5acb20ffe86e38bed37d5a')
        self.assertEqual(len(PACKED), 2839)
        self.assertEqual(PACKED_SHA, '4f0a023193b0dcdadb1c5f34e4a05505a71df47a71a680c08d830f88073c762e')
        self.assertEqual(zlib.decompress(PACKED), MODULE_BYTES)
        self.assertIn("PARENT = Path('/opt/jobfinder-paired')", MODULE_BYTES.decode())
        for template in (CREATE, READ):
            self.assertNotIn('sys.argv', template)
            self.assertNotIn('os.environ', template)
            self.assertIn("MODULE_SHA256 = '" + MODULE_SHA + "'", template)
            self.assertEqual(template.count("base64.b64decode(PACKED_B64, validate=True)"), 1)
            self.assertLess(len(template.encode()), 12288)
            self.assertLess(len(template.encode()), 9415)

    def test_tampered_compressed_bytes_reject_before_decompression(self):
        changed = bytes([PACKED[0] ^ 1]) + PACKED[1:]
        payload = self.fixture_payload(CREATE).replace(base64.b64encode(PACKED).decode(),
                                                      base64.b64encode(changed).decode())
        self.assertIn('COMPRESSED_MODULE_HASH_MISMATCH', self.run_payload(payload, False))
        self.assertFalse(self.target.exists())

    def test_wrong_compressed_length_rejects(self):
        payload = self.fixture_payload(CREATE).replace('PACKED_BYTES = 2839', 'PACKED_BYTES = 2838')
        self.assertIn('COMPRESSED_MODULE_HASH_MISMATCH', self.run_payload(payload, False))
        self.assertFalse(self.target.exists())

    def test_full_uint64_payloads_fit_and_reject_synthetic_identity(self):
        for name, text in filled_uint64_payloads().items():
            with self.subTest(action=name):
                self.assertLessEqual(len(text.encode()), 12288)
                self.assertLess(len(text.encode()), 9415)
                # Execute only with an explicit temporary local path. The exact
                # production payload size above excludes this test injection.
                injection = ("module['PARENT'] = module['Path'](" + repr(str(self.parent)) + ")\n" +
                             "module['TRUSTED_UID'] = " + str(os.geteuid()) + "\n")
                safe_fixture = text.replace('# REVIEWED_MODULE_READY', injection + '# REVIEWED_MODULE_READY')
                self.assertIn('PARENT_IDENTITY_CHANGED', self.run_payload(safe_fixture, False))
                self.assertFalse(self.target.exists())

    def test_unfilled_templates_reject_before_any_target_access(self):
        for template in (CREATE, READ):
            error = self.run_payload(template, False)
            self.assertIn('REAL_PARENT_PLAN_NOT_PINNED', error)
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
        encoded = base64.b64encode(PACKED).decode()
        changed = zlib.compress(MODULE_BYTES + b'\nraise Exception("SHOULD_NEVER_EXECUTE")\n', level=9)
        payload = self.fixture_payload(CREATE).replace(encoded, base64.b64encode(changed).decode())
        payload = payload.replace("PACKED_SHA256 = '" + PACKED_SHA + "'",
                                  "PACKED_SHA256 = '" + hashlib.sha256(changed).hexdigest() + "'")
        payload = payload.replace('PACKED_BYTES = ' + str(len(PACKED)),
                                  'PACKED_BYTES = ' + str(len(changed)))
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

    def test_direct_module_missing_binding_fails_before_target_access(self):
        payload = ("#!/bin/sh\nexec python3 - <<'PY'\nimport base64\n" +
                   "module = {'__name__': 'direct_unbound_review'}\n" +
                   "exec(compile(base64.b64decode(" + repr(base64.b64encode(MODULE_BYTES).decode()) +
                   "), '<direct-unbound-module>', 'exec'), module)\n" +
                   "module['PARENT'] = module['Path'](" + repr(str(self.parent)) + ")\n" +
                   "module['TRUSTED_UID'] = " + str(os.geteuid()) + "\n" +
                   "module['create_fence'](" + repr(self.snapshot) + ", " + repr(NONCE) + ")\nPY\n")
        self.assertIn('SOURCE_BINDING_MISSING_OR_INVALID', self.run_payload(payload, False))
        self.assertEqual(os.listdir(self.parent), [])
        self.parent.rmdir()  # No parent is available to read: binding still fails first.
        self.assertIn('SOURCE_BINDING_MISSING_OR_INVALID', self.run_payload(payload, False))
        self.assertFalse(self.parent.exists())

    def test_invalid_source_binding_fails_before_mkdir(self):
        payload = self.fixture_payload(CREATE).replace('# REVIEWED_MODULE_READY',
                   "module['VERIFIED_MODULE_SHA256'] = 'invalid'\n# REVIEWED_MODULE_READY")
        self.assertIn('SOURCE_BINDING_MISSING_OR_INVALID', self.run_payload(payload, False))
        self.assertEqual(os.listdir(self.parent), [])

    def test_stdin_fifo_marker_rejected_within_two_seconds(self):
        receipt = self.create()
        (self.target / M.MARKER).unlink()
        os.mkfifo(self.target / M.MARKER, 0o600)
        proc = self.start(self.fixture_payload(READ, receipt=receipt))
        out, err = proc.communicate(timeout=2)
        self.assertNotEqual(proc.returncode, 0, out)
        self.assertIn('BAD_FILE', err.decode())

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


    def absent_payload(self, template, receipt=None, pause=None):
        payload = self.fixture_payload(template, receipt=receipt, pause=pause)
        payload = payload.replace('EXPECTED_PARENT_CHAIN = ' + repr(self.snapshot),
                                  'EXPECTED_PARENT_CHAIN = None')
        return payload.replace('EXPECTED_ANCESTOR_CHAIN = None  # PIN_ANCESTORS_ONLY_FOR_APPROVED_ABSENT_PARENT',
                               'EXPECTED_ANCESTOR_CHAIN = ' + repr(self.snapshot[:-1]))

    def test_absent_parent_stdin_create_and_read(self):
        self.parent.rmdir()
        receipt = self.run_payload(self.absent_payload(CREATE))
        self.assertTrue(receipt['marker']['parentCreated'])
        verified = self.run_payload(self.absent_payload(READ, receipt=receipt))
        self.assertEqual(verified['state'], 'FENCE_VERIFIED')
        self.assertFalse((self.target / 'bootstrap.part000').exists())

    def test_absent_parent_missing_source_binding_precedes_creation(self):
        self.parent.rmdir()
        payload = self.absent_payload(CREATE).replace('# REVIEWED_MODULE_READY',
                   "module.pop('VERIFIED_MODULE_SHA256')\n# REVIEWED_MODULE_READY")
        self.assertIn('SOURCE_BINDING_MISSING_OR_INVALID', self.run_payload(payload, False))
        self.assertFalse(self.parent.exists())

    def test_absent_plan_existing_parent_is_not_adopted(self):
        self.assertIn('FileExistsError', self.run_payload(self.absent_payload(CREATE), False))
        self.assertEqual(os.listdir(self.parent), [])

    def test_absent_plan_wrong_ancestor_receipt_binding_rejected(self):
        self.parent.rmdir()
        receipt = self.run_payload(self.absent_payload(CREATE))
        receipt['marker']['parentChain'][0][1] += 1
        self.assertIn('RECEIPT_BINDING_MISMATCH',
                      self.run_payload(self.absent_payload(READ, receipt=receipt), False))

    def test_absent_plan_wrong_created_flag_rejected(self):
        self.parent.rmdir()
        receipt = self.run_payload(self.absent_payload(CREATE))
        receipt['marker']['parentCreated'] = False
        self.assertIn('RECEIPT_BINDING_MISMATCH',
                      self.run_payload(self.absent_payload(READ, receipt=receipt), False))

    def test_absent_plan_parent_only_interruption_stays_unknown(self):
        self.parent.rmdir()
        proc = self.start(self.absent_payload(CREATE, pause='PHASE_AFTER_PARENT_MKDIR'), True)
        proc.kill()
        self.finish(proc, False)
        self.assertEqual(os.listdir(self.parent), [])
        self.assertIn('FileExistsError', self.run_payload(self.absent_payload(CREATE), False))
        self.assertIn('NO_SUCCESS_RECEIPT', self.run_payload(self.absent_payload(READ), False))
        self.assertFalse(self.target.exists())

    def test_both_parent_plans_reject_before_target_access(self):
        payload = self.fixture_payload(CREATE).replace(
            'EXPECTED_ANCESTOR_CHAIN = None  # PIN_ANCESTORS_ONLY_FOR_APPROVED_ABSENT_PARENT',
            'EXPECTED_ANCESTOR_CHAIN = ' + repr(self.snapshot[:-1]))
        self.assertIn('REAL_PARENT_PLAN_NOT_PINNED', self.run_payload(payload, False))
        self.assertFalse(self.target.exists())

    def test_uid_mismatch_snapshot_rejects_before_creation(self):
        self.parent.rmdir()
        wrong = copy.deepcopy(self.snapshot[:-1])
        wrong[-1][2] = os.geteuid() + 1
        payload = self.absent_payload(CREATE).replace(
            'EXPECTED_ANCESTOR_CHAIN = ' + repr(self.snapshot[:-1]),
            'EXPECTED_ANCESTOR_CHAIN = ' + repr(wrong))
        self.assertIn('REAL_PARENT_PLAN_NOT_PINNED', self.run_payload(payload, False))
        self.assertFalse(self.parent.exists())


    def test_absent_uint64_payloads_fit_and_reject_synthetic_identity(self):
        self.parent.rmdir()
        for name, text in filled_uint64_payloads(absent=True).items():
            with self.subTest(action=name):
                self.assertLess(len(text.encode()), 9415)
                python = text.split("exec python3 - <<'PY'\n", 1)[1].rsplit('\nPY\n', 1)[0]
                compile(python, '<synthetic-production-payload>', 'exec')
                injection = ("module['PARENT'] = module['Path'](" + repr(str(self.parent)) + ")\n" +
                             "module['TRUSTED_UID'] = " + str(os.geteuid()) + "\n")
                safe_fixture = text.replace('# REVIEWED_MODULE_READY', injection + '# REVIEWED_MODULE_READY')
                failure = self.run_payload(safe_fixture, False)
                self.assertIn('ANCESTOR_IDENTITY_CHANGED' if name == 'create' else 'FileNotFoundError', failure)
                self.assertFalse(self.parent.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
