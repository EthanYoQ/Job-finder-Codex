import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {writeFileSync,readFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
// Test-only external ports: fixture HTTP and raw relay responses. Admission,
// compiler, authority, original lease functions, and owned WeakMap remain real.
const P=resolve(fileURLToPath(new URL('..',import.meta.url)));
const evidenceRoot=process.env.SHARED_GUARD_EVIDENCE_ROOT;
if(!evidenceRoot)throw Error('SHARED_GUARD_EXTERNAL_EVIDENCE_ROOT_REQUIRED');
const externalRoot=resolve(evidenceRoot);
if(externalRoot===P||externalRoot.startsWith(P+'/'))throw Error('SHARED_GUARD_EVIDENCE_MUST_BE_EXTERNAL');
mkdirSync(externalRoot,{recursive:true});
const E=mkdtempSync(join(externalRoot,'legacy-count-drop-'));
mkdirSync(join(E,'artifacts'));

const json=(name:string,v:any)=>writeFileSync(E+'/'+name,JSON.stringify(v,null,2));
const plain=(v:any)=>JSON.parse(JSON.stringify(v));
// PostgreSQL nullable scalar defaults are read from the unchanged original Prisma schema.
const sourceSchema=readFileSync(P+'/vendor/c60-source/prisma/schema.prisma','utf8').split('model CrawlBatchSourceResult {')[1].split('\n}')[0];
const nullableDefaults=Object.fromEntries([...sourceSchema.matchAll(/^\s*(\w+)\s+\w+\?\s*$/gm)].map(m=>[m[1],null]));
json('pending-nullable-schema-defaults.json',{source:'original prisma/schema.prisma CrawlBatchSourceResult optional scalar fields',nullableDefaults});
// Decode only the two escaping operations emitted by the real compiler sqlText.
// Never eval SQL; unsupported syntax fails closed before constructing readback.
function eLiteral(sql:string,at:number):{value:string;end:number}{
 if(sql.slice(at,at+2)!=="E'")throw Error('EXPECTED_COMPILER_E_LITERAL');
 let value=''; for(let i=at+2;i<sql.length;i++){
  const c=sql[i];
  if(c==='\\'){if(sql[i+1]!=='\\')throw Error('UNSUPPORTED_SQL_ESCAPE');value+='\\';i++;}
  else if(c==="'"){if(sql[i+1]==="'"){value+="'";i++;}else return {value,end:i+1};}
  else value+=c;
 }
 throw Error('UNTERMINATED_SQL_LITERAL');
}
function sqlJsonAt(sql:string,at:number){const r=eLiteral(sql,at);if(sql.slice(r.end,r.end+7)!=='::jsonb')throw Error('EXPECTED_JSONB');return {value:JSON.parse(r.value),end:r.end+7};}
function recordsAt(sql:string,at:number):{value:any[];end:number}{
 if(sql.startsWith("E'",at)){const r=sqlJsonAt(sql,at);if(!Array.isArray(r.value))throw Error('EXPECTED_RECORD_ARRAY');return r;}
 const prefix='(SELECT jsonb_agg(';if(!sql.startsWith(prefix,at))throw Error('UNSUPPORTED_RECORD_ENCODING');
 const common=sqlJsonAt(sql,at+prefix.length);let i=common.end;
 const build=' || jsonb_build_object(';if(!sql.startsWith(build,i))throw Error('EXPECTED_RECORD_BUILD');i+=build.length;
 const fields:Array<[string,number]>=[];
 while(sql[i]!==')'){
  const key=eLiteral(sql,i);i=key.end;
  const m=/^, tuple\.value->([0-9]+)/.exec(sql.slice(i));if(!m)throw Error('EXPECTED_TUPLE_INDEX');i+=m[0].length;
  fields.push([key.value,Number(m[1])]);if(sql.startsWith(', ',i))i+=2;else if(sql[i]!==')')throw Error('EXPECTED_FIELD_SEPARATOR');
 }
 const middle=') ORDER BY tuple.ordinality)\n    FROM jsonb_array_elements(';
 if(!sql.startsWith(middle,i))throw Error('EXPECTED_TUPLE_ARRAY');i+=middle.length;
 const tuples=sqlJsonAt(sql,i);i=tuples.end;
 const suffix=') WITH ORDINALITY AS tuple(value, ordinality))';if(!sql.startsWith(suffix,i))throw Error('EXPECTED_TUPLE_SUFFIX');i+=suffix.length;
 return {value:tuples.value.map((row:any[])=>({...common.value,...Object.fromEntries(fields.map(([key,index])=>[key,row[index]]))})),end:i};
}
function decodeSql(sql:string,terminalRequired=true){
 const terminalPrefix='FROM jsonb_populate_record(NULL::public."CrawlBatchSourceResult", ';
 const index=sql.indexOf(terminalPrefix);if(terminalRequired&&(index<0||index!==sql.lastIndexOf(terminalPrefix)))throw Error('EXPECTED_ONE_TERMINAL_UPDATE');
 // DB-started uses its own shared terminal declaration; baseline reads need only
 // literal Job and lifecycle recordsets, never a fabricated terminal value.
 const terminal=terminalRequired?sqlJsonAt(sql,index+terminalPrefix.length).value:null;
 const sets:Record<string,any[]>={};
 for(const table of ['CrawlObservation','LifecycleSetEvidenceMember','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','TransportAttemptEvidence']){
  const prefix=`FROM jsonb_populate_recordset(NULL::public."${table}", `;
  sets[table]=[];let start=0,idx;
  while((idx=sql.indexOf(prefix,start))>=0){const r=recordsAt(sql,idx+prefix.length);sets[table].push(...r.value);start=r.end;}
 }
 const jobs:any[]=[];let start=0,idx;const prefix='FOR job_data IN SELECT value FROM jsonb_array_elements(';
 while((idx=sql.indexOf(prefix,start))>=0){const r=recordsAt(sql,idx+prefix.length);jobs.push(...r.value);start=r.end;}
 return {terminal,sets,jobs};
}
let first:any,prior:any,current:any,firstPacket:any,build:any,relayModule:any,run:any,plan:any;
beforeAll(async()=>{
 expect(()=>globalThis.fetch('https://offline.invalid')).toThrow('OFFLINE_NETWORK_FORBIDDEN');process.env.JOBFINDER_CLOUD_SOURCE_ID='source-hengrui-social';process.chdir(P);
 const f=await import(P+'/connector-gate/hengrui-synthetic-fixture.mts');
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:P,encoding:'utf8'}).trim();expect(head).toMatch(/^[a-f0-9]{40}$/);
 expect(execFileSync('git',['status','--porcelain'],{cwd:P,encoding:'utf8'})).toBe('');
 build=f.initialize({commitSha:head,candidate:{id:'synthetic-legacy-count-drop-guard',goalId:'jobfinder-portable-required-40',version:100},databaseIdentity:{migrationVersion:'20261014141000_v75_retired_candidate_fence',schemaHash:'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7',dbSnapshotHash:'e'.repeat(64)}});
 json('real-candidate-build-identity.json',build);
 f.configureSyntheticFixtureRuntime({setClock:(at:string)=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(at));},installFetch:(fn:any)=>vi.stubGlobal('fetch',fn)});
 const {compileDbStartedCloudSourcePublication}=await import(P+'/vendor/c60-source/src/db/ingestionRepository.ts');
 first=await f.fixture({at:'2026-10-11T10:00:00.000Z',syntheticOptions:{count:100},syntheticArtifactParent:E+'/artifacts'});
 firstPacket=await compileDbStartedCloudSourcePublication(first.input.publication);prior=await f.priorFrom(first,firstPacket);
 current=await f.fixture({at:'2026-10-12T10:00:00.000Z',syntheticOptions:{count:1},prior,syntheticArtifactParent:E+'/artifacts'});
 expect(prior.jobs).toHaveLength(100);expect(current.input.publication.source.result.jobs).toHaveLength(1);
 plan=current.input.publication.source.plan;
 json('real-accepted-prior.json',prior);
 relayModule=await import(P+'/vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts');
 ({runCloudPortableSourcePilot:run}=await import(P+'/vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts'));
},90000);
afterAll(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();process.chdir(P);});
it('network guard is preloaded and blocks real transports',()=>{
 const require=createRequire(import.meta.url),guard=P+'/test/no-network.cjs';expect(process.execArgv).toContain(guard);expect(require.cache[guard]).toBeDefined();
 const checks=[];for(const [name,key] of [['node:http','request'],['node:http','get'],['node:https','request'],['node:https','get'],['node:net','connect'],['node:net','createConnection'],['node:tls','connect']]){expect(()=>require(name)[key]('https://offline.invalid')).toThrow('OFFLINE_NETWORK_FORBIDDEN');checks.push([name,key,'BLOCKED']);}
 // beforeAll asserted global fetch was blocked before installing synthetic HTTP.
 json('guard-proof.json',{execArgv:process.execArgv,guardLoaded:!!require.cache[guard],checks,globalFetchPreStubBlocked:true,syntheticHttpInstalled:true});
});
it('real legacy entrypoint commits only a diagnostic and preserves last-good public and scheduling truth for 100 to 1',async()=>{
 const {loadPilotContext}=await import(P+'/vendor/c60-source/src/crawler/cloudPilotContext.ts');
 const {evaluateCompletenessAnomaly}=await import(P+'/vendor/c60-source/src/crawler/completenessAnomalyPolicy.ts');
 const context=await loadPilotContext(current.input.publication.control.context,plan,false);
 const originalPolicyDecision=evaluateCompletenessAnomaly({baseline:context.trustedCompletenessBaseline,currentJobCount:1});expect(originalPolicyDecision.triggerCodes).toEqual(['TRUSTED_COUNT_DROP']);
 const calls:any[]=[],observed:any={holder:null,pending:null,publishSql:null,decoded:null,outcome:null};
 vi.spyOn(relayModule.FilePilotRelay.prototype,'request').mockImplementation(async function(kind:any,payload:any,deadline:any,parse:any,signal:any){
  signal?.throwIfAborted();expect(Date.now()).toBeLessThan(deadline);calls.push({kind,payload:plain(payload),deadline});
  if(kind==='READ_CONTEXT'){
   if(payload.holderId!==undefined){expect(payload.holderId).toBe(observed.holder);expect(payload.sourceResultId).toBe(observed.pending.id);}
   return parse({...current.input.publication.control.context,checkedAt:new Date().toISOString()});
  }
  if(kind==='CREATE_PENDING'){
   expect(payload.holderId).toBe(observed.holder);const {planned}=payload;
   const batch={...plain(planned.batch),status:'RUNNING',finishedAt:null};
   observed.pending={...nullableDefaults,...plain(planned.sources[0]),releaseCandidateId:planned.batch.releaseCandidateId,batchId:planned.batch.id,transportState:'PENDING',adapterState:'PENDING',completenessState:'PENDING',atomicCommitState:'PENDING',finishedAt:null};
   return parse({batch,sourceRows:[observed.pending]});
  }
  if(kind==='LEASE_ACQUIRE'){
   const holder=/VALUES \('formal-crawl', '([a-f0-9-]{36})',/.exec(payload.sql)?.[1];if(!holder)throw Error('MISSING_REAL_ACQUIRE_HOLDER');observed.holder=holder;
   return parse({status:'SUCCEEDED',rows:[{holderId:holder}]});
  }
  if(kind==='LEASE_RENEW'){expect(payload.sql).toContain(`"holderId" = '${observed.holder}'`);return parse({status:'SUCCEEDED',rows:[{holderId:observed.holder}]});}
  if(kind==='LEASE_RELEASE'){expect(payload.sql).toContain(`"holderId" = '${observed.holder}'`);return parse({status:'SUCCEEDED',rows:[{holderId:''}]});}
  if(kind==='PUBLISH'){
   observed.publishSql=payload.sql;writeFileSync(E+'/legacy-publish.sql',payload.sql);
   observed.decoded=decodeSql(payload.sql);json('legacy-decoded-sql.json',observed.decoded);
   return parse({status:'SUCCEEDED',rows:[]});
  }
  if(kind==='READ_OUTCOME'){
   if(!observed.decoded)throw Error('SQL_TERMINAL_NOT_DECODED');
   const row={...observed.pending,...observed.decoded.terminal};observed.persistedRow=row;json('legacy-readback-row.json',row);
   expect(payload.sql).toContain(row.id);return parse({status:'SUCCEEDED',rows:[{row}]});
  }
  throw Error('UNEXPECTED_EXTERNAL_PORT:'+kind);
 });
 const workspaceRoot=E+'/legacy-workspace';mkdirSync(workspaceRoot,{recursive:true});
 const bootstrap={schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[current.input.publication.control.context.candidateRow],batchId:'legacy-count-drop-guard-'+randomUUID()};
 const bytes=JSON.stringify(bootstrap);const bootstrapPath=E+'/bootstrap.json';writeFileSync(bootstrapPath,bytes);
 process.chdir(P+'/vendor/c60-source');
 let failure:any;try{observed.outcome=await run({bootstrapPath,reviewedSha256:createHash('sha256').update(bytes).digest('hex'),workspaceRoot,relayDirectory:E+'/unused-relay'});}catch(e){failure=e;}
 json('legacy-relay-calls.json',calls);
 const {unwrapJobProjectionSourceRow}=await import(P+'/vendor/c60-source/src/db/jobProjectionDeltaCompiler.ts');
 const {selectPortableSourceSnapshots,projectPortableSourceJobs}=await import(P+'/vendor/c60-source/src/domain/portablePublicSnapshot.ts');
 const {toPrismaJobCategory}=await import(P+'/vendor/c60-source/src/db/prismaMappers.ts');
 const {readPortableScheduleObservations}=await import(P+'/vendor/c60-source/src/db/portableScheduleObservations.ts');
 const revive=(row:any)=>({...row,startedAt:new Date(row.startedAt),finishedAt:new Date(row.finishedAt),batch:{id:row.batchId,releaseCandidateId:row.releaseCandidateId,kind:'SCHEDULED',status:'RUNNING'},observations:(row.observations??[]).map((o:any)=>({...o,observedFrom:new Date(o.observedFrom),observedTo:new Date(o.observedTo),crawledAt:new Date(o.crawledAt)}))});
 let upper:any=null;
 if(observed.persistedRow){
  // Original DB-started fixture carries a delta wrapper. Use its original
  // verifier/unwrapper for the genuine underlying legacy receipt; do not claim
  // that the raw wrapper is accepted by the unchanged legacy public reader.
  const priorRow=revive(unwrapJobProjectionSourceRow(prior.latestAccepted));
  const latestRow=revive({...observed.persistedRow,observations:observed.decoded.sets.CrawlObservation});
  const before=selectPortableSourceSnapshots([plan],[priorRow],{currentTime:new Date()})[0];
  const after=selectPortableSourceSnapshots([plan],[priorRow,latestRow],{currentTime:new Date()})[0];
  const schedule=await readPortableScheduleObservations({findMany:async()=>[latestRow,priorRow]},plan,new Date());
  // Members and Jobs come from real first publication SQL, not hand-built rows.
  const priorSql=decodeSql(firstPacket.sql,false);
  const priorJobs=priorSql.jobs.map((job:any)=>({...job,category:toPrismaJobCategory(job.category),
   lastSeenAt:new Date(job.lastSeenAt),officialPublishedAt:job.officialPublishedAt===null?null:new Date(job.officialPublishedAt)}));
  const priorMembers=priorSql.sets.LifecycleSetEvidenceMember;
  const projected=projectPortableSourceJobs(after,priorMembers,priorJobs,{currentTime:new Date()});
  json('baseline-sql-recordsets.json',{jobs:priorJobs,members:priorMembers});
  upper={priorReceiptNormalization:'original unwrapJobProjectionSourceRow after authentic delta receipt checks',
   before:{state:before.state,lastSuccessAt:before.lastSuccessAt,lastAcceptedJobCount:before.lastAcceptedJobCount},
   after:{state:after.state,lastSuccessAt:after.lastSuccessAt,lastAcceptedJobCount:after.lastAcceptedJobCount},
   projection:{state:projected.state,visibleJobCount:projected.visibleJobCount,lastSuccessAt:projected.lastSuccessAt,reasons:projected.reasons},schedule};
  json('legacy-upper-consumer-observation.json',upper);
 }
 const report:any={upperConsumers:upper,candidateHead:build.commitSha,legacyContextCas:'No DB-started whole-context CAS exists in this legacy branch; test does not assert one',sourceId:plan.source.id,baselineCount:context.trustedCompletenessBaseline.certifiedJobCount,currentCount:1,originalPolicyDecision,entrypoint:'runCloudPortableSourcePilot without dbStartedControlPath',actualCwd:process.cwd(),mockedPorts:['global.fetch synthetic HTTP','FilePilotRelay.prototype.request synthetic external response only'],coreMocked:false,leaseFunctionChain:'REAL acquireCloudPilotLease -> acquirePortableCrawlLease -> WeakMap -> compiler owned check -> renew -> release',publishDispatchCount:calls.filter(c=>c.kind==='PUBLISH').length,readOutcomeCount:calls.filter(c=>c.kind==='READ_OUTCOME').length,readbackOrigin:'Strictly decoded actual generated SQL terminal update merged with actual CREATE_PENDING source row and nullable defaults parsed from unchanged original Prisma schema; no executed database',outcome:observed.outcome,error:failure?.stack??null,terminal:observed.decoded?.terminal,jobUpsertCount:observed.decoded?.jobs.length,lifecycleCounts:observed.decoded?Object.fromEntries(['CURRENT','GRACE','VISIBLE'].map(k=>[k,observed.decoded.sets.LifecycleSetEvidenceMember.filter((m:any)=>m.setKind===k).length])):null};
 json('legacy-guard-observation.json',report);
 if(failure)throw failure;
 expect(report.publishDispatchCount).toBe(1);expect(observed.outcome.state).toBe('COMMITTED_EXACT');
 expect(['INCOMPLETE','NEEDS_MANUAL_COMPLETENESS_REVIEW']).toContain(report.terminal.completenessState);
 expect(report.terminal.atomicCommitState).toBe('COMMITTED');
 expect(report.terminal.blockerCode).toBe('COMPLETENESS_ANOMALY_UNVERIFIED');
 expect(report.terminal.blockerReason).toContain('TRUSTED_COUNT_DROP');
 expect(report.terminal.completenessCertificate).toBeNull();
 expect(report.terminal.completenessCertificateSha256).toBeNull();
 for(const key of ['baselinePreviousSourceResultId','baselinePreviousJobCount','baselineChangeReason']){
  expect(Object.hasOwn(report.terminal,key)).toBe(false);expect(observed.persistedRow[key]).toBeNull();
 }
 expect(report.jobUpsertCount,'Anomaly diagnostic must not mutate Jobs').toBe(0);
 expect(report.lifecycleCounts).toEqual({CURRENT:0,GRACE:0,VISIBLE:0});
 expect(observed.decoded.sets.CrawlObservation).toHaveLength(1);
 expect(observed.decoded.sets.CrawlObservation[0]).toMatchObject({successful:true,completenessVerified:false,atomicCommitSucceeded:true});
 expect(upper.before).toMatchObject({state:'PUBLISHING',lastSuccessAt:'2026-10-11T10:00:00.000Z',lastAcceptedJobCount:100});
 expect(upper.after).toEqual(upper.before);
 expect(upper.projection).toMatchObject({state:'PUBLISHING',visibleJobCount:100,lastSuccessAt:'2026-10-11T10:00:00.000Z'});
 expect(upper.schedule).toHaveLength(2);
 expect(upper.schedule[0]).toMatchObject({crawledAt:new Date('2026-10-12T10:00:00.000Z'),successful:false});
 expect(upper.schedule[1]).toMatchObject({crawledAt:new Date('2026-10-11T10:00:00.000Z'),successful:true});
 expect(calls.map(c=>c.kind)).toEqual(['READ_CONTEXT','READ_CONTEXT','LEASE_ACQUIRE','CREATE_PENDING','READ_CONTEXT','LEASE_RENEW','PUBLISH','READ_OUTCOME','LEASE_RELEASE']);
 expect(Object.hasOwn(current.input.publication.source,'completenessAnomalyTriggerCodes')).toBe(false);

});
