/** Synthetic owned child; never loads producer, network or database code. */
import {createMutationFence} from '../src/mutation-fence.mjs';
const mode=process.argv[2],batchId=process.env.JOBFINDER_AUTO_BATCH_ID,sourceId=process.env.JOBFINDER_CLOUD_SOURCE_ID,nonce=process.env.JOBFINDER_AUTO_PROOF_NONCE;
const fence=createMutationFence({batchId:mode==='wrong-batch'?'other':batchId,sourceId,nonce});
if(mode==='mutated')fence.markMutationAttempt();
if(mode!=='missing')await fence.sealTerminal({exitCode:mode==='wrapper-stop-success'?0:1,errorCode:'SYNTHETIC_PREFLIGHT_FAILED'});
if(mode==='duplicate')await new Promise(resolve=>process.send({type:'JOBFINDER_WORKER_TERMINAL_V1'},()=>resolve()));
if(mode==='wrapper-stop'||mode==='wrapper-stop-success'){const wait=setInterval(()=>{},1000);process.once('SIGTERM',()=>{clearInterval(wait);process.exitCode=mode==='wrapper-stop-success'?0:1;});process.kill(process.ppid,'SIGTERM');}
else if(mode==='killed'){setInterval(()=>{},1000);}else process.exitCode=1;
