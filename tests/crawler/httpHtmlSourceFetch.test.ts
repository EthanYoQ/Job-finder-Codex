import { describe, expect, it } from "vitest";
import { createHttpHtmlSourceFetch, type HttpHtmlRequest, type HttpHtmlResponse } from "../../src/crawler/httpHtmlSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";

const base: SourceCrawlPlan = {
  adapterId: "html-table",
  company: { id: "c", officialChineseName: "测试" },
  source: { id: "s", companyId: "c", kind: "SOCIAL", atsKind: "BEISEN_ZHIYE", status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://example.test/jobs", officialChainEvidenceUrl: "https://example.test/careers" },
  table: { rowSelector: "tr.job", fields: { officialTitle: { selector: ".title" }, officialUrl: { selector: "a", attribute: "href" }, locationRaw: { selector: ".location" } } }
};
const at = (request: HttpHtmlRequest, body: string, contentType = "text/html", status = 200): HttpHtmlResponse => ({
  status, body, finalUrl: request.url, contentType, capturedAt: "2026-07-08T00:00:01.000Z"
});
const row = (id: string) => `<tr class="job"><td class="title">${id}</td><td class="location">上海</td><td><a href="/${id}">详情</a></td></tr>`;
const talentResults = (overrides: Record<string, string> = {}) => {
  const attrs = { "data-current-page": "1", "data-total-pages": "1", "data-total-job-results": "1", "data-records-per-page": "20", ...overrides };
  return `<section id="search-results" ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ")}><table>${row("a")}</table></section>`;
};

describe("official HTML fetch evidence", () => {
  it.each([
    [1, `<table>${row("one")}</table>`],
    [0, "<div id=\"empty\"></div>"]
  ])("never treats configured expected count %s as an official declaration", async (configuredTotal, body) => {
    const plan = { ...base, table: { ...base.table, pagination: {
      totalPagesSelector: "#none", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 1,
      expectedJobCountSelector: configuredTotal === 0 ? "#empty" : "tr.job",
      expectedJobCountValue: configuredTotal
    } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, body)
    })(plan);
    expect(result).toMatchObject({
      fetchEvidence: { pages: [{ declaredTotal: null }] },
      paginationEvaluation: { verifiedEligible: false }
    });
    const completeness = "completeness" in result ? result.completeness ?? {} : {};
    expect(completeness).not.toHaveProperty("expectedJobCount");
    expect(completeness).not.toHaveProperty("completenessEvidenceKind", "OFFICIAL_TOTAL_COUNT");
    expect(result.fetchEvidence).not.toHaveProperty("declaredCompleteness");
  });

  it.each([
    ["text equal to returned count", `<div id="count">1</div><table>${row("one")}</table>`, { expectedJobCountSelector: "#count" }],
    ["text zero", `<div id="count">0</div>`, { expectedJobCountSelector: "#count" }],
    ["attribute", `<div id="count" data-total="1"></div><table>${row("one")}</table>`, { expectedJobCountSelector: "#count", expectedJobCountAttribute: "data-total" }],
    ["pattern", `<div id="count">Showing 1 jobs</div><table>${row("one")}</table>`, { expectedJobCountSelector: "#count", expectedJobCountPattern: "Showing\\s+(\\d+)\\s+jobs" }]
  ])("does not promote ordinary HTML %s to official total evidence", async (_name, body, expectedCountConfig) => {
    const plan = { ...base, table: { ...base.table, pagination: {
      totalPagesSelector: "#none", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 1, ...expectedCountConfig
    } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, body)
    })(plan);
    expect(result).toMatchObject({
      fetchEvidence: { pages: [{ declaredTotal: null }] },
      paginationEvaluation: { verifiedEligible: false }
    });
    const completeness = "completeness" in result ? result.completeness ?? {} : {};
    expect(completeness).not.toHaveProperty("expectedJobCount");
    expect(completeness).not.toHaveProperty("completenessEvidenceKind", "OFFICIAL_TOTAL_COUNT");
    expect(result.fetchEvidence).not.toHaveProperty("declaredCompleteness");
  });

  it("records RED->GREEN strict ordinary evidence and never self-certifies", async () => {
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, `<table>${row("one")}</table>`) })(base);
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { captureTool: { name: "official-html-http", version: "1" }, fetchCounts: { rawCount: 1 },
        pages: [{ requestedPage: null, returnedPage: null, rawJobIds: [expect.stringMatching(/^html-row:sha256:/)] }] },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false } });
    if (!result.ok || !result.fetchEvidence) throw new Error("expected evidence");
    expect(result.fetchEvidence.artifacts[0]).toMatchObject({ kind: "PAGINATION_PAGE", bodyRepresentation: "EXACT",
      requestedUrl: "https://example.test/jobs", finalUrl: "https://example.test/jobs" });
  });

  it("rejects missing response metadata with a fixed safe reason", async () => {
    const result = await createHttpHtmlSourceFetch({ http: async () => ({ status: 200, body: row("one") }) })(base);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_RESPONSE_METADATA_MISSING" });
  });

  it("keeps ordinary later-page artifacts and remains manual", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 3 } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      const page = new URL(request.url).searchParams.get("page") ?? "1";
      return at(request, `<div id="r" data-total-pages="3"></div><table>${row(page)}</table>`, "text/html", page === "3" ? 503 : 200);
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_PAGE_RESPONSE_INVALID",
      fetchEvidence: { artifacts: [{}, {}, {}], pages: [{}, {}, { termination: "FAILED" }] } });
  });

  it("archives TalentBrew entry HTML and exact JSON pages while returning derived HTML only", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 2, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const jsonBodies: string[] = [];
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      if (!request.url.includes("/results")) return at(request, `<section id="search-results" data-ajax-url="/results" data-total-pages="2" data-total-job-results="2" data-records-per-page="1"></section>`);
      const page = new URL(request.url).searchParams.get("CurrentPage")!;
      const body = JSON.stringify({ results: `<section id="search-results" data-current-page="${page}" data-total-pages="2" data-total-job-results="2" data-records-per-page="1"><table>${row(page)}</table></section>` });
      jsonBodies.push(body); return at(request, body, "application/json");
    }})(plan);
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE", body: jsonBodies[0] }, { kind: "PAGINATION_PAGE", body: jsonBodies[1] }], pages: [{}, {}] } });
    if (!result.ok || !("html" in result)) throw new Error("expected HTML");
    expect(result.html).not.toContain('"results"');
  });

  it("does not synthesize an official zero when TalentBrew declares pages but no job total", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 1, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      request.url.includes("/results")
        ? at(request, JSON.stringify({ results: `<section id="search-results" data-current-page="1" data-total-pages="1" data-records-per-page="20"><table>${row("a")}</table></section>` }), "application/json")
        : at(request, `<section id="search-results" data-ajax-url="/results" data-total-pages="1" data-records-per-page="20"></section>`) })(plan);
    expect(result).toMatchObject({ ok: true, completeness: { completenessEvidenceKind: "WEAK_MANUAL_SAMPLE" } });
    const completeness = "completeness" in result ? result.completeness : undefined;
    expect(completeness).not.toHaveProperty("expectedJobCount");
  });

  it("crawls exact TalentBrew social facet partitions as independent evidence channels", async () => {
    const plan = { ...base, table: { ...base.table,
      fields: { ...base.table.fields, sourceJobId: { selector: "button", attribute: "data-job-id" } },
      pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
        pageSearchParam: "CurrentPage", maxPages: 3, ajaxMode: "talentbrew",
        talentbrewScope: {
          requiredActiveFacet: { id: "1814991", facetType: 2, descriptor: "China" },
          allowedPartitions: [
            { channelId: "employment-fixed", id: "Fixed Term", facetType: 5, fieldName: "job_type", descriptor: "Fixed Term" },
            { channelId: "employment-regular", id: "Regular", facetType: 5, fieldName: "job_type", descriptor: "Regular" }
          ]
        }
      }
    } } as SourceCrawlPlan;
    const entry = `<section id="search-results" data-ajax-url="/results" data-facet-term="1814991" data-facet-type="2"
      data-total-pages="4" data-total-job-results="4" data-records-per-page="1"></section>
      <div id="search-filters"><div data-enabled="false"><input class="filter-checkbox" checked data-id="1814991" data-facet-type="2" data-count="4" data-display="China" data-field-name="" /></div>
      <div data-enabled="true"><input class="filter-checkbox" data-id="Fixed Term" data-facet-type="5" data-count="2" data-display="Fixed Term" data-field-name="job_type" /></div>
      <div data-enabled="true"><input class="filter-checkbox" data-id="Regular" data-facet-type="5" data-count="1" data-display="Regular" data-field-name="job_type" /></div></div>`;
    const paginationFlags: string[] = [];
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      if (!request.url.includes("/results")) return at(request, entry);
      const url = new URL(request.url);
      paginationFlags.push(url.searchParams.get("IsPagination") ?? "");
      const display = [...url.searchParams.entries()].find(([key]) => key.endsWith(".Display") && key.startsWith("FacetFilters[1]"))?.[1];
      const page = Number(url.searchParams.get("CurrentPage"));
      const total = display === "Fixed Term" ? 2 : 1;
      const id = display === "Fixed Term" ? `fixed-${page}` : "regular-1";
      return at(request, JSON.stringify({ results: `<section id="search-results" data-current-page="${page}" data-total-pages="${total}" data-total-job-results="${total}" data-records-per-page="1"><table><tr class="job"><td class="title">${id}</td><td class="location">上海</td><td><a href="/${id}">详情</a><button data-job-id="${id}"></button></td></tr></table></section>` }), "application/json");
    }})(plan);
    expect(result).toMatchObject({ ok: true,
      completeness: { expectedJobCount: 3, pagesVisited: 3, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { fetchCounts: { rawCount: 3, validCount: 3 }, pages: [
        { channelId: "employment-fixed", requestedPage: 1, returnedPage: 1 },
        { channelId: "employment-fixed", requestedPage: 2, returnedPage: 2 },
        { channelId: "employment-regular", requestedPage: 1, returnedPage: 1 }
      ] },
      paginationEvaluation: { safeCompleteness: true, visitedChannelIds: ["employment-fixed", "employment-regular"] }
    });
    if (!result.ok || !("html" in result)) throw new Error("expected scoped TalentBrew HTML");
    expect(result.html).toContain("fixed-2");
    expect(result.html).toContain("regular-1");
    expect(paginationFlags).toEqual(["False", "True", "False"]);
  });

  it("fails closed before TalentBrew AJAX when the official active geography facet drifts", async () => {
    const plan = { ...base, table: { ...base.table, pagination: {
      totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages", pageSearchParam: "CurrentPage",
      maxPages: 3, ajaxMode: "talentbrew", talentbrewScope: {
        requiredActiveFacet: { id: "1814991", facetType: 2, descriptor: "China" },
        allowedPartitions: [{ channelId: "regular", id: "Regular", facetType: 5, fieldName: "job_type", descriptor: "Regular" }]
      }
    } } } as SourceCrawlPlan;
    let calls = 0;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      calls += 1;
      return at(request, `<section id="search-results" data-ajax-url="/results" data-facet-term="999" data-facet-type="2" data-total-pages="1"></section>`);
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "TALENTBREW_SCOPE_INVALID" });
    expect(calls).toBe(1);
  });

  it("rejects recursive TalentBrew duplicate JSON keys and retains the response", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 1, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      request.url.includes("/results") ? at(request, `{"results":"${row("a").replaceAll('"', '\\"')}","nested":{"x":1,"x":2}}`, "application/json")
        : at(request, `<section id="search-results" data-ajax-url="/results" data-total-pages="1"></section>`) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "TALENTBREW_JSON_DUPLICATE_KEY", fetchEvidence: { artifacts: [{}, {}] } });
  });

  it("accepts unique Tupu360 offset pages without inventing returned coordinates or capacity", async () => {
    const plan = { ...base, source: { ...base.source, officialEntryUrl: "https://example.test/site/position/index?recruitmentType=SOCIAL" },
      table: { ...base.table, pagination: { totalPagesSelector: "#pageTurnUl li:first-child", totalPagesAttribute: "data-x", pageSearchParam: "offset",
        pageSearchParamMode: "offset", pageSize: 2, maxPages: 2, ajaxMode: "tupu360" } } } as SourceCrawlPlan;
    const page = (body: string) => `<table>${body}</table><ul id="pageTurnUl"><li>共2页</li><li onclick="pageTurn(2,2.0)">2</li></ul>`;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => at(request,
      request.method === "POST" ? page(row("c")) : page(`${row("a")}${row("b")}`)) })(plan);
    expect(result).toMatchObject({ ok: true, paginationEvaluation: { safeCompleteness: true }, fetchEvidence: { pages: [
      { requestedOffset: null, returnedOffset: null, returnedPageSize: null,
        nextPageSignalBefore: "initial", nextPageSignalAfter: "offset-2" },
      { requestedOffset: 2, returnedOffset: null, requestedPageSize: 2, returnedPageSize: null,
        nextPageSignalBefore: "offset-2", nextPageSignalAfter: null }
    ] } });
  });

  it("rejects TalentBrew JSON keys outside the public response schema", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 1, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      request.url.includes("/results") ? at(request, JSON.stringify({ results: `<section id="search-results" data-current-page="1" data-total-pages="1">${row("a")}</section>`, secretEnvelope: "x" }), "application/json")
        : at(request, `<section id="search-results" data-ajax-url="/results" data-total-pages="1"></section>`) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "TALENTBREW_JSON_SCHEMA_INVALID", fetchEvidence: { artifacts: [{}, {}] } });
  });

  it("accepts the public TalentBrew hasContent response member", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 1, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      request.url.includes("/results")
        ? at(request, JSON.stringify({ results: talentResults(), filters: "", hasJobs: true, hasContent: false }), "application/json")
        : at(request, `<section id="search-results" data-ajax-url="/results" data-total-pages="1" data-total-job-results="1" data-records-per-page="20"></section>`) })(plan);
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 1 } } });
  });

  it("fails closed on repeated ordinary pages and declaration drift", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 2 } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      const second = new URL(request.url).searchParams.get("page") === "2";
      return at(request, `<div id="r" data-total-pages="${second ? 3 : 2}"></div><table>${row("same")}</table>`);
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE",
      paginationEvaluation: { safeCompleteness: false, derivedAnomalyCodes: expect.arrayContaining(["TOTAL_CHANGED", "REPEATED_JOB_ID_SET_WITH_NEXT"]) } });
  });

  it("accepts unique ordinary pages when the official response has no returned-page field", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 2 } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      const page = new URL(request.url).searchParams.get("page") ?? "1";
      return at(request, `<div id="r" data-total-pages="2"></div><table>${row(page)}</table>`);
    }})(plan);
    expect(result).toMatchObject({ ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      paginationEvaluation: { safeCompleteness: true },
      fetchEvidence: { pages: [
        { requestedPage: null, returnedPage: null },
        { requestedPage: 2, returnedPage: null }
      ] }
    });
  });

  it("treats a missing configured total-pages attribute as absent instead of parsing unrelated text", async () => {
    const plan = { ...base, table: { ...base.table, pagination: {
      totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", pageSize: 1, maxPages: 2,
      expectedJobCountSelector: "#r", expectedJobCountPattern: "of\\s+(\\d+)\\s+Jobs"
    } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => {
        const page = new URL(request.url).searchParams.get("page") ?? "1";
        return at(request, `<div id="r">Showing 1 to 1 of 2 Jobs</div><table>${row(page)}</table>`);
      }
    })(plan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { pagesVisited: 2 },
      paginationEvaluation: { safeCompleteness: true },
      fetchEvidence: { pages: [{ declaredPages: 2 }, { declaredPages: 2 }] }
    });
  });

  it("binds an entry-only total-page declaration across later controls that omit the active last page", async () => {
    const plan = { ...base, table: { ...base.table, pagination: {
      totalPagesSelector: ".page a[href*='PageIndex=']", totalPagesAttribute: "href",
      totalPagesPattern: "PageIndex=([1-9]\\d*)(?:&|$)", totalPagesMode: "max",
      totalPagesDeclaredOnEntryOnly: true, pageSearchParam: "PageIndex", maxPages: 3
    } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => {
        const page = Number(new URL(request.url).searchParams.get("PageIndex") ?? "1");
        const links = page === 1
          ? `<a href="?PageIndex=2">2</a><a href="?PageIndex=3">3</a>`
          : page === 2
            ? `<a href="?PageIndex=1">1</a><a href="?PageIndex=3">3</a>`
            : `<a href="?PageIndex=1">1</a><a href="?PageIndex=2">2</a>`;
        return at(request, `<div class="page">${links}<a class="now">${page}</a></div><table>${row(String(page))}</table>`);
      }
    })(plan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: { pages: [{ declaredPages: 3 }, { declaredPages: 3 }, { declaredPages: 3 }] },
      paginationEvaluation: { safeCompleteness: true, derivedAnomalyCodes: [] }
    });
  });

  it("detects a repeated stable raw row even when its position changes across pages", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 2 } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      const second = new URL(request.url).searchParams.get("page") === "2";
      return at(request, `<div id="r" data-total-pages="2"></div><table>${second
        ? `${row("new")}${row("same")}` : `${row("same")}${row("other")}`}</table>`);
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE",
      paginationEvaluation: { derivedAnomalyCodes: expect.arrayContaining(["RAW_ID_OVERLAP_ACROSS_PAGES"]) } });
  });

  it("rejects cross-origin TalentBrew AJAX before transport and rejects MIME/time regression", async () => {
    let calls = 0;
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 1, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const cross = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      calls += 1; return at(request, `<section id="search-results" data-ajax-url="https://evil.test/results" data-total-pages="1"></section>`);
    }})(plan);
    expect(cross).toMatchObject({ ok: false, failureReason: "HTML_REQUEST_UNSAFE" });
    expect(calls).toBe(1);
    const mime = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => at(request, row("a"), "application/json") })(base);
    expect(mime).toMatchObject({ ok: false, failureReason: "HTML_RESPONSE_MIME_INVALID" });
  });

  it("redacts credential assignments but preserves benign password prose", async () => {
    const credential = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      at(request, `<p>password = hunter2</p><table>${row("a")}</table>`) })(base);
    if (!credential.ok || !credential.fetchEvidence) throw new Error("expected redacted evidence");
    expect(credential.fetchEvidence.artifacts[0]).toMatchObject({ body: "[REDACTED_CREDENTIAL_MATERIAL]", bodyRepresentation: "REDACTED",
      rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/), redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL", count: 1 }] });
    const benign = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      at(request, `<p>Reset your password safely.</p><table>${row("a")}</table>`) })(base);
    if (!benign.ok || !benign.fetchEvidence) throw new Error("expected exact evidence");
    expect(benign.fetchEvidence.artifacts[0]?.bodyRepresentation).toBe("EXACT");
  });

  it("fails closed on TalentBrew records-per-page drift", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 2, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      if (!request.url.includes("/results")) return at(request, `<section id="search-results" data-ajax-url="/results" data-total-pages="2" data-records-per-page="2"></section>`);
      const p = new URL(request.url).searchParams.get("CurrentPage")!;
      return at(request, JSON.stringify({ results: `<section id="search-results" data-current-page="${p}" data-total-pages="2" data-records-per-page="${p === "1" ? 2 : 3}"><table>${row(p)}${row(`${p}b`)}</table></section>` }), "application/json");
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE",
      paginationEvaluation: { derivedAnomalyCodes: expect.arrayContaining(["TOTAL_CHANGED"]) } });
  });

  it("fails closed on Tupu360 declared page-size drift", async () => {
    const plan = { ...base, source: { ...base.source, officialEntryUrl: "https://example.test/site/position/index" },
      table: { ...base.table, pagination: { totalPagesSelector: "#pageTurnUl li:first-child", totalPagesAttribute: "data-x", pageSearchParam: "offset",
        pageSearchParamMode: "offset", pageSize: 2, maxPages: 2, ajaxMode: "tupu360" } } } as SourceCrawlPlan;
    let call = 0;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      call += 1; const size = call === 1 ? 2 : 3;
      return at(request, `<table>${row(`${call}a`)}${row(`${call}b`)}</table><ul id="pageTurnUl"><li>共2页</li><li onclick="pageTurn(2,${size}.0)">2</li></ul>`);
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE",
      paginationEvaluation: { derivedAnomalyCodes: expect.arrayContaining(["TOTAL_CHANGED"]) } });
  });

  it("rejects an invalid-present ordinary total declaration", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 2 } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      at(request, `<div id="r" data-total-pages="2x"></div><table>${row("a")}</table>`) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_DECLARATION_INVALID", fetchEvidence: { artifacts: [{}] } });
  });

  it("preserves exact evidence and evaluation references through runSourceCrawl", async () => {
    const fetch = createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      at(request, `<table>${row("a")}</table>`) });
    const fetched = await fetch(base);
    if (!fetched.ok || !fetched.fetchEvidence || !fetched.paginationEvaluation) throw new Error("expected fetch evidence");
    const crawled = await runSourceCrawl(base, { fetch: async () => fetched });
    expect(crawled.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(crawled.paginationEvaluation).toBe(fetched.paginationEvaluation);
    expect(crawled.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
  });

  it.each(["", "1.5", "garbage"])("rejects invalid-present TalentBrew initial declarations: %s", async invalid => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 1, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => at(request,
      `<section id="search-results" data-ajax-url="/results" data-current-page="${invalid}" data-total-pages="1" data-records-per-page="20"></section>`) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_DECLARATION_INVALID" });
  });

  it.each([
    ["data-current-page", "1.5"], ["data-total-pages", ""],
    ["data-total-job-results", "garbage"], ["data-records-per-page", "2.2"]
  ])("rejects invalid-present TalentBrew later declaration %s=%s", async (field, invalid) => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "CurrentPage", maxPages: 1, ajaxMode: "talentbrew" } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      request.url.includes("/results")
        ? at(request, JSON.stringify({ results: talentResults({ [field]: invalid }) }), "application/json")
        : at(request, `<section id="search-results" data-ajax-url="/results" data-current-page="1" data-total-pages="1" data-total-job-results="1" data-records-per-page="20"></section>`) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_DECLARATION_INVALID", fetchEvidence: { artifacts: [{}, {}] } });
  });

  it("accepts unique ordinary offset pages without fabricating returned coordinates", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "start", pageSearchParamMode: "offset", pageSize: 25, pageNumberOffset: 7, maxPages: 2 } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      const offset = new URL(request.url).searchParams.get("start");
      const count = offset === "25" ? 10 : 25;
      const rows = Array.from({ length: count }, (_, index) => row(`${offset ?? "first"}-${index}`)).join("");
      return at(request, `<div id="r" data-total-pages="2"></div><table>${rows}</table>`);
    }})(plan);
    expect(result).toMatchObject({ ok: true, paginationEvaluation: { safeCompleteness: true }, fetchEvidence: { pages: [
      { requestedPage: null, requestedOffset: null, returnedPage: null, returnedOffset: null,
        requestedPageSize: 25, nextPageSignalBefore: "initial", nextPageSignalAfter: "offset-25" },
      { requestedPage: null, requestedOffset: 25, returnedPage: null, returnedOffset: null,
        requestedPageSize: 25, nextPageSignalBefore: "offset-25", nextPageSignalAfter: null }
    ] } });
  });

  it.each([
    ["query", undefined, "https://example.test/jobs?page=9"],
    ["template", "https://example.test/jobs/p-{page}", "https://example.test/jobs/p-9"]
  ])("records actual ordinary %s pageNumberOffset coordinate", async (_label, pageUrlTemplate, expectedUrl) => {
    const requests: string[] = [];
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", pageNumberOffset: 7, ...(pageUrlTemplate ? { pageUrlTemplate } : {}), maxPages: 2 } } } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      requests.push(request.url); return at(request, `<div id="r" data-total-pages="2"></div><table>${row(request.url)}</table>`);
    }})(plan);
    expect(requests[1]).toBe(expectedUrl);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE", fetchEvidence: { pages: [
      { requestedPage: null, returnedPage: null }, { requestedPage: 9, returnedPage: null }
    ] } });
  });

  it("retains a schema-constructible current response when later MIME validation fails", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 2 } } } as SourceCrawlPlan;
    let call = 0;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      call += 1; return at(request, `<div id="r" data-total-pages="2"></div><table>${row(String(call))}</table>`, call === 2 ? "application/json" : "text/html");
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_RESPONSE_MIME_INVALID",
      fetchEvidence: { artifacts: [{}, { contentType: "application/json" }], pages: [{}, { termination: "FAILED" }] } });
  });

  it("retains prior evidence without fabricating a current artifact when later metadata is missing", async () => {
    const plan = { ...base, table: { ...base.table, pagination: { totalPagesSelector: "#r", totalPagesAttribute: "data-total-pages",
      pageSearchParam: "page", maxPages: 2 } } } as SourceCrawlPlan;
    let call = 0;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      call += 1; return call === 1 ? at(request, `<div id="r" data-total-pages="2"></div><table>${row("a")}</table>`)
        : { status: 200, body: `<div id="r" data-total-pages="2"></div><table>${row("b")}</table>` };
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_RESPONSE_METADATA_MISSING",
      fetchEvidence: { artifacts: [{}], pages: [{ termination: "FAILED" }] } });
  });

  it("does not issue a Tupu AJAX request when official page size is absent", async () => {
    const plan = { ...base, source: { ...base.source, officialEntryUrl: "https://example.test/site/position/index" },
      table: { ...base.table, pagination: { totalPagesSelector: "#pageTurnUl li:first-child", totalPagesAttribute: "data-x", pageSearchParam: "offset",
        pageSearchParamMode: "offset", pageSize: 2, maxPages: 2, ajaxMode: "tupu360" } } } as SourceCrawlPlan;
    let calls = 0;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      calls += 1; return at(request, `<table>${row("a")}${row("b")}</table><ul id="pageTurnUl"><li>共2页</li></ul>`);
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_DECLARATION_INVALID" });
    expect(calls).toBe(1);
  });

  it.each(["pageTurn(2,2)", "  pageTurn( 2 , 2.0 )  "])("accepts audited Tupu page-size syntax %s", async onclick => {
    const plan = { ...base, source: { ...base.source, officialEntryUrl: "https://example.test/site/position/index" },
      table: { ...base.table, pagination: { totalPagesSelector: "#pageTurnUl li:first-child", totalPagesAttribute: "data-x", pageSearchParam: "offset",
        pageSearchParamMode: "offset", pageSize: 2, maxPages: 2, ajaxMode: "tupu360" } } } as SourceCrawlPlan;
    let calls = 0;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      calls += 1; return at(request, `<table>${row(`${calls}a`)}${row(`${calls}b`)}</table><ul id="pageTurnUl"><li> 共 2 页 </li><li onclick="${onclick}">2</li></ul>`);
    }})(plan);
    expect(calls).toBe(2);
    expect(result).toMatchObject({ ok: true, paginationEvaluation: { safeCompleteness: true } });
  });

  it.each([
    ["共2页garbage", "pageTurn(2,2.0)"],
    ["共2页", "pageTurn(2,2.0)garbage"]
  ])("rejects Tupu declarations with trailing material before AJAX", async (totalText, onclick) => {
    const plan = { ...base, source: { ...base.source, officialEntryUrl: "https://example.test/site/position/index" },
      table: { ...base.table, pagination: { totalPagesSelector: "#pageTurnUl li:first-child", totalPagesAttribute: "data-x", pageSearchParam: "offset",
        pageSearchParamMode: "offset", pageSize: 2, maxPages: 2, ajaxMode: "tupu360" } } } as SourceCrawlPlan;
    let calls = 0;
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request => {
      calls += 1; return at(request, `<table>${row("a")}${row("b")}</table><ul id="pageTurnUl"><li>${totalText}</li><li onclick="${onclick}">2</li></ul>`);
    }})(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_DECLARATION_INVALID" });
    expect(calls).toBe(1);
  });

  it("records same-page duplicate raw rows as typed fetch loss and fails D1", async () => {
    const duplicate = row("same");
    const result = await createHttpHtmlSourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z"), http: async request =>
      at(request, `<table>${duplicate}${duplicate}</table>`) })(base);
    expect(result).toMatchObject({ ok: false, failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE", fetchEvidence: {
      fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 1, validationDiscardCount: 1 },
      fetchLosses: [{ stage: "VALIDATION", details: { code: "DUPLICATE_RAW_ROW", pageSequence: 0, recordIndex: 1 } }]
    } });
  });

  it("certifies one exact static official list page and preserves the declaration through the crawl", async () => {
    const plan = {
      ...base,
      table: {
        ...base.table,
        staticPublicList: {
          containerSelector: "#jobs",
          nextControlSelector: "#jobs .next",
          excludedPartitionSelectors: ["#jobs .campus"]
        }
      }
    } as SourceCrawlPlan;
    const fetch = createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, `<section id="jobs"><table>${row("one")}</table></section>`)
    });
    const result = await fetch(plan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        declaredCompleteness: {
          kind: "COMPLETE_PAGE_TRAVERSAL",
          value: 1,
          artifactLogicalKey: "official-html-page-0000",
          extractorLocator: "tr.job",
          scope: "SOURCE"
        },
        pages: [{ termination: "NEXT_ABSENT" }]
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    const crawled = await runSourceCrawl(plan, { fetch: async () => result });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL" }
    });
  });

  it("allows an explicitly scoped redacted static page to publish positive rows only as a manual partial", async () => {
    const plan = {
      ...base,
      table: {
        ...base.table,
        staticPublicList: {
          containerSelector: "#jobs",
          nextControlSelector: "#jobs .next",
          allowRedactedPositivePartial: true
        }
      }
    } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, `<section id="jobs"><script>document.cookie = "preferences";</script><table>${row("one")}</table></section>`)
    })(plan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: {
        artifacts: [{ bodyRepresentation: "REDACTED" }],
        fetchCounts: { rawCount: 1, validCount: 1 }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    expect(result.fetchEvidence).not.toHaveProperty("declaredCompleteness");
  });

  it.each([
    ["missing container", `<table>${row("one")}</table>`],
    ["multiple containers", `<section id="jobs"></section><section id="jobs"><table>${row("one")}</table></section>`],
    ["row outside container", `<section id="jobs"></section><table>${row("one")}</table>`],
    ["row overlapping an excluded partition", `<section id="jobs"><div class="campus"><table>${row("one")}</table></div></section>`],
    ["next-page control present", `<section id="jobs"><table>${row("one")}</table><a class="next" href="?page=2">next</a></section>`],
    ["redacted response body", `<section id="jobs"><p>password=secret</p><table>${row("one")}</table></section>`]
  ])("fails static official list evidence when %s", async (_label, body) => {
    const plan = {
      ...base,
      table: {
        ...base.table,
        staticPublicList: {
          containerSelector: "#jobs",
          nextControlSelector: "#jobs .next",
          excludedPartitionSelectors: ["#jobs .campus"]
        }
      }
    } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, body)
    })(plan);

    expect(result).toMatchObject({ ok: false, failureReason: "HTML_STATIC_PUBLIC_LIST_INVALID" });
    expect(result).not.toHaveProperty("fetchEvidence.declaredCompleteness");
  });

  it("fails a static official list when exact duplicate rows are present", async () => {
    const duplicate = row("same");
    const plan = {
      ...base,
      table: {
        ...base.table,
        staticPublicList: { containerSelector: "#jobs", nextControlSelector: "#jobs .next" }
      }
    } as SourceCrawlPlan;
    const result = await createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, `<section id="jobs"><table>${duplicate}${duplicate}</table></section>`)
    })(plan);

    expect(result).toMatchObject({
      ok: false,
      failureReason: "HTML_PAGINATION_EVIDENCE_UNSAFE",
      fetchEvidence: { fetchCounts: { rawCount: 2, validCount: 1, validationDiscardCount: 1 } }
    });
    expect(result).not.toHaveProperty("fetchEvidence.declaredCompleteness");
  });

  it("requires an exact official empty marker before certifying a static-list zero", async () => {
    const withoutMarker = {
      ...base,
      table: {
        ...base.table,
        staticPublicList: { containerSelector: "#jobs", nextControlSelector: "#jobs .next" }
      }
    } as SourceCrawlPlan;
    const withMarker = {
      ...base,
      table: {
        ...base.table,
        staticPublicList: {
          containerSelector: "#jobs",
          nextControlSelector: "#jobs .next",
          explicitEmptyState: { selector: "#jobs .empty", pattern: "^No public positions$" }
        }
      }
    } as SourceCrawlPlan;
    const fetchBody = (body: string) => createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async request => at(request, body)
    });

    const unlabeled = await fetchBody(`<section id="jobs"></section>`)(withoutMarker);
    const wrongMarker = await fetchBody(`<section id="jobs"><p class="empty">Temporarily unavailable</p></section>`)(withMarker);
    const exactZero = await fetchBody(`<section id="jobs"><p class="empty">No public positions</p></section>`)(withMarker);

    expect(unlabeled).toMatchObject({ ok: false, failureReason: "HTML_STATIC_PUBLIC_LIST_INVALID" });
    expect(wrongMarker).toMatchObject({ ok: false, failureReason: "HTML_STATIC_PUBLIC_LIST_INVALID" });
    expect(exactZero).toMatchObject({
      ok: true,
      fetchEvidence: {
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: 0,
          extractorLocator: "tr.job",
          scope: "SOURCE"
        },
        pages: [{ declaredTotal: 0, termination: "EMPTY_PAGE", rawJobIds: [], validJobIds: [] }]
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    const crawled = await runSourceCrawl(withMarker, { fetch: async () => exactZero });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      jobs: [],
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 0 }
    });
  });
});
