import { describe, expect, it } from "vitest";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-07-11T00:00:00.000Z";
const candidatePlan = buildStagedSourceCrawlPlans(candidateCompanies).find(
  (candidate) => candidate.source.id === "source-novo-nordisk-china-social"
);
if (!candidatePlan || candidatePlan.adapterId !== "official-json" ||
  candidatePlan.officialJsonFetch?.kind !== "novo-nordisk") {
  throw new Error("Missing staged Novo Nordisk truthfulness plan");
}
const plan = candidatePlan;
const novoFetchConfig = candidatePlan.officialJsonFetch;
const payload = {
  jobs: [{
    sourceJobId: "1",
    title: "Medical role",
    officialUrl: "https://www.novonordisk.com.cn/careers/medical-role",
    locationRaw: "China Mainland, Beijing",
    cities: ["北京"]
  }]
};

async function strictFetch(zero = false) {
  const endpoint = novoFetchConfig.endpointUrl;
  const fetch = createOfficialJsonSourceFetch({
    now: () => new Date(capturedAt),
    http: async () => ({
      status: 200,
      body: JSON.stringify({
        data: {
          totalMatches: zero ? 0 : 1,
          jobs: zero ? [] : [{
            jobId: "1",
            jobTitle: "Medical role",
            jobLocationLabel: "China Mainland, Beijing",
            jobCity: { label: "Beijing" }
          }]
        }
      }),
      finalUrl: endpoint,
      contentType: "application/json; charset=utf-8",
      capturedAt
    })
  });
  const result = await fetch(plan);
  if (!result.ok || !("payload" in result) || !result.fetchEvidence || !result.paginationEvaluation) {
    throw new Error(result.ok ? "Missing strict Novo evidence" : result.failureReason);
  }
  return result;
}

describe("end-to-end crawl truthfulness", () => {
  it("strips caller FETCH_FAILURE provenance from an actually successful transport", async () => {
    const result = await runSourceCrawl(plan, { fetch: async () => ({
      ok: true,
      capturedAt,
      payload,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "FETCH_FAILURE",
        completenessEvidenceUrl: "https://caller.invalid/fake"
      }
    }) });
    expect(result.truth.transportSuccess).toBe(true);
    expect(result.observation.completenessEvidenceKind).toBeUndefined();
    expect(result.observation.completenessEvidenceUrl).toBeUndefined();
  });

  it("retains canonical internal FETCH_FAILURE provenance for an actually failed transport", async () => {
    const result = await runSourceCrawl(plan, { fetch: async () => ({
      ok: false,
      capturedAt,
      failureReason: "upstream failed"
    }) });
    expect(result.truth.transportSuccess).toBe(false);
    expect(result.observation.completenessEvidenceKind).toBe("FETCH_FAILURE");
    expect(result.observation.completenessEvidenceUrl).toBe(
      "https://www.novonordisk.com.cn/careers/find-a-job/career-search-results.html"
    );
  });

  it("does not let caller VERIFIED promote transport plus adapter success without strict evidence", async () => {
    const result = await runSourceCrawl(plan, { fetch: async () => ({
      ok: true,
      capturedAt,
      payload,
      completeness: {
        completenessStatus: "VERIFIED",
        expectedJobCount: 1,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: plan.source.officialEntryUrl,
        totalPages: 9,
        pageSize: 9,
        pagesVisited: 9
      }
    }) });
    expect(result.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: true,
      completenessVerified: false
    });
    expect(result.observation).toMatchObject({
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW"
    });
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(result.observation.totalPages).toBeUndefined();
    expect(result.observation.pageSize).toBeUndefined();
    expect(result.observation.pagesVisited).toBeUndefined();
  });

  it("promotes only independently reconciled official evidence", async () => {
    const fetched = await strictFetch();
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });

    expect(result.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: true,
      completenessVerified: true
    });
    expect(result.observation).toMatchObject({
      completenessStatus: "VERIFIED",
      expectedJobCount: 1,
      pagesVisited: 1
    });
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetched.paginationEvaluation);
  });

  it("fails completeness closed for unsafe evidence while retaining evidence references", async () => {
    const fetched = await strictFetch();
    const unsafe = {
      ...fetched,
      paginationEvaluation: {
        pages: [],
        paginationTraceSha256: "b".repeat(64),
        derivedAnomalyCodes: [],
        visitedChannelIds: [],
        safeCompleteness: false,
        verifiedEligible: true
      }
    };
    const result = await runSourceCrawl(plan, { fetch: async () => unsafe });

    expect(result.truth.completenessVerified).toBe(false);
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(unsafe.paginationEvaluation);
    expect(result.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it("applies the same strict independent gate to verified zero", async () => {
    const fetched = await strictFetch(true);
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });

    expect(result.status, result.status === "FAILED" ? result.failureReason : undefined).toBe("SUCCESS");
    expect(result.jobs).toEqual([]);
    expect(result.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: true,
      completenessVerified: true
    });
    expect(result.observation).toMatchObject({ expectedJobCount: 0, pagesVisited: 1 });
  });
});
