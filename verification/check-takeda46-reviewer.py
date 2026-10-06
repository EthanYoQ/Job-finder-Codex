#!/usr/bin/env python3
"""Offline CLI regression: run the actual Takeda reviewer on synthetic packets.

No SQL is executed. Packet files live only in a disposable temporary directory.
The accepted fixture exercises the reviewer contract, not production evidence admission.
"""
import datetime, hashlib, json, os, re, subprocess, sys, tempfile, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
R2 = HERE.parent
CANDIDATE = 'dot-cloud-restored-fb0b8e3-20261005T2028Z'
PROJECT = 'yiopvxysxrtrnvqxwgbx'
SHA = lambda data: hashlib.sha256(data).hexdigest()
ENV = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONOPTIMIZE': '', 'TSX_DISABLE_CACHE': '1', 'NODE_DISABLE_COMPILE_CACHE': '1'}
RESULTS = []

def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def fixture(source_id, config_sha, batch):
    row = {'id': batch + '--' + source_id, 'releaseCandidateId': CANDIDATE, 'sourceId': source_id, 'sourceConfigHash': config_sha, 'batchId': batch, 'startedAt': '2000-01-01T00:00:00Z', 'finishedAt': '2000-01-01T00:00:01Z', 'rawCount': 2, 'validCount': 2, 'dedupeOutputCount': 2, 'transportState': 'SUCCEEDED', 'adapterState': 'SUCCEEDED', 'completenessState': 'VERIFIED', 'atomicCommitState': 'COMMITTED', 'canonicalCurrentJobSetSha256': SHA(b'SYNTHETIC_ONLY_JOB_KEYS'), 'canonicalOutputSetSha256': SHA(b'SYNTHETIC_ONLY_JOB_KEYS')}
    cert = {'schemaVersion': 'plan-bound-source-quality-v1', 'policyId': 'PLAN_BOUND_SOURCE_QUALITY_V1', 'binding': {key: row[field] for key, field in [('sourceId', 'sourceId'), ('sourceResultId', 'id'), ('batchId', 'batchId'), ('releaseCandidateId', 'releaseCandidateId'), ('sourceConfigSha256', 'sourceConfigHash')]}, 'counts': {'rawCount': row['rawCount'], 'finalUniqueJobCount': row['dedupeOutputCount']}, 'output': {'canonicalJobKeySetSha256': row['canonicalCurrentJobSetSha256']}, 'acquisition': {'startedAt': row['startedAt'], 'finishedAt': row['finishedAt']}}
    row['completenessCertificate'] = cert
    row['completenessCertificateSha256'] = SHA(json.dumps(cert, sort_keys=True, separators=(',', ':')).encode())
    return {'cfg': {'sourceId': source_id, 'sourceConfigSha256': config_sha, 'project': PROJECT}, 'row': row, 'kind': 'PUBLISH', 'project': PROJECT, 'sqlSuffix': '', 'removeToken': None, 'archive': True, 'sqlMismatch': False, 'requestIdMismatch': False}

def sql_text(packet):
    literal = json.dumps(packet['row'], ensure_ascii=False, separators=(',', ':')).replace('\\', '\\\\').replace("'", "\\'")
    # Valid PL/pgSQL-shaped fixture with no mutating statement and no production data.
    # These tokens exercise the existing reviewer's atomic-finalization string guards.
    sql = "-- NON_QUALIFYING_SYNTHETIC_REVIEW_ONLY; NEVER DISPATCH\nDO $synthetic_review$\nDECLARE source_result_data jsonb := E'" + literal + "'::jsonb;\nBEGIN\n"
    sql += "IF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_COMMITTED_EXACT_SOURCE_REQUIRED'; END IF;\n"
    sql += "IF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_CURRENT_MEMBERS_DRIFT'; END IF;\n"
    sql += "SET CONSTRAINTS ALL IMMEDIATE;\nPERFORM 'portable-quality-sync-v1:released';\nEND;\n$synthetic_review$;\n"
    sql += packet['sqlSuffix']
    if packet['removeToken']:
        sql = sql.replace(packet['removeToken'], 'SYNTHETIC_REMOVED_TOKEN')
    return sql

def run_review(parent, reviewer, source_id, config_sha, name, mutation=None, accept=False):
    host = parent / name
    batch = 'NONQUAL-' + name
    run = host / batch
    relay = run / 'relay'
    relay.mkdir(parents=True)
    packet = fixture(source_id, config_sha, batch)
    if mutation:
        mutation(packet)
    request_id = str(uuid.uuid4())
    sql = sql_text(packet)
    request = {'schemaVersion': 1, 'requestId': str(uuid.uuid4()) if packet['requestIdMismatch'] else request_id, 'kind': packet['kind'], 'expiresAt': '2099-01-01T00:00:00Z', 'payload': {'projectId': packet['project'], 'sql': sql}}
    request['requestSha256'] = SHA(json.dumps(request, separators=(',', ':')).encode())
    dump(host / 'host-config.json', packet['cfg'])
    dump(relay / (request_id + '.request.json'), request)
    (relay / (request_id + '.request.json.sql')).write_text(sql + ('\n-- MISMATCH' if packet['sqlMismatch'] else ''))
    archive_bytes = b'{"purpose":"NON_QUALIFYING_SYNTHETIC_REVIEW_ONLY","artifacts":[]}\n'
    if packet['archive']:
        (run / 'artifacts').mkdir()
        (run / 'artifacts' / (batch + '.archive.json')).write_bytes(archive_bytes)
    completed = subprocess.run([sys.executable, '-B', str(reviewer), str(host), str(run), request_id], capture_output=True, text=True, env=ENV, timeout=15)
    output = run / 'publication-review.json'
    if accept:
        assert completed.returncode == 0, (source_id, name, completed.stderr)
        review = json.loads(output.read_text())
        assert review == json.loads(completed.stdout)
        assert review['sqlSha256'] == SHA(sql.encode()) and review['sqlBytes'] == len(sql.encode())
        assert review['sourceResult']['sourceId'] == source_id and review['sourceResult']['sourceConfigHash'] == config_sha
        assert review['archiveSha256'] == SHA(archive_bytes) and review['archiveBytes'] == len(archive_bytes)
        assert review['requestId'] == request_id and review['noDdlOrDelete'] and review['atomicFinalizationAndRelease']
    else:
        assert completed.returncode != 0 and not output.exists(), (source_id, name, 'unexpected acceptance', completed.stdout)
    RESULTS.append({'sourceId': source_id, 'case': name, 'expected': 'ACCEPT' if accept else 'REJECT', 'actualExit': completed.returncode, 'reviewFileCreated': output.exists(), 'passed': True})

def row_set(field, value):
    return lambda p: p['row'].__setitem__(field, value)

def nested_set(section, field, value):
    return lambda p: p['row']['completenessCertificate'][section].__setitem__(field, value)

def foreign_scope(other):
    def mutate(packet):
        replacement = fixture(other, packet['cfg']['sourceConfigSha256'], packet['row']['batchId'])
        packet.clear()
        packet.update(replacement)
    return mutate

config = json.loads((R2 / 'hosts46/takeda/host-config.json').read_text())
reviewer = R2 / 'hosts46/takeda/runtime/review-publication.py'
source_id=config['sourceId']; config_sha=config['sourceConfigSha256']
with tempfile.TemporaryDirectory(prefix='takeda46-review-') as temporary:
    parent=Path(temporary)
    for count in [1,109,111]:
        def dynamic(p,n=count):
            for field in ['rawCount','validCount','dedupeOutputCount']:p['row'][field]=n
            p['row']['completenessCertificate']['counts']={'rawCount':n,'finalUniqueJobCount':n}
        run_review(parent,reviewer,source_id,config_sha,'dynamic-count-'+str(count),dynamic,accept=True)
    cases={
        'row-source-mismatch':row_set('sourceId','source-merck-china-social'),
        'row-candidate-mismatch':row_set('releaseCandidateId','dot-cloud-restored-fb0b8e3-20261004'),
        'row-config-mismatch':row_set('sourceConfigHash','0'*64),
        'row-batch-mismatch':row_set('batchId','NONQUAL-WRONG'),
        'row-result-id-mismatch':row_set('id','NONQUAL-WRONG'),
        'cfg-source-mismatch':lambda p:p['cfg'].__setitem__('sourceId','source-merck-china-social'),
        'cfg-config-mismatch':lambda p:p['cfg'].__setitem__('sourceConfigSha256','0'*64),
        'foreign-source-coherent-packet':foreign_scope('source-merck-china-social'),
        'transport-failed':row_set('transportState','FAILED'),
        'adapter-failed':row_set('adapterState','FAILED'),
        'atomic-unknown':row_set('atomicCommitState','UNKNOWN'),
        'completeness-unknown':row_set('completenessState','UNKNOWN'),
        'raw-count-mismatch':nested_set('counts','rawCount',77),
        'dedupe-count-mismatch':nested_set('counts','finalUniqueJobCount',77),
        'output-set-mismatch':row_set('canonicalOutputSetSha256','0'*64),
        'current-set-mismatch':row_set('canonicalCurrentJobSetSha256','0'*64),
        'certificate-output-mismatch':nested_set('output','canonicalJobKeySetSha256','0'*64),
        'project-mismatch':lambda p:p.__setitem__('project','SYNTHETIC_WRONG'),
        'kind-mismatch':lambda p:p.__setitem__('kind','READ_CONTEXT'),
        'request-id-mismatch':lambda p:p.__setitem__('requestIdMismatch',True),
        'sql-bytes-mismatch':lambda p:p.__setitem__('sqlMismatch',True),
        'archive-missing':lambda p:p.__setitem__('archive',False),
        'unapproved-table':lambda p:p.__setitem__('sqlSuffix','UPDATE public."SyntheticTable" SET id=id;'),
    }
    for field in ['sourceId','sourceResultId','batchId','releaseCandidateId','sourceConfigSha256']:cases['certificate-binding-'+field]=nested_set('binding',field,'SYNTHETIC_WRONG')
    for operation in ['CREATE','ALTER','DROP','TRUNCATE','DELETE']:cases['forbidden-'+operation]=lambda p,op=operation:p.__setitem__('sqlSuffix',op+' TABLE synthetic_fixture;')
    for i,token in enumerate(['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released']):cases['missing-token-'+str(i)]=lambda p,t=token:p.__setitem__('removeToken',t)
    for name,change in cases.items():run_review(parent,reviewer,source_id,config_sha,name,change)
report={'schemaVersion':1,'passed':True,'sourceId':source_id,'reviewerSha256':SHA(reviewer.read_bytes()),'cases':RESULTS,'totalCases':len(RESULTS),'acceptedCases':3,'sourceNetworkAccessed':False,'databaseAccessed':False,'sqlExecuted':False,'producerLaunched':False,'limits':['Synthetic reviewer-contract fixtures are not compiler-issued production packets or source-quality admission evidence. Counts 1/109/111 test dynamic agreement only and are never capture targets.']}
dump(R2/'hosts46/takeda/REVIEWER_CHECKS.json',report)
print(json.dumps({k:report[k] for k in ['passed','totalCases','acceptedCases','reviewerSha256','sqlExecuted']}))
