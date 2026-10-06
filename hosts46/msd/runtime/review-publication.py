import json,re,hashlib,datetime,sys
from pathlib import Path
host,run=Path(sys.argv[1]),Path(sys.argv[2]);rid=sys.argv[3]
assert run.parent==host
cfg=json.loads((host/'host-config.json').read_text());req=json.loads((run/'relay'/f'{rid}.request.json').read_text());sql=(run/'relay'/f'{rid}.request.json.sql').read_text()
assert cfg['sourceId']=="source-msd-china-social" and cfg['sourceConfigSha256']=="7772b32344c3485af4cb54e3ad17a7a78335800282682450da213c7544f6fc30"
assert req['kind']=='PUBLISH' and req['payload']['projectId']==cfg['project']=='yiopvxysxrtrnvqxwgbx' and req['payload']['sql']==sql
assert req['schemaVersion']==1 and req['requestId']==rid and re.fullmatch(r'[a-f0-9-]{36}',rid)
body={k:v for k,v in req.items() if k!='requestSha256'}
assert hashlib.sha256(json.dumps(body,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==req['requestSha256']
assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(req['expiresAt'].replace('Z','+00:00'))
scope={'sql':sql};exec((Path(__file__).parent/'compact-json-review.inc.py').read_text(),scope);row=scope['env']['source_result_data'];cert=row['completenessCertificate']
assert row['sourceId']==cfg['sourceId'] and row['sourceConfigHash']==cfg['sourceConfigSha256'] and row['batchId']==run.name and row['id']==run.name+'--'+cfg['sourceId'] and row['releaseCandidateId']=='dot-cloud-restored-fb0b8e3-20261005T2028Z'
assert [row[k] for k in ['transportState','adapterState','completenessState','atomicCommitState']]==['SUCCEEDED','SUCCEEDED','VERIFIED','COMMITTED']
assert cert['schemaVersion']=='a-grade-official-total-v2' and cert['grade']=='A' and cert['scope']['verificationPolicy']=='STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1'
assert hashlib.sha256(json.dumps(cert,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==row['completenessCertificateSha256']
for a,b in [('sourceId','sourceId'),('sourceResultId','id'),('batchId','batchId'),('releaseCandidateId','releaseCandidateId'),('sourceConfigSha256','sourceConfigHash')]:assert cert['binding'][a]==row[b]
assert cert['counts']['rawObservationCount']==row['rawCount'] and cert['counts']['finalUniqueJobCount']==row['dedupeOutputCount']
assert cert['output']['canonicalJobSetSha256']==row['canonicalCurrentJobSetSha256']==row['canonicalOutputSetSha256']
assert cert['declaration']['kind']=='OFFICIAL_TOTAL_COUNT'
assert not re.search(r'^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\s',sql,re.M)
tables=sorted(set(re.findall(r'(?:INSERT INTO|UPDATE) public\."([A-Za-z]+)"',sql)))
assert set(tables)<=set(['CrawlCoordinatorLock','RecruitmentSource','OfficialCareerEntry','OfficialCareerSurface','CrawlBatch','CrawlBatchSourceResult','CrawlObservation','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','LifecycleSetEvidenceMember','TransportAttemptEvidence','Job'])
assert all(x in sql for x in ['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released'])
assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(req['payload']['dispatchBefore'].replace('Z','+00:00'))
a=run/'artifacts'/f'{run.name}.archive.json';assert a.is_file()
report={'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestId':rid,'requestSha256':req['requestSha256'],'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'sqlBytes':len(sql.encode()),'sourceResult':{k:row[k] for k in ['id','releaseCandidateId','sourceId','sourceConfigHash','startedAt','finishedAt','rawCount','validCount','dedupeOutputCount','canonicalCurrentJobSetSha256','completenessCertificateSha256']},'certificate':cert,'tables':tables,'archiveSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'archiveBytes':a.stat().st_size,'noDdlOrDelete':True,'atomicFinalizationAndRelease':True}
with (run/'publication-review.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report))
