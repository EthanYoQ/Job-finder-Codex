/** Explicit synthetic factory unit tests; actual source composition is separate. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
const body=fs.readFileSync(new URL('../coordinator.template.js',import.meta.url),'utf8'),hash=x=>createHash('sha256').update(x).digest('hex');
const pause=()=>new Promise(r=>setTimeout(r,1));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({delayA=null,delayRecord=null,holdA=false,forged=false}={}){
 const events=[],cycleKeys=[],results=new WeakMap(),activation={enabled:true,mode:'LIVE',deploymentSha256:'r'.repeat(64)},release={profiles:{}};
 for(const name of ['takeda','biogen'])release.profiles[name]={sourceId:'source-'+name,candidate:{id:'same'},build:{contentSha256:'a'.repeat(64)}};
 let context=0;
 const factory=name=>cycle=>{events.push(name+':create');cycleKeys.push(cycle);return {async run(){events.push(name+':start:context='+context);if(name==='takeda'&&delayA)await delayA.promise;const result={status:holdA&&name==='takeda'?'HOLD':'LIVE_ROUND_VERIFIED'};if(!holdA||name!=='takeda')results.set(result,cycle);if(name==='takeda')context++;events.push(name+':settled');return result;},consume(result,cycle){assert.equal(results.get(result),cycle);results.delete(result);if(forged)throw Error('FORGED');return {kind:'VERIFIED',sourceId:release.profiles[name].sourceId,releaseSha256:hash(JSON.stringify(release.profiles[name])),seed:{candidateId:'same',buildSha256:'a'.repeat(64)}};}};};
 const scope={assertOriginal(){events.push('holder:assert');},async sourceStarted(n){events.push(n+':journal-start');},async sourceSettled(n){events.push(n+':journal-settle-start');if(n==='takeda'&&delayRecord)await delayRecord.promise;events.push(n+':journal-settle-end');},closeCycle(r){events.push('cycle:closed');results.set(r,'CLOSED');}};
 const api=new Function('ACTIVATION','SEQUENCE_RELEASE','responseDigest','create_takeda','create_biogen','lifecycleScope',body)(activation,release,x=>({sha256:hash(x)}),factory('takeda'),factory('biogen'),scope);
 return {api,events,results,cycleKeys};
}
test('await original source and durable settle before even constructing B; new context and one cycle',async()=>{
 const a=deferred(),record=deferred(),f=fixture({delayA:a,delayRecord:record}),running=f.api.runLiveRound();await pause();assert.ok(!f.events.some(x=>x.startsWith('biogen')));await assert.rejects(f.api.runLiveRound(),/SEQUENCE_CYCLE_IN_FLIGHT/);a.resolve();await pause();assert.ok(!f.events.some(x=>x.startsWith('biogen')));record.resolve();const r=await running;assert.equal(r.status,'SEQUENCE_SAFELY_CLOSED');assert.equal(f.results.get(r),'CLOSED');assert.equal(f.cycleKeys[0],f.cycleKeys[1]);assert.ok(f.events.includes('biogen:start:context=1'));
});
test('HOLD and caller-forged status do not authorize B',async()=>{
 for(const options of [{holdA:true},{forged:true}]){const f=fixture(options);const r=await f.api.runLiveRound();assert.equal(r.status,'GLOBAL_HOLD');assert.ok(!f.events.some(x=>x.startsWith('biogen')));assert.ok(!f.events.includes('cycle:closed'));}
});
