// All DB/tool/state boundaries are synthetic; no real publisher state is read.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyCandidateCompletion} from './host/runtime/update-candidate-completion-state.mjs';
const base=dirname(fileURLToPath(import.meta.url)),code=readFileSync(join(base,'host/runtime/complete-reviewed-source-readback.js'),'utf8');
const ns='deadlineCandidate47b:grifols:',A=Object.getPrototypeOf(async function(){}).constructor,checks=[];
const sourceId='source-grifols-china-social',batch='synthetic-completion',candidateId='synthetic-registered-candidate',candidateVersion=73;
const binding={status:'REGISTERED_VERIFIED',candidate:{id:candidateId,version:candidateVersion,goalId:'jobfinder-portable-required-40'}};
const src={id:batch+'--'+sourceId,releaseCandidateId:candidateId,sourceId,sourceConfigHash:'f'.repeat(64),startedAt:'2026-10-06T00:00:00Z',finishedAt:'2026-10-06T00:01:00Z',rawCount:8,dedupeOutputCount:7,canonicalCurrentJobSetSha256:'a'.repeat(64),completenessCertificateSha256:'b'.repeat(64)};
const observation={id:'synthetic-observation',sourceResultId:src.id,sourceId,batchId:batch,releaseCandidateId:candidateId,sourceConfigSha256:src.sourceConfigHash,observedFrom:src.startedAt,observedTo:src.finishedAt,crawledAt:'2026-10-06T00:00:30Z',successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
const receipt={checkedAt:'2026-10-06T00:02:00Z',row:{...src,batchId:batch,atomicCommitState:'COMMITTED',completenessState:'VERIFIED'},batch:{id:batch,releaseCandidateId:candidateId,status:'SUCCESS',finishedAt:'2026-10-06T00:01:00Z'},holderId:'',observations:[observation],successfulSourceCount:2,successfulCurrentJobCount:14};
async function run(mode='good'){
 const values=new Map([[ns+'refreshCurrentRun','/synthetic/host/'+batch],[ns+'refreshCurrentBatch',batch],[ns+'registeredCandidateBinding',structuredClone(binding)],[ns+'publicationReview',{sourceResult:structuredClone(src)}],[ns+'refreshSession',123],[ns+'lastPortableExecPoll',{originalSessionId:123,exit_code:0}]]);
 const row=structuredClone(receipt),calls={sql:0,saves:0,state:0,output:[]};let data;
 if(mode==='running')values.set(ns+'lastPortableExecPoll',{originalSessionId:123,session_id:123});
 if(mode==='unknown')values.set(ns+'lastPortableExecPoll',{originalSessionId:123,classification:'UNKNOWN'});
 if(mode==='nonzero')values.set(ns+'lastPortableExecPoll',{originalSessionId:123,exit_code:1});
 if(mode==='other-session')values.set(ns+'lastPortableExecPoll',{originalSessionId:999,exit_code:0});
 if(mode==='contradictory-terminal')values.set(ns+'lastPortableExecPoll',{originalSessionId:123,exit_code:0,session_id:123});
 if(mode==='unregistered')values.get(ns+'registeredCandidateBinding').status='UNREGISTERED';
 if(mode==='review-candidate')values.get(ns+'publicationReview').sourceResult.releaseCandidateId='other';
 if(mode==='zero-write')row.row=null;
 if(mode==='batch-not-success')row.batch.status='RUNNING';
 if(mode==='wrong-batch-candidate')row.batch.releaseCandidateId='other';
 if(mode==='hash-mismatch')row.row.canonicalCurrentJobSetSha256='0'.repeat(64);
 if(mode==='holder-busy')row.holderId='other';
 if(mode==='observation-flags')row.observations[0].atomicCommitSucceeded=false;
 if(mode==='observation-tuple')row.observations[0].releaseCandidateId='other';
 if(mode==='observation-window')row.observations[0].crawledAt='2026-10-06T00:03:00Z';
 const h={cfg:{root:'/synthetic/host',sourceId,sourceConfigSha256:src.sourceConfigHash,project:'SYNTHETIC_ONLY'},q:value=>{if(String(value).startsWith('{'))data=JSON.parse(value);return "'"+String(value).replaceAll("'","''")+"'";},rows:x=>x,save:async()=>{calls.saves++;},cmd:async()=>{calls.state++;return 'SYNTHETIC_STATE_ONLY';}};
 globalThis.__completionFixture=()=>h;
 let error;try{await new A('load','tools','text',code)(k=>k.endsWith('cloudPilotHostHelpers')?'return __completionFixture();':values.get(k),{mcp__codex_apps__supabase_execute_sql:async request=>{calls.sql++;assert.equal(request.project_id,'SYNTHETIC_ONLY');assert.match(request.query,/^WITH latest AS/);assert.doesNotMatch(request.query,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/);return [row];}},x=>calls.output.push(x));}catch(e){error=e;}finally{delete globalThis.__completionFixture;}
 return {calls,error,data};
}
const good=await run();assert.equal(good.error,undefined);assert.equal(good.calls.sql,1);assert.equal(good.calls.state,1);assert.equal(good.calls.output[0].candidateVersion,candidateVersion);assert.equal(good.calls.output[0].candidateId,candidateId);checks.push('exact-read-only-completion-uses-registered-version');
for(const mode of ['running','unknown','nonzero','other-session','contradictory-terminal','unregistered','review-candidate','zero-write','batch-not-success','wrong-batch-candidate','hash-mismatch','holder-busy','observation-flags','observation-tuple','observation-window']){
 const result=await run(mode);assert.ok(result.error,mode);assert.equal(result.calls.state,0);assert.equal(result.calls.output.length,0);assert.equal(result.calls.saves,0);checks.push('reject-'+mode);
 if(['running','unknown','nonzero','other-session','contradictory-terminal','unregistered','review-candidate'].includes(mode))assert.equal(result.calls.sql,0);
}
const task={batchId:batch,sourceId,candidateId,candidateVersion};
const oldUnknown={batchId:'old-UNKNOWN',sourceId,candidateId:'old-candidate',candidateVersion:46,outcome:'UNKNOWN',noFurtherProductionWriteInOriginalProcess:true};
const state={active:task,pendingReadOnlyTerminalSources:[oldUnknown],runtimeCandidate:{candidateId,candidateVersion,successfulSourceCount:1,successfulCurrentJobCount:7},sourceSpecificRuntimeCandidates:{other:{candidateId:'other-candidate',candidateVersion:88,successfulSources:9}},unknownOutcomes:[oldUnknown],sourceExecutionHolds:{legacy:{reason:"HISTORICAL_UNKNOWN_DO_NOT_CLEAR",batchId:oldUnknown.batchId}}};
const before=structuredClone(state),main=applyCandidateCompletion(state,good.data);
assert.deepEqual(state,before);assert.equal(main.runtimeCandidate.successfulSourceCount,2);assert.deepEqual(main.sourceSpecificRuntimeCandidates,before.sourceSpecificRuntimeCandidates);assert.deepEqual(main.unknownOutcomes,before.unknownOutcomes);assert.deepEqual(main.pendingReadOnlyTerminalSources,[oldUnknown]);assert.deepEqual(main.sourceExecutionHolds,before.sourceExecutionHolds);checks.push('main-slot-only-and-old-unknown-and-holds-preserved');
const specific={...before,active:oldUnknown,pendingReadOnlyTerminalSources:[oldUnknown,{...task,noFurtherProductionWriteInOriginalProcess:true}],runtimeCandidate:{candidateId:'other-main',candidateVersion:46,successfulSourceCount:40,successfulCurrentJobCount:999},sourceSpecificRuntimeCandidates:{[sourceId]:{candidateId,candidateVersion,successfulSources:1,successfulCurrentJobCount:7},other:{candidateId:'other',candidateVersion:88,successfulSources:9}}};
const updated=applyCandidateCompletion(specific,good.data);assert.deepEqual(updated.runtimeCandidate,specific.runtimeCandidate);assert.deepEqual(updated.active,oldUnknown);assert.deepEqual(updated.pendingReadOnlyTerminalSources,[oldUnknown]);assert.equal(updated.sourceSpecificRuntimeCandidates[sourceId].successfulSources,2);assert.deepEqual(updated.sourceSpecificRuntimeCandidates.other,specific.sourceSpecificRuntimeCandidates.other);checks.push('source-specific-slot-only-and-unrelated-active-preserved');
for(const [name,mutate] of [
 ['wrong-version',s=>{s.runtimeCandidate.candidateVersion=74;}],
 ['no-slot',s=>{s.runtimeCandidate.candidateId='other';}],
 ['ambiguous-slot',s=>{s.sourceSpecificRuntimeCandidates[sourceId]={candidateId,candidateVersion};}],
 ['no-current-task',s=>{s.active=oldUnknown;}],
 ['conflicting-aliases',s=>{s.runtimeCandidate.id='other';}]
 ]){const s=structuredClone(before);mutate(s);const snapshot=structuredClone(s);assert.throws(()=>applyCandidateCompletion(s,good.data));assert.deepEqual(s,snapshot);checks.push('state-reject-'+name);}
console.log(JSON.stringify({status:'PASS_COMPLETION_BINDING_SYNTHETIC_ONLY',checks,databaseCallsActuallyExecuted:0,actualPublisherStateRead:false,actualPublisherStateWritten:false}));
