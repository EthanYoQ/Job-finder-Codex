#!/usr/bin/python3
"""Fixed reviewed Node launcher. No path/code/provider is selected by JSON or PATH."""
import hashlib, os, pathlib, re, stat, sys
HOST = pathlib.Path(__file__).absolute().parent
PRODUCER = HOST.parent.parent
REPO = PRODUCER.parents[3]
RUNTIME = REPO.parent / 'connector-host-runtime'
NODE = RUNTIME / 'node'
NODE_SHA = 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'

def fail(code):
    raise RuntimeError(code)

uid = os.getuid()
if sys.platform != 'linux' or uid <= 0 or os.getcwd() != str(PRODUCER):
    fail('HOST_LAUNCH_SCOPE')
selector = os.environ.get('JOBFINDER_CONNECTOR_HOST_SHA256', '')
if not re.fullmatch('[a-f0-9]{64}', selector):
    fail('HOST_CONFIG_REQUIRED')
allowed = {'host-files.mts': {'connector-validate', 'connector-read', 'connector-context', 'connector-publish', 'connector-save-part', 'connector-save-assemble', 'connector-save-finalize'}, 'relay-files.mjs': {'next', 'next-meta', 'mark-dispatch', 'expire-undispatched', 'respond'}}
if len(sys.argv) < 3 or sys.argv[1] not in allowed or sys.argv[2] not in allowed[sys.argv[1]]:
    fail('HOST_LAUNCH_OPERATION')
for leaf in [NODE, HOST / sys.argv[1], HOST / 'connector-host-no-network.cjs']:
    for p in leaf.parents:
        s = p.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_mode & 0o022 or s.st_uid not in [uid, 0] or (p == RUNTIME and (s.st_uid != uid or stat.S_IMODE(s.st_mode) != 0o700)):
            fail('HOST_LAUNCH_DIRECTORY')
    s = leaf.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != uid or s.st_nlink != 1 or s.st_mode & 0o022:
        fail('HOST_LAUNCH_FILE')
# Hash the exact fixed binary through one no-follow descriptor, then compare metadata.
fd = os.open(NODE, os.O_RDONLY | os.O_NOFOLLOW)
try:
    before = os.fstat(fd)
    with os.fdopen(os.dup(fd), 'rb') as f:
        digest = hashlib.file_digest(f, 'sha256').hexdigest()
    after = os.fstat(fd)
    identity = lambda s: (s.st_dev, s.st_ino, s.st_uid, s.st_gid, s.st_mode, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if identity(before) != identity(after) or identity(after) != identity(NODE.lstat()) or digest != NODE_SHA:
        fail('HOST_LAUNCH_NODE')
finally:
    os.close(fd)
# No inherited NODE_OPTIONS/NODE_PATH/preload or alternate source/loader escapes.
env = {'PATH': str(RUNTIME) + ':/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'TSX_DISABLE_CACHE': '1', 'NODE_DISABLE_COMPILE_CACHE': '1', 'JOBFINDER_CONNECTOR_HOST_SHA256': selector, 'JOBFINDER_CLOUD_SOURCE_ID': 'source-takeda-china-social'}
os.execve(NODE, [str(NODE), '--require', str(HOST / 'connector-host-no-network.cjs'), str(HOST / sys.argv[1]), *sys.argv[2:]], env)
