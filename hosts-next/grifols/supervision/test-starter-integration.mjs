import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { paths, addCombinedObservation } from './create-combined-starter.mjs';
const q=s=>"'"+s.replaceAll("'","'\\''")+"'",sha=s=>createHash('sha256').update(s).digest('hex');
const A=Object.getPrototypeOf(async function(){}).constructor;
mkdirSync(join(paths.base,'verification'),{recursive:true,mode:0o700});
const privateRoot=mkdtempSync(join(paths.base,'verification/integration-'));
const sourceId='source-grifols-china-social';
const original=readFileSync(paths.original,'utf8'),combined=addCombinedObservation(original);
async function simulate(source,options={}) {
  let now=Date.now();class Clock extends Date {static now(){return now;}}
  const checkedAt=new Date(now).toISOString(),stamp=new Date(now-13*3600000).toISOString();
  const tuple={sourceResultId:'synthetic-result',sourceId,batchId:'synthetic-prior',releaseCandidateId:'synthetic-candidate'};
  const observation={...tuple,id:'synthetic-observation',sourceConfigSha256:'synthetic-config',crawledAt:stamp,observedFrom:stamp,observedTo:stamp,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
  const row={checkedAt,holderId:'',candidateRows:[{id:'synthetic-deadline-candidate',version:1,goalId:'jobfinder-portable-required-40',commitSha:'47b74924f850a4d329460b71717b36df9a5159b8'}],latestSuccessfulSource:{...tuple,sourceConfigHash:'synthetic-config',startedAt:stamp,finishedAt:stamp,observations:[observation]}};
  const saved=new Map(),reads=[],launches=[],checks=[];
  const h={cfg:{root:privateRoot,repo:join(paths.r2,'workspaces/producer-fb0-exact'),project:'SYNTHETIC_ONLY',sourceId,sourceConfigSha256:'synthetic-config'},q,rows:x=>x,
    save:async(p,v)=>{saved.set(p,v);if(options.expire&&p.endsWith('reviewed-cancel-contract.json'))now+=61000;},
    readFile:async p=>{reads.push(p);assert.ok(p.endsWith('/bootstrap.json'));return {hash:'synthetic-bootstrap-hash'};},
    cmd:async()=>({exit_code:0,output:'SYNTHETIC_PREFLIGHT'})};
  const load=k=>k.endsWith('registeredCandidateBinding')?{status:'REGISTERED_VERIFIED',candidate:{id:'synthetic-deadline-candidate',version:1,goalId:'jobfinder-portable-required-40'},build:{commitSha:'47b74924f850a4d329460b71717b36df9a5159b8'}}:k.endsWith('cloudPilotHostHelpers')?'return getCombinedFixtureHelper();':k.endsWith('nextBatchId')?'SYNTHETIC.batch_one':k.endsWith('continuousPortableRelayCodeWithPoll')?'return;':undefined;
  const tools={mcp__codex_apps__supabase_execute_sql:async()=>[row],exec_command:async request=>{
    if(request.cmd.startsWith('sha256sum -- ') || request.cmd.startsWith('node '+q(paths.inspector))) {
      checks.push(request);
      const result=spawnSync('bash',['-c',request.cmd],{cwd:request.workdir,encoding:'utf8'});
      let output=result.stdout;
      if(options.badHash&&request.cmd.startsWith('sha256sum'))output='invalid';
      if(options.badCwd&&request.cmd.startsWith('node '))output=JSON.stringify({...JSON.parse(output),cwd:'/wrong'});
      return {exit_code:result.status,output};
    }
    launches.push(request);return {session_id:56789,output:'SYNTHETIC_CAPTURE_INTERCEPTED'};
  }};
  globalThis.getCombinedFixtureHelper=()=>h;
  let error=null;
  try {await new A('load','store','notify','tools','Date',source)(load,()=>{},()=>{},tools,Clock);}catch(e){error=e;}finally{delete globalThis.getCombinedFixtureHelper;}
  return {saved,reads,launches,checks,error};
}
const plain=await simulate(original),observed=await simulate(combined);
assert.equal(plain.error,null);assert.equal(observed.error,null);
assert.equal(plain.launches.length,1);assert.equal(observed.launches.length,1);assert.equal(observed.checks.length,2);
assert.deepEqual(plain.reads,observed.reads);
const originalCommand=plain.launches[0].cmd;
assert.equal([...observed.saved].find(([p])=>p.endsWith('reviewed-command.txt'))[1],originalCommand);
const shell=observed.launches[0].cmd;
const capture=shell.split('\n')[0].slice('(exec '.length,-') &'.length);
const tokens=command=>{const p=spawnSync('bash',['-c',"printf '%s\\0' "+command],{encoding:'utf8'});assert.equal(p.status,0);return p.stdout.split('\0').slice(0,-1);};
const before=tokens(originalCommand),after=tokens(capture),wrapperBefore=before.indexOf('scripts/run-with-http-diagnostics.mjs'),wrapperAfter=after.indexOf(paths.wrapper);
assert.ok(wrapperBefore>0&&wrapperAfter>0);
assert.deepEqual(before.slice(wrapperBefore+1),after.slice(wrapperAfter+1));
assert.deepEqual(before.slice(0,wrapperBefore-1),after.slice(0,wrapperBefore-1));
assert.equal(after[wrapperAfter-1],process.execPath);assert.equal(realpathSync(process.execPath),process.execPath);
assert.equal(realpathSync(join(paths.r2,'workspaces/producer-fb0-exact',before[wrapperBefore])),paths.wrapper);
assert.ok(after.includes('--max-old-space-size=256'));assert.ok(after.includes('1800000'));
assert.equal(observed.launches[0].workdir,plain.launches[0].workdir);
const contract=[...observed.saved].find(([p])=>p.endsWith('reviewed-cancel-contract.json'))[1];
assert.equal(contract.controlRunId,'jb-'+sha('SYNTHETIC.batch_one'));
assert.equal(contract.originalBatch,'SYNTHETIC.batch_one');assert.equal(contract.samplerExpectedArg,paths.supervisor);
assert.ok(shell.includes('--expected-arg '+q(paths.supervisor)));
for(const [option,pattern] of [['badHash',/COMBINED_SOURCE_HASH_MISMATCH/],['badCwd',/COMBINED_NORMALIZATION_MISMATCH/],['expire',/FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH/]]) {
  const failed=await simulate(combined,{[option]:true});assert.match(failed.error.message,pattern);assert.equal(failed.launches.length,0);
}
const report={artifactRoot:privateRoot,checkedAt:new Date().toISOString(),status:'PASS_MOCKED_INTEGRATION',sourceSha256:sha(original),combinedSha256:sha(combined),originalCommandSha256:sha(originalCommand),originalCommandSavedUnchanged:true,wrapperAndInnerArgvEqualAfterExplicitPathNormalization:true,environmentPrefixUnchanged:true,cwdUnchanged:true,heapMiB:256,wrapperDeadlineMs:1800000,bootstrapReadCount:observed.reads.length,sourceHashMismatchBlocked:true,pathNormalizationMismatchBlocked:true,postSaveBootstrapExpiryBlocked:true,normalization:{originalNode:'node',absoluteNode:process.execPath,originalWrapper:'scripts/run-with-http-diagnostics.mjs',absoluteWrapper:paths.wrapper},noRealProducerOrDatabase:true};
writeFileSync(join(privateRoot,'STARTER_INTEGRATION.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
