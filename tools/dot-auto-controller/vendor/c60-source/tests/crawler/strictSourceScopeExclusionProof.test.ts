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
  const plan = buildStagedSourceCrawlPlans(candidateCompanies)
    .find((candidate) => candidate.source.id === sourceId);
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

async function runDongyangguang(jobs: unknown[]) {
  const plan = stagedPlan("source-dongyangguang-social");
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(NOW),
    http: async (request) => response(request, {
      Code: 200,
      Count: jobs.length,
      PageIndex: 0,
      Data: jobs
    })
  });
  const fetchResult = await fetcher(plan);
  return {
    plan,
    fetchResult,
    result: await runSourceCrawl(plan, { fetch: async () => fetchResult })
  };
}

describe("source-bound exact scope exclusion proof", () => {
  it("verifies an explicitly configured foreign exclusion without hardcoding accepted counts", async () => {
    const { plan, result } = await runDongyangguang([
      beisenJob("1", "广东省东莞市"),
      beisenJob("2", "美国")
    ]);

    expect(result.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: true,
      completenessVerified: true
    });
    expect(result.observation).toMatchObject({
      completenessStatus: "VERIFIED",
      completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
      structuredJobCount: 1
    });
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!, result.jobs)).toBe(true);
  });

  it.each([
    ["unknown location", "火星"],
    ["mixed mainland and foreign location", "上海 / 美国"]
  ] as const)("fails closed for %s", async (_label, location) => {
    const { plan, result } = await runDongyangguang([
      beisenJob("1", "上海市"),
      beisenJob("2", location)
    ]);
    expect(result.truth.completenessVerified).toBe(false);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!)).toBe(false);
  });

  it("rejects a validation loss that is not the configured foreign exclusion", async () => {
    const malformed = { ...beisenJob("2", "美国") };
    delete malformed.JobAdName;
    const { plan, result } = await runDongyangguang([beisenJob("1", "上海市"), malformed]);

    expect(result.fetchEvidence?.fetchLosses).toMatchObject([
      { details: { code: "MISSING_REQUIRED_FIELD" } }
    ]);
    expect(validateStrictSourceScopeExclusionProof(plan, result.fetchEvidence!)).toBe(false);
    expect(result.truth.completenessVerified).toBe(false);
  });

  it("does not let an unconfigured source reuse traversal evidence that contains a loss", async () => {
    const { plan, fetchResult } = await runDongyangguang([
      beisenJob("1", "上海市"),
      beisenJob("2", "美国")
    ]);
    const unconfigured = structuredClone(plan);
    if (unconfigured.officialJsonFetch?.kind !== "beisen-zhiye-2022") {
      throw new Error("expected Beisen config");
    }
    delete unconfigured.officialJsonFetch.scopeExclusionProof;

    const replayed = await runSourceCrawl(unconfigured, { fetch: async () => fetchResult });
    expect(replayed.fetchEvidence?.declaredCompleteness?.kind).toBe("COMPLETE_PAGE_TRAVERSAL");
    expect(replayed.fetchEvidence?.fetchLosses).toHaveLength(1);
    expect(replayed.truth.completenessVerified).toBe(false);
  });

  it("rejects body, locator, and request-contract tampering", async () => {
    const { plan, result } = await runDongyangguang([
      beisenJob("1", "上海市"),
      beisenJob("2", "美国")
    ]);
    const evidence = structuredClone(result.fetchEvidence!);

    const bodyTampered = structuredClone(evidence);
    bodyTampered.artifacts[0]!.body = String(bodyTampered.artifacts[0]!.body)
      .replace("美国", "火星");
    expect(validateStrictSourceScopeExclusionProof(plan, bodyTampered)).toBe(false);

    const locatorTampered = structuredClone(evidence);
    locatorTampered.fetchLosses[0]!.rawLocator += "-tampered";
    expect(validateStrictSourceScopeExclusionProof(plan, locatorTampered)).toBe(false);

    const contractTampered = structuredClone(evidence);
    contractTampered.artifacts[0]!.extractorLocator = contractTampered.artifacts[0]!.extractorLocator
      .replace(/sha256:[0-9a-f]{64}$/u, `sha256:${"0".repeat(64)}`);
    contractTampered.declaredCompleteness!.extractorLocator =
      contractTampered.artifacts[0]!.extractorLocator;
    expect(validateStrictSourceScopeExclusionProof(plan, contractTampered)).toBe(false);
  });
});
