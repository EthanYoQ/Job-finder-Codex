import { loadPilotContext } from "../src/crawler/cloudPilotContext";
import {runDbStartedCloudPublication} from "../src/crawler/cloudDbStartedPilot";
import {readCurrentWorkerCapture} from "../src/crawler/currentWorkerCapture";
/** REVIEW-ONLY PROTOTYPE. Do not launch before the documented bootstrap/live review. */
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { archiveSourceEvidence, verifyArchivedSourceEvidence } from "../src/crawler/artifactArchive";
import { FilePilotRelay, PilotSqlFailure, PILOT_BUDGET, acquireCloudPilotLease, makeArchiveBundle, restoreArchiveBundle, reviveUtcFields, sha256 } from "../src/crawler/cloudSourcePilotRelay";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../src/crawler/runtimeAtomicEvidence";
import { createHttpOnlyOfficialSourceFetch } from "../src/crawler/sourceQualityAdmission";
import { assertAdapterReconciliation } from "../src/crawler/adapters/reconciliation";
import { runSourceCrawl, createSourceFetchAttemptTracker, type SourceCrawlResult, type SourceFetchAttemptTracker } from "../src/crawler/runSourceCrawl";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../src/crawler/sourcePlan";
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from "../src/crawler/officialHttpRuntimeLimits";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import { hashCanonicalStringSet, type RuntimeBatchIdentity } from "../src/crawler/runtimeBatchIdentity";
import { getPortableCoverageScope } from "../src/release/portableCoveragePolicy";
import { buildJobDedupeKey } from "../src/crawler/normalizedJob";
import { compilePortableAtomicSourceEvidenceSql, inspectPersistedAtomicCommitOutcome, type AtomicSourceEvidenceCommit } from "../src/db/ingestionRepository";
import { CLOUD_PILOT_SOURCE } from "../src/db/cloudPilotSqlControl";
import { issueAGradeOfficialTotalCertificate } from "../src/crawler/completenessCertificate";
import { requiresBGradeTraversalCertificate, parseBGradeIndependentTraversalValidation, issueBGradeTraversalCertificate } from "../src/crawler/traversalCertificate";
export const PILOT_SOURCE=CLOUD_PILOT_SOURCE.id;
const EVIDENCE="cloud-pilot/runtime-evidence";
const record=z.record(z.unknown());
export function selectedPilotIdentity(full:RuntimeBatchIdentity):RuntimeBatchIdentity{
  return {...full,ownerId:CLOUD_PILOT_SOURCE.ownerId,batchKind:"SCHEDULED",expectedPlannedSourceIds:[PILOT_SOURCE],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([PILOT_SOURCE])};
}
export { loadPilotContext } from "../src/crawler/cloudPilotContext";
/** Every publication outcome, including timeout/error, requires a new read.
 * Never reuse a bootstrap row or automatically retry the write. */
export async function reconcilePilotPublication(relay:FilePilotRelay,sql:string,commit:AtomicSourceEvidenceCommit,deadline:number,overallDeadline:number,signal?:AbortSignal){
  if(!sql.startsWith("SET LOCAL statement_timeout = '120000ms';\nDO "))throw Error("PILOT_BOUNDED_COMPILER_REQUIRED");
  // Preserve the lease-safe write deadline AND two complete, read/cleanup-only
  // control windows. A late renewal acknowledgement never manufactures write time.
  const publicationDeadline=Math.min(deadline-PILOT_BUDGET.leaseReserveMs,overallDeadline-2*PILOT_BUDGET.controlMs);
  if(Date.now()+PILOT_BUDGET.publishDbMs+PILOT_BUDGET.publishTransportMs>=publicationDeadline)throw Error("PILOT_PUBLICATION_BUDGET_EXHAUSTED");
  let publishAcknowledged=false;
  try{await relay.sql("PUBLISH",sql,publicationDeadline,signal);publishAcknowledged=true;}catch(error){
    // Unknown/aborted tool responses cannot establish rollback. Wait until the
    // absolute latest dispatch plus 120s DB timeout and 45s transport reserve.
    if(!(error instanceof PilotSqlFailure&&error.outcome!=="UNKNOWN"))await delay(Math.max(0,publicationDeadline-Date.now()));
  }
  const id=commit.sourceResult.id.replaceAll("\\","\\\\").replaceAll("'","''");
  // Reconciliation is required even if the caller cancelled the publish wait.
  const rows=await relay.sql("READ_OUTCOME",`SELECT to_jsonb(r) AS row FROM public."CrawlBatchSourceResult" r WHERE "id" = E'${id}'`,Math.min(overallDeadline-PILOT_BUDGET.controlMs,Date.now()+PILOT_BUDGET.controlMs));
  if(rows.length>1)throw Error("PILOT_OUTCOME_ROW_COUNT");
  const persisted=rows.length?reviveUtcFields(record.parse(rows[0]!.row),["startedAt","finishedAt"]):null;
  const outcome=await inspectPersistedAtomicCommitOutcome(commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error("PILOT_OUTCOME_FIND_MANY_FORBIDDEN");}}});
  return {...outcome,publishAcknowledged};
}
function assertProjection(actual:Record<string,unknown>,expected:object){
  for(const [key,value] of Object.entries(expected))if(JSON.stringify(actual[key])!==JSON.stringify(value))throw Error(`PILOT_BOOTSTRAP_MISMATCH:${key}`);
}
/** Private diagnostic only: never a receipt or a publishable acquisition. */
export async function preservePilotFailure(input:{workspaceRoot:string;batchId:string;phase:string;error:unknown;attemptTracker?:SourceFetchAttemptTracker;result?:SourceCrawlResult}){
  const errors:Array<{class:string;code:string|null;stage:string|null}>=[],seen=new Set<unknown>();let current=input.error;
  const safe=(value:unknown,pattern:RegExp)=>typeof value==="string"&&pattern.test(value)?value:null;
  for(let depth=0;depth<5&&current&&typeof current==="object"&&!seen.has(current);depth++){
    seen.add(current);const e=current as {name?:unknown;code?:unknown;message?:unknown;stage?:unknown;cause?:unknown;constructor?:{name?:unknown}};
    const code=safe(e.code,/^[A-Z0-9][A-Z0-9_]{0,95}$/)??(typeof e.message==="string"?safe(e.message.split(":",1)[0],/^[A-Z][A-Z0-9_]{0,95}$/):null);
    errors.push({class:safe(e.constructor?.name,/^[A-Za-z][A-Za-z0-9_]{0,63}$/)??"UnknownError",code,stage:e.stage==="FETCH"||e.stage==="ADAPTER"?e.stage:null});current=e.cause;
  }
  if(errors.length===0)errors.push({class:"NonErrorThrow",code:null,stage:null});
  const tracker=input.attemptTracker,diagnostic={schemaVersion:1,purpose:"PRIVATE_DIAGNOSTIC_NOT_PUBLICATION_AUTHORITY",recordedAt:new Date().toISOString(),batchId:input.batchId,sourceId:PILOT_SOURCE,phase:input.phase,errors,
    attempts:{fetchAttemptCount:tracker?.fetchAttemptCount??null,retryCount:tracker?.retryCount??null,retryReasonCodes:tracker?[...tracker.retryReasonCodes]:null,httpRequestCount:null},crawlResult:input.result??null};
  const artifactPath=join(input.workspaceRoot,`${input.batchId}.failure-${randomUUID()}.json`);
  await writeFile(artifactPath,JSON.stringify(diagnostic,(_key,value)=>value instanceof Uint8Array?{encoding:"base64",bytes:Buffer.from(value).toString("base64")}:value,2),{flag:"wx",mode:0o600});return artifactPath;
}
export async function runCloudSourcePilot(input:{bootstrapPath:string;reviewedSha256:string;workspaceRoot:string;relayDirectory:string;signal?:AbortSignal;dbStartedControlPath?:string}){
  const bytes=await readFile(input.bootstrapPath);if(sha256(bytes)!==input.reviewedSha256)throw Error("PILOT_REVIEWED_BOOTSTRAP_HASH_REQUIRED");
  const bootstrap=z.object({schemaVersion:z.literal(1),checkedAt:z.string().datetime(),candidateRows:z.array(record),batchId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/),retainedCapture:z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),currentCapture:z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),independentValidation:z.object({path:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict().parse(JSON.parse(bytes.toString("utf8")));
  if(bootstrap.retainedCapture)throw Error("A_PILOT_REQUIRES_FRESH_ACQUISITION");
  const age=Date.now()-Date.parse(bootstrap.checkedAt);if(age<0||age>60000)throw Error("PILOT_BOOTSTRAP_FRESH_READ_REQUIRED");
  const authority=await resolveCurrentStagedScheduleAuthority({releaseCandidate:{findMany:async()=>bootstrap.candidateRows}} as unknown as Parameters<typeof resolveCurrentStagedScheduleAuthority>[0]);
  const coverage=getPortableCoverageScope();
  if(authority.plans.length!==41||coverage.requiredSourceIds.length!==40||hashCanonicalStringSet(authority.plans.map(p=>p.source.id))!==hashCanonicalStringSet(coverage.historicalSourceIds)||!coverage.requiredSourceIds.includes(PILOT_SOURCE))throw Error("PILOT_FULL_AUTHORITY_REQUIRED");
  const plan=authority.plans.find(p=>p.source.id===PILOT_SOURCE)!,identity=selectedPilotIdentity(authority.identity);
  if(!plan||sourcePlanConfigSha256(plan)!==CLOUD_PILOT_SOURCE.sourceConfigSha256)throw Error("PILOT_SOURCE_CONFIG_DRIFT");
  const bGrade=requiresBGradeTraversalCertificate(plan);
  if(bGrade!==Boolean(bootstrap.independentValidation))throw Error("PILOT_B_INDEPENDENT_INPUT_REQUIRED");
  let independentTraversalValidation;
  if(bootstrap.independentValidation){
    const raw=await readFile(bootstrap.independentValidation.path);
    if(sha256(raw)!==bootstrap.independentValidation.sha256)throw Error("PILOT_B_INDEPENDENT_INPUT_HASH");
    independentTraversalValidation=parseBGradeIndependentTraversalValidation(JSON.parse(raw.toString("utf8")));
    await writeFile(join(resolve(input.workspaceRoot),`${bootstrap.batchId}.independent-validation.json`),raw,{flag:"wx",mode:0o600});
    if(independentTraversalValidation.sourceId!==PILOT_SOURCE||independentTraversalValidation.companyId!==plan.company.id||independentTraversalValidation.sourceConfigSha256!==sourcePlanConfigSha256(plan))throw Error("PILOT_B_INDEPENDENT_INPUT_SCOPE");
  }
  const currentCapture=bootstrap.currentCapture?await readCurrentWorkerCapture(bootstrap.currentCapture,plan):undefined;
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
    const preContext=await loadPilotContext(pre,plan,true);
    const captureStartedAt=currentCapture?.startedAt??new Date();
    const sourceFetch=currentCapture?.fetch??createHttpOnlyOfficialSourceFetch();
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
    phase="PRE_LOCK_CERTIFICATE";
    const certificateInput={plan,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,evidence:result.fetchEvidence,paginationEvaluation:result.paginationEvaluation!,reconciliation:assertAdapterReconciliation(result),jobs:result.jobs,binding:{releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:pending.sourceConfigHash}};
    const initialCertificate=bGrade?issueBGradeTraversalCertificate({...certificateInput,independentValidation:independentTraversalValidation!,validationExecution:"CURRENT_RUN",trigger:"INITIAL_QUALIFICATION",now:new Date()}):issueAGradeOfficialTotalCertificate({...certificateInput,officialArtifactSha256:archive.artifacts.find(a=>a.logicalKey===result.fetchEvidence!.declaredCompleteness?.artifactLogicalKey)?.sha256});
    if(initialCertificate.status!=="CERTIFIED")throw Error(`PILOT_CERTIFICATE_REJECTED:${initialCertificate.blockerCodes.join(",")}`);
    input.signal?.throwIfAborted();
    if(input.dbStartedControlPath){
      phase="VERIFY_LOCAL_ARCHIVE";
      const restoredBytes=await readFile(bundlePath),bundleByteCount=Buffer.byteLength(bundleBytes);
      if(restoredBytes.length!==bundleByteCount||sha256(restoredBytes)!==bundleSha256)throw Error("PILOT_ORIGINAL_ARCHIVE_BYTES_CHANGED");
      const restoredRoot=await mkdtemp(join(workspaceRoot,"verified-restore-"));
      const artifacts=await restoreArchiveBundle(JSON.parse(restoredBytes.toString("utf8")),restoredRoot);
      await verifyArchivedSourceEvidence({workspaceRoot:restoredRoot,evidenceSubdirectory:EVIDENCE,artifacts,...tuple});
      phase="DB_STARTED_PUBLICATION";
      const outcome=await runDbStartedCloudPublication({relay,controlPath:input.dbStartedControlPath,planned,initialCertificate:initialCertificate.certificate,
        source:{plan,pending,identity,batchId,result,artifacts,attemptTracker,completedAt:new Date(),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1",
          ...(bGrade?{independentTraversalValidation:independentTraversalValidation!,independentTraversalValidationExecution:"CURRENT_RUN" as const,independentTraversalValidationTrigger:"INITIAL_QUALIFICATION" as const}:{})},
        ...(input.signal?{signal:input.signal}:{})});
      const report={...outcome,batchId,sourceResultId:pending.id,sourceId:PILOT_SOURCE,bundlePath,bundleSha256,bundleByteCount,archiveRetention:"PENDING",recoveryVerification:"PENDING",certificateGrade:bGrade?"B":"A"};
      await writeFile(join(workspaceRoot,`${batchId}.outcome.json`),JSON.stringify(report),{flag:"wx",mode:0o600});return report;
    }
    // The 550-second publication budget starts only after capture and owned quality success.
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
    phase="LOAD_CONTEXT";const context=await loadPilotContext(fresh,plan,true);
    if(context.trustedCompletenessBaseline&&Date.parse(context.trustedCompletenessBaseline.verifiedAt)>captureStartedAt.getTime())throw Error("PILOT_CAPTURE_PRECEDES_ACCEPTED_OBSERVATION");
    // Storage acknowledgement is separate from remote recovery verification.
    // Local replay below rechecks the exact original bytes under this live owner.
    const bundleByteCount=Buffer.byteLength(bundleBytes);
    phase="VERIFY_LOCAL_ARCHIVE";const restoredBytes=await readFile(bundlePath);
    if(restoredBytes.length!==bundleByteCount||sha256(restoredBytes)!==bundleSha256)throw Error("PILOT_ORIGINAL_ARCHIVE_BYTES_CHANGED");
    const restoredRoot=await mkdtemp(join(workspaceRoot,"verified-restore-"));
    const restoredArtifacts=await restoreArchiveBundle(JSON.parse(restoredBytes.toString("utf8")),restoredRoot);
    bounded.throwIfAborted();
    phase="VERIFY_A_ARCHIVE";await verifyArchivedSourceEvidence({workspaceRoot:restoredRoot,evidenceSubdirectory:EVIDENCE,artifacts:restoredArtifacts,...tuple});
    if(Date.now()-captureStartedAt.getTime()>30*60*1000)throw Error("PILOT_A_CAPTURE_NOT_FRESH");
    const currentKeys=new Set(result.jobs.map(buildJobDedupeKey));
    const previousJobs=context.previousJobs.filter(job=>currentKeys.has(job.dedupeKey)||(context.acceptedVisibilityFloor!==null&&Date.parse(job.lastSeenAt)>=context.acceptedVisibilityFloor.getTime()));
    phase="BUILD_COMMIT";const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,...context,previousJobs,artifacts:restoredArtifacts,attemptTracker,completedAt:new Date(),...(bGrade?{independentTraversalValidation:independentTraversalValidation!,independentTraversalValidationExecution:"CURRENT_RUN" as const,independentTraversalValidationTrigger:"INITIAL_QUALIFICATION" as const}:{}),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1"});
    if(commit.sourceResult.completenessState!=="VERIFIED"||(commit.sourceResult.completenessCertificate as {schemaVersion?:string}|null)?.schemaVersion!==(bGrade?"b-grade-independent-traversal-v2":"a-grade-official-total-v2"))throw Error("PILOT_REAL_CERTIFICATE_REQUIRED");
    phase="COMPILE_SQL";const sql=await compilePortableAtomicSourceEvidenceSql(commit,owned.handle);
    phase="RENEW_LEASE";const publicationDeadline=await owned.renewOnce(bounded);
    const publicationSignal=AbortSignal.any([owned.handle.signal,AbortSignal.timeout(Math.max(1,publicationDeadline-Date.now())),...(input.signal?[input.signal]:[])]);
    phase="PUBLISH_AND_RECONCILE";const outcome=await reconcilePilotPublication(relay,sql,commit,publicationDeadline,overallDeadline,publicationSignal);
    const report={...outcome,batchId,sourceResultId:pending.id,sourceId:PILOT_SOURCE,bundlePath,bundleSha256,bundleByteCount,archiveRetention:"PENDING",recoveryVerification:"PENDING",jobCount:commit.sourceResult.dedupeOutputCount,certificateGrade:bGrade?"B":"A",batchFinalizationRequired:true};
    await writeFile(join(workspaceRoot,`${batchId}.outcome.json`),JSON.stringify(report),{flag:"wx",mode:0o600});return report;
  }catch(error){failed=true;await retainFailure(error);throw error;}finally{
    try{if(owned)await owned.release();}catch(error){phase="RELEASE_LEASE";await retainFailure(error);if(!failed)throw error;}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [bootstrapPath,reviewedSha256,workspaceRoot,relayDirectory,...extra]=process.argv.slice(2);
  if(!bootstrapPath||!reviewedSha256||!workspaceRoot||!relayDirectory||extra.length&&!(extra.length===2&&extra[0]==="--db-started-control"&&extra[1])){console.error("Usage: p0-cloud-source-pilot.ts <fresh-reviewed-bootstrap.json> <sha256> <artifact-workspace> <relay-directory> [--db-started-control <control-base.json>]");process.exitCode=2;}
  else{const controller=new AbortController();process.once("SIGINT",()=>controller.abort());process.once("SIGTERM",()=>controller.abort());
    try{const report=await runCloudSourcePilot({bootstrapPath,reviewedSha256,workspaceRoot,relayDirectory,signal:controller.signal,...(extra[1]?{dbStartedControlPath:extra[1]}:{})});console.log(JSON.stringify(report));if(report.state!=="COMMITTED_EXACT")process.exitCode=1;}
    catch{console.error("CLOUD_SOURCE_PILOT_STOPPED_REVIEW_RELAY_AND_PERSISTED_OUTCOME");process.exitCode=1;}}
}
