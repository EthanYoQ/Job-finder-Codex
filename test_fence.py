#!/usr/bin/env python3
"""Real subprocess races; SIGSTOP/SIGCONT barriers, no mocked mkdir/open.

The only old-code changes are a single fixed path substitution and a trace hook.
All filesystem changes are inside a new temporary fixture under this review dir.
"""
import ast
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
D = HERE.parent
SPEC = importlib.util.spec_from_file_location('candidate', HERE / 'fence_candidate.py')
F = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(F)
PINNED = D / 'transfer-bootstrap/upload-000.sh'
RAW = PINNED.read_bytes()
if hashlib.sha256(RAW).hexdigest() != F.OLD_SHA:
    raise RuntimeError('OLD_SCRIPT_HASH_DRIFT')
BODY = RAW.decode().split("python3 - <<'PY'\n", 1)[1].rsplit('\nPY\n', 1)[0]
TREE = ast.parse(BODY)
PAYLOAD = base64.b64decode(next(n.value.args[0].value for n in TREE.body
                              if isinstance(n, ast.Assign) and
                              isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'b'))
assert hashlib.sha256(PAYLOAD).hexdigest() == F.PART_SHA
NONCE = '11111111111111111111111111111111'
OLD_PATH = '/opt/jobfinder-paired/' + F.RELEASE


def fixture(parent):
    parent = Path(parent)
    if not parent.is_absolute() or not parent.is_relative_to(HERE):
        raise RuntimeError('NON_FIXTURE_PATH')
    F.PARENT = parent
    F.TRUSTED_UID = os.geteuid()


def trace_at(filename, line):
    fired = False
    def tracer(frame, event, arg):
        nonlocal fired
        if not fired and event == 'line' and frame.f_code.co_filename == filename and frame.f_lineno == line:
            fired = True
            os.write(2, b'BARRIER_READY\n')
            os.kill(os.getpid(), signal.SIGSTOP)
        return tracer
    sys.settrace(tracer)


def child(op, request):
    fixture(request['parent'])
    pause = request.get('pause')
    if op == 'old':
        assert BODY.count(OLD_PATH) == 1
        code = BODY.replace(OLD_PATH, str(F.PARENT / F.RELEASE))
        if pause:
            old_lines = {'before_parent': 4, 'before_assert': 5, 'before_mkdir': 6,
                         'after_mkdir': 7, 'before_decode': 8, 'before_hash': 9,
                         'before_file': 10, 'before_write': 11, 'after_write': 12}
            trace_at('pinned_old.py', old_lines[pause])
        exec(compile(code, 'pinned_old.py', 'exec'), {'__name__': '__main__'})
        return
    if pause:
        lines = Path(F.__file__).read_text().splitlines()
        matches = [i for i, value in enumerate(lines, 1) if '# ' + pause in value]
        assert len(matches) == 1
        trace_at(F.__file__, matches[0])
    try:
        if op == 'fence':
            result = F.create_fence(request['snapshot'], NONCE)
        elif op == 'read':
            result = F.verify_fence(request['receipt'])
        elif op == 'part':
            data = PAYLOAD if not request.get('bad_data') else b'wrong'
            result = F.complete_part000(request['receipt'], data)
        else:
            raise RuntimeError('BAD_CHILD_OPERATION')
        print(json.dumps(result), flush=True)
    except Exception as exc:
        print(json.dumps({'error': str(exc), 'type': type(exc).__name__}), flush=True)
        sys.exit(3)


class FenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='fixture-', dir=HERE)
        self.root = Path(self.tmp.name)
        self.parent = self.root / 'paired'
        self.parent.mkdir(mode=0o700)
        fixture(self.parent)
        self.snapshot = F.parent_snapshot()
        self.procs = []
        self.target = self.parent / F.RELEASE

    def tearDown(self):
        for proc in self.procs:
            if proc.poll() is None:
                proc.kill()
            proc.communicate(timeout=5)
        self.tmp.cleanup()

    def start(self, op, pause=None, **extra):
        request = {'parent': str(self.parent), 'snapshot': self.snapshot, **extra}
        if pause:
            request['pause'] = pause
        proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
                                 '--child', op, json.dumps(request)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.procs.append(proc)
        if pause:
            with selectors.DefaultSelector() as sel:
                sel.register(proc.stderr, selectors.EVENT_READ)
                self.assertTrue(sel.select(5), 'child did not reach barrier')
                self.assertEqual(proc.stderr.readline(), b'BARRIER_READY\n')
            pid, status = os.waitpid(proc.pid, os.WUNTRACED)
            self.assertEqual(pid, proc.pid)
            self.assertTrue(os.WIFSTOPPED(status))
        return proc

    def result(self, proc, expected=None):
        out, err = proc.communicate(timeout=10)
        if expected is not None:
            self.assertEqual(proc.returncode, expected, (out, err))
        return json.loads(out) if out else None

    def run_op(self, op, expected=0, **extra):
        return self.result(self.start(op, **extra), expected)

    def resume(self, proc, expected=None):
        proc.send_signal(signal.SIGCONT)
        return self.result(proc, expected)

    def test_fence_wins_after_old_absence_assert(self):
        old = self.start('old', 'before_mkdir')
        receipt = self.run_op('fence')
        self.assertEqual(self.run_op('read', receipt=receipt)['state'], 'FENCE_VERIFIED')
        self.resume(old, 1)
        self.assertEqual(set(os.listdir(self.target)), {F.MARKER, F.HASH_FILE})

    def test_old_wins_after_fence_checks(self):
        fence = self.start('fence', 'PHASE_BEFORE_MKDIR')
        self.run_op('old')
        failure = self.resume(fence, 3)
        self.assertEqual(failure['type'], 'FileExistsError')
        self.assertEqual(set(os.listdir(self.target)), {'bootstrap.part000'})
        self.assertEqual(hashlib.sha256((self.target / 'bootstrap.part000').read_bytes()).hexdigest(), F.PART_SHA)

    def test_fence_blocks_twelve_late_old_requests(self):
        pending = [self.start('old', 'before_mkdir') for _ in range(12)]
        receipt = self.run_op('fence')
        for proc in pending:
            self.resume(proc, 1)
        self.run_op('read', receipt=receipt)

    def test_old_at_every_pre_mkdir_stage_is_blocked(self):
        pending = [self.start('old', phase) for phase in
                   ('before_parent', 'before_assert', 'before_mkdir')]
        receipt = self.run_op('fence')
        for proc in pending:
            self.resume(proc, 1)
        self.run_op('read', receipt=receipt)

    def test_old_after_mkdir_still_owns_directory(self):
        old = self.start('old', 'after_mkdir')
        self.run_op('fence', 3)
        self.assertEqual(os.listdir(self.target), [])
        self.resume(old, 0)
        self.assertEqual(set(os.listdir(self.target)), {'bootstrap.part000'})

    def test_existing_directory_is_never_adopted(self):
        self.target.mkdir(mode=0o700)
        self.run_op('fence', 3)
        self.assertEqual(os.listdir(self.target), [])

    def test_target_symlink_is_never_followed(self):
        other = self.root / 'other'
        other.mkdir()
        self.target.symlink_to(other, target_is_directory=True)
        self.run_op('fence', 3)
        self.assertEqual(os.listdir(other), [])

    def test_dangling_target_symlink_is_rejected(self):
        self.target.symlink_to(self.root / 'missing', target_is_directory=True)
        self.run_op('fence', 3)
        self.assertFalse((self.root / 'missing').exists())

    def test_target_regular_file_is_unchanged(self):
        self.target.write_bytes(b'existing')
        self.run_op('fence', 3)
        self.assertEqual(self.target.read_bytes(), b'existing')

    def test_missing_parent_is_not_created(self):
        self.parent.rmdir()
        self.run_op('fence', 3)
        self.assertFalse(self.parent.exists())

    def test_symlink_parent_is_rejected(self):
        other = self.root / 'other'
        self.parent.rename(other)
        self.parent.symlink_to(other, target_is_directory=True)
        self.run_op('fence', 3)
        self.assertEqual(os.listdir(other), [])

    def test_wrong_parent_inode_is_rejected(self):
        other = self.root / 'other'
        self.parent.rename(other)
        self.parent.mkdir(mode=0o700)
        self.run_op('fence', 3)
        self.assertEqual(os.listdir(self.parent), [])

    def test_writable_parent_is_rejected(self):
        self.parent.chmod(0o777)
        self.run_op('fence', 3)
        self.assertEqual(os.listdir(self.parent), [])

    def test_parent_replaced_at_mkdir_does_not_get_marker(self):
        fence = self.start('fence', 'PHASE_BEFORE_MKDIR')
        other = self.root / 'other'
        self.parent.rename(other)
        self.parent.mkdir(mode=0o700)
        self.resume(fence, 3)
        self.assertEqual(os.listdir(self.parent), [])
        self.assertEqual(os.listdir(other / F.RELEASE), [])

    def test_kill_after_mkdir_before_marker_stays_unknown(self):
        fence = self.start('fence', 'PHASE_AFTER_MKDIR')
        fence.kill()
        self.result(fence, -signal.SIGKILL)
        self.assertEqual(os.listdir(self.target), [])
        self.run_op('fence', 3)
        self.run_op('old', 1)
        failure = self.run_op('read', 3, receipt={'state': 'UNKNOWN'})
        self.assertEqual(failure['error'], 'NO_SUCCESS_RECEIPT')
        self.assertEqual(os.listdir(self.target), [])

    def test_kill_after_marker_before_hash_stays_unknown(self):
        fence = self.start('fence', 'PHASE_BEFORE_HASH')
        fence.kill()
        self.result(fence, -signal.SIGKILL)
        self.assertEqual(set(os.listdir(self.target)), {F.MARKER})
        self.run_op('fence', 3)
        self.run_op('read', 3, receipt={'state': 'UNKNOWN'})

    def test_kill_after_marker_open_leaves_empty_marker_unknown(self):
        fence = self.start('fence', 'PHASE_AFTER_EXCLUSIVE_OPEN')
        fence.kill()
        self.result(fence, -signal.SIGKILL)
        self.assertEqual((self.target / F.MARKER).read_bytes(), b'')
        self.run_op('fence', 3)
        self.run_op('read', 3, receipt={'state': 'UNKNOWN'})

    def test_kill_after_part_open_never_overwrites_partial_part(self):
        receipt = self.run_op('fence')
        part = self.start('part', 'PHASE_AFTER_EXCLUSIVE_OPEN', receipt=receipt)
        part.kill()
        self.result(part, -signal.SIGKILL)
        self.assertEqual((self.target / 'bootstrap.part000').read_bytes(), b'')
        self.run_op('part', 3, receipt=receipt)
        self.assertEqual((self.target / 'bootstrap.part000').read_bytes(), b'')

    def test_lost_success_receipt_is_not_adopted(self):
        fence = self.start('fence', 'PHASE_BEFORE_RECEIPT')
        fence.kill()
        self.result(fence, -signal.SIGKILL)
        self.assertEqual(set(os.listdir(self.target)), {F.MARKER, F.HASH_FILE})
        self.run_op('read', 3, receipt={'state': 'UNKNOWN'})
        self.run_op('fence', 3)

    def test_parent_replacement_invalidates_proof_counterexample(self):
        old = self.start('old', 'before_mkdir')
        receipt = self.run_op('fence')
        self.run_op('read', receipt=receipt)
        other = self.root / 'displaced'
        self.parent.rename(other)
        self.parent.mkdir(mode=0o700)
        self.resume(old, 0)  # Real counterexample: old now writes in a new parent.
        self.assertTrue((self.target / 'bootstrap.part000').is_file())
        self.run_op('read', 3, receipt=receipt)
        self.assertEqual(set(os.listdir(other / F.RELEASE)), {F.MARKER, F.HASH_FILE})

    def test_target_removal_invalidates_proof_counterexample(self):
        old = self.start('old', 'before_mkdir')
        receipt = self.run_op('fence')
        self.target.rename(self.parent / 'displaced-release')
        self.resume(old, 0)
        self.run_op('read', 3, receipt=receipt)

    def test_independent_readback_rejects_corruption(self):
        receipt = self.run_op('fence')
        (self.target / F.MARKER).write_bytes(b'{}\n')
        self.run_op('read', 3, receipt=receipt)

    def test_fixed_part_hash_and_exclusive_write(self):
        receipt = self.run_op('fence')
        self.run_op('part', 3, receipt=receipt, bad_data=True)
        self.assertFalse((self.target / 'bootstrap.part000').exists())
        self.run_op('read', receipt=receipt)
        pending = [self.start('old', 'before_parent') for _ in range(3)]
        result = self.run_op('part', receipt=receipt)
        self.assertEqual(result['sha256'], F.PART_SHA)
        for proc in pending:
            self.resume(proc, 1)
        first = (self.target / 'bootstrap.part000').read_bytes()
        self.run_op('part', 3, receipt=receipt)
        self.assertEqual((self.target / 'bootstrap.part000').read_bytes(), first)

    def test_concurrent_part_completers_only_one_wins(self):
        receipt = self.run_op('fence')
        workers = [self.start('part', 'PHASE_BEFORE_PART', receipt=receipt) for _ in range(4)]
        for proc in workers:
            proc.send_signal(signal.SIGCONT)
        results = [self.result(proc) for proc in workers]
        self.assertEqual(sum(p.returncode == 0 for p in workers), 1, results)
        self.assertEqual(sum(p.returncode == 3 for p in workers), 3, results)

    def test_simultaneous_mkdir_has_exactly_one_winner(self):
        old = self.start('old', 'before_mkdir')
        fence = self.start('fence', 'PHASE_BEFORE_MKDIR')
        old.send_signal(signal.SIGCONT)
        fence.send_signal(signal.SIGCONT)
        a = self.result(old)
        b = self.result(fence)
        self.assertEqual(sum(p.returncode == 0 for p in (old, fence)), 1, (a, b))
        entries = set(os.listdir(self.target))
        self.assertIn(entries, [{'bootstrap.part000'}, {F.MARKER, F.HASH_FILE}])


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--child':
        child(sys.argv[2], json.loads(sys.argv[3]))
    else:
        unittest.main(verbosity=2)
