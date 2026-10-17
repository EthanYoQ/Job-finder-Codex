import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const {runOriginalSerial, serviceOriginalRelay} = await new AsyncFunction(readFileSync(new URL('./automatic-relay-functions.js', import.meta.url), 'utf8'))();
function fixture({unknown=false, expired=false, reviewFails=false}={}) {
 const calls=[], sourceId='source-ucb-china-social', deadline=Date.now()+60000;
 const queue=['READ_CONTEXT','PUBLISH','READ_OUTCOME'].map((kind,i)=>({kind, requestId:String(i), requestSha256:'bound-'+i, expired:i===1&&expired, expiresAt:new Date(deadline).toISOString(), payload:{sql:'original',dispatchBefore:new Date(deadline-1000).toISOString()}}));
 const h={cfg:{project:'yiopvxysxrtrnvqxwgbx',sourceId}, next:async()=>queue.shift(), respond:async(r,dir,result)=>{calls.push('reject:'+result.outcome);}, sqlDispatch:async r=>{calls.push('dispatch'); return unknown?{status:'FAILED',outcome:'UNKNOWN'}:{status:'SUCCEEDED'};}};
 const stage={h,handle:async r=>{calls.push(r.kind);return {status:r.kind==='PUBLISH'?'AWAITING_PARENT_REVIEW':'SUCCEEDED'};}};
 return {calls,job:{sourceId,deadline,stage,relayDirectory:'/original/relay',reviewPublication:async r=>{calls.push('review');if(reviewFails)throw Error('raw mismatch');return r;},pollProducer:async()=>({exitCode:queue.length?null:0}),readback:async()=>{calls.push('readback');return {status:'WEB_VERIFIED'};}}};
}
const ok=fixture();assert.equal((await serviceOriginalRelay(ok.job)).status,'WEB_VERIFIED');
assert.deepEqual(ok.calls,['READ_CONTEXT','PUBLISH','review','dispatch','READ_OUTCOME','readback']);
const unknown=fixture({unknown:true});assert.equal((await serviceOriginalRelay(unknown.job)).reason,'UNKNOWN_PUBLICATION');assert.equal(unknown.calls.filter(x=>x==='dispatch').length,1);assert(!unknown.calls.includes('readback'));assert(unknown.calls.includes('READ_OUTCOME'));
const stopped=fixture({unknown:true});stopped.job.pollProducer=async()=>({exitCode:stopped.calls.includes('dispatch')?99:null});const stoppedResult=await serviceOriginalRelay(stopped.job);assert.equal(stoppedResult.reason,'UNKNOWN_PUBLICATION');assert.equal(stoppedResult.outcomeSeen,false);assert.equal(stopped.calls.filter(x=>x==='dispatch').length,1);
const stale=fixture({expired:true});assert.equal((await serviceOriginalRelay(stale.job)).reason,'EXPIRED_OR_UNKNOWN_DISPATCH');assert(!stale.calls.includes('dispatch'));
const bad=fixture({reviewFails:true}), next=fixture();const result=await runOriginalSerial(['bad','recent','next'],async id=>id==='bad'?bad.job:id==='recent'?{skip:'REAL_OBSERVATION_WITHIN_12H'}:next.job);
assert.deepEqual(result.map(r=>r.status),['HELD','SKIPPED','WEB_VERIFIED']);assert(!bad.calls.includes('dispatch'));assert(bad.calls.includes('reject:NOT_DISPATCHED'));assert(bad.calls.includes('READ_OUTCOME'));assert.match(result[0].diagnostic,/raw mismatch/);
console.log('PASS: serial relay, single dispatch, unknown/expiry hold, failed source isolation, dedup skip');
const entry=readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const folders=JSON.parse(entry.match(/const sourceFolders=(\{[^\n]+\});/)[1].replaceAll("'",'"'));
const routes=JSON.parse(readFileSync(new URL('./sources.json',import.meta.url),'utf8')).rows;
assert.equal(routes.length,36);assert.equal(Object.keys(folders).length,36);assert.equal(Object.keys(folders).filter(id=>routes.find(r=>r.sourceId===id)?.route==='PORTABLE').length,20);assert.equal(Object.keys(folders).filter(id=>routes.find(r=>r.sourceId===id)?.route==='TRUE_A').length,13);assert.equal(folders['source-astrazeneca-social'],'astrazeneca');
assert.equal(folders['source-pfizer-china-social'],'pfizer');
console.log('PASS: 36 original routes, 20 portable, 13 original A and three original B configurations; configuration is not live acceptance');

assert(entry.includes("mode:config.mode"));assert(entry.includes("config.route==='PORTABLE'?'p0-cloud-portable-source-pilot.ts':'p0-cloud-source-pilot.ts'"));
const prepare=readFileSync(new URL('./prepare-original-source.py',import.meta.url),'utf8');assert(prepare.includes("kind=mode,route=row['route']"));assert(prepare.includes("'mode':mode,'route':row['route']"));

assert(prepare.includes("'source-csl-china-social':'dot-cloud-csl-pilot'"));assert(prepare.includes("'source-lilly-china-social':'dot-cloud-lilly-pilot'"));

const unresolved=fixture({unknown:true});let preparedCount=0;const heldSequence=await runOriginalSerial(['unknown','next'],async()=>{preparedCount++;return unresolved.job;});assert.equal(preparedCount,1);assert.equal(heldSequence[0].reason,'UNKNOWN_PUBLICATION');

assert(entry.includes("replaceAll('__ORIGINAL_CERTIFICATE_SCHEMA__'"));assert(entry.includes("replaceAll('__ORIGINAL_REQUIRES_PORTABLE_POLICY__'"));

const recovered=fixture({unknown:true});const originalPoll=recovered.job.pollProducer;recovered.job.pollProducer=async()=>({...await originalPoll(),outcomeState:'COMMITTED_EXACT'});assert.equal((await serviceOriginalRelay(recovered.job)).status,'WEB_VERIFIED');assert.equal(recovered.calls.filter(x=>x==='dispatch').length,1);assert(recovered.calls.includes('READ_OUTCOME'));

assert(entry.includes("if(sourceId==='source-organon-china-social')throw Error('ORGANON_MANUAL_KEYWORD_COUNTRY_APPLICATION_EVIDENCE_PENDING')"));

assert.equal(folders['source-johnson-innovative-medicine-social'],'jnj');
assert(entry.includes('captureJnjManagedDom'));assert(entry.includes('prepare-jnj-dom-current-capture.ts'));assert(entry.includes('...(currentCapture?{currentCapture}:{})'));

for(const [id,folder] of [['source-bayer-healthcare-social','bayer'],['source-servier-china-social','servier']])assert.equal(folders[id],folder);
assert(entry.includes('captureMokaBDom'));assert(entry.includes("'/scripts/capture-'+source+'-b-source.ts'"));

const transport=fixture({unknown:true});transport.job.pollProducer=async()=>{if(transport.calls.includes('dispatch'))throw Error('exec-server transport disconnected');return {exitCode:null};};
let startsAfterTransport=0;const transportResult=await runOriginalSerial(['uncertain','next'],async()=>{startsAfterTransport++;return transport.job;});
assert.equal(startsAfterTransport,1);assert.equal(transportResult[0].reason,'UNKNOWN_PUBLICATION');assert.equal(transportResult[0].requestId,'1');assert.match(transportResult[0].diagnostic,/transport disconnected/);assert.equal(transport.calls.filter(x=>x==='dispatch').length,1);
console.log('PASS: post-dispatch transport failure remains UNKNOWN and prevents another source launch');
