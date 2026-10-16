/** Synthetic protocol additions for the existing full-composition V8 harness.
 * These run the actual body close gates against synthetic classification and
 * durable-close receipts; they do not establish real filesystem/SQL authority.
 * Supported names: known-not-dispatched, known-may-have-been-sent,
 * known-signal, known-half-frame. No ambient tools or disk writes are used.
 */
import assert from 'node:assert/strict';
export function withKnownNotDispatchedScenarios(harness){
 // Synthetic exact KNOWN_NOT_DISPATCHED receipts. The original body performs
 // all close checks; these ports do not exercise Python/filesystem classification.
 harness=harness.replace("if(k==='PUBLISH')queued(frame('REVIEW_CONSUMED'));", "if(k==='PUBLISH'){if(name.startsWith('known-'))offset=Date.parse(requests.PUBLISH.expiresAt)-Date.now()+1;else queued(frame('REVIEW_CONSUMED'));}");
 const expire="else if(op==='expire-undispatched'){value={settled:false,reason:'DISPATCH_UNCERTAIN',requestId:args2[1]};}";
 assert.equal(harness.split(expire).length,2);
 harness=harness.replace(expire,`else if(op==='expire-undispatched'){
  if(name.startsWith('known-')){
   const r=requests.PUBLISH;assert(publishCalls===0,'KNOWN_NO_OFFICIAL_CALL');
   files.set(DIR+'/'+r.requestId+'.dispatch.json',JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:'PUBLISH',state:name==='known-may-have-been-sent'?'MAY_HAVE_BEEN_SENT':'NOT_DISPATCHED'}));
   files.set(DIR+'/'+r.requestId+'.response.json',JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:'PUBLISH',result:{status:'FAILED',outcome:'NOT_DISPATCHED'}}));
   stage=null;ended=true;queue.push({session_id:701,exit_code:1,output:frame('CHILD_TERMINAL',{exitCode:1,signal:name==='known-signal'?'SIGTERM':null})+(name==='known-half-frame'?'JOBFINDER_OWNED_PIPE_V1 {':'')});
   value={settled:true};
  }else value={settled:false,reason:'DISPATCH_UNCERTAIN',requestId:args2[1]};
 }`);
 const packetBranch="  if(cmd.includes(\" 'read-publication-data' '\"))";
 assert.equal(harness.split(packetBranch).length,2);
 harness=harness.replace(packetBranch,`  if(cmd.includes(" 'read-dispatch-state' '"))return {exit_code:0,output:JSON.stringify({kind:'FIXED_DISPATCH_CLASSIFICATION',publicationState:name==='known-may-have-been-sent'?'MAY_HAVE_BEEN_SENT':'KNOWN_NOT_DISPATCHED',roundId,seed,requestId:pub.requestId,requestSha256:pub.requestSha256,originalPublishExpiresAt:pub.expiresAt,newRoundAllowed:false,grantsAuthority:false,markerSha256:sha(files.get(DIR+'/'+pub.requestId+'.dispatch.json')),responseSha256:sha(files.get(DIR+'/'+pub.requestId+'.response.json')),recoveryDataSha256:'d'.repeat(64)})};
  if(cmd.includes(" 'close-known-not-dispatched' '")){const i=input();assert(i.originalSessionId===701&&i.wrapperExitCode===1&&i.childExitCode===1&&i.childSignal===null&&!i.publicationInvoked&&!i.publicationPromisePresent&&i.terminalIntegrity==='EXACT_NATURAL_TERMINAL'&&publishCalls===0,'EXACT_KNOWN_TERMINAL_INPUT');return {exit_code:0,output:JSON.stringify({kind:'FIXED_KNOWN_NOT_DISPATCHED_CLOSED',roundId,seed,requestId:pub.requestId,requestSha256:pub.requestSha256,terminalReceiptSha256:'e'.repeat(64),oldPublicationCalls:0,newSuccessRecorded:false,oldFailurePreserved:true,oldPermitRestored:false})};}
`+packetBranch);

 return harness;
}
