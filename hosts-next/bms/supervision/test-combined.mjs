import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, unlinkSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { paths, hashes, addCombinedObservation, stripCombinedObservation } from './create-combined-starter.mjs';
import { buildCombinedCommand } from './build-combined-command.mjs';
const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
const sha=s=>createHash('sha256').update(s).digest('hex');
const label=batch=>'jb-'+sha(batch);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const until=async fn=>{const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('FIXTURE_WAIT_TIMEOUT');await sleep(25);}};
const events=file=>existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
mkdirSync(join(paths.base,'verification'),{recursive:true,mode:0o700});
const privateRoot=mkdtempSync(join(paths.base,'verification/synthetic-'));
const tests=[];
const pass=(name,detail={})=>tests.push({name,passed:true,...detail});
for(const key of ['sampler','supervisor','wrapper','original'])assert.equal(sha(readFileSync(paths[key])),hashes[key]);
const original=readFileSync(paths.original,'utf8'),combined=readFileSync(join(paths.base,'start-monitor-bms47b-combined.js'),'utf8');
assert.equal(addCombinedObservation(original),combined);assert.equal(stripCombinedObservation(combined),original);
pass('fixed-source-hashes-and-original-starter-byte-roundtrip');
assert.notEqual(label('batch.a'),label('batch_a'));assert.match(label('batch.a'),/^jb-[a-f0-9]{64}$/);
pass('full-batch-hash-labels-do-not-collide-for-dot-underscore');

async function runCase(name,mode,{rejects=false,replace=false,timeout=20000,request=false}={}) {
  const dir=join(privateRoot,name);mkdirSync(dir,{mode:0o700});
  const control=join(dir,'cancel-control'),diagnostics=join(dir,'diagnostics'),ready=join(dir,'ready.json'),outputDir=join(dir,'memory');
  const controlRunId=label(name);
  const command='env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 SYNTHETIC_PRESERVED_ENV=abc node scripts/run-with-http-diagnostics.mjs '+q(diagnostics)+' '+timeout+' -- node --max-old-space-size=256 '+q(join(paths.base,'fixture-inner.mjs'))+' '+q(mode)+' '+q(ready);
  const meta={nodePath:process.execPath,supervisorPath:paths.supervisor,wrapperPath:paths.wrapper,samplerPath:paths.sampler,controlDirectory:control,controlRunId,outputDir,label:'SYNTHETIC_ONLY/'+name+'/includes-supervisor'};
  const shell=buildCombinedCommand(command,meta,q).observedCommand;
  assert.equal(spawnSync('bash',['-n','-c',shell]).status,0);
  let stdout='',stderr='';
  const child=spawn('bash',['-c','set -e\n'+shell],{cwd:join(paths.r2,'workspaces/producer-fb0-exact'),env:process.env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const terminal=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  await until(()=>existsSync(ready)&&existsSync(join(control,'descriptor.json')));
  const descriptor=JSON.parse(readFileSync(join(control,'descriptor.json'),'utf8'));
  assert.equal(existsSync(join(control,'cancel.json')),false);
  const receipt=JSON.parse(readFileSync(ready,'utf8'));
  assert.equal(receipt.cwd,join(paths.r2,'workspaces/producer-fb0-exact'));assert.equal(receipt.syntheticEnv,'abc');
  let controlRead=control;
  const reasons=[];
  if(rejects) {
    const valid={schemaVersion:1,runId:controlRunId,nonce:descriptor.nonce,action:'SIGTERM',requestedAtMs:Date.now()};
    const cases=[['CANCEL_NONCE_MISMATCH',{...valid,nonce:'0'.repeat(64)}],['CANCEL_RUN_MISMATCH',{...valid,runId:label('other')}],['CANCEL_TIME_MISMATCH',{...valid,requestedAtMs:descriptor.startedAtMs-1}],['CANCEL_SCHEMA_MISMATCH',{...valid,pid:descriptor.wrapperPid}],['ELOOP',null]];
    for(const [reason,value] of cases) {
      if(value)writeFileSync(join(control,'cancel.json'),JSON.stringify(value),{flag:'wx',mode:0o600});else symlinkSync(ready,join(control,'cancel.json'));
      await until(()=>events(join(control,'supervisor.jsonl')).some(e=>e.event==='CANCEL_REJECTED'&&e.reason===reason));
      assert.ok(!events(join(control,'supervisor.jsonl')).some(e=>e.event==='SIGNAL_SENT'));
      unlinkSync(join(control,'cancel.json'));reasons.push(reason);
    }
  }
  if(replace) {
    controlRead=control+'-moved';renameSync(control,controlRead);mkdirSync(control,{mode:0o700});
    await until(()=>events(join(controlRead,'supervisor.jsonl')).some(e=>e.event==='CANCEL_REJECTED'&&e.reason==='CONTROL_DIRECTORY_REPLACED'));
    const result=spawnSync(process.execPath,[paths.supervisor,'request',control,controlRunId],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.ok(!events(join(controlRead,'supervisor.jsonl')).some(e=>e.event==='SIGNAL_SENT'));
  }
  if(request) {
    // Independent request process writes the file; only the owning supervisor signals.
    await sleep(1100);
    const result=spawnSync(process.execPath,[paths.supervisor,'request',control,controlRunId],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/CANCEL_REQUEST_WRITTEN/);
  }
  const result=await terminal;
  const expected=mode==='graceful'?42:mode==='default'?143:mode==='timeout'?124:0;
  assert.equal(result.code,expected,stderr);assert.equal(result.signal,null);
  assert.match(stdout,new RegExp('MEMORY_OBSERVER_EXIT=0 CAPTURE_EXIT='+expected));
  const supervisor=events(join(controlRead,'supervisor.jsonl')),wrapper=events(join(diagnostics,'process.jsonl'));
  const exit=wrapper.filter(e=>e.event==='CHILD_EXIT');assert.equal(exit.length,1);assert.equal(exit[0].wrapperExitCode,expected);
  assert.equal(supervisor.at(-1).event,'WRAPPER_EXIT');assert.equal(supervisor.at(-1).supervisorExitCode,expected);
  assert.equal(wrapper.some(e=>e.event==='DEADLINE_REACHED'),mode==='timeout');
  assert.equal(wrapper.some(e=>e.event==='FORCE_KILL_ATTEMPT'),false);
  if(request){assert.equal(wrapper.filter(e=>e.event==='SIGNAL_RECEIVED'&&e.signal==='SIGTERM').length,1);assert.equal(supervisor.filter(e=>e.event==='SIGNAL_SENT'&&e.accepted).length,1);}
  else assert.ok(!supervisor.some(e=>e.event==='CANCEL_ACCEPTED'||e.event==='SIGNAL_SENT'));
  const memory=JSON.parse(readFileSync(join(outputDir,'summary.json'),'utf8'));
  assert.equal(memory.root.pid,descriptor.supervisorPid);assert.equal(memory.status,'TARGET_TREE_EXITED');
  assert.ok(memory.processLifetimes.some(p=>p.pid===descriptor.wrapperPid));
  if(mode!=='replacement')assert.ok(memory.processLifetimes.some(p=>p.pid===receipt.pid));
  assert.ok(!memory.processLifetimes.some(p=>p.pid===memory.samplerPid));
  if(mode==='normal')assert.ok(memory.completePssSampleCount>=2);
  pass(name,{exitCode:expected,wrapperTerminalPersisted:true,supervisorTerminalPersisted:true,memoryRoot:'supervisor',sampleCount:memory.sampleCount,observedProcessCount:memory.processLifetimes.length,samplerExcluded:true,rejected:reasons,directoryReplacementRejected:replace,automaticCancelAbsentBeforeRequest:true});
  const reuse=spawnSync(process.execPath,[paths.supervisor,'start',controlRead,controlRunId],{encoding:'utf8'});assert.notEqual(reuse.status,0);assert.match(reuse.stderr,/EEXIST/);
  return {name,dir,exitCode:expected};
}
const cases=[];
cases.push(await runCase('normal','normal'));
cases.push(await runCase('graceful-with-invalid-requests','graceful',{rejects:true,request:true}));
cases.push(await runCase('default-cancel','default',{request:true}));
cases.push(await runCase('wrapper-timeout','timeout',{timeout:1200}));
cases.push(await runCase('directory-replacement','replacement',{replace:true}));
const report={artifactRoot:privateRoot,status:'PASS_SYNTHETIC_ONLY',checkedAt:new Date().toISOString(),tests,cases,networkUsed:false,databaseAccessed:false,realProducerExecuted:false,oldUnknownProcessesTouched:false,scope:'Tests use unchanged real wrapper and exact restored supervisor, with local synthetic inner only. Production timeout/argv preserved by separate starter proof.'};
writeFileSync(join(privateRoot,'TEST_RESULTS.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
