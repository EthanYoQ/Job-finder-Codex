#!/usr/bin/python3
"""Private fixture workers. No network, database, production paths or real tools."""
import fcntl
import json
import os
from pathlib import Path
import sys

# -I removes the script directory from sys.path. Add this fixed trusted module
# directory, never a location inside the replaceable target.
sys.path.insert(0, str(Path(__file__).absolute().parent))
from lifecycle_test_support import (Domain, Hold, OwnedRoundJournal, OrderedLocks,
                            check_complete_disabled, require_mutation_idle)


def emit(value):
    print(json.dumps(value, sort_keys=True), flush=True)


def main():
    domain = Domain.from_json(sys.argv[1])
    operation = sys.argv[2]
    if operation in ("hold-sh", "hold-ex", "exec-sh", "fork-sh"):
        mode = "EX" if operation == "hold-ex" else "SH"
        with domain.acquire(mode, blocking=True) as lease:
            if operation == "exec-sh":
                fd = lease.prepare_exec()
                code = ("import json,os,sys; fd=int(sys.argv[1]); "
                        "os.fstat(fd); print(json.dumps({'event':'EXEC_READY',"
                        "'pid':os.getpid(),'fd':fd}),flush=True); "
                        "sys.stdin.readline(); os.close(fd)")
                os.execv(sys.executable, [sys.executable, "-I", "-c", code, str(fd)])
            if operation == "fork-sh":
                fd = lease.prepare_exec()
                pid = os.fork()
                if pid == 0:
                    os.close(lease.parent_fd)
                    emit({"event": "CHILD_READY", "pid": os.getpid()})
                    sys.stdin.readline()
                    os.close(fd)
                    os._exit(0)
                lease.close()  # Must NOT LOCK_UN the child's inherited lease.
                emit({"event": "PARENT_CLOSED", "pid": os.getpid()})
                _, status = os.waitpid(pid, 0)
                return os.waitstatus_to_exitcode(status)
            emit({"event": "ACQUIRED", "mode": mode, "pid": os.getpid()})
            sys.stdin.readline()
            lease.check()
        emit({"event": "RELEASED"})
    elif operation == "try-ex":
        with domain.acquire("EX"):
            emit({"event": "ACQUIRED", "mode": "EX"})
    elif operation == "journal-sh":
        with domain.acquire("SH") as lease:
            journal = OwnedRoundJournal(lease)
            emit({"event": "JOURNAL_ACTIVE", "pid": os.getpid()})
            line = sys.stdin.readline()
            if line.strip() == "complete":
                journal.finish_from_owned_holder()
                emit({"event": "JOURNAL_COMPLETE"})
            else:
                journal.abandon()
    elif operation == "mutation-check":
        with domain.acquire("EX") as lease:
            require_mutation_idle(lease)
            emit({"event": "IDLE", "activation": False})
    elif operation == "ordered":
        with OrderedLocks(domain, "SH", blocking=True) as locks:
            def inner(name):
                fd = os.open(domain.parent / (name + ".fixture-lock"),
                             os.O_RDWR | os.O_NOFOLLOW)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX)
                    return fd
                except BaseException:
                    os.close(fd)
                    raise
            for name in ("install", "allocation", "execution"):
                locks.take(name, lambda name=name: inner(name))
            emit({"event": "ORDERED_READY", "pid": os.getpid()})
            sys.stdin.readline()
    elif operation == "read-complete":
        with domain.acquire("SH", blocking=True) as lease:
            emit(check_complete_disabled(lease))
    elif operation == "gated-exec":
        # This stable entry obtains SH before even enumerating candidate files.
        # The fixture has no enabled production entry; the probe records exec.
        with domain.acquire("SH", blocking=True) as lease:
            check_complete_disabled(lease)
            fd = lease.prepare_exec()
            env = {"PATH": "/usr/bin:/bin", "OFFLINE_LIFECYCLE_FD": str(fd)}
            os.execve(sys.executable, [sys.executable, "-I",
                                      str(domain.target / "probe.py")], env)
    else:
        raise Hold("PROBE_OPERATION")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Hold, OSError, ValueError) as error:
        emit({"event": "HOLD", "reason": str(error),
              "activation": False, "productionQualified": False})
        sys.exit(78)
