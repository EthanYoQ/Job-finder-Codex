// Offline tests only. An optional retained directory is replayed at its original
// clock; neither these synthetic receipts nor old originals are publication input.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createReviewedRetainedSourceFetch, issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";
import { accepted, job } from "../helpers/portablePublicSnapshotFixture";

const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-cspc-social")!;
const directories: string[] = [];
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map(path => rm(path, {recursive:true, force:true}))); });

async function capture() {
  const fixture = JSON.parse(await readFile("src/crawler/fixtures/cspc-candidate-scope-20261001.json", "utf8"));
  const retained = process.env.CSPC_OFFLINE_REPLAY_DIRECTORY;
  const originals = await Promise.all(["entry", "list", "api"].map(async kind => {
    if (retained) {
      const file = `cspc-${kind}.${kind === "api" ? "json" : "html"}`;
      const body = await readFile(join(retained, file), "utf8");
      const manifest = JSON.parse(await readFile(join(retained, "MANIFEST.json"), "utf8")) as Array<{path:string;sha256:string}>;
      expect(digest(body)).toBe(manifest.find(row => row.path === file)?.sha256);
      const meta = JSON.parse(await readFile(join(retained, `cspc-${kind}.meta.json`), "utf8"));
      return {kind, body, capturedAt:new Date(meta.runtime_observed_at ?? meta.observed_at).toISOString()};
    }
    return {kind, capturedAt:"2026-10-01T15:20:00.000Z", body:kind === "api"
      ? JSON.stringify({state:"1", total:"", jsonList:fixture.returnedRows})
      : kind === "list" ? `<script>var requestId = '${fixture.requestIdEncoded}';</script>` : "<html>entry</html>"};
  }));
  const startedAt = originals[0]!.capturedAt, finishedAt = originals[2]!.capturedAt;
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date(finishedAt));
  let clockStarted = false;
  const fetched = await createOfficialJsonSourceFetch({allowBrowserFallback:false,
    now:() => { const at = clockStarted ? finishedAt : startedAt; clockStarted = true; return new Date(at); },
    http:async request => {
      const kind = request.url.includes("queryPostList.mob") ? "api" : request.url.includes("officePage.mob") ? "list" : "entry";
      const original = originals.find(row => row.kind === kind)!;
      return {status:200, finalUrl:request.url, contentType:kind === "api" ? "application/json" : "text/html", ...original};
    }})(plan);
  expect(fetched).toMatchObject({ok:true, fetchEvidence:{fetchCounts:{rawCount:31, parsedCount:31, validCount:31}}});
  const root = await mkdtemp(join(tmpdir(), "cspc-offline-replay-")); directories.push(root);
  const bytes = serialize(fetched), originalPath = join(root, "original.v8"); await writeFile(originalPath, bytes);
  const manifestPath = join(root, "retained.json"), manifest = JSON.stringify({schemaVersion:2, sourceId:plan.source.id,
    sourceConfigSha256:sourcePlanConfigSha256(plan), startedAt, finishedAt,
    fetched:{path:originalPath,sha256:digest(bytes),encoding:"v8"}});
  await writeFile(manifestPath, manifest);
  const fetch = await createReviewedRetainedSourceFetch(manifestPath, digest(manifest));
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
  return {plan, result, binding, identity, batchId, pending, startedAt, finishedAt, manifestPath, manifest,
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
      acquisition:{origin:"REVIEWED_RETAINED_CAPTURE",startedAt:input.startedAt,finishedAt:input.finishedAt}});
    expect(admission.receipt).not.toHaveProperty("grade");
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
    await expect(createReviewedRetainedSourceFetch(input.manifestPath, digest(input.manifest))).rejects.toThrow("RETAINED_CAPTURE_TOO_OLD");
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status:"REJECTED",codes:["ACQUISITION_NOT_FRESH"]});
  });
});
