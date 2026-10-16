import test from 'node:test';
import assert from 'node:assert/strict';
import {createOriginalExecObserver} from '../src/original-exec.mjs';
const expected={originalSessionId:76543,originalLaunchSha256:'a'.repeat(64),bindingSha256:'b'.repeat(64)};
const chain=()=>({wrapper:{exitCode:0},childChain:[{state:'TERMINATED',exitCode:0,reaped:true,launchSha256:'c'.repeat(64)}]});
const raw={exit_code:0};
const bounded=async promise=>{
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TEST_OBSERVER_STILL_PENDING')),500);})]);}
 finally{clearTimeout(timer);}
};
for(const stage of ['onPoll','validateNativeChain']){
 test(`${stage} cannot issue a token at the original cutoff`,async()=>{
  let now=1000;const stopAt=1100;let validations=0;
  const observer=createOriginalExecObserver({now:()=>now,pollOriginal:async()=>raw,validateNativeChain:async()=>{validations++;if(stage==='validateNativeChain')now=stopAt;return chain();}});
  await assert.rejects(observer.observe(expected,{stopAt,onPoll:async()=>{if(stage==='onPoll')now=stopAt;}}),/ORIGINAL_BUDGET_EXHAUSTED/);
  if(stage==='onPoll')assert.equal(validations,0);
 });
 test(`${stage} hanging does not hang recovery past the original deadline`,async()=>{
  let now=1000;const stopAt=1100;
  const hang=()=>{now=stopAt;return new Promise(()=>{});};
  const observer=createOriginalExecObserver({now:()=>now,pollOriginal:async()=>raw,validateNativeChain:stage==='validateNativeChain'?hang:async()=>chain()});
  await assert.rejects(bounded(observer.observe(expected,{stopAt,onPoll:stage==='onPoll'?hang:async()=>{}})),/ORIGINAL_BUDGET_EXHAUSTED/);
 });
}
test('successful terminal keeps exact observer-bound capability before cutoff',async()=>{
 const observer=createOriginalExecObserver({now:()=>1000,pollOriginal:async()=>raw,validateNativeChain:async()=>chain()});
 const token=await observer.observe(expected,{stopAt:1100});
 assert.equal(observer.accept(token,expected).raw.exit_code,0);
 assert.throws(()=>observer.accept({},expected),/REAL_POLL_TOKEN/);
});
test('late native validation completion cannot resurrect a timed-out observation',async()=>{
 let now=1000,finish;const stopAt=1100;
 const observer=createOriginalExecObserver({now:()=>now,pollOriginal:async()=>raw,validateNativeChain:()=>{now=stopAt;return new Promise(resolve=>{finish=resolve;});}});
 await assert.rejects(bounded(observer.observe(expected,{stopAt})),/ORIGINAL_BUDGET_EXHAUSTED/);
 finish(chain());await new Promise(resolve=>setImmediate(resolve));
 assert.throws(()=>observer.accept({},expected),/REAL_POLL_TOKEN/);
});

test('controller failure recovery settles to HOLD when native validation hangs',async()=>{
 const {fixture}=await import('./fixtures.mjs');
 const {AutomaticController}=await import('../src/controller.mjs');
 const f=fixture();
 const observer=createOriginalExecObserver({now:()=>f.now,pollOriginal:async()=>raw,validateNativeChain:()=>{f.advance(1800000);return new Promise(()=>{});}});
 f.ports.captureAndPrepareNative=async({onOriginalExec})=>{onOriginalExec(f.originalIdentity);throw Error('CAPTURE_FAILED');};
 const controller=new AutomaticController({registry:f.registry,journal:f.journal,ports:f.ports,observer,now:()=>f.now});
 const result=await bounded(controller.run('synthetic'));
 assert.equal(result.status,'HELD_EXCEPTION');assert.equal(result.releaseEligible,false);assert.equal(result.retryAuthorized,false);
 assert.equal(f.dispatches,0);assert.equal(f.reads,0);
 assert.equal(f.journal.get(result.batchId,'60-original-terminal'),undefined);
 assert.equal(f.journal.get(result.batchId,'90-closure'),undefined);
 assert.match(f.journal.get(result.batchId,'61-original-unresolved').error,/ORIGINAL_BUDGET_EXHAUSTED/);
 await assert.rejects(controller.run('synthetic'),/SOURCE_HELD/);
});
