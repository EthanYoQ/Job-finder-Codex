"""Cooperative Linux lifecycle flock, no deployment or publication authority.

The unrendered module is unbound. Rendered policy permits either private TEST_ONLY
cases or the exact fixed deployment domain, with no runtime override. The stable parent and lock inode are pinned outside the replaceable
target. The installer alone provisions once; acquisition NEVER creates a lock.
This is not a defense against malicious same-UID processes or kernel attackers.
"""
from __future__ import annotations

from dataclasses import dataclass
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid


SCOPE = __FIXED_LIFECYCLE_SCOPE__
LIVE_NAME = "job-finder-fixed-live-controller-v1"


class Hold(RuntimeError):
    """Fail closed without reading or executing target contents."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise Hold(code)


def identity(value: os.stat_result) -> tuple[int, int]:
    return value.st_dev, value.st_ino


def _parent_scope(parent: Path, target_name: str) -> None:
    # Check lexical scope before filesystem access, including rejected LIVE.
    require(sys.platform == "linux" and os.getuid() > 0, "PLATFORM")
    require(parent.is_absolute() and ".." not in parent.parts, "ABSOLUTE_PARENT")
    require(type(SCOPE) is dict, "UNBOUND_LIFECYCLE_SCOPE")
    if SCOPE.get("kind") == "TEST_ONLY":
        require(LIVE_NAME not in parent.parts and target_name != LIVE_NAME, "LIVE_FORBIDDEN")
        require(parent.parent == Path(SCOPE["casesRoot"]) and parent.name.startswith("case-"), "OFFLINE_SCOPE_ONLY")
    else:
        require(SCOPE == {"kind":"FIXED_PRODUCTION_SOURCE", "parent":"/workspace/scratch/5e9614251709", "target":LIVE_NAME}, "FIXED_SCOPE_BINDING")
        require(parent == Path(SCOPE["parent"]) and target_name == SCOPE["target"], "FIXED_DOMAIN_ONLY")
        owner=parent/("."+target_name+".lifecycle-owner")
        st=owner.lstat()
        require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700, "FIXED_OWNER_DIRECTORY")
    require(re.fullmatch(r"[a-z][a-z0-9-]{0,63}", target_name) is not None,
            "TARGET_NAME")
    for directory in (parent, *parent.parents):
        entry = directory.lstat()
        require(stat.S_ISDIR(entry.st_mode) and not stat.S_ISLNK(entry.st_mode),
                "PARENT_LINK_OR_TYPE")
        require(entry.st_uid in (0, os.getuid()) and not entry.st_mode & 0o022,
                "UNSAFE_ANCESTOR")
    entry = parent.lstat()
    require(entry.st_uid == os.getuid() and (stat.S_IMODE(entry.st_mode) == 0o700 if SCOPE["kind"]=="TEST_ONLY" else not entry.st_mode&0o022), "PRIVATE_PARENT_REQUIRED")


def _valid_lock(value: os.stat_result) -> None:
    require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid()
            and stat.S_IMODE(value.st_mode) == 0o600
            and value.st_nlink == 1 and value.st_size == 0,
            "LOCK_METADATA")


@dataclass(frozen=True)
class Domain:
    parent: Path
    target_name: str
    parent_identity: tuple[int, int]
    lock_identity: tuple[int, int]

    @property
    def lock_name(self) -> str:
        return "." + self.target_name + ".lifecycle.lock"

    @property
    def target(self) -> Path:
        return self.parent / self.target_name

    @property
    def active_name(self) -> str:
        return "." + self.target_name + ".lifecycle-active.json"

    @property
    def mutation_name(self) -> str:
        return "." + self.target_name + ".lifecycle-mutation-active.json"

    def to_json(self) -> str:
        # Test transport only. These bytes are a pin, never a launch permit.
        return json.dumps({"parent": str(self.parent), "target": self.target_name,
                           "parentIdentity": self.parent_identity,
                           "lockIdentity": self.lock_identity}, sort_keys=True)

    @classmethod
    def from_json(cls, raw: str) -> Domain:
        value = json.loads(raw)
        require(type(value) is dict and set(value) == {
            "parent", "target", "parentIdentity", "lockIdentity"}, "DOMAIN_KEYS")
        for field in ("parentIdentity", "lockIdentity"):
            require(type(value[field]) is list and len(value[field]) == 2
                    and all(type(n) is int and n >= 0 for n in value[field]),
                    "DOMAIN_IDENTITY")
        require(type(value["parent"]) is str and type(value["target"]) is str,
                "DOMAIN_PATH")
        return cls(Path(value["parent"]), value["target"],
                   tuple(value["parentIdentity"]), tuple(value["lockIdentity"]))

    def _open_parent(self) -> int:
        _parent_scope(self.parent, self.target_name)
        fd = os.open(self.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                     | os.O_CLOEXEC)
        try:
            require(identity(os.fstat(fd)) == self.parent_identity
                    == identity(self.parent.lstat()), "PARENT_INODE_CHANGED")
            return fd
        except BaseException:
            os.close(fd)
            raise

    def acquire(self, mode: str, *, blocking: bool = False) -> Lease:
        lease=self._acquire_lock(mode,blocking=blocking)
        try:
            require_no_mutation(lease)
            return lease
        except BaseException:
            lease.close()
            raise

    def _acquire_lock(self, mode: str, *, blocking: bool = False) -> Lease:
        """Get SH/EX; readers and activation never create a missing lock."""
        require(mode in ("SH", "EX"), "LOCK_MODE")
        parent_fd = self._open_parent()
        fd = None
        try:
            before = os.stat(self.lock_name, dir_fd=parent_fd,
                             follow_symlinks=False)
            _valid_lock(before)
            require(identity(before) == self.lock_identity, "LOCK_INODE_CHANGED")
            fd = os.open(self.lock_name, os.O_RDWR | os.O_NOFOLLOW
                         | os.O_CLOEXEC | os.O_NONBLOCK, dir_fd=parent_fd)
            _valid_lock(os.fstat(fd))
            require(identity(os.fstat(fd)) == self.lock_identity,
                    "LOCK_INODE_CHANGED")
            operation = fcntl.LOCK_SH if mode == "SH" else fcntl.LOCK_EX
            try:
                fcntl.flock(fd, operation | (0 if blocking else fcntl.LOCK_NB))
            except BlockingIOError as error:
                raise Hold("LIFECYCLE_BUSY") from error
            lease = Lease(self, mode, parent_fd, fd)
            lease.check()  # Reject unlink/replacement while a caller was waiting.
            return lease
        except BaseException:
            if fd is not None:
                os.close(fd)
            os.close(parent_fd)
            raise



def provision_for_installer(parent: Path, target_name: str) -> Domain:
    """Explicit first-install operation, not called by runtime/activation.

    O_EXCL provisions once. Existing/missing previously pinned locks MUST NOT be
    re-created or re-bound. A trusted installer owns this operation by protocol;
    the function name and inode pins do not authenticate same-UID callers.
    """
    _parent_scope(parent, target_name)
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                        | os.O_CLOEXEC)
    fd = None
    try:
        parent_id = identity(os.fstat(parent_fd))
        require(parent_id == identity(parent.lstat()), "PARENT_INODE_CHANGED")
        name = "." + target_name + ".lifecycle.lock"
        fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                     | os.O_CLOEXEC, 0o600, dir_fd=parent_fd)
        # No unlink-on-error: an uncertain provisioning leaves a HOLD for review.
        _valid_lock(os.fstat(fd))
        domain = Domain(parent, target_name, parent_id, identity(os.fstat(fd)))
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        lease = Lease(domain, "EX", parent_fd, fd)
        lease.check()
        os.fsync(fd)
        os.fsync(parent_fd)
        return domain
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent_fd)


class Lease:
    def __init__(self, domain: Domain, mode: str, parent_fd: int, fd: int):
        self.domain, self.mode = domain, mode
        self.parent_fd, self.fd = parent_fd, fd
        self.closed = False

    def check(self) -> None:
        require(not self.closed, "LEASE_CLOSED")
        _parent_scope(self.domain.parent, self.domain.target_name)
        require(identity(self.domain.parent.lstat()) == self.domain.parent_identity
                == identity(os.fstat(self.parent_fd)), "PARENT_INODE_CHANGED")
        at = os.stat(self.domain.lock_name, dir_fd=self.parent_fd,
                     follow_symlinks=False)
        opened = os.fstat(self.fd)
        _valid_lock(at)
        _valid_lock(opened)
        require(identity(at) == identity(opened) == self.domain.lock_identity,
                "LOCK_INODE_CHANGED")

    def finish_mutation_from_owned_transaction(self) -> None:
        require(hasattr(self,"_mutation_journal"), "OWNED_MUTATION_REQUIRED")
        self._mutation_journal.finish_from_owned_holder()

    def prepare_exec(self) -> int:
        self.check()
        os.set_inheritable(self.fd, True)
        return self.fd

    def close(self) -> None:
        if not self.closed:
            # DO NOT LOCK_UN: inherited copies share one open-file description.
            # close releases only this reference; surviving descendants retain it.
            os.close(self.fd)
            os.close(self.parent_fd)
            self.closed = True

    def __enter__(self) -> Lease:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class OrderedLocks:
    """Wrap existing lock callbacks without changing their locking semantics.

    One acquisition order: lifecycle -> install -> allocation -> execution.
    Re-entry/upgrades/reverse acquisition are rejected BEFORE the callback.
    Release is in reverse order. Callers keep the original inner-lock ownership.
    """
    RANK = {"lifecycle": 0, "install": 1, "allocation": 2, "execution": 3}

    def __init__(self, domain: Domain, mode: str, *, blocking: bool = False):
        self.lease = domain.acquire(mode, blocking=blocking)
        self._held = [("lifecycle", self.lease, lambda value: value.close())]

    def take(self, name, acquire, release=os.close):
        require(bool(self._held) and name in self.RANK, "LOCK_ORDER_CLOSED_OR_NAME")
        require(self.RANK[name] > self.RANK[self._held[-1][0]], "LOCK_ORDER")
        value = acquire()
        self._held.append((name, value, release))
        return value

    def close(self):
        while self._held:
            _, value, release = self._held.pop()
            release(value)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def require_no_mutation(lease: Lease) -> None:
    lease.check()
    try:
        os.stat(lease.domain.mutation_name,dir_fd=lease.parent_fd,follow_symlinks=False)
    except FileNotFoundError:
        return
    raise Hold("ACTIVE_OR_UNKNOWN_MUTATION")


def require_mutation_idle(lease: Lease) -> None:
    """EX alone is insufficient after a holder crash: any marker means HOLD.

    Never use PID disappearance, timestamps, parsed status, or a stale timeout
    to clear a marker. Partial, malformed, linked and unknown markers all block.
    """
    require(lease.mode == "EX", "EX_REQUIRED")
    lease.check()
    try:
        os.stat(lease.domain.active_name, dir_fd=lease.parent_fd,
                follow_symlinks=False)
    except FileNotFoundError:
        return
    raise Hold("ACTIVE_OR_UNKNOWN_ROUND")


@contextmanager
def exclusive_transaction(domain: Domain):
    """The entire installer/activation transaction MUST execute inside this block.

    This yields a held fd, never a reusable permission after the block returns.
    All candidate reads, writes, fsync and final verification remain in scope.
    """
    with domain.acquire("EX") as lease:
        require_mutation_idle(lease)
        journal=OwnedMutationJournal(lease)
        lease._mutation_journal=journal
        try:
            yield lease
            lease.check()
        finally:
            journal.abandon()


def read_reconciliation_diagnostic(domain: Domain) -> dict:
    """Read-only lifecycle state; never clears UNKNOWN or restores authority."""
    with domain._acquire_lock("SH") as lease:
        found=[]
        for name,kind in ((domain.active_name,"ROUND"),(domain.mutation_name,"MUTATION")):
            try: entry=os.stat(name,dir_fd=lease.parent_fd,follow_symlinks=False)
            except FileNotFoundError: continue
            found.append({"kind":kind,"bytes":entry.st_size,"regularFile":stat.S_ISREG(entry.st_mode)})
        return {"state":"ACTIVE_OR_UNKNOWN" if found else "NO_ACTIVE_MARKER", "markers":found,
                "grantsAuthority":False,"cleared":False,"databaseReconciled":False}


class OwnedRoundJournal:
    """Per-round death fencing; completion is called only by the owned holder.

    Begin before reading ANY enabled JS bytes while the original SH is held.
    A crash at any later point leaves ACTIVE. Completion must use the original functions closure's actual
    terminal/Promise evidence and that same owned holder, not JSON or booleans.
    """
    MODE="SH"
    KIND="ROUND"
    def journal_name(self): return self.lease.domain.active_name

    def __init__(self, lease: Lease):
        require(lease.mode == self.MODE, "JOURNAL_LOCK_MODE")
        lease.check()
        self.lease = lease
        self.closed = False
        self.round_id = uuid.uuid4().hex
        self.raw = json.dumps({"schemaVersion": 1, "state": "ACTIVE", "kind":self.KIND,
                               "roundId": self.round_id},
                              sort_keys=True).encode() + b"\n"
        self.fd = os.open(self.journal_name(), os.O_RDWR | os.O_CREAT
                          | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                          0o600, dir_fd=lease.parent_fd)
        self.file_identity = identity(os.fstat(self.fd))
        try:
            with os.fdopen(os.dup(self.fd), "wb") as stream:
                stream.write(self.raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.fsync(lease.parent_fd)
            lease.check()
        except BaseException:
            os.close(self.fd)
            self.closed = True
            # Preserve even partial ACTIVE. Uncertain begin cannot enable writes.
            raise

    def finish_from_owned_holder(self) -> None:
        require(not self.closed, "JOURNAL_CLOSED")
        self.lease.check()
        require(self.lease.mode == self.MODE, "JOURNAL_LOCK_MODE")
        domain = self.lease.domain
        at = os.stat(self.journal_name(), dir_fd=self.lease.parent_fd,
                     follow_symlinks=False)
        current = os.fstat(self.fd)
        require(identity(at) == identity(current) == self.file_identity
                and stat.S_ISREG(at.st_mode) and at.st_nlink == 1
                and at.st_uid == os.getuid() and stat.S_IMODE(at.st_mode) == 0o600
                and at.st_size == len(self.raw), "JOURNAL_CHANGED")
        require(os.pread(self.fd, len(self.raw) + 1, 0) == self.raw,
                "JOURNAL_BYTES_CHANGED")
        # Append-only fixture completion precedes unlink; any uncertain interval
        # leaves ACTIVE and holds mutation. This does not authorize production.
        name = "." + domain.target_name + ".lifecycle-"+self.KIND.lower()+"-complete-" + self.round_id
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
                     | os.O_CLOEXEC, 0o600, dir_fd=self.lease.parent_fd)
        try:
            os.write(fd, b"ORIGINAL OWNED HOLDER TERMINAL; NO DB OR PUBLICATION AUTHORITY\n")
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(self.lease.parent_fd)
        self.lease.check()
        require(identity(os.stat(self.journal_name(), dir_fd=self.lease.parent_fd,
                                 follow_symlinks=False)) == self.file_identity,
                "JOURNAL_CHANGED")
        os.unlink(self.journal_name(), dir_fd=self.lease.parent_fd)
        os.fsync(self.lease.parent_fd)
        os.close(self.fd)
        self.closed = True

    def abandon(self) -> None:
        # Close only the local fd; absence of a process never clears ACTIVE.
        if not self.closed:
            os.close(self.fd)
            self.closed = True


class OwnedMutationJournal(OwnedRoundJournal):
    MODE="EX"
    KIND="MUTATION"
    def journal_name(self): return self.lease.domain.mutation_name


def check_complete_disabled(lease: Lease) -> dict:
    """Offline gate fixture. No transition to enabled exists in this module.

    Production MUST retain its own full closed-set/build/DB/reader checks.
    This fixture proves only ordering, completeness rejection, and DISABLED.
    """
    lease.check()
    target = lease.domain.target
    target_fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
                        | os.O_CLOEXEC)
    fd = None
    try:
        opened = os.fstat(target_fd)
        require(identity(opened) == identity(target.lstat())
                and opened.st_uid == os.getuid()
                and stat.S_IMODE(opened.st_mode) == 0o700, "TARGET_METADATA")
        names = set(os.listdir(target_fd))
        require("install-incomplete" not in names, "INSTALL_INCOMPLETE")
        require(names == {"state.json", "probe.py"}, "TARGET_PARTIAL_OR_EXTRA")
        fd = os.open("state.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
                     | os.O_NONBLOCK, dir_fd=target_fd)
        st = os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid()
                and st.st_nlink == 1 and stat.S_IMODE(st.st_mode) == 0o600
                and st.st_size <= 1024, "STATE_METADATA")
        raw = os.read(fd, 1025)
        require(raw == b'{"schemaVersion":1,"state":"INSTALLED_DISABLED"}\n',
                "NOT_COMPLETE_DISABLED")
        lease.check()
        return {"state": "INSTALLED_DISABLED", "activation": False,
                "productionQualified": False}
    finally:
        if fd is not None:
            os.close(fd)
        os.close(target_fd)
