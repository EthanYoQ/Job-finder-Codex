// Local state update only, after the exact read-only completion checks.
import {readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
function identity(record){
 if(!record||typeof record!=='object')return {};
 if(record.id!==undefined&&record.candidateId!==undefined&&record.id!==record.candidateId)return {invalid:true};
 if(record.version!==undefined&&record.candidateVersion!==undefined&&record.version!==record.candidateVersion)return {invalid:true};
 return {id:record.candidateId??record.id,version:record.candidateVersion??record.version};
}
export function applyCandidateCompletion(state,data){
 const v=data?.summary,b=data?.binding,t=data?.terminal;
 if(v?.state!=='COMMITTED_EXACT'||b?.status!=='REGISTERED_VERIFIED'||!b.candidate||v.candidateId!==b.candidate.id||v.candidateVersion!==b.candidate.version||!Number.isSafeInteger(v.candidateVersion)||v.candidateVersion<1)throw Error('COMPLETION_REGISTERED_BINDING_REQUIRED');
 if(t?.exit_code!==0||t.session_id!==undefined||!Number.isSafeInteger(t.originalSessionId))throw Error('ACTUAL_ORIGINAL_ZERO_EXIT_REQUIRED');
 if(!Number.isSafeInteger(data.sourceCount)||data.sourceCount<1||!Number.isSafeInteger(data.jobCount)||data.jobCount<0)throw Error('COMPLETION_COUNTS_INVALID');
 const matching=record=>{const x=identity(record);return !x.invalid&&x.id===v.candidateId&&x.version===v.candidateVersion;};
 const main=matching(state.runtimeCandidate),specific=matching(state.sourceSpecificRuntimeCandidates?.[v.sourceId]);
 if(Number(main)+Number(specific)!==1)throw Error('EXACT_EXISTING_CANDIDATE_STATE_SLOT_REQUIRED');
 const task=item=>{if(!item||item.batchId!==v.batchId||item.sourceId!==v.sourceId)return false;const x=identity(item);return !x.invalid&&(x.id===undefined||x.id===v.candidateId)&&(x.version===undefined||x.version===v.candidateVersion);};
 const active=task(state.active),pending=state.pendingReadOnlyTerminalSources??[];
 if(!active&&!pending.some(item=>task(item)&&item.noFurtherProductionWriteInOriginalProcess===true))throw Error('EXACT_EXISTING_COMPLETION_TASK_REQUIRED');
 const out=structuredClone(state),slot=main?out.runtimeCandidate:out.sourceSpecificRuntimeCandidates[v.sourceId];
 if(main)slot.successfulSourceCount=data.sourceCount;else{slot.successfulSources=data.sourceCount;slot.actualCaptureStarted=true;}
 slot.successfulCurrentJobCount=data.jobCount;
 if(active)out.active=null;
 out.pendingReadOnlyTerminalSources=pending.filter(item=>!task(item));
 out.latestCompletedContinuation=v;out.updatedAt=new Date().toISOString();
 const evidence=out.privateEvidencePendingSuccessfulBatches??[];
 const old=evidence.find(item=>item.batchId===v.batchId);
 if(old&&(old.sourceId!==v.sourceId||old.candidateId!==v.candidateId||old.candidateVersion!==v.candidateVersion))throw Error('COMPLETION_EVIDENCE_TUPLE_CONFLICT');
 if(!old)evidence.push({...v,run:data.run});out.privateEvidencePendingSuccessfulBatches=evidence;
 return out;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [path,json,...extra]=process.argv.slice(2);if(!path||!json||extra.length)throw Error('COMPLETION_STATE_ARGUMENTS');
 const before=readFileSync(path,'utf8'),after=applyCandidateCompletion(JSON.parse(before),JSON.parse(json));
 const temp=path+'.completion-'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(after,null,2)+'\n',{flag:'wx',mode:0o600});
 if(readFileSync(path,'utf8')!==before){unlinkSync(temp);throw Error('COMPLETION_STATE_CHANGED');}
 renameSync(temp,path);console.log(JSON.stringify({status:'EXACT_CANDIDATE_LOCAL_STATE_UPDATED'}));
}
