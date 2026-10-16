/** Explicit synthetic factory unit tests; actual source composition is separate. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
const body=fs.readFileSync(new URL('../coordinator.template.js',import.meta.url),'utf8'),hash=x=>createHash('sha256').update(x).digest('hex');
const pause=()=>new Promise(r=>setTimeout(r,1));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({delayA=null,delayB=null,delayH=null,delayRecord=null,delayRecordB=null,delayRecordH=null,holdA=false,holdB=false,holdH=false,holdU=false,forged=false}={}){
 const events=[],cycleKeys=[],results=new WeakMap(),activation={enabled:true,mode:'LIVE',deploymentSha256:'r'.repeat(64)},release={profiles:{}};
 for(const name of ['takeda','biogen','hengrui','ucb'])release.profiles[name]={sourceId:'source-'+name,candidate:{id:'same'},build:{contentSha256:'a'.repeat(64)}};
 let context=0;
 const factory=name=>cycle=>{events.push(name+':create');cycleKeys.push(cycle);return {async run(){events.push(name+':start:context='+context);if(name==='takeda'&&delayA)await delayA.promise;if(name==='biogen'&&delayB)await delayB.promise;if(name==='hengrui'&&delayH)await delayH.promise;const held=(holdA&&name==='takeda')||(holdB&&name==='biogen')||(holdH&&name==='hengrui')||(holdU&&name==='ucb');const result={status:held?'HOLD':'LIVE_ROUND_VERIFIED'};if(!held)results.set(result,cycle);if(name==='takeda')context++;events.push(name+':settled');return result;},consume(result,cycle){assert.equal(results.get(result),cycle);results.delete(result);if(forged)throw Error('FORGED');return {kind:'VERIFIED',sourceId:release.profiles[name].sourceId,releaseSha256:hash(JSON.stringify(release.profiles[name])),seed:{candidateId:'same',buildSha256:'a'.repeat(64)}};}};};
 const scope={assertOriginal(){events.push('holder:assert');},async sourceStarted(n){events.push(n+':journal-start');},async sourceSettled(n){events.push(n+':journal-settle-start');if(n==='takeda'&&delayRecord)await delayRecord.promise;if(n==='biogen'&&delayRecordB)await delayRecordB.promise;if(n==='hengrui'&&delayRecordH)await delayRecordH.promise;events.push(n+':journal-settle-end');},closeCycle(r){events.push('cycle:closed');results.set(r,'CLOSED');}};
 const api=new Function('ACTIVATION','SEQUENCE_RELEASE','responseDigest','create_takeda','create_biogen','create_hengrui','create_ucb','lifecycleScope',body)(activation,release,x=>({sha256:hash(x)}),factory('takeda'),factory('biogen'),factory('hengrui'),factory('ucb'),scope);
 return {api,events,results,cycleKeys};
}
test('await original source and durable settle before even constructing B; new context and one cycle',async()=>{
 const a=deferred(),record=deferred(),f=fixture({delayA:a,delayRecord:record}),running=f.api.runLiveRound();await pause();assert.ok(!f.events.some(x=>x.startsWith('biogen')));await assert.rejects(f.api.runLiveRound(),/SEQUENCE_CYCLE_IN_FLIGHT/);a.resolve();await pause();assert.ok(!f.events.some(x=>x.startsWith('biogen')));record.resolve();const r=await running;assert.equal(r.status,'SEQUENCE_SAFELY_CLOSED');assert.equal(f.results.get(r),'CLOSED');assert.equal(f.cycleKeys[0],f.cycleKeys[1]);assert.ok(f.events.includes('biogen:start:context=1'));
});
test('HOLD and caller-forged status do not authorize B',async()=>{
 for(const options of [{holdA:true},{forged:true}]){const f=fixture(options);const r=await f.api.runLiveRound();assert.equal(r.status,'GLOBAL_HOLD');assert.ok(!f.events.some(x=>x.startsWith('biogen')));assert.ok(!f.events.includes('cycle:closed'));}
});

test('B original Promise and durable source ACK both gate H construction',async()=>{
 const b=deferred(),record=deferred(),f=fixture({delayB:b,delayRecordB:record}),running=f.api.runLiveRound();await pause();assert.ok(f.events.includes('biogen:create'));assert.ok(!f.events.some(x=>x.startsWith('hengrui')));b.resolve();await pause();assert.ok(!f.events.some(x=>x.startsWith('hengrui')));record.resolve();const r=await running;assert.equal(r.status,'SEQUENCE_SAFELY_CLOSED');assert.equal(r.results.length,4);assert.equal(f.cycleKeys[0],f.cycleKeys[2]);
});
test('B HOLD forbids H; H HOLD forbids cycle completion',async()=>{
 for(const options of [{holdB:true},{holdH:true}]){const f=fixture(options),r=await f.api.runLiveRound();assert.equal(r.status,'GLOBAL_HOLD');if(options.holdB)assert.ok(!f.events.some(x=>x.startsWith('hengrui')));assert.ok(!f.events.includes('cycle:closed'));}
});

test('H original Promise and durable settle both gate UCB construction',async()=>{
 const h=deferred(),record=deferred(),f=fixture({delayH:h,delayRecordH:record}),running=f.api.runLiveRound();await pause();assert.ok(f.events.includes('hengrui:create'));assert.ok(!f.events.some(x=>x.startsWith('ucb')));h.resolve();await pause();assert.ok(!f.events.some(x=>x.startsWith('ucb')));record.resolve();const r=await running;assert.equal(r.status,'SEQUENCE_SAFELY_CLOSED');assert.equal(r.results.length,4);assert.equal(f.cycleKeys[0],f.cycleKeys[3]);
});
test('H HOLD forbids UCB; UCB HOLD forbids cycle completion',async()=>{
 for(const options of [{holdH:true},{holdU:true}]){const f=fixture(options),r=await f.api.runLiveRound();assert.equal(r.status,'GLOBAL_HOLD');if(options.holdH)assert.ok(!f.events.some(x=>x.startsWith('ucb')));assert.ok(!f.events.includes('cycle:closed'));}
});
