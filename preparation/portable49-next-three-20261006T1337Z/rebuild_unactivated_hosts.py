#!/usr/bin/env python3
"""Bounded offline reconstruction. Never registers, binds, starts, or publishes.

Only astellas, grifols, and biogen are accepted. Each destination must be absent.
Read BMS files[] only, never a host tree walk or verification/runtime-state copy.
Failure leaves the incomplete destination for inspection; it never removes it.
"""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
from datetime import datetime, timezone

R3 = Path('/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z')
BASE = R3 / 'hosts-next/bms'
REPO = R3 / 'workspaces/producer-fb0-exact'
BASE_SHA = '39a9fe7e937f7b5d28310d6492995578c473b5834f252e38b57c4655b2bd1dc7'
REFS = {
    'verification/STATIC_SOURCE_PLAN_REFERENCE.json': '771bf4ea2ae391424e9451e9b5e12be9c03b3e069f9dc1b5cba9a7cc178fbbd6',
    'verification/source-route-bounded-reconcile.parsed.json': 'b83870618c61bf197ee98231c32e0a3bc9f2cbb286285c99c3e7b8b8bc9aa902',
}
DEPENDENCY = 'preparation/merck-runtime-binding-20261006T1231Z/DEPENDENCY_MANIFEST.json'
DEPENDENCY_SHA = 'd6e865e8b2ae1c6bc4a2be35dba7b17d75a59a71be731e19dae9032d6382b9a3'
ALLOWED = ('astellas', 'grifols', 'biogen')
CANDIDATE = {'id': 'dot-cloud-deadline-47b74924-20261006', 'version': 49}
COMMIT = '47b74924f850a4d329460b71717b36df9a5159b8'
RUNTIME = 'b59a746109d74eea22cab9c4c3154de5954bae3b900ed0e7032a20d4ea510bd1'
WRAPPER_SHA = 'f15522e6f209bfe99bfa258b5dffbce1f74d6af662c4c2ee682604e0798bbc88'
ENV = {**os.environ, 'TSX_DISABLE_CACHE': '1', 'NODE_DISABLE_COMPILE_CACHE': '1', 'GIT_OPTIONAL_LOCKS': '0'}
sha = lambda b: hashlib.sha256(b).hexdigest()
now = lambda: datetime.now(timezone.utc).isoformat()

def fail(message):
    raise RuntimeError(message)

def require(value, message):
    if not value:
        fail(message)

def no_links(path):
    require(path.is_absolute(), 'ABSOLUTE_PATH_REQUIRED')
    cursor = Path(path.anchor)
    for part in path.parts[1:]:
        cursor /= part
        try:
            require(not stat.S_ISLNK(cursor.lstat().st_mode), 'SYMLINK_FORBIDDEN:' + str(cursor))
        except FileNotFoundError:
            break

def checked_read(path, digest):
    no_links(path)
    require(path.is_file(), 'REGULAR_FILE_REQUIRED:' + str(path))
    data = path.read_bytes()
    require(sha(data) == digest, 'SOURCE_HASH_MISMATCH:' + str(path))
    return data

def safe_relative(name):
    p = PurePosixPath(name)
    require(bool(name) and not p.is_absolute() and p.as_posix() == name and '..' not in p.parts and '\\' not in name, 'WHITELIST_PATH_INVALID')
    require(p.name not in ('activation.json', 'control-base.json', 'PUBLISHER-ACTIVE-STATE.json') and not any(x in p.parts for x in ('run', 'runs', 'verification')), 'RUNTIME_STATE_PATH_FORBIDDEN')
    return p

def write_new(path, data):
    no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('xb') as output:
        output.write(data.encode() if isinstance(data, str) else data)

def write_json(path, value):
    write_new(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def run(argv, cwd=REPO, env=ENV, timeout=60):
    result = subprocess.run(argv, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    require(result.returncode == 0, 'LOCAL_COMMAND_FAILED:' + repr(argv) + '\n' + result.stdout + result.stderr)
    return result.stdout

def official_rows(value):
    found = []
    if isinstance(value, list):
        for child in value:
            found.extend(official_rows(child))
    elif isinstance(value, dict):
        if value.get('expectedSourceId'):
            found.append(value)
        else:
            for child in value.values():
                found.extend(official_rows(child))
    return found

def load_inputs():
    base = json.loads(checked_read(BASE / 'FROZEN_SOURCE_MANIFEST.json', BASE_SHA))
    require(base['build']['commitSha'] == COMMIT and base['build']['runtimeTreeSha256'] == RUNTIME, 'BUILD_PIN_MISMATCH')
    require(base['candidate'] is None and base['intendedExistingCandidate'] == CANDIDATE, 'BASE_CANDIDATE_MISMATCH')
    require(len(base['files']) == 42 and len({e['path'] for e in base['files']}) == 42, 'EXACT_42_WHITELIST_REQUIRED')
    files = {}
    for entry in base['files']:
        rel = safe_relative(entry['path'])
        data = checked_read(BASE / rel, entry['sha256'])
        require(len(data) == entry['bytes'], 'BASE_SIZE_MISMATCH')
        files[entry['path']] = data
    refs = {name: json.loads(checked_read(R3 / name, digest)) for name, digest in REFS.items()}
    static = refs['verification/STATIC_SOURCE_PLAN_REFERENCE.json']['rows']
    official = official_rows(refs['verification/source-route-bounded-reconcile.parsed.json'])
    sources = {}
    for key in ALLOWED:
        sid = 'source-' + key + '-china-social'
        a = [x for x in static if x['sourceId'] == sid]
        b = [x for x in official if x['expectedSourceId'] == sid]
        require(len(a) == len(b) == 1, 'EXACT_REFERENCE_ROW_REQUIRED:' + key)
        a, b = a[0], b[0]
        require(a['staticRoute'] == 'PORTABLE' and a['portableError'] is None, 'PORTABLE_REFERENCE_REQUIRED')
        for field in ('id', 'companyId', 'kind', 'atsKind', 'status', 'officialEntryUrl', 'officialChainEvidenceUrl'):
            require(a['source'][field] == b['source'][field], 'OFFICIAL_REFERENCE_MISMATCH:' + field)
        require(a['sourceConfigHash'] == b['observation']['sourceConfigSha256'] == b['latestCommitted']['sourceConfigHash'], 'REFERENCE_CONFIG_HASH_MISMATCH')
        sources[key] = {'key': key, 'sourceId': sid, 'companyId': a['companyId'], 'officialEntryUrl': a['source']['officialEntryUrl'], 'sourceConfigSha256': a['sourceConfigHash'], 'static': a, 'officialSource': b['source']}
    dependency = json.loads(checked_read(R3 / DEPENDENCY, DEPENDENCY_SHA))
    old = [x for x in dependency['entries'] if x['kind'] == 'READ_ONLY_LEGACY_TEST_REFERENCE']
    require(len(old) == 1, 'LEGACY_GATE_REFERENCE_REQUIRED')
    checked_read(R3 / old[0]['sourceRelativeToR3'], old[0]['sha256'])
    checked_read(REPO / 'scripts/run-with-http-diagnostics.mjs', WRAPPER_SHA)
    require(run(['git', 'rev-parse', 'HEAD']).strip() == COMMIT, 'PRODUCER_COMMIT_MISMATCH')
    require(not run(['git', 'status', '--porcelain']).strip(), 'DIRTY_PRODUCER')
    return base, files, sources

COMPILE = r'''import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [root]=process.argv.slice(2),read=(p)=>JSON.parse(readFileSync(join(root,p),'utf8'));
const cfg=read('host/host-config.json'),template=read('host/control-base.template.json'),ref=read('verification/SOURCE_REFERENCE_CHECK.json');
assert.equal(template.candidate,null);
globalThis.fetch=async()=>{throw Error('OFFLINE_NETWORK_FORBIDDEN');};
const sourceImport=p=>import(pathToFileURL(join(cfg.repo,p)).href);
const {CLOUD_PILOT_SOURCE,compileCloudPilotPublicationContextSql}=await sourceImport('src/db/cloudPilotSqlControl.ts');
const {buildStagedSourceCrawlPlans,sourcePlanConfigSha256}=await sourceImport('src/crawler/sourcePlan.ts');
const {candidateCompanies}=await sourceImport('src/data/companyRegistry.ts');
const {SOURCE_QUALITY_POLICY_ID,getSourceQualityPolicy}=await sourceImport('src/crawler/sourceQualityAdmission.ts');
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===cfg.sourceId);
assert.ok(plan);assert.equal(sourcePlanConfigSha256(plan),cfg.sourceConfigSha256);
assert.equal(CLOUD_PILOT_SOURCE.id,cfg.sourceId);assert.equal(CLOUD_PILOT_SOURCE.sourceConfigSha256,cfg.sourceConfigSha256);
assert.equal(plan.source.officialEntryUrl,ref.source.officialEntryUrl);assert.equal(plan.company.id,ref.source.companyId);
const candidate={id:'dot-cloud-deadline-47b74924-20261006',goalId:'jobfinder-portable-required-40',version:49};
assert.equal(getSourceQualityPolicy(plan),SOURCE_QUALITY_POLICY_ID);
// Match p0-cloud-portable-source-pilot.ts:103 exactly: its explicit portable policy.
const sql=compileCloudPilotPublicationContextSql({...template,candidate},SOURCE_QUALITY_POLICY_ID);
assert.equal(sql,readFileSync(join(root,'verification/expected-context.sql'),'utf8'));
assert.ok(!/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql));
writeFileSync(join(root,'host/context-read.sql'),sql,{flag:'wx',mode:0o600});
const report={status:'PASS_ORIGINAL_COMPILER_OFFLINE',sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,officialEntryUrl:plan.source.officialEntryUrl,sqlSha256:createHash('sha256').update(sql).digest('hex'),compiler:'src/db/cloudPilotSqlControl.ts',compilerSha256:createHash('sha256').update(readFileSync(join(cfg.repo,'src/db/cloudPilotSqlControl.ts'))).digest('hex'),candidateUsedInMemoryOnly:candidate,templateCandidateNull:true,networkUsed:false,databaseUsed:false};
writeFileSync(join(root,'verification/OFFLINE_CONTEXT_COMPILE.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
'''

CROSS = r'''import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [root]=process.argv.slice(2),cfg=JSON.parse(readFileSync(join(root,'host/host-config.json'),'utf8'));
const refs=JSON.parse(readFileSync(join(root,'verification/PEER_SCOPE_REFERENCE.json'),'utf8'));
const A=Object.getPrototypeOf(async function(){}).constructor,stageCode=readFileSync(join(root,'host/host-stage-functions.js'),'utf8'),runtime=readFileSync(join(root,'host/runtime/load-source-runtime.js'),'utf8'),loader=readFileSync(join(root,'host/runtime/load-host-state.js'),'utf8');
let calls=0;const forbidden=new Proxy({},{get(){calls++;throw Error('FORBIDDEN_REAL_TOOL');}}),checks=[];
globalThis.__peerScopeHelper=()=>({cfg});globalThis.tools=forbidden;
try{
 const stage=await new A('load',stageCode)(()=> 'return __peerScopeHelper();');
 for(const peer of refs){
  if(peer.sourceId===cfg.sourceId)continue;
  for(const field of ['sourceId','sourceConfigSha256']){
   const request={kind:'READ_CONTEXT',expired:false,dispatchRecorded:false,payload:{projectId:cfg.project,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256}};
   request.payload[field]=peer[field];await assert.rejects(()=>stage.handle(request,'/synthetic-only'),/HOST_CONTEXT_SOURCE_BINDING/);checks.push(peer.key+'-'+field+'-blocked');
  }
  await assert.rejects(()=>new A('sourceKey','tools',runtime)(peer.key,forbidden),/RESTORED46_SOURCE_SELECTION/);
  await assert.rejects(()=>new A('root','sourceId','candidateId','commit','tools',loader)(join(root,'host'),peer.sourceId,'synthetic-candidate','47b74924f850a4d329460b71717b36df9a5159b8',forbidden),/HOST_LOAD_ARGUMENT/);
  checks.push(peer.key+'-loader-runtime-blocked');
 }
 assert.equal(calls,0);
}finally{delete globalThis.__peerScopeHelper;delete globalThis.tools;}
const report={status:'PASS_CROSS_SOURCE_REJECTION',sourceId:cfg.sourceId,checks,actualToolCalls:calls};writeFileSync(join(root,'verification/CROSS_SOURCE_RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
'''

ROUNDTRIP = r'''import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [root]=process.argv.slice(2),cfg=JSON.parse(readFileSync(join(root,'host/host-config.json'),'utf8')),key=cfg.sourceId.slice(7,-13);
const {stripCombinedObservation,addCombinedObservation}=await import(pathToFileURL(join(root,'supervision/create-combined-starter.mjs')).href);
const original=readFileSync(join(root,'host/runtime/start-monitor-portable42.js'),'utf8'),combined=readFileSync(join(root,'supervision/start-monitor-'+key+'47b-combined.js'),'utf8');
assert.equal(stripCombinedObservation(combined),original);assert.equal(addCombinedObservation(original),combined);
const report={status:'PASS_BYTE_EXACT_COMMAND_RESTORATION',originalSha256:createHash('sha256').update(original).digest('hex'),combinedSha256:createHash('sha256').update(combined).digest('hex'),stripAndRegenerateBothExact:true};
writeFileSync(join(root,'verification/COMMAND_RESTORATION.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
'''

PDF = r'''import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const [root]=process.argv.slice(2),cfg=JSON.parse(readFileSync(join(root,'host/host-config.json'),'utf8'));
globalThis.fetch=async()=>{throw Error('OFFLINE_PDF_FETCH_FORBIDDEN');};
const {inspectAstellasPdfRuntime}=await import(pathToFileURL(join(cfg.repo,'src/crawler/astellasPdfLocations.ts')).href);
const capability=await inspectAstellasPdfRuntime();
const report={status:capability.available?'PASS_READ_ONLY_PDF_DEPENDENCY':'PDF_RUNTIME_UNAVAILABLE',capability,executables:['/usr/bin/pdfinfo','/usr/bin/pdftotext','/usr/bin/prlimit'],scope:'Original resource-limited version probes only; no installation, download, PDF parsing or source capture',source:'src/crawler/astellasPdfLocations.ts:63-71;173-182',realPdfParsingVerified:false,networkUsed:false};
writeFileSync(join(root,'verification/PDF_DEPENDENCY_CHECK.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
'''

def prepare(key, base, original, sources):
    require(key in ALLOWED, 'SOURCE_NOT_ALLOWED')
    dest = R3 / 'hosts-next' / key
    no_links(dest)
    require(not os.path.lexists(dest), 'DESTINATION_ALREADY_EXISTS:' + str(dest))
    source = sources[key]
    transformed = {}
    mappings = []
    old_starter = sha(original['host/runtime/start-monitor-portable42.js'])
    for rel, data in original.items():
        target = rel.replace('bms', key)
        safe_relative(target)
        value = data.decode().replace('bms', key).replace('BMS', key.upper()).replace(base['sourceConfigSha256'], source['sourceConfigSha256'])
        transformed[target] = value.encode()
        mappings.append({'baselinePath': rel, 'path': target, 'baselineSha256': sha(data)})
    new_starter = sha(transformed['host/runtime/start-monitor-portable42.js'])
    generator = 'supervision/create-combined-starter.mjs'
    require(transformed[generator].count(old_starter.encode()) == 1, 'STARTER_PIN_UNIQUE_REQUIRED')
    transformed[generator] = transformed[generator].replace(old_starter.encode(), new_starter.encode())
    changed = [x for x in mappings if x['baselineSha256'] != sha(transformed[x['path']])]
    require(len(changed) == 21, 'EXACT_21_ADAPTATIONS_REQUIRED')
    # Validate everything before mkdir, then exclusively create this one destination.
    dest.mkdir(mode=0o700)
    combined = 'supervision/start-monitor-' + key + '47b-combined.js'
    for rel, data in transformed.items():
        if rel not in ('host/context-read.sql', combined):
            write_new(dest / rel, data)
    (dest / 'verification').mkdir(mode=0o700)
    reference = {'status': 'PASS_STATIC_AND_OFFICIAL_REFERENCE_MATCH', 'source': source, 'references': [{'path': n, 'sha256': d} for n, d in REFS.items()], 'readOnlyOffline': True}
    write_json(dest / 'verification/SOURCE_REFERENCE_CHECK.json', reference)
    write_json(dest / 'verification/PEER_SCOPE_REFERENCE.json', [{'key': k, 'sourceId': s['sourceId'], 'sourceConfigSha256': s['sourceConfigSha256']} for k, s in sources.items()])
    write_new(dest / 'verification/expected-context.sql', transformed['host/context-read.sql'])
    for name, code in [('compile-context.mts', COMPILE), ('test-cross-source.mjs', CROSS), ('test-command-restoration.mjs', ROUNDTRIP)]:
        write_new(dest / 'verification' / name, code)
    env = {**ENV, 'JOBFINDER_CLOUD_SOURCE_ID': source['sourceId']}
    tsx = ['node', '--max-old-space-size=256', '--import', str(REPO / 'node_modules/tsx/dist/loader.mjs')]
    commands = [
        tsx + [str(dest / 'verification/compile-context.mts'), str(dest)],
        ['node', str(dest / generator)],
        ['node', str(dest / 'test-source-scope.mjs')],
        ['node', str(dest / 'verification/test-cross-source.mjs'), str(dest)],
        ['node', str(dest / 'test-binding-and-paths.mjs')],
        ['node', str(dest / 'verification/test-command-restoration.mjs'), str(dest)],
        ['node', str(dest / 'supervision/test-starter-integration.mjs')],
        ['node', str(dest / 'test-local-preflight.mjs')],
    ]
    results = []
    for index, command in enumerate(commands):
        output = run(command, env=env)
        write_new(dest / ('verification/check-%02d.stdout.txt' % index), output)
        results.append({'argv': command, 'exitCode': 0, 'stdout': 'verification/check-%02d.stdout.txt' % index})
    if key == 'astellas':
        write_new(dest / 'verification/check-pdf-dependency.mts', PDF)
        output = run(tsx + [str(dest / 'verification/check-pdf-dependency.mts'), str(dest)], env=env)
        write_new(dest / 'verification/pdf-dependency.stdout.txt', output)
    for rel, data in transformed.items():
        require((dest / rel).read_bytes() == data, 'GENERATED_BYTE_MISMATCH:' + rel)
    require(not (dest / 'host/activation.json').exists() and not (dest / 'host/control-base.json').exists(), 'REAL_ACTIVATION_OR_CONTROL_FORBIDDEN')
    require(json.loads((dest / 'host/control-base.template.json').read_text())['candidate'] is None, 'NULL_TEMPLATE_REQUIRED')
    require(not run(['git', 'status', '--porcelain']).strip(), 'PRODUCER_CHANGED')
    for entry in mappings:
        entry.update(sha256=sha(transformed[entry['path']]), unchanged=entry['baselineSha256'] == sha(transformed[entry['path']]))
    write_json(dest / 'SOURCE_ADAPTATION_DIFF.json', {'baselineManifestSha256': BASE_SHA, 'unchangedCount': 21, 'adaptedCount': 21, 'files': mappings})
    patch = ''.join(''.join(difflib.unified_diff(original[e['baselinePath']].decode().splitlines(True), transformed[e['path']].decode().splitlines(True), fromfile='bms/' + e['baselinePath'], tofile=key + '/' + e['path'])) for e in mappings if not e['unchanged'])
    write_new(dest / 'SOURCE_ADAPTATION.patch', patch)
    dependency_scope = {'manifest': DEPENDENCY, 'sha256': DEPENDENCY_SHA, 'legacyDueGateReferenceVerified': True, 'fullHistoricalFaultSuiteRun': False, 'historicalFaultPathRunnabilityClaimed': False, 'reason': 'Only unchanged due-gate comparison uses the manifest-listed legacy source; old fault-suite paths are not rerun or claimed portable.'}
    write_json(dest / 'verification/TEST_DEPENDENCY_SCOPE.json', dependency_scope)
    write_json(dest / 'verification/SMOKE_SUMMARY.json', {'status': 'PASS_OFFLINE_BOUNDED_CHECKS', 'sourceId': source['sourceId'], 'checks': results, 'unchangedFilesReused': 21, 'producerChanged': False, 'realProducerCaptureExecuted': False, 'actualDatabaseCalls': 0, 'actualNetworkCalls': 0, 'actualControlAbsent': True, 'actualActivationAbsent': True, 'mockLaunchIntercepted': True, 'allExecutedLocalChecksTerminal': True, 'fullRepositoryTestsRun': False})
    instructions = f'''C49 owner steps for {key}; this preparation did not bind or launch.
1. Verify FROZEN_SOURCE_MANIFEST.sha256 and each files[] and verificationFiles[] entry. Never recursively copy or scan the host; owner state can later appear.
2. Under the owner's existing one-source-at-a-time flow, materialize host/control-base.json with exclusive create from candidate-null host/control-base.template.json and host/activation.json with status UNREGISTERED, candidate null, and the exact template build. This recipe never performs this step.
3. Fresh read existing ReleaseCandidate primary key {CANDIDATE['id']} through officialSupabase; retain the full row and database checkedAt. Require version 49 and all EXPECTED_REGISTRATION fields. No candidate registration.
4. Within 60 seconds, pass that verified readback to bind-registered-readback.mjs. Confirm REGISTERED_VERIFIED and the exact existing candidate id/version.
5. Use sourceKey {key} with host/runtime/load-source-runtime.js under the existing tool mapping; set a unique batch under deadlineCandidate47b:{key}:nextBatchId.
6. Owner alone invokes supervision/start-monitor-{key}47b-combined.js. Retain fresh bootstrap, original check-only, the 12h CrawlObservation due gate, atomic lock, 30min wrapper, supervisor, sampler, durable relay, and terminal checks. Do not run different sources concurrently.
7. Keep publisher state path {R3}/PUBLISHER-ACTIVE-STATE.json. The preparation neither reads nor writes this state.
8. Confirm actual source outcome and original exec/supervisor/sampler terminal states. Offline preparation is not evidence of DB/public page results or real PDF parsing.

Source: {source['sourceId']}
Exact official entry URL: {source['officialEntryUrl']}
Source config SHA256: {source['sourceConfigSha256']}
Build: {COMMIT}; runtime SHA256: {RUNTIME}
Legacy ARCHIVE_STORE fallback still requires its source-specific archive audit/current Library helper; DB_STARTED normal path does not call it. Remote retention/recovery remain PENDING.
'''
    write_new(dest / 'OWNER_BINDING_STEPS.txt', instructions)
    # Only the newly created verification directory is enumerated, never BASE/host.
    verification = sorted(p.relative_to(dest).as_posix() for p in (dest / 'verification').rglob('*') if p.is_file() and not any(x in p.parts for x in ('artifacts', 'relay', 'archive-smoke')))
    # Synthetic preflight/control/bootstrap bytes are intentionally excluded; retain reports only.
    verification = [p for p in verification if '/local-preflight-' not in p or '/preflight/preflight-' in p]
    integration = sorted((dest / 'supervision/verification').glob('integration-*/STARTER_INTEGRATION.json'))
    verification += [p.relative_to(dest).as_posix() for p in integration]
    verification += ['SOURCE_ADAPTATION_DIFF.json', 'SOURCE_ADAPTATION.patch', 'OWNER_BINDING_STEPS.txt']
    record = lambda rel: {'path': rel, 'sha256': sha((dest / rel).read_bytes()), 'bytes': (dest / rel).stat().st_size}
    manifest = {
        'status': 'FROZEN_OFFLINE_' + key.upper() + '_C49_HOST_READY_FOR_OWNER_FRESH_BINDING', 'frozenAt': now(),
        'root': str(dest), 'host': str(dest / 'host'), 'producer': str(REPO), 'namespace': 'deadlineCandidate47b:' + key + ':',
        'build': base['build'], 'candidate': None, 'intendedExistingCandidate': CANDIDATE,
        'activationAbsentAtFreeze': True, 'controlAbsentAtFreeze': True, 'sourceId': source['sourceId'], 'sourceConfigSha256': source['sourceConfigSha256'], 'officialEntryUrl': source['officialEntryUrl'],
        'publisherStatePath': str(R3 / 'PUBLISHER-ACTIVE-STATE.json'), 'publisherStateReadOrWrittenByWorker': False, 'loaderReconstructedNotOriginalBytes': True,
        'baseline': {'path': str(BASE / 'FROZEN_SOURCE_MANIFEST.json'), 'sha256': BASE_SHA, 'frozenSourceCount': 42, 'unchangedCount': 21, 'adaptedCount': 21, 'forbiddenRuntimeStateReadOrCopied': False},
        'recipe': {'path': str(Path(__file__).resolve()), 'sha256': sha(Path(__file__).read_bytes()), 'arguments': [key], 'allowedSources': list(ALLOWED), 'offlineOnly': True, 'overwriteAllowed': False},
        'sourceReferenceEvidence': [{'path': n, 'sha256': d} for n, d in REFS.items()],
        'files': [record(x['path']) for x in mappings], 'verificationFiles': [record(x) for x in verification],
        'checks': {'sourceScope': 'verification/SOURCE_SCOPE_RESULTS.json', 'crossSource': 'verification/CROSS_SOURCE_RESULTS.json', 'binding': 'verification/BINDING_RESULTS.json', 'contextCompiler': 'verification/OFFLINE_CONTEXT_COMPILE.json', 'commandRestoration': 'verification/COMMAND_RESTORATION.json', 'summary': 'verification/SMOKE_SUMMARY.json', 'allExecutedLocalChecksTerminal': True, 'realSourceSampled': False, 'networkUsed': False, 'databaseUsed': False},
        'ownerBindingSteps': 'OWNER_BINDING_STEPS.txt', 'notRun': ['Real C49 fresh readback or local binding', 'Candidate registration', 'Official HTTP or source capture', 'DB publication or public page verification', 'Full repository/historical fault suite'],
        'offPathDependencyGap': 'Legacy ARCHIVE_STORE needs source-specific archive audit/current Library helper; DB_STARTED does not call it. Remote retention/recovery PENDING.',
        'publicationScope': 'Only files[] and verificationFiles[] plus this manifest and SHA256 sidecar. No recursive host copy. Exclude synthetic control/bootstrap/artifacts and all later owner runtime state.'}
    if key == 'astellas':
        manifest['checks']['pdfDependency'] = 'verification/PDF_DEPENDENCY_CHECK.json'
    write_json(dest / 'FROZEN_SOURCE_MANIFEST.json', manifest)
    digest = sha((dest / 'FROZEN_SOURCE_MANIFEST.json').read_bytes())
    write_new(dest / 'FROZEN_SOURCE_MANIFEST.sha256', digest + '  FROZEN_SOURCE_MANIFEST.json\n')
    print(json.dumps({'source': key, 'status': manifest['status'], 'manifest': str(dest / 'FROZEN_SOURCE_MANIFEST.json'), 'sha256': digest, 'sourceFiles': 42, 'unchanged': 21, 'adapted': 21}), flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sources', choices=ALLOWED, nargs='+')
    args = parser.parse_args()
    require(len(set(args.sources)) == len(args.sources), 'DUPLICATE_SOURCE')
    inputs = load_inputs()
    # Reject any existing requested target before making the first change.
    for key in args.sources:
        target = R3 / 'hosts-next' / key
        no_links(target)
        require(not os.path.lexists(target), 'DESTINATION_ALREADY_EXISTS:' + str(target))
    for key in args.sources:
        prepare(key, *inputs)

if __name__ == '__main__':
    main()
