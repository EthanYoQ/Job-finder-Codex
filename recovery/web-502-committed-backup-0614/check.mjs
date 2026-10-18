import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const {runOriginalSerial, serviceOriginalRelay} = await new AsyncFunction(readFileSync(new URL('./after/automatic-relay-functions.js', import.meta.url), 'utf8'))();
function fixture({unknown=false, expired=false, reviewFails=false}={}) {
 const calls=[], sourceId='source-ucb-china-social', deadline=Date.now()+60000;
 const queue=['READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME'].map((kind,i)=>({kind, requestId:String(i), requestSha256:'bound-'+i, expired:i===2&&expired, expiresAt:new Date(deadline).toISOString(), payload:{sql:'original',dispatchBefore:new Date(deadline-1000).toISOString()}}));
 const h={cfg:{project:'yiopvxysxrtrnvqxwgbx',sourceId}, next:async()=>queue.shift(), respond:async(r,dir,result)=>{calls.push('reject:'+result.outcome);}, sqlDispatch:async r=>{calls.push('dispatch'); return unknown?{status:'FAILED',outcome:'UNKNOWN'}:{status:'SUCCEEDED'};}};
 const stage={h,handle:async r=>{calls.push(r.kind);return {status:r.kind==='PUBLISH'?'AWAITING_PARENT_REVIEW':'SUCCEEDED'};}};
 return {calls,job:{sourceId,deadline,stage,relayDirectory:'/original/relay',reviewPublication:async (r,prepared,contextRequestId)=>{calls.push('review');assert.equal(contextRequestId,'1');if(reviewFails)throw Error('raw mismatch');return r;},pollProducer:async()=>({exitCode:queue.length?null:0}),readback:async()=>{calls.push('readback');return {status:'WEB_VERIFIED'};}}};
}

const f=fixture();const poll=f.job.pollProducer;f.job.pollProducer=async()=>({...await poll(),outcomeState:'COMMITTED_EXACT'});f.job.readback=async()=>{throw Error('HTTP Error 502');};let backed=false;const r=await runOriginalSerial(['test'],async()=>f.job,async(id,result)=>{backed=result.committedExact===true;});assert(backed);assert.equal(r[0].status,'HELD');assert.equal(r[0].reason,'WEB_READBACK_FAILED');assert.equal(f.calls.filter(x=>x==='dispatch').length,1);
const u=fixture({unknown:true});let called=false;await runOriginalSerial(['test'],async()=>u.job,async()=>{called=true});assert.equal(called,false);console.log('PASS committed web failure reaches afterSource; UNKNOWN stops; one dispatch');
