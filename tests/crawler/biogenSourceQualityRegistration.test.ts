import { createBiogenSyntheticBody } from "../helpers/biogenSyntheticFixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch, buildAtomicRuntimeCommit, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { searchPortableSnapshot } from "../../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../../src/db/portablePublicSnapshotRepository";

const NOW = new Date(process.env.BIOGEN_SYNTHETIC_CLOCK_ISO ?? "2026-10-02T01:00:00.000Z"), dirs: string[] = [];
if (!Number.isFinite(NOW.getTime())) throw Error("Invalid explicit synthetic test clock");
const endpoint = "https://biibhr.wd3.myworkdayjobs.com/wday/cxs/biibhr/external/jobs";
// Invented Workday rows, never an original or renewed official capture.
const syntheticBody = createBiogenSyntheticBody();
const planForBiogen = () => getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-biogen-china-social")!;
const rawBody = () => JSON.parse(syntheticBody);
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function capture(mutate?: (body: ReturnType<typeof rawBody>) => void) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  const plan = planForBiogen(), body = rawBody(); mutate?.(body); let calls = 0;
  vi.stubGlobal("fetch", async (url: string, request: { method: string; body: string }) => {
    calls++; expect(calls).toBe(1); expect(url).toBe(endpoint); expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({ appliedFacets: { locationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"] }, limit: 20, offset: 0 });
    return { status: 200, url, headers: new Headers({ "content-type": "application/json" }), text: async () => mutate ? JSON.stringify(body) : syntheticBody };
  });
  const result = await runSourceCrawl(plan, { fetch: createOwnedSourceQualityFetch(), isBaseline: true });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "biogen-synthetic-quality-")); dirs.push(workspaceRoot);
  const identity = { releaseCandidateId: "biogen-synthetic-quality", commitSha: "a".repeat(40), rosterSha256: "a".repeat(64), sourcePlanSha256: "a".repeat(64), sourceConfigSha256: "a".repeat(64), adapterBundleSha256: "a".repeat(64), batchKind: "SCHEDULED" as const, ownerId: "synthetic-offline-test", expectedPlannedSourceIds: [plan.source.id], expectedPlannedSourceSetSha256: "a".repeat(64), expectedPlannedSourceCount: 1 };
  const batchId = "biogen-synthetic-batch", pending = buildPendingRuntimeBatch(batchId, [plan], identity, NOW).sources[0]!;
  const binding = { releaseCandidateId: identity.releaseCandidateId, batchId, sourceResultId: pending.id, sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: pending.adapterVersion }, evidenceSubdirectory = "quality/runtime-evidence";
  const archive = await archiveSourceEvidence({ workspaceRoot, ...binding, sourceId: plan.source.id, evidenceSubdirectory, captureTool: result.fetchEvidence!.captureTool, artifacts: bindRuntimeEvidenceArtifactIds({ ...binding, sourceId: plan.source.id, artifacts: result.fetchEvidence!.artifacts }) });
  return { plan, result, binding, identity, pending, archive: { workspaceRoot, evidenceSubdirectory, artifacts: archive.artifacts } };
}

describe("Biogen exact mainland city-pending admission", () => {
  it("registers only the exact source policy", () => {
    const plan = structuredClone(planForBiogen()); expect(getSourceQualityPolicy(plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    if (plan.adapterId !== "official-json" || !plan.workday) throw Error("Biogen plan");
    delete plan.workday.listGeographyPolicy; expect(getSourceQualityPolicy(plan)).toBeNull();
  });
  it("issues one complete owned archive-bound atomic commit preserving all seven jobs and three pending cities", async () => {
    const input = await capture(), admission = await issueSourceQualityAdmission(input); expect(admission.status).toBe("ACCEPTED");
    const publication = buildSourceQualityJobCommands({ ...input, admission, previousJobs: [], firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true });
    expect(publication.jobCommands).toHaveLength(7);
    const jobs = publication.jobCommands.map(command => command.record);
    expect(jobs.filter(job => job.cities.length === 1 && job.cities[0] === "城市待核")).toHaveLength(3);
    expect(jobs.every(job => job.officialPublishedAt === undefined)).toBe(true);
    expect(Object.fromEntries(jobs.map(job => [job.officialUrl, job.locationRaw]))).toEqual(Object.fromEntries(rawBody().jobPostings.map((row: { externalPath: string; locationsText: string }) => [`${input.plan.source.officialEntryUrl}${row.externalPath}`, row.locationsText])));
    const commit = buildAtomicRuntimeCommit({ ...input, batchId: input.binding.batchId, previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: input.archive.artifacts, sourceAdmissionPolicy: "PLAN_BOUND_SOURCE_QUALITY_V1", sourceQualityAdmission: admission, firstAcceptedCurrentPolicyReceipt: null });
    await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
    const snapshot = { sources: [], lastUpdatedAt: null, coverage: { requiredCompanyCount: 40, excludedCompanyCount: 1 }, companies: [{ id: input.plan.company.id, companyName: input.plan.company.officialChineseName, pinyin: "biogen", required: true, publishingSourceIds: [input.plan.source.id], health: "HEALTHY", jobs: jobs.map(job => ({ ...job, id: job.sourceJobId!, city: job.cities[0]!, title: job.officialTitle, isNew: false })) }] } as unknown as PortablePublicSnapshot;
    for (const [city, expected] of [["北京", 1], ["上海", 3], ["广州", 0]] as const) expect(searchPortableSnapshot({ city }, snapshot).totalJobs).toBe(expected);
    if (process.env.BIOGEN_SYNTHETIC_EXPORT_PATH) await writeFile(process.env.BIOGEN_SYNTHETIC_EXPORT_PATH, JSON.stringify({ classification: "SYNTHETIC_SQL_TEST_ONLY", noLiveAcquisition: true, sourceFixtureOrigin: "SYNTHETIC_GENERATED", syntheticClock: NOW.toISOString(), sourceConfigSha256: input.binding.sourceConfigSha256, counts: { raw: 7, output: 7, cityResolved: 4, cityPending: 3 }, sources: [{ sourceId: input.plan.source.id, commit }] }, null, 2), { flag: "wx" });
  });
  it.each(["country facet", "country count", "location count", "identity", "foreign title", "unknown title", "opaque list"])("rejects owned %s corruption with no publication", async mutation => {
    const input = await capture(body => {
      const groups = body.facets.find((group: { facetParameter: string }) => group.facetParameter === "locationMainGroup").values;
      if (mutation === "country facet") groups[0].values.find((value: { descriptor: string }) => value.descriptor === "China").descriptor = "United States";
      else if (mutation === "country count") groups[0].values.find((value: { descriptor: string }) => value.descriptor === "China").count = 8;
      else if (mutation === "location count") groups[1].values[0].count = 5;
      else if (mutation === "identity") body.jobPostings[0].bulletFields = ["REQ999"];
      else if (mutation === "foreign title") body.jobPostings[2].title = "Role (Location: Boston)";
      else if (mutation === "unknown title") body.jobPostings[2].title = "Role (Location: Atlantis)";
      else body.jobPostings[0].locationsText = "2 Locations";
    });
    const admission = await issueSourceQualityAdmission(input); expect(admission.status).toBe("REJECTED");
    expect(buildSourceQualityJobCommands({ ...input, admission, previousJobs: [], firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true }).jobCommands).toEqual([]);
  });
  it.each([["上海"], ["武汉"], ["中国"], ["城市待核", "上海"]].map(cities => ({ cities })))("rejects forging the pending output as %j", async ({ cities }) => {
    const input = await capture(); input.result.jobs[2]!.cities = cities;
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
  it("rejects imported evidence and dropping a pending row", async () => {
    const input = await capture();
    expect(await issueSourceQualityAdmission({ ...input, result: structuredClone(input.result) })).toMatchObject({ status: "REJECTED", codes: ["OWNED_ACQUISITION_REQUIRED"] });
    input.result.jobs.splice(2, 1); expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
});
