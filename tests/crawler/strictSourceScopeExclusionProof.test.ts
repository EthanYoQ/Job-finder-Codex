import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpRequest,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { validateStrictSourceScopeExclusionProof } from "../../src/crawler/strictSourceScopeExclusionProof";

const NOW = "2026-07-15T00:00:00.000Z";

function stagedPlan(sourceId: string): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find((candidate) => candidate.source.id === sourceId);
  if (!plan || plan.adapterId !== "official-json") throw new Error(`missing staged plan ${sourceId}`);
  return plan;
}

function response(request: OfficialJsonHttpRequest, body: unknown): OfficialJsonHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: request.url,
    contentType: "application/json; charset=utf-8",
    capturedAt: NOW
  };
}

function beisenJob(id: string, location: string): Record<string, unknown> {
  return {
    Id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    JobAdId: id,
    JobAdName: `职位 ${id}`,
    LocNames: [location],
    Category: "社会招聘",
    CategoryId: "1",
    Kind: "全职"
  };
}

async function runBeisen(
  sourceId: "source-dongyangguang-social" | "source-qilu-social" | "source-3sbio-social" | "source-nhu-social",
  jobs: unknown[]
) {
  const plan = stagedPlan(sourceId);
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(NOW),
    http: async (request) => response(request, { Code: 200, Count: jobs.length, PageIndex: 0, Data: jobs })
  });
  const fetchResult = await fetcher(plan);
  return { plan, fetchResult, result: await runSourceCrawl(plan, { fetch: async () => fetchResult }) };
}

async function runXiuzheng(jobs: unknown[]) {
  const plan = stagedPlan("source-xiuzheng-social");
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(NOW),
    http: async (request) => response(request, {
      code: 0,
      data: { current_page: 1, last_page: 1, per_page: 10, total: jobs.length, data: jobs }
    })
  });
  return { plan, result: await runSourceCrawl(plan, { fetch: fetcher }) };
}

describe("source-bound exact scope exclusion proof", () => {
  it("verifies Dongyangguang after independently replaying only explicit foreign exclusions", async () => {
    const { plan, result } = await runBeisen("source-dongyangguang-social", [
      beisenJob("1", "广东省东莞市"),
      beisenJob("2", "美国")
    ]);

    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
    expect(result.observation).toMatchObject({
      completenessStatus: "VERIFIED",
      completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
      structuredJobCount: 1
    });
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(true);
  });

  it("verifies Qilu without hardcoding the raw or accepted job count", async () => {
    const { plan, result } = await runBeisen("source-qilu-social", [
      beisenJob("1", "北京市"),
      beisenJob("2", "上海市"),
      beisenJob("3", "美国纽约"),
      beisenJob("4", "United States / Boston")
    ]);

    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(true);
  });

  it("verifies Xiuzheng only when the exact navigation title is the sole exclusion", async () => {
    const { plan, result } = await runXiuzheng([
      { id: 17, name: "用人理念" },
      { id: 16, name: "福建永春制药有限公司招聘" },
      { id: 5, name: "化药制剂研究员" }
    ]);

    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs.map((job) => job.officialTitle)).toEqual([
      "福建永春制药有限公司招聘",
      "化药制剂研究员"
    ]);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(true);
  });

  it("resolves only the exact 3SBio Xianyang/Hamyang homograph record from its official title", async () => {
    const homograph = {
      ...beisenJob("2", "韩国·庆尚南道·咸阳郡"),
      Id: "3074600c-a1bb-4f66-80e4-93f08a71bf44",
      JobAdName: "(高级)医学信息沟通专员-TBU专岗-(咸阳)(J16744)"
    };
    const { plan, result } = await runBeisen("source-3sbio-social", [
      beisenJob("1", "沈阳市"),
      homograph
    ]);

    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.find((job) => job.officialTitle.includes("J16744"))).toMatchObject({
      locationRaw: "咸阳",
      cities: ["咸阳"]
    });
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(true);

    const tamperedOutput = structuredClone(result.jobs);
    const corrected = tamperedOutput.find((job) => job.officialTitle.includes("J16744"));
    if (!corrected) throw new Error("missing corrected job");
    corrected.locationRaw = "韩国·庆尚南道·咸阳郡";
    corrected.cities = ["咸阳郡"];
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, tamperedOutput)).toBe(false);
  });

  it("does not generalize the 3SBio homograph correction to a changed title or another Korean row", async () => {
    const changedTitle = {
      ...beisenJob("2", "韩国·庆尚南道·咸阳郡"),
      Id: "3074600c-a1bb-4f66-80e4-93f08a71bf44",
      JobAdName: "医学信息沟通专员-(韩国)(J16744)"
    };
    const { plan, result } = await runBeisen("source-3sbio-social", [
      beisenJob("1", "沈阳市"),
      changedTitle,
      beisenJob("3", "韩国·首尔")
    ]);

    expect(result.fetchEvidence?.fetchLosses).toHaveLength(2);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(false);
    expect(result.truth.completenessVerified).toBe(false);
  });

  it("keeps 3SBio verifiable after the corrected vacancy closes", async () => {
    const { plan, result } = await runBeisen("source-3sbio-social", [
      beisenJob("1", "沈阳市"),
      beisenJob("2", "上海市")
    ]);
    expect(result.truth.completenessVerified).toBe(true);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(true);
  });

  it("verifies NHU only after independently replaying the exact Japan-only exclusion", async () => {
    const { plan, result } = await runBeisen("source-nhu-social", [
      beisenJob("1", "浙江省·绍兴市"),
      beisenJob("2", "浙江省、日本"),
      beisenJob("3", "日本·东京")
    ]);
    expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(true);
  });

  it.each([
    ["unknown location", "source-dongyangguang-social", "火星"],
    ["mixed mainland and foreign location", "source-dongyangguang-social", "上海 / 美国"],
    ["non-US foreign location under the Qilu policy", "source-qilu-social", "日本东京"]
  ] as const)("fails closed for %s", async (_label, sourceId, location) => {
    const { plan, result } = await runBeisen(sourceId, [beisenJob("1", "上海市"), beisenJob("2", location)]);
    expect(result.truth.completenessVerified).toBe(false);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!)).toBe(false);
  });

  it("rejects a different validation loss instead of treating every discarded row as safe", async () => {
    const malformed = { ...beisenJob("2", "美国") };
    delete malformed.JobAdName;
    const { plan, result } = await runBeisen("source-dongyangguang-social", [beisenJob("1", "上海市"), malformed]);
    expect(result.fetchEvidence?.fetchLosses).toMatchObject([{ details: { code: "MISSING_REQUIRED_FIELD" } }]);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!)).toBe(false);
    expect(result.truth.completenessVerified).toBe(false);
  });

  it("does not let an unconfigured source reuse traversal evidence that contains a loss", async () => {
    const { plan, fetchResult } = await runBeisen("source-dongyangguang-social", [
      beisenJob("1", "上海市"),
      beisenJob("2", "美国")
    ]);
    const unconfigured = structuredClone(plan);
    if (unconfigured.officialJsonFetch?.kind !== "beisen-zhiye-2022") throw new Error("expected Beisen config");
    delete unconfigured.officialJsonFetch.scopeExclusionProof;

    const replayed = await runSourceCrawl(unconfigured, { fetch: async () => fetchResult });
    expect(replayed.fetchEvidence?.declaredCompleteness?.kind).toBe("COMPLETE_PAGE_TRAVERSAL");
    expect(replayed.fetchEvidence?.fetchLosses).toHaveLength(1);
    expect(replayed.truth.completenessVerified).toBe(false);
  });

  it("rejects a tampered exact body, loss locator, request contract, or transplanted policy", async () => {
    const { plan, result } = await runBeisen("source-dongyangguang-social", [
      beisenJob("1", "上海市"),
      beisenJob("2", "美国")
    ]);
    const evidence = structuredClone(result.fetchEvidence!);

    const bodyTampered = structuredClone(evidence);
    bodyTampered.artifacts[0]!.body = String(bodyTampered.artifacts[0]!.body).replace("美国", "火星");
    expect(validateStrictSourceScopeExclusionProof(plan, bodyTampered)).toBe(false);

    const locatorTampered = structuredClone(evidence);
    locatorTampered.fetchLosses[0]!.rawLocator += "-tampered";
    expect(validateStrictSourceScopeExclusionProof(plan, locatorTampered)).toBe(false);

    const contractTampered = structuredClone(evidence);
    contractTampered.artifacts[0]!.extractorLocator = contractTampered.artifacts[0]!.extractorLocator
      .replace(/sha256:[0-9a-f]{64}$/u, `sha256:${"0".repeat(64)}`);
    contractTampered.declaredCompleteness!.extractorLocator = contractTampered.artifacts[0]!.extractorLocator;
    expect(validateStrictSourceScopeExclusionProof(plan, contractTampered)).toBe(false);

    const qilu = stagedPlan("source-qilu-social");
    expect(validateStrictSourceScopeExclusionProof(qilu, evidence)).toBe(false);
  });

  it("rejects redacted bodies because the exclusions can no longer be independently replayed", async () => {
    const { plan, result } = await runXiuzheng([
      { id: 17, name: "用人理念" },
      { id: 16, name: "研发工程师" }
    ]);
    const evidence = structuredClone(result.fetchEvidence!);
    evidence.artifacts[0]!.bodyRepresentation = "REDACTED";
    evidence.artifacts[0]!.rawBodySha256 = "1".repeat(64);
    evidence.artifacts[0]!.redactionDescriptors = [{ kind: "CREDENTIAL_MATERIAL", count: 1 }];
    expect(validateStrictSourceScopeExclusionProof(plan, evidence)).toBe(false);
  });
});
