import { createAstraZenecaDetailSourceFetch, hasAstraZenecaDetailPlan } from "./astraZenecaDetailAcquisition";
import { readFile } from "node:fs/promises";
import { deserialize } from "node:v8";
import { join } from "node:path";
import { acquireAstellasPdfCities, hasAstellasPdfCityPlan } from "./astellasPdfCityAcquisition";
import { getPortableSourceCoverageHold } from "../release/portableSourceCoverageHolds";
import { createPresenceCheckedHttpHtmlSourceFetch } from "./httpHtmlSourceFetch";
import { hasNovartisOfficialPresencePlan, replayNovartisOfficialPresence } from "./novartisOfficialPresence";
import type { AtomicSourceEvidenceCommit, AtomicEvidenceArtifactInput, AtomicPaginationEvidenceInput } from "../db/ingestionRepository";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertAdapterReconciliation } from "./adapters/reconciliation";
import { assertVerifiedArchivedEvidenceMetadata, verifyArchivedSourceEvidence, type ArchivedEvidenceArtifact } from "./artifactArchive";
import { createMokaSourceFetch } from "./mokaSourceFetch";
import { createWorkdaySourceFetch } from "./workdaySourceFetch";
import { createHotjobWecruitSourceFetch } from "./hotjobWecruitSourceFetch";
import { createHotjobLegacySourceFetch } from "./hotjobLegacySourceFetch";
import { createOfficialJsonSourceFetch } from "./officialJsonSourceFetch";
import { createProfileBoundSourceFetch } from "./profileBoundSourceFetch";
import { createUnsupportedSourceFetch } from "./unsupportedSourceFetch";
import { createSourceFetchRouter } from "./sourceFetchRouter";
import { replayStrictSourceQualityEvidenceAsync, runSourceCrawl, type SourceCrawlResult, type SourceFetchFunction, type SourceFetchResult } from "./runSourceCrawl";
import { sourcePlanConfigSha256, validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { canonicalPageTraceSha256, canonicalStringSetSha256, parsePersistentSourceFetchEvidence, type PersistentSourceFetchEvidence, type SourceFetchPageTrace } from "./sourceFetchEvidence";
import { buildJobDedupeKey, NormalizedJobRecordSchema } from "./normalizedJob";

export const SOURCE_QUALITY_POLICY_ID = "PLAN_BOUND_SOURCE_QUALITY_V1" as const;
export const SOURCE_QUALITY_RECEIPT_SCHEMA = "plan-bound-source-quality-v1" as const;
const MAX_ISSUANCE_AGE_MS = 30 * 60 * 1000;
const MAX_REVIEWED_CAPTURE_AGE_MS = 24 * 60 * 60 * 1000;
// Match the pending narrow SQL rule. This bounds capture duration and the
// subsequent wait separately; it does not claim every artifact is <24h old.
const LONG_RETAINED_CAPTURE_SOURCES = new Set(["source-novo-nordisk-china-social","source-csl-china-social","source-lilly-china-social"]);
const captureAgeLimitMs = (sourceId:string,retained:boolean) =>
  retained&&LONG_RETAINED_CAPTURE_SOURCES.has(sourceId)?MAX_REVIEWED_CAPTURE_AGE_MS:MAX_ISSUANCE_AGE_MS;
// Reviewed configurations, not live counts or IDs. A profile edit requires an explicit review here.
const REVIEWED_CONFIGS: Readonly<Record<string, string>> = Object.freeze({
  "source-csl-china-social": "eb4583bc629171783b293f162837776c6f68e63b7e81cc40540b83aed6e06694",
  "source-gilead-china-social": "bdb31408948240f810347b6ba217407b0b50c9327c9600b4115a2a7a0869e40c",
  "source-novo-nordisk-china-social": "40305820c3aa3f36e74f06873c0ddd1a52266cb74d277b3a36137c81fc5c604e",
  "source-organon-china-social": "d56e212c03224c44b0be11afc07709ae9b2fbfd2a69c24ce773c0f192fa603d2",
  "source-lilly-china-social": "34ac4d47a1b69389e567b53df64062f10ed50a1d34cb0b4876d3c9af85e68c97",
  "source-biogen-china-social": "47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348",
  "source-merck-china-social": "3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38",
  "source-bms-china-social": "e0d783cbc8fc887e1697db6d86cb0abb8058ca6793cd32752055271c022ca137",
  "source-ucb-china-social": "0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146",
  "source-grifols-china-social": "614ac95db03986792bf1a42a856a403e747165f1b3a94d8588d49f2016c522c7",
  "source-abbvie-china-social": "4bc13113d0ea829b7df6935081d009ac389f24c97340390f09bbb7ad5234e5a9",
  "source-hengrui-social": "93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e",
  "source-fosun-pharma-social": "0227ec8d384900a48b2973f128908f7e9435d4bc991efd9a5b14ea5a3d1042b2",
  "source-boehringer-ingelheim-china-social": "86abb89ac25980acc5e9e3c82741a3415138f53f321f1050c4ae849efd4132de",
  "source-hansoh-social": "94d0982064af5a70386e017dec29cec1115c08480df2934e8d4cf0ddf644d740",
  "source-qilu-social": "0ca38d0cd6550e9567cc3e7ca6772d3b91497f5a59530f5359f823a6c62d5773",
  "source-cspc-social": "5fbeee6e6b8d95f05d2b8771908f206ba8f45eea32a6208f21490a058332d409",
  "source-novartis-social": "1dcb83b63182c3b496a1137678baae55201276b4e041b60b6cbe1fab30990a91",
  "source-takeda-china-social": "048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f",
  "source-viatris-social": "5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9",
  "source-astellas-china-social": "d3a6153703eeb204c9626e2b45e75d0d9dfcc65865c49066be6ec7a34dec88bc",
  "source-kelun-social": "9fe0cb0d7c308567f6010aa6181f36c595b97df739ecd528cab97070f47572cb"
});
const SHA = z.string().regex(/^[0-9a-f]{64}$/u);
const ID = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
const ISO = z.string().datetime();
const COUNT = z.number().int().nonnegative().safe();
const bindingSchema = z.object({releaseCandidateId:ID,batchId:ID,sourceResultId:ID,sourceId:ID,
  sourceConfigSha256:SHA,adapterVersion:SHA}).strict();
const receiptSchema = z.object({
  schemaVersion:z.literal(SOURCE_QUALITY_RECEIPT_SCHEMA),policyId:z.literal(SOURCE_QUALITY_POLICY_ID),
  proofBasis:z.literal("PLAN_BOUND_ARCHIVED_RESPONSE_REPLAY"),
  binding:bindingSchema,companyId:ID,
  acquisition:z.object({id:z.string().uuid(),startedAt:ISO,finishedAt:ISO,
    origin:z.literal("REVIEWED_RETAINED_CAPTURE").optional(),manifestSha256:SHA.optional()}).strict(),issuedAt:ISO,
  surfaceIds:z.array(ID).min(1),channelIds:z.array(z.string().min(1)).min(1),
  sourceEvidenceSha256:SHA,artifactManifestSha256:SHA,paginationTraceSha256:SHA,paginationRowsSha256:SHA,canonicalRawEvidenceIdSetSha256:SHA,
  counts:z.object({rawCount:COUNT,parsedCount:COUNT,validCount:COUNT,parseDiscardCount:COUNT,
    validationDiscardCount:COUNT,normalizationDiscardCount:COUNT,dedupeInputCount:COUNT,
    dedupeDiscardCount:COUNT,collisionCount:COUNT,finalUniqueJobCount:COUNT}).strict(),
  ledger:z.object({adapterReconciliationSha256:SHA,fetchLossLedgerSha256:SHA,collisionLedgerSha256:SHA,atomicLossLedgerSha256:SHA}).strict(),
  output:z.object({canonicalJobKeySetSha256:SHA,jobsSha256:SHA}).strict(),
  observation:z.object({crawledAt:ISO,expectedJobCount:COUNT.nullable(),expectedEvidenceKind:z.enum(["OFFICIAL_TOTAL_COUNT","OFFICIAL_TOTAL_PAGES","COMPLETE_PAGE_TRAVERSAL"]),stableRequiredFields:z.array(z.string().min(1))}).strict(),
  declaredCompleteness:z.object({kind:z.enum(["OFFICIAL_TOTAL_COUNT","OFFICIAL_TOTAL_PAGES","COMPLETE_PAGE_TRAVERSAL"]),
    value:COUNT,scope:z.enum(["SOURCE","CHANNEL"])}).strict()
}).strict();
export type SourceQualityReceipt = z.infer<typeof receiptSchema>;
export type SourceQualityBinding = Omit<z.infer<typeof bindingSchema>, "sourceId">;
export type SourceQualityAdmission =
  | {status:"ACCEPTED";receipt:SourceQualityReceipt;receiptSha256:string}
  | {status:"REJECTED";codes:string[]};
export interface SourceQualityAdmissionInput {
  plan:SourceCrawlPlan;result:SourceCrawlResult;binding:SourceQualityBinding;
  archive:{workspaceRoot:string;evidenceSubdirectory:string;artifacts:readonly ArchivedEvidenceArtifact[]};
}
interface OwnedAcquisition {
  id:string;sourceId:string;configHash:string;startedAt:string;finishedAt:string;
  origin?:"REVIEWED_RETAINED_CAPTURE";manifestSha256?:string;
  evidenceSha256:string;fetched:SourceFetchResult;boundTuple?:string;
  accepted?:Extract<SourceQualityAdmission,{status:"ACCEPTED"}>;
}
const acquisitions = new WeakMap<PersistentSourceFetchEvidence, OwnedAcquisition>();
const issuedArchiveReplays = new WeakMap<object, SourceQualityAdmissionInput>();
const issued = new WeakMap<object,{receiptSha256:string;resultSha256:string;planSha256:string}>();

export function getSourceQualityPolicy(plan:SourceCrawlPlan): typeof SOURCE_QUALITY_POLICY_ID | null {
  try {
    validateExecutablePlanChannelBinding(plan);
    return Object.hasOwn(REVIEWED_CONFIGS,plan.source.id) && REVIEWED_CONFIGS[plan.source.id]===sourcePlanConfigSha256(plan)
      ? SOURCE_QUALITY_POLICY_ID : null;
  } catch { return null; }
}

/** Normal acquisition route. No imported-evidence or caller-supplied transport option.
 * The volatile registration prevents files/receipts from being relabeled as a new fetch.
 * It trusts this process and its ordinary transport; it is not remote attestation. */
export function createHttpOnlyOfficialSourceFetch(): SourceFetchFunction {
  const html=createPresenceCheckedHttpHtmlSourceFetch(),astra=createAstraZenecaDetailSourceFetch();
  return createSourceFetchRouter({html:(plan,tracker)=>hasAstraZenecaDetailPlan(plan)?astra(plan,tracker):html(plan,tracker),moka:createMokaSourceFetch(),officialJson:createOfficialJsonSourceFetch({allowBrowserFallback:false}),
    workday:createWorkdaySourceFetch(),hotjob:createHotjobWecruitSourceFetch(),hotjobLegacy:createHotjobLegacySourceFetch(),
    profileBoundSource:createProfileBoundSourceFetch(),fallback:createUnsupportedSourceFetch()});
}
export function createOwnedSourceQualityFetch(): SourceFetchFunction {
  const fetch = createHttpOnlyOfficialSourceFetch();
  return async (plan,tracker) => {
    const coverageHold=getPortableSourceCoverageHold(plan.source.id);
    if(coverageHold)throw new Error(coverageHold);
    if (!getSourceQualityPolicy(plan)) throw new Error("SOURCE_QUALITY_POLICY_NOT_REVIEWED");
    if (plan.transportPolicy?.fallback || (plan.adapterId === "official-json" && plan.profileBoundSource?.kind === "jnj-careers-china")) {
      throw new Error("PORTABLE_HTTP_ONLY_TRANSPORT_REQUIRED");
    }
    const immutablePlan=structuredClone(plan);
    const configHash=sourcePlanConfigSha256(immutablePlan);
    const startedAt = new Date().toISOString();
    const result = await acquireAstellasPdfCities(immutablePlan, await fetch(immutablePlan,tracker));
    const finishedAt = new Date().toISOString();
    if (result.ok && result.fetchEvidence) {
      acquisitions.set(result.fetchEvidence,{id:randomUUID(),sourceId:plan.source.id,configHash,
        startedAt,finishedAt,evidenceSha256:digest(result.fetchEvidence),fetched:structuredClone(result)});
    }
    return result;
  };
}

/** Explicit import of reviewed original public responses. No network or clock
 * substitution: every response retains its recorded timestamp and body hash. */
export async function createReviewedRetainedNovoFetch(path:string,expectedSha256:string):Promise<SourceFetchFunction>{
  const bytes=await readFile(path);
  if(!SHA.safeParse(expectedSha256).success||createHash("sha256").update(bytes).digest("hex")!==expectedSha256)throw Error("RETAINED_CAPTURE_HASH_MISMATCH");
  const capture=z.object({requestedUrl:z.string().url(),finalUrl:z.string().url(),httpStatus:z.literal(200),contentType:z.string(),capturedAt:ISO,body:z.string(),bodySha256:SHA}).passthrough();
  const input=z.object({schemaVersion:z.literal(1),sourceId:z.literal("source-novo-nordisk-china-social"),sourceConfigSha256:z.literal(REVIEWED_CONFIGS["source-novo-nordisk-china-social"]!),captures:z.array(capture).min(2).max(1002)}).passthrough().parse(JSON.parse(bytes.toString("utf8")));
  const map=new Map(input.captures.map(c=>[c.requestedUrl,c]));
  if(map.size!==input.captures.length||input.captures.some(c=>createHash("sha256").update(c.body).digest("hex")!==c.bodySha256))throw Error("RETAINED_CAPTURE_BODY_BINDING");
  const times=input.captures.map(c=>Date.parse(c.capturedAt)),startedAt=new Date(Math.min(...times)).toISOString(),finishedAt=new Date(Math.max(...times)).toISOString();
  const ownedTime={startedAt,finishedAt,origin:"REVIEWED_RETAINED_CAPTURE" as const};
  if(!fresh(ownedTime,new Date(),input.sourceId))throw Error("RETAINED_CAPTURE_TOO_OLD");
  return async(plan,tracker)=>{
    if(plan.source.id!==input.sourceId||sourcePlanConfigSha256(plan)!==input.sourceConfigSha256||!getSourceQualityPolicy(plan))throw Error("RETAINED_CAPTURE_SOURCE_BINDING");
    const used=new Set<string>();let first=true;
    const fetch=createOfficialJsonSourceFetch({allowBrowserFallback:false,now:()=>{const result=new Date(first?startedAt:finishedAt);first=false;return result;},http:async request=>{
      const c=map.get(request.url);if(!c||request.method&&request.method!=="GET"||request.body||used.has(request.url))throw Error("RETAINED_CAPTURE_REQUEST_BINDING");
      used.add(request.url);return {status:c.httpStatus,body:c.body,finalUrl:c.finalUrl,contentType:c.contentType,capturedAt:c.capturedAt};
    }});
    const result=await fetch(plan,tracker);
    if(!result.ok||!result.fetchEvidence||used.size!==map.size)throw Error("RETAINED_CAPTURE_REPLAY_FAILED");
    acquisitions.set(result.fetchEvidence,{id:randomUUID(),sourceId:plan.source.id,configHash:input.sourceConfigSha256,...ownedTime,manifestSha256:expectedSha256,evidenceSha256:digest(result.fetchEvidence),fetched:structuredClone(result)});
    return result;
  };
}

/** Import a collaborating cloud capture without relabeling its original observation
 * time. Admission still replays the source's raw bodies, adapter and archived bytes. */
export async function createReviewedRetainedSourceFetch(path:string,expectedSha256:string):Promise<SourceFetchFunction>{
  const bytes=await readFile(path);
  if(!SHA.safeParse(expectedSha256).success||createHash("sha256").update(bytes).digest("hex")!==expectedSha256)throw Error("RETAINED_CAPTURE_HASH_MISMATCH");
  const value=JSON.parse(bytes.toString("utf8"));
  if(value.schemaVersion===1)return createReviewedRetainedNovoFetch(path,expectedSha256);
  const input=z.object({schemaVersion:z.literal(2),sourceId:ID,sourceConfigSha256:SHA,startedAt:ISO,finishedAt:ISO,
    fetched:z.object({path:z.string().min(1),sha256:SHA,encoding:z.enum(["json","v8"])}).strict()}).strict().parse(value);
  const original=await readFile(input.fetched.path);
  if(createHash("sha256").update(original).digest("hex")!==input.fetched.sha256)throw Error("RETAINED_CAPTURE_BODY_BINDING");
  const fetched=(input.fetched.encoding==="v8"?deserialize(original):JSON.parse(original.toString("utf8"))) as SourceFetchResult;
  if(!fetched||fetched.ok!==true||!fetched.fetchEvidence||!ISO.safeParse(fetched.capturedAt).success)throw Error("RETAINED_CAPTURE_REPLAY_FAILED");
  fetched.fetchEvidence=parsePersistentSourceFetchEvidence(fetched.fetchEvidence);
  const ownedTime={startedAt:input.startedAt,finishedAt:input.finishedAt,origin:"REVIEWED_RETAINED_CAPTURE" as const};
  if(!fresh(ownedTime,new Date(),input.sourceId))throw Error("RETAINED_CAPTURE_TOO_OLD");
  return async plan=>{
    if(plan.source.id!==input.sourceId||sourcePlanConfigSha256(plan)!==input.sourceConfigSha256||!getSourceQualityPolicy(plan)||getPortableSourceCoverageHold(plan.source.id))throw Error("RETAINED_CAPTURE_SOURCE_BINDING");
    const result=structuredClone(fetched);
    acquisitions.set(result.fetchEvidence!,{id:randomUUID(),sourceId:plan.source.id,configHash:input.sourceConfigSha256,...ownedTime,manifestSha256:expectedSha256,evidenceSha256:digest(result.fetchEvidence),fetched:structuredClone(result)});
    return result;
  };
}

export async function issueSourceQualityAdmission(input:SourceQualityAdmissionInput):Promise<SourceQualityAdmission> {
  const reject = (code:string):SourceQualityAdmission => ({status:"REJECTED",codes:[code]});
  const plan=structuredClone(input.plan);
  const archiveInput=structuredClone(input.archive);
  const planSha256=digest(plan),resultSha256=digest(input.result);
  const coverageHold=getPortableSourceCoverageHold(plan.source.id);
  if(coverageHold)return reject(coverageHold);
  if (!getSourceQualityPolicy(plan)) return reject("SOURCE_QUALITY_POLICY_NOT_REVIEWED");
  const owned = input.result.fetchEvidence && acquisitions.get(input.result.fetchEvidence);
  if (!owned) return reject("OWNED_ACQUISITION_REQUIRED");
  let binding:z.infer<typeof bindingSchema>;
  try { binding=bindingSchema.parse({...input.binding,sourceId:plan.source.id}); }
  catch { return reject("QUALITY_BINDING_INVALID"); }
  if (binding.sourceConfigSha256!==owned.configHash || owned.sourceId!==binding.sourceId ||
      binding.sourceConfigSha256!==sourcePlanConfigSha256(plan)) return reject("QUALITY_BINDING_INVALID");
  const tuple=digest(binding);
  if (owned.boundTuple && owned.boundTuple!==tuple) return reject("ACQUISITION_ALREADY_BOUND");
  // Claim before awaiting IO so concurrent issuance cannot relabel a capture into another batch.
  owned.boundTuple=tuple;
  if (digest(input.result.fetchEvidence)!==owned.evidenceSha256) return reject("ACQUISITION_MUTATED");
  const now = new Date();
  if (!fresh(owned,now,owned.sourceId)) return reject("ACQUISITION_NOT_FRESH");
  let result:SourceCrawlResult;
  let evidence:PersistentSourceFetchEvidence;
  try {
    result=structuredClone(input.result);
    evidence=parsePersistentSourceFetchEvidence(result.fetchEvidence);
    if (hasNovartisOfficialPresencePlan(plan)) replayNovartisOfficialPresence(plan,evidence);
    if (!sourceQualityPageBodiesMatchFingerprints(evidence)) return reject("PAGE_BODY_FINGERPRINT_MISMATCH");
    if (!owned.fetched.ok || result.status!=="SUCCESS" || !result.paginationEvaluation ||
        !evidence.declaredCompleteness || evidence.declaredCompleteness.scope==="GLOBAL_UNFILTERED") return reject("SOURCE_QUALITY_REPLAY_FAILED");
    const times=[result.observation.crawledAt.getTime(),...evidence.artifacts.map(a=>Date.parse(a.capturedAt)),...evidence.pages.map(p=>Date.parse(p.capturedAt))];
    if (times.some(t=>!Number.isFinite(t)||t<Date.parse(owned.startedAt)||t>Date.parse(owned.finishedAt))) return reject("CAPTURE_TIME_OUTSIDE_ACQUISITION");
    for (const job of result.jobs) NormalizedJobRecordSchema.parse(job);
    const ledger=assertAdapterReconciliation(result);
    if (!await replayStrictSourceQualityEvidenceAsync({plan:plan,evidence,paginationEvaluation:result.paginationEvaluation,
      reconciliation:ledger,jobs:result.jobs,capturedAt:owned.fetched.capturedAt})) return reject("SOURCE_QUALITY_REPLAY_FAILED");
    // Recompute the adapter output/ledger from the unchanged owned acquisition as well.
    const replay=await runSourceCrawl(plan,{fetch:()=>structuredClone(owned.fetched),isBaseline:result.jobs[0]?.isBaseline ?? true});
    if (digest(replay.jobs)!==digest(result.jobs)||digest(replay.reconciliation)!==digest(result.reconciliation)||
        digest(replay.observation)!==digest(result.observation)) return reject("SOURCE_OUTPUT_OR_LEDGER_MISMATCH");
  } catch { return reject("SOURCE_QUALITY_REPLAY_FAILED"); }
  let artifacts:ArchivedEvidenceArtifact[];
  try {
    artifacts=structuredClone([...archiveInput.artifacts]);
    const drafts=[...evidence.artifacts,...(result.priorTransportAttempts??[]).flatMap(a=>a.fetchEvidence?.artifacts??[])];
    const request={...archiveInput,artifacts,...binding,sourceId:plan.source.id};
    assertVerifiedArchivedEvidenceMetadata(request,drafts.map(draft=>({...draft,
      id:artifacts.find(a=>a.logicalKey===draft.logicalKey)?.id??"missing"})));
    await verifyArchivedSourceEvidence(request);
    if (hasAstellasPdfCityPlan(plan)) await replayAstellasArchivedSourceQuality({...input,plan,result,archive:archiveInput});
  } catch { return reject("ARCHIVE_VERIFICATION_FAILED"); }
  if (digest(input.result.fetchEvidence)!==owned.evidenceSha256) return reject("ACQUISITION_MUTATED");
  if (!fresh(owned,new Date(),owned.sourceId)) return reject("ACQUISITION_NOT_FRESH");
  if(digest(input.plan)!==planSha256||digest(input.result)!==resultSha256) return reject("ISSUANCE_INPUT_MUTATED");
  if(owned.accepted) {
    try { assertIssuedSourceQualityAdmission(owned.accepted,input.result,input.plan);return owned.accepted; }
    catch { return reject("ISSUANCE_INPUT_MUTATED"); }
  }
  const ledger=assertAdapterReconciliation(result);
  const receipt:SourceQualityReceipt=receiptSchema.parse({schemaVersion:SOURCE_QUALITY_RECEIPT_SCHEMA,
    policyId:SOURCE_QUALITY_POLICY_ID,proofBasis:"PLAN_BOUND_ARCHIVED_RESPONSE_REPLAY",binding,companyId:plan.company.id,
    acquisition:{id:owned.id,startedAt:owned.startedAt,finishedAt:owned.finishedAt,...(owned.origin?{origin:owned.origin,manifestSha256:owned.manifestSha256}: {})},issuedAt:new Date().toISOString(),
    surfaceIds:[plan.source.surfaceId!],channelIds:plan.expectedChannels!.map(c=>c.channelId).sort(),
    sourceEvidenceSha256:owned.evidenceSha256,artifactManifestSha256:digest(artifacts.map(artifactProjection)),
    paginationTraceSha256:canonicalPageTraceSha256(evidence.pages),
    paginationRowsSha256:digest(evidence.pages.map(paginationProjection)),canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(evidence.pages.flatMap(p=>p.rawJobIds)),
    counts:{...evidence.fetchCounts,normalizationDiscardCount:0,dedupeInputCount:ledger.dedupeInputCount,
      dedupeDiscardCount:ledger.collisionGroups.reduce((n,g)=>n+g.droppedCount,0),collisionCount:ledger.collisionGroups.length,finalUniqueJobCount:result.jobs.length},
    ledger:{adapterReconciliationSha256:ledger.ledgerSha256,fetchLossLedgerSha256:digest(evidence.fetchLosses),collisionLedgerSha256:digest(ledger.collisionGroups),atomicLossLedgerSha256:digest([
      ...evidence.fetchLosses.map(loss=>lossProjection(loss)),
      ...ledger.collisionGroups.flatMap(group=>group.candidateKeySha256.slice(1).map(candidate=>lossProjection({stage:"DEDUPE",reason:group.dropReason,rawLocator:`collision:${group.dedupeKeySha256}`,details:{code:group.dropReason,collisionGroupKey:group.dedupeKeySha256},candidateKey:candidate,winnerKey:group.winnerKeySha256})))
    ])},
    output:{canonicalJobKeySetSha256:canonicalStringSetSha256(result.jobs.map(buildJobDedupeKey)),jobsSha256:jobRecordsDigest(result.jobs)},
    observation:{crawledAt:result.observation.crawledAt.toISOString(),expectedJobCount:result.observation.expectedJobCount??null,expectedEvidenceKind:result.observation.completenessEvidenceKind,stableRequiredFields:[...result.observation.stableRequiredFields].sort()},
    declaredCompleteness:{kind:evidence.declaredCompleteness!.kind,value:evidence.declaredCompleteness!.value,scope:evidence.declaredCompleteness!.scope}
  });
  const decision:Extract<SourceQualityAdmission,{status:"ACCEPTED"}>={status:"ACCEPTED",receipt,receiptSha256:digest(receipt)};
  verifySourceQualityReceipt({receipt,receiptSha256:decision.receiptSha256,expected:binding});
  if (hasAstellasPdfCityPlan(plan)) issuedArchiveReplays.set(decision,structuredClone({...input,plan,result,archive:archiveInput}));
  deepFreeze(decision);issued.set(decision,{receiptSha256:decision.receiptSha256,resultSha256,planSha256});owned.accepted=decision;
  return decision;
}

/** Re-read the verified physical archive, bind bytes to the owned drafts, and
 * rederive locations again. Called at issuance and immediately before DB writes. */
async function replayAstellasArchivedSourceQuality(input:SourceQualityAdmissionInput):Promise<void> {
  const evidence=parsePersistentSourceFetchEvidence(structuredClone(input.result.fetchEvidence));
  for(const draft of evidence.artifacts){
    const archived=input.archive.artifacts.find(a=>a.logicalKey===draft.logicalKey);
    if(!archived)throw Error("ASTELLAS_ARCHIVED_ARTIFACT_MISSING");
    const bytes=await readFile(join(input.archive.workspaceRoot,archived.path));
    if(bytes.byteLength!==archived.byteCount||createHash("sha256").update(bytes).digest("hex")!==archived.sha256)throw Error("ASTELLAS_ARCHIVED_BYTES_CHANGED");
    draft.body=typeof draft.body==="string"?bytes.toString("utf8"):bytes;
  }
  if(!input.result.paginationEvaluation||!await replayStrictSourceQualityEvidenceAsync({plan:input.plan,evidence,
    paginationEvaluation:input.result.paginationEvaluation,reconciliation:assertAdapterReconciliation(input.result),
    jobs:input.result.jobs,capturedAt:input.result.observation.crawledAt.toISOString()}))throw Error("ASTELLAS_ARCHIVED_REPLAY_FAILED");
}
export async function verifyIssuedSourceQualityArchiveForPersistence(admission:SourceQualityAdmission):Promise<void> {
  if(admission.status!=="ACCEPTED"||admission.receipt.binding.sourceId!=="source-astellas-china-social")return;
  const input=issuedArchiveReplays.get(admission);
  if(!input)throw Error("ASTELLAS_ISSUED_ARCHIVE_REPLAY_REQUIRED");
  await verifyArchivedSourceEvidence({...input.archive,artifacts:[...input.archive.artifacts],...input.binding,sourceId:input.plan.source.id});
  await replayAstellasArchivedSourceQuality(input);
}

/** Durable integrity/binding validation, not authentication of a new acquisition.
 * Only the live issuer above can authorize a new mutation; old receipts remain old. */
export function verifySourceQualityReceipt(input:{receipt:unknown;receiptSha256:string;expected:z.infer<typeof bindingSchema>}):SourceQualityReceipt {
  const receipt=receiptSchema.parse(input.receipt);const expected=bindingSchema.parse(input.expected);
  if (!SHA.safeParse(input.receiptSha256).success||digest(receipt)!==input.receiptSha256||digest(receipt.binding)!==digest(expected)||
      REVIEWED_CONFIGS[receipt.binding.sourceId]!==receipt.binding.sourceConfigSha256) throw new Error("SOURCE_QUALITY_RECEIPT_BINDING_INVALID");
  const {startedAt,finishedAt}=receipt.acquisition;
  const elapsed=Date.parse(finishedAt)-Date.parse(startedAt),age=Date.parse(receipt.issuedAt)-Date.parse(finishedAt);
  const retained=receipt.acquisition.origin==="REVIEWED_RETAINED_CAPTURE";
  if(retained&&!receipt.acquisition.manifestSha256||!retained&&receipt.acquisition.manifestSha256)throw Error("SOURCE_QUALITY_CAPTURE_ORIGIN_INVALID");
  const maxAge=captureAgeLimitMs(receipt.binding.sourceId,retained);
  if (elapsed<0||elapsed>maxAge||age<0||age>maxAge) throw new Error("SOURCE_QUALITY_RECEIPT_TIME_INVALID");
  const c=receipt.counts;
  if(c.parseDiscardCount!==0||c.normalizationDiscardCount!==0||c.parsedCount!==c.rawCount||
    c.validCount+c.validationDiscardCount!==c.parsedCount||c.dedupeInputCount!==c.validCount||
    c.finalUniqueJobCount+c.dedupeDiscardCount!==c.dedupeInputCount||
    new Set(receipt.surfaceIds).size!==receipt.surfaceIds.length||new Set(receipt.channelIds).size!==receipt.channelIds.length)
    throw new Error("SOURCE_QUALITY_RECEIPT_ACCOUNTING_INVALID");
  return receipt;
}

export function assertIssuedSourceQualityAdmission(admission:SourceQualityAdmission,result:SourceCrawlResult,plan:SourceCrawlPlan):asserts admission is Extract<SourceQualityAdmission,{status:"ACCEPTED"}> {
  const proof=issued.get(admission);
  if(admission.status!=="ACCEPTED"||proof?.receiptSha256!==admission.receiptSha256||digest(admission.receipt)!==admission.receiptSha256||
    digest(result)!==proof.resultSha256||digest(plan)!==proof.planSha256)
    throw new Error("LIVE_SOURCE_QUALITY_ADMISSION_REQUIRED");
}
function fresh(owned:Pick<OwnedAcquisition,"startedAt"|"finishedAt"|"origin">,now:Date,sourceId:string):boolean {
  const start=Date.parse(owned.startedAt),end=Date.parse(owned.finishedAt),current=now.getTime();
  const maxAge=captureAgeLimitMs(sourceId,owned.origin==="REVIEWED_RETAINED_CAPTURE");
  return end>=start&&end-start<=maxAge&&current>=end&&current-end<=maxAge;
}
function digest(value:unknown):string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function canonical(value:unknown):string {
  if(value instanceof Date)return JSON.stringify(value.toISOString());
  if(value instanceof Uint8Array)return `{\"$binarySha256\":${JSON.stringify(createHash("sha256").update(value).digest("hex"))},\"$byteCount\":${value.byteLength}}`;
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(value&&typeof value==="object")return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function deepFreeze(value:unknown):void { if(value&&typeof value==="object"){for(const v of Object.values(value))deepFreeze(v);Object.freeze(value);} }



/** Compares the durable proof to the actual atomic transaction input, not just its self-hash.
 * Existing repository tuple/state/lifecycle validators must still run after this verifier. */
export function verifySourceQualityAtomicCommit(input:{plan:SourceCrawlPlan;commit:AtomicSourceEvidenceCommit}):SourceQualityReceipt {
  const {plan,commit}=input,s=commit.sourceResult,p=commit.observationProvenance;
  const expected={releaseCandidateId:s.releaseCandidateId,batchId:s.batchId,sourceResultId:s.id,sourceId:s.sourceId,
    sourceConfigSha256:s.sourceConfigHash,adapterVersion:s.adapterVersion};
  const r=verifySourceQualityReceipt({receipt:s.completenessCertificate,receiptSha256:s.completenessCertificateSha256??"",expected});
  const fail=(stage:string):never=>{throw new Error(`SOURCE_QUALITY_ATOMIC_BINDING_INVALID:${stage}`);};
  if(getSourceQualityPolicy(plan)!==r.policyId||plan.company.id!==r.companyId||plan.source.id!==s.sourceId||
    sourcePlanConfigSha256(plan)!==s.sourceConfigHash||digest(r.surfaceIds)!==digest([plan.source.surfaceId])||
    digest(r.channelIds)!==digest(plan.expectedChannels!.map(c=>c.channelId).sort()))fail("PLAN");
  const tuple={releaseCandidateId:s.releaseCandidateId,batchId:s.batchId,sourceResultId:s.id,sourceId:s.sourceId};
  const tupleMatches=(row:typeof tuple)=>Object.entries(tuple).every(([key,value])=>row[key as keyof typeof tuple]===value);
  if(!tupleMatches(p)||[...commit.artifacts,...commit.pagination,...commit.lossLedger].some(row=>!tupleMatches(row)))fail("TUPLE");
  if(s.transportState!=="SUCCEEDED"||s.adapterState!=="SUCCEEDED"||s.completenessState!=="VERIFIED"||s.atomicCommitState!=="COMMITTED"||
    s.failureCode||s.failureReason||s.blockerCode||s.blockerReason||!p.transportSucceeded||!p.adapterSucceeded||!p.completenessVerified||!p.atomicCommitSucceeded||
    s.finishedAt?.toISOString()!==r.issuedAt||p.observedTo.toISOString()!==r.issuedAt||
    s.startedAt.getTime()>Date.parse(r.acquisition.startedAt)||p.observedFrom.getTime()!==s.startedAt.getTime()||
    p.sourceConfigSha256!==s.sourceConfigHash||p.adapterVersion!==s.adapterVersion)fail("STATE");
  const c=r.counts;
  const counts={rawCount:c.rawCount,parsedCount:c.parsedCount,validCount:c.validCount,normalizedCount:c.validCount,
    dedupeInputCount:c.dedupeInputCount,dedupeOutputCount:c.finalUniqueJobCount,parseDiscardCount:c.parseDiscardCount,
    validationDiscardCount:c.validationDiscardCount,normalizationDiscardCount:c.normalizationDiscardCount,dedupeDiscardCount:c.dedupeDiscardCount,
    collisionCount:c.collisionCount,discardCount:c.validationDiscardCount+c.dedupeDiscardCount,
    adapterInputCount:c.validCount,adapterOutputCount:c.finalUniqueJobCount,adapterLossCount:c.dedupeDiscardCount,adapterCollisionGroupCount:c.collisionCount};
  if(Object.entries(counts).some(([key,value])=>s[key as keyof typeof counts]!==value)||
    s.expectedJobCount!==r.observation.expectedJobCount||s.expectedEvidenceKind!==r.observation.expectedEvidenceKind)fail("COUNTS");
  const surfaces=canonicalStringSetSha256(r.surfaceIds),channels=canonicalStringSetSha256(r.channelIds),output=r.output.canonicalJobKeySetSha256;
  const hashBindings:Record<string,[string|null,string]>={
    surfaces:[canonicalStringSetSha256(s.officialSurfaceIds),surfaces],channels:[canonicalStringSetSha256(s.officialChannelIds),channels],
    expectedSurface:[s.expectedSurfaceSha256,surfaces],visitedSurface:[s.visitedSurfaceSha256,surfaces],
    observationExpectedSurface:[p.expectedSurfaceSha256,surfaces],observationVisitedSurface:[p.visitedSurfaceSha256,surfaces],
    expectedChannel:[s.expectedChannelSha256,channels],visitedChannel:[s.visitedChannelSha256,channels],
    observationExpectedChannel:[p.expectedChannelSha256,channels],observationVisitedChannel:[p.visitedChannelSha256,channels],
    current:[s.canonicalCurrentJobSetSha256,output],output:[s.canonicalOutputSetSha256,output],observationOutput:[p.canonicalOutputSha256,output],
    raw:[p.canonicalRawSha256,r.canonicalRawEvidenceIdSetSha256],paginationTrace:[p.paginationTraceSha256,r.paginationTraceSha256],
    adapter:[s.adapterReconciliationSha256,r.ledger.adapterReconciliationSha256],collision:[s.collisionLedgerSha256,r.ledger.collisionLedgerSha256],
    artifactManifest:[digest(commit.artifacts.map(artifactProjection)),r.artifactManifestSha256],
    paginationRows:[digest(commit.pagination.map(paginationProjection)),r.paginationRowsSha256],
    lossRows:[digest(commit.lossLedger.map(lossProjection)),r.ledger.atomicLossLedgerSha256]
  };
  for(const [name,[actual,expectedHash]] of Object.entries(hashBindings))if(actual!==expectedHash)fail(`HASH_${name}`);
  const jobs=commit.commands.filter((c):c is Extract<typeof c,{type:"UPSERT_JOB"}>=>c.type==="UPSERT_JOB")
    .filter(c=>c.missingSuccessfulCrawlCount===0).map(c=>c.record);
  if(jobRecordsDigest(jobs)!==r.output.jobsSha256||jobs.some(j=>j.sourceId!==s.sourceId||j.companyId!==r.companyId))fail("OUTPUT");
  const observations=commit.commands.filter((c):c is Extract<typeof c,{type:"UPSERT_CRAWL_OBSERVATION"}>=>c.type==="UPSERT_CRAWL_OBSERVATION");
  if(observations.length!==1)fail("OBSERVATION_COUNT");
  const o=observations[0]!.observation;
  if(o.sourceId!==s.sourceId||o.structuredJobCount!==c.finalUniqueJobCount||o.crawledAt.toISOString()!==r.observation.crawledAt||
    (o.expectedJobCount??null)!==r.observation.expectedJobCount||o.completenessEvidenceKind!==r.observation.expectedEvidenceKind||
    o.completenessStatus!=="VERIFIED"||o.successful!==true||o.completenessBlockerReason||
    digest([...o.stableRequiredFields].sort())!==digest(r.observation.stableRequiredFields))fail("OBSERVATION");
  return r;
}
function jobRecordsDigest(jobs:readonly import("./normalizedJob").NormalizedJobRecord[]):string {
  return digest([...jobs].sort((a,b)=>Buffer.compare(Buffer.from(buildJobDedupeKey(a)),Buffer.from(buildJobDedupeKey(b)))));
}
function artifactProjection(a:ArchivedEvidenceArtifact|AtomicEvidenceArtifactInput) {
  return {id:a.id,logicalKey:a.logicalKey,sourceId:a.sourceId,sourceResultId:a.sourceResultId,batchId:a.batchId,releaseCandidateId:a.releaseCandidateId,
    channelId:a.channelId??null,kind:a.kind,requestedUrl:a.requestedUrl??null,finalUrl:a.finalUrl??null,httpStatus:a.httpStatus??null,contentType:a.contentType??null,
    capturedAt:a.capturedAt.toISOString(),sha256:a.sha256,byteCount:a.byteCount,path:a.path,extractorLocator:a.extractorLocator,
    captureToolName:a.captureToolName,captureToolVersion:a.captureToolVersion,
    redactionCommitmentSha256:"redactionCommitmentSha256" in a?a.redactionCommitmentSha256:a.rawBodySha256??a.sha256};
}
function paginationProjection(p:SourceFetchPageTrace|AtomicPaginationEvidenceInput) {
  return {artifactLogicalKey:p.artifactLogicalKey,sequence:p.sequence,channelId:p.channelId??null,
    requestedCursor:p.requestedCursor??null,returnedCursor:p.returnedCursor??null,requestedOffset:p.requestedOffset??null,returnedOffset:p.returnedOffset??null,
    requestedPage:p.requestedPage??null,returnedPage:p.returnedPage??null,requestedPageSize:p.requestedPageSize??null,returnedPageSize:p.returnedPageSize??null,
    responseFingerprintSha256:p.responseFingerprintSha256,rawJobIdSetSha256:"rawJobIds" in p?canonicalStringSetSha256(p.rawJobIds):p.rawJobIdSetSha256,
    validJobIdSetSha256:"validJobIds" in p?canonicalStringSetSha256(p.validJobIds):p.validJobIdSetSha256,declaredTotal:p.declaredTotal??null,
    declaredCount:p.declaredCount??null,declaredPages:p.declaredPages??null,nextPageSignalBefore:p.nextPageSignalBefore??null,
    nextPageSignalAfter:p.nextPageSignalAfter??null,termination:p.termination,anomalyCodes:p.anomalyCodes,capturedAt:new Date(p.capturedAt).toISOString()};
}
function lossProjection(l:{stage:string;reason:string;rawLocator:string;details:unknown;candidateKey?:string|null;winnerKey?:string|null;recordedAt?:string|Date|undefined}) {
  return {stage:l.stage,reason:l.reason,rawLocator:l.rawLocator,details:l.details,candidateKey:l.candidateKey??null,winnerKey:l.winnerKey??null,
    recordedAt:l.recordedAt?new Date(l.recordedAt).toISOString():null};
}

/** Physical body/trace equality, independently of source-specific semantic replay.
 * A redacted body cannot establish the exact original response fingerprint here.
 * The parsed historical schema defines an absent representation marker with no
 * redaction metadata as exact retained bytes. Hash equality is still mandatory. */
export function sourceQualityPageBodiesMatchFingerprints(evidence: PersistentSourceFetchEvidence): boolean {
  if (evidence.pages.length === 0) return false;
  return evidence.pages.every(page => {
    const artifacts = evidence.artifacts.filter(a => a.logicalKey === page.artifactLogicalKey);
    const artifact = artifacts[0];
    return artifacts.length === 1 && artifact !== undefined &&
      (artifact.bodyRepresentation === "EXACT" || artifact.bodyRepresentation === undefined) &&
      artifact.rawBodySha256 === undefined && artifact.redactionDescriptors === undefined &&
      createHash("sha256").update(artifact.body).digest("hex") === page.responseFingerprintSha256;
  });
}
