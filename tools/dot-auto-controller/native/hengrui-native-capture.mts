/** Hengrui-specific owned acquisition stage. Preserves the native PORTABLE archive,
 * admission, expiry and source identity contract. No publication dispatch exists
 * here. Independent Hengrui packet/reader integration remains required. */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { requireDbStartedOuterDeadline } from "../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts";
import { z } from "zod";
import { archiveSourceEvidence } from "../vendor/c60-source/src/crawler/artifactArchive.ts";
import { FilePilotRelay, PILOT_BUDGET, makeArchiveBundle, restoreArchiveBundle, sha256 } from "../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch } from "../vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts";
import { SOURCE_QUALITY_POLICY_ID, createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission } from "../vendor/c60-source/src/crawler/sourceQualityAdmission.ts";
import { runSourceCrawl, createSourceFetchAttemptTracker, type SourceCrawlResult, type SourceFetchAttemptTracker } from "../vendor/c60-source/src/crawler/runSourceCrawl.ts";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../vendor/c60-source/src/crawler/sourcePlan.ts";
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from "../vendor/c60-source/src/crawler/officialHttpRuntimeLimits.ts";
import { resolveCurrentStagedScheduleAuthority } from "../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts";
import { hashCanonicalStringSet } from "../vendor/c60-source/src/crawler/runtimeBatchIdentity.ts";
import { getPortableCoverageScope } from "../vendor/c60-source/src/release/portableCoveragePolicy.ts";
import { compilePortableAtomicSourceEvidenceSql } from "../vendor/c60-source/src/db/ingestionRepository.ts";
import { CLOUD_PILOT_SOURCE } from "../vendor/c60-source/src/db/cloudPilotSqlControl.ts";
import { PILOT_SOURCE, loadPilotContext, preservePilotFailure, selectedPilotIdentity } from "../vendor/c60-source/scripts/p0-cloud-source-pilot.ts";

export const HENGRUI_SOURCE_ID = "source-hengrui-social";
export const HENGRUI_CONFIG_SHA256 = "93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e";
/** Exact original Hengrui Moka plan; no protocol, geography or recency substitutions. */
export function assertHengruiRefreshPlan(plan:SourceCrawlPlan):void {
  if (plan.source.id !== HENGRUI_SOURCE_ID || sourcePlanConfigSha256(plan) !== HENGRUI_CONFIG_SHA256 ||
      plan.adapterId !== "official-json" || plan.source.atsKind !== "MOKA" ||
      plan.moka?.expectedOrgId !== "hengrui" || plan.moka.expectedSiteId !== "145996" ||
      plan.moka.expectedMode !== "social" || plan.moka.campaignUrl !== "https://app.mokahr.com/social-recruitment/hengrui/145996" ||
      plan.moka.hydrateMissingLocationsFromDetail !== true ||
      plan.moka.scopeExclusionProof !== "HENGRUI_EXPLICIT_US_WALTHAM_OR_HONG_KONG_ONLY_V1" ||
      plan.moka.publishedWithinDays !== undefined || getSourceQualityPolicy(plan) !== SOURCE_QUALITY_POLICY_ID)
    throw Error("HENGRUI_EXACT_MOKA_PLAN_REQUIRED");
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
export async function captureHengruiNative(input:{bootstrapPath:string;reviewedSha256:string;workspaceRoot:string;relayDirectory:string;signal?:AbortSignal;dbStartedControlPath?:string;overallDeadline?:number;relay:FilePilotRelay}){
  if(!input.dbStartedControlPath || PILOT_SOURCE!=="source-hengrui-social")throw Error("HENGRUI_DB_STARTED_CAPTURE_ONLY");
  if(input.dbStartedControlPath)requireDbStartedOuterDeadline(input.overallDeadline);
  input.signal?.throwIfAborted();
  const bytes=await readFile(input.bootstrapPath);if(sha256(bytes)!==input.reviewedSha256)throw Error("PILOT_REVIEWED_BOOTSTRAP_HASH_REQUIRED");
  const bootstrap=z.object({schemaVersion:z.literal(1),checkedAt:z.string().datetime(),candidateRows:z.array(record),batchId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/)}).strict().parse(JSON.parse(bytes.toString("utf8")));
  const age=Date.now()-Date.parse(bootstrap.checkedAt);if(age<0||age>60000)throw Error("PILOT_BOOTSTRAP_FRESH_READ_REQUIRED");
  const authority=await resolveCurrentStagedScheduleAuthority({releaseCandidate:{findMany:async()=>bootstrap.candidateRows}} as unknown as Parameters<typeof resolveCurrentStagedScheduleAuthority>[0]);
  const coverage=getPortableCoverageScope();
  if(authority.plans.length!==41||coverage.requiredSourceIds.length!==40||hashCanonicalStringSet(authority.plans.map(p=>p.source.id))!==hashCanonicalStringSet(coverage.historicalSourceIds)||!coverage.requiredSourceIds.includes(PILOT_SOURCE))throw Error("PILOT_FULL_AUTHORITY_REQUIRED");
  const plan=authority.plans.find(p=>p.source.id===PILOT_SOURCE)!,identity=selectedPilotIdentity(authority.identity);
  if(!plan||sourcePlanConfigSha256(plan)!==CLOUD_PILOT_SOURCE.sourceConfigSha256)throw Error("PILOT_SOURCE_CONFIG_DRIFT");
  assertHengruiRefreshPlan(plan);
  const batchId=bootstrap.batchId;
  const workspaceRoot=resolve(input.workspaceRoot),relay=input.relay;
  let phase="PRE_CAPTURE_CONTEXT",attemptTracker:SourceFetchAttemptTracker|undefined,crawlResult:SourceCrawlResult|undefined;
  const retainFailure=async(error:unknown)=>{try{await preservePilotFailure({workspaceRoot,batchId,phase,error,...(attemptTracker?{attemptTracker}:{}),...(crawlResult?{result:crawlResult}:{})});}catch{console.error("CLOUD_SOURCE_PILOT_DIAGNOSTIC_WRITE_FAILED");}};
  try{
    // This read supplies capture mode only. It grants no write/lease authority.
    const preRequestedAt=Date.now();
    const pre=await relay.request("READ_CONTEXT",{projectId:"yiopvxysxrtrnvqxwgbx",sourceId:PILOT_SOURCE,sourceConfigSha256:CLOUD_PILOT_SOURCE.sourceConfigSha256,purpose:"PRE_CAPTURE"},preRequestedAt+PILOT_BUDGET.controlMs,value=>z.object({checkedAt:z.string().datetime()}).passthrough().parse(value),input.signal);
    if(Date.parse(pre.checkedAt)<preRequestedAt-1000||Date.parse(pre.checkedAt)>Date.now()+1000)throw Error("PILOT_CONTEXT_FRESH_READ_REQUIRED");
    const preContext=await loadPilotContext(pre,plan);
    const captureStartedAt=new Date();
    const sourceFetch=createOwnedSourceQualityFetch();
    const captureSignal=input.signal??new AbortController().signal;
    phase="ACQUIRE_SOURCE";const currentAttemptTracker=attemptTracker=createSourceFetchAttemptTracker();
    const result=crawlResult=await runWithOfficialSourceAttemptTimeout(()=>runWithOfficialSourceCancellation(captureSignal,()=>runSourceCrawl(plan,{fetch:sourceFetch,isBaseline:!preContext.baselineCompletedBeforeCrawl,attemptTracker:currentAttemptTracker})),20*60*1000);
    phase="CHECK_SOURCE_RESULT";
    if(!result.truth.transportSuccess||!result.truth.adapterSuccess||!result.fetchEvidence)throw Error("PILOT_SUCCESSFUL_SOURCE_ONLY_FAILURE_FINALIZATION_REQUIRED");
    const observedFrom=captureStartedAt;
    const planned=buildPendingRuntimeBatch(batchId,[plan],identity,observedFrom),pending=planned.sources[0]!;
    const tuple={releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:PILOT_SOURCE,sourceResultId:pending.id};
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
      return {source:{plan,pending,identity,batchId,result,artifacts,attemptTracker,publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1" as const,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission},planned,initialCertificate:admission.receipt,bundlePath,bundleSha256,bundleByteCount,restoredRoot,artifacts};
    }
    throw Error("HENGRUI_ORIGINAL_DB_STARTED_BRANCH_REQUIRED");
  }catch(error){await retainFailure(error);throw error;}
}
