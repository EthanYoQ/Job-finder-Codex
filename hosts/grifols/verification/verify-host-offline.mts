// Synthetic packets only. No live SQL, external HTTP, supervisor, or crawl is executed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { inspectPacketSql, inspectRequest, decodeDeclarations } from '../host/runtime/review-packet-envelope.mts';
import { compileAtomicJsonDeclarations } from '../../../producer/src/db/atomicJsonDeclarations.ts';
import { makeArchiveBundle } from '../../../producer/src/crawler/cloudSourcePilotRelay.ts';
const base=resolve(import.meta.dirname,'../../..'),host=resolve(import.meta.dirname,'../host');
const fixture=JSON.parse(readFileSync(join(base,'verification/synthetic-grifols-packet/fixture.json'),'utf8'));
assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.noDatabaseExecution,true);assert.equal(fixture.noExternalHttp,true);
const results:any[]=[];const pass=(name:string)=>results.push({name,passed:true});
for(const text of ["O'Brien",'a\\b','中文职位']){const row={text},context={text};assert.deepEqual(decodeDeclarations(compileAtomicJsonDeclarations(row,context)),{terminal:row,context});pass('Exact compiler declaration character roundtrip '+text);}
assert.throws(()=>decodeDeclarations("source_result_data jsonb := E'{\"text\":\"a\\q\"}'::jsonb;\nexpected_context_data jsonb := E'{}'::jsonb;"));pass('Reject unsupported SQL escape');
const inspected=inspectPacketSql(fixture.packet.sql);assert.equal(inspected.terminal.sourceId,'source-grifols-china-social');assert.equal(inspected.delta.memberCount,2);pass('Current Grifols compiler packet and wrapped receipt');
for(const [name,transform] of [
 ['trailing SQL',(s:string)=>s+'\nSELECT 1;'],
 ['injected declaration',(s:string)=>s.replace('source_result_data jsonb := ','illegal integer := 1;\nsource_result_data jsonb := ')],
 ['changed timeout',(s:string)=>s.replace("'120000ms'","'120001ms'")],
 ['wrong terminal tuple',(s:string)=>{const row={...inspected.terminal,sourceId:'wrong-source'};return s.replace(compileAtomicJsonDeclarations(inspected.terminal,inspected.context),compileAtomicJsonDeclarations(row,inspected.context));}],
 ['corrupt delta hash',(s:string)=>{const row={...inspected.terminal,completenessCertificateSha256:'0'.repeat(64)};return s.replace(compileAtomicJsonDeclarations(inspected.terminal,inspected.context),compileAtomicJsonDeclarations(row,inspected.context));}]
] as const){assert.throws(()=>inspectPacketSql(transform(fixture.packet.sql)));pass('Reject '+name);}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const requestId='00000000-0000-4000-8000-000000000001';
const body={schemaVersion:1,requestId,kind:'PUBLISH',payload:{projectId:fixture.common.projectId,sql:fixture.packet.sql,dispatchBefore:fixture.packet.expiresAt},expiresAt:fixture.packet.expiresAt};
const request={...body,requestSha256:sha(JSON.stringify(body))};const proof=inspectRequest(request);
assert.throws(()=>inspectRequest({...request,payload:{...request.payload,sql:request.payload.sql+' '}}));pass('Reject changed request hash');
const testHost=join(import.meta.dirname,'synthetic-only-review-host'),run=join(testHost,fixture.planned.batch.id);mkdirSync(join(run,'relay'),{recursive:true});mkdirSync(join(run,'artifacts'),{recursive:true});mkdirSync(join(testHost,'runtime'),{recursive:true});
// Forward only to the reviewed local module; source host stays C50-bound.
writeFileSync(join(testHost,'runtime/review-packet-envelope.mts'),`import ${JSON.stringify(join(host,'runtime/review-packet-envelope.mts'))};\n`);
// The reviewed module's direct-CLI condition needs the actual path, so Python receives host-root wrapper below.
copyFileSync(join(host,'runtime/review-publication.py'),join(testHost,'runtime/review-publication.py'));
let py=readFileSync(join(testHost,'runtime/review-publication.py'),'utf8').replace("str(host/'runtime/review-packet-envelope.mts')",JSON.stringify(join(host,'runtime/review-packet-envelope.mts')));writeFileSync(join(testHost,'runtime/review-publication.py'),py);
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
writeFileSync(join(testHost,'host-config.json'),JSON.stringify({...cfg,root:testHost}));writeFileSync(join(testHost,'control-base.json'),JSON.stringify(fixture.common));writeFileSync(join(testHost,'activation.json'),JSON.stringify({status:'REGISTERED_VERIFIED',...fixture.common}));
writeFileSync(join(run,'relay',requestId+'.request.json'),JSON.stringify(request));writeFileSync(join(run,'relay',requestId+'.request.json.sql'),fixture.packet.sql);
const commit=fixture.packet.commit;
const bundle=await makeArchiveBundle({workspaceRoot:join(base,'verification/synthetic-grifols-packet'),releaseCandidateId:commit.sourceResult.releaseCandidateId,batchId:commit.sourceResult.batchId,sourceId:commit.sourceResult.sourceId,sourceResultId:commit.sourceResult.id,evidenceSubdirectory:'synthetic-evidence',artifacts:commit.artifacts.map((a:any)=>{const {redactionCommitmentSha256,...metadata}=a;return {...metadata,capturedAt:new Date(metadata.capturedAt)};})});
writeFileSync(join(run,'artifacts',run.split('/').at(-1)+'.archive.json'),JSON.stringify(bundle));
try{unlinkSync(join(run,'publication-review.json'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
const reviewed=JSON.parse(execFileSync('python3',[join(host,'runtime/review-publication.py'),testHost,run,requestId],{encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-grifols-china-social'}}));
assert.equal(reviewed.delta.schemaVersion,'job-projection-delta-receipt-v1');pass('Original local publication review with actual delta packet and synthetic archive');
for(const [name,change] of [
 ['expired request',(r:any)=>({...r,expiresAt:'2000-01-01T00:00:00.000Z'})],
 ['expired dispatch cutoff',(r:any)=>({...r,payload:{...r.payload,dispatchBefore:'2000-01-01T00:00:00.000Z'}})],
 ['premature ALL constraint flush',(r:any)=>({...r,payload:{...r.payload,sql:r.payload.sql.replace('SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;','SET CONSTRAINTS ALL IMMEDIATE;')}})],
 ['damaged atomic wrapper',(r:any)=>({...r,payload:{...r.payload,sql:r.payload.sql.replace(/DO \$atomic_/, 'DO $wrong_')}})]
] as const){const changed=change(structuredClone(request));const {requestSha256,...changedBody}=changed;changed.requestSha256=sha(JSON.stringify(changedBody));writeFileSync(join(run,'relay',requestId+'.request.json'),JSON.stringify(changed));writeFileSync(join(run,'relay',requestId+'.request.json.sql'),changed.payload.sql);assert.throws(()=>execFileSync('python3',[join(host,'runtime/review-publication.py'),testHost,run,requestId],{stdio:'pipe',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-grifols-china-social'}}));pass('Full reviewer rejects '+name);}
writeFileSync(join(run,'relay',requestId+'.request.json'),JSON.stringify(request));writeFileSync(join(run,'relay',requestId+'.request.json.sql'),request.payload.sql);

const A=Object.getPrototypeOf(async function(){}).constructor;
const helperSource=readFileSync(join(host,'host-helper-functions.js'),'utf8').replace('return {cfg,q,cmd,save,readFile,rows,mark,respond,sqlDispatch,next,machineJson};','return {cfg,q,cmd,save,readFile,rows,mark,respond,sqlDispatch,next,machineJson,publicationFailure};');
const helper=await new A('load','store','tools','notify',helperSource)((key:string)=>key==='proxyNode22:grifols:cloudPilotMachineJson'?readFileSync(join(host,'machine-json.js'),'utf8'):cfg,()=>{},{},()=>{});
const error=(code:string)=>({isError:true,structuredContent:{error_code:'INVALID_ARGUMENT'},content:[{type:'text',text:JSON.stringify({error:{name:'HttpException',message:code==='P0001'?'Failed to run sql query: ERROR:  P0001: PILOT_CONTEXT_CHANGED\nCONTEXT:  PL/pgSQL function inline_code_block line 12 at RAISE':`Failed to run sql query: ERROR:  ${code}: exact database error`}})}]});
for(const code of ['P0001','55P03','57014']){assert.equal(helper.publicationFailure(error(code),request,fixture.packet.sql,proof).outcome,'ROLLED_BACK');pass('Classify exact '+code+' rollback after declaration proof');}
assert.equal(helper.publicationFailure(error('P0001'),request,fixture.packet.sql).outcome,'UNKNOWN');pass('No declaration proof remains UNKNOWN');
assert.equal(helper.publicationFailure(error('40003'),request,fixture.packet.sql,proof).outcome,'UNKNOWN');pass('Uncertain 40003 remains UNKNOWN');
assert.equal(helper.publicationFailure({isError:true,content:[{type:'text',text:'timeout'}]},request,fixture.packet.sql,proof).outcome,'UNKNOWN');pass('Unrecognized tool envelope remains UNKNOWN');
writeFileSync(join(import.meta.dirname,'OFFLINE_PACKET_REVIEW_RESULTS.json'),JSON.stringify({qualification:false,noExternalHttp:true,noDatabase:true,results},null,2)+'\n');console.log(JSON.stringify({passed:results.length,results}));
