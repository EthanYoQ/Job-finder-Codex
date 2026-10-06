/** Fresh HTTP refresh for the unchanged source configurations registered by SQL47.
 * Restored from the successful Qilu/UCB runner; uses the existing relay and compiler.
 * The publisher owns candidate registration and every relay dispatch.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runDbStartedCloudPublication } from "../src/crawler/cloudDbStartedPilot";
import { z } from "zod";
import { archiveSourceEvidence } from "../src/crawler/artifactArchive";
import { FilePilotRelay, PILOT_BUDGET, acquireCloudPilotLease, makeArchiveBundle, restoreArchiveBundle, reviveUtcFields, sha256 } from "../src/crawler/cloudSourcePilotRelay";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../src/crawler/runtimeAtomicEvidence";
import { SOURCE_QUALITY_POLICY_ID, createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission, verifySourceQualityReceipt } from "../src/crawler/sourceQualityAdmission";
import { runSourceCrawl, createSourceFetchAttemptTracker, type SourceCrawlResult, type SourceFetchAttemptTracker } from "../src/crawler/runSourceCrawl";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../src/crawler/sourcePlan";
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from "../src/crawler/officialHttpRuntimeLimits";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import { hashCanonicalStringSet } from "../src/crawler/runtimeBatchIdentity";
import { getPortableCoverageScope } from "../src/release/portableCoveragePolicy";
import { compilePortableAtomicSourceEvidenceSql } from "../src/db/ingestionRepository";
import { CLOUD_PILOT_SOURCE } from "../src/db/cloudPilotSqlControl";
import { PILOT_SOURCE, loadPilotContext, preservePilotFailure, reconcilePilotPublication, selectedPilotIdentity } from "./p0-cloud-source-pilot";

export const PORTABLE_REFRESH_SOURCE_IDS = Object.freeze([
  "source-boehringer-ingelheim-china-social", "source-fosun-pharma-social",
  "source-hansoh-social", "source-hengrui-social", "source-viatris-social",
  "source-kelun-social", "source-novartis-social", "source-takeda-china-social",
  "source-cspc-social", "source-gilead-china-social", "source-novo-nordisk-china-social",
  "source-organon-china-social", "source-biogen-china-social", "source-merck-china-social",
  "source-bms-china-social", "source-ucb-china-social", "source-grifols-china-social",
  "source-abbvie-china-social", "source-qilu-social", "source-astellas-china-social"
]);
export function assertPortableRefreshPlan(plan:SourceCrawlPlan):void {
  if (!PORTABLE_REFRESH_SOURCE_IDS.includes(plan.source.id)) throw Error("PILOT_PORTABLE_REFRESH_SOURCE_NOT_ALLOWED");
  if (getSourceQualityPolicy(plan)!==SOURCE_QUALITY_POLICY_ID) throw Error("PILOT_PORTABLE_REFRESH_CONFIG_NOT_REVIEWED");
}
const EVIDENCE="cloud-pilot/runtime-evidence";
const record=z.record(z.unknown());
/** Read-only pickup time is separate from the unchanged lease/publication budget. */
export function portablePreLockReadyDeadline(acquisition:{startedAt:string;finishedAt:string},now:number):number{
  const start=Date.parse(acquisition.startedAt),end=Date.parse(acquisition.finishedAt),ageLimit=30*60_000;
  if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(now)||start>end||end-start>ageLimit||now<end)throw Error("PILOT_PRE_LOCK_CAPTURE_TIME_INVALID");
  const deadline=Math.min(now+5*60_000,end+ageLimit-PILOT_BUDGET.totalMs);
  if(deadline-now<=PILOT_BUDGET.controlCompletionMs)throw Error("PILOT_PRE_LOCK_BUDGET_EXHAUSTED");
  return deadline;
}
function assertProjection(actual:Record<string,unknown>,expected:object){
  for(const [key,value] of Object.entries(expected))if(JSON.stringify(actual[key])!==JSON.stringify(value))throw Error(`PILOT_BOOTSTRAP_MISMATCH:${key}`);
}
export async function runCloudPortableSourcePilot(input:{bootstrapPath:string;reviewedSha256:string;workspaceRoot:string;relayDirectory:string;signal?:AbortSignal;dbStartedControlPath?:string}){
  const bytes=await readFile(input.bootstrapPath);if(sha256(bytes)!==input.reviewedSha256)throw Error("PILOT_REVIEWED_BOOTSTRAP_HASH_REQUIRED");
  const bootstrap=z.object({schemaVersion:z.literal(1),checkedAt:z.string().datetime(),candidateRows:z.array(record),batchId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/)}).strict().parse(JSON.parse(bytes.toString("utf8")));
  const age=Date.now()-Date.parse(bootstrap.checkedAt);if(age<0||age>60000)throw Error("PILOT_BOOTSTRAP_FRESH_READ_REQUIRED");
  const authority=await resolveCurrentStagedScheduleAuthority({releaseCandidate:{findMany:async()=>bootstrap.candidateRows}} as unknown as Parameters<typeof resolveCurrentStagedScheduleAuthority>[0]);
  const coverage=getPortableCoverageScope();
  if(authority.plans.length!==41||coverage.requiredSourceIds.length!==40||hashCanonicalStringSet(authority.plans.map(p=>p.source.id))!==hashCanonicalStringSet(coverage.historicalSourceIds)||!coverage.requiredSourceIds.includes(PILOT_SOURCE))throw Error("PILOT_FULL_AUTHORITY_REQUIRED");
  const plan=authority.plans.find(p=>p.source.id===PILOT_SOURCE)!,identity=selectedPilotIdentity(authority.identity);
  if(!plan||sourcePlanConfigSha256(plan)!==CLOUD_PILOT_SOURCE.sourceConfigSha256)throw Error("PILOT_SOURCE_CONFIG_DRIFT");
  assertPortableRefreshPlan(plan);
  const batchId=bootstrap.batchId;
  const workspaceRoot=resolve(input.workspaceRoot),relay=new FilePilotRelay(resolve(input.relayDirectory));
  let owned:Awaited<ReturnType<typeof acquireCloudPilotLease>>|undefined;
  let phase="PRE_CAPTURE_CONTEXT",failed=false,attemptTracker:SourceFetchAttemptTracker|undefined,crawlResult:SourceCrawlResult|undefined;
  const retainFailure=async(error:unknown)=>{try{await preservePilotFailure({workspaceRoot,batchId,phase,error,...(attemptTracker?{attemptTracker}:{}),...(crawlResult?{result:crawlResult}:{})});}catch{console.error("CLOUD_SOURCE_PILOT_DIAGNOSTIC_WRITE_FAILED");}};
  try{
    // This read supplies capture mode only. It grants no write/lease authority.
    const preRequestedAt=Date.now();
    const pre=await relay.request("READ_CONTEXT",{projectId:"yiopvxysxrtrnvqxwgbx",sourceId:PILOT_SOURCE,sourceConfigSha256:CLOUD_PILOT_SOURCE.sourceConfigSha256,purpose:"PRE_CAPTURE"},preRequestedAt+PILOT_BUDGET.controlMs,value=>z.object({checkedAt:z.string().datetime()}).passthrough().parse(value),input.signal);
    if(Date.parse(pre.checkedAt)<preRequestedAt-1000||Date.parse(pre.checkedAt)>Date.now()+1000)throw Error("PILOT_CONTEXT_FRESH_READ_REQUIRED");
    const preContext=await loadPilotContext(pre,plan);
    const captureStartedAt=new Date();
    const planned=buildPendingRuntimeBatch(batchId,[plan],identity,captureStartedAt),pending=planned.sources[0]!;
    const tuple={releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:PILOT_SOURCE,sourceResultId:pending.id};
    const firstReceipt=preContext.firstAcceptedCurrentPolicyReceipt;
    const visibilityFloor=firstReceipt?verifySourceQualityReceipt({receipt:firstReceipt.receipt,receiptSha256:firstReceipt.receiptSha256,expected:firstReceipt.expectedBinding}).issuedAt:null;
    const sourceFetch=createOwnedSourceQualityFetch(plan.source.id==="source-hansoh-social"?{hansohGraceDom:{directory:join(workspaceRoot,"hansoh-grace-dom"),binding:{...tuple,sourceId:"source-hansoh-social",sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},previousJobs:preContext.previousJobs,visibilityFloor,...(input.signal?{signal:input.signal}:{})}}:{});
    const captureSignal=input.signal??new AbortController().signal;
    phase="ACQUIRE_SOURCE";const currentAttemptTracker=attemptTracker=createSourceFetchAttemptTracker();
    const result=crawlResult=await runWithOfficialSourceAttemptTimeout(()=>runWithOfficialSourceCancellation(captureSignal,()=>runSourceCrawl(plan,{fetch:sourceFetch,isBaseline:!preContext.baselineCompletedBeforeCrawl,attemptTracker:currentAttemptTracker})),20*60*1000);
    phase="CHECK_SOURCE_RESULT";
    if(!result.truth.transportSuccess||!result.truth.adapterSuccess||!result.fetchEvidence)throw Error("PILOT_SUCCESSFUL_SOURCE_ONLY_FAILURE_FINALIZATION_REQUIRED");
    phase="ARCHIVE_SOURCE";const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:EVIDENCE,captureTool:result.fetchEvidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:[...result.fetchEvidence.artifacts,...(result.priorTransportAttempts??[]).flatMap(a=>a.fetchEvidence?.artifacts??[])]})});
    const bundle=await makeArchiveBundle({workspaceRoot,...tuple,evidenceSubdirectory:EVIDENCE,artifacts:archive.artifacts});
    const bundleBytes=JSON.stringify(bundle,null,2),bundleSha256=sha256(bundleBytes),bundlePath=join(workspaceRoot,`${batchId}.archive.json`);
    await writeFile(bundlePath,bundleBytes,{flag:"wx",mode:0o600});
    phase="PRE_LOCK_ADMISSION";const initialAdmission=await issueSourceQualityAdmission({plan,result,binding:{releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},archive:{workspaceRoot,evidenceSubdirectory:EVIDENCE,artifacts:archive.artifacts}});
    if(initialAdmission.status!=="ACCEPTED")throw Error(`PILOT_ADMISSION_REJECTED:${initialAdmission.codes.join(",")}`);
    input.signal?.throwIfAborted();
    if(input.dbStartedControlPath){
      // Restore and re-admit the original archive before the read/review queue.
      // The existing DB-started packet alone acquires ownership, creates pending,
      // publishes, finalizes and releases; no lease ages while the model reviews.
      phase="VERIFY_LOCAL_ARCHIVE";
      const restoredBytes=await readFile(bundlePath),bundleByteCount=Buffer.byteLength(bundleBytes);
      if(restoredBytes.length!==bundleByteCount||sha256(restoredBytes)!==bundleSha256)throw Error("PILOT_ORIGINAL_ARCHIVE_BYTES_CHANGED");
      const restoredRoot=await mkdtemp(join(workspaceRoot,"verified-restore-"));
      const artifacts=await restoreArchiveBundle(JSON.parse(restoredBytes.toString("utf8")),restoredRoot);
      phase="ISSUE_ADMISSION";
      const admission=await issueSourceQualityAdmission({plan,result,binding:{releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},archive:{workspaceRoot:restoredRoot,evidenceSubdirectory:EVIDENCE,artifacts}});
      if(admission.status!=="ACCEPTED")throw Error(`PILOT_ADMISSION_REJECTED:${admission.codes.join(",")}`);
      phase="DB_STARTED_PUBLICATION";
      const outcome=await runDbStartedCloudPublication({relay,controlPath:input.dbStartedControlPath,planned,initialCertificate:admission.receipt,
        source:{plan,pending,identity,batchId,result,artifacts,attemptTracker,publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1",sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission},
        ...(input.signal?{signal:input.signal}:{})});
      const report={...outcome,batchId,sourceResultId:pending.id,sourceId:PILOT_SOURCE,bundlePath,bundleSha256,bundleByteCount,archiveRetention:"PENDING",recoveryVerification:"PENDING",certificateGrade:SOURCE_QUALITY_POLICY_ID};
      await writeFile(join(workspaceRoot,`${batchId}.outcome.json`),JSON.stringify(report),{flag:"wx",mode:0o600});return report;
    }
    // Wait for a current host/database acknowledgement while no lease exists.
    // The original acquisition clock leaves a full 550s budget after this wait.
    phase="PRE_LOCK_READY";const readyRequestedAt=Date.now(),readyDeadline=portablePreLockReadyDeadline(initialAdmission.receipt.acquisition,readyRequestedAt);
    const ready=await relay.request("READ_CONTEXT",{projectId:"yiopvxysxrtrnvqxwgbx",sourceId:PILOT_SOURCE,sourceConfigSha256:pending.sourceConfigHash,purpose:"PRE_LOCK_READY"},readyDeadline,value=>z.object({checkedAt:z.string().datetime()}).passthrough().parse(value),input.signal);
    const readyAt=Date.parse(ready.checkedAt);
    if(Date.now()>=readyDeadline||readyAt<readyRequestedAt-1000||readyAt>Date.now()+1000||Date.now()-readyAt>PILOT_BUDGET.controlMs)throw Error("PILOT_PRE_LOCK_READY_FRESH_READ_REQUIRED");
    const readyContext=await loadPilotContext(ready,plan);
    if(readyContext.trustedCompletenessBaseline&&Date.parse(readyContext.trustedCompletenessBaseline.verifiedAt)>Date.parse(initialAdmission.receipt.acquisition.startedAt))throw Error("PILOT_CAPTURE_PRECEDES_ACCEPTED_OBSERVATION");
    if(Date.now()+PILOT_BUDGET.totalMs>=Date.parse(initialAdmission.receipt.acquisition.finishedAt)+30*60_000)throw Error("PILOT_PRE_LOCK_BUDGET_EXHAUSTED");
    input.signal?.throwIfAborted();
    // Start the unchanged clocks only after the read-only preparation completes.
    phase="ACQUIRE_LEASE";const started=Date.now(),deadline=started+PILOT_BUDGET.initialMs,overallDeadline=started+PILOT_BUDGET.totalMs;
    owned=await acquireCloudPilotLease(relay,deadline,input.signal);
    const bounded=AbortSignal.any([owned.handle.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now())),...(input.signal?[input.signal]:[])]);
    phase="CREATE_PENDING";
    const created=await relay.request("CREATE_PENDING",{projectId:"yiopvxysxrtrnvqxwgbx",holderId:owned.handle.holderId,planned},Math.min(deadline-PILOT_BUDGET.controlMs,Date.now()+PILOT_BUDGET.controlMs),value=>z.object({batch:record,sourceRows:z.array(record).length(1)}).strict().parse(value),bounded);
    const batch=reviveUtcFields(created.batch,["startedAt","heartbeatAt"]),source=reviveUtcFields(created.sourceRows[0]!,["startedAt"]);
    assertProjection(batch,{...planned.batch,status:"RUNNING",finishedAt:null});
    assertProjection(source,{...pending,releaseCandidateId:identity.releaseCandidateId,batchId,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null});
    phase="READ_CONTEXT";const contextRequestedAt=Date.now();
    const fresh=await relay.request("READ_CONTEXT",{projectId:"yiopvxysxrtrnvqxwgbx",sourceId:PILOT_SOURCE,sourceConfigSha256:pending.sourceConfigHash,holderId:owned.handle.holderId,sourceResultId:pending.id},Math.min(deadline-PILOT_BUDGET.controlMs,Date.now()+PILOT_BUDGET.controlMs),value=>z.object({checkedAt:z.string().datetime()}).passthrough().parse(value),bounded);
    const checkedAt=Date.parse(fresh.checkedAt);
    if(checkedAt<contextRequestedAt-1000||checkedAt>Date.now()+1000)throw Error("PILOT_CONTEXT_FRESH_READ_REQUIRED");
    phase="LOAD_CONTEXT";const context=await loadPilotContext(fresh,plan);
    if(context.trustedCompletenessBaseline&&Date.parse(context.trustedCompletenessBaseline.verifiedAt)>Date.parse(initialAdmission.receipt.acquisition.startedAt))throw Error("PILOT_CAPTURE_PRECEDES_ACCEPTED_OBSERVATION");
    // Storage acknowledgement is separate from remote recovery verification.
    // Local replay below rechecks the exact original bytes under this live owner.
    const bundleByteCount=Buffer.byteLength(bundleBytes);
    phase="VERIFY_LOCAL_ARCHIVE";const restoredBytes=await readFile(bundlePath);
    if(restoredBytes.length!==bundleByteCount||sha256(restoredBytes)!==bundleSha256)throw Error("PILOT_ORIGINAL_ARCHIVE_BYTES_CHANGED");
    const restoredRoot=await mkdtemp(join(workspaceRoot,"verified-restore-"));
    const restoredArtifacts=await restoreArchiveBundle(JSON.parse(restoredBytes.toString("utf8")),restoredRoot);
    bounded.throwIfAborted();
    phase="ISSUE_ADMISSION";const admission=await issueSourceQualityAdmission({plan,result,binding:{releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},archive:{workspaceRoot:restoredRoot,evidenceSubdirectory:EVIDENCE,artifacts:restoredArtifacts}});
    if(admission.status!=="ACCEPTED")throw Error(`PILOT_ADMISSION_REJECTED:${admission.codes.join(",")}`);
    phase="BUILD_COMMIT";const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,...context,artifacts:restoredArtifacts,attemptTracker,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission});
    phase="COMPILE_SQL";const sql=await compilePortableAtomicSourceEvidenceSql(commit,owned.handle);
    phase="RENEW_LEASE";const publicationDeadline=await owned.renewOnce(bounded);
    const publicationSignal=AbortSignal.any([owned.handle.signal,AbortSignal.timeout(Math.max(1,publicationDeadline-Date.now())),...(input.signal?[input.signal]:[])]);
    phase="PUBLISH_AND_RECONCILE";const outcome=await reconcilePilotPublication(relay,sql,commit,publicationDeadline,overallDeadline,publicationSignal);
    const report={...outcome,batchId,sourceResultId:pending.id,sourceId:PILOT_SOURCE,bundlePath,bundleSha256,bundleByteCount,archiveRetention:"PENDING",recoveryVerification:"PENDING",jobCount:admission.receipt.counts.finalUniqueJobCount,certificateGrade:SOURCE_QUALITY_POLICY_ID,batchFinalizationRequired:true};
    await writeFile(join(workspaceRoot,`${batchId}.outcome.json`),JSON.stringify(report),{flag:"wx",mode:0o600});return report;
  }catch(error){failed=true;await retainFailure(error);throw error;}finally{
    try{if(owned)await owned.release();}catch(error){phase="RELEASE_LEASE";await retainFailure(error);if(!failed)throw error;}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [bootstrapPath,reviewedSha256,workspaceRoot,relayDirectory,...extra]=process.argv.slice(2);
  if(!bootstrapPath||!reviewedSha256||!workspaceRoot||!relayDirectory||extra.length&&!(extra.length===2&&extra[0]==="--db-started-control"&&extra[1])){console.error("Usage: p0-cloud-portable-source-pilot.ts <fresh-reviewed-bootstrap.json> <sha256> <artifact-workspace> <relay-directory> [--db-started-control <control-base.json>]");process.exitCode=2;}
  else{const controller=new AbortController();process.once("SIGINT",()=>controller.abort());process.once("SIGTERM",()=>controller.abort());
    try{const report=await runCloudPortableSourcePilot({bootstrapPath,reviewedSha256,workspaceRoot,relayDirectory,signal:controller.signal,...(extra[1]?{dbStartedControlPath:extra[1]}:{})});console.log(JSON.stringify(report));if(report.state!=="COMMITTED_EXACT")process.exitCode=1;}
    catch{console.error("CLOUD_SOURCE_PILOT_STOPPED_REVIEW_RELAY_AND_PERSISTED_OUTCOME");process.exitCode=1;}}
}
