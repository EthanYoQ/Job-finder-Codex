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
const unknown=fixture({unknown:true});assert.equal((await serviceOriginalRelay(unknown.job)).reason,'UNKNOWN_PUBLICATION');assert.equal(unknown.calls.filter(x=>x==='dispatch').length,1);assert(!unknown.calls.includes('readback'));
const stale=fixture({expired:true});assert.equal((await serviceOriginalRelay(stale.job)).reason,'EXPIRED_OR_UNKNOWN_DISPATCH');assert(!stale.calls.includes('dispatch'));
const bad=fixture({reviewFails:true}), next=fixture();const result=await runOriginalSerial(['bad','recent','next'],async id=>id==='bad'?bad.job:id==='recent'?{skip:'REAL_OBSERVATION_WITHIN_12H'}:next.job);
assert.deepEqual(result.map(r=>r.status),['HELD','SKIPPED','WEB_VERIFIED']);assert(!bad.calls.includes('dispatch'));assert(bad.calls.includes('reject:NOT_DISPATCHED'));assert(bad.calls.includes('READ_OUTCOME'));assert.match(result[0].diagnostic,/raw mismatch/);
console.log('PASS: serial relay, single dispatch, unknown/expiry hold, failed source isolation, dedup skip');
const entry=readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const folders=JSON.parse(entry.match(/const sourceFolders=(\{[^\n]+\});/)[1].replaceAll("'",'"'));
const routes=JSON.parse(readFileSync(new URL('./sources.json',import.meta.url),'utf8')).rows;
assert.equal(routes.length,36);assert.equal(Object.keys(folders).length,30);assert.equal(Object.keys(folders).filter(id=>routes.find(r=>r.sourceId===id)?.route==='PORTABLE').length,19);assert.equal(Object.keys(folders).filter(id=>routes.find(r=>r.sourceId===id)?.route==='TRUE_A').length,11);for(const id of ['source-astrazeneca-social','source-johnson-innovative-medicine-social','source-pfizer-china-social'])assert(!folders[id]);
console.log('PASS: 36 original routes, 19 portable and 11 original A configurations; browser/detail gaps excluded');

assert(entry.includes("mode:config.mode"));assert(entry.includes("config.route==='PORTABLE'?'p0-cloud-portable-source-pilot.ts':'p0-cloud-source-pilot.ts'"));
const prepare=readFileSync(new URL('./prepare-original-source.py',import.meta.url),'utf8');assert(prepare.includes("kind=mode,route=row['route']"));assert(prepare.includes("'mode':mode,'route':row['route']"));
