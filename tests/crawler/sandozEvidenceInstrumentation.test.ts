import { describe, expect, it } from "vitest";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { parseArtifactArchiveDrafts } from "../../src/crawler/sourceFetchEvidence";

const NOW = "2026-07-11T00:00:00.000Z";
const ENTRY = "https://www.sandoz.com/careers/job-search/";
const ENDPOINT = "https://sandoz-com.cms.sandoz.com/jsonapi/views/job_search/job_search";

function plan(overrides: Record<string, unknown> = {}): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "sandoz", officialChineseName: "山德士" },
    source: { id: "sandoz-official", companyId: "sandoz", kind: "SOCIAL", atsKind: "OFFICIAL_JSON", status: "VERIFIED_SCRAPABLE", officialEntryUrl: ENTRY, officialChainEvidenceUrl: ENTRY },
    json: { jobsPath: "jobs", fields: { sourceJobId: "sourceJobId", officialTitle: "title", officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" } },
    officialJsonFetch: { kind: "sandoz-jsonapi", endpointUrl: ENDPOINT, countryTermName: "LOC_CN", pageSize: 2, maxPages: 5, detailBaseUrl: "https://www.sandoz.com", ...overrides }
  };
}

function response(body: string, url: string, contentType = "application/vnd.api+json"): OfficialJsonHttpResponse {
  return { status: 200, body, finalUrl: url, contentType, capturedAt: NOW };
}

function relation(...terms: string[]) {
  return { data: terms.map((term_name, index) => ({ type: "taxonomy_term--job_location", id: `loc-${index}`, meta: { term_name } })) };
}

function row(id: string, terms = ["LOC_CN"], overrides: Record<string, unknown> = {}) {
  return { type: "node--job", id, attributes: { field_job_id: id, field_job_title: `Role ${id}`, field_job_work_location: "Shanghai, China", path: { alias: `/jobs/${id}` } }, relationships: { field_job_country: relation(...terms), field_job_alt_country_1: { data: [] }, field_job_alt_country_2: { data: [] }, field_job_alt_country_3: { data: [] } }, ...overrides };
}

function api(data: unknown[], count: unknown = data.length, next: unknown = null): string {
  return JSON.stringify({ data, meta: { count }, links: { next } });
}

function client(apiBodies: string[]) {
  let page = 0;
  return async (request: { url: string }): Promise<OfficialJsonHttpResponse> => {
    if (request.url === ENTRY) return response('<script id="__NEXT_DATA__" type="application/json">{"props":{"token":"top-secret-token"}}</script>', ENTRY, "text/html");
    return response(apiBodies[page++]!, request.url);
  };
}

describe("Sandoz JSON:API evidence instrumentation", () => {
  it("retains safe entry provenance plus exact pages and remains manual through shared D1", async () => {
    const secondUrl = `${ENDPOINT}?page=1&views-filter%5Bfield_job_functional_area%5D=All&views-filter%5Bfield_job_country%5D=All&views-filter%5Bfield_job_alt_country_1%5D=&views-filter%5Bfield_job_posted_date%5D%5Bmin%5D=&views-filter%5Bfield_job_posted_date%5D%5Bmax%5D=`;
    const bodies = [api([row("a"), row("b")], 3, secondUrl), api([row("c")], 3, null)];
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client(bodies) })(plan());
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 3, pagesVisited: 2 }, fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE", body: bodies[0] }, { kind: "PAGINATION_PAGE", body: bodies[1] }], fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, parseDiscardCount: 0, validationDiscardCount: 0 }, pages: [{ requestedPage: 0, returnedPage: 0, termination: "CONTINUE" }, { requestedPage: 1, returnedPage: 1, termination: "NEXT_ABSENT" }] }, paginationEvaluation: { verifiedEligible: false } });
    expect(JSON.stringify(result)).not.toContain("top-secret-token");
  });

  it("accounts malformed, mixed-scope, duplicate and conflicting resources", async () => {
    const rows = [row("a"), null, row("mixed", ["LOC_CN", "LOC_AT"]), row("a"), row("a", ["LOC_CN"], { attributes: { field_job_id: "a", field_job_title: "Changed", field_job_work_location: "Shanghai", path: { alias: "/jobs/a" } } })];
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client([api(rows, 5)]) })(plan({ pageSize: 5 }));
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 5, parsedCount: 4, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 3 } } });
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.fetchLosses.map((loss) => loss.details.code)).toEqual(["NON_OBJECT_RECORD", "AMBIGUOUS_SCOPE", "DUPLICATE_OFFICIAL_ID", "CONFLICTING_OFFICIAL_ID"]);
  });

  it.each([
    ["duplicate JSON keys", '{"data":[],"meta":{"count":0,"count":1},"links":{"next":null}}'],
    ["invalid count", api([], 1.5, null)],
    ["truthy object next", api([], 0, { href: "next" })],
    ["skip next", api([row("a"), row("b")], 4, `${ENDPOINT}?page=2`)]
  ])("fails closed with retained entry and current page for %s", async (_label, body) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client([body]) })(plan());
    expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE", body }] } });
  });

  it("retains prior and current exact evidence on a later HTTP failure", async () => {
    let page = 0;
    const first = api([row("a"), row("b")], 3, null);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => {
      if (request.url === ENTRY) return response('{"token":"long-safe-value"}', ENTRY, "text/html");
      page += 1;
      return page === 1 ? response(first.replace('"next":null', `"next":${JSON.stringify(request.url.replace("page=0", "page=1"))}`), request.url) : { ...response("private-response", request.url), status: 503 };
    } })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI returned HTTP 503", fetchEvidence: { artifacts: [{}, { body: expect.any(String) }, { body: "private-response" }], pages: [{ termination: "CONTINUE" }, { termination: "FAILED" }] } });
  });

  it.each([
    ["duplicate", '{"token":"first-safe-token","token":"second-safe-token"}'],
    ["encoded", '{"token":"unsafe%2Ftoken"}'],
    ["whitespace", '{"token":"unsafe token"}']
  ])("fails token discovery safely without persisting the credential: %s", async (_label, entryBody) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) =>
      request.url === ENTRY ? response(entryBody, ENTRY, "text/html") : response(api([], 0), request.url)
    })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz entry/token evidence is invalid", fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }], pages: [] } });
    expect(JSON.stringify(result)).not.toContain(entryBody.includes("first") ? "first-safe-token" : entryBody.includes("%") ? "unsafe%2Ftoken" : "unsafe token");
  });

  it("permits a demonstrably anonymous API while retaining token-absent provenance", async () => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) =>
      request.url === ENTRY ? response("<html>no credential</html>", ENTRY, "text/html") : response(api([], 0), request.url)
    })(plan());
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }, fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE" }] } });
  });

  it.each([
    ["backward", 1, sandozPageUrl(0)],
    ["skip", 0, sandozPageUrl(2)],
    ["cross origin", 0, "https://evil.example/jsonapi/views/job_search/job_search?page=1"],
    ["filter drift", 0, sandozPageUrl(1).replace("=All", "=Medical")]
  ])("rejects noncanonical next coordinate: %s", async (_label, page, next) => {
    let calls = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => {
      if (request.url === ENTRY) return response('{"token":"long-safe-value"}', ENTRY, "text/html");
      calls += 1;
      return response(api([row(`id-${calls}`)], 2, next), request.url);
    } })(plan({ pageSize: 1 }));
    void page;
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI next-page declaration is invalid", fetchEvidence: { pages: [{ termination: "FAILED" }] } });
  });

  it.each([
    ["foreign", ["LOC_AT"], "OUT_OF_SCOPE"],
    ["HMT", ["LOC_HK"], "OUT_OF_SCOPE"],
    ["mixed", ["LOC_CN", "LOC_HK"], "AMBIGUOUS_SCOPE"],
    ["encoded", ["LOC%5FCN"], "OUT_OF_SCOPE"]
  ])("accounts bounded country relationship scope: %s", async (_label, terms, code) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client([api([row("scope", terms)], 1)]) })(plan());
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 }, fetchLosses: [{ details: { code } }] } });
  });

  it.each([
    ["fractional page size", { pageSize: 1.5 }], ["zero max pages", { maxPages: 0 }],
    ["endpoint query", { endpointUrl: `${ENDPOINT}?page=0` }], ["wrong API origin", { endpointUrl: "https://evil.example/jsonapi/views/job_search/job_search" }],
    ["wrong detail origin", { detailBaseUrl: "https://evil.example" }]
  ])("rejects unsafe config before transport: %s", async (_label, overrides) => {
    let calls = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => { calls += 1; throw new Error("must not call"); } })(plan(overrides));
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI configuration is invalid" });
    expect(calls).toBe(0);
  });

  it.each([
    ["non-China configured term", { countryTermName: "LOC_AT" }, undefined],
    ["non-careers entry", {}, "https://www.sandoz.com/about/"],
    ["entry query", {}, `${ENTRY}?from=other`],
    ["missing canonical slash", {}, "https://www.sandoz.com/careers/job-search"]
  ])("pins the official mainland term and exact careers entry before transport: %s", async (_label, overrides, officialEntryUrl) => {
    let calls = 0;
    const current = plan(overrides);
    if (officialEntryUrl) current.source.officialEntryUrl = officialEntryUrl;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => { calls += 1; throw new Error("must not call"); } })(current);
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI configuration is invalid" });
    expect(calls).toBe(0);
  });

  it.each([
    ["authorization", '{"authorization":"opaque-value"}'],
    ["cookie", '<meta name="cookie" content="opaque-value">'],
    ["header", '{"header":"opaque-value"}'],
    ["bearer", '<script>Bearer example-placeholder</script>'],
    ["JWT-shaped", '<script>eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGFxdWUtdmFsdWUifQ.signature</script>'],
    ["multilayer", '<script>%2562%2565%2561%2572%2565%2572%253Dopaque-value</script>']
  ])("redacts all bounded entry credential material with structured provenance: %s", async (_label, entryBody) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) =>
      request.url === ENTRY ? response(entryBody, ENTRY, "text/html") : response(api([], 0), request.url)
    })(plan());
    expect(JSON.stringify(result)).not.toContain("opaque-value");
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.artifacts[0]).toMatchObject({ bodyRepresentation: "REDACTED", rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/), redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL", count: expect.any(Number) }] });
  });

  it("treats Set-Cookie response metadata as credential material", async () => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) =>
      request.url === ENTRY
        ? { ...response("<html>safe</html>", ENTRY, "text/html"), setCookie: ["session=opaque-value; Secure"] }
        : response(api([], 0), request.url)
    })(plan());
    expect(JSON.stringify(result)).not.toContain("opaque-value");
    expect(result.fetchEvidence?.artifacts[0]).toMatchObject({ bodyRepresentation: "REDACTED", redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" }] });
  });

  it.each([
    "Basic Scientist", "Session Manager", "Secret Shopper", "Password Researcher", "Token Economy Lead", "Header Operations"
  ])("does not classify an ordinary job title as credential material: %s", async (title) => {
    const exact = api([row("benign", ["LOC_CN"], {
      attributes: { field_job_id: "benign", field_job_title: title, field_job_work_location: "Shanghai, China", path: { alias: "/jobs/benign" } }
    })], 1);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) =>
      request.url === ENTRY ? response(`<html><p>${title}</p></html>`, ENTRY, "text/html") : response(exact, request.url)
    })(plan());
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }, payload: { jobs: [{ title }] }, fetchEvidence: { artifacts: [{ bodyRepresentation: "EXACT" }, { bodyRepresentation: "EXACT", body: exact }] } });
  });

  it.each([
    ["JSON Bearer alpha", '{"debug":"Bearer example-placeholder"}'],
    ["JSON Basic alpha", '{"debug":"Basic abcdefgh"}'],
    ["JSON credential key", '{"basic":"opaque-value"}'],
    ["HTML reversed attributes", '<meta content="opaque-value" name="token">']
  ])("detects structured credential bypass and never persists it: %s", async (_label, entryBody) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) =>
      request.url === ENTRY ? response(entryBody, ENTRY, "text/html") : response(api([], 0), request.url)
    })(plan());
    expect(JSON.stringify(result)).not.toContain("opaque-value");
    expect(JSON.stringify(result)).not.toContain("abcdefgh");
    expect(result.fetchEvidence?.artifacts[0]).toMatchObject({ bodyRepresentation: "REDACTED" });
  });

  it("fails a sensitive API page closed without persisting the exact sensitive body", async () => {
    const sensitive = '{"data":[],"meta":{"count":0},"links":{"next":null},"debug":"Bearer example-placeholder"}';
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client([sensitive]) })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI response contains sensitive material", fetchEvidence: { artifacts: [{ bodyRepresentation: "REDACTED" }, { kind: "PAGINATION_PAGE", bodyRepresentation: "REDACTED", rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/) }] } });
    expect(JSON.stringify(result)).not.toContain("opaque-value");
  });

  it("enforces structured exact/redacted artifact provenance consistency", () => {
    const base = { id: "a", logicalKey: "a", kind: "OFFICIAL_COMPANY_PAGE", requestedUrl: ENTRY, finalUrl: ENTRY,
      httpStatus: 200, contentType: "text/html", capturedAt: NOW, body: "safe", extractorLocator: "x" };
    expect(() => parseArtifactArchiveDrafts({ captureTool: { name: "test", version: "1" }, artifacts: [{ ...base, bodyRepresentation: "REDACTED" }] })).toThrow();
    expect(() => parseArtifactArchiveDrafts({ captureTool: { name: "test", version: "1" }, artifacts: [{ ...base, bodyRepresentation: "EXACT", rawBodySha256: "0".repeat(64), redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL", count: 1 }] }] })).toThrow();
    expect(parseArtifactArchiveDrafts({ captureTool: { name: "test", version: "1" }, artifacts: [{ ...base, bodyRepresentation: "REDACTED", rawBodySha256: "0".repeat(64), redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL", count: 1 }] }] }).artifacts[0]).toMatchObject({ bodyRepresentation: "REDACTED" });
  });

  it("preserves exact evidence references through runSourceCrawl", async () => {
    const fetched = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client([api([row("a")], 1)]) })(plan());
    const result = await runSourceCrawl(plan(), { fetch: async () => fetched });
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetched.paginationEvaluation);
  });
});

function sandozPageUrl(page: number): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("page", String(page));
  url.searchParams.set("views-filter[field_job_functional_area]", "All");
  url.searchParams.set("views-filter[field_job_country]", "All");
  url.searchParams.set("views-filter[field_job_alt_country_1]", "");
  url.searchParams.set("views-filter[field_job_posted_date][min]", "");
  url.searchParams.set("views-filter[field_job_posted_date][max]", "");
  return url.toString();
}
