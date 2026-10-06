#!/usr/bin/env python3
"""Actual Novartis reviewer on dynamic synthetic packets; no SQL execution or source access."""
import copy,datetime,hashlib,json,os,subprocess,sys,tempfile,uuid
from pathlib import Path
R=Path(__file__).resolve().parent.parent;HOST=R/'hosts46/novartis';CFG=json.loads((HOST/'host-config.json').read_text());RESULTS=[]
sha=lambda b:hashlib.sha256(b).hexdigest();compact=lambda v:json.dumps(v,ensure_ascii=False,separators=(',',':'));canonical=lambda v:json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def fixture(batch,count):
 row={'id':batch+'--'+CFG['sourceId'],'releaseCandidateId':'dot-cloud-restored-fb0b8e3-20261005T2028Z','sourceId':CFG['sourceId'],'sourceConfigHash':CFG['sourceConfigSha256'],'batchId':batch,'startedAt':'2000-01-01T00:00:00Z','finishedAt':'2000-01-01T00:00:01Z','rawCount':count,'validCount':count,'dedupeOutputCount':count,'transportState':'SUCCEEDED','adapterState':'SUCCEEDED','completenessState':'VERIFIED','atomicCommitState':'COMMITTED','canonicalCurrentJobSetSha256':sha(b'NONQUAL_SYNTHETIC_JOB_KEYS'),'canonicalOutputSetSha256':sha(b'NONQUAL_SYNTHETIC_JOB_KEYS')}
 cert={'schemaVersion':'plan-bound-source-quality-v1','policyId':'PLAN_BOUND_SOURCE_QUALITY_V1','companyId':'company-novartis','declaredCompleteness':{'kind':'OFFICIAL_TOTAL_PAGES'},'binding':{k:row[f] for k,f in [('sourceId','sourceId'),('sourceResultId','id'),('batchId','batchId'),('releaseCandidateId','releaseCandidateId'),('sourceConfigSha256','sourceConfigHash')]},'counts':{'rawCount':count,'finalUniqueJobCount':count},'output':{'canonicalJobKeySetSha256':row['canonicalCurrentJobSetSha256']},'acquisition':{'startedAt':row['startedAt'],'finishedAt':row['finishedAt']}}
 row['completenessCertificate']=cert;row['completenessCertificateSha256']=sha(canonical(cert))
 return {'cfg':dict(CFG),'row':row,'kind':'PUBLISH','project':CFG['project'],'schema':1,'sqlSuffix':'','removeToken':None,'archive':True,'sqlMismatch':False,'requestIdMismatch':False,'requestHashMismatch':False,'expiresAt':'2099-01-01T00:00:00Z','dispatchBefore':'2098-01-01T00:00:00Z'}
def test(tmp,name,mutation=None,accept=False,count=2):
 host=tmp/name;batch='NONQUAL-'+name;run=host/batch;relay=run/'relay';relay.mkdir(parents=True)
 p=fixture(batch,count);p['cfg']['root']=str(host)
 if mutation:mutation(p)
 row=p['row'];rid=str(uuid.uuid4());literal=compact(row).replace('\\','\\\\').replace("'","\\'")
 sql="-- NONQUAL_SYNTHETIC_REVIEW_ONLY; NEVER DISPATCH\nDO $synthetic_review$\nDECLARE source_result_data jsonb := E'"+literal+"'::jsonb;\nBEGIN\nIF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_COMMITTED_EXACT_SOURCE_REQUIRED'; END IF;\nIF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_CURRENT_MEMBERS_DRIFT'; END IF;\nSET CONSTRAINTS ALL IMMEDIATE;\nPERFORM 'portable-quality-sync-v1:released';\nEND;\n$synthetic_review$;\n"+p['sqlSuffix']
 if p['removeToken']:sql=sql.replace(p['removeToken'],'NONQUAL_REMOVED')
 body={'schemaVersion':p['schema'],'requestId':str(uuid.uuid4()) if p['requestIdMismatch'] else rid,'kind':p['kind'],'expiresAt':p['expiresAt'],'payload':{'projectId':p['project'],'sql':sql,'dispatchBefore':p['dispatchBefore']}}
 req={**body,'requestSha256':'0'*64 if p['requestHashMismatch'] else sha(compact(body).encode())}
 (host/'host-config.json').write_text(compact(p['cfg']));(relay/(rid+'.request.json')).write_text(compact(req));(relay/(rid+'.request.json.sql')).write_text(sql+('\n-- MISMATCH' if p['sqlMismatch'] else ''))
 archive=b'{"purpose":"NONQUAL_SYNTHETIC_REVIEW_ONLY","artifacts":[]}\n'
 if p['archive']:(run/'artifacts').mkdir();(run/'artifacts'/f'{batch}.archive.json').write_bytes(archive)
 completed=subprocess.run([sys.executable,'-B',str(HOST/'runtime/review-publication.py'),str(host),str(run),rid],capture_output=True,text=True,timeout=15,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PYTHONOPTIMIZE':''})
 path=run/'publication-review.json'
 if accept:
  assert completed.returncode==0,(name,completed.stderr)
  review=json.loads(path.read_text());assert review==json.loads(completed.stdout)
  assert review['sourceResult']['sourceId']==CFG['sourceId'] and review['sourceResult']['rawCount']==count
  assert review['sqlSha256']==sha(sql.encode()) and review['archiveSha256']==sha(archive) and review['requestSha256']==req['requestSha256']
 else:assert completed.returncode!=0 and not path.exists(),(name,'UNEXPECTED_ACCEPT',completed.stdout)
 RESULTS.append({'case':name,'expected':'ACCEPT' if accept else 'REJECT','actualExit':completed.returncode,'reviewFileCreated':path.exists(),'passed':True})
def row(k,v):return lambda p:p['row'].__setitem__(k,v)
def cert(section,k,v):
 def mutate(p):
  if section:p['row']['completenessCertificate'][section][k]=v
  else:p['row']['completenessCertificate'][k]=v
  p['row']['completenessCertificateSha256']=sha(canonical(p['row']['completenessCertificate']))
 return mutate
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with tempfile.TemporaryDirectory(prefix='novartis46-review-') as folder:
 tmp=Path(folder)
 for count in [2,5]:test(tmp,'valid-own-dynamic-'+str(count),accept=True,count=count)
 cases={'row-source':row('sourceId','source-wrong-social'),'row-candidate':row('releaseCandidateId','dot-cloud-restored-fb0b8e3-20261004'),'row-config':row('sourceConfigHash','0'*64),'row-batch':row('batchId','WRONG'),'row-id':row('id','WRONG'),'transport-failed':row('transportState','FAILED'),'adapter-failed':row('adapterState','FAILED'),'incomplete':row('completenessState','UNKNOWN'),'atomic-unknown':row('atomicCommitState','UNKNOWN'),'cert-schema':cert(None,'schemaVersion','a-grade-official-total-v2'),'cert-policy':cert(None,'policyId','WRONG'),'cert-company':cert(None,'companyId','company-wrong'),'cert-declaration':cert('declaredCompleteness','kind','MANUAL'),'count-raw':cert('counts','rawCount',3),'count-final':cert('counts','finalUniqueJobCount',3),'cert-output-hash':cert('output','canonicalJobKeySetSha256','0'*64),'cert-hash':row('completenessCertificateSha256','0'*64),'current-hash':row('canonicalCurrentJobSetSha256','0'*64),'output-hash':row('canonicalOutputSetSha256','0'*64),'kind':lambda p:p.__setitem__('kind','READ_CONTEXT'),'project':lambda p:p.__setitem__('project','WRONG'),'request-id':lambda p:p.__setitem__('requestIdMismatch',True),'request-hash':lambda p:p.__setitem__('requestHashMismatch',True),'request-schema':lambda p:p.__setitem__('schema',2),'request-expired':lambda p:p.__setitem__('expiresAt','2000-01-01T00:00:00Z'),'dispatch-expired':lambda p:p.__setitem__('dispatchBefore','2000-01-01T00:00:00Z'),'sql-bytes':lambda p:p.__setitem__('sqlMismatch',True),'archive-missing':lambda p:p.__setitem__('archive',False),'forbidden-table':lambda p:p.__setitem__('sqlSuffix','UPDATE public."UnapprovedTable" SET id=id;\n'),'host-config':lambda p:p['cfg'].__setitem__('sourceConfigSha256','0'*64),'host-source':lambda p:p['cfg'].__setitem__('sourceId','source-wrong-social'),'host-root':lambda p:p['cfg'].__setitem__('root','/nonexistent')}
 for field in ['sourceId','sourceResultId','batchId','releaseCandidateId','sourceConfigSha256']:cases['binding-'+field]=cert('binding',field,'WRONG')
 for op in ['CREATE','ALTER','DROP','TRUNCATE','DELETE']:cases['ddl-'+op.lower()]=lambda p,op=op:p.__setitem__('sqlSuffix',op+' TABLE synthetic_fixture;\n')
 for i,token in enumerate(['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released']):cases['incomplete-finalization-'+str(i)]=lambda p,token=token:p.__setitem__('removeToken',token)
 for name,mutation in cases.items():test(tmp,name,mutation)
report={'schemaVersion':1,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceId':CFG['sourceId'],'passed':True,'totalCases':len(RESULTS),'acceptedCases':sum(x['expected']=='ACCEPT' for x in RESULTS),'rejectedCases':sum(x['expected']=='REJECT' for x in RESULTS),'allTemporaryPacketsRemoved':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'sqlExecuted':False,'producerLaunched':False,'reviewerSha256':sha((HOST/'runtime/review-publication.py').read_bytes()),'cases':RESULTS,'limits':['Synthetic packet-contract fixtures do not prove complete receipt schema or official evidence admission. Source policy replay is verified separately with frozen synthetic HTTP fixtures.']}
with (HOST/'REVIEWER_TEST_RESULTS.json').open('x') as f:f.write(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['passed','totalCases','acceptedCases','rejectedCases','sqlExecuted']}))
