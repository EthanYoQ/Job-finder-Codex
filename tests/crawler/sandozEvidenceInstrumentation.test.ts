import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpRequest,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  expectedChannelSetHash,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const NOW = "2026-07-13T18:11:17.000Z";
const ENTRY = "https://www.sandoz.com/careers/job-search/";
const ENDPOINT = "https://sandoz-com.cms.sandoz.com/jsonapi/views/job_search/job_search";
const TAXONOMY_ENDPOINT = "https://sandoz-com.cms.sandoz.com/jsonapi/taxonomy_term/job_location";
const TAXONOMY_URL = `${TAXONOMY_ENDPOINT}?filter%5Bdrupal_internal__tid%5D=806`;
const COUNTRY_UUID = "2f829192-01a9-4909-b729-baab0b0bad0c";
const TOKEN = "test-only-public-token.value";
const FIELDS = [
  "title",
  "field_job_title",
  "field_job_employment_type",
  "field_job_type",
  "field_job_id",
  "field_job_business_unit",
  "field_job_work_location",
  "field_job_posted_date",
  "path",
  "drupal_internal__tid",
  "field_date",
  "field_job_country",
  "field_job_alt_country_1",
  "field_job_alt_country_2",
  "field_job_alt_country_3"
].join(",");

type Probe = "primary" | "alt1" | "alt2" | "alt3";

function plan(overrides: Record<string, unknown> = {}): SourceCrawlPlan {
  const expectedChannels = [{ channelId: "source:source-sandoz-china-social:default", kind: "SOCIAL" as const }];
  return {
    adapterId: "official-json",
    company: { id: "company-sandoz-china", officialChineseName: "山德士中国" },
    source: {
      id: "source-sandoz-china-social",
      companyId: "company-sandoz-china",
      kind: "SOCIAL",
      atsKind: "OFFICIAL_JSON",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: ENTRY,
      officialChainEvidenceUrl: ENTRY
    },
    expectedChannels,
    expectedChannelSetHash: expectedChannelSetHash(expectedChannels),
    json: {
      jobsPath: "jobs",
      fields: {
        sourceJobId: "sourceJobId",
        officialTitle: "title",
        officialUrl: "officialUrl",
        locationRaw: "locationRaw",
        cities: "cities"
      }
    },
    officialJsonFetch: {
      kind: "sandoz-jsonapi",
      endpointUrl: ENDPOINT,
      taxonomyEndpointUrl: TAXONOMY_ENDPOINT,
      countryTermName: "LOC_CN",
      countryTermTargetId: 806,
      countryTermUuid: COUNTRY_UUID,
      pageSize: 10,
      maxPages: 50,
      detailBaseUrl: "https://www.sandoz.com",
      ...overrides
    }
  } as SourceCrawlPlan;
}

function stagedPlan(): SourceCrawlPlan {
  const staged = buildStagedSourceCrawlPlans(candidateCompanies).find(
    (candidate) => candidate.source.id === "source-sandoz-china-social"
  );
  if (!staged) throw new Error("Missing canonical staged Sandoz plan");
  return structuredClone(staged);
}

function response(body: string, url: string, contentType = "application/vnd.api+json", status = 200): OfficialJsonHttpResponse {
  return { status, body, finalUrl: url, contentType, capturedAt: NOW };
}

function entryResponse(body = `<script id="__NEXT_DATA__" type="application/json">{"props":{"token":"${TOKEN}"}}</script>`): OfficialJsonHttpResponse {
  return response(body, ENTRY, "text/html");
}

function taxonomy(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    data: [{
      type: "taxonomy_term--job_location",
      id: COUNTRY_UUID,
      attributes: { drupal_internal__tid: 806, name: "LOC_CN" },
      ...overrides
    }]
  });
}

function chinaRelationship(overrides: Record<string, unknown> = {}) {
  return {
    data: [{
      type: "taxonomy_term--job_location",
      id: COUNTRY_UUID,
      meta: { drupal_internal__target_id: 806, term_name: "LOC_CN" },
      ...overrides
    }]
  };
}

function row(
  officialId: string,
  resourceId = `00000000-0000-4000-8000-${officialId.replace(/[^0-9]/gu, "").padStart(12, "0").slice(-12)}`,
  overrides: Record<string, unknown> = {}
) {
  return {
    type: "node--jobs",
    id: resourceId,
    attributes: {
      field_job_id: officialId,
      field_job_title: `Role ${officialId}`,
      field_job_work_location: "Shanghai (Shanghai) (Sandoz)",
      field_job_employment_type: "Regular",
      field_job_type: "Full time",
      path: { alias: `/role-${officialId.toLowerCase()}` }
    },
    relationships: { field_job_country: chinaRelationship() },
    ...overrides
  };
}

function probeUrl(probe: Probe, page = 0): string {
  const url = new URL(ENDPOINT);
  url.searchParams.set("fields[node--jobs]", FIELDS);
  url.searchParams.set("page", String(page));
  url.searchParams.set("views-filter[field_job_functional_area]", "All");
  url.searchParams.set("views-filter[field_job_posted_date][min]", "");
  url.searchParams.set("views-filter[field_job_posted_date][max]", "");
  if (probe === "primary") {
    url.searchParams.set("views-filter[field_job_country]", "806");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
  } else if (probe === "alt1") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "806");
  } else if (probe === "alt2") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_2]", "806");
  } else {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_3]", "806");
  }
  return url.toString();
}

function pageBody(input: {
  probe: Probe;
  page?: number;
  data?: unknown[];
  count?: unknown;
  pageSize?: unknown;
  self?: unknown;
  next?: unknown;
  includeCount?: boolean;
}): string {
  const page = input.page ?? 0;
  const data = input.data ?? [];
  const links: Record<string, unknown> = {
    self: input.self ?? { href: probeUrl(input.probe, page) }
  };
  if (input.next !== undefined) links.next = input.next;
  return JSON.stringify({
    data,
    meta: input.includeCount === false ? {} : { count: input.count ?? data.length },
    links,
    number_of_items_per_page: input.pageSize ?? 10
  });
}

interface ClientOptions {
  entry?: OfficialJsonHttpResponse;
  taxonomy?: OfficialJsonHttpResponse;
  primary?: string[];
  alt1?: string;
  alt2?: string;
  alt3?: string;
  statusByUrl?: Record<string, number>;
}

function client(options: ClientOptions = {}) {
  const requests: OfficialJsonHttpRequest[] = [];
  let primaryPage = 0;
  const exactZero = (probe: Probe) => pageBody({ probe });
  const http = async (request: OfficialJsonHttpRequest): Promise<OfficialJsonHttpResponse> => {
    requests.push(request);
    if (request.url === ENTRY) return options.entry ?? entryResponse();
    if (request.url === TAXONOMY_URL) return options.taxonomy ?? response(taxonomy(), request.url);
    const status = options.statusByUrl?.[request.url];
    if (status !== undefined) return response("access denied", request.url, "text/plain", status);
    if (request.url === probeUrl("alt1")) return response(options.alt1 ?? exactZero("alt1"), request.url);
    if (request.url === probeUrl("alt2")) return response(options.alt2 ?? exactZero("alt2"), request.url);
    if (request.url === probeUrl("alt3")) return response(options.alt3 ?? exactZero("alt3"), request.url);
    const body = options.primary?.[primaryPage++] ?? exactZero("primary");
    return response(body, request.url);
  };
  return { http, requests };
}

async function fetchWith(options: ClientOptions = {}, config: Record<string, unknown> = {}) {
  const fixture = client(options);
  const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: fixture.http })(plan(config));
  return { result, requests: fixture.requests };
}

describe("Sandoz fresh official JSON:API contract", () => {
  it("validates taxonomy before China requests and returns the exact current-shape rows losslessly", async () => {
    const first = row("REQ-10029354", "4816e692-7bed-4a07-80a9-cd6dd2823fa7", {
      attributes: {
        field_job_id: "REQ-10029354",
        field_job_title: "AS&T (Analytical Science & Technology) Manager",
        field_job_work_location: "Shanghai (Shanghai) (Sandoz)",
        field_job_employment_type: "Regular",
        field_job_type: "Full time",
        path: { alias: "/ast-analytical-science-technology-manager" }
      }
    });
    const second = row("REQ-10029352", "857d95c7-7847-4904-bb50-648068a190b1", {
      attributes: {
        field_job_id: "REQ-10029352",
        field_job_title: "Senior Quality Assurance Manager",
        field_job_work_location: "Shanghai (Shanghai) (Sandoz)",
        field_job_employment_type: "Regular",
        field_job_type: "Full time",
        path: { alias: "/senior-quality-assurance-manager" }
      }
    });
    const { result, requests } = await fetchWith({
      primary: [pageBody({ probe: "primary", data: [first, second], count: 2 })]
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: "REQ-10029354",
            title: "AS&T (Analytical Science & Technology) Manager",
            officialUrl: "https://www.sandoz.com/ast-analytical-science-technology-manager/",
            locationRaw: "Shanghai (Shanghai) (Sandoz)",
            cities: ["上海"]
          },
          {
            sourceJobId: "REQ-10029352",
            title: "Senior Quality Assurance Manager",
            officialUrl: "https://www.sandoz.com/senior-quality-assurance-manager/"
          }
        ]
      },
      completeness: { expectedJobCount: 2, pageSize: 10, pagesVisited: 1 },
      fetchEvidence: {
        artifacts: [
          { logicalKey: "sandoz-entry", bodyRepresentation: "REDACTED" },
          { logicalKey: "sandoz-taxonomy" },
          { logicalKey: "sandoz-primary-page-0000" },
          { logicalKey: "sandoz-alt1-zero" },
          { logicalKey: "sandoz-alt2-zero" },
          { logicalKey: "sandoz-alt3-zero" }
        ],
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 },
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 2, scope: "SOURCE" }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    expect(requests.map(({ url }) => url)).toEqual([
      ENTRY,
      TAXONOMY_URL,
      probeUrl("primary"),
      probeUrl("alt1"),
      probeUrl("alt2"),
      probeUrl("alt3")
    ]);
    expect(requests[2]!.url).toContain("field_job_country%5D=806");
    expect(requests[2]!.url).not.toContain("field_job_country%5D=All");
    expect(new URL(requests[2]!.url).searchParams.get("fields[node--jobs]")).toBe(FIELDS);
    expect(requests.slice(1).every(({ headers }) => headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it.each([
    ["missing", JSON.stringify({ data: [] })],
    ["duplicate", JSON.stringify({ data: [JSON.parse(taxonomy()).data[0], JSON.parse(taxonomy()).data[0]] })],
    ["wrong name", taxonomy({ attributes: { drupal_internal__tid: 806, name: "LOC_AT" } })],
    ["stale numeric id", taxonomy({ attributes: { drupal_internal__tid: 999, name: "LOC_CN" } })],
    ["wrong UUID", taxonomy({ id: "00000000-0000-4000-8000-000000000999" })]
  ])("fails closed before list requests for %s taxonomy authority", async (_label, body) => {
    const { result, requests } = await fetchWith({ taxonomy: response(body, TAXONOMY_URL) });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz China taxonomy validation failed" });
    expect(requests.map(({ url }) => url)).toEqual([ENTRY, TAXONOMY_URL]);
  });

  it("rejects the stale singular node--job schema", async () => {
    const stale = { ...row("REQ-OLD"), type: "node--job" };
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data: [stale], count: 1 })] });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI resource validation failed" });
  });

  it.each([
    ["missing country relationship", {}],
    ["wrong country UUID", { field_job_country: chinaRelationship({ id: "00000000-0000-4000-8000-000000000999" }) }],
    ["wrong country target id", { field_job_country: chinaRelationship({ meta: { drupal_internal__target_id: 999, term_name: "LOC_CN" } }) }],
    ["wrong country term name", { field_job_country: chinaRelationship({ meta: { drupal_internal__target_id: 806, term_name: "LOC_AT" } }) }],
    ["non-empty alternate country", { field_job_country: chinaRelationship(), field_job_alt_country_1: chinaRelationship() }]
  ])("rejects a primary row with %s", async (_label, relationships) => {
    const invalid = row("REQ-SCOPE", undefined, { relationships });
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data: [invalid], count: 1 })] });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI resource validation failed" });
  });

  it.each([
    "//evil.example/role",
    "/../role",
    "/%2e%2e/role",
    "/role?campaign=secret",
    "/role#fragment",
    "https://evil.example/role"
  ])("rejects an unsafe detail path: %s", async (path) => {
    const invalid = row("REQ-PATH");
    invalid.attributes.path = { alias: path };
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data: [invalid], count: 1 })] });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI resource validation failed" });
  });

  it("accepts canonical object next links and exhausts every primary page", async () => {
    const firstTen = Array.from({ length: 10 }, (_, index) => row(`REQ-${100 + index}`));
    const last = row("REQ-110");
    const firstBody = pageBody({ probe: "primary", data: firstTen, count: 11, next: { href: probeUrl("primary", 1) } });
    const secondBody = pageBody({ probe: "primary", page: 1, data: [last], count: 11 });
    const { result } = await fetchWith({ primary: [firstBody, secondBody] });
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: { fetchCounts: { validCount: 11 }, pages: [{ termination: "CONTINUE" }, { termination: "NEXT_ABSENT" }] },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    const payload = result.ok && "payload" in result ? result.payload as { jobs: Array<{ sourceJobId: string }> } : undefined;
    expect(payload?.jobs.map(({ sourceJobId }) => sourceJobId)).toContain("REQ-110");
  });

  it.each([
    ["string next", probeUrl("primary", 1)],
    ["skipped page", { href: probeUrl("primary", 2) }],
    ["backward page", { href: probeUrl("primary", 0) }],
    ["host drift", { href: probeUrl("primary", 1).replace("sandoz-com.cms.sandoz.com", "evil.example") }],
    ["path drift", { href: probeUrl("primary", 1).replace("/job_search/job_search", "/job_search/other") }],
    ["field drift", { href: probeUrl("primary", 1).replace("field_job_title", "field_secret") }],
    ["filter drift", { href: probeUrl("primary", 1).replace("field_job_country%5D=806", "field_job_country%5D=All") }]
  ])("rejects %s", async (_label, next) => {
    const ten = Array.from({ length: 10 }, (_, index) => row(`REQ-${200 + index}`));
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data: ten, count: 11, next })] });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI next-page declaration is invalid" });
  });

  it.each([
    ["changed count", [
      pageBody({ probe: "primary", data: Array.from({ length: 10 }, (_, index) => row(`REQ-${300 + index}`)), count: 11, next: { href: probeUrl("primary", 1) } }),
      pageBody({ probe: "primary", page: 1, data: [row("REQ-310")], count: 12 })
    ]],
    ["changed page size", [pageBody({ probe: "primary", data: [row("REQ-320")], count: 1, pageSize: 20 })]],
    ["missing count", [pageBody({ probe: "primary", data: [row("REQ-330")], includeCount: false })]],
    ["data/count contradiction", [pageBody({ probe: "primary", data: [row("REQ-340")], count: 0 })]]
  ])("fails noncertifying evidence for %s", async (_label, primary) => {
    const { result } = await fetchWith({ primary });
    expect(result.ok).toBe(false);
  });

  it("fails when max pages is reached with a remaining next link", async () => {
    const ten = Array.from({ length: 10 }, (_, index) => row(`REQ-${400 + index}`));
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data: ten, count: 11, next: { href: probeUrl("primary", 1) } })] }, { maxPages: 1 });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI pagination reached max pages with next" });
  });

  it.each([
    ["duplicate official ID", [row("REQ-500"), row("REQ-500", "00000000-0000-4000-8000-000000000501")]],
    ["duplicate resource UUID", [row("REQ-510", "00000000-0000-4000-8000-000000000510"), row("REQ-511", "00000000-0000-4000-8000-000000000510")]],
    ["conflicting pair", [row("REQ-520", "00000000-0000-4000-8000-000000000520"), row("REQ-520", "00000000-0000-4000-8000-000000000520", {
      attributes: { field_job_id: "REQ-520", field_job_title: "Changed", field_job_work_location: "Shanghai", path: { alias: "/changed" } }
    })]]
  ])("fails closed for %s", async (_label, data) => {
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data, count: data.length })] });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz JSONAPI duplicate or collision detected" });
  });

  it.each(["alt1", "alt2", "alt3"] as const)("holds certification when %s becomes positive", async (probe) => {
    const positive = pageBody({ probe, data: [row(`REQ-${probe}`)], count: 1 });
    const { result } = await fetchWith({
      primary: [pageBody({ probe: "primary", data: [row("REQ-600")], count: 1 })],
      [probe]: positive
    });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz alternate-country boundary drift detected" });
  });

  it("rejects an alternate probe whose self link does not echo its exact filter", async () => {
    const drifted = pageBody({ probe: "alt2", self: { href: probeUrl("alt1") } });
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary" })], alt2: drifted });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz alternate-country probe scope is invalid" });
  });

  it("certifies an official zero only after taxonomy plus all four exact zero probes", async () => {
    const { result, requests } = await fetchWith();
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      completeness: { expectedJobCount: 0 },
      fetchEvidence: { fetchCounts: { rawCount: 0, validCount: 0 }, pages: [{ termination: "EMPTY_PAGE", declaredTotal: 0 }] },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    expect(requests.map(({ url }) => url)).toEqual([ENTRY, TAXONOMY_URL, probeUrl("primary"), probeUrl("alt1"), probeUrl("alt2"), probeUrl("alt3")]);
  });

  it.each([
    ["missing token", entryResponse("<html>no token</html>")],
    ["duplicate token", entryResponse(`{"token":"${TOKEN}","token":"other-test-token"}`)]
  ])("does not call the API for %s", async (_label, entry) => {
    const { result, requests } = await fetchWith({ entry });
    expect(result).toMatchObject({ ok: false, failureReason: "Sandoz entry/token evidence is invalid" });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it.each([401, 403, 404])("never treats HTTP %s as official zero", async (status) => {
    const { result } = await fetchWith({ statusByUrl: { [probeUrl("primary")]: status } });
    expect(result).toMatchObject({ ok: false, failureReason: `Sandoz JSONAPI returned HTTP ${status}` });
  });

  it("does not treat a remaining next signal as official zero", async () => {
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", count: 0, next: { href: probeUrl("primary", 1) } })] });
    expect(result.ok).toBe(false);
  });

  it.each(["Intern", "Internship", "Apprentice", "Trainee", "Graduate Program", "Student", "实习", "校招", "应届", "管培生"])(
    "holds certification instead of silently dropping a campus marker: %s",
    async (marker) => {
      const campus = row("REQ-700", undefined, {
        attributes: {
          field_job_id: "REQ-700",
          field_job_title: `${marker} Quality Role`,
          field_job_work_location: "Shanghai",
          field_job_employment_type: "Regular",
          field_job_type: "Full time",
          path: { alias: "/campus-drift" }
        }
      });
      const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data: [campus], count: 1 })] });
      expect(result).toMatchObject({ ok: false, failureReason: "Sandoz social/campus boundary drift detected" });
    }
  );

  it("redacts the entry credential while retaining a raw SHA and never leaks it downstream", async () => {
    const { result } = await fetchWith({ primary: [pageBody({ probe: "primary", data: [row("REQ-800")], count: 1 })] });
    expect(result.fetchEvidence?.artifacts[0]).toMatchObject({
      bodyRepresentation: "REDACTED",
      rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL", count: expect.any(Number) }]
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toMatch(/authorization\s*[:=].*bearer/iu);
  });

  it("promotes a lossless positive official count only after the downstream adapter reconciles", async () => {
    const fixture = client({ primary: [pageBody({ probe: "primary", data: [row("REQ-900")], count: 1 })] });
    const crawlPlan = stagedPlan();
    const result = await runSourceCrawl(crawlPlan, {
      fetch: createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: fixture.http })
    });
    expect(result).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1, structuredJobCount: 1 },
      reconciliation: { rawInputCount: 1, dedupeOutputCount: 1, adapterLosses: [] }
    });
  });

  it("rejects a renamed staged source even when its channel hash is internally consistent", async () => {
    const fixture = client({ primary: [pageBody({ probe: "primary", data: [row("REQ-901")], count: 1 })] });
    const crawlPlan = stagedPlan();
    const renamedSourceId = "source-not-sandoz-social";
    const renamedChannels = [{ channelId: `source:${renamedSourceId}:default`, kind: "SOCIAL" as const }];
    crawlPlan.source = { ...crawlPlan.source, id: renamedSourceId };
    crawlPlan.expectedChannels = renamedChannels;
    crawlPlan.expectedChannelSetHash = expectedChannelSetHash(renamedChannels);
    const result = await runSourceCrawl(crawlPlan, {
      fetch: createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: fixture.http })
    });
    expect(result).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: false },
      observation: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1,
        structuredJobCount: 1
      }
    });
  });
});
