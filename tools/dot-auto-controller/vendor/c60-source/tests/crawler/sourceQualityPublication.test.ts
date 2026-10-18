import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds } from "../../src/crawler/runtimeAtomicEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission, type SourceQualityReceipt } from "../../src/crawler/sourceQualityAdmission";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import type { JobSnapshot } from "../../src/crawler/lifecycle";
import { pages, detail } from "../helpers/novoC60SyntheticFixture";
import { novoSourceJobExclusions, replayNovoChinaRows } from "../../src/crawler/novoChinaQuality";
const NOW="2026-10-01T11:50:00.000Z", OLD="2026-09-20T11:50:00.000Z", FIRST="2026-09-30T11:50:00.000Z";
const dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function fixture(at=NOW,novo?:"valid"|"insufficient") {
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>({status:200,url:String(url),headers:new Headers({"content-type":"application/json"}),text:async()=>JSON.stringify({Code:200,Count:1,Data:[{Id:"00000000-0000-4000-8000-000000000001",JobAdId:1,JobAdName:"职位一",LocNames:["上海市"],Category:"社会招聘",CategoryId:"1",Kind:"全职",Status:1,PostDate:"2026-09-20T12:00:00"}]})})));
  if(novo) vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
    const page=pages.get(String(url));if(!page)throw Error("Unexpected synthetic URL");
    const body=novo==="insufficient"&&url===detail(2)?page.body.replace(
      "Develop synthetic laboratory procedures and maintain documented quality controls for research teams.",
      "* We commit to an inclusive recruitment process and equality of opportunity for all our job applicants."):page.body;
    return {status:200,url:page.finalUrl,headers:new Headers({"content-type":page.contentType}),text:async()=>body};
  }));
  const plan=structuredClone(getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),novo?"source-novo-nordisk-china-social":"source-hansoh-social")!);
  const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
  const workspaceRoot=await mkdtemp(join(tmpdir(),"source-quality-publication-"));dirs.push(workspaceRoot);
  const binding={releaseCandidateId:"portable-publication",batchId:`batch-${Date.parse(at)}`,sourceResultId:`source-result-${Date.parse(at)}`,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:"a".repeat(64)};
  const evidenceSubdirectory="quality/evidence";
  const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,
    artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
  const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});
  expect(admission.status).toBe("ACCEPTED");
  return {plan,result,admission,previousJobs:[] as JobSnapshot[],firstAcceptedCurrentPolicyReceipt:null as {receipt:unknown;receiptSha256:string;expectedBinding:SourceQualityReceipt["binding"]}|null,baselineCompletedBeforeCrawl:true};
}
function priorReference(input:Awaited<ReturnType<typeof fixture>>) {
  if(input.admission.status!=="ACCEPTED")throw Error("Expected accepted prior fixture");
  return {receipt:input.admission.receipt,receiptSha256:input.admission.receiptSha256,expectedBinding:input.admission.receipt.binding};
}
function previous(record:NormalizedJobRecord,lastSeenAt=OLD,missing=0):JobSnapshot {return {record,dedupeKey:buildJobDedupeKey(record),lifecycleStatus:missing<2?"ACTIVE":missing===2?"SUSPECTED_OFFLINE":"OFFLINE",missingSuccessfulCrawlCount:missing,firstSeenAt:OLD,lastSeenAt};}
function legacyJob(record:NormalizedJobRecord):NormalizedJobRecord {return {...structuredClone(record),sourceJobId:"legacy-import",officialTitle:"旧数据"};}

describe("portable quality public Job mutation boundary",()=>{
  it("publishes the first accepted current-policy result and returns its visibility floor",async()=>{
    const input=await fixture();const output=buildSourceQualityJobCommands(input);
    expect(output.visibilityFloor).toBe(NOW);expect(output.jobCommands).toHaveLength(1);
    expect(output.jobCommands[0]).toMatchObject({type:"UPSERT_JOB",missingSuccessfulCrawlCount:0,lastSeenAt:NOW});
  });
  it("never includes legacy-only rows in the first refresh grace set and preserves their history",async()=>{
    const input=await fixture();input.previousJobs=[previous(input.result.jobs[0]!),previous(legacyJob(input.result.jobs[0]!))];
    const before=structuredClone(input.previousJobs);const output=buildSourceQualityJobCommands(input);
    expect(output.jobCommands).toHaveLength(1);expect(output.jobCommands[0]?.firstSeenAt).toBe(OLD);
    expect(input.previousJobs).toEqual(before);
  });
  it("hides later accepted-policy missing rows in the first complete batch",async()=>{
    const prior=await fixture(FIRST);const input=await fixture();input.firstAcceptedCurrentPolicyReceipt=priorReference(prior);
    input.previousJobs=[previous(legacyJob(input.result.jobs[0]!),FIRST)];
    const output=buildSourceQualityJobCommands(input);expect(output.visibilityFloor).toBe(FIRST);
    expect(output.jobCommands).toHaveLength(2);
    expect(output.jobCommands.find(c=>c.record.sourceJobId==="legacy-import")).toMatchObject({lifecycleStatus:"OFFLINE",visibleInFrontend:false,missingSuccessfulCrawlCount:1,lastSeenAt:FIRST});
  });
  it("does not revive a legacy row older than the portable visibility floor",async()=>{
    const prior=await fixture(FIRST);const input=await fixture();input.firstAcceptedCurrentPolicyReceipt=priorReference(prior);
    input.previousJobs=[previous(legacyJob(input.result.jobs[0]!))];
    expect(buildSourceQualityJobCommands(input).jobCommands).toHaveLength(1);
  });
  it("returns no Job writes or missing-count changes for rejected/incomplete quality",async()=>{
    const prior=await fixture(FIRST);const input=await fixture();input.previousJobs=[previous(input.result.jobs[0]!)];input.firstAcceptedCurrentPolicyReceipt=priorReference(prior);
    input.admission={status:"REJECTED",codes:["SOURCE_QUALITY_REPLAY_FAILED"]};
    const before=structuredClone(input.previousJobs);
    expect(buildSourceQualityJobCommands(input)).toEqual({jobCommands:[],visibilityFloor:FIRST});
    expect(input.previousJobs).toEqual(before);
  });
  it("uses receipt issuedAt exactly even when a batch/transaction completion would be later",async()=>{
    const prior=await fixture(FIRST);const input=await fixture();input.firstAcceptedCurrentPolicyReceipt=priorReference(prior);
    input.previousJobs=[previous(legacyJob(input.result.jobs[0]!),FIRST)];
    expect(buildSourceQualityJobCommands(input).visibilityFloor).toBe(FIRST);
    const changed=structuredClone(input.firstAcceptedCurrentPolicyReceipt);changed.expectedBinding.sourceConfigSha256="f".repeat(64);
    input.firstAcceptedCurrentPolicyReceipt=changed;expect(()=>buildSourceQualityJobCommands(input)).toThrow();
  });
  it("cannot turn a saved receipt into a live Job mutation capability",async()=>{
    const input=await fixture();input.admission=structuredClone(input.admission);
    expect(()=>buildSourceQualityJobCommands(input)).toThrow("LIVE_SOURCE_QUALITY_ADMISSION_REQUIRED");
  });
  it("rejects output mutation after admission and invalid future publication floors",async()=>{
    const future=await fixture("2026-10-02T11:50:00.000Z");const input=await fixture();input.firstAcceptedCurrentPolicyReceipt=priorReference(future);
    expect(()=>buildSourceQualityJobCommands(input)).toThrow();
    input.firstAcceptedCurrentPolicyReceipt=null;input.result.jobs[0]!.officialTitle="替换";
    expect(()=>buildSourceQualityJobCommands(input)).toThrow();
  });
});


describe("Novo unpublished insufficient detail isolation",()=>{
  it("publishes the valid row, distinguishes UNKNOWN from CLOSED, and creates no placeholder",async()=>{
    const input=await fixture(NOW,"insufficient"), evidence=input.result.fetchEvidence!;
    expect(evidence.fetchCounts).toMatchObject({rawCount:3,validCount:1,validationDiscardCount:2});
    const excluded=novoSourceJobExclusions(evidence);
    expect(excluded.insufficient.size).toBe(1);expect(excluded.closed.size).toBe(1);
    expect([...excluded.insufficient].some(id=>excluded.closed.has(id))).toBe(false);
    const output=buildSourceQualityJobCommands(input);
    expect(output.jobCommands).toHaveLength(1);expect(output.jobCommands[0]!.record.officialUrl).toBe(detail(1));
    const forged=structuredClone(evidence);
    (forged.fetchLosses.find(loss=>(loss.details as {code:string}).code==="NOVO_DETAIL_INSUFFICIENT")!.details as {code:string}).code="OFFICIAL_APPLICATION_CLOSED";
    expect(replayNovoChinaRows(input.plan,forged,input.result.jobs,NOW)).toBe(false);
  });
  it("keeps an old legacy UNKNOWN excluded while a truly missing policy-era row goes offline",async()=>{
    const prior=await fixture(FIRST,"valid"),input=await fixture(NOW,"insufficient");
    input.firstAcceptedCurrentPolicyReceipt=priorReference(prior);
    const unknown=prior.result.jobs.find(job=>job.officialUrl===detail(2))!;
    const absent={...prior.result.jobs[0]!,sourceJobId:"absent-policy-row"};
    input.previousJobs=[previous(unknown,OLD),previous(absent,FIRST)];
    const output=buildSourceQualityJobCommands(input);
    expect(output.jobCommands).toHaveLength(2);
    expect(output.jobCommands.some(command=>command.record.sourceJobId===unknown.sourceJobId)).toBe(false);
    expect(output.jobCommands.find(command=>command.record.sourceJobId===absent.sourceJobId)).toMatchObject({lifecycleStatus:"OFFLINE",lastSeenAt:FIRST,missingSuccessfulCrawlCount:1});
  });
  it("holds known public UNKNOWN rows across repeated rounds without changing their old time",async()=>{
    const prior=await fixture(FIRST,"valid"),record=prior.result.jobs.find(job=>job.officialUrl===detail(2))!;
    const jobs=[previous(record,FIRST)],before=structuredClone(jobs);
    for(const at of [NOW,"2026-10-02T11:50:00.000Z"]){
      const input=await fixture(at,"insufficient");input.firstAcceptedCurrentPolicyReceipt=priorReference(prior);input.previousJobs=jobs;
      expect(()=>buildSourceQualityJobCommands(input)).toThrow("NOVO_PREVIOUS_JOB_DETAIL_UNKNOWN_PRESERVE_LAST_GOOD");
      expect(jobs).toEqual(before);
    }
  });
});
