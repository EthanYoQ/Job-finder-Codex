import fs from 'node:fs';
import assert from 'node:assert/strict';
const A=Object.getPrototypeOf(async function(){}).constructor;
const source=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/transport/adapted-host-helper-functions.js',import.meta.url),'utf8');
const config={mode:'NATIVE_PORTABLE_CONNECTOR_V1',sourceId:'source-test',bindingSha256:'a'.repeat(64),root:'/original',repo:'/repo'};
let starts=0,waits=0;
const tools={exec_command:async()=>{starts++;return{session_id:7,output:'first'};},write_stdin:async x=>{assert.equal(x.session_id,7);waits++;return{exit_code:0,output:'second'};}};
const h=await new A('load','tools',source)(()=>config,tools);
assert.equal(await h.cmd("node '/original/host-files.mts' connector-validate"),'firstsecond');
assert.equal(starts,1);assert.equal(waits,1);
tools.write_stdin=async()=>({exit_code:1,output:'failed'});
await assert.rejects(h.cmd("node '/original/host-files.mts' connector-validate"),/HOST_COMMAND:firstfailed/);
console.log('PASS: yielded original session is awaited once; failed completion stays failed');

const entry=fs.readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const commandSource=entry.slice(entry.indexOf('async function command('),entry.indexOf('const read='));
const command=await new A('tools',commandSource+'return command;')(tools);
tools.exec_command=async()=>({exit_code:137,output:'warning only'});
await assert.rejects(command('original-read-only-step'),/LOCAL_STEP:exit=137; warning only/);
console.log('PASS: outer command preserves actual exit code even when stderr only contains warnings');

const review=fs.readFileSync(new URL('./review-original-publication.mjs',import.meta.url),'utf8');
const remaining=review.match(/const timeout=(.*?);assert\(timeout>0,'ORIGINAL_REVIEW_DEADLINE'\)/)[1];
const remainingTime=new Function('request','starts','Date','return '+remaining);
const req={payload:{dispatchBefore:'2026-10-17T14:00:00Z'},expiresAt:'2026-10-17T14:01:00Z'};
const now=Date.parse('2026-10-17T13:43:00Z');
assert.equal(remainingTime(req,[{outerDeadline:now+1800000}],{parse:Date.parse,now:()=>now}),1020000);
assert.equal(remainingTime(req,[{outerDeadline:now+1000}],{parse:Date.parse,now:()=>now}),1000);
assert(remainingTime(req,[{outerDeadline:now-1}],{parse:Date.parse,now:()=>now})<0);
assert(!review.includes('timeout:120000'));
console.log('PASS: review uses earliest original deadline, without arbitrary 120-second sublimit');
const outer=review.slice(review.indexOf(" const loader=V+"),review.indexOf("\n}else{"));
const executeReviewSteps=new Function('V','R','run','id','relay','contextRequestId','special','process','request','starts','Date','assert','execFileSync',outer);
const calls=[];const invoke=exec=>executeReviewSteps('/v','/r','/run','req','/relay','context-id',false,{argv:['node','/review.mjs'],execPath:'/node'},req,[{outerDeadline:now+1800000}],{parse:Date.parse,now:()=>now},assert,exec);
invoke((node,args,options)=>{assert.equal(node,'/node');assert.equal(options.timeout,1020000);calls.push(args);});
assert.equal(calls.length,3);assert.equal(calls[0].at(-2),'context-id');assert.equal(calls[0].at(-1),'packet-only');assert(calls[1].includes('/r/offline-checkers/replay-original-json-archive.mts'));assert(calls[2].includes('/r/offline-checkers/project-original-target-api.mts'));
let attempted=0;assert.throws(()=>invoke(()=>{attempted++;throw Error('packet failed');}),/packet failed/);assert.equal(attempted,1);
console.log('PASS: packet process completes before raw and target; packet failure stops later steps');


const contextId='00000000-0000-0000-0000-000000000001', snapshot='a'.repeat(64), project='yiopvxysxrtrnvqxwgbx';
const expectedContext={sourceId:'source-test',sourceConfigSha256:'b'.repeat(64),snapshotSha256:snapshot};
const contextSource=review.slice(review.indexOf('let publicationContext;'),review.indexOf('\nconst packet=await review'));
const selectContext=new Function('contextRequestId','read','relay','request','assert',contextSource+';return publicationContext;');
const goodRequest={requestId:contextId,requestSha256:'bound-request',kind:'READ_PUBLICATION_CONTEXT',payload:{projectId:project}};
const goodResponse={requestId:contextId,requestSha256:'bound-request',kind:'READ_PUBLICATION_CONTEXT',result:{status:'SUCCEEDED',rows:[{context:{...expectedContext,checkedAt:'original-time'}}]}};
const select=(req=goodRequest,res=goodResponse,id=contextId,customRead)=>{
 const reads=[];const read=customRead??(file=>{reads.push(file);if(file==='/relay/'+contextId+'.request.json')return req;if(file==='/relay/'+contextId+'.response.json')return res;throw Error('unexpected read '+file);});
 return {value:selectContext(id,read,'/relay',{payload:{projectId:project}},assert),reads};
};
assert.deepEqual(select().value,goodResponse.result.rows[0].context);
assert.deepEqual(select().reads,['/relay/'+contextId+'.response.json','/relay/'+contextId+'.request.json']);
for(const id of ['',null])assert.deepEqual(select(goodRequest,goodResponse,id),{value:undefined,reads:[]});
assert.throws(()=>select(goodRequest,goodResponse,'../other'));
for(const mutate of [r=>r.requestId='other',r=>r.requestSha256='other',r=>r.kind='READ_CONTEXT',r=>r.payload.projectId='other']){const req=structuredClone(goodRequest);mutate(req);assert.throws(()=>select(req));}
for(const mutate of [r=>r.requestId='other',r=>r.requestSha256='other',r=>r.kind='READ_CONTEXT',r=>r.result.status='FAILED',r=>r.result.rows[0].context.snapshotSha256='other',r=>r.result.rows[0].context.snapshotSha256=[snapshot],r=>r.result.rows=[]]){const res=structuredClone(goodResponse);mutate(res);assert.throws(()=>select(goodRequest,res));}
assert.throws(()=>select(null));assert.throws(()=>select(goodRequest,null));
for(const error of [new Error('ENOENT'),new SyntaxError('malformed JSON')])assert.throws(()=>select(goodRequest,goodResponse,contextId,()=>{throw error;}),e=>e===error);
// The original reviewer owns compact source/config/snapshot binding after the wrapper's ID lookup.
const control=fs.readFileSync(new URL('../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/db/cloudPilotSqlControl.ts',import.meta.url),'utf8');
const comparisonBody=control.match(/export function publicationContextComparisonValue\([^)]*\)\{\n([\s\S]*?)\n\}/);assert(comparisonBody);
const comparison=new Function('context',comparisonBody[1]);
for(const file of ['original-portable-sql-review.mts','biogen-packet-gate.mts','hengrui-packet-gate.mts']){
 const reviewer=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/offline-checkers/'+file,import.meta.url),'utf8');
 const binding=reviewer.split('\n').find(line=>line.startsWith('const context=packetContext.snapshotSha256?'));assert(binding);
 const bind=new Function('packetContext','publicationContext','publicationContextComparisonValue','assert',binding+';return context;');
 assert.strictEqual(bind(expectedContext,select().value,comparison,assert),goodResponse.result.rows[0].context);
 assert.throws(()=>bind(expectedContext,select(goodRequest,goodResponse,'').value,comparison,assert),/READ_CONTEXT_REQUIRED/);
 for(const key of ['sourceId','sourceConfigSha256','snapshotSha256']){const res=structuredClone(goodResponse);res.result.rows[0].context[key]='c'.repeat(64);assert.throws(()=>bind(expectedContext,select(goodRequest,res).value,comparison,assert),/READ_CONTEXT_BINDING/);}
 const {snapshotSha256,...legacy}=goodResponse.result.rows[0].context;
 assert.strictEqual(bind(legacy,select(goodRequest,goodResponse,'').value,comparison,assert),legacy);
}
console.log('PASS: exact ID lookup keeps request/response guards; three original reviewers reject compact missing ID and wrong source/config/snapshot; legacy needs no fallback read');

const callbackStart=entry.indexOf('reviewPublication:async ')+ 'reviewPublication:'.length;
const callbackText=entry.slice(callbackStart,entry.indexOf(',\n  readback:',callbackStart));
let callbackCommand, recentQueries=0;const reviewedRequest={requestId:'publish-id',requestSha256:'publish-hash'};
const reviewCallback=await new A('command','q','sourceId','N','V','D','run','relay','sql','return '+callbackText)(async cmd=>{callbackCommand=cmd;return JSON.stringify(reviewedRequest);},s=>"'"+s+"'",'source-test','/node','/vendor','/module','/run','/relay',async()=>{recentQueries++;return [{fresh:false}];});
assert.deepEqual(await reviewCallback(reviewedRequest,{},contextId),reviewedRequest);
assert(callbackCommand.includes("'/module/review-original-publication.mjs' '/run' 'publish-id' '/relay' '"+contextId+"' > "));
assert.equal(recentQueries,1);
console.log('PASS: actual Functions review callback passes context ID into the original command and keeps the final recent-success gate');
