// Synthetic packets only. No live SQL, external HTTP, supervisor, or crawl is executed.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { inspectPacketSql, inspectRequest, decodeDeclarations } from '../hosts/kelun/host/runtime/review-packet-envelope.mts';
import { compileAtomicJsonDeclarations } from '../producer/src/db/atomicJsonDeclarations.ts';
import { makeArchiveBundle } from '../producer/src/crawler/cloudSourcePilotRelay.ts';
const base=resolve(import.meta.dirname,'..'),host=join(base,'hosts/kelun/host');
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
const output=mkdtempSync(join(import.meta.dirname,'packet-run-'));
const fixtureRoot=join(output,'synthetic-packet');
const generated=execFileSync(cfg.node,['--import',join(cfg.repo,'node_modules/tsx/dist/loader.mjs'),join(import.meta.dirname,'generate-synthetic-packet.mts'),fixtureRoot],{encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-kelun-social',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});
writeFileSync(join(output,'generator-stdout.log'),generated);
const fixture=JSON.parse(readFileSync(join(fixtureRoot,'fixture.json'),'utf8'));
const protectedNames=['activation.json','control-base.json','host-config.json','context-read.sql'];
const protectedBefore=Object.fromEntries(protectedNames.map(n=>[n,existsSync(join(host,n))?readFileSync(join(host,n),'utf8'):null]));
assert.equal(fixture.syntheticOnly,true);assert.equal(fixture.noDatabaseExecution,true);assert.equal(fixture.noExternalHttp,true);
const results:any[]=[];const pass=(name:string)=>results.push({name,passed:true});
for(const text of ["O'Brien",'a\\b','中文职位']){const row={text},context={text};assert.deepEqual(decodeDeclarations(compileAtomicJsonDeclarations(row,context)),{terminal:row,context});pass('Exact compiler declaration character roundtrip '+text);}
assert.throws(()=>decodeDeclarations("source_result_data jsonb := E'{\"text\":\"a\\q\"}'::jsonb;\nexpected_context_data jsonb := E'{}'::jsonb;"));pass('Reject unsupported SQL escape');
const inspected=inspectPacketSql(fixture.packet.sql);assert.equal(inspected.terminal.sourceId,'source-kelun-social');assert.equal(inspected.delta.memberCount,20);pass('Current Kelun compiler packet and wrapped receipt');
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
const testHost=join(output,'synthetic-only-review-host'),run=join(testHost,fixture.planned.batch.id);mkdirSync(join(run,'relay'),{recursive:true});mkdirSync(join(run,'artifacts'),{recursive:true});mkdirSync(join(testHost,'runtime'),{recursive:true});
writeFileSync(join(testHost,'host-config.json'),JSON.stringify({...cfg,root:testHost}));writeFileSync(join(testHost,'control-base.json'),JSON.stringify(fixture.common));writeFileSync(join(testHost,'activation.json'),JSON.stringify({status:'REGISTERED_VERIFIED',...fixture.common}));
writeFileSync(join(run,'relay',requestId+'.request.json'),JSON.stringify(request));writeFileSync(join(run,'relay',requestId+'.request.json.sql'),fixture.packet.sql);
const commit=fixture.packet.commit;
const bundle=await makeArchiveBundle({workspaceRoot:fixtureRoot,releaseCandidateId:commit.sourceResult.releaseCandidateId,batchId:commit.sourceResult.batchId,sourceId:commit.sourceResult.sourceId,sourceResultId:commit.sourceResult.id,evidenceSubdirectory:'synthetic-evidence',artifacts:commit.artifacts.map((a:any)=>{const {redactionCommitmentSha256,...metadata}=a;return {...metadata,capturedAt:new Date(metadata.capturedAt)};})});
writeFileSync(join(run,'artifacts',run.split('/').at(-1)+'.archive.json'),JSON.stringify(bundle));
try{unlinkSync(join(run,'publication-review.json'));}catch(e:any){if(e.code!=='ENOENT')throw e;}
const reviewed=JSON.parse(execFileSync('python3',[join(host,'runtime/review-publication.py'),testHost,run,requestId],{encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-kelun-social',PYTHONDONTWRITEBYTECODE:'1'}}));
assert.equal(reviewed.delta.schemaVersion,'job-projection-delta-receipt-v1');pass('Original local publication review with actual delta packet and synthetic archive');
const clearReview=()=>{try{unlinkSync(join(run,'publication-review.json'));}catch(e:any){if(e.code!=='ENOENT')throw e;}};
for(const [name,change] of [
 ['expired request',(r:any)=>({...r,expiresAt:'2000-01-01T00:00:00.000Z'})],
 ['expired dispatch cutoff',(r:any)=>({...r,payload:{...r.payload,dispatchBefore:'2000-01-01T00:00:00.000Z'}})],
 ['premature ALL constraint flush',(r:any)=>({...r,payload:{...r.payload,sql:r.payload.sql.replace('SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;','SET CONSTRAINTS ALL IMMEDIATE;')}})],
 ['damaged atomic wrapper',(r:any)=>({...r,payload:{...r.payload,sql:r.payload.sql.replace(/DO \$atomic_/, 'DO $wrong_')}})]
] as const){const changed=change(structuredClone(request));const {requestSha256,...changedBody}=changed;changed.requestSha256=sha(JSON.stringify(changedBody));clearReview();writeFileSync(join(run,'relay',requestId+'.request.json'),JSON.stringify(changed));writeFileSync(join(run,'relay',requestId+'.request.json.sql'),changed.payload.sql);assert.throws(()=>execFileSync('python3',[join(host,'runtime/review-publication.py'),testHost,run,requestId],{stdio:'pipe',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-kelun-social',PYTHONDONTWRITEBYTECODE:'1'}}));assert(!existsSync(join(run,'publication-review.json')));pass('Full reviewer rejects '+name);}
writeFileSync(join(run,'relay',requestId+'.request.json'),JSON.stringify(request));writeFileSync(join(run,'relay',requestId+'.request.json.sql'),request.payload.sql);

const A=Object.getPrototypeOf(async function(){}).constructor;
const helperSource=readFileSync(join(host,'host-helper-functions.js'),'utf8').replace('return {cfg,q,cmd,save,readFile,rows,mark,respond,sqlDispatch,next,machineJson};','return {cfg,q,cmd,save,readFile,rows,mark,respond,sqlDispatch,next,machineJson,publicationFailure};');
const helper=await new A('load','store','tools','notify',helperSource)((key:string)=>key==='proxyNode22:kelunNext:cloudPilotMachineJson'?readFileSync(join(host,'machine-json.js'),'utf8'):cfg,()=>{},{},()=>{});
const error=(code:string)=>({isError:true,structuredContent:{error_code:'INVALID_ARGUMENT'},content:[{type:'text',text:JSON.stringify({error:{name:'HttpException',message:code==='P0001'?'Failed to run sql query: ERROR:  P0001: PILOT_CONTEXT_CHANGED\nCONTEXT:  PL/pgSQL function inline_code_block line 12 at RAISE':`Failed to run sql query: ERROR:  ${code}: exact database error`}})}]});
for(const code of ['P0001','55P03','57014']){assert.equal(helper.publicationFailure(error(code),request,fixture.packet.sql,proof).outcome,'ROLLED_BACK');pass('Classify exact '+code+' rollback after declaration proof');}
assert.equal(helper.publicationFailure(error('P0001'),request,fixture.packet.sql).outcome,'UNKNOWN');pass('No declaration proof remains UNKNOWN');
assert.equal(helper.publicationFailure(error('40003'),request,fixture.packet.sql,proof).outcome,'UNKNOWN');pass('Uncertain 40003 remains UNKNOWN');
assert.equal(helper.publicationFailure({isError:true,content:[{type:'text',text:'timeout'}]},request,fixture.packet.sql,proof).outcome,'UNKNOWN');pass('Unrecognized tool envelope remains UNKNOWN');
assert.equal(results.length,22,'ORIGINAL_22_GATES_MUST_BE_PRESERVED');
const original22=results.length;


const review=()=>execFileSync('python3',[join(host,'runtime/review-publication.py'),testHost,run,requestId],{stdio:'pipe',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-kelun-social',PYTHONDONTWRITEBYTECODE:'1'}});
const baselineControl=fixture.common,baselineBinding={status:'REGISTERED_VERIFIED',...fixture.common};
for(const [name,change] of [
 ['no candidate',(c:any,b:any)=>{c.candidate=null;b.candidate=null;}],
 ['version 51',(c:any,b:any)=>{c.candidate.version=51;b.candidate.version=51;}],
 ['version 52 versus 53',(c:any,b:any)=>{b.candidate.version=53;}],
 ['candidate id mismatch',(c:any,b:any)=>{b.candidate.id+='-wrong';}],
 ['candidate goal mismatch',(c:any,b:any)=>{b.candidate.goalId+='-wrong';}],
 ['same old commit in both files',(c:any,b:any)=>{c.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';b.build.commitSha=c.build.commitSha;}],
 ['same corrupt content hash in both files',(c:any,b:any)=>{c.build.contentSha256='0'.repeat(64);b.build.contentSha256=c.build.contentSha256;}],
 ['DB identity mismatch',(c:any,b:any)=>{b.databaseIdentity.dbSnapshotHash='0'.repeat(64);}],
 ['not registered',(c:any,b:any)=>{b.status='UNREGISTERED_NOT_ACTIVATED';}]
] as const){
 const c=structuredClone(baselineControl),b=structuredClone(baselineBinding);change(c,b);clearReview();
 writeFileSync(join(testHost,'control-base.json'),JSON.stringify(c));writeFileSync(join(testHost,'activation.json'),JSON.stringify(b));
 assert.throws(review);assert(!existsSync(join(run,'publication-review.json')));pass('Full reviewer rejects '+name);
}
writeFileSync(join(testHost,'control-base.json'),JSON.stringify(baselineControl));writeFileSync(join(testHost,'activation.json'),JSON.stringify(baselineBinding));
clearReview();review();
for(const name of ['packet-machine-diagnostics.jsonl','publication-review.json']){
 const bytes=readFileSync(join(run,name));assert.equal(bytes.at(-1),0x0a,name+' must end in actual LF');assert(!bytes.subarray(-2).equals(Buffer.from('\\n')));
 if(name.endsWith('.jsonl')){const lines=bytes.toString('utf8').trimEnd().split('\n');assert(lines.length>=3);for(const line of lines)JSON.parse(line);}
 else JSON.parse(bytes.toString('utf8'));
 pass('Persisted '+name+' uses real LF bytes and parses without normalization');
}
for(const name of protectedNames)assert.equal(existsSync(join(host,name))?readFileSync(join(host,name),'utf8'):null,protectedBefore[name]);
const report={qualification:false,syntheticOnly:true,noExternalHttp:true,noDatabase:true,noLaunch:true,sourceHostUnchanged:true,original22,passed:results.length,host,output,build:fixture.common.build,syntheticCandidate:fixture.common.candidate,results};
writeFileSync(join(output,'OFFLINE_PACKET_REVIEW_RESULTS.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(join(import.meta.dirname,'OFFLINE_PACKET_REVIEW_RESULTS.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:results.length,original22,output,report:join(output,'OFFLINE_PACKET_REVIEW_RESULTS.json')}));
