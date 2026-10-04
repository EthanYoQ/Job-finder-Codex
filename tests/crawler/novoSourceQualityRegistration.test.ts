import { createNovoSyntheticFixture, NOVO_SYNTHETIC_BODY_SHA256, NOVO_SYNTHETIC_BODY_BYTES } from "../helpers/novoSyntheticFixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch, buildAtomicRuntimeCommit, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import { persistentOfficialJsonJobId } from "../../src/crawler/officialJsonEvidence";
import { searchPortableSnapshot } from "../../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../../src/db/portablePublicSnapshotRepository";

const NOW = new Date(process.env.NOVO_SYNTHETIC_CLOCK_ISO ?? "2026-10-02T02:00:00.000Z"), dirs: string[] = [];
if (!Number.isFinite(NOW.getTime())) throw Error("Invalid explicit synthetic test clock");
const endpoint = "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
const capturedAt = "2026-10-02T01:44:06.473Z";
const bodySha256 = NOVO_SYNTHETIC_BODY_SHA256;
// Deterministic invented bodies; both HTTP and its clock remain synthetic.
const { body: syntheticBody, captures: htmlCaptures } = createNovoSyntheticFixture();
const planForNovo = () => getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novo-nordisk-china-social")!;
const rawBody = () => JSON.parse(syntheticBody);
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function capture(mutate?: (body: ReturnType<typeof rawBody>) => void) {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  const plan = planForNovo(), body = rawBody(); mutate?.(body); let calls = 0;
  vi.stubGlobal("fetch", async (url: string, request: { method: string }) => {
    calls++; expect(calls).toBeLessThanOrEqual(56); expect(request.method).toBe("GET");
    if (url !== endpoint) {
      const retained = htmlCaptures[url]; if (!retained) throw Error(`Unexpected URL ${url}`);
      return { status: 200, url: retained.finalUrl, headers: new Headers({ "content-type": retained.contentType }), text: async () => retained.body };
    }
    return { status: 200, url, headers: new Headers({ "content-type": "application/json;charset=utf-8" }), text: async () => mutate ? JSON.stringify(body) : syntheticBody };
  });
  const result = await runSourceCrawl(plan, { fetch: createOwnedSourceQualityFetch(), isBaseline: true });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "novo-synthetic-quality-")); dirs.push(workspaceRoot);
  const identity = { releaseCandidateId: "novo-synthetic-quality", commitSha: "a".repeat(40), rosterSha256: "a".repeat(64), sourcePlanSha256: "a".repeat(64), sourceConfigSha256: "a".repeat(64), adapterBundleSha256: "a".repeat(64), batchKind: "SCHEDULED" as const, ownerId: "synthetic-offline-test", expectedPlannedSourceIds: [plan.source.id], expectedPlannedSourceSetSha256: "a".repeat(64), expectedPlannedSourceCount: 1 };
  const batchId = "novo-synthetic-batch", pending = buildPendingRuntimeBatch(batchId, [plan], identity, NOW).sources[0]!;
  const binding = { releaseCandidateId: identity.releaseCandidateId, batchId, sourceResultId: pending.id, sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: pending.adapterVersion }, evidenceSubdirectory = "quality/runtime-evidence";
  const archive = await archiveSourceEvidence({ workspaceRoot, ...binding, sourceId: plan.source.id, evidenceSubdirectory, captureTool: result.fetchEvidence!.captureTool, artifacts: bindRuntimeEvidenceArtifactIds({ ...binding, sourceId: plan.source.id, artifacts: result.fetchEvidence!.artifacts }) });
  return { plan, result, binding, identity, pending, archive: { workspaceRoot, evidenceSubdirectory, artifacts: archive.artifacts } };
}

describe("Novo exact nested-location admission", () => {
  it("registers only the exact reviewed policy", () => {
    const plan = structuredClone(planForNovo()); expect(getSourceQualityPolicy(plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "novo-nordisk") throw Error("Novo plan");
    plan.officialJsonFetch.cityScopePolicy = "NOVO_CHINA_MAINLAND_JOB_CITY_V1"; expect(getSourceQualityPolicy(plan)).toBeNull();
  });
  it("issues one complete owned archive-bound atomic commit publishing 20 active jobs and retaining seven closure records", async () => {
    expect(createHash("sha256").update(syntheticBody).digest("hex")).toBe(bodySha256);
    const input = await capture(), admission = await issueSourceQualityAdmission(input); expect(admission.status).toBe("ACCEPTED");
    const publication = buildSourceQualityJobCommands({ ...input, admission, previousJobs: [], firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true });
    expect(publication.jobCommands).toHaveLength(20);
    expect(input.result.fetchEvidence!.fetchCounts).toMatchObject({ rawCount: 27, parsedCount: 27, validCount: 20, parseDiscardCount: 0, validationDiscardCount: 7 });
    expect(input.result.fetchEvidence!.fetchLosses).toHaveLength(7);
    const jobs = publication.jobCommands.map(command => command.record);
    if (admission.status !== "ACCEPTED") throw Error("Owned admission required");
    const closed = { ...jobs[0]!, sourceJobId: persistentOfficialJsonJobId("800100.en_GB"), officialTitle: "Closed role",
      officialUrl: "https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.800100.en_GB.html" };
    const next = buildSourceQualityJobCommands({ ...input, admission, baselineCompletedBeforeCrawl: true,
      firstAcceptedCurrentPolicyReceipt: { receipt: admission.receipt, receiptSha256: admission.receiptSha256, expectedBinding: admission.receipt.binding },
      previousJobs: [{ dedupeKey: buildJobDedupeKey(closed), record: closed, lifecycleStatus: "ACTIVE", missingSuccessfulCrawlCount: 0,
        firstSeenAt: NOW.toISOString(), lastSeenAt: NOW.toISOString() }] });
    expect(next.jobCommands).toHaveLength(20);
    expect(next.jobCommands.some(command => command.record.sourceJobId === closed.sourceJobId)).toBe(false);
    expect(jobs.every(job => job.officialPublishedAt === undefined && job.category === "其他")).toBe(true);
    expect(jobs.every(job => job.officialUrl.startsWith("https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/"))).toBe(true);
    expect(jobs.find(job => job.officialUrl.includes("800101"))?.officialTitle).toBe("Synthetic application title overrides both earlier titles");
    const commit = buildAtomicRuntimeCommit({ ...input, batchId: input.binding.batchId, previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: input.archive.artifacts, sourceAdmissionPolicy: "PLAN_BOUND_SOURCE_QUALITY_V1", sourceQualityAdmission: admission, firstAcceptedCurrentPolicyReceipt: null });
    await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
    const snapshot = { lastUpdatedAt: null, coverage: { requiredCompanyCount: 40, excludedCompanyCount: 1 }, companies: [{ id: input.plan.company.id, companyName: input.plan.company.officialChineseName, pinyin: "novo", required: true, publishingSourceIds: [input.plan.source.id], health: "HEALTHY", jobs: jobs.map(job => ({ ...job, id: job.sourceJobId!, city: job.cities[0]!, title: job.officialTitle, isNew: false })) }] } as unknown as PortablePublicSnapshot;
    for (const [city, expected] of [["北京", 15], ["上海", 2], ["广州", 0], ["城市待核", 0]] as const) expect(searchPortableSnapshot({ city }, snapshot).totalJobs).toBe(expected);
    if (process.env.NOVO_SYNTHETIC_EXPORT_PATH) await writeFile(process.env.NOVO_SYNTHETIC_EXPORT_PATH, JSON.stringify({ classification: "SYNTHETIC_SQL_TEST_ONLY", noLiveAcquisition: true, networkAccess: false, databaseWrites: false, liveQualification: false, currentClockAcquisitionIsSynthetic: true, sourceFixtureOrigin: "SYNTHETIC_GENERATED", sourceFixtureClock: capturedAt, sourceFixtureBodySha256: bodySha256, sourceFixtureBytes: NOVO_SYNTHETIC_BODY_BYTES, syntheticClock: NOW.toISOString(), sourceConfigSha256: input.binding.sourceConfigSha256, counts: { raw: 27, output: 20, losses: 7, cityResolved: 20, cityPending: 0 }, archiveVerifiedBeforeExport: true, archiveRemovedAfterExport: true, sources: [{ sourceId: input.plan.source.id, commit }] }, null, 2), { flag: "wx" });
  });
  it.each(["country", "state", "city", "location", "locale", "echo", "total", "duplicate", "shadow"])("rejects owned %s corruption with no publication", async mutation => {
    const input = await capture(body => {
      if (mutation === "country") body.data.jobs[0].jobCountry.value = "United States";
      else if (mutation === "state") body.data.jobs[0].jobState.label = "Shanghai";
      else if (mutation === "city") body.data.jobs[0].jobCity.value = "Shanghai";
      else if (mutation === "location") body.data.jobs[0].jobLocationLabel = "China, Shanghai";
      else if (mutation === "locale") body.data.jobs[0].jobLocale = "zh_CN";
      else if (mutation === "echo") body.data.countriesParam = ["United States"];
      else if (mutation === "total") body.data.totalMatches = 28;
      else if (mutation === "duplicate") body.data.jobs[1].jobId = body.data.jobs[0].jobId;
      else body.data.jobs[0].country = "United States";
    });
    const admission = await issueSourceQualityAdmission(input); expect(admission.status).toBe("REJECTED");
    expect(buildSourceQualityJobCommands({ ...input, admission, previousJobs: [], firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true }).jobCommands).toEqual([]);
  });
  it.each(["title", "location", "city", "url", "date"])("rejects forged output %s", async mutation => {
    const input = await capture(), job = input.result.jobs[0]!;
    if (mutation === "title") job.officialTitle = "Fake title";
    else if (mutation === "location") job.locationRaw = "China, Shanghai";
    else if (mutation === "city") job.cities = ["上海"];
    else if (mutation === "url") job.officialUrl = "https://www.novonordisk.com/careers/find-a-job/job-ad.999999.en_GB.html";
    else job.officialPublishedAt = NOW.toISOString();
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
  it("rejects imported evidence and a dropped row", async () => {
    const input = await capture();
    expect(await issueSourceQualityAdmission({ ...input, result: structuredClone(input.result) })).toMatchObject({ status: "REJECTED", codes: ["OWNED_ACQUISITION_REQUIRED"] });
    input.result.jobs.splice(0, 1); expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });
});
