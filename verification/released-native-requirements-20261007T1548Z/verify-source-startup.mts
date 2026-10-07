// Execute each unchanged source loader and starter with a deny-by-default local tool shim.
// All DB, preflight and launch effects are synthetic; only local source hashes and inspectors execute.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve,join } from 'node:path';
import { compileCloudPilotPublicationContextSql } from '../../producer/src/db/cloudPilotSqlControl.ts';
import { verifyNodeRuntimeProfile } from '../../producer/scripts/verify-node-runtime-profile.ts';
const [source]=process.argv.slice(2);assert(['pfizer'].includes(source));
const R=resolve(import.meta.dirname,'../..'),base=join(R,'hosts',source),host=join(base,'host');
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
const template=JSON.parse(readFileSync(join(host,'control-base.template.json'),'utf8'));
const prepared=join(import.meta.dirname,'synthetic-'+source,'valid-prepared');
const control=JSON.parse(readFileSync(join(prepared,'host/control-base.json'),'utf8'));
const renderedLoader=readFileSync(join(prepared,'host/runtime/load-host-state.js'),'utf8');
const renderedStarter=readFileSync(join(prepared,'supervision/start-monitor-'+source+'51-combined.js'),'utf8');
const contextSql=compileCloudPilotPublicationContextSql(control);
const binding={status:'REGISTERED_VERIFIED',candidate:control.candidate,build:control.build,databaseIdentity:control.databaseIdentity,contextReadSha256:createHash('sha256').update(contextSql).digest('hex'),loaderSha256:createHash('sha256').update(renderedLoader).digest('hex'),starterSha256:createHash('sha256').update(renderedStarter).digest('hex')};
const nodeRuntime=await verifyNodeRuntimeProfile();
const A=Object.getPrototypeOf(async function(){}).constructor,sha=s=>createHash('sha256').update(s).digest('hex'),ns='proxyNode22:'+source+':';
const results=[];const pass=name=>results.push({name,passed:true});
const state=new Map();let dbCalls=0,launched=0,localCommands=0;
globalThis.load=k=>state.get(k);globalThis.store=(k,v)=>{assert(k.startsWith(ns),'namespace leak: '+k);state.set(k,v);};globalThis.notify=()=>{};globalThis.text=()=>{};
function execLocal(cmd,cwd){const p=spawnSync('/bin/bash',['-c',cmd],{cwd,encoding:'utf8',env:process.env,maxBuffer:2e6});assert.equal(p.status,0,p.stderr);return {exit_code:0,output:p.stdout+p.stderr};}
globalThis.tools={exec_command:async(args)=>{
 localCommands++;
 if(args.cmd.includes('/runtime/inspect-host-binding.mts'))return {exit_code:0,output:JSON.stringify({build:control.build,candidate:control.candidate,nodeRuntime,contextReadSha256:binding.contextReadSha256})};
 assert(args.cmd.startsWith('python3 - '),'Unapproved loader command');
 let files;
 if(localCommands===1)files=Object.fromEntries(['load-host-state.js','../../supervision/start-monitor-'+source+'51-combined.js','continuous-relay-v3-durable-monitor.js','complete-reviewed-source-readback.js'].map(p=>[p,readFileSync(join(host,'runtime',p),'utf8')]));
 if(localCommands===1){files['load-host-state.js']=renderedLoader;files['../../supervision/start-monitor-'+source+'51-combined.js']=renderedStarter;files.__loaderSha256=binding.loaderSha256;files.__starterSha256=binding.starterSha256;}
 else files={...Object.fromEntries(['host-config.json','machine-json.js','host-helper-functions.js','host-stage-functions.js'].map(p=>[p,readFileSync(join(host,p),'utf8')])),'control-base.json':JSON.stringify(control),'context-read.sql':contextSql,'__contextReadSha256':binding.contextReadSha256};
 files[localCommands===1?'../activation.json':'activation.json']=JSON.stringify(binding);
 return {exit_code:0,output:JSON.stringify(files)};
}};
await new A('sourceKey',readFileSync(join(host,'runtime/load-source-runtime.js'),'utf8'))(source);
assert.equal(state.get(ns+'cloudPilotHostConfig').sourceId,cfg.sourceId);assert.equal(state.get(ns+'registeredCandidateBinding').candidate.version,51);assert.equal(state.get(ns+'nextBatchId'),null);assert.equal(localCommands,3);pass('Actual loader accepts in-memory synthetic registration with actual compiler/binary proof and stores only selected namespace without launch');
const loadedKeys=[...state.keys()];assert(loadedKeys.every(k=>k.startsWith(ns)));pass('All actual loader session keys are isolated to source namespace');
const starterPath=join(base,'supervision','start-monitor-'+source+'51-combined.js');const starter=renderedStarter;
assert.equal(state.get(ns+'restoredPortableSourceStartCode'),starter);pass('Actual loader stores exact actual starter bytes');
const parse=new Function('output','record',readFileSync(join(host,'machine-json.js'),'utf8'));
const deps=[join(base,'supervision/sample_process_tree.py'),join(base,'supervision/supervise-cancel.mjs'),join(cfg.repo,'scripts/run-with-http-diagnostics.mjs'),join(base,'supervision/inspect-launch-identity.mjs')];
const originalHashes=deps.map(p=>sha(readFileSync(p)));
const sandbox=mkdtempSync(join(base,'verification/synthetic-starter-gates-'));
const shaq=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
async function runStarter({tamper=-1,due=true,sourceMismatch=false,held=false,expired=false,unknownInspectorStderr=false,returnedLaunch=null,failLaunchSave=false}={}){
 const memories=new Map(),stored=new Map(),order=[];let hashes=0,inspectors=0,attemptedLaunch=0;
 const now=Date.now(),observed=now-(due?13:1)*3600000;
 const row={checkedAt:new Date(expired?now-61000:now).toISOString(),holderId:held?'synthetic-holder':'',candidateRows:[{...binding.candidate,commitSha:binding.build.commitSha}],latestSuccessfulSource:{sourceResultId:'synthetic-source-result',sourceId:sourceMismatch?'wrong-source':cfg.sourceId,batchId:'synthetic-prior-batch',releaseCandidateId:'synthetic-prior-candidate',sourceConfigHash:cfg.sourceConfigSha256,startedAt:new Date(observed-1000).toISOString(),finishedAt:new Date(observed+1000).toISOString(),observations:[{id:'synthetic-observation',sourceResultId:'synthetic-source-result',sourceId:cfg.sourceId,batchId:'synthetic-prior-batch',releaseCandidateId:'synthetic-prior-candidate',sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:new Date(observed).toISOString(),observedFrom:new Date(observed-1000).toISOString(),observedTo:new Date(observed+1000).toISOString(),successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true}]}};
 globalThis.__sourceHostTestHelpers={cfg,q:shaq,rows:x=>x,machineJson:x=>parse(x,()=>{}),save:async(p,v)=>{order.push('save:'+p.split('/').at(-1));if(failLaunchSave&&p.endsWith('/original-launch-exec-tool-result.json'))throw Error('SYNTHETIC_LAUNCH_SAVE_FAILED');memories.set(p,typeof v==='string'?v:JSON.stringify(v));},readFile:async p=>({hash:sha(memories.get(p)),text:memories.get(p)}),cmd:async cmd=>{if(cmd.includes('/runtime/verify-independent-validation.mts'))return JSON.stringify({status:'VALIDATED_CURRENT_RUN',sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,independentValidationSha256:'a'.repeat(64)});assert(cmd.includes('/runtime/preflight/preflight-launch.mjs'));return {syntheticPreflightOnly:true};}};
 globalThis.load=k=>k===ns+'cloudPilotHostHelpers'?'return globalThis.__sourceHostTestHelpers;':k===ns+'currentIndependentValidationInput'?{path:'/synthetic-only/fresh-independent.json',sha256:'a'.repeat(64)}:k===ns+'registeredCandidateBinding'?binding:k===ns+'nextBatchId'?'synthetic-starter-gate-only':k===ns+'continuousPortableRelayCodeWithPoll'?'return;':state.get(k);
 globalThis.store=(k,v)=>{assert(k.startsWith(ns));order.push('store:'+k.slice(ns.length)+(k===ns+'refreshSession'&&v===null?':clear':''));stored.set(k,v);};
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
   attemptedLaunch++;assert(args.cmd.includes('/supervision/supervise-cancel.mjs'));if(returnedLaunch)return structuredClone(returnedLaunch);throw Error('SYNTHETIC_STOP_BEFORE_ANY_SPAWN');
  }
 };
 let error;try{await new A(starter)();}catch(e){error=e;}
 return {error,hashes,inspectors,attemptedLaunch,savedCount:memories.size,memories,stored,order};
}
let result=await runStarter();assert.match(result.error.message,/SYNTHETIC_STOP_BEFORE_ANY_SPAWN/);assert.deepEqual([result.hashes,result.inspectors,result.attemptedLaunch],[1,1,1]);pass('Unchanged actual starter accepts all four actual pinned dependency hashes and real launch identity; harness blocks before spawn');
for(let i=0;i<4;i++){result=await runStarter({tamper:i});assert.match(result.error.message,/COMBINED_SOURCE_HASH_MISMATCH/);assert.deepEqual([result.hashes,result.inspectors,result.attemptedLaunch],[1,0,0]);pass('Actual starter rejects modified dependency bytes at hash gate: '+deps[i].split('/').at(-1));}
for(const [options,code,name] of [[{due:false},'SOURCE_NOT_DUE','not yet due'],[{sourceMismatch:true},'SOURCE_DUE_OBSERVATION_REQUIRED','wrong source observation'],[{held:true},'FRESH_CANDIDATE_PRECONDITION','held global lock'],[{expired:true},'FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH','expired fresh readback']]){result=await runStarter(options);assert(result.error.message.includes(code),result.error.message);assert.equal(result.attemptedLaunch,0);pass('Actual starter rejects '+name+' before spawn');}
result=await runStarter({unknownInspectorStderr:true});assert(result.error);assert.equal(result.attemptedLaunch,0);pass('Actual starter rejects unknown JSON-shaped inspector stderr before spawn');
for(const p of deps)assert.equal(sha(readFileSync(p)),originalHashes[deps.indexOf(p)]);pass('All original four dependencies remain byte-identical after tamper tests');
for(const terminal of [
 {chunk_id:'synthetic-exit42',exit_code:42,output:'SYNTHETIC_TERMINAL_EXIT42'},
 {chunk_id:'synthetic-no-session',exit_code:1,output:'FULL_ORIGINAL_EXEC_OUTPUT\n'+'x'.repeat(10000),wall_time_seconds:0.125,original_token_count:10023},
 {chunk_id:'synthetic-live-session',session_id:98765,output:'FULL_RUNNING_OUTPUT',wall_time_seconds:1,original_token_count:33}
]){
 result=await runStarter({returnedLaunch:terminal});
 if(terminal.session_id)assert.equal(result.error,undefined);else assert.match(result.error.message,/NO_RUNNING_LAUNCH_SESSION/);
 const saved=result.memories.get(cfg.root+'/synthetic-starter-gate-only/original-launch-exec-tool-result.json');assert.deepEqual(JSON.parse(saved),terminal);
 assert.deepEqual(result.stored.get(ns+'refreshLaunchToolResult'),terminal);
 if(terminal.session_id)assert(result.order.indexOf('save:original-launch-exec-tool-result.json')<result.order.indexOf('store:refreshSession'));else assert.equal(result.stored.get(ns+'refreshSession'),null);
 pass('Complete original launch JSON is retained before session classification: '+(terminal.session_id?'running':'terminal without session'));
}
result=await runStarter({returnedLaunch:{session_id:98765,output:'full original launch'},failLaunchSave:true});assert.match(result.error.message,/SYNTHETIC_LAUNCH_SAVE_FAILED/);assert.deepEqual(result.stored.get(ns+'refreshLaunchToolResult'),{session_id:98765,output:'full original launch'});assert.equal(result.stored.get(ns+'refreshSession'),null);pass('Launch save failure retains full original tool object and blocks session classification');
let actualReads=0;globalThis.tools={exec_command:async args=>{actualReads++;assert(args.cmd.startsWith('python3 - '));const p=spawnSync('/bin/bash',['-c',args.cmd],{encoding:'utf8',env:process.env,maxBuffer:2e6});return {exit_code:p.status,output:p.stdout+p.stderr};}};globalThis.store=()=>{throw Error('UNBOUND_LOADER_MUST_NOT_STORE');};
await assert.rejects(new A('sourceKey',readFileSync(join(host,'runtime/load-source-runtime.js'),'utf8'))(source),/RESTORED_HOST_READ_FAILED/);assert.equal(actualReads,1);pass('Actual shell read of unbound source loader fails closed before any state or launch');
await assert.rejects(new A('sourceKey',readFileSync(join(host,'runtime/load-source-runtime.js'),'utf8'))(source==='novo'?'ucb':'novo'),/RESTORED46_SOURCE_SELECTION/);assert.equal(actualReads,1);pass('Wrong source selection fails before local reads');
globalThis.load=k=>{assert.equal(k,ns+'cloudPilotHostHelpers');return 'return {cfg:{}};';};globalThis.tools=new Proxy({},{get(){throw Error('LEGACY_BRANCH_MUST_NOT_ACCESS_TOOL');}});globalThis.store=()=>{throw Error('LEGACY_BRANCH_MUST_NOT_STORE');};
const legacyStage=await new A(readFileSync(join(host,'host-stage-functions.js'),'utf8'))();await assert.rejects(legacyStage.handle({kind:'ARCHIVE_STORE',expired:false,dispatchRecorded:false,payload:{}},'synthetic-only'),/UNSELECTED_LEGACY_ARCHIVE_STORE_UNSUPPORTED/);pass('Unselected legacy ARCHIVE_STORE fails closed before any file, upload, SQL or store');
const report={source,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,qualification:false,noExternalHttp:true,noDatabase:true,noLaunch:true,syntheticDbCalls:dbCalls,starterSha256:sha(starter),loaderSha256:sha(readFileSync(join(host,'runtime/load-source-runtime.js'))),dependencySha256:deps.map((path,i)=>({path,sha256:originalHashes[i]})),results};
writeFileSync(join(base,'verification/SOURCE_ADAPTATION_VERIFICATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({source,passed:results.length,starterSha256:report.starterSha256,loaderSha256:report.loaderSha256,noDatabase:true,noLaunch:true}));
