/** One fixed worker's live mutation state. No serialized value restores it. */
export function createMutationFence({batchId,sourceId,nonce,send=process.send?.bind(process)}){
 let attempted=false,sealed=false;
 return Object.freeze({
  revoke(){sealed=true;},
  markMutationAttempt(){if(sealed)throw Error('WORKER_TERMINAL_ALREADY_SEALED');attempted=true;},
  async sealTerminal({exitCode,errorCode=null}){
   if(sealed)throw Error('WORKER_TERMINAL_ALREADY_SEALED');sealed=true;
   if(typeof send!=='function'||typeof nonce!=='string'||!nonce||![0,1].includes(exitCode))return;
   const proof={type:'JOBFINDER_WORKER_TERMINAL_V1',batchId,sourceId,nonce,mutationAttempted:attempted,exitCode,errorCode};
   await new Promise((resolve,reject)=>send(proof,error=>error?reject(error):resolve()));
  }
 });
}
