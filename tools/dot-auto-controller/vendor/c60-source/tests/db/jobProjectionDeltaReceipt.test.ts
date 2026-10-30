import {inspectPersistedAtomicCommitOutcome,type AtomicSourceEvidenceCommit} from "../../src/db/ingestionRepository";
// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {buildJobProjectionDeltaReceipt,restoreJobProjectionLifecycleContext,unwrapJobProjectionSourceRow} from "../../src/db/jobProjectionDeltaCompiler";
import {hashJobPersistedProjection,hashProjectionJson,parseJobProjectionDeltaReceipt,hashDeltaManifest,JOB_PROJECTION_FIELDS,type JobPersistedProjection} from "../../src/domain/jobProjectionDeltaReceipt";
import {applyCrawlObservation,type JobSnapshot} from "../../src/crawler/lifecycle";
import {buildIngestionCommands,type IngestionCommand} from "../../src/crawler/ingestion";
import type {NormalizedJobRecord} from "../../src/crawler/normalizedJob";

const observed="2026-10-06T01:00:00.000Z",verified="2026-10-06T01:00:01.000Z";
const projection:JobPersistedProjection={companyId:"company-one",sourceId:"source-one",dedupeKey:"source-one:official-1",sourceJobId:"official-1",
 officialTitle:"Clinical role",officialUrl:"https://example.test/job/1",listUrl:"https://example.test/jobs",locationRaw:"上海",city:"上海",cities:["上海"],
 officialPublishedAt:null,missingSuccessCount:0,lifecycleStatus:"ACTIVE",visibleInFrontend:true,isNew:false};
const record:NormalizedJobRecord={companyId:projection.companyId,sourceId:projection.sourceId,sourceJobId:projection.sourceJobId!,sourceKind:"SOCIAL",atsKind:"OFFICIAL_JSON",
 officialChineseCompanyName:"合成企业",officialTitle:projection.officialTitle,officialUrl:projection.officialUrl,listUrl:projection.listUrl!,locationRaw:projection.locationRaw,
 cities:projection.cities,category:"其他",isBaseline:true,evidence:{officialEntryUrl:"https://example.test/jobs",capturedAt:observed}};
function commands(at=observed,finished=verified,missing=0):IngestionCommand[]{return [{type:"UPSERT_CRAWL_OBSERVATION",observation:{id:"obs",sourceId:projection.sourceId,crawledAt:new Date(at),successful:true,structuredJobCount:missing?0:1,stableRequiredFields:["company","title","officialUrl","location"]}},
 {type:"UPSERT_JOB",dedupeKey:projection.dedupeKey,record,lifecycleStatus:"ACTIVE",visibleInFrontend:true,isNew:false,firstSeenAt:verified,lastSeenAt:finished,missingSuccessfulCrawlCount:missing}];}
const certificate={schemaVersion:"synthetic-legacy-certificate",issuedAt:verified};
function source(id="result-one",finished=verified){return {id,releaseCandidateId:"candidate-offline",batchId:"batch-"+id,sourceId:projection.sourceId,finishedAt:new Date(finished),completenessCertificate:certificate,completenessCertificateSha256:hashProjectionJson(certificate)};}
function receipt(id="result-one",at=observed,finished=verified,missing=0,previous:Record<string,unknown>|null=null){return buildJobProjectionDeltaReceipt({sourceResult:source(id,finished),commands:commands(at,missing?verified:finished,missing),previousAccepted:previous,
 projectionForCommand:()=>({...projection,missingSuccessCount:missing})});}
function priorRow(r=receipt()){return {...source(r.receipt.binding.sourceResultId,r.receipt.verifiedAt),completenessCertificate:r.receipt,completenessCertificateSha256:r.sha256};}

describe("persisted projection ownership",()=>{
 it("commits every current source-owned persistence column",()=>{expect(JOB_PROJECTION_FIELDS).toHaveLength(15);});
 const changes:Partial<JobPersistedProjection>={companyId:"company-two",sourceId:"source-two",dedupeKey:"source-one:other",sourceJobId:"other",officialTitle:"Updated clinical role",officialUrl:"https://example.test/job/2",listUrl:null,locationRaw:"北京",city:"北京",cities:["上海","北京"],officialPublishedAt:"2026-01-01T00:00:00.000Z",missingSuccessCount:1,lifecycleStatus:"OFFLINE",visibleInFrontend:false,isNew:true};
 it.each(JOB_PROJECTION_FIELDS)("detects a change in %s",field=>{expect(hashJobPersistedProjection({...projection,[field]:changes[field]})).not.toBe(hashJobPersistedProjection(projection));});
 it.each(["lastSeenAt","sourceChangedAt","category","auxiliaryChineseTitle","humanCorrectedTitle","humanCorrectedCategory","classificationInputHash"])("preserves live overlay/metadata ownership for %s",field=>{expect(hashJobPersistedProjection({...projection,[field]:"different"})).toBe(hashJobPersistedProjection(projection));});
 it("does not infer missing visibility/isNew or use just the eight listing columns",()=>{for(const field of ["visibleInFrontend","isNew"]){const row:Record<string,unknown>={...projection};delete row[field];expect(()=>hashJobPersistedProjection(row)).toThrow();}});
 it("normalizes actual database timestamps without mutating the record",()=>{const base={...projection,officialPublishedAt:"2026-01-01T00:00:00.000Z"};expect(hashJobPersistedProjection({...base,officialPublishedAt:new Date(base.officialPublishedAt)})).toBe(hashJobPersistedProjection(base));expect(hashJobPersistedProjection({...base,officialPublishedAt:"2026-01-01T00:00:00"})).toBe(hashJobPersistedProjection(base));});
 it("keeps ordered cities significant and never claims full JD equality",()=>{expect(hashJobPersistedProjection({...projection,cities:["北京","上海"]})).not.toBe(hashJobPersistedProjection({...projection,cities:["上海","北京"]}));expect(receipt().receipt.detailEvidenceState).toBe("UNKNOWN");});
});

describe("full observation manifest and consecutive rounds",()=>{
 it("retains current and visible evidence when row content is unchanged",()=>{const first=receipt();const second=receipt("result-two","2026-10-06T02:00:00.000Z","2026-10-06T02:00:01.000Z");expect(first.receipt.members).toHaveLength(2);expect(second.receipt.members).toHaveLength(2);expect(second.receipt.members[0]!.jobProjectionSha256).toBe(first.receipt.members[0]!.jobProjectionSha256);expect(second.sha256).not.toBe(first.sha256);expect(second.receipt.members.every(m=>m.lastPresentResultId==="result-two")).toBe(true);});
 it("restores only logical lifecycle time across two no-op publications",()=>{const first=receipt(),second=receipt("result-two","2026-10-06T02:00:00.000Z","2026-10-06T02:00:01.000Z");const physical={...projection,firstSeenAt:verified,lastSeenAt:verified};const frozen=JSON.stringify(physical);const logical=restoreJobProjectionLifecycleContext([physical],priorRow(second));expect(logical[0]!.lastSeenAt).toBe(second.receipt.verifiedAt);expect(JSON.stringify(physical)).toBe(frozen);expect(unwrapJobProjectionSourceRow(priorRow(first)).completenessCertificate).toEqual(certificate);});
 it("rejects an intervening persisted business change before logical restoration",()=>{expect(()=>restoreJobProjectionLifecycleContext([{...projection,officialTitle:"concurrent change"}],priorRow())).toThrow("JOB_DELTA_BASELINE_JOB_PROJECTION_DRIFT");});
 it("preserves a real legacy observation anchor for first GRACE",()=>{const legacy={...source(),observations:[{...source(),sourceResultId:"result-one",crawledAt:observed}]};const grace=receipt("result-two","2026-10-06T02:00:00.000Z","2026-10-06T02:00:01.000Z",1,legacy);expect(grace.receipt.members.every(m=>m.lastConfirmedObservedAt===observed&&m.lifecycleLastSeenAt===verified&&m.lastPresentResultId==="result-one")).toBe(true);});
 it("preserves the last true delta observation for GRACE",()=>{const grace=receipt("result-two","2026-10-06T02:00:00.000Z","2026-10-06T02:00:01.000Z",1,priorRow());expect(grace.receipt.members.map(m=>m.setKind).sort()).toEqual(["GRACE","VISIBLE"]);expect(grace.receipt.members.every(m=>m.lastConfirmedObservedAt===observed)).toBe(true);});
 it("refuses fabricated GRACE without original observation evidence",()=>{expect(()=>receipt("result-two","2026-10-06T02:00:00.000Z","2026-10-06T02:00:01.000Z",1,{...source()})).toThrow("JOB_DELTA_LEGACY_CURRENT_OBSERVATION_REQUIRED");});
 it("keeps incomplete failures from advancing missing or last-seen",()=>{const previous:JobSnapshot={dedupeKey:projection.dedupeKey,record,lifecycleStatus:"ACTIVE",missingSuccessfulCrawlCount:0,firstSeenAt:verified,lastSeenAt:verified};for(const disposition of ["CRAWL_FAILED","INCOMPLETE","BLOCKED","SKIPPED"] as const){const result=applyCrawlObservation([previous],[],{observedAt:"2026-10-06T03:00:00.000Z",baselineCompletedBeforeCrawl:true,observation:{disposition,atomicCommitEligible:false}});expect(result[0]!.missingSuccessfulCrawlCount).toBe(0);expect(result[0]!.lastSeenAt).toBe(verified);}});
 it("preserves the existing OFFLINE counter when the job remains absent",()=>{const previous:JobSnapshot={dedupeKey:projection.dedupeKey,record,lifecycleStatus:"OFFLINE",missingSuccessfulCrawlCount:6,firstSeenAt:verified,lastSeenAt:verified};expect(applyCrawlObservation([previous],[],{observedAt:"2026-10-06T03:00:00.000Z",baselineCompletedBeforeCrawl:true,observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true}})[0]!.missingSuccessfulCrawlCount).toBe(6);});
 it("partial does not convert absence to GRACE",()=>{const previous:JobSnapshot={dedupeKey:projection.dedupeKey,record,lifecycleStatus:"ACTIVE",missingSuccessfulCrawlCount:0,firstSeenAt:verified,lastSeenAt:verified};expect(applyCrawlObservation([previous],[],{observedAt:"2026-10-06T03:00:00.000Z",baselineCompletedBeforeCrawl:true,observation:{disposition:"TRUSTED_PARTIAL",atomicCommitEligible:true}})[0]!.missingSuccessfulCrawlCount).toBe(0);});
});

describe("receipt negative cases",()=>{
 it("keeps a truthful PENDING reconciliation without demanding a terminal receipt",async()=>{
  const r=receipt();const expected={...source(),sourceConfigHash:"a".repeat(64),adapterVersion:"synthetic-v1",officialEntryId:null,officialSurfaceIds:["surface-one"],officialChannelIds:["channel-one"],startedAt:new Date(observed),completenessCertificate:r.receipt,completenessCertificateSha256:r.sha256};
  const pending={...expected,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null,completenessCertificate:null,completenessCertificateSha256:null};
  const actual=await inspectPersistedAtomicCommitOutcome({sourceResult:expected} as unknown as AtomicSourceEvidenceCommit,{crawlBatchSourceResult:{findUnique:async()=>pending,findMany:async()=>[]}});
  expect(actual).toEqual({state:"PENDING"});
 });
 it.each(["tuple","key-hash","current-time","current-reference","projection-hash","missing-pair","extra-field"])("rejects %s mutation",kind=>{const r=structuredClone(receipt().receipt);if(kind==="tuple")r.members[0]!.sourceResultId="other";if(kind==="key-hash")r.members[0]!.jobKeySha256="0".repeat(64);if(kind==="current-time")r.members[0]!.lastConfirmedObservedAt="2026-10-06T00:00:00.000Z";if(kind==="current-reference")r.members[0]!.lastPresentResultId="old";if(kind==="projection-hash")r.members[0]!.jobProjectionSha256="bad";if(kind==="missing-pair")r.members.pop();if(kind==="extra-field")(r as unknown as Record<string,unknown>).unreviewed=true;r.manifestSha256=hashDeltaManifest(r.members);expect(()=>parseJobProjectionDeltaReceipt(r,hashProjectionJson(r))).toThrow();});
 it("rejects a mismatched acknowledgement hash without any write/retry",()=>{const r=receipt();expect(()=>parseJobProjectionDeltaReceipt(r.receipt,"0".repeat(64))).toThrow("JOB_DELTA_RECEIPT_HASH_MISMATCH");expect(parseJobProjectionDeltaReceipt(r.receipt,r.sha256)).toEqual(r.receipt);});
});
