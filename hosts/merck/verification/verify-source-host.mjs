// Execute each unchanged source loader and starter with a deny-by-default local tool shim.
// All DB, preflight and launch effects are synthetic; only local source hashes and inspectors execute.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve,join } from 'node:path';
const [source]=process.argv.slice(2);assert(['merck','organon','bms'].includes(source));
const R=resolve(import.meta.dirname,'../../..'),base=join(R,'hosts',source),host=join(base,'host');
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8')),binding=JSON.parse(readFileSync(join(host,'activation.json'),'utf8'));
const A=Object.getPrototypeOf(async function(){}).constructor,sha=s=>createHash('sha256').update(s).digest('hex'),ns='proxyNode22:'+source+':';
const results=[];const pass=name=>results.push({name,passed:true});
const state=new Map();let dbCalls=0,launched=0,localCommands=0;
globalThis.load=k=>state.get(k);globalThis.store=(k,v)=>{assert(k.startsWith(ns),'namespace leak: '+k);state.set(k,v);};globalThis.notify=()=>{};globalThis.text=()=>{};
function execLocal(cmd,cwd){const p=spawnSync('/bin/bash',['-c',cmd],{cwd,encoding:'utf8',env:process.env,maxBuffer:2e6});assert.equal(p.status,0,p.stderr);return {exit_code:0,output:p.stdout+p.stderr};}
globalThis.tools={exec_command:async(args)=>{
 assert(args.cmd.startsWith('python3 - ')||args.cmd.includes('/runtime/inspect-host-binding.mts'), 'Unapproved loader command');
 localCommands++;return execLocal(args.cmd,args.workdir);
}};
await new A('sourceKey',readFileSync(join(host,'runtime/load-source-runtime.js'),'utf8'))(source);
assert.equal(state.get(ns+'cloudPilotHostConfig').sourceId,cfg.sourceId);assert.equal(state.get(ns+'registeredCandidateBinding').candidate.version,51);assert.equal(state.get(ns+'nextBatchId'),null);assert.equal(localCommands,3);pass('Actual loader executes exact local compiler/binary proof and stores only selected namespace without launch');
const loadedKeys=[...state.keys()];assert(loadedKeys.every(k=>k.startsWith(ns)));pass('All actual loader session keys are isolated to source namespace');
const starterPath=join(base,'supervision','start-monitor-'+source+'51-combined.js');const starter=readFileSync(starterPath,'utf8');
assert.equal(state.get(ns+'restoredPortableSourceStartCode'),starter);pass('Actual loader stores exact actual starter bytes');
const parse=new Function('output','record',readFileSync(join(host,'machine-json.js'),'utf8'));
const deps=[join(base,'supervision/sample_process_tree.py'),join(base,'supervision/supervise-cancel.mjs'),join(cfg.repo,'scripts/run-with-http-diagnostics.mjs'),join(base,'supervision/inspect-launch-identity.mjs')];
const originalHashes=deps.map(p=>sha(readFileSync(p)));
const sandbox=mkdtempSync(join(base,'verification/synthetic-starter-gates-'));
const shaq=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
async function runStarter({tamper=-1,due=true,sourceMismatch=false,held=false,expired=false,unknownInspectorStderr=false}={}){
 const memories=new Map();let hashes=0,inspectors=0,attemptedLaunch=0;
 const now=Date.now(),observed=now-(due?13:1)*3600000;
 const row={checkedAt:new Date(expired?now-61000:now).toISOString(),holderId:held?'synthetic-holder':'',candidateRows:[{...binding.candidate,commitSha:binding.build.commitSha}],latestSuccessfulSource:{sourceResultId:'synthetic-source-result',sourceId:sourceMismatch?'wrong-source':cfg.sourceId,batchId:'synthetic-prior-batch',releaseCandidateId:'synthetic-prior-candidate',sourceConfigHash:cfg.sourceConfigSha256,startedAt:new Date(observed-1000).toISOString(),finishedAt:new Date(observed+1000).toISOString(),observations:[{id:'synthetic-observation',sourceResultId:'synthetic-source-result',sourceId:cfg.sourceId,batchId:'synthetic-prior-batch',releaseCandidateId:'synthetic-prior-candidate',sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:new Date(observed).toISOString(),observedFrom:new Date(observed-1000).toISOString(),observedTo:new Date(observed+1000).toISOString(),successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true}]}};
 globalThis.__sourceHostTestHelpers={cfg,q:shaq,rows:x=>x,machineJson:x=>parse(x,()=>{}),save:async(p,v)=>memories.set(p,typeof v==='string'?v:JSON.stringify(v)),readFile:async p=>({hash:sha(memories.get(p)),text:memories.get(p)}),cmd:async cmd=>{assert(cmd.includes('/runtime/preflight/preflight-launch.mjs'));return {syntheticPreflightOnly:true};}};
 globalThis.load=k=>k===ns+'cloudPilotHostHelpers'?'return globalThis.__sourceHostTestHelpers;':k===ns+'registeredCandidateBinding'?binding:k===ns+'nextBatchId'?'synthetic-starter-gate-only':state.get(k);
 globalThis.store=(k,v)=>{assert(k.startsWith(ns));};
 globalThis.tools={
  mcp__codex_apps__supabase_execute_sql:async args=>{dbCalls++;assert(args.query.startsWith('WITH latest_successful AS'));assert(args.query.includes(shaq(cfg.sourceId)));return [row];},
  exec_command:async args=>{
   if(args.cmd.startsWith('sha256sum -- ')){
    hashes++;assert.equal(args.cmd,'sha256sum -- '+deps.map(shaq).join(' '));const r=execLocal(args.cmd,args.workdir);
    assert.equal(r.output.trim(),deps.map((p,i)=>originalHashes[i]+'  '+p).join('\n'));
    if(tamper>=0){const altered=join(sandbox,'tampered-dependency-'+tamper);writeFileSync(altered,Buffer.concat([readFileSync(deps[tamper]),Buffer.from('\n// synthetic altered bytes\n')]));const alteredSha=execFileSync('sha256sum',[altered],{encoding:'utf8'}).split(' ')[0];r.output=r.output.replace(originalHashes[tamper],alteredSha);}
    return r;
   }
   if(args.cmd.includes('/supervision/inspect-launch-identity.mjs')){inspectors++;const r=execLocal(args.cmd,args.workdir);if(unknownInspectorStderr)r.output+='{"unrecognized":"stderr"}\n';return r;}
   attemptedLaunch++;assert(args.cmd.includes('/supervision/supervise-cancel.mjs'));throw Error('SYNTHETIC_STOP_BEFORE_ANY_SPAWN');
  }
 };
 let error;try{await new A(starter)();}catch(e){error=e;}
 return {error,hashes,inspectors,attemptedLaunch,savedCount:memories.size};
}
let result=await runStarter();assert.match(result.error.message,/SYNTHETIC_STOP_BEFORE_ANY_SPAWN/);assert.deepEqual([result.hashes,result.inspectors,result.attemptedLaunch],[1,1,1]);pass('Unchanged actual starter accepts all four actual pinned dependency hashes and real launch identity; harness blocks before spawn');
for(let i=0;i<4;i++){result=await runStarter({tamper:i});assert.match(result.error.message,/COMBINED_SOURCE_HASH_MISMATCH/);assert.deepEqual([result.hashes,result.inspectors,result.attemptedLaunch],[1,0,0]);pass('Actual starter rejects modified dependency bytes at hash gate: '+deps[i].split('/').at(-1));}
for(const [options,code,name] of [[{due:false},'SOURCE_NOT_DUE','not yet due'],[{sourceMismatch:true},'SOURCE_DUE_OBSERVATION_REQUIRED','wrong source observation'],[{held:true},'FRESH_CANDIDATE_PRECONDITION','held global lock'],[{expired:true},'FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH','expired fresh readback']]){result=await runStarter(options);assert(result.error.message.includes(code),result.error.message);assert.equal(result.attemptedLaunch,0);pass('Actual starter rejects '+name+' before spawn');}
result=await runStarter({unknownInspectorStderr:true});assert(result.error);assert.equal(result.attemptedLaunch,0);pass('Actual starter rejects unknown JSON-shaped inspector stderr before spawn');
for(const p of deps)assert.equal(sha(readFileSync(p)),originalHashes[deps.indexOf(p)]);pass('All original four dependencies remain byte-identical after tamper tests');
const report={source,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,qualification:false,noExternalHttp:true,noDatabase:true,noLaunch:true,syntheticDbCalls:dbCalls,starterSha256:sha(starter),loaderSha256:sha(readFileSync(join(host,'runtime/load-source-runtime.js'))),dependencySha256:deps.map((path,i)=>({path,sha256:originalHashes[i]})),results};
writeFileSync(join(base,'verification/SOURCE_ADAPTATION_VERIFICATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({source,passed:results.length,starterSha256:report.starterSha256,loaderSha256:report.loaderSha256,noDatabase:true,noLaunch:true}));
