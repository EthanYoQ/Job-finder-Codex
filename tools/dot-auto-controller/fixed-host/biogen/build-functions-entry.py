#!/usr/bin/python3
"""Build the fixed functions host from canonical, pinned source only.

The repository artifact is a real but disabled implementation. Deployment
identity is read later from one hash-addressed JSON outside the repository.
This generator cannot activate a deployment or launch a round.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import stat
import sys

HERE = Path(__file__).resolve().parent
FIXED_HOST = HERE.parent
PACKAGE = FIXED_HOST.parent
LIVE_ROOT = Path('/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1')
ROOT_TOKEN = '__JOBFINDER_FIXED_DEPLOYMENT_ROOT__'
CANDIDATE_TOKEN = '__JOBFINDER_CANDIDATE_ID__'
SHA = re.compile(r'^[a-f0-9]{64}$')
CANDIDATE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
PREFIX = 'tools/dot-auto-controller/'
DEPENDENCIES = (
    'connector-gate/biogen-functions-bundle.js',
    'connector-gate/dispatch-observer.functions.js',
    'public-verification/biogen/functions-bundle.js',
    'vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts',
)
OWN_INPUTS = (
    'fixed-host/biogen/body.template.js',
    'fixed-host/functions/private-live-permits.js',
    'fixed-host/functions/sha256.js',
    'fixed-host/functions/host-helper.js',
    'fixed-host/functions/read-response-transport.js',
    'fixed-host/functions/bootstrap-query.sql.template',
    'fixed-host/biogen/build-shared-cores.py',
    'fixed-host/biogen/build-functions-entry.py',
    'fixed-host/biogen/render-biogen-source.py',
    'fixed-host/biogen/fixed-preimport-launch.py.in',
    'fixed-host/biogen/fixed-preflight.mjs.in',
    'fixed-host/biogen/fixed-recovery-helper.mts.in',
    'fixed-host/functions/lifecycle-loader.template.js',
    'fixed-host/lifecycle/lifecycle_lock.py',
    'fixed-host/lifecycle/holder.py.in',
    'fixed-host/lifecycle/exclusive-holder.py.in',
    'fixed-host/lifecycle/cli-entry.py',
    'fixed-host/functions/lifecycle-activation.template.js',
    'fixed-host/scripts/build-lifecycle-artifacts.py',
)
DEPLOYMENT_KEYS = {'schemaVersion','kind','projectId','sourceId',
    'sourceConfigSha256','candidate','databaseIdentity','build','expectedRow',
    'lockSha256','packageManifestSha256','preflightSha256',
    'recoveryHelperSha256','fixturePreloadSha256'}
ROW_KEYS = {'id','goalId','version','commitSha','migrationVersion','schemaHash',
    'dbSnapshotHash','rosterHash','sourcePlanHash','sourceConfigHash',
    'adapterBundleHash','sourceTreeHash','runtimeTreeHash','oracleVersion',
    'minimumStableCompanyCount','status'}

def require(ok, code):
    if not ok:
        raise RuntimeError(code)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=True)

def read_regular(path, mode=None):
    path = Path(path)
    for parent in path.parents:
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode),
                'FIXED_SOURCE_PARENT')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid()
                and s.st_nlink == 1 and not s.st_mode & 0o022,
                'FIXED_SOURCE_FILE')
        if mode is not None:
            require(stat.S_IMODE(s.st_mode) == mode, 'FIXED_SOURCE_MODE')
        before = (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        with os.fdopen(os.dup(fd), 'rb') as f:
            data = f.read()
        after = os.fstat(fd)
        current = path.lstat()
        require(before == tuple(getattr(after, x) for x in
                ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns'))
                == tuple(getattr(current, x) for x in
                ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')),
                'FIXED_SOURCE_CHANGED')
        return data
    finally:
        os.close(fd)

def load_source_inputs():
    record = json.loads(read_regular(HERE/'source-pins.json'))
    require(set(record) == {'schemaVersion','inputs'} and record['schemaVersion'] == 1,
            'FIXED_SOURCE_PIN_SCHEMA')
    expected = set(DEPENDENCIES) | set(OWN_INPUTS)
    require(set(record['inputs']) == expected, 'FIXED_SOURCE_PIN_SET')
    sources = {}
    for name in sorted(expected):
        digest = record['inputs'][name]
        require(type(digest) is str and SHA.fullmatch(digest), 'FIXED_SOURCE_PIN')
        data = read_regular(PACKAGE/name)
        require(sha(data) == digest, 'FIXED_SOURCE_HASH')
        sources[name] = data
    return sources

def load_pinned_module(name, path, sources):
    # The exact bytes have already been read and checked. Execute those bytes,
    # not a second open through an import loader.
    relative = str(path.relative_to(PACKAGE))
    require(relative in sources, 'FIXED_SOURCE_MODULE')
    module = type(sys)(name)
    module.__file__ = str(path)
    exec(compile(sources[relative], str(path), 'exec'), module.__dict__)
    return module

def compile_original_read_outcome(relay):
    marker = 'async readAndVerifyOwnedBiogenOutcome('
    require(relay.count(marker) == 1, 'FIXED_ORIGINAL_OUTCOME_COMPILER')
    section = relay[relay.index(marker):]
    a, b = section.index('const literal='), section.index('const sql=')
    literal = section[a:b].strip().replace(':string', '')
    sql = section[b:section.index(';', b)+1]
    result = ('const sourceResult={id:tuple.sourceResultId,batchId:tuple.batchId};\n'
              +literal+'\n'+sql+'\nreturn sql;')
    require(sha(result.encode()) ==
            '9e0c909bc5a31d1f37e9a112c9d7b28e875b189f2ec27b7a6114c7a30f168442',
            'FIXED_ORIGINAL_OUTCOME_BYTES')
    return result

def render_entry(sources, deployment=None, deployment_sha=None):
    """Pure deterministic render. No execution, filesystem writes, or activation."""
    shared = load_pinned_module('fixed_shared_cores', HERE/'build-shared-cores.py', sources)
    cores = shared.render_shared_cores(
        sources[DEPENDENCIES[0]].decode(), sources[DEPENDENCIES[1]].decode())
    cli_renderer = load_pinned_module('fixed_cli_renderer',
        HERE/'render-biogen-source.py', sources)
    templates = {n:sources['fixed-host/biogen/'+n+'.in']
                 for n in cli_renderer.TEMPLATES}
    rendered_cli = cli_renderer.render_bytes(templates)
    require(cli_renderer.LIVE_ROOT == str(LIVE_ROOT), 'FIXED_LIVE_ROOT_AGREEMENT')
    body = sources['fixed-host/biogen/body.template.js'].decode()
    require(body.count(ROOT_TOKEN) == 1, 'FIXED_BODY_ROOT_TOKEN')
    body = body.replace(ROOT_TOKEN, str(LIVE_ROOT))
    if deployment is None:
        require(deployment_sha is None, 'FIXED_DEFAULT_DEPLOYMENT')
        deployment = {'kind':'LIVE_DEPLOYMENT','fixturePreloadSha256':None,'expectedRow':{}}
        deployment_sha = '0'*64
    else:
        validate_deployment(deployment, rendered_cli)
        require(type(deployment_sha) is str and SHA.fullmatch(deployment_sha),
                'FIXED_DEPLOYMENT_SELECTOR')
    activation = {'enabled':False,'mode':'LIVE','deploymentSha256':deployment_sha}
    candidate = deployment.get('expectedRow', {}).get('id', 'UNQUALIFIED')
    require(type(candidate) is str and CANDIDATE_ID.fullmatch(candidate),
            'FIXED_BOOTSTRAP_CANDIDATE')
    query = sources['fixed-host/functions/bootstrap-query.sql.template'].decode()
    require(query.count(CANDIDATE_TOKEN) == 1, 'FIXED_BOOTSTRAP_TEMPLATE')
    query = query.replace(CANDIDATE_TOKEN, candidate)
    helper = sources['fixed-host/functions/host-helper.js'].decode()
    transport = sources['fixed-host/functions/read-response-transport.js'].decode()
    ui = sources[DEPENDENCIES[2]].decode()
    # Old baseline helper/transport/relay copies were hash-only provenance in the
    # prototype; they were never executed. Canonical inputs replace local evidence.
    values = {'PINS':{'ui':sha(ui.encode())}, 'SOURCES':{'ui':ui},
        'ADAPTED_HELPER':helper,'ADAPTED_HELPER_SHA256':sha(helper.encode()),
        'ADAPTED_TRANSPORT':transport,'ADAPTED_TRANSPORT_SHA256':sha(transport.encode()),
        'READ_OUTCOME_COMPILER':compile_original_read_outcome(sources[DEPENDENCIES[3]].decode()),
        'LOCAL_CLI_SHA256':sha(rendered_cli['fixed-preimport-launch.py']),
        'STABLE_CLI_SHA256':sha(sources['fixed-host/lifecycle/cli-entry.py']),
        'OBSERVER_CORE_SOURCE':cores['observer-core.functions.js'],
        'OBSERVER_CORE_SHA256':sha(cores['observer-core.functions.js'].encode()),
        'PIPE_CORE_SOURCE':cores['pipe-core.functions.js'],
        'PIPE_CORE_SHA256':sha(cores['pipe-core.functions.js'].encode())}
    pre = 'const ACTIVATION=Object.freeze('+encoded(activation)+');\n'
    pre += 'const DEPLOYMENT='+encoded(deployment)+';\nconst BOOTSTRAP_SQL='+encoded(query)+';\n'
    common = '// Fixed functions composition: no caller ports, paths, SQL, or approval input.\n'
    common += sources['fixed-host/functions/sha256.js'].decode()+'\n'
    common += ''.join('const '+k+'='+encoded(v)+';\n' for k,v in values.items())
    common += body+'\n'+sources['fixed-host/functions/private-live-permits.js'].decode()+'\n'
    export = """async function runLiveRound(){
 check(arguments.length===0,'FIXED_ENTRY_NO_ARGUMENTS');
 if(!ACTIVATION.enabled)return {status:'DISABLED',reason:'LIVE_DEPLOYMENT_NOT_ACTIVATED',realToolCalls:0,productionQualified:false};
 check(typeof lifecycleScope!=='undefined'&&typeof lifecycleScope.assertOriginal==='function','FIXED_STABLE_LIFECYCLE_LOADER_REQUIRED');
 lifecycleScope.assertOriginal();
 check(ACTIVATION.mode==='LIVE'&&DEPLOYMENT.kind==='LIVE_DEPLOYMENT','FIXED_LIVE_DEPLOYMENT_REQUIRED');
 return runFixedRound();
}
return Object.freeze({runLiveRound});
"""
    return (pre+common+export).encode()

def validate_deployment(d, cli):
    require(type(d) is dict and set(d) == DEPLOYMENT_KEYS, 'FIXED_DEPLOYMENT_KEYS')
    require(d['schemaVersion'] == 1 and d['kind'] == 'LIVE_DEPLOYMENT'
            and d['fixturePreloadSha256'] is None
            and d['projectId'] == 'yiopvxysxrtrnvqxwgbx'
            and d['sourceId'] == 'source-biogen-china-social', 'FIXED_LIVE_DEPLOYMENT')
    require(type(d['expectedRow']) is dict and set(d['expectedRow']) == ROW_KEYS,
            'FIXED_EXPECTED_ROW_FIELDS')
    require(type(d['candidate']) is dict and set(d['candidate']) == {'id','goalId','version'}
            and all(d['candidate'][k] == d['expectedRow'][k] for k in d['candidate']),
            'FIXED_CANDIDATE_BINDING')
    require(not d['candidate']['id'].startswith('fixed-functions-')
            and 'unregistered' not in d['candidate']['id'], 'FIXED_NO_TEST_IDENTITY')
    for key in ('sourceConfigSha256','lockSha256','packageManifestSha256',
                'preflightSha256','recoveryHelperSha256'):
        require(type(d[key]) is str and SHA.fullmatch(d[key]), 'FIXED_DEPLOYMENT_HASH')
    require(d['preflightSha256'] == sha(cli['fixed-preflight.mjs'])
            and d['recoveryHelperSha256'] == sha(cli['fixed-recovery-helper.mts']),
            'FIXED_RENDERED_HELPER_BINDING')

def verify_package_manifest(data):
    # Check every listed byte and close all generator inputs. Completeness of the
    # entire executable package remains the original launch preimport gate; this
    # disabled artifact generation step does not replace that qualification.
    m = json.loads(data)
    require(m.get('schemaVersion') == 1 and m.get('packagePrefix') == PREFIX
            and type(m.get('entries')) is list and m.get('files') == len(m['entries']),
            'FIXED_PACKAGE_MANIFEST')
    seen = set()
    for e in m['entries']:
        path = e.get('path')
        require(type(path) is str and path.startswith(PREFIX) and path not in seen
                and all(x not in ('', '.', '..') for x in path.split('/')),
                'FIXED_MANIFEST_PATH')
        seen.add(path)
        p = PACKAGE/path[len(PREFIX):]
        data = read_regular(p)
        require(len(data) == e.get('bytes') and sha(data) == e.get('sha256')
                and e.get('mode') == ('100755' if p.stat().st_mode & 0o111 else '100644'),
                'FIXED_MANIFEST_SOURCE_BYTES')
    required = {PREFIX+x for x in DEPENDENCIES+OWN_INPUTS}
    required |= {PREFIX+'fixed-host/biogen/source-pins.json', PREFIX+'fixed-host/biogen/functions-entry.js',PREFIX+'fixed-host/biogen/functions-loader.js',PREFIX+'fixed-host/biogen/functions-activate.js'}
    require(required <= seen, 'FIXED_MANIFEST_CLOSURE')

def selected_deployment():
    lease=globals().get('LIFECYCLE_LEASE')
    require(lease is not None,'FIXED_STABLE_LIFECYCLE_REQUIRED')
    lease.check()
    digest = os.environ.get('JOBFINDER_FIXED_DEPLOYMENT_SHA256')
    require(type(digest) is str and SHA.fullmatch(digest), 'FIXED_DEPLOYMENT_SELECTOR')
    raw = read_regular(LIVE_ROOT/'deployments'/(digest+'.json'), 0o400)
    require(sha(raw) == digest, 'FIXED_DEPLOYMENT_BYTES')
    d = json.loads(raw)
    require(type(d) is dict and SHA.fullmatch(d.get('packageManifestSha256','')),
            'FIXED_MANIFEST_SELECTOR')
    raw_manifest = read_regular(LIVE_ROOT/'deployments'/(d['packageManifestSha256']+'.manifest.json'), 0o400)
    require(sha(raw_manifest) == d['packageManifestSha256'], 'FIXED_MANIFEST_HASH')
    verify_package_manifest(raw_manifest)
    return d, digest

def write_exclusive(path, data):
    path = Path(path)
    require(path.is_absolute() and all(x not in ('', '.', '..') for x in path.parts[1:]),
            'FIXED_OUTPUT_PATH')
    # Walk with directory descriptors. No path component may redirect the fixed
    # output, including a symlink introduced after its parent was inspected.
    parent_fd = os.open('/', os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            next_fd = os.open(part, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,
                              dir_fd=parent_fd)
            s = os.fstat(next_fd)
            try:
                require(stat.S_ISDIR(s.st_mode) and s.st_uid in (0,os.getuid())
                        and not s.st_mode & 0o022, 'FIXED_OUTPUT_PARENT')
            except BaseException:
                os.close(next_fd)
                raise
            os.close(parent_fd)
            parent_fd = next_fd
        fd = os.open(path.name, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,
                     0o644, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())

def main():
    require(len(sys.argv) == 2 and sys.argv[1] in
            ('check-default-source','write-default-source'),
            'FIXED_BUILD_OPERATION')
    op = sys.argv[1]
    sources = load_source_inputs()
    deployment, digest = selected_deployment() if op.endswith('deployment') else (None,None)
    result = render_entry(sources, deployment, digest)
    lifecycle_builder=load_pinned_module('fixed_lifecycle_builder',FIXED_HOST/'scripts/build-lifecycle-artifacts.py',sources)
    loader=lifecycle_builder.render_loader(sources['fixed-host/functions/lifecycle-loader.template.js'].decode(),sources['fixed-host/functions/sha256.js'].decode())
    rows=next(line for line in sources['fixed-host/functions/host-helper.js'].decode().splitlines() if line.startswith('function rows('))
    activation=lifecycle_builder.render_activation(sources['fixed-host/functions/lifecycle-activation.template.js'].decode(),sources['fixed-host/functions/sha256.js'].decode(),rows)
    if op == 'write-default-source':
        write_exclusive(HERE/'functions-entry.js', result)
        write_exclusive(HERE/'functions-loader.js', loader)
        write_exclusive(HERE/'functions-activate.js', activation)
    elif op == 'check-default-source':
        require(read_regular(HERE/'functions-entry.js') == result, 'FIXED_GENERATED_ENTRY_BYTES')
        require(read_regular(HERE/'functions-loader.js') == loader and read_regular(HERE/'functions-activate.js') == activation,'FIXED_LIFECYCLE_GENERATED_BYTES')
    elif op == 'emit-deployment':
        # No caller-controlled path and no creation/permission change of LIVE root.
        write_exclusive(LIVE_ROOT/'candidate/functions-entry.js', result)
    print(encoded({'schemaVersion':1,'kind':'FIXED_FUNCTIONS_SOURCE_BUILD',
        'entrySha256':sha(result),'entryBytes':len(result),'activation':False,
        'createsLiveRoot':False,'productionQualified':False,'deploymentSha256':digest,
        'fullPackageQualification':'ORIGINAL_LAUNCH_PREIMPORT_REQUIRED'}))

if __name__ == '__main__':
    main()
