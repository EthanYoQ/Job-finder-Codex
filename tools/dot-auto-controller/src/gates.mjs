import fs from 'node:fs';
import path from 'node:path';
import {canonical,sha} from './journal.mjs';
export const DEDUPE_MS=12*60*60*1000;
export function requireTime(v,name) {const n=typeof v==='number'?v:Date.parse(v);if(!Number.isSafeInteger(n))throw Error(name);return n;}
export function equal(a,b,code) {if(canonical(a)!==canonical(b))throw Error(code);}
export function verifyScope(route,snapshot,now) {
  if(snapshot.sourceId!==route.sourceId || snapshot.sourceConfigSha256!==route.sourceConfigSha256 || snapshot.route!==route.route)throw Error('FIXED_SOURCE_ROUTE');
  equal(snapshot.candidate,route.candidate,'CURRENT_CANDIDATE_IDENTITY');equal(snapshot.build,route.build,'CURRENT_BUILD_IDENTITY');equal(snapshot.databaseIdentity,route.databaseIdentity,'CURRENT_DATABASE_IDENTITY');
  equal(snapshot.registration,route.registration,'CURRENT_REGISTRATION_16_FIELDS');
  const at=requireTime(snapshot.checkedAt,'CURRENT_READ_TIME');if(at>now || now-at>60000)throw Error('CURRENT_READ_STALE');
}
/** Use the real persisted CrawlObservation.crawledAt, never publish/finishedAt. */
export function dueFromObservation(route,snapshot,now) {
  const o=snapshot.lastAcceptedObservation;
  if(!o)throw Error('ACCEPTED_OBSERVATION_REQUIRED_FIRST_RUN_REVIEW');
  if(o.basis!=='CrawlObservation.crawledAt'||o.sourceId!==route.sourceId||!o.observationId||!o.sourceResultId||!o.batchId)throw Error('REAL_OBSERVATION_REQUIRED');
  const at=requireTime(o.crawledAt,'OBSERVATION_TIME');if(at>now)throw Error('FUTURE_OBSERVATION');
  return {due:now-at>=DEDUPE_MS,observedAt:o.crawledAt,observationId:o.observationId,nextEligibleAt:new Date(at+DEDUPE_MS).toISOString()};
}
export function verifyOriginalFiles(root,manifest) {
  const base=fs.realpathSync(root);if(!Array.isArray(manifest)||!manifest.length)throw Error('ORIGINAL_MANIFEST_REQUIRED');const names=new Set();
  for(const member of manifest){const relative=member.path;if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..')||names.has(relative))throw Error('ORIGINAL_MANIFEST_PATH');names.add(relative);
    let file=base;for(const part of relative.split('/')){file=path.join(file,part);if(fs.lstatSync(file).isSymbolicLink())throw Error('ORIGINAL_SYMLINK');}
    const data=fs.readFileSync(file);if(data.length!==member.byteCount||sha(data)!==member.sha256)throw Error('ORIGINAL_BYTES_CHANGED');
  }
  return {manifestSha256:sha(canonical(manifest)),fileCount:manifest.length};
}
/** Extra controller gate, never a replacement for native compiler/receipt guards. */
export function verifyPublicationEvidence(route,run,proof,now) {
  equal(proof.identity,{sourceId:route.sourceId,sourceConfigSha256:route.sourceConfigSha256,route:route.route,candidate:route.candidate,build:route.build,batchId:run.batchId},'NATIVE_REPLAY_IDENTITY');
  if(proof.schemaVersion!==1||proof.nativeReplay.module!=='runtimeAtomicEvidence.verifyAtomicRuntimeCommitForPersistence'||proof.nativeReplay.route!==route.route)throw Error('NATIVE_REPLAY_REQUIRED');
  if(proof.atomicCompiler!=='ingestionRepository.compileDbStartedCloudSourcePublication'||proof.databaseMutex!=='CrawlCoordinatorLock:formal-crawl:SAME_ATOMIC_DO')throw Error('ORIGINAL_ATOMIC_COMPILER_REQUIRED');
  if(proof.lifecyclePolicy!=='SOURCE_ATOMIC_LAST_GOOD_V1'||proof.ageBasedHide!==false)throw Error('LIFECYCLE_POLICY_CHANGED');
  const fileProof=verifyOriginalFiles(proof.archiveRoot,proof.manifest);equal(fileProof,proof.archiveVerification,'ARCHIVE_MANIFEST_BINDING');
  const sourceObservedAt=requireTime(proof.sourceObservedAt,'SOURCE_OBSERVED_TIME');if(sourceObservedAt<run.startedAt||sourceObservedAt>now)throw Error('SOURCE_OBSERVATION_NOT_CURRENT_RUN');
  const readers=proof.readerReplay;
  if(!readers || readers.schemaVersion!==1 || !readers.deployedIdentity || !readers.mainCodeSha256 || !readers.fallbackCodeSha256 || !readers.readerInputSha256)throw Error('ACTUAL_DEPLOYED_READER_REQUIRED');
  if(readers.clockAt!==proof.sourceObservedAt)throw Error('READER_REAL_OBSERVATION_CLOCK');
  equal(readers.main,readers.fallback,'DEPLOYED_READERS_DISAGREE');
  if(!Array.isArray(readers.main.jobs)||!readers.main.coverage)throw Error('COMPLETE_READER_PROJECTION_REQUIRED');
  const ids=new Set();for(const j of readers.main.jobs){if(!j.id||ids.has(j.id)||typeof j.inGrace!=='boolean')throw Error('READER_JOB_IDENTITY');ids.add(j.id);}
  if(!Array.isArray(readers.priorGrace))throw Error('GRACE_BASELINE_REQUIRED');
  for(const old of readers.priorGrace){const retained=readers.main.jobs.find(j=>j.id===old.id);if(!retained){const removal=proof.nativeLifecycleRemovals?.find(x=>x.id===old.id);if(!removal||!['SUSPECTED_OFFLINE','OFFLINE'].includes(removal.lifecycleStatus)||removal.missingSuccessCount<2||removal.lastSeenAt!==old.lastSeenAt||removal.sourceResultId!==run.batchId+'--'+route.sourceId)throw Error('GRACE_DROPPED_WITHOUT_NATIVE_LIFECYCLE');continue;}if(retained.inGrace)equal(retained,old,'GRACE_FIELDS_OR_REAL_TIME_CHANGED');}
  return {archiveVerification:fileProof,readerProjectionSha256:sha(canonical(readers.main)),readerIdentity:readers.deployedIdentity};
}
export function verifyOriginalTerminal(expected,receipt) {
  if(!receipt || receipt.schemaVersion!==1||receipt.originalSessionId!==expected.originalSessionId||receipt.originalSessionId==null||receipt.raw?.session_id!==undefined||!Number.isInteger(receipt.raw?.exit_code))throw Error('ORIGINAL_EXEC_NOT_TERMINAL');
  if(receipt.bindingSha256!==expected.bindingSha256||receipt.originalLaunchSha256!==expected.originalLaunchSha256||receipt.wrapper?.exitCode!==receipt.raw.exit_code)throw Error('ORIGINAL_EXEC_BINDING');
  if(!Array.isArray(receipt.childChain)||!receipt.childChain.length)throw Error('ORIGINAL_CHILD_CHAIN_REQUIRED');
  for(const child of receipt.childChain)if(child.state!=='TERMINATED'||!Number.isInteger(child.exitCode)||!child.launchSha256||child.reaped!==true)throw Error('ORIGINAL_CHILD_NOT_TERMINAL');
  return {terminal:true,successful:receipt.raw.exit_code===0&&receipt.childChain.every(c=>c.exitCode===0),exitCode:receipt.raw.exit_code};
}
