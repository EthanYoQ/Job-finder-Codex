#!/usr/bin/env node
/** Owns the actual original native worker and original diagnostic wrapper. */
import {observeOwnedChild,acceptOwnedChild,acceptNoMutationFailure,parseOwnedChildResult} from './src/supervisor-child.mjs';
import {withinDeadline} from './src/deadline.mjs';
import {createCompletionControlPlane} from './src/biogen-completion-control-plane.mjs';
import {requirePreparedCompletion} from './src/closure.mjs';
import {loadCatalog} from './src/biogen-catalog.mjs';
import {loadDeployment,assertDeploymentBinding,deploymentBindingEnv,deploymentBindingSha256} from './src/biogen-deployment.mjs';

import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {Journal,canonical,sha} from './src/journal.mjs';import {requireAuthority} from './src/biogen-authority.mjs';import {verifyPins} from './src/native-bindings.mjs';
const ROOT=import.meta.dirname,read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function closeRun(journal,batchId,sourceId,record){assertDeploymentBinding();return journal.recordClosure(batchId,sourceId,record);}
export async function runBiogenSupervisor(){
 const catalog=loadCatalog(),route=catalog.sources.biogen,deployment=loadDeployment();
 if(process.argv.includes('--check')){const pins=route.configured?verifyPins(route):{checked:0,qualification:'NOT_CONFIGURED'};return {status:'INACTIVE_SOURCE_CANDIDATE',...pins,sourceId:route.sourceId,route:route.route,candidate:route.candidate,activation:deployment.activated,implemented:'Biogen native capture, original compiler, packet replay, deployed reader/API gates, one-shot transport, original-process supervisor',remaining:['Secure restricted connection and network verification','Verified persistent authority including cleanup recovery','Current deployed-reader identity attestation','Live startup reconciliation of all prior UNKNOWN/locks/writers','Real end-to-end integration exercise','Remaining source-specific adapters'],routing:catalog.routingCatalogue.map(s=>({sourceId:s.sourceId,route:s.route,status:s.sourceId===route.sourceId?'IMPLEMENTED_INACTIVE_UNVERIFIED_LIVE':'BLOCKED_SOURCE_ADAPTER_NOT_CONNECTED'}))};}
 if(process.argv[2]==='--reconcile'){if(process.argv.length!==4||!/^auto-biogen-[a-f0-9-]{36}$/.test(process.argv[3]))throw Error('ORIGINAL_BATCH_REQUIRED');const observed=await observeOwnedChild({command:route.node,args:['--max-old-space-size=384',ROOT+'/native/biogen-bootstrap.mjs','--reconcile',process.argv[3]],deadline:Date.now()+120000,env:{...process.env,...deploymentBindingEnv(),JOBFINDER_CLOUD_SOURCE_ID:route.sourceId}});let result;try{result=parseOwnedChildResult(observed);}catch{return {status:'HELD_UNREADABLE_RECOVERY_RESULT',batchId:process.argv[3],originalExit:observed.terminal,retryAuthorized:false};}return {...result,recoveryProcess:observed.terminal};}
 if(process.argv.slice(2).join(' ')!=='--run')throw Error('USAGE: run-biogen.mjs --check | --run');
 const authority=requireAuthority(deployment,route);if(route.enabled!==true)throw Error('SOURCE_DISABLED');verifyPins(route);
 // Startup verification cannot invent a fresh authority after cleanup.
 for(const item of ['controller','controller/runs','controller/source-claims','transport','biogen'])if(!fs.lstatSync(path.join(authority.directory,item)).isDirectory())throw Error('AUTHORITY_STRUCTURE_MISSING');
 const journal=new Journal(authority.directory+'/controller'),batchId='auto-biogen-'+randomUUID(),startedAt=Date.now();
 const run={schemaVersion:1,batchId,sourceId:route.sourceId,startedAt,outerDeadline:startedAt+1800000,routeIdentitySha256:sha(canonical(route)),deploymentBindingSha256:deploymentBindingSha256()};journal.put(batchId,'00-run',run);journal.claimSource(route.sourceId,batchId);
 const runDir=path.join(authority.directory,'biogen',batchId);fs.mkdirSync(runDir,{mode:0o700});
 // Immutable pinned source config files are deployment prerequisites, not copied
 // from previous runs or repaired by the runtime controller.
 const wrapper=ROOT+'/native/run-with-ipc-diagnostics.mjs',proofNonce=randomUUID();
 const args=[wrapper,runDir+'/diagnostics',String(Math.max(1,run.outerDeadline-Date.now())),'--',route.node,'--max-old-space-size=384',ROOT+'/native/biogen-bootstrap.mjs'];
 const launch={command:route.node,args,batchId,sourceId:route.sourceId,originalDeadline:run.outerDeadline,deploymentBindingSha256:deploymentBindingSha256()};journal.put(batchId,'20-original-launch',launch);
 const originalObservation=await observeOwnedChild({command:route.node,args,deadline:run.outerDeadline,env:{...process.env,...deploymentBindingEnv(),JOBFINDER_CLOUD_SOURCE_ID:route.sourceId,JOBFINDER_AUTO_BATCH_ID:batchId,JOBFINDER_AUTO_PROOF_NONCE:proofNonce,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
 const {terminal,output}=originalObservation;
 const lifecycle=fs.existsSync(runDir+'/diagnostics/process.jsonl')?fs.readFileSync(runDir+'/diagnostics/process.jsonl','utf8').trim().split('\n').map(s=>JSON.parse(s)):[];
 const started=lifecycle.find(x=>x.event==='CHILD_STARTED'),exited=lifecycle.find(x=>x.event==='CHILD_EXIT');
 const receipt={schemaVersion:1,batchId,launchSha256:sha(canonical(launch)),actualOriginalWrapper:terminal,stdoutSha256:output.stdout.sha256,stderrSha256:output.stderr.sha256,outputCapture:output,childChain:lifecycle};journal.put(batchId,'60-original-terminal',receipt);
 if(lifecycle.some(x=>['SIGNAL_RECEIVED','DEADLINE_REACHED','FORCE_KILL_ATTEMPT'].includes(x.event)))return {status:'HELD_ORIGINAL_EXEC',batchId,retryAuthorized:false};
 if(terminal.exitCode===1&&!terminal.signal&&started&&exited&&exited.childPid===started.childPid&&exited.exitCode===1&&exited.wrapperExitCode===1&&exited.deadlineReached===false&&!lifecycle.some(x=>['SIGNAL_RECEIVED','DEADLINE_REACHED','FORCE_KILL_ATTEMPT'].includes(x.event))){
  try{const proof=acceptNoMutationFailure(originalObservation.token,{command:route.node,args,deadline:run.outerDeadline},{batchId,sourceId:route.sourceId,nonce:proofNonce,childPid:started.childPid});
   // Local failure tombstone only. No database observation/lifecycle is changed.
   return closeRun(journal,batchId,route.sourceId,{status:'FAILED_BEFORE_MUTATION',batchId,releaseEligible:true,newBatchAllowed:true,retryAuthorized:false,errorCode:proof.errorCode,originalWrapperExitCode:1});
  }catch{return {status:'HELD_ORIGINAL_EXEC',batchId,retryAuthorized:false};}
 }
 if(terminal.exitCode!==0||terminal.signal||!started||!exited||exited.childPid!==started.childPid||exited.exitCode!==0||exited.wrapperExitCode!==terminal.exitCode||exited.deadlineReached!==false)return {status:'HELD_ORIGINAL_EXEC',batchId,retryAuthorized:false};
 acceptOwnedChild(originalObservation.token,{command:route.node,args,deadline:run.outerDeadline});
 const prepared=journal.get(batchId,'88-prepared');if(prepared?.batchId!==batchId)return {status:'HELD_MISSING_PREPARED',batchId,retryAuthorized:false};
 if(prepared.status==='PREPARED_NOT_DUE')return closeRun(journal,batchId,route.sourceId,{status:'NOT_DUE',batchId,nextEligibleAt:prepared.nextEligibleAt,releaseEligible:true});
 if(prepared.status!=='PREPARED_COMPLETE'||prepared.dbState!=='COMMITTED_EXACT'||prepared.publicState!=='CURRENT_ALL_FIELDS_PASS')return {status:'HELD_INCOMPLETE',batchId,retryAuthorized:false};
 for(const key of ['30-native-ready','40-dispatch-intent','50-transport','62-native-db-outcome','70-current-public','80-recovery'])if(!journal.get(batchId,key))throw Error('ORIGINAL_RECOVERY_RECORD_MISSING:'+key);
 const recovery=journal.get(batchId,'80-recovery');if(recovery.requestSha256!==prepared.requestSha256||sha(fs.readFileSync(recovery.archivePath))!==recovery.archiveSha256)throw Error('RECOVERY_CHANGED');
 // A separate verified process performs fresh native DB/current web checks and
 // then the still-owning supervisor resolves only after its live terminal proof.
 const completed=await observeOwnedChild({command:route.node,args:['--max-old-space-size=384',ROOT+'/native/biogen-bootstrap.mjs','--verify-completion',batchId],deadline:run.outerDeadline,env:{...process.env,...deploymentBindingEnv(),JOBFINDER_CLOUD_SOURCE_ID:route.sourceId}});
 let result;try{result=parseOwnedChildResult(completed);}catch{return {status:'HELD_COMPLETION_RECONCILIATION',batchId,retryAuthorized:false};}
 if(completed.terminal.exitCode!==0||result.status!=='DB_AND_CURRENT_PUBLIC_RECONCILED')return {...result,status:result.status??'HELD_COMPLETION_RECONCILIATION',retryAuthorized:false};
 acceptOwnedChild(originalObservation.token,{command:route.node,args,deadline:run.outerDeadline});
 requirePreparedCompletion(journal,batchId,route);
 assertDeploymentBinding();
 const controlPlane=await withinDeadline(()=>createCompletionControlPlane({route,deployment}),run.outerDeadline);
 if(result.requestSha256!==prepared.requestSha256)throw Error('FINAL_READBACK_IDENTITY');
 acceptOwnedChild(originalObservation.token,{command:route.node,args,deadline:run.outerDeadline});
 assertDeploymentBinding();
 const resolution=await controlPlane.resolveCommitted(result.requestId,result.requestSha256,{deadline:run.outerDeadline});
 if(Date.now()>=run.outerDeadline)throw Error('ORIGINAL_COMPLETION_DEADLINE');
 assertDeploymentBinding();
 journal.put(batchId,'89-remote-resolution',resolution);
 return closeRun(journal,batchId,route.sourceId,{status:'VERIFIED_COMPLETE',batchId,releaseEligible:true,originalWrapperExitCode:0,requestSha256:prepared.requestSha256,retryAuthorized:false,remoteResolution:resolution});
}
try{const result=await runBiogenSupervisor();console.log(JSON.stringify(result));if(!['INACTIVE_SOURCE_CANDIDATE','VERIFIED_COMPLETE','NOT_DUE'].includes(result.status))process.exitCode=75;}catch(error){console.error(JSON.stringify({status:'BLOCKED',code:error.message,retryAuthorized:false}));process.exitCode=1;}
