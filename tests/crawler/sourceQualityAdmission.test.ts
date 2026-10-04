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
async function portableCommit() {
  const input=await capture();
  const identity={releaseCandidateId:input.binding.releaseCandidateId,commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"quality-worker",expectedPlannedSourceIds:[input.plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
  const pending=buildPendingRuntimeBatch(input.binding.batchId,[input.plan],identity,NOW).sources[0]!;
  input.binding.adapterVersion=pending.adapterVersion;
  const admission=await issueSourceQualityAdmission(input);
  expect(admission.status).toBe("ACCEPTED");if(admission.status!=="ACCEPTED")throw Error("Expected acceptance");
  const commit=buildAtomicRuntimeCommit({plan:input.plan,pending,identity,batchId:input.binding.batchId,result:input.result,
    previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:input.archive.artifacts});
  commit.sourceResult.completenessState="VERIFIED";commit.sourceResult.completenessCertificate=admission.receipt;
  commit.sourceResult.completenessCertificateSha256=admission.receiptSha256;
  commit.sourceResult.blockerCode=null;commit.sourceResult.blockerReason=null;
  commit.observationProvenance.completenessVerified=true;
  // The portable builder derives this from the successful strict source replay.
  commit.sourceResult.visitedChannelSha256=commit.sourceResult.expectedChannelSha256;
  commit.observationProvenance.visitedChannelSha256=commit.sourceResult.expectedChannelSha256;
  for(const command of commit.commands)if(command.type==="UPSERT_CRAWL_OBSERVATION")command.observation=structuredClone(input.result.observation);
  return {plan:input.plan,commit};
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

describe("plan-bound source quality admission", () => {
  it("pins only twenty reviewed exact configurations and refuses a changed plan", () => {
    const plans = buildStagedSourceCrawlPlans(candidateCompanies);
    expect(plans.filter(p => getSourceQualityPolicy(p) !== null)).toHaveLength(20);
    const altered = plan(); altered.source.officialEntryUrl += "?different=1";
    expect(getSourceQualityPolicy(altered)).toBeNull();
  });
  it("admits owned complete multi-page Hansoh acquisition with its own receipt, never A/B", async () => {
    const input = await capture(Array.from({length:203},(_,i)=>row(i+1)));
    const decision = await issueSourceQualityAdmission(input);
    expect(decision.status).toBe("ACCEPTED");
    if (decision.status !== "ACCEPTED") return;
    expect(decision.receipt).toMatchObject({schemaVersion:"plan-bound-source-quality-v1", policyId:"PLAN_BOUND_SOURCE_QUALITY_V1",
      counts:{rawCount:203, finalUniqueJobCount:203}, acquisition:{startedAt:NOW.toISOString(),finishedAt:NOW.toISOString()}});
    expect(decision.receipt).not.toHaveProperty("grade");
    expect(JSON.stringify(decision.receipt)).not.toContain("CURRENT_RUN");
    expect(()=>verifySourceQualityReceipt({receipt:decision.receipt,receiptSha256:decision.receiptSha256,
      expected:{...input.binding,sourceId:input.plan.source.id}})).not.toThrow();
  });
  it("does not depend on a caller-set completeness truth bit", async () => {
    const input = await capture(); input.result.truth.completenessVerified = false;
    expect((await issueSourceQualityAdmission(input)).status).toBe("ACCEPTED");
  });
  it("rejects cloned or imported evidence even when perfectly consistent", async () => {
    const input = await capture(); input.result = structuredClone(input.result);
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["OWNED_ACQUISITION_REQUIRED"]});
  });
  it("rejects coherent post-acquisition raw/body/output mutation even after rehashing", async () => {
    const input = await capture();
    const evidence = input.result.fetchEvidence!;
    const artifact = evidence.artifacts[0]!; const body = JSON.parse(String(artifact.body)); body.Data[0].JobAdName="替换职位";
    artifact.body=JSON.stringify(body); evidence.pages[0]!.responseFingerprintSha256=digest(String(artifact.body));
    input.result.jobs[0]!.officialTitle="替换职位";
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["ACQUISITION_MUTATED"]});
  });
  it("rejects output corruption although keys and completeness claims remain unchanged", async () => {
    const input = await capture(); input.result.jobs[0]!.locationRaw="北京";
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
  it("rejects falsified reconciliation and loss accounting", async () => {
    const input = await capture(); input.result.reconciliation!.rawInputCount++;
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
  it("rejects a disappeared or altered archived file", async () => {
    const input = await capture(); await writeFile(join(input.archive.workspaceRoot,input.archive.artifacts[0]!.path),"{}");
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["ARCHIVE_VERIFICATION_FAILED"]});
  });
  it("rejects rewritten archive metadata", async () => {
    const input = await capture(); input.archive.artifacts[0]!.capturedAt=new Date(NOW.getTime()-1000);
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
  it("does not issue a fresh receipt for an old owned acquisition", async () => {
    const input = await capture(); vi.setSystemTime(new Date(NOW.getTime()+31*60*1000));
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["ACQUISITION_NOT_FRESH"]});
  });
  it("rejects a caller-supplied wrong configuration binding", async () => {
    const input=await capture(); input.binding.sourceConfigSha256="f".repeat(64);
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
  it("rejects plan changes during asynchronous archive/replay work", async () => {
    const input=await capture(); const pending=issueSourceQualityAdmission(input);
    input.plan.company.officialChineseName="换企业";
    expect((await pending).status).toBe("REJECTED");
  });
  it("rejects result changes during asynchronous archive/replay work", async () => {
    const input=await capture(); const pending=issueSourceQualityAdmission(input);
    input.result.observation.stableRequiredFields=[];
    expect((await pending).status).toBe("REJECTED");
  });
  it.each(["evidence","reconciliation","pagination","observation"])("revokes mutation capability when %s changes after issuance", async field=>{
    const input=await capture();const decision=await issueSourceQualityAdmission(input);expect(decision.status).toBe("ACCEPTED");
    if(field==="evidence")input.result.fetchEvidence!.artifacts[0]!.httpStatus=201;
    if(field==="reconciliation")input.result.reconciliation!.rawInputCount++;
    if(field==="pagination")input.result.paginationEvaluation!.safeCompleteness=false;
    if(field==="observation")input.result.observation.stableRequiredFields=[];
    expect(()=>assertIssuedSourceQualityAdmission(decision,input.result,input.plan)).toThrow();
  });
  it("verifies a persisted portable receipt against the actual atomic tuple, rows and provenance",async()=>{
    const input=await portableCommit();expect(()=>verifySourceQualityAtomicCommit(input)).not.toThrow();
  });
  it.each(["counts","company","channels","rawHash","outputHash","adapterHash","collisionHash","artifact","pagination","lossLedger","jobRecord"])("rejects persisted %s mismatch despite a valid receipt self-hash",async field=>{
    const input=await portableCommit();const c=input.commit;
    if(field==="counts")c.sourceResult.rawCount++;
    if(field==="company")input.plan.company.id="company-other";
    if(field==="channels")c.sourceResult.officialChannelIds=["other"];
    if(field==="rawHash")c.observationProvenance.canonicalRawSha256="f".repeat(64);
    if(field==="outputHash")c.sourceResult.canonicalOutputSetSha256="f".repeat(64);
    if(field==="adapterHash")c.sourceResult.adapterReconciliationSha256="f".repeat(64);
    if(field==="collisionHash")c.sourceResult.collisionLedgerSha256="f".repeat(64);
    if(field==="artifact")c.artifacts[0]!.sha256="f".repeat(64);
    if(field==="pagination")c.pagination[0]!.declaredTotal=2;
    if(field==="lossLedger")c.lossLedger.push({releaseCandidateId:c.sourceResult.releaseCandidateId,batchId:c.sourceResult.batchId,sourceId:c.sourceResult.sourceId,sourceResultId:c.sourceResult.id,stage:"VALIDATION",reason:"invented",rawLocator:"invented",details:{}});
    if(field==="jobRecord"){const command=c.commands.find(c=>c.type==="UPSERT_JOB");if(command?.type==="UPSERT_JOB")command.record.officialTitle="changed";}
    expect(()=>verifySourceQualityAtomicCommit(input)).toThrow();
  });
  it("preserves original bytes and capture timestamps across issuance", async () => {
    const input = await capture(); const before = await readFile(join(input.archive.workspaceRoot,input.archive.artifacts[0]!.path));
    await issueSourceQualityAdmission(input);
    expect(await readFile(join(input.archive.workspaceRoot,input.archive.artifacts[0]!.path))).toEqual(before);
    expect(input.result.fetchEvidence!.artifacts[0]!.capturedAt).toBe(NOW.toISOString());
  });
  it("rejects a forged receipt hash and a mismatched persisted tuple", async () => {
    const input = await capture(); const decision=await issueSourceQualityAdmission(input); expect(decision.status).toBe("ACCEPTED");
    if(decision.status!=="ACCEPTED") return;
    expect(()=>verifySourceQualityReceipt({receipt:decision.receipt,receiptSha256:"f".repeat(64),expected:{...input.binding,sourceId:input.plan.source.id}})).toThrow();
    expect(()=>verifySourceQualityReceipt({receipt:decision.receipt,receiptSha256:decision.receiptSha256,expected:{...input.binding,batchId:"other",sourceId:input.plan.source.id}})).toThrow();
  });
});
