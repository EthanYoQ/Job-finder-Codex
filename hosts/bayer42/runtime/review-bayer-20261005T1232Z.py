import json,re,hashlib,sys,datetime
from pathlib import Path
run=Path(sys.argv[1]); rid=sys.argv[2]
req=json.loads((run/'relay'/f'{rid}.request.json').read_text()); sql=(run/'relay'/f'{rid}.request.json.sql').read_text()
assert req['payload']['sql']==sql and req['kind']=='PUBLISH' and req['payload']['projectId']=='yiopvxysxrtrnvqxwgbx'
env={}
class Parser:
 def __init__(self,s,i=0):self.s=s;self.i=i
 def ws(self):
  while self.i<len(self.s) and self.s[self.i].isspace():self.i+=1
 def take(self,t):
  self.ws()
  if self.s.startswith(t,self.i):self.i+=len(t);return True
  return False
 def string(self):
  assert self.take("E'");out=''
  while True:
   c=self.s[self.i];self.i+=1
   if c=="'":
    if self.s[self.i:self.i+1]=="'":out+="'";self.i+=1
    else:return out
   elif c=='\\':out+=self.s[self.i];self.i+=1
   else:out+=c
 def atom(self):
  self.ws()
  if self.s.startswith("E'",self.i):
   v=self.string();return json.loads(v) if self.take('::jsonb') else v
  if self.take('('):
   v=self.expr();assert self.take(')');return v
  for f in ['jsonb_build_object','jsonb_build_array']:
   if self.take(f):
    assert self.take('(');a=[]
    if not self.take(')'):
     while True:
      a.append(self.expr())
      if self.take(')'):break
      assert self.take(',')
    if f=='jsonb_build_array':return a
    assert len(a)%2==0;return dict(zip(a[::2],a[1::2]))
  m=re.match(r'atomic_json_\d+',self.s[self.i:]);assert m,self.s[self.i:self.i+80];self.i+=len(m[0]);return env[m[0]]
 def expr(self):
  v=self.atom()
  while self.take('||'):
   b=self.atom()
   if isinstance(v,dict) and isinstance(b,dict):v={**v,**b}
   elif isinstance(v,list) and isinstance(b,list):v=v+b
   else:raise AssertionError('unexpected concat')
  return v
for m in re.finditer(r'(atomic_json_\d+|source_result_data) jsonb := ',sql):
 p=Parser(sql,m.end());env[m[1]]=p.expr();assert p.take(';')
row=env['source_result_data'];cert=row['completenessCertificate'];cfg=json.loads((run.parent/'host-config.json').read_text())
assert row['id']==run.name+'--'+cfg['sourceId'] and row['batchId']==run.name and row['sourceId']=='source-bayer-healthcare-social'
assert row['releaseCandidateId']=='dot-cloud-restored-fb0b8e3-20261004' and row['sourceConfigHash']==cfg['sourceConfigSha256']
assert [row[k] for k in ['transportState','adapterState','completenessState','atomicCommitState']]==['SUCCEEDED','SUCCEEDED','VERIFIED','COMMITTED']
assert (row['rawCount'],row['parsedCount'],row['validCount'],row['dedupeOutputCount'],row['validationDiscardCount'])==(32,32,30,30,2)
assert cert['schemaVersion']=='b-grade-independent-traversal-v2' and cert['validationPolicy']['execution']=='CURRENT_RUN'
for a,b in [('sourceId','sourceId'),('sourceResultId','id'),('batchId','batchId'),('releaseCandidateId','releaseCandidateId'),('sourceConfigSha256','sourceConfigHash')]:assert cert['binding'][a]==row[b]
iv=json.loads((run/'artifacts'/f'{run.name}.independent-validation.json').read_text());assert iv['observedAt']=='2026-10-05T12:24:51.189Z' and iv['artifactSha256']=='1c12c8b2e751f182df3ae455d1e535f0ca053c469665785114f6c7a4232a3a05'
assert iv['canonicalMatchKeySetSha256']==cert['mainTraversal']['canonicalMatchKeySetSha256']
assert cert['output']['canonicalJobSetSha256']==row['canonicalCurrentJobSetSha256']==row['canonicalVisibleJobSetSha256']
assert cert['counts']['mainUniqueJobCount']==cert['counts']['independentUniqueJobCount']==cert['counts']['finalUniqueJobCount']==30
assert not re.search(r'^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\s',sql,re.M)
tables=sorted(set(re.findall(r'(?:INSERT INTO|UPDATE) public\."([A-Za-z]+)"',sql)))
assert set(tables)<=set(['CrawlCoordinatorLock','RecruitmentSource','OfficialCareerEntry','OfficialCareerSurface','CrawlBatch','CrawlBatchSourceResult','CrawlObservation','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','LifecycleSetEvidenceMember','TransportAttemptEvidence','Job'])
assert all(x in sql for x in ['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released'])
loss_start=sql.index('INSERT INTO public."LossLedgerEntry"');loss_end=sql.index(';',loss_start);loss_sql=sql[loss_start:loss_end]
literals=[]
for m in re.finditer(r"E'",loss_sql):
 try:
  p=Parser(loss_sql,m.start());v=p.atom()
  if isinstance(v,(dict,list)):literals.append(v)
 except Exception:pass
loss_arrays=[v for v in literals if isinstance(v,list) and len(v)==2];assert len(loss_arrays)==1
loss_tuples=loss_arrays[0];assert all('BAYER_OFFICIAL_PAUSED' in json.dumps(v) for v in loss_tuples)
assert len({v[0] for v in loss_tuples})==2
assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(req['payload']['dispatchBefore'].replace('Z','+00:00'))
a=run/'artifacts'/f'{run.name}.archive.json'
report={'reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'requestId':rid,'requestSha256':req['requestSha256'],'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'sqlBytes':len(sql.encode()),'sourceResult':{k:row[k] for k in ['id','releaseCandidateId','sourceId','sourceConfigHash','startedAt','finishedAt','rawCount','validCount','dedupeOutputCount','canonicalCurrentJobSetSha256','completenessCertificateSha256']},'certificate':{k:cert[k] for k in ['schemaVersion','mainTraversal','validationPolicy','counts','issuedAt']},'independentObservedAt':iv['observedAt'],'independentArtifactSha256':iv['artifactSha256'],'persistedPausedLossRows':2,'tables':tables,'archiveSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'archiveBytes':a.stat().st_size,'noDdlOrDelete':True,'atomicFinalizationAndRelease':True,'fullCertificateExtracted':True}
(run/'reviewed-source-result.private.json').write_text(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
with (run/'publication-review.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report))
