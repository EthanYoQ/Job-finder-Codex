import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyCandidateCompletion} from '../hosts/gilead/host/runtime/update-candidate-completion-state.mjs';
const n=resolve(fileURLToPath(new URL('..',import.meta.url))),host=join(n,'hosts/gilead/host');
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
const path=join(host,'runtime/complete-reviewed-source-readback.js'),source=readFileSync(path,'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
assert.equal(sha(source),'3eb561c5c3dc1aa4a8897d83ac9bd857830bee33e1a39702b173e63934793527');
const unique='/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/PUBLISHER-ACTIVE-STATE.json';
const wrong=join(n,'PUBLISHER-ACTIVE-STATE.json');
const ns='proxyNode22:gileadNext:',batch='synthetic-unique-state-completion',candidateId='synthetic-c52-unique-state';
const started='2026-10-07T00:00:00.000Z',crawled='2026-10-07T00:00:01.000Z',finished='2026-10-07T00:00:02.000Z';
const row={id:batch+'--'+cfg.sourceId,sourceId:cfg.sourceId,batchId:batch,releaseCandidateId:candidateId,sourceConfigHash:cfg.sourceConfigSha256,atomicCommitState:'COMMITTED',completenessState:'VERIFIED',startedAt:started,finishedAt:finished,canonicalCurrentJobSetSha256:'a'.repeat(64),completenessCertificateSha256:'b'.repeat(64),dedupeOutputCount:10,rawCount:11};
const observation={id:'synthetic-observation',sourceResultId:row.id,sourceId:cfg.sourceId,batchId:batch,releaseCandidateId:candidateId,sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:crawled,observedFrom:started,observedTo:finished,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
const readback={checkedAt:finished,row,batch:{id:batch,releaseCandidateId:candidateId,status:'SUCCESS',finishedAt:finished},holderId:'',observations:[observation],successfulSourceCount:1,successfulCurrentJobCount:10};
const binding={status:'REGISTERED_VERIFIED',candidate:{id:candidateId,version:52},build:{commitSha:'d6190919d17c8ba4ee721daa2087d3c09bded7fa'}};
const initial={runtimeCandidate:{id:'synthetic-c51',version:51},sourceSpecificRuntimeCandidates:{[cfg.sourceId]:{id:candidateId,version:52}},active:{sourceId:'source-novartis-social',batchId:'synthetic-other-active',candidateId:'synthetic-c51',candidateVersion:51},pendingReadOnlyTerminalSources:[{sourceId:cfg.sourceId,batchId:batch,candidateId,candidateVersion:52,noFurtherProductionWriteInOriginalProcess:true}]};
async function exercise(code,{existing=true}={}){
 const virtual=new Map(existing?[[unique,structuredClone(initial)]]:[]),events=[],stores=new Map();let output;
 const memories=new Map(Object.entries({refreshCurrentRun:cfg.root+'/'+batch,refreshCurrentBatch:batch,registeredCandidateBinding:binding,publicationReview:{sourceResult:row},lastPortableExecPoll:{exit_code:0,originalSessionId:123},refreshSession:123}).map(([k,v])=>[ns+k,v]));
 const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
 const h={cfg,q,rows:x=>x,save:async(p,data)=>stores.set(p,structuredClone(data)),cmd:async command=>{
  const args=[...command.matchAll(/'((?:[^']|'\\'')*)'/g)].map(m=>m[1].replaceAll("'\\''","'"));
  assert(command.startsWith(cfg.node+' '));assert.equal(args.length,3);assert.equal(args[0],join(host,'runtime/update-candidate-completion-state.mjs'));
  const statePath=args[1];events.push({kind:'read-existing-state',path:statePath});
  if(statePath!==unique||!virtual.has(statePath))throw Error('UNIQUE_EXISTING_PUBLISHER_STATE_REQUIRED');
  const next=applyCandidateCompletion(virtual.get(statePath),JSON.parse(args[2]));
  virtual.set(statePath,next);events.push({kind:'update-existing-state',path:statePath});return '{}';
 }};
 const tools={mcp__codex_apps__supabase_execute_sql:async()=>{events.push({kind:'synthetic-readback'});return structuredClone([readback]);}};
 const A=Object.getPrototypeOf(async function(){}).constructor;
 try{await new A('load','tools','text','syntheticHelpers',code)(key=>key===ns+'cloudPilotHostHelpers'?'return syntheticHelpers;':memories.get(key),tools,value=>{output=value;},h);return {virtual,events,output};}
 catch(error){return {virtual,events,error};}
}
// The nested helper factory requires a lexical-free global seam, matching existing host harnesses.
globalThis.__uniqueStateHelper=undefined;
const executable=source.replace('const h=await new A(load(ns+"cloudPilotHostHelpers"))();','const h=syntheticHelpers;');
assert.notEqual(executable,source);
const positive=await exercise(executable);assert.equal(positive.error,undefined);
assert.deepEqual([...positive.virtual.keys()],[unique]);assert.equal(positive.events.filter(e=>e.kind==='update-existing-state').length,1);
assert(positive.events.filter(e=>e.path).every(e=>e.path===unique));
const updated=positive.virtual.get(unique);assert.deepEqual(updated.runtimeCandidate,initial.runtimeCandidate);assert.deepEqual(updated.active,initial.active);
assert.equal(updated.sourceSpecificRuntimeCandidates[cfg.sourceId].successfulCurrentJobCount,10);assert.equal(updated.pendingReadOnlyTerminalSources.length,0);
const bad=await exercise(executable.replace('const statePath='+JSON.stringify(unique)+';','const statePath='+JSON.stringify(wrong)+';'));
assert.match(String(bad.error),/UNIQUE_EXISTING_PUBLISHER_STATE_REQUIRED/);assert.deepEqual([...bad.virtual.keys()],[unique]);assert.deepEqual(bad.virtual.get(unique),initial);assert.equal(bad.events.filter(e=>e.kind==='update-existing-state').length,0);
const missing=await exercise(executable,{existing:false});assert.match(String(missing.error),/UNIQUE_EXISTING_PUBLISHER_STATE_REQUIRED/);assert.equal(missing.virtual.size,0);
assert.equal(sha(readFileSync(path,'utf8')),sha(source));
const report={classification:'NARROW_SYNTHETIC_UNIQUE_STATE_PATH_CONTRACT',passed:3,successfulSourceSha256:sha(source),uniqueStatePath:unique,positive:{readPath:unique,updatePath:unique,existingMainC51Preserved:true,otherActiveSourcePreserved:true,sourceSpecificC52Updated:true},negative:{rebasedSecondStateRejected:true,missingStateNeverCreated:true},realPublisherStateRead:false,realPublisherStateWritten:false,secondStateCreated:false,actualRunDirectoryRead:false,databaseOrNetworkCalled:false,sourceFileChanged:false};
writeFileSync(join(n,'recovery-tests/UNIQUE-STATE-PATH-RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
