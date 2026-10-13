/** No shell/PTY/socket. Child stdout and stderr are private diagnostics, not proof. */
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {validateLaunch,validateGateMessage,makeFrame} from './pipe-protocol.mjs';
export function superviseOwnedProducer({command,args,cwd,env,launch,stdoutPath,stderrPath,emit,mode='DISABLED'}){
 if(mode!=='TEST_ONLY'||typeof command!=='string'||!Array.isArray(args)||typeof emit!=='function')throw Error('PIPE_REAL_LAUNCH_DISABLED');
 const b=validateLaunch(launch),out=openSync(stdoutPath,'wx',0o600),err=openSync(stderrPath,'wx',0o600);
 let sequence=0,reviewSeen=false,closed=false,protocolFailed=false;
 const frame=(event,detail)=>emit(makeFrame(sequence++,event,b,detail));
 const child=spawn(command,args,{cwd,env,stdio:['ignore',out,err,'ipc'],detached:false});
 // Only events on this exact ChildProcess IPC channel are observed; no pid lookup,
 // log reader, file receipt, external socket, or caller-provided message handler.
 child.once('spawn',()=>frame('STARTED'));
 child.on('message',m=>{
  if(closed||protocolFailed)return;
  try{
   if(reviewSeen)throw Error('PIPE_DUPLICATE_REVIEW');
   const reviewed=validateGateMessage(m,b,Date.now());reviewSeen=true;emit(makeFrame(sequence++,'REVIEW_CONSUMED',reviewed));
  }catch{protocolFailed=true;frame('PROTOCOL_HOLD');/* Retain actual child handle until original close; no new kill/restart. */}
 });
 const terminal=new Promise(resolve=>{
  child.once('error',()=>{protocolFailed=true;});
  child.once('close',(exitCode,signal)=>{
   closed=true;closeSync(out);closeSync(err);frame('CHILD_TERMINAL',{exitCode,signal});
   resolve(Object.freeze({exitCode,signal,reviewSeen,protocolFailed,actualChildClosed:true}));
  });
 });
 return Object.freeze({terminal});
}
