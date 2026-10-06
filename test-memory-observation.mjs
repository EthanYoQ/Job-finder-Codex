import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { addMemoryObservation, stripMemoryObservation, SAMPLER_PATH, SAMPLER_SHA256 } from './create-observed-starter.mjs';
import { buildObservedCommand } from './build-observed-command.mjs';

const base = dirname(fileURLToPath(import.meta.url)), r2 = dirname(base);
const privateRoot = mkdtempSync(join(base, 'verification/synthetic-'));
const fakeRepo = join(privateRoot, 'repo');
mkdirSync(join(fakeRepo, 'scripts'), {recursive:true});
copyFileSync(join(base, 'fixture-capture.mjs'), join(fakeRepo, 'scripts/run-with-http-diagnostics.mjs'));
const q = value => "'" + value.replaceAll("'", "'\\''") + "'";
const sha = value => createHash('sha256').update(value).digest('hex');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const tests = [];
const pass = (name, facts={}) => tests.push({name,passed:true,...facts});

async function simulate(source, key, options={}) {
  const sourceId = {kelun:'source-kelun-social',msd:'source-msd-china-social',takeda:'source-takeda-china-social'}[key];
  assert.ok(sourceId);
  let now = Date.now();
  class FakeDate extends Date { static now() { return now; } }
  const checkedAt = new Date(now).toISOString(), crawledAt = new Date(now-13*3600000).toISOString();
  const tuple = {sourceResultId:'synthetic-result',sourceId,batchId:'synthetic-prior',releaseCandidateId:'synthetic-prior-candidate'};
  const observation = {...tuple,id:'synthetic-observation',sourceConfigSha256:'synthetic-config',crawledAt,observedFrom:crawledAt,observedTo:crawledAt,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
  const row = {checkedAt,candidateRows:[{commitSha:'fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d'}],holderId:'',latestSuccessfulSource:{...tuple,sourceConfigHash:'synthetic-config',startedAt:crawledAt,finishedAt:crawledAt,observations:[observation]}};
  const saved = new Map(), reads = [], launches = [], hashes = [], stored = new Map();
  const h = {cfg:{root:join(privateRoot,'host-'+key),repo:fakeRepo,sourceId,sourceConfigSha256:'synthetic-config',project:'SYNTHETIC_ONLY'},q,rows:raw=>raw,
    save:async(path,value)=>{saved.set(path,value);if(options.expireDuringSave&&path.endsWith('reviewed-observer-command.txt'))now+=61000;},
    readFile:async path=>{reads.push(path);if(!path.endsWith('/bootstrap.json'))throw Error('READ_SCOPE_EXPANDED');return {hash:'synthetic-bootstrap-hash'};},
    cmd:async()=>({exit_code:0,output:'SYNTHETIC_PREFLIGHT_ONLY'})};
  const tools = {
    mcp__codex_apps__supabase_execute_sql:async()=>[row],
    exec_command:async request=>{
      if(request.cmd.startsWith('sha256sum -- ')) {
        hashes.push(request);
        const result=spawnSync('bash',['-c',request.cmd],{encoding:'utf8'});
        return {exit_code:result.status,output:options.badHash?'invalid hash':result.stdout};
      }
      launches.push(request);
      return {session_id:123456,output:'SYNTHETIC_INTERCEPTED_NOT_LAUNCHED'};
    }
  };
  const load = name=>name.endsWith('cloudPilotHostHelpers')?'return getHelper();':name.endsWith('nextBatchId')?'SYNTHETIC_ONLY':name.endsWith('continuousPortableRelayCodeWithPoll')?'return;':undefined;
  // Helpers created with AsyncFunction resolve globals, so expose only this fixture helper.
  globalThis.getHelper=()=>h;
  let error=null;
  try {await new AsyncFunction('load','store','notify','tools','Date',source)(load,(k,v)=>stored.set(k,v),()=>{},tools,FakeDate);} catch(e){error=e;}
  finally {delete globalThis.getHelper;}
  return {saved,reads,launches,hashes,error};
}

assert.equal(sha(readFileSync(SAMPLER_PATH)), SAMPLER_SHA256);
pass('restored-sampler-exact-known-bytes');
const originalSources=[];
for (const key of ['kelun','msd',...(process.argv.includes('--takeda')?['takeda']:[])]) {
  const name=key==='msd'?'start-monitor-true-a42.js':'start-monitor-portable42.js';
  const input=join(r2,'hosts46',key,'runtime',name), original=readFileSync(input,'utf8'), observed=addMemoryObservation(original);
  assert.equal(stripMemoryObservation(observed),original);
  assert.equal(sha(readFileSync(input)),sha(original));
  const plain=await simulate(original,key), instrumented=await simulate(observed,key);
  assert.equal(plain.error,null);assert.equal(instrumented.error,null);
  assert.equal(plain.launches.length,1);assert.equal(instrumented.launches.length,1);
  assert.equal(instrumented.hashes.length,1);
  assert.deepEqual(instrumented.reads,plain.reads);
  const command=plain.launches[0].cmd;
  const reviewed=[...instrumented.saved].find(([path])=>path.endsWith('/reviewed-command.txt'))[1];
  assert.equal(reviewed,command);
  assert.ok(instrumented.launches[0].cmd.startsWith('(exec '+command+') &\n'));
  assert.equal(plain.launches[0].workdir,instrumented.launches[0].workdir);
  pass(key+'-original-starter-byte-preservation-and-mocked-integration',{originalSha256:sha(original),originalCommandSha256:sha(command),bootstrapReads:instrumented.reads.length});
  const badHash=await simulate(observed,key,{badHash:true});
  assert.match(badHash.error.message,/MEMORY_SAMPLER_HASH_MISMATCH/);assert.equal(badHash.launches.length,0);
  const expired=await simulate(observed,key,{expireDuringSave:true});
  assert.match(expired.error.message,/FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH/);assert.equal(expired.launches.length,0);
  pass(key+'-hash-and-post-observer-bootstrap-guards');
  originalSources.push({key,command,observedCommand:instrumented.launches[0].cmd});
}
// Static round-trip also covers the independent-browser starters. Their live
// browser contract is not simulated or claimed to be measured here.
for (const key of ['pfizer','bayer','servier']) {
  const input=join(r2,'hosts46',key,'runtime','start-monitor-'+key+'42.js');
  const original=readFileSync(input,'utf8');
  assert.equal(stripMemoryObservation(addMemoryObservation(original)),original);
  pass(key+'-static-byte-preservation-only');
}
for(const [name, code, setErrexit, failObserver, key] of [
  ['zero-with-errexit',0,true,false,'kelun'],
  ['nonzero-with-errexit',7,true,false,'msd'],
  ['observer-failure-zero',0,true,true,'kelun'],
  ['observer-failure-nonzero',9,false,true,'msd']
]) {
  const spec=originalSources.find(item=>item.key===key), outputDir=join(privateRoot,name), receipt=join(privateRoot,name+'.json');
  const env={...process.env,SYNTHETIC_EXIT_CODE:String(code),SYNTHETIC_DURATION_MS:failObserver?'400':'6300',SYNTHETIC_RECEIPT:receipt};
  const command=failObserver?buildObservedCommand(spec.command,{samplerPath:SAMPLER_PATH,expectedArg:'deliberately-wrong-token',outputDir,label:'SYNTHETIC_ONLY/'+name},q):spec.observedCommand.replace(q(join(privateRoot,'host-'+key,'SYNTHETIC_ONLY/memory-observation')),q(outputDir));
  const script=(setErrexit?'set -e\n':'')+command;
  assert.equal(spawnSync('bash',['-n','-c',script]).status,0);
  const result=spawnSync('bash',['-c',script],{cwd:fakeRepo,env,encoding:'utf8',timeout:20000});
  assert.equal(result.status,code,result.stderr);
  assert.match(result.stdout,new RegExp('MEMORY_OBSERVER_EXIT='+(failObserver?'2':'0')+' CAPTURE_EXIT='+code));
  assert.match(result.stdout,/SYNTHETIC_CAPTURE_EXIT/);
  const evidence=JSON.parse(readFileSync(receipt,'utf8'));
  assert.ok(evidence.argv.includes('--max-old-space-size='+ (key==='msd'?'384':'256')));
  if(!failObserver) {
    const summary=JSON.parse(readFileSync(join(outputDir,'summary.json'),'utf8'));
    const samples=readFileSync(join(outputDir,'samples.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(summary.status,'TARGET_TREE_EXITED');
    assert.equal(summary.root.pid,evidence.rootPid);
    assert.ok(summary.processLifetimes.some(p=>p.pid===evidence.childPid));
    assert.ok(samples.some(s=>s.processes.some(p=>p.pid===evidence.childPid)&&s.processes.some(p=>p.pid===evidence.rootPid)));
    assert.ok(samples.every(s=>!s.processes.some(p=>p.pid===summary.samplerPid)));
    assert.ok(summary.treeRssPeak.KiB>0);assert.ok(summary.treePssPeak.KiB>0);
    assert.ok(summary.completePssSampleCount>=2);
    assert.equal(summary.rssIntervalSeconds,1);assert.equal(summary.pssIntervalSeconds,5);
    pass(name,{captureExit:result.status,rootPidMatched:true,childObserved:true,samplerExcluded:true,sampleCount:summary.sampleCount,completePssSampleCount:summary.completePssSampleCount});
  } else pass(name,{captureExit:result.status,observerExit:2,targetReachedNaturalExit:true});
}
// Compare the actual original shell invocation with the observed invocation.
const originalRun=spawnSync('bash',['-c',originalSources[0].command],{cwd:fakeRepo,env:{...process.env,SYNTHETIC_EXIT_CODE:'7',SYNTHETIC_DURATION_MS:'400'},encoding:'utf8',timeout:10000});
assert.equal(originalRun.status,7);
pass('unmodified-original-command-actual-shell-nonzero-exit',{captureExit:originalRun.status});
const report={checkedAt:new Date().toISOString(),status:'PASS_SYNTHETIC_ONLY',networkUsed:false,databaseAccessed:false,producerExecuted:false,activeStarterChanged:false,testDirectory:privateRoot,tests};
writeFileSync(join(base,'verification/TEST_RESULTS.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,passed:tests.length,tests}));
