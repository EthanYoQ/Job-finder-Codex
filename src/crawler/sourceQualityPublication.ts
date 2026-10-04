import { exactNovoChinaQualityPlan, novoClosedSourceJobIds } from "./novoChinaQuality";
import { hasNovartisOfficialPresencePlan, replayNovartisOfficialPresence } from "./novartisOfficialPresence";
import { buildIngestionCommands, type IngestionCommand } from "./ingestion";
import { applyCrawlObservation, type JobSnapshot } from "./lifecycle";
import { buildJobDedupeKey } from "./normalizedJob";
import type { SourceCrawlResult } from "./runSourceCrawl";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import { assertIssuedSourceQualityAdmission, getSourceQualityPolicy, type SourceQualityAdmission, verifySourceQualityReceipt, type SourceQualityReceipt } from "./sourceQualityAdmission";

export interface SourceQualityPublicationInput {
  plan:SourceCrawlPlan;
  result:SourceCrawlResult;
  admission:SourceQualityAdmission;
  previousJobs:readonly JobSnapshot[];
  /** Earliest COMMITTED/VERIFIED receipt for this source/config/policy, selected by the DB reader.
   * Its receipt.issuedAt is the floor, never batch/transaction completion time.
   * The public reader must apply this same lastSeenAt floor to exclude legacy contamination. */
  firstAcceptedCurrentPolicyReceipt:{receipt:unknown;receiptSha256:string;expectedBinding:SourceQualityReceipt["binding"]}|null;
  baselineCompletedBeforeCrawl:boolean;
}
export interface SourceQualityPublicationCommands {
  jobCommands:Array<Extract<IngestionCommand,{type:"UPSERT_JOB"}>>;
  visibilityFloor:string|null;
}

/** Pure mutation boundary. Diagnostics/observation persistence is owned by the atomic caller.
 * A rejected source has no Job writes; only an issuer-owned accepted result advances lifecycle.
 * This does not itself publish, fence a DB transaction, or establish an accepted DB result. */
export function buildSourceQualityJobCommands(input:SourceQualityPublicationInput):SourceQualityPublicationCommands {
  const prior=input.firstAcceptedCurrentPolicyReceipt;
  const priorReceipt=prior?verifySourceQualityReceipt({receipt:prior.receipt,receiptSha256:prior.receiptSha256,expected:prior.expectedBinding}):null;
  if(priorReceipt&&(priorReceipt.policyId!==getSourceQualityPolicy(input.plan)||priorReceipt.binding.sourceId!==input.plan.source.id||
    priorReceipt.binding.sourceConfigSha256!==sourcePlanConfigSha256(input.plan)||priorReceipt.companyId!==input.plan.company.id))
    throw new Error("SOURCE_QUALITY_PRIOR_RECEIPT_BINDING_INVALID");
  if(input.admission.status==="REJECTED") return {jobCommands:[],visibilityFloor:priorReceipt?.issuedAt??null};
  assertIssuedSourceQualityAdmission(input.admission,input.result,input.plan);
  const receipt=input.admission.receipt;
  if(getSourceQualityPolicy(input.plan)!==receipt.policyId||input.plan.source.id!==receipt.binding.sourceId||
      sourcePlanConfigSha256(input.plan)!==receipt.binding.sourceConfigSha256||input.result.status!=="SUCCESS")
    throw new Error("SOURCE_QUALITY_PUBLICATION_BINDING_INVALID");
  const visibilityFloor=priorReceipt?.issuedAt??receipt.issuedAt;
  const floor=Date.parse(visibilityFloor),observed=Date.parse(receipt.issuedAt);
  if(!Number.isFinite(floor)||new Date(floor).toISOString()!==visibilityFloor||floor>observed)
    throw new Error("SOURCE_QUALITY_VISIBILITY_FLOOR_INVALID");
  if(input.previousJobs.some(job=>job.record.sourceId!==receipt.binding.sourceId||job.record.companyId!==receipt.companyId))
    throw new Error("SOURCE_QUALITY_PRIOR_SOURCE_MISMATCH");
  const currentKeys=new Set(input.result.jobs.map(buildJobDedupeKey));
  // Retain firstSeen for currently observed legacy rows; no legacy-only row gets initial grace.
  // Later grace is limited to rows seen during this accepted policy/config era.
  const closed=exactNovoChinaQualityPlan(input.plan)&&input.result.fetchEvidence
    ?novoClosedSourceJobIds(input.result.fetchEvidence):new Set<string>();
  const closedUrls=hasNovartisOfficialPresencePlan(input.plan)
    ?replayNovartisOfficialPresence(input.plan,input.result.fetchEvidence!).closedUrls:new Set<string>();
  const previous=input.previousJobs.filter(job=>!closedUrls.has(job.record.officialUrl)&&!closed.has(job.record.sourceJobId??"")&&(currentKeys.has(job.dedupeKey)||
    priorReceipt!==null&&Date.parse(job.lastSeenAt)>=floor));
  const lifecycle=applyCrawlObservation(previous,input.result.jobs,{
    observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:receipt.issuedAt,
    baselineCompletedBeforeCrawl:input.baselineCompletedBeforeCrawl
  });
  return {jobCommands:buildIngestionCommands(input.result,lifecycle).filter(
    (command):command is Extract<IngestionCommand,{type:"UPSERT_JOB"}>=>command.type==="UPSERT_JOB"),visibilityFloor};
}
