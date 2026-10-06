"""Offline review candidate. No CLI, transport, retries, cleanup, or adoption.

Production adaptation must pin source/payload and either an existing parent
chain or an existing ancestor chain plus an approved absent-parent plan.
No path replacement by a trusted/root actor is supported. See REVIEW_R4.md.
"""
import hashlib
import json
import os
import stat
from pathlib import Path

PARENT = Path('/opt/jobfinder-paired')
RELEASE = 'sanofi-pair-20261006T0057Z'
OLD_SHA = '83790ab0a9fcb5f91adab951be4a11649698d5db1f056923d048fcc686617fb7'
PART_SHA = 'd77df9b3f410bf08ee80fdf9cb1284dadfbfba4fe149c7c15b1a7b5fc65c8f3c'
TRUSTED_UID = 0
MARKER = 'BOOTSTRAP_FENCE.json'
HASH_FILE = 'BOOTSTRAP_FENCE.sha256'
DFLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def identity(st):
    return [st.st_dev, st.st_ino, st.st_uid, stat.S_IMODE(st.st_mode)]


def open_chain(path=None):
    """Read-only, no-follow open of the requested trusted chain."""
    path = PARENT if path is None else path
    require(path.is_absolute() and '..' not in path.parts, 'BAD_PARENT')
    fds = []
    try:
        fds.append(os.open('/', DFLAGS))
        for component in path.parts[1:]:
            fds.append(os.open(component, DFLAGS, dir_fd=fds[-1]))
        ids = [identity(os.fstat(fd)) for fd in fds]
        require(all(v[2] == TRUSTED_UID and not (v[3] & 0o022)
                    for v in ids), 'UNTRUSTED_PARENT_CHAIN')
        return fds, ids
    except BaseException:
        for fd in reversed(fds):
            os.close(fd)
        raise


def parent_snapshot():
    """Read-only result must be approved/pinned before the write operation."""
    fds, ids = open_chain()
    for fd in reversed(fds):
        os.close(fd)
    return ids


def check_chain(expected, target_id=None, path=None):
    fds, ids = open_chain(path)
    try:
        require(ids == expected, 'PARENT_IDENTITY_CHANGED')
        if target_id is not None:
            fd = os.open(RELEASE, DFLAGS, dir_fd=fds[-1])
            try:
                require(identity(os.fstat(fd)) == target_id,
                        'TARGET_IDENTITY_CHANGED')
            finally:
                os.close(fd)
    finally:
        for fd in reversed(fds):
            os.close(fd)


def exclusive_write(dfd, name, data):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                 os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=dfd)
    with os.fdopen(fd, 'wb') as stream:  # PHASE_AFTER_EXCLUSIVE_OPEN
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def read_file(dfd, name):
    fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dfd)
    with os.fdopen(fd, 'rb') as stream:
        st = os.fstat(stream.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and
                st.st_uid == TRUSTED_UID and stat.S_IMODE(st.st_mode) == 0o600
                and st.st_size <= 16384, 'BAD_FILE')
        return stream.read()


def prepare_parent(expected_chain, expected_ancestor_chain):
    """Existing parent is pinned; absent parent must be created by this call.

    EEXIST is never adopted, even for an empty trusted-looking directory.
    A failed or interrupted call leaves any new directories untouched.
    """
    if expected_chain is not None:
        require(expected_ancestor_chain is None, 'AMBIGUOUS_PARENT_PLAN')
        fds, ids = open_chain()
        try:
            require(ids == expected_chain, 'PARENT_IDENTITY_CHANGED')
            return fds, ids, False
        except BaseException:
            for fd in reversed(fds):
                os.close(fd)
            raise
    require(isinstance(expected_ancestor_chain, list) and expected_ancestor_chain,
            'ANCESTOR_SNAPSHOT_NOT_PINNED')
    fds, ids = open_chain(PARENT.parent)
    try:
        require(ids == expected_ancestor_chain, 'ANCESTOR_IDENTITY_CHANGED')
        check_chain(expected_ancestor_chain, path=PARENT.parent)
        os.mkdir(PARENT.name, 0o700, dir_fd=fds[-1])  # PHASE_BEFORE_PARENT_MKDIR
        os.fsync(fds[-1])  # PHASE_AFTER_PARENT_MKDIR
        fds.append(os.open(PARENT.name, DFLAGS, dir_fd=fds[-1]))
        parent_id = identity(os.fstat(fds[-1]))
        require(parent_id[2:] == [TRUSTED_UID, 0o700], 'BAD_NEW_PARENT')
        ids = ids + [parent_id]
        check_chain(ids)
        return fds, ids, True
    except BaseException:
        for fd in reversed(fds):
            os.close(fd)
        raise


def create_fence(expected_chain, nonce, expected_ancestor_chain=None):
    require(len(nonce) == 32 and all(c in '0123456789abcdef' for c in nonce),
            'BAD_NONCE')
    require(os.geteuid() == TRUSTED_UID, 'BAD_UID')
    os.umask(0o077)
    fds, ids, parent_created = prepare_parent(expected_chain, expected_ancestor_chain)
    expected_chain = ids
    dfd = None
    try:
        check_chain(expected_chain)
        os.mkdir(RELEASE, 0o700, dir_fd=fds[-1])  # PHASE_BEFORE_MKDIR
        dfd = os.open(RELEASE, DFLAGS, dir_fd=fds[-1])  # PHASE_AFTER_MKDIR
        target_id = identity(os.fstat(dfd))
        require(target_id[2:] == [TRUSTED_UID, 0o700], 'BAD_TARGET')
        check_chain(expected_chain, target_id)
        require(os.listdir(dfd) == [], 'NEW_DIRECTORY_NOT_EMPTY')
        marker = {'version': 1, 'release': RELEASE, 'nonce': nonce,
                  'oldScriptSha256': OLD_SHA,
                  'fenceSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'parentChain': expected_chain, 'targetIdentity': target_id,
                  'parentCreated': parent_created}
        data = (json.dumps(marker, sort_keys=True, separators=(',', ':')) + '\n').encode()
        digest = hashlib.sha256(data).hexdigest()
        exclusive_write(dfd, MARKER, data)  # PHASE_BEFORE_MARKER
        exclusive_write(dfd, HASH_FILE, (digest + '\n').encode())  # PHASE_BEFORE_HASH
        os.fsync(dfd)
        os.fsync(fds[-1])
        check_chain(expected_chain, target_id)
        return {'state': 'FENCE_CREATED', 'markerSha256': digest,  # PHASE_BEFORE_RECEIPT
                'marker': marker}  # Caller must persist success; losing it is UNKNOWN.
    finally:
        if dfd is not None:
            os.close(dfd)
        for fd in reversed(fds):
            os.close(fd)


def verify_fence(receipt):
    """Run independently. A missing/unknown receipt is never adopted."""
    require(receipt.get('state') == 'FENCE_CREATED', 'NO_SUCCESS_RECEIPT')
    marker = receipt['marker']
    require(marker['release'] == RELEASE and marker['oldScriptSha256'] == OLD_SHA,
            'WRONG_RELEASE_OR_OLD_SCRIPT')
    require(marker['fenceSourceSha256'] == hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'FENCE_SOURCE_CHANGED')
    fds, ids = open_chain()
    dfd = None
    try:
        require(ids == marker['parentChain'], 'PARENT_IDENTITY_CHANGED')
        dfd = os.open(RELEASE, DFLAGS, dir_fd=fds[-1])
        require(identity(os.fstat(dfd)) == marker['targetIdentity'], 'TARGET_IDENTITY_CHANGED')
        require(set(os.listdir(dfd)) == {MARKER, HASH_FILE}, 'UNEXPECTED_CONTENT')
        data = read_file(dfd, MARKER)
        digest = hashlib.sha256(data).hexdigest()
        require(digest == receipt['markerSha256'] and
                read_file(dfd, HASH_FILE) == (digest + '\n').encode() and
                json.loads(data) == marker, 'MARKER_MISMATCH')
        check_chain(ids, marker['targetIdentity'])
        return {'state': 'FENCE_VERIFIED', 'markerSha256': digest,
                'targetIdentity': marker['targetIdentity']}
    finally:
        if dfd is not None:
            os.close(dfd)
        for fd in reversed(fds):
            os.close(fd)


def complete_part000(receipt, data):
    """Separately authorized operation; never call after any new UNKNOWN."""
    require(hashlib.sha256(data).hexdigest() == PART_SHA, 'PART_HASH_MISMATCH')
    verify_fence(receipt)
    marker = receipt['marker']
    fds, ids = open_chain()
    dfd = None
    try:
        require(ids == marker['parentChain'], 'PARENT_IDENTITY_CHANGED')
        dfd = os.open(RELEASE, DFLAGS, dir_fd=fds[-1])
        require(identity(os.fstat(dfd)) == marker['targetIdentity'], 'TARGET_IDENTITY_CHANGED')
        check_chain(ids, marker['targetIdentity'])
        exclusive_write(dfd, 'bootstrap.part000', data)  # PHASE_BEFORE_PART
        os.fsync(dfd)
        os.fsync(fds[-1])
        require(hashlib.sha256(read_file(dfd, 'bootstrap.part000')).hexdigest() == PART_SHA,
                'PART_READBACK_MISMATCH')
        check_chain(ids, marker['targetIdentity'])
        return {'state': 'PART_STORED', 'sha256': PART_SHA,
                'targetIdentity': marker['targetIdentity']}
    finally:
        if dfd is not None:
            os.close(dfd)
        for fd in reversed(fds):
            os.close(fd)
