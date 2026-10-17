#!/usr/bin/python3
"""Fixed reviewed Node launcher. No path/code/provider is selected by JSON or PATH."""
import hashlib, json, os, pathlib, re, stat, sys
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
# A fixed, reviewed catalogue, never a JSON-selected path or executable. Node's
# binding loader independently verifies the same bytes, closed keys and source.
CATALOG = PRODUCER.parent.parent / 'config/native-catalog.json'
CATALOG_SHA = 'ee84807ec4cd79b8290ed7a1148ba121b143a7182091e01c33aff05cb61edc34'
for p in CATALOG.parents:
    st = p.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_mode & 0o022 or st.st_uid not in [uid, 0]:
        fail('HOST_LAUNCH_DIRECTORY')
fd = os.open(CATALOG, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
try:
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_uid != uid or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o644 or before.st_size != 12326:
        fail('HOST_CATALOG_FILE')
    data = os.read(fd, before.st_size + 1)
    if identity(before) != identity(os.fstat(fd)) or identity(before) != identity(CATALOG.lstat()) or hashlib.sha256(data).hexdigest() != CATALOG_SHA:
        fail('HOST_CATALOG_DRIFT')
finally:
    os.close(fd)
rows = json.loads(data)['routingCatalogue']
source = os.environ.get('JOBFINDER_CLOUD_SOURCE_ID', '')
supported = lambda r: r['route'] == 'PORTABLE' or (r['route'] == 'TRUE_A' and r['sourceId'] != 'source-johnson-innovative-medicine-social') or (r['route'] == 'TRUE_B' and r['sourceId'] == 'source-pfizer-china-social')
if len(rows) != 36 or sum(r['route'] == 'PORTABLE' for r in rows) != 20 or source not in {r['sourceId'] for r in rows if supported(r)}:
    fail('HOST_SOURCE_ENV')
# No inherited NODE_OPTIONS/NODE_PATH/preload or alternate source/loader escapes.
env = {'PATH': str(RUNTIME) + ':/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'TSX_DISABLE_CACHE': '1', 'NODE_DISABLE_COMPILE_CACHE': '1', 'JOBFINDER_CONNECTOR_HOST_SHA256': selector, 'JOBFINDER_CLOUD_SOURCE_ID': source}
sequence_layout = os.environ.get('JOBFINDER_FIXED_SEQUENCE_LAYOUT')
if sequence_layout is not None:
    if sequence_layout != 'TAKEDA_BIOGEN_HENGRUI_UCB_VIATRIS_V1' or source not in ('source-takeda-china-social','source-biogen-china-social','source-hengrui-social','source-ucb-china-social','source-viatris-social'):
        fail('HOST_SEQUENCE_LAYOUT')
    env['JOBFINDER_FIXED_SEQUENCE_LAYOUT'] = sequence_layout
round_id = os.environ.get('JOBFINDER_CONNECTOR_ROUND_ID')
if round_id is not None:
    if not re.fullmatch(r'round-[a-f0-9]{32}', round_id): fail('HOST_ROUND_SELECTOR')
    env['JOBFINDER_CONNECTOR_ROUND_ID'] = round_id
os.execve(NODE, [str(NODE), '--require', str(HOST / 'connector-host-no-network.cjs'), str(HOST / sys.argv[1]), *sys.argv[2:]], env)
