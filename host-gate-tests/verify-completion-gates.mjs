import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {applyCandidateCompletion} from '../hosts/kelun/host/runtime/update-candidate-completion-state.mjs';
const id='synthetic-only-kelun-new-host',sourceId='source-kelun-social',batchId='synthetic-only-completion';
const state={runtimeCandidate:{id,version:52},active:{batchId,sourceId,candidateId:id,candidateVersion:52}};
const data={summary:{state:'COMMITTED_EXACT',candidateId:id,candidateVersion:52,sourceId,batchId},binding:{status:'REGISTERED_VERIFIED',candidate:{id,version:52},build:{commitSha:'239def3a29c9270d706425c810eb4a85d452fa1c'}},terminal:{exit_code:0,originalSessionId:10},sourceCount:1,jobCount:10,run:'synthetic-only'};
const before=structuredClone(state);assert.equal(applyCandidateCompletion(state,data).active,null);assert.deepEqual(state,before);
const results=[{name:'Matching synthetic new candidate completes only existing owner state slot without mutating input',passed:true}];
for(const [name,mutate] of [
 ['old C51 version',d=>{d.summary.candidateVersion=51;d.binding.candidate.version=51;}],
 ['old producer commit',d=>{d.binding.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';}],
 ['nonzero original exit',d=>{d.terminal.exit_code=1;}],
 ['running original session',d=>{d.terminal.session_id=10;}],
 ['unregistered binding',d=>{d.binding.status='UNREGISTERED_NOT_ACTIVATED';}],
 ['candidate tuple mismatch',d=>{d.summary.candidateId='wrong';}]
]){const d=structuredClone(data);mutate(d);assert.throws(()=>applyCandidateCompletion(state,d));results.push({name,passed:true});}
assert.throws(()=>applyCandidateCompletion({runtimeCandidate:null,active:null},data));results.push({name:'Cannot create a publisher or candidate state slot',passed:true});
writeFileSync(new URL('./COMPLETION_GATES.json',import.meta.url),JSON.stringify({classification:'SYNTHETIC_OFFLINE_COMPLETION_CHECKS',noDatabase:true,noActivation:true,results},null,2)+'\n');console.log(JSON.stringify({passed:results.length}));
