import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";

const capturedAt = "2026-07-11T00:00:00.000Z";
const plan = {
  adapterId: "official-json",
  company: { id: "company-truth", officialChineseName: "测试制药" },
  source: { id: "source-truth-social", companyId: "company-truth", kind: "SOCIAL", atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE", officialEntryUrl: "https://jobs.example.cn/careers", officialChainEvidenceUrl: "https://example.cn/careers" },
  json: { jobsPath: "jobs", fields: { sourceJobId: "id", officialTitle: "title", officialUrl: "url", locationRaw: "location" } }
} satisfies SourceCrawlPlan;

const payload = { jobs: [{ id: "1", title: "Role", url: "https://jobs.example.cn/jobs/1", location: "上海" }] };

function strictEvidence(zero = false) {
  const body = JSON.stringify(zero ? { jobs: [] } : payload);
  const ids = zero ? [] : ["1"];
  return {
    captureTool: { name: "test", version: "1" },
    artifacts: [{ id: "page-0", logicalKey: "page-0", kind: "PAGINATION_PAGE" as const,
      requestedUrl: "https://jobs.example.cn/api/jobs", finalUrl: "https://jobs.example.cn/api/jobs", httpStatus: 200,
      contentType: "application/json", capturedAt, body, bodyRepresentation: "EXACT" as const, extractorLocator: "json:total" }],
    pages: [{ sequence: 0, artifactLogicalKey: "page-0", requestedPage: 1, returnedPage: 1,
      requestedPageSize: 1, returnedPageSize: 1, rawJobIds: ids, validJobIds: ids, declaredTotal: zero ? 0 : 1,
      declaredCount: zero ? 0 : 1, declaredPages: 1, responseFingerprintSha256: createHash("sha256").update(body).digest("hex"), termination: zero ? "EMPTY_PAGE" as const : "DECLARED_TOTAL_REACHED" as const,
      anomalyCodes: [], capturedAt }],
    declaredCompleteness: { kind: zero ? "OFFICIAL_TOTAL_COUNT" as const : "OFFICIAL_TOTAL_PAGES" as const, value: zero ? 0 : 1, artifactLogicalKey: "page-0",
      extractorLocator: "json:total", scope: "SOURCE" as const },
    fetchCounts: { rawCount: zero ? 0 : 1, parsedCount: zero ? 0 : 1, validCount: zero ? 0 : 1, parseDiscardCount: 0, validationDiscardCount: 0 }, fetchLosses: []
  };
}

describe("end-to-end crawl truthfulness", () => {
  it("strips caller FETCH_FAILURE provenance from an actually successful transport", async () => {
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: true, capturedAt, payload,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "FETCH_FAILURE", completenessEvidenceUrl: "https://caller.invalid/fake" } }) });
    expect(result.truth.transportSuccess).toBe(true);
    expect(result.observation.completenessEvidenceKind).toBeUndefined();
    expect(result.observation.completenessEvidenceUrl).toBeUndefined();
  });

  it("retains canonical internal FETCH_FAILURE provenance for an actually failed transport", async () => {
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: false, capturedAt, failureReason: "upstream failed" }) });
    expect(result.truth.transportSuccess).toBe(false);
    expect(result.observation.completenessEvidenceKind).toBe("FETCH_FAILURE");
    expect(result.observation.completenessEvidenceUrl).toBe(plan.source.officialEntryUrl);
  });

  it("does not let caller VERIFIED promote transport plus adapter success without strict evidence", async () => {
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: true, capturedAt, payload,
      completeness: { completenessStatus: "VERIFIED", expectedJobCount: 1, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: plan.source.officialEntryUrl, totalPages: 9, pageSize: 9, pagesVisited: 9 } }) });
    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: false });
    expect(result.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(result.observation.totalPages).toBeUndefined();
    expect(result.observation.pageSize).toBeUndefined();
    expect(result.observation.pagesVisited).toBeUndefined();
  });

  it("promotes only independently reconciled official evidence with safe eligible D1", async () => {
    const fetchEvidence = strictEvidence();
    const paginationEvaluation = evaluatePaginationEvidence({ evidence: fetchEvidence, expectedChannelIds: [], filteredOutput: true });
    expect(paginationEvaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: true });
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: true, capturedAt, payload, fetchEvidence,
      paginationEvaluation, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 999,
        totalPages: 999, pageSize: 999, pagesVisited: 999,
        completenessEvidenceKind: "OFFICIAL_TOTAL_PAGES", completenessEvidenceUrl: "https://caller.invalid/fake" } }) });
    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
    expect(result.observation.completenessStatus).toBe("VERIFIED");
    expect(result.fetchEvidence).toBe(fetchEvidence);
    expect(result.paginationEvaluation).toBe(paginationEvaluation);
    expect(result.observation).toMatchObject({ totalPages: 1, pageSize: 1, pagesVisited: 1 });
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(result.observation.completenessEvidenceUrl).toBe("https://jobs.example.cn/api/jobs");
  });

  it("fails completeness closed for unsafe or ineligible D1 while retaining evidence references", async () => {
    const fetchEvidence = strictEvidence();
    const paginationEvaluation = { pages: [], paginationTraceSha256: "b".repeat(64), derivedAnomalyCodes: [], visitedChannelIds: [],
      safeCompleteness: false, verifiedEligible: true };
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: true, capturedAt, payload, fetchEvidence,
      paginationEvaluation, completeness: { completenessStatus: "VERIFIED" } }) });
    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: false });
    expect(result.fetchEvidence).toBe(fetchEvidence);
    expect(result.paginationEvaluation).toBe(paginationEvaluation);
    expect(result.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it("applies the same strict independent gate to verified zero", async () => {
    const fetchEvidence = strictEvidence(true);
    const paginationEvaluation = evaluatePaginationEvidence({ evidence: fetchEvidence, expectedChannelIds: [], filteredOutput: true });
    expect(paginationEvaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: true });
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: true, capturedAt, payload: { jobs: [] },
      fetchEvidence, paginationEvaluation, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 999, totalPages: 999, pageSize: 999, pagesVisited: 999,
        completenessEvidenceKind: "OFFICIAL_TOTAL_PAGES", completenessEvidenceUrl: plan.source.officialEntryUrl } }) });
    expect(result.status, result.status === "FAILED" ? result.failureReason : undefined).toBe("SUCCESS");
    expect(result.jobs).toEqual([]);
    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
    expect(result.observation).toMatchObject({ expectedJobCount: 0, pageSize: 1, pagesVisited: 1 });
    expect(result.observation.totalPages).toBeUndefined();
  });
});
