import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expected,fakePort} from './synthetic.mjs';
const bundle=readFileSync(new URL('../functions-bundle.js',import.meta.url),'utf8');
function runtime(){
 const timers=[];const api=runInNewContext(bundle,{Date,setTimeout(fn,ms){const timer={fn,ms,cleared:false};timers.push(timer);return timer;},clearTimeout(timer){if(timer)timer.cleared=true;}});
 return {api,timers};
}
test('deadline retains the exact pending promise; late valid observation never continues',async()=>{
 const {api,timers}=runtime(),e=expected();let resolve,request,calls=0,invalidations=0;
 const original=new Promise(r=>{resolve=r;});
 const port={enabled:true,kind:'SYNTHETIC',targetKey:'viatris',execute(r){calls++;request=r;return original;},invalidateForTimeout(){invalidations++;}};
 const controller=api.createPublicVerifier({expected:e,port}),running=controller.run();await Promise.resolve();
 assert.equal(calls,1);assert.equal(timers.length,1);assert.equal(timers[0].ms,15000);timers[0].fn();
 const result=await running;assert.equal(result.status,'HOLD');assert.equal(result.reason,'BROWSER_PROTOCOL_TIMEOUT');assert.equal(result.pendingActionOutcome,'UNKNOWN');
 assert.equal(controller.pendingOperation,original);assert(invalidations>0);
 resolve(await fakePort(e).execute(request));await original;await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1);assert.equal(controller.events.at(-1).outcome,'LATE_OBSERVATION_NO_CONTINUATION');assert.equal(controller.lateError,null);
});
test('late original error is retained without retries or continuation',async()=>{
 const {api,timers}=runtime(),e=expected();let reject,calls=0;const original=new Promise((_,r)=>{reject=r;});
 const controller=api.createPublicVerifier({expected:e,port:{enabled:true,kind:'SYNTHETIC',targetKey:'viatris',execute(){calls++;return original;},invalidateForTimeout(){}}});
 const running=controller.run();await Promise.resolve();timers[0].fn();assert.equal((await running).reason,'BROWSER_PROTOCOL_TIMEOUT');
 const error=new Error('synthetic late original failure');reject(error);await original.catch(()=>{});await Promise.resolve();await Promise.resolve();
 assert.equal(controller.lateError,error);assert.equal(controller.events.at(-1).outcome,'LATE_ERROR_NO_CONTINUATION');assert.equal(calls,1);
});
test('real CUA original tool promise survives timeout and cannot be replaced by retry',async()=>{
 const {api,timers}=runtime(),e=expected();let settle,calls=0;const original=new Promise(r=>{settle=r;});
 const port=api.createCuaBrowserPort({enabled:true,expected:e,toolCall(){calls++;return original;}}),controller=api.createPublicVerifier({expected:e,port});
 const running=controller.run();await Promise.resolve();assert.equal(calls,1);assert.equal(port.originalToolOperation,original);assert.equal(port.toolOperationPending,true);
 timers[0].fn();const result=await running;assert.equal(result.reason,'BROWSER_PROTOCOL_TIMEOUT');assert.equal(port.toolOperationPending,true);
 settle({isError:false,content:[{type:'text',text:'synthetic late native startup cannot continue'}]});await original;await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(port.toolOperationPending,false);assert.equal(calls,1);
 await assert.rejects(port.execute({}),/CUA_PORT_HALTED_OR_BUSY/);assert.equal(calls,1);
});
test('synthetic functions runtime needs no Node, URL, fetch, process or filesystem globals',async()=>{
 const {api}=runtime();assert.equal(api.createCuaBrowserPort().enabled,false);
 const result=await api.createPublicVerifier({expected:expected()}).run();assert.equal(result.reason,'BROWSER_PORT_UNBOUND');
 for(const module of ['contract.mjs','compare.mjs','machine.mjs','actual-ax.mjs','cua-port.mjs']){
  const source=readFileSync(new URL('../'+module,import.meta.url),'utf8');
  assert(!/from\s*['"]node:|import\s*\(|\brequire\s*\(|\bfetch\s*\(|\bprocess\.|\bBuffer\./.test(source),module);
 }
});
