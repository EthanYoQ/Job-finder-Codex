/** Original controller calls this local-only helper after a confirmed source terminal.
 * It never connects to or writes a database. Raw captures stay in the given local directory. */
import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
process.env.JOBFINDER_CLOUD_SOURCE_ID='source-novo-nordisk-china-social';
const args=process.argv.slice(2),mode=args.shift();
const option=(name:string)=>{const index=args.indexOf('--'+name);if(index<0||!args[index+1])throw Error('Missing --'+name);return args[index+1]!;};
const read=async(p:string)=>JSON.parse(await fs.readFile(path.resolve(p),'utf8'));
const save=async(name:string,value:unknown)=>fs.writeFile(path.join(out,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const control=await read(option('control')),out=path.resolve(option('out'));await fs.mkdir(out,{recursive:true,mode:0o700});
const sql=await import('../src/db/cloudPilotSqlControl');
if(mode==='prepare'){
 await save('read-input.sql',sql.compileCloudPilotNovoVerificationInputsSql(control));
 console.log(JSON.stringify({outcome:'READ_ONLY_INPUT_SQL_READY',path:path.join(out,'read-input.sql')}));
}else if(mode==='capture'){
 const input=await read(option('input')),expiresAt=option('expires-at'),deadline=Date.parse(expiresAt);
 if(!Number.isFinite(deadline)||deadline<=Date.now()||deadline>Date.now()+60*60*1000)throw Error('NOVO_EXECUTION_DEADLINE');
 if(input.schemaVersion!=='novo-job-verification-input-v1'||input.sourceId!==sql.CLOUD_PILOT_SOURCE.id||input.sourceConfigSha256!==sql.CLOUD_PILOT_SOURCE.sourceConfigSha256||input.transactionReadOnly!=='on'||input.isolationLevel!=='repeatable read'||Math.abs(Date.now()-Date.parse(input.checkedAt))>5*60*1000)throw Error('NOVO_FRESH_READ_ONLY_INPUT_REQUIRED');
 const root=path.resolve(option('reader-root'));
 const {readPortablePublicSnapshot}=await import(pathToFileURL(path.join(root,'src/db/portablePublicSnapshotRepository.ts')).href);
 const {toPrismaJobCategory}=await import(pathToFileURL(path.join(root,'src/db/prismaMappers.ts')).href);
 const {buildStagedSourceCrawlPlans}=await import('../src/crawler/sourcePlan');const {candidateCompanies}=await import('../src/data/companyRegistry');
 const plans=buildStagedSourceCrawlPlans(candidateCompanies).filter(p=>p.source.id===sql.CLOUD_PILOT_SOURCE.id);
 const date=(s:string)=>new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(s)?s:s+'Z');
 const dates=(row:any):any=>Array.isArray(row)?row.map(dates):row&&typeof row==='object'?Object.fromEntries(Object.entries(row).map(([k,v])=>[k,k==='completenessCertificate'||k==='details'?v:typeof v==='string'&&/(?:At|From|To)$/.test(k)&&/^\d{4}-/.test(v)?date(v):dates(v)])):row;
 const results=dates(input.results),members=dates(input.members),artifacts=dates(input.artifacts),closures=dates(input.closureRecords),jobs=input.jobs.map((j:any)=>({...dates(j),category:toPrismaJobCategory(j.category),humanCorrectedCategory:j.humanCorrectedCategory?toPrismaJobCategory(j.humanCorrectedCategory):null}));
 const tx={crawlBatchSourceResult:{findMany:async()=>results},lifecycleSetEvidenceMember:{findMany:async()=>members},job:{findMany:async()=>jobs},lossLedgerEntry:{findMany:async()=>closures},evidenceArtifact:{findMany:async()=>artifacts}};
 const before=await readPortablePublicSnapshot({$transaction:async(fn:any)=>fn(tx)},{currentTime:date(input.checkedAt)},plans);
 const source=before.sources.find((s:any)=>s.sourceId===sql.CLOUD_PILOT_SOURCE.id);
 if(!source||source.state!=='PUBLISHING')throw Error('NOVO_ORIGINAL_READER_NOT_PUBLISHING');
 const selected=results.find((r:any)=>r.id===source.selectedSourceResultId);if(!selected)throw Error('NOVO_SELECTED_RESULT_REQUIRED');
 const native=await import('../src/crawler/novoJobVerification');
 const {targets,unknown}=native.planNovoPublishedJobVerifications({publishedJobs:source.jobs,selectedSourceResult:selected,jobs,artifacts});
 await save('planning-unknown.json',unknown);
 if(args.includes('--plan-only')){await save('reader-before.json',source);await save('targets.json',targets);await save('observations.json',unknown);console.log(JSON.stringify({outcome:'PLAN_ONLY',publishedCount:source.jobs.length,plannedCount:targets.length,unknownCount:unknown.length,networkRequests:0,sqlExecuted:false}));process.exit(0);}
 const captures=[],observations=[];observations.push(...unknown);const run='novo-verify-'+randomUUID();
 for(const target of targets){
  if(Date.now()+30000>=deadline)throw Error('NOVO_CAPTURE_DEADLINE_INSUFFICIENT');
  const observation=await native.captureNovoPublishedJobVerification(target);observations.push({nativeId:target.identity.nativeId,status:observation.status,reason:observation.reason,capturedAt:observation.raw?.capturedAt});
  if(observation.raw)await save(`raw-${target.identity.nativeId}.json`,observation.raw);
  if(observation.status!=='CLOSED'||!observation.raw)continue;
  const batchId=run+'-'+target.identity.nativeId;
  const capture=await native.archiveNovoJobVerification({workspaceRoot:out,evidenceSubdirectory:'native-verification',releaseCandidateId:control.candidate.id,batchId,sourceResultId:`${batchId}--${sql.CLOUD_PILOT_SOURCE.id}`,raw:observation.raw,identity:target.identity});captures.push({batchId,capture});
 }
 if(Date.now()>=deadline)throw Error('NOVO_EXECUTION_DEADLINE');
 await save('reader-before.json',source);await save('observations.json',observations);await save('expected-captures.json',captures);
 if(captures.length){
  const holderId=randomUUID();await save('commit.sql',sql.compileCloudPilotNovoJobVerificationSetSql({...control,expiresAt,holderId,context:input.publicationContext,captures}));
  await save('readback.sql',sql.compileCloudPilotNovoJobVerificationReadbackSql(captures.map(c=>c.batchId)));
 }
 const result={outcome:captures.length?'CLOSURE_SQL_READY':'NO_CLOSED_EVIDENCE',publishedCount:source.jobs.length,plannedCount:targets.length,verifiedClosedCount:captures.length,activeCount:observations.filter(o=>o.status==='ACTIVE').length,unknownCount:observations.filter(o=>o.status==='UNKNOWN').length,sourceLastSuccessAt:source.lastSuccessAt,sourceLastAttemptAt:source.lastAttemptAt,sqlExecuted:false,expiresAt};await save('result.json',result);console.log(JSON.stringify(result));
}else if(mode==='reconcile'){
 const native=await import('../src/crawler/novoJobVerification'),readback=await read(option('readback')),expected=await read(option('expected'));
 const result=native.inspectNovoJobVerificationReadback(readback,expected,new Date());await save('reconcile-result.json',result);console.log(JSON.stringify(result));
}else throw Error('Use prepare, capture or reconcile');
