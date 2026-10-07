"""Closed source-only export. This module never reads a producer or live host path."""
from pathlib import Path, PurePosixPath
import argparse, gzip, hashlib, io, json, os, stat, tarfile

HERE = Path(__file__).absolute().parent
ALLOWLIST_SHA256 = '7c11c99a32bfcdc41e8b76aabdd342a11a3777145d21e911d3175d8c772118b4'
SOURCE_KEYS = ('astellas', 'takeda')
SOURCE_HASHES = {'astellas': 'd3a6153703eeb204c9626e2b45e75d0d9dfcc65865c49066be6ec7a34dec88bc', 'takeda': '048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f'}
PRODUCER_COMMIT = '28402a299bb04cbf5873da66c2fe8ca76827c0d1'
DATABASE = {'migrationVersion': '20261006172300_job_projection_delta_contract', 'schemaHash': '91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a', 'dbSnapshotHash': '49d46d31c07713bbe8f7041ef669312a699737088fd31e52b97a13eea84060f0'}
OWNER = 'owner-adaptations/astellas-takeda-20261007T0848Z/'
AUTHORITY = 'verification/astellas-takeda-preparation-20261007T0848Z/authority/'


def require(ok, code):
    if not ok:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_name(name):
    require(isinstance(name, str) and name != '' and '\\' not in name, 'UNSAFE_PATH')
    p = PurePosixPath(name)
    require(not p.is_absolute() and name == str(p) and all(x not in ('', '.', '..') for x in p.parts), 'UNSAFE_PATH')
    require(not any(ord(c) < 32 or ord(c) == 127 for c in name), 'UNSAFE_PATH')
    return name


def no_symlink_components(path):
    p = Path(os.path.abspath(os.fspath(path)))
    for q in [*reversed(p.parents), p]:
        if q.exists() or q.is_symlink():
            require(not q.is_symlink(), 'SYMLINK_COMPONENT')
    return p


def load_allowlist(path=HERE / 'source-allowlist.json'):
    path = no_symlink_components(path)
    raw = path.read_bytes()
    require(sha(raw) == ALLOWLIST_SHA256, 'FIXED_ALLOWLIST_HASH')
    m = json.loads(raw)
    require(set(m) == {'schemaVersion', 'purpose', 'inputArchiveSha256', 'inputSourcePlanSha256', 'entries'} and m['schemaVersion'] == 1, 'ALLOWLIST_SCHEMA')
    names = []
    for e in m['entries']:
        require(set(e) == {'path', 'bytes', 'sha256'}, 'ALLOWLIST_ENTRY_SCHEMA')
        name = safe_name(e['path']); names.append(name)
        require(isinstance(e['bytes'], int) and e['bytes'] >= 0 and isinstance(e['sha256'], str) and len(e['sha256']) == 64 and all(c in '0123456789abcdef' for c in e['sha256']), 'ALLOWLIST_HASH_SCHEMA')
        require('__pycache__' not in PurePosixPath(name).parts and not name.endswith(('.pyc', '.pyo')), 'FORBIDDEN_BYTECODE')
        require(PurePosixPath(name).name not in {'activation.json', 'activation.prepared.json', 'control-base.json', 'context-read.sql', 'host-config.json', 'source-config-reference.json', 'SOURCE_AUTHORITY_VERIFICATION.json', 'input-baseline.json', 'DELIVERY.json'}, 'FORBIDDEN_RUNTIME_MEMBER')
    require(names == sorted(names) and len(names) == len(set(names)) == 130, 'ALLOWLIST_EXACT_COUNT_OR_ORDER')
    return m


def verify_payload(blobs, manifest):
    expected = {e['path']: e for e in manifest['entries']}
    require(set(blobs) == set(expected), 'PAYLOAD_MEMBER_SET_MISMATCH')
    for name, raw in blobs.items():
        e = expected[name]
        require(len(raw) == e['bytes'] and sha(raw) == e['sha256'], 'PAYLOAD_BYTES_MISMATCH:' + name)
    semantics(blobs)
    return {'files': len(blobs), 'bytes': sum(map(len, blobs.values())), 'sourcePlanAndTemplateConsistency': True, 'ownerMappings': 65, 'priorMappings': 55, 'actualExecutionVerified': False, 'currentOfficialStateVerified': False}


def semantics(blobs):
    get = lambda name: json.loads(blobs[name])
    builds = []
    for key in SOURCE_KEYS:
        host = 'hosts/' + key + '/host/'
        cfg = get(host + 'host-config.template.json')
        require(set(cfg) == {'root', 'repo', 'node', 'project', 'sourceId', 'sourceConfigSha256'}, 'CONFIG_SCHEMA')
        require(cfg['project'] == 'yiopvxysxrtrnvqxwgbx' and cfg['sourceId'] == 'source-' + key + '-china-social' and cfg['sourceConfigSha256'] == SOURCE_HASHES[key], 'SOURCE_CONFIG_PIN')
        control = get(host + 'control-base.template.json')
        require(set(control) == {'projectId', 'build', 'candidate', 'databaseIdentity'} and control['candidate'] is None, 'UNBOUND_TEMPLATE_REQUIRED')
        require(control['projectId'] == cfg['project'] and control['databaseIdentity'] == DATABASE, 'C51_DATABASE_PIN')
        build = control['build']; builds.append(build)
        require(set(build) == {'schemaVersion', 'commitSha', 'sourceTreeSha256', 'runtimeTreeSha256', 'contentSha256'} and build['schemaVersion'] == 2 and build['commitSha'] == PRODUCER_COMMIT, 'C51_BUILD_PIN')
        ordered = {k: build[k] for k in ['schemaVersion', 'commitSha', 'sourceTreeSha256', 'runtimeTreeSha256']}
        require(sha(json.dumps(ordered, separators=(',', ':')).encode()) == build['contentSha256'], 'C51_BUILD_DIGEST')
        source = get(AUTHORITY + key + '.source.json'); plan = get(AUTHORITY + key + '.source-plan.json')
        require(plan['source'] == source and source['id'] == cfg['sourceId'], 'SOURCE_PLAN_MAPPING')
        require(sha(json.dumps(plan, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()) == SOURCE_HASHES[key], 'SOURCE_PLAN_CANONICAL_HASH')
        sql = blobs[host + 'context-read.sql.template'].decode()
        require('OWNER_REGISTERED_C51_CANDIDATE_ID' in sql and cfg['sourceId'] in sql and cfg['sourceConfigSha256'] in sql, 'CONTEXT_TEMPLATE_SCOPE')
        require('dot-cloud-delta-proxy-28402a29-20261007' not in sql, 'CONTEXT_MUST_REMAIN_UNBOUND')
        stage = blobs[host + 'host-stage-functions.js'].decode()
        require(stage.index('UNSELECTED_LEGACY_ARCHIVE_STORE_UNSUPPORTED') < stage.index('if(r.kind==="ARCHIVE_STORE"){'), 'LEGACY_BRANCH_FAIL_CLOSED')
    require(builds[0] == builds[1], 'BUILD_TEMPLATE_MISMATCH')
    current = get(OWNER + 'baseline-manifest.json')
    old = get('owner-adaptations/novartis-bi-20261007T0710Z/baseline-manifest.json')
    require(current['producerCommit'] == PRODUCER_COMMIT and len(current['files']) == 65 and len(old['files']) == 55, 'OWNER_MAP_SCHEMA')
    require(all(current['files'].get(k) == v for k, v in old['files'].items()), 'PRIOR_OWNER_MAP_CHANGED')
    prefix = current['runtimeRoot'] + '/'
    for absolute, e in current['files'].items():
        require(absolute.startswith(prefix), 'OWNER_MAP_ROOT')
        relative = safe_name(absolute[len(prefix):])
        require(relative in blobs and len(blobs[relative]) == e['bytes'] and sha(blobs[relative]) == e['sha256'], 'OWNER_MAP_MEMBER:' + relative)


def tar_blobs(archive, manifest, sealed_input=False):
    archive = no_symlink_components(archive)
    if sealed_input:
        require(sha(archive.read_bytes()) == manifest['inputArchiveSha256'], 'FROZEN_INPUT_ARCHIVE_HASH')
    wanted = {e['path'] for e in manifest['entries']}; blobs = {}; seen = set()
    with tarfile.open(archive, 'r:gz') as tf:
        for member in tf.getmembers():
            name = safe_name(member.name)
            require(name not in seen, 'DUPLICATE_TAR_MEMBER'); seen.add(name)
            require(member.isfile() and not member.issym() and not member.islnk(), 'NONREGULAR_TAR_MEMBER')
            if name in wanted:
                blobs[name] = tf.extractfile(member).read()
        if not sealed_input:
            require(seen == wanted, 'UNLISTED_TAR_MEMBER')
    verify_payload(blobs, manifest)
    return blobs


def stage_blobs(root, manifest):
    root = no_symlink_components(root)
    require(root.is_dir(), 'STAGING_ROOT_REQUIRED')
    wanted = {e['path'] for e in manifest['entries']}
    allowed_dirs = {str(p) for n in wanted for p in PurePosixPath(n).parents if str(p) != '.'}
    seen = set()
    # Enumeration only rejects extras. It never admits or selects a file.
    for parent, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            p = Path(parent) / name; require(not p.is_symlink(), 'STAGING_SYMLINK')
            relative = safe_name(p.relative_to(root).as_posix())
            if name in directories:
                require(relative in allowed_dirs, 'UNLISTED_DIRECTORY:' + relative)
            else:
                require(stat.S_ISREG(p.lstat().st_mode), 'STAGING_NONREGULAR')
                require(relative in wanted, 'UNLISTED_FILE:' + relative); seen.add(relative)
    require(seen == wanted, 'MISSING_REQUIRED_MEMBER')
    blobs = {e['path']: (root / e['path']).read_bytes() for e in manifest['entries']}
    verify_payload(blobs, manifest)
    return blobs


def write_new_tree(blobs, destination):
    destination = no_symlink_components(destination)
    require(not destination.exists(), 'DESTINATION_MUST_BE_NEW')
    destination.mkdir(parents=True, mode=0o700)
    for name in sorted(blobs):
        p = destination / safe_name(name); p.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
        with os.fdopen(fd, 'wb') as output:
            output.write(blobs[name])


def pack(blobs, destination):
    destination = no_symlink_components(destination)
    require(not destination.exists(), 'ARCHIVE_MUST_BE_NEW')
    with destination.open('xb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', mtime=0, filename='') as gz:
            with tarfile.open(fileobj=gz, mode='w') as tf:
                for name in sorted(blobs):
                    raw = blobs[name]; member = tarfile.TarInfo(name)
                    member.size = len(raw); member.mode = 0o644; member.uid = member.gid = 0; member.mtime = 0
                    tf.addfile(member, io.BytesIO(raw))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    p = sub.add_parser('extract-frozen'); p.add_argument('input_archive'); p.add_argument('new_source_directory')
    p = sub.add_parser('verify-tree'); p.add_argument('source_directory')
    p = sub.add_parser('pack'); p.add_argument('source_directory'); p.add_argument('new_output_archive')
    p = sub.add_parser('restore'); p.add_argument('source_archive'); p.add_argument('new_destination')
    args = parser.parse_args(); manifest = load_allowlist()
    if args.mode == 'extract-frozen':
        blobs = tar_blobs(args.input_archive, manifest, sealed_input=True); write_new_tree(blobs, args.new_source_directory)
    elif args.mode == 'verify-tree':
        blobs = stage_blobs(args.source_directory, manifest)
    elif args.mode == 'pack':
        blobs = stage_blobs(args.source_directory, manifest); pack(blobs, args.new_output_archive)
    else:
        blobs = tar_blobs(args.source_archive, manifest); write_new_tree(blobs, args.new_destination)
    print(json.dumps(verify_payload(blobs, manifest), sort_keys=True))

if __name__ == '__main__':
    main()
