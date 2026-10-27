// Completed batches only. No producer launch, SQL dispatch, or upload capability.
async function resumeCommittedTail({verifyCommitted,readback,verifyUploaded}) {
 let proof;
 try {proof=await verifyCommitted();} catch(error) {return {status:'HELD',reason:'COMMITTED_TAIL_PROOF_INCOMPLETE',diagnostic:String(error)};}
 if(proof?.state!=='COMMITTED_EXACT')return {status:'HELD',reason:'UNKNOWN_PUBLICATION'};
 if(proof.webVerified&&proof.backupVerified)return {status:'PREVIOUS_TAIL_VERIFIED',newCollection:false,newWebReadback:false,newBackupReadback:false};
 let web;
 try {web=await readback();} catch(error) {return {status:'HELD',reason:'WEB_READBACK_FAILED',committedExact:true,diagnostic:String(error)};}
 if(proof.backupVerified)return {...web,evidenceBackup:{status:'PREVIOUS_REMOTE_RESTORE_VERIFIED'}};
 if(proof.backupUploaded){
  try{return {...web,evidenceBackup:await verifyUploaded()};}
  catch(error){return {...web,evidenceBackup:{status:'PENDING',stage:'READBACK',reason:String(error)}};}
 }
 return {...web,evidenceBackup:{status:'PENDING',stage:proof.backupStarted?'UNKNOWN_UPLOAD_READONLY_RECONCILE':'NOT_UPLOADED',automaticRetry:false}};
}
return {resumeCommittedTail};
