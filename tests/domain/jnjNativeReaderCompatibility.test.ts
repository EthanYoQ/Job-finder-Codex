import { toPrismaJobCategory } from "../../src/db/prismaMappers";
// @vitest-environment node
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { syntheticJnjCommit } from "../helpers/jnjNativeSyntheticFixture";
import { accepted } from "../helpers/portablePublicSnapshotFixture";
import { JNJ_DOM_URL_PROFILES } from "../../src/crawler/jnjCareersDomUrlProfile";

// Only code is loaded from these restored, frozen trees. Every row below is synthetic.
const readers = [
 ["fixed fb0b8e3 reader", "../producer42"],
 ["sealed Sanofi web-main", "../deployment-candidates/sanofi-pair-20261006T0007Z/web-main"],
 ["sealed Sanofi web-fallback", "../deployment-candidates/sanofi-pair-20261006T0007Z/web-fallback"],
 ["sealed Ali runtime a38", "../deployment-candidates/ali-pair-deploy-20261006T0057Z/recovery-v2-review/integration-runtime-a38"]
] as const;
async function readerFixture(profile: typeof JNJ_DOM_URL_PROFILES[number]) {
 const {plan,commit}=await syntheticJnjCommit(profile),r=commit.sourceResult;
 const result={...accepted(r.finishedAt!.toISOString(),[],[],plan).result,...r,
  _count:{transportAttempts:0,evidenceArtifacts:commit.artifacts.length,observations:1,paginationEvidence:commit.pagination.length,lossLedgerEntries:0,lifecycleSetMembers:r.dedupeOutputCount*2},
  batch:{id:r.batchId,releaseCandidateId:r.releaseCandidateId,kind:"SCHEDULED",status:"SUCCESS"}};
 const tuple={releaseCandidateId:r.releaseCandidateId,batchId:r.batchId,sourceId:r.sourceId,sourceResultId:r.id};
 const commands=commit.commands.filter(c=>c.type==="UPSERT_JOB");
 const members=commands.flatMap(c=>["CURRENT","VISIBLE"].map(setKind=>({...tuple,setKind,jobKey:c.dedupeKey,
  jobKeySha256:createHash("sha256").update(c.dedupeKey).digest("hex"),lifecycleStatus:"ACTIVE",missingCount:c.missingSuccessfulCrawlCount})));
 const jobs=commands.map(c=>({id:c.record.sourceJobId,companyId:plan.company.id,sourceId:plan.source.id,dedupeKey:c.dedupeKey,
  officialTitle:c.record.officialTitle,auxiliaryChineseTitle:null,humanCorrectedTitle:null,officialUrl:c.record.officialUrl,officialPublishedAt:null,
  city:c.record.cities[0],cities:c.record.cities,locationRaw:c.record.locationRaw,category:toPrismaJobCategory(c.record.category),humanCorrectedCategory:null,isNew:c.isNew,
  lastSeenAt:new Date(c.lastSeenAt),lifecycleStatus:"ACTIVE",visibleInFrontend:c.visibleInFrontend,missingSuccessCount:c.missingSuccessfulCrawlCount}));
 const options={currentTime:new Date(r.finishedAt!.getTime()+60_000)};
 return {plan,result,members,jobs,options,commit};
}
describe.each(readers)("synthetic receipt compatibility: %s",(_label,path)=>{
 it.each(JNJ_DOM_URL_PROFILES)("reads %s through the unchanged snapshot repository and preserves integrity holds",async profile=>{
  const f=await readerFixture(profile);
  const reader=await import("/@fs/" + resolve(path,"src/db/portablePublicSnapshotRepository.ts"));
  const db={$transaction:async(work:any,options:any)=>{
   expect(options.isolationLevel).toBe("RepeatableRead");
   return work({crawlBatchSourceResult:{findMany:async()=>[f.result]},lifecycleSetEvidenceMember:{findMany:async()=>f.members},job:{findMany:async()=>f.jobs}});
  }};
  const snapshot=await reader.readPortablePublicSnapshot(db,f.options,[f.plan]);
  const source=snapshot.sources.find((s:any)=>s.sourceId===f.plan.source.id);
  expect(source).toMatchObject({state:"PUBLISHING",visibleJobCount:21,lastAcceptedJobCount:21});
  expect(snapshot.totalJobs).toBe(21);
  f.result.completenessCertificateSha256="0".repeat(64);
  const corrupt=await reader.readPortablePublicSnapshot(db,f.options,[f.plan]);
  expect(corrupt.sources.find((s:any)=>s.sourceId===f.plan.source.id)).toMatchObject({state:"HOLD",reasons:["RECEIPT_INTEGRITY_HOLD"]});
  expect(corrupt.totalJobs).toBe(0);
 },20_000);
});
