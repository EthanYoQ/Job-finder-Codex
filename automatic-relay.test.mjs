import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const {runOriginalSerial, serviceOriginalRelay} = await new AsyncFunction(readFileSync(new URL('./automatic-relay-functions.js', import.meta.url), 'utf8'))();
function fixture({unknown=false, expired=false, reviewFails=false}={}) {
 const calls=[], sourceId='source-ucb-china-social', deadline=Date.now()+60000;
 const queue=['READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME'].map((kind,i)=>({kind, requestId:String(i), requestSha256:'bound-'+i, expired:i===2&&expired, expiresAt:new Date(deadline).toISOString(), payload:{sql:'original',dispatchBefore:new Date(deadline-1000).toISOString()}}));
 const h={cfg:{project:'yiopvxysxrtrnvqxwgbx',sourceId}, next:async()=>queue.shift(), respond:async(r,dir,result)=>{calls.push('reject:'+result.outcome);}, sqlDispatch:async r=>{calls.push('dispatch'); return unknown?{status:'FAILED',outcome:'UNKNOWN'}:{status:'SUCCEEDED'};}};
 const stage={h,handle:async r=>{calls.push(r.kind);return {status:r.kind==='PUBLISH'?'AWAITING_PARENT_REVIEW':'SUCCEEDED'};}};
 return {calls,job:{sourceId,deadline,stage,relayDirectory:'/original/relay',reviewPublication:async (r,prepared,contextRequestId)=>{calls.push('review');assert.equal(contextRequestId,'1');if(reviewFails)throw Error('raw mismatch');return r;},pollProducer:async()=>({exitCode:queue.length?null:0}),readback:async()=>{calls.push('readback');return {status:'WEB_VERIFIED'};}}};
}
const ok=fixture();assert.equal((await serviceOriginalRelay(ok.job)).status,'WEB_VERIFIED');
assert.deepEqual(ok.calls,['READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','review','dispatch','READ_OUTCOME','readback']);
const unknown=fixture({unknown:true});assert.equal((await serviceOriginalRelay(unknown.job)).reason,'UNKNOWN_PUBLICATION');assert.equal(unknown.calls.filter(x=>x==='dispatch').length,1);assert(!unknown.calls.includes('readback'));assert(unknown.calls.includes('READ_OUTCOME'));
const stopped=fixture({unknown:true});stopped.job.pollProducer=async()=>({exitCode:stopped.calls.includes('dispatch')?99:null});const stoppedResult=await serviceOriginalRelay(stopped.job);assert.equal(stoppedResult.reason,'UNKNOWN_PUBLICATION');assert.equal(stoppedResult.outcomeSeen,false);assert.equal(stopped.calls.filter(x=>x==='dispatch').length,1);
const stale=fixture({expired:true});assert.equal((await serviceOriginalRelay(stale.job)).reason,'EXPIRED_OR_UNKNOWN_DISPATCH');assert(!stale.calls.includes('dispatch'));
const bad=fixture({reviewFails:true}), next=fixture();const result=await runOriginalSerial(['bad','recent','next'],async id=>id==='bad'?bad.job:id==='recent'?{skip:'REAL_OBSERVATION_WITHIN_12H'}:next.job);
assert.deepEqual(result.map(r=>r.status),['HELD','SKIPPED','WEB_VERIFIED']);assert(!bad.calls.includes('dispatch'));assert(bad.calls.includes('reject:NOT_DISPATCHED'));assert(bad.calls.includes('READ_OUTCOME'));assert.match(result[0].diagnostic,/raw mismatch/);
console.log('PASS: serial relay, single dispatch, unknown/expiry hold, failed source isolation, dedup skip');
const entry=readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const folders=JSON.parse(entry.match(/const sourceFolders=(\{[^\n]+\});/)[1].replaceAll("'",'"'));
const routes=JSON.parse(readFileSync(new URL('./sources.json',import.meta.url),'utf8')).rows;
assert.equal(routes.length,36);assert.equal(Object.keys(folders).length,36);assert.equal(Object.keys(folders).filter(id=>routes.find(r=>r.sourceId===id)?.route==='PORTABLE').length,20);assert.equal(Object.keys(folders).filter(id=>routes.find(r=>r.sourceId===id)?.route==='TRUE_A').length,12);assert.equal(folders['source-astrazeneca-social'],'astrazeneca');
assert.equal(folders['source-pfizer-china-social'],'pfizer');
console.log('PASS: 36 original routes, 20 portable, 12 original A and four original B configurations; configuration is not live acceptance');

assert(entry.includes("mode:config.mode"));assert(entry.includes("config.route==='PORTABLE'?'p0-cloud-portable-source-pilot.ts':'p0-cloud-source-pilot.ts'"));
const prepare=readFileSync(new URL('./prepare-original-source.py',import.meta.url),'utf8');assert(prepare.includes("kind=mode,route=row['route']"));assert(prepare.includes("'mode':mode,'route':row['route']"));

assert(prepare.includes("'source-csl-china-social':'dot-cloud-csl-pilot'"));assert(prepare.includes("'source-lilly-china-social':'dot-cloud-lilly-pilot'"));

const unresolved=fixture({unknown:true});let preparedCount=0;const heldSequence=await runOriginalSerial(['unknown','next'],async()=>{preparedCount++;return unresolved.job;});assert.equal(preparedCount,1);assert.equal(heldSequence[0].reason,'UNKNOWN_PUBLICATION');

assert(entry.includes("replaceAll('__ORIGINAL_CERTIFICATE_SCHEMA__'"));assert(entry.includes("replaceAll('__ORIGINAL_REQUIRES_PORTABLE_POLICY__'"));

const recovered=fixture({unknown:true});const originalPoll=recovered.job.pollProducer;recovered.job.pollProducer=async()=>({...await originalPoll(),outcomeState:'COMMITTED_EXACT'});assert.equal((await serviceOriginalRelay(recovered.job)).status,'WEB_VERIFIED');assert.equal(recovered.calls.filter(x=>x==='dispatch').length,1);assert(recovered.calls.includes('READ_OUTCOME'));

assert(!entry.includes("ORGANON_MANUAL_KEYWORD_COUNTRY_APPLICATION_EVIDENCE_PENDING"));
assert.equal(folders['source-organon-china-social'],'organon');

assert.equal(folders['source-johnson-innovative-medicine-social'],'jnj');
assert(entry.includes('captureJnjManagedDom'));assert(entry.includes('prepare-jnj-dom-current-capture.ts'));assert(entry.includes('...(currentCapture?{currentCapture}:{})'));

for(const [id,folder] of [['source-bayer-healthcare-social','bayer'],['source-servier-china-social','servier']])assert.equal(folders[id],folder);
assert(entry.includes('captureMokaBDom'));assert(entry.includes("'/scripts/capture-'+source+'-b-source.ts'"));

const transport=fixture({unknown:true});transport.job.pollProducer=async()=>{if(transport.calls.includes('dispatch'))throw Error('exec-server transport disconnected');return {exitCode:null};};
let startsAfterTransport=0;const transportResult=await runOriginalSerial(['uncertain','next'],async()=>{startsAfterTransport++;return transport.job;});
assert.equal(startsAfterTransport,1);assert.equal(transportResult[0].reason,'UNKNOWN_PUBLICATION');assert.equal(transportResult[0].requestId,'2');assert.match(transportResult[0].diagnostic,/transport disconnected/);assert.equal(transport.calls.filter(x=>x==='dispatch').length,1);
console.log('PASS: post-dispatch transport failure remains UNKNOWN and prevents another source launch');

const noContext=fixture();const originalNext=noContext.job.stage.h.next;
noContext.job.stage.h.next=async()=>{let request=await originalNext();if(request?.kind==='READ_PUBLICATION_CONTEXT')request=await originalNext();return request;};
assert.equal((await serviceOriginalRelay(noContext.job)).status,'HELD');assert(!noContext.calls.includes('dispatch'));assert(noContext.calls.includes('reject:NOT_DISPATCHED'));
const failedContext=fixture(), originalHandle=failedContext.job.stage.handle;
failedContext.job.stage.handle=async request=>{const prepared=await originalHandle(request);return request.kind==='READ_PUBLICATION_CONTEXT'?{status:'FAILED'}:prepared;};
assert.equal((await serviceOriginalRelay(failedContext.job)).status,'HELD');assert(!failedContext.calls.includes('dispatch'));assert(failedContext.calls.includes('reject:NOT_DISPATCHED'));
console.log('PASS: only the same job successful publication-context request is passed to review; missing/failed read cannot dispatch');

// Exercise the actual launcher catch, not an invented pre-launch error classification.
const launchStart=entry.indexOf(' let started;'),launchEnd=entry.indexOf('\n let process=started,',launchStart);assert(launchStart>=0&&launchEnd>launchStart);
const launch=new AsyncFunction('tools','q','sourceId','R','N','V','run','digest','config','S','relay','roundId','save',entry.slice(launchStart,launchEnd)+';return started;');
for(const roundId of [undefined,'round-'+ 'a'.repeat(32)]){
 let command;
 await launch({exec_command:async args=>{command=args.cmd;return {session_id:1};}},s=>s,'source-test','/r','/node','/v','/run','digest',{route:'PORTABLE'},'/host','/relay',roundId,async()=>{});
 assert.equal(command.includes('JOBFINDER_CONNECTOR_ROUND_ID='),roundId!==undefined);
 if(roundId)assert(command.includes('JOBFINDER_CONNECTOR_ROUND_ID='+roundId+' '));
}
for(const phase of ['launch-response-lost','prepublish-session-lost']){
 let secondPrepareCount=0;
 const lost=fixture();lost.job.pollProducer=async()=>{throw Error('original producer session unavailable');};
 const result=await runOriginalSerial(['first','second'],async source=>{
  if(source==='second'){secondPrepareCount++;return {skip:'unexpected second source'};}
  if(phase==='launch-response-lost')return await launch({exec_command:async()=>{throw Error('exec transport disconnected during launcher response');}},s=>s,'source-test','/r','/node','/v','/run','digest',{route:'PORTABLE'},'/host','/relay');
  return lost.job;
 });
 assert.equal(secondPrepareCount,0);assert.equal(result.length,1);assert.equal(result[0].status,'HELD');assert.equal(result[0].producerStateUnconfirmed,true);
 assert.match(result[0].reason,/transport disconnected|session unavailable/);assert.notEqual(result[0].reason,'UNKNOWN_PUBLICATION');assert(!lost.calls.includes('dispatch'));
}
let secondPrepareCount=0;
const prelaunch=await runOriginalSerial(['first','second'],async source=>{if(source==='first')throw Error('SOURCE_SCOPE_REJECTED_BEFORE_LAUNCH');secondPrepareCount++;return {skip:'known safe next source'};});
assert.equal(secondPrepareCount,1);assert.equal(prelaunch[0].producerStateUnconfirmed,undefined);assert.equal(prelaunch[0].reason,'Error: SOURCE_SCOPE_REJECTED_BEFORE_LAUNCH');
// A live owned handle at the source deadline cannot allow the next source to start.
let mockNow=0;secondPrepareCount=0;
const timed=await new AsyncFunction('Date',readFileSync(new URL('./automatic-relay-functions.js',import.meta.url),'utf8'))({now:()=>mockNow,parse:Date.parse});
const pending=fixture();pending.job.deadline=100;pending.job.pollProducer=async()=>{mockNow=101;return {exitCode:null};};
const deadlineResult=await timed.runOriginalSerial(['first','second'],async source=>{if(source==='second'){secondPrepareCount++;return {skip:'unexpected second source'};}return pending.job;});
assert.equal(secondPrepareCount,0);assert.equal(deadlineResult[0].reason,'SOURCE_DEADLINE');assert(!pending.calls.includes('dispatch'));
// The same stop rule covers an expired, reviewed request that has not dispatched.
mockNow=0;secondPrepareCount=0;const expiredReview=fixture();expiredReview.job.deadline=100;
const nextRequest=expiredReview.job.stage.h.next;expiredReview.job.stage.h.next=async()=>{const request=await nextRequest();if(request)request.payload.dispatchBefore=new Date(50).toISOString();return request;};
expiredReview.job.reviewPublication=async request=>{mockNow=60;return request;};
const expiredResult=await timed.runOriginalSerial(['first','second'],async source=>{if(source==='second'){secondPrepareCount++;return {skip:'unexpected second source'};}return expiredReview.job;});
assert.equal(secondPrepareCount,0);assert.equal(expiredResult[0].reason,'PUBLICATION_EXPIRED');assert(!expiredReview.calls.includes('dispatch'));
console.log('PASS: actual launch/session uncertainty and unterminated deadlines stop; known prelaunch refusal continues; reasons do not invent a DB dispatch');
