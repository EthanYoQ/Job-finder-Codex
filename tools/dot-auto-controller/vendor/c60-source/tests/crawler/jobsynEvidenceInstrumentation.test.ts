import { describe, expect, it } from "vitest";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-07-11T00:00:00.000Z";
const ENDPOINT = "https://prod-search-api.jobsyn.org/api/v1/solr/search";
const ENTRY = "https://grifols.jobs/locations/chn/jobs/";

function plan(overrides: Record<string, unknown> = {}): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "grifols", officialChineseName: "基立福" },
    source: { id: "grifols-official", companyId: "grifols", kind: "SOCIAL", atsKind: "OFFICIAL_JSON", status: "VERIFIED_SCRAPABLE", officialEntryUrl: ENTRY, officialChainEvidenceUrl: ENTRY },
    json: { jobsPath: "jobs", fields: { sourceJobId: "sourceJobId", officialTitle: "title", officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" } },
    officialJsonFetch: { kind: "jobsyn-solr", endpointUrl: ENDPOINT, siteOrigin: "grifols.jobs", location: "chn", pageSize: 2, maxPages: 5, detailBaseUrl: "https://grifols.jobs", ...overrides }
  };
}

function response(body: string, url: string, overrides: Partial<OfficialJsonHttpResponse> = {}): OfficialJsonHttpResponse {
  return { status: 200, body, finalUrl: url, contentType: "application/json; charset=utf-8", capturedAt: NOW, ...overrides };
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return { guid: id, title_exact: `Role ${id}`, title_slug: `role-${id}`, location_exact: "Shanghai, China", city_exact: "Shanghai", country_exact: "China", ...overrides };
}

function body(page: number, jobs: unknown[], total: unknown = 3, totalPages: unknown = 2): string {
  return JSON.stringify({ jobs, pagination: { page, page_size: 2, total, total_pages: totalPages, has_more_pages: page < Number(totalPages) } });
}

describe("Jobsyn Solr evidence instrumentation", () => {
  it("retains exact pages and remains manual even when accepted count equals official total", async () => {
    const exact = [body(1, [row("a"), row("b")]), body(2, [row("c")])];
    let call = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(exact[call++]!, request.url) })(plan());
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 3, pagesVisited: 2 }, fetchEvidence: { fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, parseDiscardCount: 0, validationDiscardCount: 0 }, pages: [{ requestedPage: 1, returnedPage: 1, termination: "CONTINUE" }, { requestedPage: 2, returnedPage: 2, termination: "NEXT_ABSENT" }] }, paginationEvaluation: { verifiedEligible: false } });
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.artifacts.map((a) => [a.logicalKey, a.kind, a.body])).toEqual([
      ["jobsyn-page-0001", "PAGINATION_PAGE", exact[0]], ["jobsyn-page-0002", "PAGINATION_PAGE", exact[1]]
    ]);
  });

  it("accounts for invalid, duplicate, conflicting, and out-of-scope rows", async () => {
    const rows = [row("a"), null, row("a"), row("a", { title_exact: "Conflicting" }), row("x", { country_exact: "United States", location_exact: "Boston, United States" }), row("unsafe/../id")];
    const exact = JSON.stringify({ jobs: rows, pagination: { page: 1, page_size: 6, total: 6, total_pages: 1, has_more_pages: false } });
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(exact, request.url) })(plan({ pageSize: 6 }));
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 6, parsedCount: 5, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 4 } } });
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.fetchLosses.map((x) => x.details.code)).toEqual(["NON_OBJECT_RECORD", "DUPLICATE_OFFICIAL_ID", "CONFLICTING_OFFICIAL_ID", "OUT_OF_SCOPE", "UNSAFE_OFFICIAL_ID"]);
  });

  it.each([
    ["duplicate nested keys", '{"jobs":[{"guid":"a","title_exact":"A","location_exact":"Shanghai, China","meta":{"x":1,"x":2}}],"pagination":{"page":1,"total":1,"total_pages":1}}'],
    ["fractional total", body(1, [row("a")], 1.5, 1)],
    ["declaration drift", null]
  ])("fails closed with retained exact evidence for %s", async (kind, supplied) => {
    const exact = kind === "declaration drift" ? [body(1, [row("a"), row("b")], 3, 2), body(2, [row("c")], 4, 2)] : [supplied as string];
    let call = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(exact[call++]!, request.url) })(plan());
    expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: exact.map((body) => ({ body })) } });
    if (result.ok) throw new Error("expected failure");
    expect(result.failureReason).toMatch(/^Jobsyn Solr /);
  });

  it("retains prior and current artifacts on a later HTTP failure without leaking body", async () => {
    let call = 0;
    const secret = "Bearer example-placeholder";
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => call++ === 0 ? response(body(1, [row("a"), row("b")]), request.url) : response(secret, request.url, { status: 503 }) })(plan());
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Official recruitment endpoint was temporarily unavailable (HTTP 503)",
      transportFailure: { code: "OFFICIAL_HTTP_503", retryable: true },
      fetchEvidence: { artifacts: [{}, { body: secret }], pages: [{ termination: "CONTINUE" }, { termination: "FAILED" }] }
    });
    if (result.ok) throw new Error("expected failure");
    expect(result.failureReason).not.toContain(secret);
  });

  it("preserves exact evidence references through runSourceCrawl", async () => {
    const fetchResult = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(body(1, [row("a")], 1, 1), request.url) })(plan());
    const result = await runSourceCrawl(plan(), { fetch: async () => fetchResult });
    expect(result.fetchEvidence).toBe(fetchResult.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetchResult.paginationEvaluation);
    expect(fetchResult.ok && fetchResult.completeness?.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
  });

  it.each([
    ["pre-existing query", { endpointUrl: `${ENDPOINT}?page=9` }],
    ["credential endpoint", { endpointUrl: "https://user:placeholder@prod-search-api.jobsyn.org/api/v1/solr/search" }],
    ["fragment endpoint", { endpointUrl: `${ENDPOINT}#secret` }],
    ["unsafe detail base", { detailBaseUrl: "https://grifols.jobs/base/" }]
  ])("rejects unsafe configuration before transport: %s", async (_label, overrides) => {
    let calls = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => { calls += 1; throw new Error("must not call"); } })(plan(overrides));
    expect(result).toMatchObject({ ok: false, failureReason: "Jobsyn Solr configuration is invalid" });
    expect(calls).toBe(0);
  });

  it("keeps absent declarations and a full page ABORTED and noncertifying", async () => {
    const exact = JSON.stringify({ jobs: [row("a"), row("b")], pagination: {} });
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(exact, request.url) })(plan());
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }, fetchEvidence: { pages: [{ declaredTotal: null, declaredPages: null, termination: "ABORTED" }] }, paginationEvaluation: { safeCompleteness: false, verifiedEligible: false } });
  });

  it("surfaces returned-page mismatch through shared D1 without promotion", async () => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(body(2, [row("a")], 1, 1), request.url) })(plan());
    expect(result).toMatchObject({ ok: true, fetchEvidence: { pages: [{ anomalyCodes: ["RETURNED_PAGE_MISMATCH"] }] }, paginationEvaluation: { derivedAnomalyCodes: ["RETURNED_PAGE_MISMATCH"], safeCompleteness: false, verifiedEligible: false } });
  });

  it("fails with retained prior evidence when later response metadata is outside the crawl window", async () => {
    let call = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => {
      const page = ++call;
      return response(body(page, page === 1 ? [row("a"), row("b")] : [row("c")]), request.url,
        { capturedAt: page === 1 ? NOW : "2026-07-10T23:59:59.999Z" });
    } })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Jobsyn Solr response metadata is invalid", fetchEvidence: { artifacts: [{}] } });
  });

  it("retains both exact artifacts and fails when valid capture timestamps move backwards", async () => {
    let call = 0;
    let clock = 0;
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(clock++ === 0 ? NOW : "2026-07-11T00:00:00.003Z"),
      http: async (request) => {
        const page = ++call;
        return response(body(page, page === 1 ? [row("a"), row("b")] : [row("c")]), request.url,
          { capturedAt: page === 1 ? "2026-07-11T00:00:00.002Z" : "2026-07-11T00:00:00.001Z" });
      }
    })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Jobsyn Solr response capture time moved backwards", fetchEvidence: { artifacts: [{}, {}], pages: [{ termination: "CONTINUE" }, { termination: "FAILED" }] } });
  });

  it("records unsafe official title slugs as URL losses", async () => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(body(1, [row("a", { title_slug: "../../secret" })], 1, 1), request.url) })(plan());
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 }, fetchLosses: [{ details: { code: "UNSAFE_OFFICIAL_URL" } }] } });
  });

  it("preserves an official Unicode title slug as one encoded path segment", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => response(body(1, [row("unicode", {
        title_exact: "產品專員",
        title_slug: "產品專員"
      })], 1, 1), request.url)
    })(plan());

    expect(result).toMatchObject({
      ok: true,
      payload: {
        jobs: [{
          title: "產品專員",
          officialUrl: "https://grifols.jobs/shanghai-china/%E7%94%A2%E5%93%81%E5%B0%88%E5%93%A1/unicode/job/"
        }]
      },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, validationDiscardCount: 0 }
      }
    });
  });

  it.each([
    ["total below raw and valid", body(1, [row("a"), row("b")], 1, 1)],
    ["zero total with a nonempty page", body(1, [row("a")], 0, 1)],
    ["zero total pages with a nonempty page", body(1, [row("a")], 1, 0)],
    ["declared page size differs from request", JSON.stringify({ jobs: [row("a")], pagination: { page: 1, page_size: 99, total: 1, total_pages: 1, has_more_pages: false } })],
    ["total cannot fit declared pages", body(1, [row("a"), row("b")], 5, 2)]
  ])("fails closed with exact evidence for impossible declaration: %s", async (_label, exact) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(exact, request.url) })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Jobsyn Solr pagination declaration contradicts observed rows", fetchEvidence: { artifacts: [{ body: exact }], pages: [{ termination: "FAILED" }] } });
  });

  it.each([
    ["fractional pageSize", { pageSize: 1.5 }],
    ["NaN pageSize", { pageSize: Number.NaN }],
    ["infinite pageSize", { pageSize: Number.POSITIVE_INFINITY }],
    ["zero maxPages", { maxPages: 0 }],
    ["fractional maxPages", { maxPages: 2.5 }],
    ["evil site origin", { siteOrigin: "evil.example" }],
    ["wrong Jobsyn API host", { endpointUrl: "https://evil.example/api/v1/solr/search" }]
  ])("rejects invalid numeric/origin config before transport: %s", async (_label, overrides) => {
    let calls = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => { calls += 1; throw new Error("must not call"); } })(plan(overrides));
    expect(result).toMatchObject({ ok: false, failureReason: "Jobsyn Solr configuration is invalid" });
    expect(calls).toBe(0);
  });

  it.each([
    ["total below raw", body(1, [row("a"), row("b")], 1, 1), { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 }],
    ["page_size mismatch", JSON.stringify({ jobs: [row("a"), null], pagination: { page: 1, page_size: 99, total: 2, total_pages: 1, has_more_pages: false } }), { rawCount: 2, parsedCount: 1, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 0 }],
    ["zero pages nonempty", body(1, [row("a")], 1, 0), { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 }]
  ])("accounts the exact current page before declaration failure: %s", async (_label, exact, expectedCounts) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(exact, request.url) })(plan());
    expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ body: exact }], fetchCounts: expectedCounts, pages: [{ rawJobIds: expect.any(Array), validJobIds: expect.any(Array), termination: "FAILED" }] } });
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.pages[0]!.rawJobIds).toHaveLength(expectedCounts.rawCount);
    expect(result.fetchEvidence.pages[0]!.validJobIds).toHaveLength(expectedCounts.validCount);
    expect(result.fetchEvidence.fetchLosses).toHaveLength(expectedCounts.parseDiscardCount + expectedCounts.validationDiscardCount);
  });

  it("accounts and retains the current page when a later declaration contradicts the first page", async () => {
    const exact = [body(1, [row("a"), row("b")], 3, 2), body(2, [row("c")], 4, 2)];
    let call = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => response(exact[call++]!, request.url) })(plan());
    expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ body: exact[0] }, { body: exact[1] }], fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, parseDiscardCount: 0, validationDiscardCount: 0 }, pages: [{ rawJobIds: expect.any(Array), validJobIds: expect.any(Array), termination: "CONTINUE" }, { rawJobIds: expect.any(Array), validJobIds: expect.any(Array), termination: "FAILED" }] } });
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.pages.map((page) => [page.rawJobIds.length, page.validJobIds.length])).toEqual([[2, 2], [1, 1]]);
  });
});
