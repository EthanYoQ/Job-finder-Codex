#!/usr/bin/env python3
"""Local read-only packet review for the fixed TRUE_B delta host; never executes SQL."""
import datetime,hashlib,json,re,sys,subprocess
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec
_parser_spec=spec_from_file_location("host_machine_json",Path(__file__).resolve().parent/"machine-json.py")
_parser=module_from_spec(_parser_spec);_parser_spec.loader.exec_module(_parser)
host=Path(sys.argv[1]);run=Path(sys.argv[2]);request_id=sys.argv[3]
assert run.parent==host and re.fullmatch(r'[a-f0-9-]{36}',request_id)
cfg=json.loads((host/'host-config.json').read_text())
binding=json.loads((host/'activation.json').read_text());control=json.loads((host/'control-base.json').read_text())
assert binding['databaseIdentity']==control['databaseIdentity'] and binding['candidate']['version']>49
assert binding['status']=='REGISTERED_VERIFIED' and binding['candidate'] and binding['build']==control['build'] and binding['candidate']==control['candidate']
assert cfg['sourceId']=="source-servier-china-social" and cfg['sourceConfigSha256']=="3c87c89d3bdc74275a0b66a9a27a9eaf76f99da8ee7aa3af835eb87e2b028e17"
request=json.loads((run/'relay'/f'{request_id}.request.json').read_text())
assert request['kind']=='PUBLISH' and request['requestId']==request_id and request['payload']['projectId']==cfg['project']=='yiopvxysxrtrnvqxwgbx'
sql=(run/'relay'/f'{request_id}.request.json.sql').read_text();assert sql==request['payload']['sql']
packet_process=subprocess.run([cfg['node'],'--import',cfg['repo']+'/node_modules/tsx/dist/loader.mjs',str(Path(__file__).resolve().parent/'review-packet-envelope.mts'),str(run/'relay'/f'{request_id}.request.json')],text=True,capture_output=True)
def record_machine_output(value):
 with (run/'packet-machine-diagnostics.jsonl').open('a') as diagnostic:
  diagnostic.write(json.dumps({'requestId':request_id,'requestSha256':request['requestSha256'],'returncode':packet_process.returncode,**value})+'\n')
if packet_process.returncode!=0:
 record_machine_output({'stdout':packet_process.stdout,'stderr':packet_process.stderr,'recognizedWarningLines':[]})
 raise RuntimeError('HOST_PACKET_MACHINE_FAILED')
packet=_parser.parse_machine_json(packet_process.stdout,packet_process.stderr,record_machine_output)
row=packet['terminal']
assert packet['requestSha256']==request['requestSha256'] and packet['sqlSha256']==hashlib.sha256(sql.encode()).hexdigest()
now=datetime.datetime.now(datetime.timezone.utc).timestamp()
assert now<datetime.datetime.fromisoformat(request['expiresAt'].replace('Z','+00:00')).timestamp()
assert now<datetime.datetime.fromisoformat(request['payload']['dispatchBefore'].replace('Z','+00:00')).timestamp()
assert row['sourceId']==cfg['sourceId'] and row['sourceConfigHash']==cfg['sourceConfigSha256']
assert row['releaseCandidateId']==binding['candidate']['id'] and row['batchId']==run.name and row['id']==run.name+'--'+cfg['sourceId']
assert (row['transportState'],row['adapterState'],row['completenessState'],row['atomicCommitState'])==('SUCCEEDED','SUCCEEDED','VERIFIED','COMMITTED')
cert=packet['legacyCertificate'];assert cert['schemaVersion']=='b-grade-independent-traversal-v2' and cert['grade']=='B' and cert['validationPolicy']['execution']=='CURRENT_RUN'
proof_process=subprocess.run([cfg['node'],'--import',cfg['repo']+'/node_modules/tsx/dist/loader.mjs',str(Path(__file__).resolve().parent/'verify-servier-b-proof.mts'),str(run/'relay'/f'{request_id}.request.json'),str(run/'bootstrap.json')],text=True,capture_output=True)
if proof_process.returncode!=0:
 raise RuntimeError('SERVIER_B_NATIVE_PROOF_FAILED:'+proof_process.stderr)
bproof=_parser.parse_machine_json(proof_process.stdout,proof_process.stderr,lambda value:None)
assert bproof['requestId']==request_id and bproof['requestSha256']==request['requestSha256'] and bproof['sqlSha256']==packet['sqlSha256'] and bproof['bProof']['status']=='PASS'
bootstrap=json.loads((run/'bootstrap.json').read_text());descriptor=bootstrap['independentValidation']
independent_bytes=(run/'artifacts'/f'{run.name}.independent-validation.json').read_bytes()
assert hashlib.sha256(independent_bytes).hexdigest()==descriptor['sha256']==bproof['independentValidationSha256']
iv=json.loads(independent_bytes);assert iv==cert['independentValidation']
raw_rows=[item for page in iv['pages'] for item in page['rawRows']]
included=[item['sourceJobId'] for item in raw_rows if item['scopeDecision']=='INCLUDED_MAINLAND']
excluded=[item['sourceJobId'] for item in raw_rows if item['scopeDecision']=='EXCLUDED_AUDITED']
assert all(item['scopeMarker']=='UNKNOWN_GEOGRAPHY' for item in raw_rows if item['scopeDecision']=='EXCLUDED_AUDITED')
scope={'sql':sql};exec((Path(__file__).resolve().parent/'compact-json-review.inc.py').read_text(),scope)
assert scope['env']['source_result_data']==row
def recordsets(table):
    result=[]
    for match in re.finditer(r'FROM jsonb_populate_recordset\(NULL::public\."'+table+r'",\s*',sql):
        p=scope['Parser'](sql,match.end())
        if not p.take('(SELECT jsonb_agg('):
            parsed=p.expr();assert isinstance(parsed,list);result.extend(parsed);continue
        common=p.atom();assert isinstance(common,dict) and p.take('||') and p.take('jsonb_build_object(')
        fields=[]
        if not p.take(')'):
            while True:
                name=p.string();assert p.take(',') and p.take('tuple.value->');p.ws()
                number=re.match(r'\d+',sql[p.i:]);assert number;p.i+=len(number[0]);fields.append((name,int(number[0])))
                if p.take(')'):break
                assert p.take(',')
        assert p.take('ORDER BY tuple.ordinality)') and p.take('FROM jsonb_array_elements(')
        tuples=p.expr();assert isinstance(tuples,list)
        for values in tuples:
            assert isinstance(values,list);result.append({**common,**{key:values[index] for key,index in fields}})
    return result
losses=recordsets('LossLedgerEntry')
assert len(losses)==len(excluded)
for loss in losses:
    for key in ['releaseCandidateId','batchId','sourceId']:assert loss[key]==row[key]
    assert loss['sourceResultId']==row['id'] and loss['stage']=='VALIDATION'
    assert loss['reason']=='Servier official detail leaves workplace country unknown; posting remains open'
    assert loss['details']['code']=='SERVIER_WORKPLACE_COUNTRY_UNKNOWN' and loss['details']['field']=='locations' and loss['details']['noteCode']=='OFFICIAL_STATUS_OPEN_GEOGRAPHY_PENDING'
def sethash(values):return hashlib.sha256(json.dumps(sorted(set(values),key=lambda s:s.encode()),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
members=recordsets('LifecycleSetEvidenceMember');current=[m for m in members if m['setKind']=='CURRENT']
assert len(current)==len({m['jobKey'] for m in current})==row['dedupeOutputCount']
for member in members:
    for key in ['releaseCandidateId','batchId','sourceId']:assert member[key]==row[key]
    assert member['sourceResultId']==row['id']
assert sethash([m['jobKey'] for m in current])==row['canonicalCurrentJobSetSha256']
assert sethash([r['sourceJobId'] for r in raw_rows])==cert['mainTraversal']['canonicalRawMatchKeySetSha256']
assert sethash(included)==cert['mainTraversal']['canonicalMatchKeySetSha256'] and sethash(excluded)==cert['mainTraversal']['canonicalExcludedMatchKeySetSha256']
assert cert['counts']['mainUniqueJobCount']==cert['counts']['independentUniqueJobCount']==cert['counts']['finalUniqueJobCount']==len(included)
assert row['parseDiscardCount']==row['normalizationDiscardCount']==row['dedupeDiscardCount']==0
assert cert['output']['canonicalJobSetSha256']==row['canonicalCurrentJobSetSha256']==row['canonicalOutputSetSha256']
assert row['expectedJobCount'] is None and row['expectedEvidenceKind']=='COMPLETE_PAGE_TRAVERSAL'
assert not re.search(r'^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\s',sql,re.M)
tables=sorted(set(re.findall(r'(?:INSERT INTO|UPDATE) public\."([A-Za-z]+)"',sql)))
assert set(tables)<=set(['CrawlCoordinatorLock','RecruitmentSource','OfficialCareerEntry','OfficialCareerSurface','CrawlBatch','CrawlBatchSourceResult','CrawlObservation','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','LifecycleSetEvidenceMember','TransportAttemptEvidence','Job'])
assert all(x in sql for x in ['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;','portable-quality-sync-v1:released'])
assert 'SET CONSTRAINTS ALL IMMEDIATE' not in sql
a=run/'artifacts'/f'{run.name}.archive.json';assert a.is_file()
r={'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'sqlBytes':len(sql.encode()),'requestId':request_id,'requestSha256':request['requestSha256'],'sourceResult':{k:row[k] for k in ['id','releaseCandidateId','sourceId','sourceConfigHash','startedAt','finishedAt','rawCount','validCount','dedupeOutputCount','canonicalCurrentJobSetSha256','completenessCertificateSha256']},'certificate':cert,'bProof':bproof['bProof'],'persistedUnknownGeographyLossCount':len(losses),'persistedCurrentMemberCount':len(current),'acquisition':{'startedAt':row['startedAt'],'finishedAt':row['finishedAt'],'expiryBasis':'min(source.startedAt+30min, independent.expiresAt, independent.observedAt+1h)'},'delta':packet['delta'],'declarationMode':packet['declarationMode'],'tables':tables,'archiveSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'archiveBytes':a.stat().st_size,'noDdlOrDelete':True,'atomicFinalizationAndRelease':True}
with (run/'publication-review.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r))
