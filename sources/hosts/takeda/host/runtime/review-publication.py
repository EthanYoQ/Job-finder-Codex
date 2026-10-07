#!/usr/bin/env python3
"""Local read-only packet review for the four restored portable hosts; never executes SQL."""
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
assert cfg['sourceId']=="source-takeda-china-social" and cfg['sourceConfigSha256']=="048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f"
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
cert=packet['legacyCertificate'];assert cert['schemaVersion']=='plan-bound-source-quality-v1' and cert['policyId']=='PLAN_BOUND_SOURCE_QUALITY_V1'
for k,field in [('sourceId','sourceId'),('sourceResultId','id'),('batchId','batchId'),('releaseCandidateId','releaseCandidateId'),('sourceConfigSha256','sourceConfigHash')]:assert cert['binding'][k]==row[field]
assert cert['counts']['rawCount']==row['rawCount'] and cert['counts']['finalUniqueJobCount']==row['dedupeOutputCount']
assert cert['output']['canonicalJobKeySetSha256']==row['canonicalCurrentJobSetSha256']==row['canonicalOutputSetSha256']
assert not re.search(r'^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\s',sql,re.M)
tables=sorted(set(re.findall(r'(?:INSERT INTO|UPDATE) public\."([A-Za-z]+)"',sql)))
assert set(tables)<=set(['CrawlCoordinatorLock','RecruitmentSource','OfficialCareerEntry','OfficialCareerSurface','CrawlBatch','CrawlBatchSourceResult','CrawlObservation','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','LifecycleSetEvidenceMember','TransportAttemptEvidence','Job'])
assert all(x in sql for x in ['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;','portable-quality-sync-v1:released'])
assert 'SET CONSTRAINTS ALL IMMEDIATE' not in sql
a=run/'artifacts'/f'{run.name}.archive.json';assert a.is_file()
r={'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'sqlBytes':len(sql.encode()),'requestId':request_id,'requestSha256':request['requestSha256'],'sourceResult':{k:row[k] for k in ['id','releaseCandidateId','sourceId','sourceConfigHash','startedAt','finishedAt','rawCount','validCount','dedupeOutputCount','canonicalCurrentJobSetSha256','completenessCertificateSha256']},'acquisition':cert['acquisition'],'delta':packet['delta'],'declarationMode':packet['declarationMode'],'tables':tables,'archiveSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'archiveBytes':a.stat().st_size,'noDdlOrDelete':True,'atomicFinalizationAndRelease':True}
with (run/'publication-review.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r))
