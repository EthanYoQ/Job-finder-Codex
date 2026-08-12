import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { sanitizeEvidenceHttpUrl } from "../../src/crawler/sourceFetchEvidence";

const capturedAt = "2026-07-11T00:00:00.000Z";
const candidatePlan = buildStagedSourceCrawlPlans(candidateCompanies).find(
  (candidate) => candidate.source.id === "source-sandoz-china-social"
);
if (!candidatePlan || candidatePlan.adapterId !== "official-json" ||
  candidatePlan.officialJsonFetch?.kind !== "sandoz-jsonapi") {
  throw new Error("Missing staged Sandoz truthfulness plan");
}
const plan = candidatePlan;
const sandozConfig = candidatePlan.officialJsonFetch;
const SANDOZ_FIELDS = [
  "title", "field_job_title", "field_job_employment_type", "field_job_type", "field_job_id",
  "field_job_business_unit", "field_job_work_location", "field_job_posted_date", "path",
  "drupal_internal__tid", "field_date", "field_job_country", "field_job_alt_country_1",
  "field_job_alt_country_2", "field_job_alt_country_3"
].join(",");
const evidenceUrl = new URL(sandozConfig.endpointUrl);
evidenceUrl.searchParams.set("fields[node--jobs]", SANDOZ_FIELDS);
evidenceUrl.searchParams.set("page", "0");
evidenceUrl.searchParams.set("views-filter[field_job_functional_area]", "All");
evidenceUrl.searchParams.set("views-filter[field_job_posted_date][min]", "");
evidenceUrl.searchParams.set("views-filter[field_job_posted_date][max]", "");
evidenceUrl.searchParams.set("views-filter[field_job_country]", String(sandozConfig.countryTermTargetId));
evidenceUrl.searchParams.set("views-filter[field_job_alt_country_1]", "");
const EVIDENCE_URL = evidenceUrl.toString();

const payload = { jobs: [{ sourceJobId: "1", title: "Role", officialUrl: "https://www.sandoz.com/jobs/1",
  locationRaw: "上海", cities: ["上海"] }] };

function sandozProbeUrl(probe: "alt1" | "alt2" | "alt3"): string {
  const url = new URL(sandozConfig.endpointUrl);
  url.searchParams.set("fields[node--jobs]", SANDOZ_FIELDS);
  url.searchParams.set("page", "0");
  url.searchParams.set("views-filter[field_job_functional_area]", "All");
  url.searchParams.set("views-filter[field_job_posted_date][min]", "");
  url.searchParams.set("views-filter[field_job_posted_date][max]", "");
  url.searchParams.set("views-filter[field_job_country]", "All");
  if (probe !== "alt1") url.searchParams.set("views-filter[field_job_alt_country_1]", "");
  url.searchParams.set(`views-filter[field_job_alt_country_${probe.at(-1)}]`,
    String(sandozConfig.countryTermTargetId));
  return url.toString();
}

function sandozScopeArtifacts() {
  const taxonomyUrl = new URL(sandozConfig.taxonomyEndpointUrl);
  taxonomyUrl.searchParams.set("filter[drupal_internal__tid]", String(sandozConfig.countryTermTargetId));
  const networkArtifact = (logicalKey: string, url: string, body: string, extractorLocator: string) => ({
    id: logicalKey, logicalKey, kind: "ATS_API_RESPONSE" as const,
    requestedUrl: url, finalUrl: url, httpStatus: 200,
    contentType: "application/vnd.api+json", capturedAt, body,
    bodyRepresentation: "EXACT" as const, extractorLocator
  });
  return [
    networkArtifact("sandoz-taxonomy", taxonomyUrl.toString(), JSON.stringify({ data: [{
      type: "taxonomy_term--job_location",
      id: sandozConfig.countryTermUuid,
      attributes: { drupal_internal__tid: sandozConfig.countryTermTargetId,
        name: sandozConfig.countryTermName }
    }] }), `sandoz-taxonomy-v1|target:${sandozConfig.countryTermTargetId}|json:` +
      "$.data[0].type,$.data[0].id,$.data[0].attributes.drupal_internal__tid,$.data[0].attributes.name"),
    ...(["alt1", "alt2", "alt3"] as const).map((probe) => {
      const url = sandozProbeUrl(probe);
      return networkArtifact(`sandoz-${probe}-zero`, url, JSON.stringify({
        data: [], meta: { count: 0 }, number_of_items_per_page: sandozConfig.pageSize,
        links: { self: { href: url } }
      }), `sandoz-jsonapi-v2|probe:${probe}|page:0|page-size:${sandozConfig.pageSize}` +
        "|fields:node--jobs-v1|json:$.data[*],$.meta.count,$.number_of_items_per_page," +
        "$.links.self.href,$.links.next.href");
    })
  ];
}

function strictEvidence(zero = false) {
  const body = JSON.stringify(zero ? { jobs: [] } : payload);
  const ids = zero ? [] : ["1"];
  return {
    captureTool: { name: "test", version: "1" },
    artifacts: [...sandozScopeArtifacts(), { id: "page-0", logicalKey: "page-0", kind: "PAGINATION_PAGE" as const,
      requestedUrl: EVIDENCE_URL, finalUrl: EVIDENCE_URL, httpStatus: 200,
      contentType: "application/json", capturedAt, body, bodyRepresentation: "EXACT" as const, extractorLocator: "json:total" }],
    pages: [{ sequence: 0, artifactLogicalKey: "page-0", requestedPage: 0, returnedPage: 0,
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
    expect(result.observation.completenessEvidenceUrl).toBe(sanitizeEvidenceHttpUrl(EVIDENCE_URL));
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
