import {spawn} from 'node:child_process';
import {canonical} from './journal.mjs';
const receipts=new WeakMap();
function protocolInvalid(r){return r.messages.length>1||r.messages.some(m=>m?.type!=='JOBFINDER_WRAPPER_TERMINAL_V1'||m.wrapperPid!==r.pid||!Number.isSafeInteger(m.childPid)||m.proof?.type!=='JOBFINDER_WORKER_TERMINAL_V1');}
function receiptFor(token,expected){const r=receipts.get(token);if(!r||canonical(r.launch)!==canonical(expected)||!Number.isFinite(r.observedAt)||r.observedAt>=r.launch.deadline||r.stopRequested||r.terminal.signal||r.terminal.error)throw Error('LIVE_OWNED_CHILD_TERMINAL_REQUIRED');return r;}
export function acceptNoMutationFailure(token,expected,{batchId,sourceId,nonce,childPid}){const r=receiptFor(token,expected),m=r.messages.length===1?r.messages[0]:null,p=m?.proof;if(r.terminal.exitCode!==1||m?.type!=='JOBFINDER_WRAPPER_TERMINAL_V1'||m.wrapperPid!==r.pid||m.childPid!==childPid||!p||Object.keys(p).sort().join(',')!=='batchId,errorCode,exitCode,mutationAttempted,nonce,sourceId,type'||p.type!=='JOBFINDER_WORKER_TERMINAL_V1'||p.batchId!==batchId||p.sourceId!==sourceId||p.nonce!==nonce||p.mutationAttempted!==false||p.exitCode!==1)throw Error('LIVE_PREMUTATION_FAILURE_REQUIRED');return {exitCode:1,errorCode:typeof p.errorCode==='string'&&/^[A-Z0-9_]{1,80}$/.test(p.errorCode)?p.errorCode:'NATIVE_WORKER_FAILED',mutationAttempted:false};}
export function acceptOwnedChild(token,expected){const receipt=receipts.get(token);if(!receipt||canonical(receipt.launch)!==canonical(expected)||!Number.isFinite(receipt.observedAt)||receipt.observedAt>=receipt.launch.deadline||receipt.terminal.exitCode!==0||receipt.stopRequested||protocolInvalid(receipt)||receipt.terminal.signal||receipt.terminal.error)throw Error('LIVE_OWNED_CHILD_TERMINAL_REQUIRED');return structuredClone(receipt);}
/** Real held ChildProcess, absolute parent budget, no persisted PID signalling. */
export async function observeOwnedChild({command,args,deadline,env=process.env}){
 const now=Date.now;
 if(!Number.isSafeInteger(deadline)||now()>=deadline)throw Error('ORIGINAL_SUPERVISOR_DEADLINE');
 const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe','ipc'],detached:true});let stdout='',stderr='',reaped=false,stopRequested=false,stopTimer;const messages=[];child.on('message',message=>{if(messages.length<2){try{if(JSON.stringify(message).length<=4096)messages.push(structuredClone(message));else messages.push(null);}catch{messages.push(null);}}});
 child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
 const kill=signal=>{if(!reaped&&child.pid){stopRequested=true;try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}}};
 const timer=setTimeout(()=>kill('SIGKILL'),Math.max(1,deadline-now()));
 const onStop=()=>{kill('SIGTERM');stopTimer??=setTimeout(()=>kill('SIGKILL'),Math.max(1,Math.min(1000,deadline-now())));};
 process.on('SIGTERM',onStop);process.on('SIGINT',onStop);
 try{const terminal=await new Promise(resolve=>{let error;child.once('error',e=>{error=e.code??'SPAWN_ERROR';});child.once('close',(exitCode,signal)=>resolve({exitCode,signal,error}));});reaped=true;const token=Object.freeze({}),observedAt=now();receipts.set(token,{launch:{command,args,deadline},terminal,observedAt,messages,pid:child.pid,stopRequested});return {terminal,stdout,stderr,observedAt,deadline,token};}
 finally{clearTimeout(timer);clearTimeout(stopTimer);process.removeListener('SIGTERM',onStop);process.removeListener('SIGINT',onStop);}
}
