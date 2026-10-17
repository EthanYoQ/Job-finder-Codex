import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const {runOriginalSerial, serviceOriginalRelay} = await new AsyncFunction(readFileSync(new URL('./automatic-relay-functions.js', import.meta.url), 'utf8'))();
function fixture({unknown=false, expired=false, reviewFails=false}={}) {
 const calls=[], sourceId='source-ucb-china-social', deadline=Date.now()+60000;
 const queue=['READ_CONTEXT','PUBLISH','READ_OUTCOME'].map((kind,i)=>({kind, requestId:String(i), requestSha256:'bound-'+i, expired:i===1&&expired, expiresAt:new Date(deadline).toISOString(), payload:{sql:'original',dispatchBefore:new Date(deadline-1000).toISOString()}}));
 const h={cfg:{project:'yiopvxysxrtrnvqxwgbx',sourceId}, next:async()=>queue.shift(), sqlDispatch:async r=>{calls.push('dispatch'); return unknown?{status:'FAILED',outcome:'UNKNOWN'}:{status:'SUCCEEDED'};}};
 const stage={h,handle:async r=>{calls.push(r.kind);return {status:r.kind==='PUBLISH'?'AWAITING_PARENT_REVIEW':'SUCCEEDED'};}};
 return {calls,job:{sourceId,deadline,stage,relayDirectory:'/original/relay',reviewPublication:async r=>{calls.push('review');if(reviewFails)throw Error('raw mismatch');return r;},pollProducer:async()=>({exitCode:queue.length?null:0}),readback:async()=>{calls.push('readback');return {status:'WEB_VERIFIED'};}}};
}
const ok=fixture();assert.equal((await serviceOriginalRelay(ok.job)).status,'WEB_VERIFIED');
assert.deepEqual(ok.calls,['READ_CONTEXT','PUBLISH','review','dispatch','READ_OUTCOME','readback']);
const unknown=fixture({unknown:true});assert.equal((await serviceOriginalRelay(unknown.job)).reason,'UNKNOWN_PUBLICATION');assert.equal(unknown.calls.filter(x=>x==='dispatch').length,1);assert(!unknown.calls.includes('readback'));
const stale=fixture({expired:true});assert.equal((await serviceOriginalRelay(stale.job)).reason,'EXPIRED_OR_UNKNOWN_DISPATCH');assert(!stale.calls.includes('dispatch'));
const bad=fixture({reviewFails:true}), next=fixture();const result=await runOriginalSerial(['bad','recent','next'],async id=>id==='bad'?bad.job:id==='recent'?{skip:'REAL_OBSERVATION_WITHIN_12H'}:next.job);
assert.deepEqual(result.map(r=>r.status),['HELD','SKIPPED','WEB_VERIFIED']);assert(!bad.calls.includes('dispatch'));
console.log('PASS: serial relay, single dispatch, unknown/expiry hold, failed source isolation, dedup skip');
