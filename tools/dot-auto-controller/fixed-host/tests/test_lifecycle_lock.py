#!/usr/bin/python3
"""Real Linux process/flock tests; all writable paths are self-created cases."""
import contextlib
import dataclasses
import fcntl
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).absolute().parent
sys.path.insert(0, str(HERE))
from lifecycle_test_support import (CASES, Domain, Hold, OwnedRoundJournal, OrderedLocks,
                            check_complete_disabled, identity,
                            provision_for_installer, require_mutation_idle)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.case = Path(tempfile.mkdtemp(prefix="case-", dir=CASES))
        self.cleanup_paths = [self.case]
        self.children = []
        self.event_buffers = {}
        self.domain = provision_for_installer(self.case, "installed-disabled")

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            with contextlib.suppress(Exception):
                child.communicate(timeout=4)
            for stream in (child.stdin, child.stdout, child.stderr):
                if stream:
                    stream.close()
        for path in self.cleanup_paths:
            if path.exists():
                shutil.rmtree(path)

    def spawn(self, operation):
        child = subprocess.Popen(
            [sys.executable, "-I", str(HERE / "lifecycle-process-probe.py"),
             self.domain.to_json(), operation],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, env={"PATH": "/usr/bin:/bin"})
        self.children.append(child)
        return child

    def event(self, child, timeout=4):
        # Use raw fd reads: TextIOWrapper can prefetch two fork events, making
        # select() on the second event falsely time out despite buffered data.
        buffer=self.event_buffers.get(child.pid,b'')
        deadline=time.monotonic()+timeout
        while b'\n' not in buffer:
            ready=select.select([child.stdout],[],[],max(0,deadline-time.monotonic()))[0]
            self.assertTrue(ready,f"worker event timed out; pid={child.pid}")
            chunk=os.read(child.stdout.fileno(),65536)
            self.assertTrue(chunk,f"worker stopped; rc={child.poll()}")
            buffer+=chunk
        line,buffer=buffer.split(b'\n',1);self.event_buffers[child.pid]=buffer
        return json.loads(line)

    def no_event(self, child):
        self.assertFalse(self.event_buffers.get(child.pid,b""))
        self.assertFalse(select.select([child.stdout], [], [], 0.18)[0],
                         "blocked process unexpectedly emitted output")
        self.assertIsNone(child.poll())

    def release(self, child, text="release"):
        child.stdin.write(text + "\n")
        child.stdin.flush()

    def terminal(self, child, code=0):
        stdout, stderr = child.communicate(timeout=4)
        self.assertEqual(child.returncode, code, (stdout, stderr))
        return stdout, stderr

    def assert_busy(self):
        child = self.spawn("try-ex")
        self.assertEqual(self.event(child)["reason"], "LIFECYCLE_BUSY")
        self.terminal(child, 78)

    def write_state(self, *, complete=True, marker=False, enabled=False):
        target = self.domain.target
        target.mkdir(mode=0o700)
        if complete:
            state = b'{"schemaVersion":1,"state":"INSTALLED_DISABLED"}\n'
            if enabled:
                state = b'{"schemaVersion":1,"state":"ENABLED"}\n'
            (target / "state.json").write_bytes(state)
            (target / "state.json").chmod(0o600)
        probe = ("import json,os,sys\n"
                 "fd=int(os.environ['OFFLINE_LIFECYCLE_FD'])\n"
                 "os.fstat(fd)\n"
                 "print(json.dumps({'event':'CANDIDATE_EXECUTED',"
                 "'activation':False}),flush=True)\n"
                 "sys.stdin.readline()\n")
        (target / "probe.py").write_text(probe)
        (target / "probe.py").chmod(0o600)
        if marker:
            (target / "install-incomplete").write_bytes(b"INCOMPLETE\n")
            (target / "install-incomplete").chmod(0o600)

    def test_absent_target_can_be_exclusively_locked(self):
        self.assertFalse(self.domain.target.exists())
        with self.domain.acquire("EX") as lease:
            lease.check()
            require_mutation_idle(lease)
        self.assertFalse(self.domain.target.exists())

    def test_readers_and_activation_do_not_create_missing_lock(self):
        lock = self.case / self.domain.lock_name
        lock.unlink()
        before = set(self.case.iterdir())
        for mode in ("SH", "EX"):
            with self.assertRaises(FileNotFoundError):
                self.domain.acquire(mode)
        self.assertEqual(set(self.case.iterdir()), before)
        self.assertFalse(lock.exists())

    def test_provision_is_exclusive_and_never_rebinds_existing_lock(self):
        with self.assertRaises(FileExistsError):
            provision_for_installer(self.case, self.domain.target_name)

    def test_ex_blocks_sh_real_processes(self):
        writer = self.spawn("hold-ex")
        self.assertEqual(self.event(writer)["mode"], "EX")
        reader = self.spawn("hold-sh")
        self.no_event(reader)
        self.release(writer)
        self.assertEqual(self.event(reader)["mode"], "SH")
        self.release(reader)
        self.terminal(writer)
        self.terminal(reader)

    def test_sh_blocks_ex_real_processes(self):
        reader = self.spawn("hold-sh")
        self.assertEqual(self.event(reader)["mode"], "SH")
        writer = self.spawn("hold-ex")
        self.no_event(writer)
        self.release(reader)
        self.assertEqual(self.event(writer)["mode"], "EX")
        self.release(writer)
        self.terminal(reader)
        self.terminal(writer)

    def test_parallel_shared_processes(self):
        first = self.spawn("hold-sh")
        second = self.spawn("hold-sh")
        self.assertEqual(self.event(first)["mode"], "SH")
        self.assertEqual(self.event(second)["mode"], "SH")
        self.assert_busy()
        self.release(first)
        self.release(second)
        self.terminal(first)
        self.terminal(second)

    def test_exec_inherits_shared_lock_until_process_exit(self):
        child = self.spawn("exec-sh")
        event = self.event(child)
        self.assertEqual(event["event"], "EXEC_READY")
        self.assertEqual(event["pid"], child.pid)
        self.assert_busy()
        self.release(child)
        self.terminal(child)
        with self.domain.acquire("EX"):
            pass

    def test_parent_close_does_not_unlock_inherited_child(self):
        child = self.spawn("fork-sh")
        events = [self.event(child), self.event(child)]
        self.assertEqual({x["event"] for x in events},
                         {"PARENT_CLOSED", "CHILD_READY"})
        self.assert_busy()
        self.release(child)
        self.terminal(child)
        with self.domain.acquire("EX"):
            pass

    def test_sigkill_releases_kernel_lock(self):
        child = self.spawn("hold-sh")
        self.assertEqual(self.event(child)["event"], "ACQUIRED")
        self.assert_busy()
        child.kill()
        self.terminal(child, -signal.SIGKILL)
        with self.domain.acquire("EX"):
            pass

    def test_symlink_lock_is_rejected(self):
        lock = self.case / self.domain.lock_name
        lock.unlink()
        other = self.case / "other"
        other.touch(mode=0o600)
        lock.symlink_to(other.name)
        with self.assertRaisesRegex(Hold, "LOCK_METADATA"):
            self.domain.acquire("SH")

    def test_hardlinked_lock_is_rejected(self):
        os.link(self.case / self.domain.lock_name, self.case / "alias")
        with self.assertRaisesRegex(Hold, "LOCK_METADATA"):
            self.domain.acquire("SH")

    def test_inode_replacement_rejected_for_held_and_new_acquisition(self):
        with self.domain.acquire("SH") as lease:
            replacement = self.case / "replacement"
            replacement.touch(mode=0o600)
            os.replace(replacement, self.case / self.domain.lock_name)
            with self.assertRaisesRegex(Hold, "LOCK_INODE_CHANGED|LOCK_METADATA"):
                lease.check()
            with self.assertRaisesRegex(Hold, "LOCK_INODE_CHANGED"):
                self.domain.acquire("SH")

    def test_waiter_rejects_inode_replaced_during_block(self):
        writer = self.spawn("hold-ex")
        self.assertEqual(self.event(writer)["event"], "ACQUIRED")
        reader = self.spawn("hold-sh")
        self.no_event(reader)
        replacement = self.case / "replacement"
        replacement.touch(mode=0o600)
        os.replace(replacement, self.case / self.domain.lock_name)
        self.release(writer)
        event = self.event(reader)
        self.assertEqual(event["event"], "HOLD")
        self.assertIn(event["reason"], ("LOCK_INODE_CHANGED", "LOCK_METADATA"))
        self.terminal(writer, 78)
        self.terminal(reader, 78)

    def test_parent_inode_replacement_rejected(self):
        with self.domain.acquire("SH") as lease:
            moved = self.case.with_name(self.case.name + "-moved")
            self.case.rename(moved)
            self.cleanup_paths.append(moved)
            self.case.mkdir(mode=0o700)
            with self.assertRaisesRegex(Hold, "PARENT_INODE_CHANGED"):
                lease.check()

    def test_parent_symlink_rejected(self):
        moved = self.case.with_name(self.case.name + "-moved")
        self.case.rename(moved)
        self.cleanup_paths.append(moved)
        self.case.symlink_to(moved, target_is_directory=True)
        try:
            with self.assertRaisesRegex(Hold, "PARENT_LINK_OR_TYPE"):
                self.domain.acquire("SH")
        finally:
            self.case.unlink()

    def test_invalid_metadata_rejected(self):
        lock = self.case / self.domain.lock_name
        lock.chmod(0o644)
        with self.assertRaisesRegex(Hold, "LOCK_METADATA"):
            self.domain.acquire("SH")

    def test_live_path_rejected_before_filesystem_access(self):
        live = dataclasses.replace(self.domain,
            parent=Path('/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1'))
        with self.assertRaisesRegex(Hold, "LIVE_FORBIDDEN"):
            live.acquire("SH")
        with self.assertRaisesRegex(Hold, "LIVE_FORBIDDEN"):
            provision_for_installer(self.case, "job-finder-fixed-live-controller-v1")

    def test_partial_target_cannot_execute(self):
        self.write_state(complete=False)
        child = self.spawn("gated-exec")
        event = self.event(child)
        self.assertEqual(event["reason"], "TARGET_PARTIAL_OR_EXTRA")
        self.assertFalse(event["activation"])
        self.terminal(child, 78)

    def test_incomplete_marker_cannot_execute(self):
        self.write_state(marker=True)
        child = self.spawn("gated-exec")
        self.assertEqual(self.event(child)["reason"], "INSTALL_INCOMPLETE")
        self.terminal(child, 78)

    def test_enabled_fixture_state_is_rejected(self):
        self.write_state(enabled=True)
        child = self.spawn("gated-exec")
        self.assertEqual(self.event(child)["reason"], "NOT_COMPLETE_DISABLED")
        self.terminal(child, 78)

    def test_candidate_read_waits_until_installer_releases_ex(self):
        writer = self.spawn("hold-ex")
        self.assertEqual(self.event(writer)["event"], "ACQUIRED")
        self.write_state(marker=True)
        reader = self.spawn("gated-exec")
        self.no_event(reader)
        # Finish the synthetic disabled transaction while EX is still held.
        (self.domain.target / "install-incomplete").unlink()
        self.release(writer)
        self.assertEqual(self.event(reader)["event"], "CANDIDATE_EXECUTED")
        self.assert_busy()  # exec'ed candidate still holds the same SH.
        self.release(reader)
        self.terminal(writer)
        self.terminal(reader)

    def test_lock_order_reversal_rejected_before_callback(self):
        calls = []
        with OrderedLocks(self.domain, "SH") as locks:
            locks.take("execution", lambda: calls.append("execution"),
                       release=lambda _: None)
            for name in ("lifecycle", "install", "allocation", "execution"):
                with self.assertRaisesRegex(Hold, "LOCK_ORDER"):
                    locks.take(name, lambda: calls.append("BAD"),
                               release=lambda _: None)
        self.assertEqual(calls, ["execution"])

    def test_ordered_readers_and_writer_have_no_reverse_deadlock(self):
        for name in ("install", "allocation", "execution"):
            (self.case / (name + ".fixture-lock")).touch(mode=0o600)
        first = self.spawn("ordered")
        self.assertEqual(self.event(first)["event"], "ORDERED_READY")
        second = self.spawn("ordered")
        self.no_event(second)
        writer = self.spawn("hold-ex")
        self.no_event(writer)
        self.release(first)
        self.assertEqual(self.event(second)["event"], "ORDERED_READY")
        self.release(second)
        self.assertEqual(self.event(writer)["event"], "ACQUIRED")
        self.release(writer)
        for child in (first, second, writer):
            self.terminal(child)

    def test_no_adopt_api_can_downgrade_ex_via_shared_fd(self):
        self.assertFalse(hasattr(self.domain, "adopt_shared"))
        with self.domain.acquire("EX") as lease:
            lease.prepare_exec()
            child = self.spawn("hold-sh")
            self.no_event(child)
            child.kill()
            self.terminal(child, -signal.SIGKILL)
        # prepare_exec only flips CLOEXEC; it never invokes flock again.

    def test_holder_death_releases_os_lock_but_active_blocks_mutation(self):
        holder = self.spawn("journal-sh")
        self.assertEqual(self.event(holder)["event"], "JOURNAL_ACTIVE")
        holder.kill()
        self.terminal(holder, -signal.SIGKILL)
        with self.domain.acquire("EX") as lease:
            with self.assertRaisesRegex(Hold, "ACTIVE_OR_UNKNOWN_ROUND"):
                require_mutation_idle(lease)
        self.assertTrue((self.case / self.domain.active_name).exists())
        check = self.spawn("mutation-check")
        self.assertEqual(self.event(check)["reason"], "ACTIVE_OR_UNKNOWN_ROUND")
        self.terminal(check, 78)

    def test_partial_journal_blocks_mutation_without_parse_or_pid(self):
        (self.case / self.domain.active_name).write_bytes(b'{"pid":99999999')
        with self.domain.acquire("EX") as lease:
            with self.assertRaisesRegex(Hold, "ACTIVE_OR_UNKNOWN_ROUND"):
                require_mutation_idle(lease)

    def test_normal_fixture_completion_clears_active_under_same_sh(self):
        holder = self.spawn("journal-sh")
        self.assertEqual(self.event(holder)["event"], "JOURNAL_ACTIVE")
        self.assert_busy()
        self.release(holder, "complete")
        self.assertEqual(self.event(holder)["event"], "JOURNAL_COMPLETE")
        self.terminal(holder)
        self.assertFalse((self.case / self.domain.active_name).exists())
        self.assertEqual(len(list(self.case.glob("*.lifecycle-round-complete-*"))), 1)
        with self.domain.acquire("EX") as lease:
            require_mutation_idle(lease)

    def test_closed_lease_cannot_clear_active(self):
        lease = self.domain.acquire("SH")
        journal = OwnedRoundJournal(lease)
        lease.close()
        try:
            with self.assertRaisesRegex(Hold, "LEASE_CLOSED"):
                journal.finish_from_owned_holder()
            self.assertTrue((self.case / self.domain.active_name).exists())
        finally:
            journal.abandon()

    def test_replaced_journal_is_not_cleared(self):
        with self.domain.acquire("SH") as lease:
            journal = OwnedRoundJournal(lease)
            replacement = self.case / "replacement-active"
            replacement.write_bytes(journal.raw)
            replacement.chmod(0o600)
            os.replace(replacement, self.case / self.domain.active_name)
            try:
                with self.assertRaisesRegex(Hold, "JOURNAL_CHANGED"):
                    journal.finish_from_owned_holder()
                self.assertTrue((self.case / self.domain.active_name).exists())
            finally:
                journal.abandon()


class ReportResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.passed = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.passed.append(test.id())


if __name__ == "__main__":
    started = time.time()
    runner = unittest.TextTestRunner(verbosity=2, resultclass=ReportResult)
    result = runner.run(unittest.defaultTestLoader.loadTestsFromTestCase(LifecycleTests))
    report = {"scope": "OFFLINE_REAL_LINUX_PROCESSES_ONLY", "testsRun": result.testsRun,
              "passed": result.passed, "failures": [str(t) for t, _ in result.failures],
              "errors": [str(t) for t, _ in result.errors],
              "seconds": round(time.time() - started, 3),
              "productionIntegrated": False, "activation": False,
              "databaseOrNetworkCalls": 0, "originalFunctionsClosureTested": False}
    (CASES.parent / "lifecycle-core-results.json").write_text(json.dumps(report, indent=2) + "\n")
    sys.exit(0 if result.wasSuccessful() else 1)
