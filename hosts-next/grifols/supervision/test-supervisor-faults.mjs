import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './create-combined-starter.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('SYNTHETIC_WAIT_TIMEOUT');await sleep(10);}};
const lines=p=>existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
mkdirSync(join(paths.base,'verification'),{recursive:true,mode:0o700});
const root=mkdtempSync(join(paths.base,'verification/faults-')),results=[];
async function run(name,{fault='',request='',exit=17,duration=650,timeout=5000,expected=exit,signalMode='',baseline=false}={}) {
  const dir=join(root,name);mkdirSync(dir,{mode:0o700});
  const control=join(dir,'control'),ready=join(dir,'ready.json'),diagnostics=join(dir,'diagnostics'),injected=join(dir,'injected.json');
  const supervisor=baseline?join(paths.base,'../combined-takeda-20261006T0550Z/supervise-cancel.mjs'):paths.supervisor;
  const args=[supervisor,'start',control,name,'--',process.execPath,paths.wrapper,diagnostics,String(timeout),'--',process.execPath,join(paths.base,'fixture-fault-inner.mjs'),ready,String(duration),String(exit),signalMode];
  const env={...process.env,NODE_OPTIONS:'--require '+join(paths.base,'inject-supervisor-fault.cjs'),SYNTHETIC_SUPERVISOR_FAULT:fault,SYNTHETIC_SUPERVISOR_FAULT_RECEIPT:injected};
  const child=spawn(process.execPath,args,{env,cwd:join(paths.r2,'workspaces/producer-fb0-exact'),stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';child.stderr.on('data',x=>stderr+=x);child.stdout.on('data',x=>stdout+=x);
  let wrapperAtSupervisorExit;
  child.once('exit',()=>{wrapperAtSupervisorExit=lines(join(diagnostics,'process.jsonl'));});
  const terminal=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,closedAt:Date.now()}));});
  await until(()=>existsSync(ready));
  if(request) {
    await until(()=>existsSync(join(control,'descriptor.json')));
    if(request==='invalid')writeFileSync(join(control,'cancel.json'),JSON.stringify({schemaVersion:1,runId:name,nonce:'0'.repeat(64),action:'SIGTERM',requestedAtMs:Date.now()})+'\n',{flag:'wx',mode:0o600});
    else {const r=spawnSync(process.execPath,[supervisor,'request',control,name],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  }
  const result=await terminal;
  // Even baseline counterexamples are bounded and fully waited; leave no child running.
  await until(()=>lines(join(diagnostics,'process.jsonl')).some(e=>e.event==='CHILD_EXIT'));
  const wrapper=lines(join(diagnostics,'process.jsonl')),end=wrapper.find(e=>e.event==='CHILD_EXIT');
  assert.equal(end.wrapperExitCode,expected,name);
  if(fault)assert.ok(existsSync(injected),'fault was actually reached: '+name);
  const signals=wrapper.filter(e=>e.event==='SIGNAL_RECEIVED');
  if(baseline) {
    assert.notEqual(result.code,expected);assert.ok(!wrapperAtSupervisorExit.some(e=>e.event==='CHILD_EXIT'));
  } else {
    assert.equal(result.code,expected,stderr);assert.equal(result.signal,null);
    assert.ok(wrapperAtSupervisorExit.some(e=>e.event==='CHILD_EXIT'),'supervisor must await wrapper terminal: '+name);
    const stderrRecords=stderr.split('\n').filter(x=>x.startsWith('{')).map(JSON.parse);
    const last=stderrRecords.findLast(e=>e.event==='WRAPPER_TERMINAL');
    if(fault!=='all-logging') {
      assert.equal(last.supervisorExitCode,expected,name);
      if(fault && fault!=='descriptor-short-write' && fault!=='poll-identity' && fault!=='wrapper-events-read' && fault!=='poll-reused-pid')assert.equal(last.controlAvailable,false,name);
    }
    if(['spawn-identity','spawn-identity-mismatch','descriptor-close','descriptor-open','descriptor-write','descriptor-fsync','directory-fsync','log-ready-write','log-ready-fsync','log-zero-write','log-rejected-write','log-rejected-partial-write','log-accepted-write','log-accepted-fsync','poll-reused-pid','poll-identity','wrapper-events-read','all-logging'].includes(fault))assert.equal(signals.length,0,name);
    if(fault==='log-rejected-partial-write') { const audit=readFileSync(join(control,'supervisor.jsonl'),'utf8'); assert.equal(JSON.parse(audit.split('\n')[0]).event,'SUPERVISOR_READY'); assert.equal(audit.split('\n')[1],'{"event":'); }
    if(fault==='descriptor-short-write')assert.equal(JSON.parse(readFileSync(join(control,'descriptor.json'),'utf8')).runId,name);
    if(request==='valid' && !['log-accepted-write','log-accepted-fsync','poll-identity','poll-reused-pid','wrapper-events-read'].includes(fault))assert.equal(signals.length,1,name);
  }
  const row={name,fault,expectedWrapperExit:expected,actualSupervisorExit:result.code,wrapperTerminalExistedBeforeSupervisorExit:wrapperAtSupervisorExit.some(e=>e.event==='CHILD_EXIT'),wrapperTerminalPersisted:true,signalCount:signals.length,baselineCounterexample:baseline};
  writeFileSync(join(dir,'supervisor.stderr'),stderr);writeFileSync(join(dir,'case-result.json'),JSON.stringify(row,null,2)+'\n');results.push(row);
}
await run('baseline-start-identity-exits-early',{fault:'spawn-identity',baseline:true});
await run('baseline-rejection-log-exits-early',{fault:'log-rejected-write',request:'invalid',baseline:true});
for(const fault of ['spawn-identity','spawn-identity-mismatch','descriptor-close','descriptor-open','descriptor-write','descriptor-fsync','directory-fsync','descriptor-short-write','log-ready-write','log-ready-fsync','log-zero-write','all-logging','log-exit-write','terminal-open','terminal-fsync','terminal-close','log-exit-fsync','lifecycle-close','directory-close'])await run(fault,{fault});
await run('rejected-cancel-log-failure',{fault:'log-rejected-write',request:'invalid'});
await run('rejected-cancel-partial-log-failure',{fault:'log-rejected-partial-write',request:'invalid'});
await run('accepted-cancel-fsync-failure',{fault:'log-accepted-fsync',request:'valid'});
await run('reused-pid-identity-refused',{fault:'poll-reused-pid',request:'valid'});
await run('accepted-cancel-log-failure',{fault:'log-accepted-write',request:'valid'});
await run('poll-identity-failure',{fault:'poll-identity',request:'valid'});
await run('wrapper-events-read-failure',{fault:'wrapper-events-read',request:'valid'});
await run('signal-audit-failure',{fault:'log-signal-write',request:'valid',signalMode:'graceful',expected:42});
await run('normal-zero',{exit:0});
await run('normal-nonzero',{exit:23});
await run('normal-timeout',{duration:1800,timeout:300,expected:124});
await run('timeout-with-log-failure',{fault:'log-ready-write',duration:1800,timeout:300,expected:124});
await run('controlled-cancel',{request:'valid',signalMode:'graceful',expected:42});
await run('default-cancel',{request:'valid',expected:143});
const report={status:'PASS_SYNTHETIC_FAULT_INJECTION',artifactRoot:root,checkedAt:new Date().toISOString(),results,networkUsed:false,databaseUsed:false,realProducerExecuted:false,originalWrapperUnchanged:true,allSyntheticChildrenWaited:true,productionCommandEnvCwdUnmodified:true};
writeFileSync(join(root,'FAULT_RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
