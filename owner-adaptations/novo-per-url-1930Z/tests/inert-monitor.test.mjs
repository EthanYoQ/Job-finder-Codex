import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import vm from 'node:vm';
const root=resolve(dirname(new URL(import.meta.url).pathname),'../../..');
const code=await readFile(root+'/hosts/novo/host/runtime/continuous-relay-v3-durable-monitor.js','utf8');
const seam='const A=Object.getPrototypeOf(async function(){}).constructor;\nconst s=await new A(load("proxyNode22:novo:cloudPilotHostStages"))();';
const ns='proxyNode22:novo:',session=8675309;
async function localFixture(t,{exit=7,budgetMs=5000,failSave=false}={}){
 const run=await mkdtemp(join(tmpdir(),'novo-inert-monitor-'));t.after(()=>rm(run,{recursive:true,force:true}));
 // Run the verified production wrapper source around a strictly inert child.
 // Both processes only write their private diagnostics/stdout, then exit.
 const wrapper=join(dirname(new URL(import.meta.url).pathname),'fixtures/run-with-http-diagnostics.mjs');
 const program="process.stdout.write('inert local output\\n');process.exitCode=Number(process.argv[1]);";
 const child=spawn(process.execPath,[wrapper,join(run,'diagnostics'),String(budgetMs),'--',process.execPath,'-e',program,String(exit)],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH}});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const exit_code=await new Promise((res,rej)=>{child.once('error',rej);child.once('close',res);});
 assert.equal(exit_code,exit);assert.equal(await readFile(join(run,'diagnostics/stdout.log'),'utf8'),'inert local output\n');
 // Adapter uses the real inert OS terminal; platform transport behavior is
 // covered separately by synthetic tool-return tests, not claimed here.
 const raw={exit_code,output,chunk_id:'inert-os-terminal',wall_time_seconds:0};
 const state=new Map([[ns+'refreshCurrentRun',run],[ns+'refreshSession',session],[ns+'durableMonitorInvocationMode','resume']]);
 let result,polls=0,nexts=0;
 const stages={h:{q:x=>x,next:async()=>{nexts++;},readFile:async p=>({text:await readFile(p,'utf8')}),
  save:async(p,value)=>{if(failSave)await writeFile(join(run,'monitor-exec-evidence'),'blocks directory creation');await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(value)+'\n',{flag:'wx'});},
  cmd:async()=>{const rows=(await readFile(join(run,'diagnostics/process.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);return JSON.stringify({process:rows.at(-1)});}
 },handle:async()=>{throw Error('NO_RELAY_REQUEST_ALLOWED');}};
 const context=vm.createContext({Date,setTimeout,stages,load:k=>state.get(k),store:(k,v)=>state.set(k,v),notify:()=>{},text:v=>{result=JSON.parse(JSON.stringify(v));},tools:{write_stdin:async args=>{assert.equal(args.session_id,session);polls++;return raw;}}});
 return {run,state,raw,monitor:()=>vm.runInContext('(async()=>{'+code.replace(seam,'const s=stages;')+'})()',context),get result(){return result;},get polls(){return polls;},get nexts(){return nexts;}};
}
test('real inert OS exit and real disk save/readback preserve full returned adapter object',async t=>{
 const f=await localFixture(t);await f.monitor();assert.equal(f.result.status,'PROCESS_TERMINATED');assert.equal(f.result.originalExec.exitCode,7);assert.equal(f.polls,1);const saved=await readFile(f.result.evidencePath,'utf8');assert.deepEqual(JSON.parse(saved).raw,f.raw);assert.equal(saved,JSON.stringify(JSON.parse(saved))+'\n');
});
test('real disk ENOTDIR cannot cache a zero terminal as success',async t=>{
 const f=await localFixture(t,{exit:0,failSave:true});await f.monitor();assert.equal(f.polls,1);assert.equal(f.result.classification,'ORIGINAL_EXEC_EVIDENCE_UNSAVED_NO_RETRY');assert.equal(f.result.successfulCompletionEligible,false);assert.equal(f.state.get(ns+'lastPortableExecPollRaw').evidenceVerified,undefined);assert.equal(f.state.has(ns+'lastPortableExecTerminalAccepted'),false);
});
test('real wall-clock late resume observes the original boundary and never polls',async t=>{
 const f=await localFixture(t,{budgetMs:2000});const first=JSON.parse((await readFile(join(f.run,'diagnostics/process.jsonl'),'utf8')).split('\n')[0]);await new Promise(r=>setTimeout(r,Math.max(0,first.outerDeadline-Date.now()+20)));await f.monitor();assert.equal(f.result.classification,'ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED');assert.equal(f.polls,0);assert.equal(f.nexts,0);assert.equal(f.state.get(ns+'durableMonitorLease:'+f.run).stopAt,first.outerDeadline);
});
test('real disk missing durable budget fails closed',async t=>{
 const f=await localFixture(t);await rm(join(f.run,'diagnostics/process.jsonl'));await f.monitor();assert.equal(f.result.classification,'ORIGINAL_EXEC_BUDGET_UNAVAILABLE_NO_PUBLISH');assert.equal(f.polls,0);assert.equal(f.nexts,0);
});
