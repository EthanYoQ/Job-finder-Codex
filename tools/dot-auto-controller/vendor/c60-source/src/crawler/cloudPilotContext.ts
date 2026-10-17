import { restoreJobProjectionLifecycleContext, unwrapJobProjectionSourceRow } from "../db/jobProjectionDeltaCompiler";
import { z } from "zod";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import { reviveUtcFields } from "./cloudSourcePilotRelay";
import { createPrismaCrawlRuntimeDeps, type PrismaCrawlRuntimeDb } from "../db/crawlRuntimeRepository";
import { toPrismaJobCategory } from "../db/prismaMappers";
import { JOB_CATEGORIES } from "../domain/search";
import { NormalizedJobRecordSchema } from "./normalizedJob";
import { verifyAGradeCompletenessCertificateReceipt } from "./completenessCertificate";
import { requiresBGradeTraversalCertificate, verifyBGradeTraversalCertificateReceipt } from "./traversalCertificate";
const record=z.record(z.unknown());
const sha=z.string().regex(/^[a-f0-9]{64}$/u);
const sanofiArtifactCommitmentSchema=z.object({releaseCandidateId:z.string().min(1),batchId:z.string().min(1),sourceResultId:z.string().min(1),sourceId:z.literal("source-sanofi-china-social"),kind:z.enum(["ORACLE_RESULT","ATS_PAGE","COMMAND_OUTPUT","PAGINATION_PAGE","OFFICIAL_COMPANY_PAGE"]),sha256:sha,extractorLocator:z.string().min(1),byteCount:z.number().int().positive().optional(),capturedAt:z.string().datetime().optional()}).strict();
/** The raw-set commitment must come from the persisted observation, not the
 * certificate it independently checks. Never revive or rewrite certificate JSON. */
function bGradeObservation(row:Record<string,unknown>){
  if(!Array.isArray(row.observations)||row.observations.length!==1)throw Error("PILOT_B_BASELINE_OBSERVATION_REQUIRED");
  z.string().min(1).parse(row.adapterVersion);
  sha.parse(row.canonicalCurrentJobSetSha256);
  const observation=reviveUtcFields(record.parse(row.observations[0]),["observedFrom","observedTo","crawledAt"]);
  const result=reviveUtcFields(row,["startedAt","finishedAt"]);
  if(!(result.startedAt instanceof Date)||!(result.finishedAt instanceof Date)||
    !(observation.observedFrom instanceof Date)||!(observation.observedTo instanceof Date)||!(observation.crawledAt instanceof Date)||
    observation.sourceResultId!==row.id||observation.batchId!==row.batchId||observation.releaseCandidateId!==row.releaseCandidateId||
    observation.sourceId!==row.sourceId||observation.sourceConfigSha256!==row.sourceConfigHash||observation.adapterVersion!==row.adapterVersion||
    observation.observedFrom.getTime()!==result.startedAt.getTime()||observation.observedTo.getTime()!==result.finishedAt.getTime()||
    observation.crawledAt<result.startedAt||observation.crawledAt>result.finishedAt||
    observation.successful!==true||observation.transportSucceeded!==true||observation.adapterSucceeded!==true||
    observation.completenessVerified!==true||observation.atomicCommitSucceeded!==true||
    observation.canonicalOutputSha256!==row.canonicalOutputSetSha256||row.canonicalOutputSetSha256!==row.canonicalCurrentJobSetSha256)
    throw Error("PILOT_B_BASELINE_OBSERVATION_MISMATCH");
  return {observation,finishedAt:result.finishedAt,canonicalRawEvidenceIdSetSha256:sha.parse(observation.canonicalRawSha256)};
}
/** Parent-reviewed raw SQL rows, never previously serialized owned authority. */
export async function loadPilotContext(value:unknown,plan:SourceCrawlPlan,aGrade=false){
  const context=z.object({sourceId:z.literal(plan.source.id),sourceConfigSha256:z.literal(sourcePlanConfigSha256(plan)),jobs:z.array(record),latestAccepted:record.nullable(),firstAccepted:record.nullable()}).passthrough().parse(value);
  if((context.latestAccepted===null)!==(context.firstAccepted===null))throw Error("PILOT_BASELINE_PAIR_REQUIRED");
  const logicalJobs=restoreJobProjectionLifecycleContext(context.jobs,context.latestAccepted);
  context.latestAccepted=context.latestAccepted?unwrapJobProjectionSourceRow(context.latestAccepted):null;
  context.firstAccepted=context.firstAccepted?unwrapJobProjectionSourceRow(context.firstAccepted):null;
  const jobs=logicalJobs.map(row=>{
    if(row.sourceId!==plan.source.id||row.companyId!==plan.company.id)throw Error("PILOT_PRIOR_SOURCE_MISMATCH");
    const category=toPrismaJobCategory(z.enum(JOB_CATEGORIES).parse(row.category));
    z.enum(["ACTIVE","SUSPECTED_OFFLINE","OFFLINE"]).parse(row.lifecycleStatus);
    z.number().int().nonnegative().parse(row.missingSuccessCount);
    return {...reviveUtcFields(row,["firstSeenAt","lastSeenAt","officialPublishedAt"]),category};
  });
  const receiptRow=(row:Record<string,unknown>|null)=>row?reviveUtcFields(row,["finishedAt"]):null;
  if(aGrade)for(const row of [context.firstAccepted,context.latestAccepted])if(row){
    if(row.sourceId!==plan.source.id||row.sourceConfigHash!==context.sourceConfigSha256)throw Error("PILOT_A_BASELINE_CONFIG_MISMATCH");
    const expected={releaseCandidateId:z.string().parse(row.releaseCandidateId),batchId:z.string().parse(row.batchId),sourceResultId:z.string().parse(row.id),sourceId:plan.source.id,companyId:plan.company.id,sourceConfigSha256:context.sourceConfigSha256,canonicalJobSetSha256:z.string().parse(row.canonicalCurrentJobSetSha256),surfaceIds:z.array(z.string()).parse(row.officialSurfaceIds),channelIds:z.array(z.string()).parse(row.officialChannelIds)};
    if(requiresBGradeTraversalCertificate(plan)){
      const {observation,finishedAt,canonicalRawEvidenceIdSetSha256}=bGradeObservation(row);
      verifyBGradeTraversalCertificateReceipt({now:finishedAt,certificate:row.completenessCertificate,certificateSha256:z.string().parse(row.completenessCertificateSha256),expected:{...expected,canonicalRawEvidenceIdSetSha256,adapterReconciliationSha256:sha.parse(row.adapterReconciliationSha256),collisionLedgerSha256:sha.parse(row.collisionLedgerSha256),...(plan.source.id==="source-sanofi-china-social"?{sanofiArtifacts:z.array(sanofiArtifactCommitmentSchema).min(1).parse(row.evidenceArtifacts)}:{})}});
      const certificate=row.completenessCertificate as {issuedAt:string;mainTraversal:{paginationTraceSha256:string}};
      if(finishedAt.toISOString()!==certificate.issuedAt||observation.paginationTraceSha256!==certificate.mainTraversal.paginationTraceSha256)throw Error("PILOT_B_BASELINE_OBSERVATION_MISMATCH");
    }else verifyAGradeCompletenessCertificateReceipt({certificate:row.completenessCertificate,certificateSha256:z.string().parse(row.completenessCertificateSha256),expected});
  }
  const runtime=createPrismaCrawlRuntimeDeps({
    job:{findMany:async()=>jobs},crawlObservation:{findMany:async()=>{throw Error("PILOT_OBSERVATIONS_NOT_SUPPORTED");}},
    crawlBatchSourceResult:{findFirst:async (args:Parameters<NonNullable<PrismaCrawlRuntimeDb["crawlBatchSourceResult"]>["findFirst"]>[0])=>{
      if(args.where.sourceId!==plan.source.id||(!aGrade||args.where.sourceConfigHash!==undefined)&&args.where.sourceConfigHash!==context.sourceConfigSha256)throw Error("PILOT_BASELINE_QUERY_MISMATCH");
      return receiptRow(args.orderBy.finishedAt==="asc"?context.firstAccepted:context.latestAccepted);
    }}
  } as unknown as PrismaCrawlRuntimeDb,aGrade?undefined:{portablePlans:[plan]});
  const previousJobs=await runtime.getPreviousJobs(plan.source.id);
  previousJobs.forEach(job=>NormalizedJobRecordSchema.parse(job.record));
  const trustedCompletenessBaseline=await runtime.getTrustedCompletenessBaseline(plan.source.id);
  const firstAcceptedCurrentPolicyReceipt=aGrade?null:await runtime.getFirstAcceptedCurrentPolicyReceipt(plan.source.id,context.sourceConfigSha256);
  return {previousJobs,trustedCompletenessBaseline,firstAcceptedCurrentPolicyReceipt,baselineCompletedBeforeCrawl:trustedCompletenessBaseline!==null,acceptedVisibilityFloor:aGrade&&context.firstAccepted?reviveUtcFields(context.firstAccepted,["finishedAt"]).finishedAt as Date:null};
}
