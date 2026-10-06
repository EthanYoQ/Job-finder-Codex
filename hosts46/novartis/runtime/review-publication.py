#!/usr/bin/env python3
"""Local read-only packet review for the Novartis restored portable host; never executes SQL."""
import datetime,hashlib,json,re,sys
from pathlib import Path
host=Path(sys.argv[1]);run=Path(sys.argv[2]);request_id=sys.argv[3]
assert run.parent==host and re.fullmatch(r'[a-f0-9-]{36}',request_id)
cfg=json.loads((host/'host-config.json').read_text())
assert cfg['sourceId']=='source-novartis-social' and cfg['sourceConfigSha256']=='1dcb83b63182c3b496a1137678baae55201276b4e041b60b6cbe1fab30990a91'
assert cfg['root']==str(host)
# Retain the original certificate/count/hash/atomic-publication gates below.
# Historic 155 and default 114 are not target counts or completeness authority.
request=json.loads((run/'relay'/f'{request_id}.request.json').read_text())
assert request['kind']=='PUBLISH' and request['requestId']==request_id and request['payload']['projectId']==cfg['project']=='yiopvxysxrtrnvqxwgbx'
assert request['schemaVersion']==1
body={k:v for k,v in request.items() if k!='requestSha256'}
assert hashlib.sha256(json.dumps(body,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==request['requestSha256']
now=datetime.datetime.now(datetime.timezone.utc)
assert now<datetime.datetime.fromisoformat(request['expiresAt'].replace('Z','+00:00'))
assert now<datetime.datetime.fromisoformat(request['payload']['dispatchBefore'].replace('Z','+00:00'))
sql=(run/'relay'/f'{request_id}.request.json.sql').read_text();assert sql==request['payload']['sql']
m=re.search(r"source_result_data jsonb := E'((?:\\.|[^'])*)'::jsonb",sql);assert m
row=json.loads(re.sub(r"\\([\\'])",r"\1",m.group(1)))
assert row['sourceId']==cfg['sourceId'] and row['sourceConfigHash']==cfg['sourceConfigSha256']
assert row['releaseCandidateId']=='dot-cloud-restored-fb0b8e3-20261005T2028Z' and row['batchId']==run.name and row['id']==run.name+'--'+cfg['sourceId']
assert (row['transportState'],row['adapterState'],row['completenessState'],row['atomicCommitState'])==('SUCCEEDED','SUCCEEDED','VERIFIED','COMMITTED')
cert=row['completenessCertificate'];assert cert['schemaVersion']=='plan-bound-source-quality-v1' and cert['policyId']=='PLAN_BOUND_SOURCE_QUALITY_V1'
assert hashlib.sha256(json.dumps(cert,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==row['completenessCertificateSha256']
assert cert['companyId']=='company-novartis' and cert['declaredCompleteness']['kind']=='OFFICIAL_TOTAL_PAGES'
for k,field in [('sourceId','sourceId'),('sourceResultId','id'),('batchId','batchId'),('releaseCandidateId','releaseCandidateId'),('sourceConfigSha256','sourceConfigHash')]:assert cert['binding'][k]==row[field]
assert cert['counts']['rawCount']==row['rawCount'] and cert['counts']['finalUniqueJobCount']==row['dedupeOutputCount']
assert cert['output']['canonicalJobKeySetSha256']==row['canonicalCurrentJobSetSha256']==row['canonicalOutputSetSha256']
assert not re.search(r'^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\s',sql,re.M)
tables=sorted(set(re.findall(r'(?:INSERT INTO|UPDATE) public\."([A-Za-z]+)"',sql)))
assert set(tables)<=set(['CrawlCoordinatorLock','RecruitmentSource','OfficialCareerEntry','OfficialCareerSurface','CrawlBatch','CrawlBatchSourceResult','CrawlObservation','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','LifecycleSetEvidenceMember','TransportAttemptEvidence','Job'])
assert all(x in sql for x in ['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released'])
a=run/'artifacts'/f'{run.name}.archive.json';assert a.is_file()
r={'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'sqlBytes':len(sql.encode()),'requestId':request_id,'requestSha256':request['requestSha256'],'sourceResult':{k:row[k] for k in ['id','releaseCandidateId','sourceId','sourceConfigHash','startedAt','finishedAt','rawCount','validCount','dedupeOutputCount','canonicalCurrentJobSetSha256','completenessCertificateSha256']},'acquisition':cert['acquisition'],'tables':tables,'archiveSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'archiveBytes':a.stat().st_size,'noDdlOrDelete':True,'atomicFinalizationAndRelease':True}
with (run/'publication-review.json').open('x') as f:json.dump(r,f,indent=2);f.write('\n')
print(json.dumps(r))
