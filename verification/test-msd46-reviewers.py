#!/usr/bin/env python3
"""Execute each actual TRUE_A reviewer on positive and negative synthetic packets only.
No producer, source request, database call, or SQL execution occurs.
"""
import copy,datetime,hashlib,json,os,subprocess,sys,tempfile,uuid
from pathlib import Path
R=Path(__file__).resolve().parent.parent
KEYS=['msd'];RESULTS=[];POSITIVE_RECEIPTS=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
canonical=lambda v:json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
compact=lambda v:json.dumps(v,ensure_ascii=False,separators=(',',':'))
ENV={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PYTHONOPTIMIZE':''}
def fixture(cfg,batch,count=2):
 row={'id':batch+'--'+cfg['sourceId'],'releaseCandidateId':'dot-cloud-restored-fb0b8e3-20261005T2028Z','sourceId':cfg['sourceId'],'sourceConfigHash':cfg['sourceConfigSha256'],'batchId':batch,'startedAt':'2000-01-01T00:00:00Z','finishedAt':'2000-01-01T00:00:01Z','rawCount':count,'validCount':count,'dedupeOutputCount':count,'transportState':'SUCCEEDED','adapterState':'SUCCEEDED','completenessState':'VERIFIED','atomicCommitState':'COMMITTED','canonicalCurrentJobSetSha256':sha(b'NONQUAL_SYNTHETIC_JOB_KEYS'),'canonicalOutputSetSha256':sha(b'NONQUAL_SYNTHETIC_JOB_KEYS')}
 plan=next(json.loads((R/'hosts46'/key/'source-plan.json').read_text()) for key in KEYS+['cr'] if json.loads((R/'hosts46'/key/'host-config.json').read_text())['sourceId']==cfg['sourceId'])
 cert={'schemaVersion':'a-grade-official-total-v2','grade':'A','binding':{k:row[f] for k,f in [('sourceId','sourceId'),('sourceResultId','id'),('batchId','batchId'),('releaseCandidateId','releaseCandidateId'),('sourceConfigSha256','sourceConfigHash')]},'scope':{'companyId':plan['company']['id'],'sourceId':cfg['sourceId'],'recruitmentType':'SOCIAL','geography':'MAINLAND_CHINA','businessUnit':'ALL','verificationPolicy':'STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1','surfaceIds':[plan['source']['surfaceId']],'channelIds':sorted(x['channelId'] for x in plan['expectedChannels'])},'declaration':{'kind':'OFFICIAL_TOTAL_COUNT','scope':'SOURCE','artifactLogicalKey':'NONQUAL-SYNTHETIC-OFFICIAL','artifactSha256':sha(b'NONQUAL-SYNTHETIC-OFFICIAL'),'extractorLocator':'NONQUAL-SYNTHETIC-COUNT'},'counts':{**{k:count for k in ['officialTotal','rawObservationCount','rawUniqueOfficialRecordCount','parsedCount','validCount','normalizedCount','dedupeInputCount','finalUniqueJobCount']},**{k:0 for k in ['legalDedupeCount','parseDiscardCount','validationDiscardCount','normalizationDiscardCount']}},'legalDedupeLedger':[],'legalScopeExclusionLedger':[],'pagination':{'pageCount':1,'paginationTraceSha256':sha(b'NONQUAL-SYNTHETIC-PAGES'),'canonicalRawOfficialIdSetSha256':sha(b'NONQUAL-SYNTHETIC-IDS')},'output':{'canonicalJobSetSha256':row['canonicalCurrentJobSetSha256'],'adapterReconciliationSha256':sha(b'NONQUAL-SYNTHETIC-RECONCILIATION'),'collisionLedgerSha256':sha(canonical([]))},'observedAt':row['finishedAt']}
 row['completenessCertificate']=cert;row['completenessCertificateSha256']=sha(canonical(cert))
 return {'cfg':dict(cfg),'row':row,'kind':'PUBLISH','project':cfg['project'],'sqlSuffix':'','removeToken':None,'archive':True,'sqlMismatch':False,'requestIdMismatch':False,'requestHashMismatch':False,'expiresAt':'2099-01-01T00:00:00Z','dispatchBefore':'2098-01-01T00:00:00Z'}
def sql_text(p):
 literal=compact(p['row']).replace('\\','\\\\').replace("'","\\'")
 sql="-- NONQUAL_SYNTHETIC_REVIEW_ONLY; NEVER DISPATCH\nDO $synthetic_review$\nDECLARE source_result_data jsonb := E'"+literal+"'::jsonb;\nBEGIN\nIF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_COMMITTED_EXACT_SOURCE_REQUIRED'; END IF;\nIF source_result_data IS NULL THEN RAISE EXCEPTION 'PILOT_CURRENT_MEMBERS_DRIFT'; END IF;\nSET CONSTRAINTS ALL IMMEDIATE;\nPERFORM 'portable-quality-sync-v1:released';\nEND;\n$synthetic_review$;\n"+p['sqlSuffix']
 if p['removeToken']:sql=sql.replace(p['removeToken'],'NONQUAL_REMOVED')
 return sql

def run_test(tmp,key,cfg,name,mutate=None,accept=False,count=2):
 host=tmp/key/name;batch='NONQUAL-'+name;run=host/batch;relay=run/'relay';relay.mkdir(parents=True)
 p=fixture(cfg,batch,count)
 if mutate:mutate(p)
 rid=str(uuid.uuid4());sql=sql_text(p)
 body={'schemaVersion':1,'requestId':str(uuid.uuid4()) if p['requestIdMismatch'] else rid,'kind':p['kind'],'expiresAt':p['expiresAt'],'payload':{'projectId':p['project'],'sql':sql,'dispatchBefore':p['dispatchBefore']}}
 req={**body,'requestSha256':'0'*64 if p['requestHashMismatch'] else sha(compact(body).encode())}
 (host/'host-config.json').write_text(json.dumps(p['cfg']))
 (relay/(rid+'.request.json')).write_text(compact(req))
 (relay/(rid+'.request.json.sql')).write_text(sql+('\n-- CHANGED' if p['sqlMismatch'] else ''))
 archive=b'{"purpose":"NONQUAL_SYNTHETIC_REVIEW_ONLY","artifacts":[]}\n'
 if p['archive']:(run/'artifacts').mkdir();(run/'artifacts'/f'{batch}.archive.json').write_bytes(archive)
 completed=subprocess.run([sys.executable,'-B',str(R/'hosts46'/key/'runtime/review-publication.py'),str(host),str(run),rid],capture_output=True,text=True,timeout=15,env=ENV)
 report=run/'publication-review.json'
 if accept:
  assert completed.returncode==0,(key,name,completed.stderr)
  review=json.loads(report.read_text());assert review==json.loads(completed.stdout)
  assert review['sourceResult']['sourceId']==cfg['sourceId'] and review['sourceResult']['rawCount']==count
  assert review['sqlSha256']==sha(sql.encode()) and review['archiveSha256']==sha(archive) and review['requestSha256']==req['requestSha256']
  POSITIVE_RECEIPTS.append({'certificate':p['row']['completenessCertificate'],'certificateSha256':p['row']['completenessCertificateSha256'],'expected':p['row']['completenessCertificate']['binding']})
 else:assert completed.returncode!=0 and not report.exists(),(key,name,'UNEXPECTED_ACCEPTANCE',completed.stdout)
 RESULTS.append({'key':key,'case':name,'expected':'ACCEPT' if accept else 'REJECT','actualExit':completed.returncode,'reviewFileCreated':report.exists(),'passed':True})

def row_set(k,v):return lambda p:p['row'].__setitem__(k,v)
def cert_set(section,k,v):
 def mutation(p):
  p['row']['completenessCertificate'][section][k]=v
  p['row']['completenessCertificateSha256']=sha(canonical(p['row']['completenessCertificate']))
 return mutation
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with tempfile.TemporaryDirectory(prefix='msd46-review-') as temporary:
 for key in KEYS:
  cfg=json.loads((R/'hosts46'/key/'host-config.json').read_text());tmp=Path(temporary)
  for count in [2,5]:run_test(tmp,key,cfg,'valid-own-dynamic-'+str(count),accept=True,count=count)
  cases={
   'row-source':row_set('sourceId','source-wrong-social'),'row-candidate':row_set('releaseCandidateId','dot-cloud-restored-fb0b8e3-20261004'),'row-config':row_set('sourceConfigHash','0'*64),'row-batch':row_set('batchId','WRONG'),'row-id':row_set('id','WRONG'),
   'transport-failed':row_set('transportState','FAILED'),'adapter-failed':row_set('adapterState','FAILED'),'incomplete':row_set('completenessState','UNKNOWN'),'atomic-unknown':row_set('atomicCommitState','UNKNOWN'),
   'cert-schema':lambda p:p['row']['completenessCertificate'].__setitem__('schemaVersion','plan-bound-source-quality-v1'),'cert-grade':lambda p:p['row']['completenessCertificate'].__setitem__('grade','B'),
   'cert-policy':cert_set('scope','verificationPolicy','WRONG'),'count-raw':cert_set('counts','rawObservationCount',3),'count-final':cert_set('counts','finalUniqueJobCount',3),'cert-output-hash':cert_set('output','canonicalJobSetSha256','0'*64),'cert-hash':row_set('completenessCertificateSha256','0'*64),'current-hash':row_set('canonicalCurrentJobSetSha256','0'*64),'output-hash':row_set('canonicalOutputSetSha256','0'*64),
   'declaration':cert_set('declaration','kind','MANUAL'),'kind':lambda p:p.__setitem__('kind','READ_CONTEXT'),'project':lambda p:p.__setitem__('project','WRONG'),'request-id':lambda p:p.__setitem__('requestIdMismatch',True),'request-hash':lambda p:p.__setitem__('requestHashMismatch',True),'request-expired':lambda p:p.__setitem__('expiresAt','2000-01-01T00:00:00Z'),'dispatch-expired':lambda p:p.__setitem__('dispatchBefore','2000-01-01T00:00:00Z'),'sql-bytes':lambda p:p.__setitem__('sqlMismatch',True),'archive-missing':lambda p:p.__setitem__('archive',False),'forbidden-table':lambda p:p.__setitem__('sqlSuffix','UPDATE public."UnapprovedTable" SET id=id;\n'),
   'host-config':lambda p:p['cfg'].__setitem__('sourceConfigSha256','0'*64),
  }
  for field in ['sourceId','sourceResultId','batchId','releaseCandidateId','sourceConfigSha256']:cases['binding-'+field]=cert_set('binding',field,'WRONG')
  for op in ['CREATE','ALTER','DROP','TRUNCATE','DELETE']:cases['ddl-'+op.lower()]=lambda p,op=op:p.__setitem__('sqlSuffix',op+' TABLE synthetic_fixture;\n')
  for i,token in enumerate(['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released']):cases['incomplete-finalization-'+str(i)]=lambda p,token=token:p.__setitem__('removeToken',token)
  for other in ['cr']:
   if other==key:continue
   otherCfg=json.loads((R/'hosts46'/other/'host-config.json').read_text())
   def foreign(p,otherCfg=otherCfg):
    replacement=fixture(otherCfg,p['row']['batchId']);p.clear();p.update(replacement)
   cases['sibling-'+other]=foreign
  for name,mutate in cases.items():run_test(tmp,key,cfg,name,mutate)
 receiptFile=Path(temporary)/'positive-receipts.json';receiptFile.write_text(json.dumps(POSITIVE_RECEIPTS))
 verifier=Path(temporary)/'verify-receipts.mjs'
 verifier.write_text("import {readFileSync} from 'node:fs';\nimport {verifyAGradeCompletenessCertificateReceipt as verify} from '"+(R/'producer42/src/crawler/completenessCertificate.ts').as_uri()+"';\nconst inputs=JSON.parse(readFileSync(process.argv[2]));for(const x of inputs){const r=verify(x);if(r.status!=='PASS')throw Error('SYNTHETIC_RECEIPT_INVALID');}console.log(JSON.stringify({positiveReceiptsPassed:inputs.length}));\n")
 completed=subprocess.run(['node','--import',str(R/'producer42/node_modules/tsx/dist/loader.mjs'),str(verifier),str(receiptFile)],capture_output=True,text=True,timeout=30,env={**ENV,'TSX_DISABLE_CACHE':'1','NODE_DISABLE_COMPILE_CACHE':'1'})
 assert completed.returncode==0,completed.stderr
 assert json.loads(completed.stdout)['positiveReceiptsPassed']==2
report={'schemaVersion':1,'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':True,'scope':'REAL_REVIEWER_CLI_SYNTHETIC_PACKET_CONTRACT','totalCases':len(RESULTS),'acceptedCases':sum(x['expected']=='ACCEPT' for x in RESULTS),'rejectedCases':sum(x['expected']=='REJECT' for x in RESULTS),'sourceNetworkAccessed':False,'databaseAccessed':False,'sqlExecuted':False,'producerLaunched':False,'temporaryPacketsRemoved':True,'fullCertificateReceiptSchemaAndEquationsPositivePasses':2,'results':RESULTS,'reviewers':{k:sha((R/'hosts46'/k/'runtime/review-publication.py').read_bytes()) for k in KEYS},'limitations':['Positive certificates also pass the unchanged producer receipt verifier (complete schema, source scope and count equations); packets are synthetic reviewer inputs, not captured source evidence. Full canonical plan, pagination, details and official-total replay remain the unchanged producer admission gates.','Synthetic counts 2 and 5 demonstrate dynamic acceptance; no historical count is a target.']}
(R/'verification/msd46-reviewer-test-results.json').write_text(json.dumps(report,indent=2)+'\n')
for key in KEYS:
 own=[x for x in RESULTS if x['key']==key]
 (R/'hosts46'/key/'REVIEWER_TEST_RESULTS.json').write_text(json.dumps({**{k:v for k,v in report.items() if k not in ['results','reviewers','totalCases','acceptedCases','rejectedCases']},'totalCases':len(own),'acceptedCases':2,'rejectedCases':len(own)-2,'reviewerSha256':report['reviewers'][key],'results':own},indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['passed','totalCases','acceptedCases','rejectedCases','sqlExecuted']}))
