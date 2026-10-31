import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
const A=Object.getPrototypeOf(async function(){}).constructor;
const entry=fs.readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const stageSource=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/transport/original-host-stage-functions.js',import.meta.url),'utf8');
const readerSource=fs.readFileSync(new URL('./reader-before-functions.js',import.meta.url),'utf8');
const query=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/transport/viatris-reader-before-original.sql',import.meta.url),'utf8');
const callbackSource=entry.slice(entry.indexOf(' let preCaptureReadAttempted='),entry.indexOf(" const batchId='dot-auto-'"));
assert(callbackSource.includes('return before.publicationContext'));
assert(entry.includes('deadline:Date.now()+1800000,readPreCaptureContext,'));
const NOW=Date.parse('2026-10-31T00:20:00Z'),SOURCE='source-amgen-china-social',CONFIG='config';
const request=kind=>({requestId:'request',requestSha256:'request-sha',kind,expiresAt:new Date(NOW+60000).toISOString(),payload:{purpose:'PRE_CAPTURE',projectId:'yiopvxysxrtrnvqxwgbx',sourceId:SOURCE,sourceConfigSha256:CONFIG,dispatchBefore:new Date(NOW+35000).toISOString(),sql:'SELECT publication'}});
const before=()=>({sourceId:SOURCE,sourceConfigSha256:CONFIG,transactionReadOnly:'on',isolationLevel:'repeatable read',results:[],publicationContext:{checkedAt:new Date(NOW).toISOString(),sourceId:SOURCE,sourceConfigSha256:CONFIG,jobs:[],firstAccepted:null,latestAccepted:null,candidateRow:{id:'candidate'},sourceRow:{id:SOURCE},companyRow:{id:'company'}}});
async function fixture({sourceId=SOURCE,sqlError,clock=NOW,splitChange=false}={}){
 const calls=[],saved=new Map(),snapshot=before();let sqlCalls=0;
 const sql=async sql=>{
  calls.push('reader-sql');sqlCalls++;
  assert(sql.startsWith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='));
  assert(sql.trimEnd().endsWith('ROLLBACK;'));
  if(sqlError)throw sqlError;
  if(sourceId==='source-hengrui-social')return sqlCalls===1?[{reader_before:snapshot,snapshot_sha256:'a'.repeat(64)}]:[{snapshot_sha256:(splitChange?'b':'a').repeat(64)}];
  return [{reader_before:snapshot,compacted_member_ids:[]}];
 };
 const readPreCaptureContext=await new A('sourceId','D','read','A','query','sql','save','S','Date',callbackSource+'return readPreCaptureContext;')(sourceId,'/candidate',async()=>readerSource,A,query,sql,async(path,value)=>{calls.push('save');saved.set(path,structuredClone(value));},'/source',{parse:Date.parse,now:()=>clock});
 const binding={sourceId:SOURCE,sourceConfigSha256:CONFIG,candidateId:'candidate',buildContentSha256:'build',relayDirectory:'/relay'};
 const h={cfg:{project:'yiopvxysxrtrnvqxwgbx',root:'/host'},binding:async()=>binding,q:x=>x,
  cmd:async()=>{calls.push('compile');return JSON.stringify({requestId:'request',requestSha256:'request-sha',candidateId:'candidate',buildContentSha256:'build',sql:'SELECT original-full-context'});},
  mark:async()=>calls.push('mark'),respond:async(r,dir,result)=>{calls.push('respond');saved.set('response',result);},rows:x=>x,
  sqlDispatch:async(r,dir,sql)=>{calls.push('publication-sql');assert.equal(sql,'SELECT original-full-context');return {status:'SUCCEEDED'};}};
 const {handle}=await new A('h','tools','store','const cfg=h.cfg;\n'+stageSource.slice(stageSource.indexOf('async function handle')))(h,{mcp__codex_apps__supabase_execute_sql:async()=>{calls.push('duplicate-context-sql');return [{context:snapshot.publicationContext}];}},()=>{});
 return {handle,readPreCaptureContext,calls,saved,snapshot,h,sqlCount:()=>sqlCalls};
}
const good=await fixture();
assert.deepEqual(good.calls,[],'constructing the callback must not read before the producer request');
assert.equal((await good.handle(request('READ_CONTEXT'),'/relay',good.readPreCaptureContext)).status,'READ_CONTEXT');
assert.deepEqual(good.calls,['compile','mark','reader-sql','save','save','respond']);
assert.equal(good.sqlCount(),1);
assert.deepEqual(good.saved.get('/source/READER_BEFORE.json'),good.snapshot);
assert.deepEqual(good.saved.get('response'),good.snapshot.publicationContext);
assert.deepEqual(good.saved.get('/source/expected-candidate.json'),good.snapshot.publicationContext.candidateRow);
await assert.rejects(good.readPreCaptureContext(request('READ_CONTEXT')),/PRE_CAPTURE_READ_ALREADY_ATTEMPTED/);
assert.equal(good.sqlCount(),1);
const beforePublication=good.calls.length;
await good.handle(request('READ_PUBLICATION_CONTEXT'),'/relay',good.readPreCaptureContext);
assert.deepEqual(good.calls.slice(beforePublication),['compile','publication-sql']);
console.log('PASS: one original reader-before read after PRE_CAPTURE, unchanged context persisted/returned; fresh publication query is separate');

for(const patch of [{expired:true},{dispatchRecorded:true},{payload:{...request('READ_CONTEXT').payload,sourceId:'wrong'}}]){
 const bad=await fixture();await assert.rejects(bad.handle({...request('READ_CONTEXT'),...patch},'/relay',bad.readPreCaptureContext),/STALE_OR_UNCERTAIN|SOURCE_BINDING/);
 assert.equal(bad.sqlCount(),0);assert(!bad.calls.includes('mark'));
}
const mismatch=await fixture();mismatch.h.cmd=async()=>JSON.stringify({requestId:'request',requestSha256:'other',candidateId:'candidate',buildContentSha256:'build'});
await assert.rejects(mismatch.handle(request('READ_CONTEXT'),'/relay',mismatch.readPreCaptureContext),/HOST_CONTEXT_PACKET_BINDING/);
assert.equal(mismatch.sqlCount(),0);
for(const error of [Error('actual tool review rejection'),Error('transport response unavailable')]){
 const failed=await fixture({sqlError:error});
 await assert.rejects(failed.handle(request('READ_CONTEXT'),'/relay',failed.readPreCaptureContext),e=>e===error);
 assert.equal(failed.sqlCount(),1);assert(!failed.calls.includes('respond'));assert(!failed.calls.includes('duplicate-context-sql'));
 await assert.rejects(failed.readPreCaptureContext(request('READ_CONTEXT')),/ALREADY_ATTEMPTED/);assert.equal(failed.sqlCount(),1);
}
const expired=await fixture({clock:NOW+60000});await assert.rejects(expired.readPreCaptureContext(request('READ_CONTEXT')),/PRE_CAPTURE_READ_EXPIRED/);assert.equal(expired.sqlCount(),0);
const split=await fixture({sourceId:'source-hengrui-social',splitChange:true});await assert.rejects(split.readPreCaptureContext(request('READ_CONTEXT')),/READER_SNAPSHOT_CHANGED/);assert.equal(split.sqlCount(),2);assert.equal(split.saved.size,0);
console.log('PASS: original scope/binding/stale guards; rejection/transport failure never fall back or retry; split-read drift remains rejected');

const relaySource=fs.readFileSync(new URL('./automatic-relay-functions.js',import.meta.url),'utf8');
const {serviceOriginalRelay}=await new A(relaySource)();let next=true,forwarded;
await serviceOriginalRelay({stage:{h:{cfg:{project:'yiopvxysxrtrnvqxwgbx',sourceId:SOURCE},next:async()=>{if(!next)return;next=false;return {...request('READ_CONTEXT'),expiresAt:new Date(Date.now()+60000).toISOString()};}},handle:async(r,d,callback)=>{forwarded=callback;return {status:'READ_CONTEXT'};}},sourceId:SOURCE,relayDirectory:'/relay',deadline:Date.now()+60000,readPreCaptureContext:good.readPreCaptureContext,pollProducer:async()=>({exitCode:1})});
assert.strictEqual(forwarded,good.readPreCaptureContext);
const liveRoot='/workspace/scratch/5e9614251709/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source';
for(const file of ['p0-cloud-source-pilot.ts','p0-cloud-portable-source-pilot.ts']){
 const source=fs.readFileSync(liveRoot+'/scripts/'+file,'utf8');
 const line=source.split('\n').find(s=>s.includes('Date.parse(pre.checkedAt)<preRequestedAt-1000'));assert(line);
 const check=new Function('pre','preRequestedAt','Date',line);
 check({checkedAt:new Date(NOW).toISOString()},NOW,{parse:Date.parse,now:()=>NOW+100});
 assert.throws(()=>check({checkedAt:new Date(NOW-1001).toISOString()},NOW,{parse:Date.parse,now:()=>NOW+100}),/FRESH_READ_REQUIRED/);
}
const readerReview=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/offline-checkers/original-portable-reader-replay.mts',import.meta.url),'utf8');
const compare=readerReview.split('\n').find(s=>s.startsWith('const withoutTime='));assert(compare);
const check=new Function('before','d','isDeepStrictEqual','assert',compare.replace('(x:any)','(x)'));
check(good.snapshot,{context:good.snapshot.publicationContext},isDeepStrictEqual,assert);
const changed=structuredClone(good.snapshot.publicationContext);changed.jobs.push({dedupeKey:'concurrent-write'});
assert.throws(()=>check(good.snapshot,{context:changed},isDeepStrictEqual,assert),/LIVE_BEFORE_CONTEXT_CHANGED/);
console.log('PASS: original service forwards callback; original producer freshness and final full-context concurrency comparison remain effective');
