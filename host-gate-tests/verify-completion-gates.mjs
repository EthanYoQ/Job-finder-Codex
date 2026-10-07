import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {applyCandidateCompletion} from '../hosts/novartis-next/host/runtime/update-candidate-completion-state.mjs';
const id='synthetic-only-novartis-new-host',sourceId='source-novartis-social',batchId='synthetic-only-completion';
const state={runtimeCandidate:{id,version:53},active:{batchId,sourceId,candidateId:id,candidateVersion:53}};
const data={summary:{state:'COMMITTED_EXACT',candidateId:id,candidateVersion:53,sourceId,batchId},binding:{status:'REGISTERED_VERIFIED',candidate:{id,version:53},build:{commitSha:'0edb12df2ea9b466b25eb388eff1f230636bbd7e'}},terminal:{exit_code:0,originalSessionId:10},sourceCount:1,jobCount:10,run:'synthetic-only'};
const before=structuredClone(state);assert.equal(applyCandidateCompletion(state,data).active,null);assert.deepEqual(state,before);
const results=[{name:'Matching synthetic new candidate completes only existing owner state slot without mutating input',passed:true}];
for(const [name,mutate] of [
 ['old C51 version',d=>{d.summary.candidateVersion=52;d.binding.candidate.version=52;}],
 ['old producer commit',d=>{d.binding.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';}],
 ['nonzero original exit',d=>{d.terminal.exit_code=1;}],
 ['running original session',d=>{d.terminal.session_id=10;}],
 ['unregistered binding',d=>{d.binding.status='UNREGISTERED_NOT_ACTIVATED';}],
 ['candidate tuple mismatch',d=>{d.summary.candidateId='wrong';}]
]){const d=structuredClone(data);mutate(d);assert.throws(()=>applyCandidateCompletion(state,d));results.push({name,passed:true});}
assert.throws(()=>applyCandidateCompletion({runtimeCandidate:null,active:null},data));results.push({name:'Cannot create a publisher or candidate state slot',passed:true});
writeFileSync(new URL('./COMPLETION_GATES.json',import.meta.url),JSON.stringify({classification:'SYNTHETIC_OFFLINE_COMPLETION_CHECKS',noDatabase:true,noActivation:true,results},null,2)+'\n');console.log(JSON.stringify({passed:results.length}));
// A source-specific candidate must never replace the main C51 or another source's slot.
const specific={runtimeCandidate:{id:'existing-c51',version:51,successfulSourceCount:9},sourceSpecificRuntimeCandidates:{[sourceId]:{candidateId:id,candidateVersion:53,successfulSources:0,actualCaptureStarted:false},'source-gilead-china-social':{candidateId:'existing-c52',candidateVersion:52,successfulSources:1}},active:{batchId,sourceId,candidateId:id,candidateVersion:53},pendingReadOnlyTerminalSources:[{batchId:'other',sourceId:'other',candidateId:'other',candidateVersion:99,noFurtherProductionWriteInOriginalProcess:true}]};
const specificBefore=structuredClone(specific),specificAfter=applyCandidateCompletion(specific,data);
assert.deepEqual(specific,specificBefore);assert.deepEqual(specificAfter.runtimeCandidate,specificBefore.runtimeCandidate);assert.deepEqual(specificAfter.sourceSpecificRuntimeCandidates['source-gilead-china-social'],specificBefore.sourceSpecificRuntimeCandidates['source-gilead-china-social']);assert.deepEqual(specificAfter.pendingReadOnlyTerminalSources,specificBefore.pendingReadOnlyTerminalSources);assert.equal(specificAfter.sourceSpecificRuntimeCandidates[sourceId].successfulSources,1);assert.equal(specificAfter.sourceSpecificRuntimeCandidates[sourceId].successfulCurrentJobCount,10);assert.equal(specificAfter.active,null);results.push({name:'Source-specific completion preserves C51 main slot, C52 Gilead slot and unrelated pending work',passed:true});
assert.throws(()=>applyCandidateCompletion({...specific,runtimeCandidate:{id,version:53}},data),/EXACT_EXISTING_CANDIDATE_STATE_SLOT_REQUIRED/);results.push({name:'Ambiguous duplicate main and source-specific slots fail closed',passed:true});
const fs=await import('node:fs'),path=await import('node:path');
const runtimeRoot=path.resolve(import.meta.dirname,'..'),sharedRoot=path.resolve(runtimeRoot,'..');
const completionSource=fs.readFileSync(path.join(runtimeRoot,'hosts/novartis-next/host/runtime/complete-reviewed-source-readback.js'),'utf8');
const uniqueState=path.join(sharedRoot,'PUBLISHER-ACTIVE-STATE.json');
assert.equal((completionSource.match(/PUBLISHER-ACTIVE-STATE\.json/g)||[]).length,1);assert(completionSource.includes('const statePath='+JSON.stringify(uniqueState)+';'));assert(!fs.existsSync(path.join(runtimeRoot,'PUBLISHER-ACTIVE-STATE.json')));results.push({name:'Completion points only to original global publisher state; no isolated replacement exists',passed:true});
const starterSource=fs.readFileSync(path.join(runtimeRoot,'hosts/novartis-next/supervision/start-monitor-novartis-next-combined.js'),'utf8');assert(starterSource.includes('--max-old-space-size=256'));assert(starterSource.includes('JOBFINDER_CLOUD_SOURCE_ID='+"\"+h.q(h.cfg.sourceId)+\""));results.push({name:'Actual starter preserves source env indirection and 256MiB limit',passed:true});
writeFileSync(new URL('./COMPLETION_GATES.json',import.meta.url),JSON.stringify({classification:'SYNTHETIC_OFFLINE_COMPLETION_CHECKS',noDatabase:true,noActivation:true,uniquePublisherState:uniqueState,results},null,2)+'\n');console.log(JSON.stringify({passed:results.length}));
