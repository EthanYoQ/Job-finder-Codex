import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission, verifySourceQualityReceipt, assertIssuedSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";

const NOW = new Date("2026-10-01T11:50:00.000Z");
const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(p => rm(p, {recursive:true, force:true}))); });
function plan() { return structuredClone(getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-hansoh-social")!); }
function row(index: number) { return {Id:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`, JobAdId:index,
  JobAdName:`职位${index}`, LocNames:["上海市"], Category:"社会招聘", CategoryId:"1", Kind:"全职", Status:1,
  PostDate:"2026-09-20T12:00:00", ChangeDate:"0001-01-01T00:00:00"}; }
async function capture(rows = [row(1)]) {
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const page = JSON.parse(String(init.body)).PageIndex;
    return {status:200, url:String(url), headers:new Headers({"content-type":"application/json"}),
      text: async () => JSON.stringify({Code:200, Count:rows.length, Data:rows.slice(page*100,(page+1)*100)})};
  }));
  const p = plan();
  const result = await runSourceCrawl(p, {fetch:createOwnedSourceQualityFetch(), isBaseline:false});
  const workspaceRoot = await mkdtemp(join(tmpdir(), "portable-source-quality-")); dirs.push(workspaceRoot);
  const binding = {releaseCandidateId:"portable-test", batchId:"batch-1", sourceResultId:"batch-1--source-hansoh-social",
    sourceConfigSha256:sourcePlanConfigSha256(p), adapterVersion:"a".repeat(64)};
  const evidenceSubdirectory = "portable-quality/runtime-evidence";
  const archive = await archiveSourceEvidence({workspaceRoot, ...binding, sourceId:p.source.id, evidenceSubdirectory,
    captureTool:result.fetchEvidence!.captureTool, artifacts:bindRuntimeEvidenceArtifactIds({...binding, sourceId:p.source.id,
      artifacts:result.fetchEvidence!.artifacts})});
  return {plan:p, result, binding, archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}};
}

import {executePortableAtomicSourceEvidenceCommit,executeAtomicSourceEvidenceCommit} from "../../src/db/ingestionRepository";
import {acquirePortableCrawlLease} from "../../src/crawler/portableCrawlLease";
import {buildJobDedupeKey} from "../../src/crawler/normalizedJob";
async function fixture(){
 const input=await capture();
 const identity={releaseCandidateId:input.binding.releaseCandidateId,commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"quality-worker",expectedPlannedSourceIds:[input.plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
 const pending=buildPendingRuntimeBatch(input.binding.batchId,[input.plan],identity,NOW).sources[0]!;input.binding.adapterVersion=pending.adapterVersion;
 const admission=await issueSourceQualityAdmission(input);if(admission.status!=="ACCEPTED")throw Error(JSON.stringify(admission));
 const args={plan:input.plan,pending,identity,batchId:input.binding.batchId,result:input.result,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:input.archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1" as const,sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null};
 return {input,admission,args};
}
describe("portable quality atomic builder integration",()=>{
 it("builds a real attested gradeless commit without mutating the source result",async()=>{
  const {input,admission,args}=await fixture();const before=JSON.stringify(input.result);const commit=buildAtomicRuntimeCommit(args);
  expect(JSON.stringify(input.result)).toBe(before);expect(commit.sourceResult).toMatchObject({completenessState:"VERIFIED",baselineChangeReason:"PLAN_BOUND_REPLAY_CONFIRMED_INITIAL",completenessCertificate:admission.receipt});
  expect(commit.publicationPolicy).toBe("SOURCE_ATOMIC_LAST_GOOD_V1");expect(commit.sourceResult.completenessCertificate).not.toHaveProperty("grade");
  expect(commit.commands.filter(c=>c.type==="UPSERT_JOB")).toHaveLength(1);expect(()=>verifySourceQualityAtomicCommit({plan:input.plan,commit})).not.toThrow();
 });
 it("does not mutate jobs or advance a trusted baseline for a rejected admission",async()=>{
  const {args}=await fixture();const commit=buildAtomicRuntimeCommit({...args,sourceQualityAdmission:{status:"REJECTED",codes:["TEST_REJECTION"]}});
  expect(commit.commands.filter(c=>c.type==="UPSERT_JOB")).toEqual([]);expect(commit.sourceResult.completenessState).not.toBe("VERIFIED");expect(commit.sourceResult.completenessCertificate).toBeNull();expect(commit.sourceResult.baselineChangeReason).toBeUndefined();
 });
 it("does not treat accepted replay as permission to override a count-drop anomaly",async()=>{
  const {args}=await fixture();const commit=buildAtomicRuntimeCommit({...args,completenessAnomalyTriggerCodes:["TRUSTED_COUNT_DROP"]});
  expect(commit.commands.filter(c=>c.type==="UPSERT_JOB")).toEqual([]);expect(commit.sourceResult.blockerCode).toBe("COMPLETENESS_ANOMALY_UNVERIFIED");expect(commit.sourceResult.completenessCertificate).toBeNull();
 });
 it("does not grant first-cutover grace to old-only active rows",async()=>{
  const {args}=await fixture();const record={...args.result.jobs[0]!,officialTitle:"Old unverified job",officialUrl:"https://hspharm.zhiye.com/social/detail?jobAdId=00000000-0000-4000-8000-000000000099",sourceJobId:"old-unverified"};
  const commit=buildAtomicRuntimeCommit({...args,previousJobs:[{dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:"ACTIVE",missingSuccessfulCrawlCount:0,firstSeenAt:"2026-09-01T00:00:00.000Z",lastSeenAt:"2026-09-27T00:00:00.000Z"}]});
  expect(commit.commands.filter(c=>c.type==="UPSERT_JOB")).toHaveLength(1);expect(commit.sourceResult.canonicalGraceJobSetSha256).toBe(createHash("sha256").update("[]").digest("hex"));
 });
 it("requires an explicitly loaded receipt baseline and preserves old behavior without mode selection",async()=>{
  const {args}=await fixture();const {firstAcceptedCurrentPolicyReceipt:_prior,...missing}=args;
  expect(()=>buildAtomicRuntimeCommit(missing)).toThrow(/baseline must be loaded/);
  const {sourceAdmissionPolicy:_mode,sourceQualityAdmission:_admission,...legacy}=args;
  expect(buildAtomicRuntimeCommit(legacy).sourceResult.completenessState).not.toBe("VERIFIED");
 });
 it("passes full repository validation then fences before the first write",async()=>{
  const {args}=await fixture();const commit=buildAtomicRuntimeCommit(args);let holder="";const events:string[]=[];
  const lease=await acquirePortableCrawlLease({$transaction:async work=>work({$queryRawUnsafe:async <T>(_sql:string,...values:unknown[])=>{holder=String(values[1]);return [{holderId:holder}] as T;}})});
  const transaction={ $queryRawUnsafe:async(sql:string)=>{events.push(sql.startsWith("SELECT")?"LOCK":"CHECK");return sql.startsWith("SELECT")?[{id:"formal-crawl"}]:[{holderId:holder}];},evidenceArtifact:{create:async()=>{events.push("ARTIFACT");throw Error("FIRST_WRITE_REACHED");}}};
  await expect(executePortableAtomicSourceEvidenceCommit(commit,lease,{$transaction:async work=>work(transaction as never)})).rejects.toThrow("FIRST_WRITE_REACHED");expect(events).toEqual(["LOCK","CHECK","ARTIFACT"]);
 });
 it("refuses portable Job writes without the inside-transaction lease fence",async()=>{
  const {args}=await fixture();const commit=buildAtomicRuntimeCommit(args);const tx=vi.fn();
  await expect(executeAtomicSourceEvidenceCommit(commit,{$transaction:tx})).rejects.toThrow("PORTABLE_PUBLICATION_LEASE_REQUIRED");expect(tx).not.toHaveBeenCalled();
 });
 it("snapshots a verified portable commit before transaction IO permits caller mutation",async()=>{
  const {args}=await fixture();const commit=buildAtomicRuntimeCommit(args);let holder="";let writtenUrl="";
  const originalUrl=commit.artifacts[0]!.requestedUrl;
  const lease=await acquirePortableCrawlLease({$transaction:async work=>work({$queryRawUnsafe:async <T>(_sql:string,...values:unknown[])=>{holder=String(values[1]);return [{holderId:holder}] as T;}})});
  const transaction={$queryRawUnsafe:async(sql:string)=>sql.startsWith("SELECT")?[{id:"formal-crawl"}]:[{holderId:holder}],evidenceArtifact:{create:async({data}:any)=>{writtenUrl=data.requestedUrl;throw Error("SNAPSHOT_WRITE_REACHED");}}};
  await expect(executePortableAtomicSourceEvidenceCommit(commit,lease,{$transaction:async work=>{
    commit.artifacts[0]!.requestedUrl="https://mutated.example/";commit.sourceResult.rawCount=999;
    return work(transaction as never);
  }})).rejects.toThrow("SNAPSHOT_WRITE_REACHED");
  expect(writtenUrl).toBe(originalUrl);
 });
 it("refuses a post-builder mutation before entering a database transaction",async()=>{
  const {args}=await fixture();const commit=buildAtomicRuntimeCommit(args);commit.sourceResult.rawCount++;
  const tx=vi.fn();await expect(executeAtomicSourceEvidenceCommit(commit,{$transaction:tx})).rejects.toThrow();expect(tx).not.toHaveBeenCalled();
 });
});
