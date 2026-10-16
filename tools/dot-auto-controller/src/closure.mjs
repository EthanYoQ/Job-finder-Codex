import fs from 'node:fs';
import {canonical,sha} from './journal.mjs';
/** Retained evidence consistency only. This function cannot authorize release.
 * The supervisor additionally requires an in-memory actual ChildProcess token.
 * A restart cannot recover the live terminal capability and stays held.
 */
export function requireOriginalEvidence(journal,batchId,route){
 const get=k=>{const v=journal.get(batchId,k);if(!v)throw Error('ORIGINAL_RECOVERY_RECORD_MISSING:'+k);return v;};
 const run=get('00-run'),launch=get('20-original-launch'),terminal=get('60-original-terminal');
 if(run.batchId!==batchId||run.sourceId!==route.sourceId||run.routeIdentitySha256!==sha(canonical(route))||launch.batchId!==batchId||launch.command!==route.node||launch.sourceId!==route.sourceId||launch.originalDeadline!==run.outerDeadline||terminal.batchId!==batchId||terminal.launchSha256!==sha(canonical(launch)))throw Error('ORIGINAL_TERMINAL_IDENTITY');
 const t=terminal.actualOriginalWrapper,chain=terminal.childChain;
 if(t?.exitCode!==0||t.signal||!Array.isArray(chain))throw Error('ORIGINAL_EXEC_NOT_SUCCESSFUL');
 const starts=chain.filter(x=>x.event==='CHILD_STARTED'),exits=chain.filter(x=>x.event==='CHILD_EXIT');
 if(starts.length!==1||exits.length!==1||exits[0].childPid!==starts[0].childPid||exits[0].exitCode!==0||exits[0].wrapperExitCode!==0||exits[0].deadlineReached!==false)throw Error('ORIGINAL_CHILD_CHAIN_REQUIRED');
 return {run,launch,terminal};
}
export function requirePreparedCompletion(journal,batchId,route){
 const terminal=requireOriginalEvidence(journal,batchId,route);
 const get=k=>{const v=journal.get(batchId,k);if(!v)throw Error('ORIGINAL_RECOVERY_RECORD_MISSING:'+k);return v;};
 const prepared=get('88-prepared'),ready=get('30-native-ready'),intent=get('40-dispatch-intent'),recovery=get('80-recovery');
 for(const k of ['50-transport','62-native-db-outcome','70-current-public'])get(k);
 const request=ready.request,requestSha256=verifyOriginalPublishRequest(request);
 if(prepared.status!=='PREPARED_COMPLETE'||prepared.batchId!==batchId||prepared.sourceId!==route.sourceId||prepared.dbState!=='COMMITTED_EXACT'||prepared.publicState!=='CURRENT_ALL_FIELDS_PASS'||prepared.requestSha256!==requestSha256||intent.requestId!==request.requestId||intent.requestSha256!==requestSha256||recovery.requestSha256!==requestSha256||recovery.sqlSha256!==sha(request.payload.sql)||recovery.originalDeadline!==terminal.run.outerDeadline)throw Error('PREPARED_COMPLETION_NOT_EXACT');
 if(!recovery.archivePath||fs.lstatSync(recovery.archivePath).isSymbolicLink()||sha(fs.readFileSync(recovery.archivePath))!==recovery.archiveSha256)throw Error('RECOVERY_CHANGED');
 return {...terminal,prepared,ready,intent,recovery};
}

export function verifyOriginalPublishRequest(request){if(request.kind!=='PUBLISH'||Object.keys(request).sort().join(',')!=='expiresAt,kind,payload,requestId,requestSha256,schemaVersion'||Object.keys(request.payload).sort().join(',')!=='dispatchBefore,projectId,sql')throw Error('ORIGINAL_REQUEST_SHAPE');const body={schemaVersion:request.schemaVersion,requestId:request.requestId,kind:request.kind,expiresAt:request.expiresAt,payload:{projectId:request.payload.projectId,sql:request.payload.sql,dispatchBefore:request.payload.dispatchBefore}};if(sha(JSON.stringify(body))!==request.requestSha256)throw Error('ORIGINAL_REQUEST_SHA');return request.requestSha256;}
