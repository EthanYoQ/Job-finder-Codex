#!/usr/bin/env python3
"""Actual source reviewers, synthetic packets only; no SQL or real captured content."""
import datetime, hashlib, json, os, subprocess, sys, uuid
from pathlib import Path
HOST = Path(sys.argv[1]).resolve()
CFG = json.loads((HOST/'host-config.json').read_text())
CANDIDATE = json.loads((HOST/'control-base.json').read_text())['candidate']['id']
PROJECT = CFG['project']
SHA = lambda data: hashlib.sha256(data).hexdigest()
ENV = {**os.environ, 'PYTHONDONTWRITEBYTECODE':'1', 'PYTHONOPTIMIZE':''}
RESULTS=[]
def dump(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x') as f: json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')
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


parent=HOST/'preparation'/'NONQUAL-REVIEWER-CASES'
assert not parent.exists()
reviewer=HOST/'runtime/review-publication.py'
source_id=CFG['sourceId'];config_sha=CFG['sourceConfigSha256']
run_review(parent,reviewer,source_id,config_sha,'valid-own-source',accept=True)
def new_counts(p):
    p['row']['rawCount']=103;p['row']['validCount']=101;p['row']['dedupeOutputCount']=99
    p['row']['completenessCertificate']['counts']['rawCount']=103
    p['row']['completenessCertificate']['counts']['finalUniqueJobCount']=99
run_review(parent,reviewer,source_id,config_sha,'valid-own-source-different-counts',new_counts,accept=True)
for other in ['source-fosun-pharma-social','source-kelun-social','source-boehringer-ingelheim-china-social','source-merck-china-social','source-organon-china-social','source-unknown-china-social']:
    if other!=source_id:run_review(parent,reviewer,source_id,config_sha,'foreign-scope-'+other,foreign_scope(other))
cases={
    'wrong-source':row_set('sourceId','source-wrong-social'),
    'wrong-config':row_set('sourceConfigHash','0'*64),
    'wrong-candidate':row_set('releaseCandidateId','dot-cloud-restored-fb0b8e3-20261004'),
    'wrong-batch':row_set('batchId','NONQUAL-WRONG'),
    'wrong-result':row_set('id','NONQUAL-WRONG'),
    'wrong-host-config':lambda p:p['cfg'].__setitem__('sourceConfigSha256','0'*64),
    'failed-transport':row_set('transportState','FAILED'),
    'failed-adapter':row_set('adapterState','FAILED'),
    'unverified-completeness':row_set('completenessState','UNKNOWN'),
    'unknown-commit':row_set('atomicCommitState','UNKNOWN'),
    'wrong-policy':lambda p:p['row']['completenessCertificate'].__setitem__('policyId','WRONG'),
    'wrong-schema':lambda p:p['row']['completenessCertificate'].__setitem__('schemaVersion','a-grade-official-total-v2'),
    'wrong-raw-count':nested_set('counts','rawCount',999),
    'wrong-dedupe-count':nested_set('counts','finalUniqueJobCount',999),
    'wrong-output-hash':nested_set('output','canonicalJobKeySetSha256','0'*64),
    'wrong-current-set':row_set('canonicalCurrentJobSetSha256','0'*64),
    'wrong-output-set':row_set('canonicalOutputSetSha256','0'*64),
    'wrong-project':lambda p:p.__setitem__('project','WRONG'),
    'wrong-kind':lambda p:p.__setitem__('kind','READ_CONTEXT'),
    'wrong-request-id':lambda p:p.__setitem__('requestIdMismatch',True),
    'sql-file-mismatch':lambda p:p.__setitem__('sqlMismatch',True),
    'missing-archive':lambda p:p.__setitem__('archive',False),
    'unapproved-table':lambda p:p.__setitem__('sqlSuffix','UPDATE public."SyntheticUnapprovedTable" SET id=id;\n')
}
for field in ['sourceId','sourceResultId','batchId','releaseCandidateId','sourceConfigSha256']:
    cases['certificate-'+field]=nested_set('binding',field,'WRONG')
for op in ['CREATE','ALTER','DROP','TRUNCATE','DELETE']:
    cases['forbidden-'+op]=lambda p,op=op:p.__setitem__('sqlSuffix',op+' TABLE synthetic_fixture;\n')
for token in ['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released']:
    cases['missing-'+token]=lambda p,token=token:p.__setitem__('removeToken',token)
for name,mutation in cases.items():run_review(parent,reviewer,source_id,config_sha,name,mutation)
report={'schemaVersion':1,'scope':'NON_QUALIFYING_SYNTHETIC_REVIEWER_PACKETS','sourceId':source_id,'passed':True,'totalCases':len(RESULTS),'acceptedCases':sum(x['expected']=='ACCEPT' for x in RESULTS),'rejectedCases':sum(x['expected']=='REJECT' for x in RESULTS),'dynamicOwnSourceCountsVerified':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'sqlExecuted':False,'producerLaunched':False,'qualifiesForLaunch':False,'reviewerSha256':SHA(reviewer.read_bytes()),'cases':RESULTS}
dump(HOST/'REVIEWER_CHECKS.json',report)
print(json.dumps({k:report[k] for k in ['sourceId','passed','totalCases','acceptedCases','rejectedCases']}))
