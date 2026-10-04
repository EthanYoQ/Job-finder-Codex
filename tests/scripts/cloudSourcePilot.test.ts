// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { loadPilotContext, reconcilePilotPublication, selectedPilotIdentity } from "../../scripts/p0-cloud-source-pilot";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { ownedPortableFixture } from "../db/helpers/ownedPortableCommit";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { buildAtomicRuntimeCommit } from "../../src/crawler/runtimeAtomicEvidence";
import { FilePilotRelay, PilotSqlFailure } from "../../src/crawler/cloudSourcePilotRelay";
const settle=vi.hoisted(()=>vi.fn(async(_ms:number)=>undefined));
vi.mock("node:timers/promises",()=>({setTimeout:settle}));
const plan=getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),"source-qilu-social")!;
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("declares an honest selected one-source scheduled identity retaining the full authority hashes",()=>{
  const full={releaseCandidateId:"candidate",commitSha:"a".repeat(40),rosterSha256:"b".repeat(64),sourcePlanSha256:"c".repeat(64),sourceConfigSha256:"d".repeat(64),adapterBundleSha256:"e".repeat(64),ownerId:"staged-scheduler",batchKind:"SCHEDULED" as const,expectedPlannedSourceIds:["other"],expectedPlannedSourceSetSha256:"f".repeat(64),expectedPlannedSourceCount:41};
  const selected=selectedPilotIdentity(full);
  expect(selected).toEqual({...full,ownerId:"dot-cloud-qilu-pilot",batchKind:"SCHEDULED",expectedPlannedSourceIds:["source-qilu-social"],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet(["source-qilu-social"])});
  expect(sourcePlanConfigSha256(plan)).toBe("0ca38d0cd6550e9567cc3e7ca6772d3b91497f5a59530f5359f823a6c62d5773");
  expect(plan.expectedChannels).toEqual([{channelId:"qilu-marketing",kind:"SOCIAL"},{channelId:"qilu-non-marketing",kind:"SOCIAL"}]);
});
it("maps raw database category labels and validates normalized snapshots; unknown category fails closed",async()=>{
  const base={sourceId:plan.source.id,checkedAt:new Date().toISOString(),sourceConfigSha256:sourcePlanConfigSha256(plan),latestAccepted:null,firstAccepted:null,jobs:[{
    dedupeKey:"key",companyId:plan.company.id,sourceId:plan.source.id,sourceJobId:"old",officialTitle:"职位",auxiliaryChineseTitle:null,officialUrl:"https://example.test/job",listUrl:null,locationRaw:"上海",city:"上海",cities:["上海"],category:"其他",officialPublishedAt:null,firstSeenAt:"2026-10-01T01:00:00.000",lastSeenAt:"2026-10-01T01:00:00.000",missingSuccessCount:0,lifecycleStatus:"ACTIVE",source:{...plan.source},company:{officialChineseName:plan.company.officialChineseName}}]};
  const context=await loadPilotContext(base,plan);expect(context.previousJobs[0]!.record.category).toBe("其他");
  base.jobs[0]!.category="garbage";await expect(loadPilotContext(base,plan)).rejects.toThrow();
});
it("preserves a mapped category when a current-era missing job enters GRACE and excludes a pre-floor job",async()=>{
  const f=await ownedPortableFixture(),admission=f.admission;if(admission.status!=="ACCEPTED")throw Error("fixture");
  const receipt=admission.receipt,record=f.input.result.jobs[0]!,source=f.input.plan;
  const old={dedupeKey:record.sourceId+":missing",companyId:record.companyId,sourceId:record.sourceId,sourceJobId:"missing",officialTitle:"Missing job",auxiliaryChineseTitle:null,officialUrl:"https://example.test/missing",listUrl:null,locationRaw:"上海",city:"上海",cities:["上海"],category:"其他",officialPublishedAt:null,firstSeenAt:receipt.issuedAt,lastSeenAt:receipt.issuedAt,missingSuccessCount:1,lifecycleStatus:"ACTIVE",source:source.source,company:{officialChineseName:source.company.officialChineseName}};
  const row={id:receipt.binding.sourceResultId,batchId:receipt.binding.batchId,sourceId:receipt.binding.sourceId,sourceConfigHash:receipt.binding.sourceConfigSha256,releaseCandidateId:receipt.binding.releaseCandidateId,adapterVersion:receipt.binding.adapterVersion,dedupeOutputCount:1,finishedAt:receipt.issuedAt,completenessCertificate:receipt,completenessCertificateSha256:admission.receiptSha256,baselinePreviousSourceResultId:null,baselinePreviousJobCount:null,baselineChangeReason:"FIRST_ACCEPTED_CURRENT_POLICY_RECEIPT"};
  // The row transition is validated by the existing repository, so retain its exact first-observation reason.
  const built=buildAtomicRuntimeCommit(f.args);Object.assign(row,{baselineChangeReason:built.sourceResult.baselineChangeReason});
  const context=await loadPilotContext({sourceId:source.source.id,sourceConfigSha256:sourcePlanConfigSha256(source),latestAccepted:row,firstAccepted:row,jobs:[old,{...old,dedupeKey:record.sourceId+":legacy",sourceJobId:"legacy",lastSeenAt:"2020-01-01T00:00:00.000Z"}]},source);
  const commands=buildSourceQualityJobCommands({plan:source,result:f.input.result,admission,...context});
  const missing=commands.jobCommands.find(c=>c.record.sourceJobId==="missing");expect(missing?.record.category).toBe("其他");expect(missing?.lifecycleStatus).toBe("SUSPECTED_OFFLINE");expect(commands.jobCommands.some(c=>c.record.sourceJobId==="legacy")).toBe(false);
});
it.each(["success","failure"])("always reads persisted outcome after publish %s with no automatic retry",async outcome=>{
  const f=await ownedPortableFixture(),commit=buildAtomicRuntimeCommit(f.args),relay=new FilePilotRelay("unused");
  const sql=vi.spyOn(relay,"sql").mockImplementation(async kind=>{if(kind==="PUBLISH"){if(outcome==="failure")throw new PilotSqlFailure("ROLLED_BACK","57014");return [];}
    return [{row:JSON.parse(JSON.stringify({blockerCode:null,blockerReason:null,failureCategory:null,failureDiagnosticCode:null,failureCode:null,failureReason:null,...commit.sourceResult}))}];});
  const result=await reconcilePilotPublication(relay,"SET LOCAL statement_timeout = '120000ms';\nDO $$ BEGIN END $$;",commit,Date.now()+290000,Date.now()+550000);
  expect(result.state).toBe("COMMITTED_EXACT");expect(sql.mock.calls.map(c=>c[0])).toEqual(["PUBLISH","READ_OUTCOME"]);
});

it.each([
  ["server rollback",new PilotSqlFailure("ROLLED_BACK","57014"),false],
  ["proven no dispatch",new PilotSqlFailure("NOT_DISPATCHED","REVIEW_WINDOW_ELAPSED"),false],
  ["unknown tool result",new PilotSqlFailure("UNKNOWN","CONNECTION_LOST"),true],
  ["untyped failure",Error("RELAY_SQL_FAILED:57014"),true],
  ["response timeout",Error("RELAY_DEADLINE"),true],
  ["cancelled response wait",new DOMException("Cancelled","AbortError"),true]
] as const)("settles %s according to typed authority and always reads once without retry",async(_name,error,mustSettle)=>{
  const f=await ownedPortableFixture(),commit=buildAtomicRuntimeCommit(f.args),relay=new FilePilotRelay("unused"),deadline=Date.now()+290000;
  const sql=vi.spyOn(relay,"sql").mockImplementation(async kind=>{if(kind==="PUBLISH")throw error;return [];});
  settle.mockClear();settle.mockImplementationOnce(async ms=>{expect(ms).toBe(deadline-40000-Date.now());expect(sql.mock.calls.map(c=>c[0])).toEqual(["PUBLISH"]);});
  expect(await reconcilePilotPublication(relay,"SET LOCAL statement_timeout = '120000ms';\nDO $$ BEGIN END $$;",commit,deadline,deadline+260000)).toMatchObject({state:"CONFLICT"});
  expect(settle).toHaveBeenCalledTimes(mustSettle?1:0);
  expect(sql.mock.calls.map(c=>c[0])).toEqual(["PUBLISH","READ_OUTCOME"]);
  expect(sql.mock.calls[0]![2]).toBe(deadline-40000);
  settle.mockReset();
});

it("rejects publication unless more than 205 seconds remain for DB, transport, reconciliation and release",async()=>{
  const f=await ownedPortableFixture(),commit=buildAtomicRuntimeCommit(f.args),relay=new FilePilotRelay("unused");
  const sql=vi.spyOn(relay,"sql").mockResolvedValue([]);
  await expect(reconcilePilotPublication(relay,"SET LOCAL statement_timeout = '120000ms';\nDO $$ BEGIN END $$;",commit,Date.now()+205000,Date.now()+550000)).rejects.toThrow("PILOT_PUBLICATION_BUDGET_EXHAUSTED");
  expect(sql).not.toHaveBeenCalled();
});

it("rejects an otherwise live publication when the overall readback and release budget has already consumed its dispatch window",async()=>{
  const f=await ownedPortableFixture(),commit=buildAtomicRuntimeCommit(f.args),relay=new FilePilotRelay("unused");
  const sql=vi.spyOn(relay,"sql").mockResolvedValue([]);
  await expect(reconcilePilotPublication(relay,"SET LOCAL statement_timeout = '120000ms';\nDO $$ BEGIN END $$;",commit,Date.now()+231000,Date.now()+266000)).rejects.toThrow("PILOT_PUBLICATION_BUDGET_EXHAUSTED");
  expect(sql).not.toHaveBeenCalled();
});
it("settles unknown publication then grants one full readback window while reserving one full conditional release window",async()=>{
  const f=await ownedPortableFixture(),commit=buildAtomicRuntimeCommit(f.args),relay=new FilePilotRelay("unused");
  vi.useFakeTimers({toFake:["Date"]});const started=Date.now();vi.setSystemTime(started+200000);
  const sql=vi.spyOn(relay,"sql").mockImplementation(async kind=>{if(kind==="PUBLISH")throw new PilotSqlFailure("UNKNOWN","CONNECTION_LOST");return [];});
  settle.mockClear();settle.mockImplementationOnce(async ms=>{expect(ms).toBe(230000);vi.setSystemTime(Date.now()+ms);});
  expect(await reconcilePilotPublication(relay,"SET LOCAL statement_timeout = '120000ms';\nDO $$ BEGIN END $$;",commit,started+515000,started+550000)).toMatchObject({state:"CONFLICT",publishAcknowledged:false});
  expect(sql.mock.calls.map(c=>c[0])).toEqual(["PUBLISH","READ_OUTCOME"]);
  expect(sql.mock.calls[0]![2]).toBe(started+430000);
  expect(sql.mock.calls[1]![2]).toBe(started+490000);
  settle.mockReset();
});
