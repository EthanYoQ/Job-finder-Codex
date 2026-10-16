/** Explicit five-source synthetic factory unit tests; actual source composition is separate. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
const body=fs.readFileSync(new URL('../coordinator.template.js',import.meta.url),'utf8'),hash=x=>createHash('sha256').update(x).digest('hex');
const ORDER=['takeda','biogen','hengrui','ucb','viatris'];
const pause=()=>new Promise(r=>setTimeout(r,1));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture({delay={},delayRecord={},hold=null,forged=false}={}){
 const events=[],cycleKeys=[],results=new WeakMap(),activation={enabled:true,mode:'LIVE',deploymentSha256:'r'.repeat(64)},release={profiles:{}};
 for(const name of ORDER)release.profiles[name]={sourceId:'source-'+name,candidate:{id:'same'},build:{contentSha256:'a'.repeat(64)}};
 let context=0;
 const factory=name=>cycle=>{events.push(name+':create');cycleKeys.push(cycle);return {async run(){events.push(name+':start:context='+context);if(delay[name])await delay[name].promise;const held=hold===name;const result={status:held?'HOLD':'LIVE_ROUND_VERIFIED'};if(!held)results.set(result,cycle);context++;events.push(name+':settled');return result;},consume(result,cycle){assert.equal(results.get(result),cycle);results.delete(result);if(forged)throw Error('FORGED');return {kind:'VERIFIED',sourceId:release.profiles[name].sourceId,releaseSha256:hash(JSON.stringify(release.profiles[name])),seed:{candidateId:'same',buildSha256:'a'.repeat(64)}};}};};
 const scope={assertOriginal(){events.push('holder:assert');},async sourceStarted(n){events.push(n+':journal-start');},async sourceSettled(n){events.push(n+':journal-settle-start');if(delayRecord[n])await delayRecord[n].promise;events.push(n+':journal-settle-end');},closeCycle(r){events.push('cycle:closed');results.set(r,'CLOSED');}};
 const api=new Function('ACTIVATION','SEQUENCE_RELEASE','responseDigest',...ORDER.map(n=>'create_'+n),'lifecycleScope',body)(activation,release,x=>({sha256:hash(x)}),...ORDER.map(factory),scope);
 return {api,events,results,cycleKeys};
}
for(let index=0;index<ORDER.length;index++){
 const name=ORDER[index],next=ORDER[index+1];
 test(name+' original Promise and durable settle gate '+(next?'construction of '+next:'cycle closure'),async()=>{
  const original=deferred(),record=deferred(),f=fixture({delay:{[name]:original},delayRecord:{[name]:record}}),running=f.api.runLiveRound();
  await pause();assert.ok(f.events.includes(name+':create'));assert.ok(!f.events.includes('cycle:closed'));if(next)assert.ok(!f.events.some(x=>x.startsWith(next)));
  await assert.rejects(f.api.runLiveRound(),/SEQUENCE_CYCLE_IN_FLIGHT/);
  original.resolve();await pause();assert.ok(!f.events.includes('cycle:closed'));if(next)assert.ok(!f.events.some(x=>x.startsWith(next)));
  record.resolve();const r=await running;assert.equal(r.status,'SEQUENCE_SAFELY_CLOSED');assert.equal(r.results.length,5);assert.equal(f.results.get(r),'CLOSED');
  assert.equal(new Set(f.cycleKeys).size,1);assert.ok(Object.isFrozen(f.cycleKeys[0]));
  if(next)assert.ok(f.events.indexOf(name+':journal-settle-end')<f.events.indexOf(next+':create'));
 });
 test(name+' HOLD never grants next source or cycle closure',async()=>{
  const f=fixture({hold:name}),r=await f.api.runLiveRound();assert.equal(r.status,'GLOBAL_HOLD');assert.equal(r.results.length,index+1);
  if(next)assert.ok(!f.events.some(x=>x.startsWith(next)));assert.ok(!f.events.includes('cycle:closed'));
 });
}
test('caller-forged status cannot grant source close authority',async()=>{const f=fixture({forged:true}),r=await f.api.runLiveRound();assert.equal(r.status,'GLOBAL_HOLD');assert.ok(!f.events.some(x=>x.startsWith('biogen')));assert.ok(!f.events.includes('cycle:closed'));});
test('all five compile-fixed factories run once in order with fresh predecessor context',async()=>{
 const f=fixture(),r=await f.api.runLiveRound();assert.equal(r.results.length,5);assert.deepEqual(f.events.filter(x=>x.endsWith(':create')),ORDER.map(n=>n+':create'));
 ORDER.forEach((n,i)=>assert.ok(f.events.includes(n+':start:context='+i)));
});
