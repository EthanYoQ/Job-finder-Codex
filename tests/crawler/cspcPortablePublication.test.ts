// Offline owned-acquisition test only. Invented in-memory transport; never production evidence.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";
import { accepted, job } from "../helpers/portablePublicSnapshotFixture";

const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-cspc-social")!;
const directories: string[] = [];
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path, {recursive:true, force:true}))); });

async function capture() {
  const fixture = JSON.parse(await readFile("src/crawler/fixtures/cspc-candidate-scope-20261001.json", "utf8"));
  const originals = ["entry", "list", "api"].map(kind => ({kind, capturedAt:"2026-10-01T15:20:00.000Z", body:kind === "api"
    ? JSON.stringify({state:"1", total:"", jsonList:fixture.returnedRows})
    : kind === "list" ? `<script>var requestId = '${fixture.requestIdEncoded}';</script>` : "<html>entry"}));
  const startedAt = originals[0]!.capturedAt, finishedAt = originals[2]!.capturedAt;
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date(finishedAt));
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);
    const kind = url.includes("queryPostList.mob") ? "api" : url.includes("officePage.mob") ? "list" : url === plan.source.officialEntryUrl ? "entry" : null;
    if (!kind) throw Error("CSPC_SYNTHETIC_UNEXPECTED_REQUEST");
    const original = originals.find(row => row.kind === kind)!;
    const response = new Response(original.body, {status:200,headers:{"content-type":kind === "api" ? "application/json" : "text/html"}});
    Object.defineProperty(response,"url",{value:url}); return response;
  });
  const root = await mkdtemp(join(tmpdir(), "cspc-owned-offline-")); directories.push(root);
  const fetch = createOwnedSourceQualityFetch();
  const result = await runSourceCrawl(plan, {fetch, isBaseline:false});
  const identity = {releaseCandidateId:"cspc-offline-test", commitSha:"a".repeat(40), rosterSha256:"a".repeat(64),
    sourcePlanSha256:"a".repeat(64), sourceConfigSha256:"a".repeat(64), adapterBundleSha256:"a".repeat(64),
    batchKind:"SCHEDULED" as const, ownerId:"offline-test", expectedPlannedSourceIds:[plan.source.id],
    expectedPlannedSourceSetSha256:digest(JSON.stringify([plan.source.id])), expectedPlannedSourceCount:1};
  const batchId = "cspc-offline-batch", pending = buildPendingRuntimeBatch(batchId, [plan], identity, new Date(startedAt)).sources[0]!;
  const binding = {releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,
    sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion};
  const evidenceSubdirectory = "portable-quality/runtime-evidence";
  const archive = await archiveSourceEvidence({workspaceRoot:root, evidenceSubdirectory, ...binding, sourceId:plan.source.id,
    captureTool:result.fetchEvidence!.captureTool, artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
  return {plan, result, binding, identity, batchId, pending, startedAt, finishedAt,
    archive:{workspaceRoot:root,evidenceSubdirectory,artifacts:archive.artifacts}};
}

describe("CSPC bounded portable publication", () => {
  it("replays 31 channel rows into the unchanged portable issuer, atomic builder and reader with six unknown candidates", async () => {
    const input = await capture();
    expect(sourcePlanConfigSha256(plan)).toBe("5fbeee6e6b8d95f05d2b8771908f206ba8f45eea32a6208f21490a058332d409");
    const audit = JSON.parse(String(input.result.fetchEvidence!.artifacts.find(a => a.logicalKey.endsWith("-candidate-scope"))!.body));
    expect(audit).toMatchObject({status:"CANDIDATE_QUERY_SUBSET", officialDeclaredTotal:null});
    expect(audit.candidateIds).toHaveLength(37); expect(audit.unexplainedCandidateIds).toHaveLength(6);
    const admission = await issueSourceQualityAdmission(input);
    expect(admission.status).toBe("ACCEPTED"); if (admission.status !== "ACCEPTED") throw Error(JSON.stringify(admission));
    expect(admission.receipt).toMatchObject({schemaVersion:"plan-bound-source-quality-v1",
      declaredCompleteness:{kind:"COMPLETE_PAGE_TRAVERSAL",value:1,scope:"CHANNEL"},
      observation:{expectedJobCount:null,expectedEvidenceKind:"COMPLETE_PAGE_TRAVERSAL"}, counts:{rawCount:31,finalUniqueJobCount:31},
      acquisition:{startedAt:input.startedAt,finishedAt:input.finishedAt}});
    expect(admission.receipt).not.toHaveProperty("grade");
    expect(admission.receipt.acquisition).not.toHaveProperty("origin");
    const commit = buildAtomicRuntimeCommit({...input, previousJobs:[], baselineCompletedBeforeCrawl:false,
      artifacts:input.archive.artifacts, sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1", sourceQualityAdmission:admission,
      firstAcceptedCurrentPolicyReceipt:null});
    verifySourceQualityAtomicCommit({plan,commit}); await verifyAtomicRuntimeCommitForPersistence(commit);
    expect(commit.commands.filter(c => c.type === "UPSERT_JOB")).toHaveLength(31);
    const fixture = accepted(input.finishedAt, input.result.jobs.map(row => row.sourceJobId!), [], plan);
    const persisted = {...fixture.result, ...commit.sourceResult, completenessCertificate:admission.receipt,
      batch:{id:input.batchId,releaseCandidateId:input.identity.releaseCandidateId,kind:"SCHEDULED" as const,status:"SUCCESS" as const}};
    const options = {currentTime:new Date(input.finishedAt)};
    const selected = selectPortableSourceSnapshots([plan], [persisted], options)[0]!;
    expect(selected).toMatchObject({state:"PUBLISHING",lastAcceptedJobCount:31,selected:{receipt:admission.receipt}});
    const members = fixture.members.map(member => ({...member,releaseCandidateId:input.identity.releaseCandidateId,batchId:input.batchId,sourceResultId:input.pending.id}));
    const rows = input.result.jobs.map(record => ({...job(record.sourceJobId!, input.finishedAt), companyId:plan.company.id,
      sourceId:plan.source.id,dedupeKey:`${plan.source.id}:${record.sourceJobId}`,officialTitle:record.officialTitle,
      officialUrl:record.officialUrl,cities:record.cities,city:record.cities[0]!,locationRaw:record.locationRaw}));
    const projection = projectPortableSourceJobs(selected, members, rows, options);
    expect(projection).toMatchObject({state:"PUBLISHING",visibleJobCount:31});
    expect(rows.some(row => audit.unexplainedCandidateIds.some((id:string) => row.dedupeKey.endsWith(id)))).toBe(false);
    expect(selectPortableSourceSnapshots([plan], [persisted], {currentTime:new Date(Date.parse(input.startedAt) + 30 * 3_600_000)})[0]).toMatchObject({state:"HOLD",freshness:"STALE"});
    vi.setSystemTime(new Date(Date.parse(input.finishedAt) + 31 * 60_000));
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["ACQUISITION_NOT_FRESH"]});
  });
});
