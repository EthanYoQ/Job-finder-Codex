import { legacyBayerPlan } from "../helpers/legacyBayerPlan";
import { describe, expect, it } from "vitest";
import { createHttpHtmlSourceFetch, type HttpHtmlRequest, type HttpHtmlResponse } from "../../src/crawler/httpHtmlSourceFetch";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import { runSourceCrawl, supportsStrictOfficialTotalCertificate } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-07-15T00:00:00.000Z";
const row = (id: string) => `<tr class="job"><td class="title">${id}</td><td class="location">上海</td><td><a href="/${id}">详情</a><button data-job-id="${id}"></button></td></tr>`;
const response = (request: HttpHtmlRequest, body: string, contentType = "text/html; charset=utf-8"): HttpHtmlResponse => ({
  status: 200, body, finalUrl: request.url, contentType, capturedAt
});

function basePlan(table: Extract<SourceCrawlPlan, { adapterId: "html-table" }>["table"]): Extract<SourceCrawlPlan, { adapterId: "html-table" }> {
  return {
    adapterId: "html-table",
    executionAuthority: "STAGED",
    company: { id: "company", officialChineseName: "测试药企" },
    source: {
      id: "source", companyId: "company", kind: "SOCIAL", atsKind: "OFFICIAL_HTML",
      status: "VERIFIED_SCRAPABLE", officialEntryUrl: "https://jobs.example.test/search", officialChainEvidenceUrl: "https://jobs.example.test/search"
    },
    expectedChannels: [{ channelId: "source:source:default", kind: "SOCIAL" }],
    table
  };
}

async function evidenceFor(
  plan: Extract<SourceCrawlPlan, { adapterId: "html-table" }>,
  http: (request: HttpHtmlRequest) => Promise<HttpHtmlResponse>
): Promise<PersistentSourceFetchEvidence> {
  const result = await createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http })(plan);
  if (!result.ok || !result.fetchEvidence) throw new Error(result.ok ? "missing evidence" : result.failureReason);
  return result.fetchEvidence;
}

describe("independent strict HTML completeness proof", () => {
  it("promotes a canonical staged HTML source only after the independent replay passes", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-kelun-social");
    if (plan?.adapterId !== "html-table") throw new Error("missing canonical Kelun plan");
    const fetch = createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => response(request, `<div class="page"><a href="/social?r=&p=1%5E2&c=&d=&k=&PageIndex=1">1</a></div>
        <table class="jobsTable"><tr><td><a href="/socialxq?jobId=one">医学经理</a></td><td></td><td></td><td></td><td title="上海">上海</td></tr></table>`)
    });
    const fetched = await fetch(plan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error(fetched.ok ? "missing evidence" : fetched.failureReason);
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);

    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", completenessEvidenceKind: "OFFICIAL_TOTAL_PAGES" }
    });
  });

  it("accepts Kelun total pages declared only on the entry page while still requiring every page", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-kelun-social");
    if (plan?.adapterId !== "html-table") throw new Error("missing canonical Kelun plan");
    const fetch = createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => {
        const page = Number(new URL(request.url).searchParams.get("PageIndex") ?? "1");
        const linkedPages = page === 1 ? [1, 2, 3] : page === 2 ? [1, 3] : [1, 2];
        const pagination = `<div class="page">${linkedPages
          .map(value => `<a href="/social?r=&p=1%5E2&c=&d=&k=&PageIndex=${value}">${value}</a>`).join("")}
          <a class="now" href="javascript:void(0);">${page}</a></div>`;
        return response(request, `${pagination}<table class="jobsTable"><tr><td><a href="/socialxq?jobId=${page}">职位 ${page}</a></td><td></td><td></td><td></td><td title="上海">上海</td></tr></table>`);
      }
    });
    const fetched = await fetch(plan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error(fetched.ok ? "missing evidence" : fetched.failureReason);

    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);

    const entryTotalTampered = structuredClone(fetched.fetchEvidence);
    entryTotalTampered.artifacts[0]!.body = String(entryTotalTampered.artifacts[0]!.body)
      .replace('<a href="/social?r=&p=1%5E2&c=&d=&k=&PageIndex=3">3</a>', "");
    expect(validateStrictHtmlCompletenessProof(plan, entryTotalTampered)).toBe(false);

    const laterPagerExceedsEntry = structuredClone(fetched.fetchEvidence);
    laterPagerExceedsEntry.artifacts[2]!.body = String(laterPagerExceedsEntry.artifacts[2]!.body)
      .replace('PageIndex=2', 'PageIndex=4');
    expect(validateStrictHtmlCompletenessProof(plan, laterPagerExceedsEntry)).toBe(false);
  });

  it("replays an ordinary official page total and rejects body or URL tampering", async () => {
    const plan = basePlan({
      rowSelector: "tr.job",
      fields: {
        sourceJobId: { selector: "button", attribute: "data-job-id" },
        officialTitle: { selector: ".title" }, officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { selector: ".location" }
      },
      completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
      pagination: {
        totalPagesSelector: "#results", totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page", maxPages: 3
      }
    });
    const fetch = createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http: async request => {
      const page = new URL(request.url).searchParams.get("page") ?? "1";
      return response(request, `<div id="results" data-total-pages="3"></div><table>${row(page)}</table>`);
    }});
    const fetched = await fetch(plan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error(fetched.ok ? "missing evidence" : fetched.failureReason);
    const evidence = fetched.fetchEvidence;
    expect(validateStrictHtmlCompletenessProof(plan, evidence)).toBe(true);

    const changedBody = structuredClone(evidence);
    changedBody.artifacts[1]!.body = String(changedBody.artifacts[1]!.body).replace("data-total-pages=\"3\"", "data-total-pages=\"2\"");
    expect(validateStrictHtmlCompletenessProof(plan, changedBody)).toBe(false);

    const changedUrl = structuredClone(evidence);
    changedUrl.artifacts[1]!.requestedUrl = "https://jobs.example.test/search?page=99";
    changedUrl.artifacts[1]!.finalUrl = "https://jobs.example.test/search?page=99";
    expect(validateStrictHtmlCompletenessProof(plan, changedUrl)).toBe(false);
  });

  it("derives exact pages from a repeated official job total and rejects total drift", async () => {
    const plan = basePlan({
      rowSelector: "tr.job",
      fields: {
        sourceJobId: { selector: "button", attribute: "data-job-id" },
        officialTitle: { selector: ".title" }, officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { selector: ".location" }
      },
      completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
      pagination: {
        totalPagesSelector: "body", totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page", pageSize: 2, maxPages: 3,
        expectedJobCountSelector: "#count",
        expectedJobCountPattern: "Showing\\s+\\d+\\s+to\\s+\\d+\\s+of\\s+(\\d+)\\s+Jobs"
      }
    });
    const fetch = createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http: async request => {
      const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
      const rows = page === 1 ? `${row("one")}${row("two")}` : row("three");
      const range = page === 1 ? "1 to 2" : "3 to 3";
      return response(request, `<div id="count">Showing ${range} of 3 Jobs</div><table>${rows}</table>`);
    }});
    const fetched = await fetch(plan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error(fetched.ok ? "missing evidence" : fetched.failureReason);

    expect(fetched.fetchEvidence.declaredCompleteness).toMatchObject({
      kind: "OFFICIAL_TOTAL_COUNT",
      scope: "SOURCE",
      value: 3
    });
    expect(supportsStrictOfficialTotalCertificate(plan)).toBe(true);
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);

    const changedTotal = structuredClone(fetched.fetchEvidence);
    changedTotal.artifacts[1]!.body = String(changedTotal.artifacts[1]!.body).replace("of 3 Jobs", "of 5 Jobs");
    expect(validateStrictHtmlCompletenessProof(plan, changedTotal)).toBe(false);
  });

  it("replays an official zero-job total without inventing rows", async () => {
    const plan = basePlan({
      rowSelector: "a.job",
      fields: {
        officialTitle: { selector: ".title" },
        officialUrl: { selector: "a.job", attribute: "href" },
        locationRaw: { selector: ".location" }
      },
      completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
      pagination: {
        totalPagesSelector: "body",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page",
        pageSize: 25,
        maxPages: 5,
        expectedJobCountSelector: "body",
        expectedJobCountPattern: "Showing\\s+\\d+\\s+to\\s+\\d+\\s+of\\s+(\\d+)\\s+results"
      }
    });
    const fetch = createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => response(
        request,
        '<main>Showing 0 to 0 of 0 results</main>'
      )
    });
    const fetched = await fetch(plan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error(fetched.ok ? "missing evidence" : fetched.failureReason);

    expect(fetched.fetchEvidence.pages).toHaveLength(1);
    expect(fetched.fetchEvidence.fetchCounts).toMatchObject({ rawCount: 0, validCount: 0 });
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      jobs: [],
      truth: { completenessVerified: false },
      observation: {
        structuredJobCount: 0,
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        expectedJobCount: 0
      }
    });
  });

  it("treats Bayer's exact China empty marker as zero instead of replaying global fallback rows", async () => {
    const plan = legacyBayerPlan();
    if (plan?.adapterId !== "html-table") throw new Error("missing historical Bayer plan");
    const body = `<label>当前没有符合 "<span class="attention securitySearchString">China</span>" 的空缺职位。</label>
      <div id="searchresults" aria-label="职位搜索结果列表。第 1 页，共 1 页。"><table><tbody>
        <tr><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Warsaw-Global/1/">Global</a></td>
          <td class="colLocation">Warsaw, PL</td></tr>
      </tbody></table></div><div class="paginationLabel">显示 1 到 10，共 10</div>`;
    const fetched = await createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => response(request, body)
    })(plan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error(fetched.ok ? "missing evidence" : fetched.failureReason);

    expect(fetched.fetchEvidence).toMatchObject({
      declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 0 },
      fetchCounts: { rawCount: 0, validCount: 0 },
      pages: [{ rawJobIds: [], validJobIds: [], termination: "EMPTY_PAGE" }]
    });
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
  });

  it("accepts Novartis' current Huhehaote transliteration with a mainland province anchor", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novartis-social");
    if (plan?.adapterId !== "html-table") throw new Error("missing canonical Novartis plan");
    const body = `<div class="view-header">Showing 1 results</div><nav class="pagination">
        <a class="page-link active" title="Page 1 active out of 1 pages">1</a>
        <a class="page-link btn disabled" rel="next" title="Go to next page"></a>
      </nav><table class="views-table"><tbody><tr>
        <td class="views-field-field-job-title"><a href="/careers/career-search/job/details/one">医学经理</a></td>
        <td class="views-field-field-job-work-location">Huhehaote (Neimenggu Province)</td>
      </tr></tbody></table>`;
    const evidence = await evidenceFor(plan, async request => response(request, body));

    expect(validateStrictHtmlCompletenessProof(plan, evidence)).toBe(true);
  });

  it("reconstructs every configured TalentBrew channel request and rejects an extra query", async () => {
    const plan = basePlan({
      rowSelector: "tr.job",
      fields: {
        sourceJobId: { selector: "button", attribute: "data-job-id" },
        officialTitle: { selector: ".title" }, officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { selector: ".location" }
      },
      completenessProof: { kind: "CONFIGURED_CHANNEL_TRAVERSAL" },
      pagination: {
        totalPagesSelector: "#search-results", totalPagesAttribute: "data-total-pages",
        pageSearchParam: "CurrentPage", maxPages: 2, ajaxMode: "talentbrew",
        talentbrewScope: {
          requiredActiveFacet: { id: "cn", facetType: 2, descriptor: "China" },
          allowedPartitions: [
            { channelId: "fixed", id: "Fixed", facetType: 5, fieldName: "job_type", descriptor: "Fixed" },
            { channelId: "regular", id: "Regular", facetType: 5, fieldName: "job_type", descriptor: "Regular" }
          ],
          excludedPartitions: [
            { id: "Student", facetType: 5, fieldName: "job_type", descriptor: "Student" }
          ]
        }
      }
    });
    plan.expectedChannels = [
      { channelId: "fixed", kind: "SOCIAL" },
      { channelId: "regular", kind: "SOCIAL" }
    ];
    const entry = `<section id="search-results" data-ajax-url="/results" data-facet-term="cn" data-facet-type="2"
      data-total-pages="2" data-total-job-results="4" data-records-per-page="1"></section>
      <div id="search-filters"><div data-enabled="false"><input class="filter-checkbox" checked data-id="cn" data-facet-type="2" data-count="4" data-display="China" data-field-name="" /></div>
      <div data-enabled="true"><input class="filter-checkbox" data-id="Fixed" data-facet-type="5" data-count="1" data-display="Fixed" data-field-name="job_type" /></div>
      <div data-enabled="true"><input class="filter-checkbox" data-id="Regular" data-facet-type="5" data-count="1" data-display="Regular" data-field-name="job_type" /></div>
      <div data-enabled="true"><input class="filter-checkbox" data-id="Student" data-facet-type="5" data-count="2" data-display="Student" data-field-name="job_type" /></div></div>`;
    const talentResponse = (results: string) => JSON.stringify({
      filters: '<section id="search-filters"><input class="filter-checkbox" /></section>',
      hasContent: false,
      hasJobs: true,
      results
    });
    const requestedPartitions: string[] = [];
    const evidence = await evidenceFor(plan, async request => {
      if (!request.url.includes("/results")) return response(request, entry);
      const url = new URL(request.url);
      const channel = [...url.searchParams.entries()].find(([key]) => key.startsWith("FacetFilters[1]") && key.endsWith(".Display"))?.[1] ?? "missing";
      requestedPartitions.push(channel);
      const id = channel.toLowerCase();
      return response(request, talentResponse(
        `<section id="search-results" data-current-page="1" data-total-pages="1" data-total-job-results="1" data-records-per-page="1"><table>${row(id)}</table></section>`
      ), "application/json");
    });
    expect(validateStrictHtmlCompletenessProof(plan, evidence)).toBe(true);
    expect(requestedPartitions).toEqual(["Fixed", "Regular"]);

    const staleEntryCounts = entry
      .replace('data-count="1" data-display="Fixed"', 'data-count="2" data-display="Fixed"')
      .replace('data-count="2" data-display="Student"', 'data-count="1" data-display="Student"');
    const staleEntryEvidence = await evidenceFor(plan, async request => {
      if (!request.url.includes("/results")) return response(request, staleEntryCounts);
      const url = new URL(request.url);
      const channel = [...url.searchParams.entries()].find(([key]) =>
        key.startsWith("FacetFilters[1]") && key.endsWith(".Display"))?.[1] ?? "missing";
      return response(request, talentResponse(
        `<section id="search-results" data-current-page="1" data-total-pages="1" data-total-job-results="1" data-records-per-page="1"><table>${row(channel.toLowerCase())}</table></section>`
      ), "application/json");
    });
    expect(validateStrictHtmlCompletenessProof(plan, staleEntryEvidence)).toBe(true);

    for (const mutate of [
      (record: Record<string, unknown>) => { record.hasJobs = false; },
      (record: Record<string, unknown>) => { record.filters = '<script>alert(1)</script>'; },
      (record: Record<string, unknown>) => { record.unexpected = true; }
    ]) {
      const schemaDrift = structuredClone(evidence);
      const record = JSON.parse(String(schemaDrift.artifacts[1]!.body)) as Record<string, unknown>;
      mutate(record);
      schemaDrift.artifacts[1]!.body = JSON.stringify(record);
      expect(validateStrictHtmlCompletenessProof(plan, schemaDrift)).toBe(false);
    }

    const changed = structuredClone(evidence);
    changed.artifacts[1]!.requestedUrl += "&unexpected=true";
    changed.artifacts[1]!.finalUrl += "&unexpected=true";
    expect(validateStrictHtmlCompletenessProof(plan, changed)).toBe(false);

    const entryWithUnconfiguredPartition = entry
      .replace('data-total-job-results="4"', 'data-total-job-results="5"')
      .replace('data-count="4" data-display="China"', 'data-count="5" data-display="China"')
      .replace('</div></div>', `<input class="filter-checkbox" data-id="Apprentice" data-facet-type="5"
        data-count="1" data-display="Apprentice" data-field-name="job_type" /></div></div>`);
    const omittedPartition = await createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http: async request => {
      if (!request.url.includes("/results")) return response(request, entryWithUnconfiguredPartition);
      const url = new URL(request.url);
      const channel = [...url.searchParams.entries()].find(([key]) =>
        key.startsWith("FacetFilters[1]") && key.endsWith(".Display"))?.[1] ?? "missing";
      return response(request, talentResponse(
        `<section id="search-results" data-current-page="1" data-total-pages="1"
          data-total-job-results="1" data-records-per-page="1"><table>${row(channel.toLowerCase())}</table></section>`
      ), "application/json");
    }})(plan);
    expect(omittedPartition.ok).toBe(false);
  });

  it.each([
    ["source-takeda-china-social", "h2.title", ".location", "https://jobs.takeda.com/job/shanghai/role/1113/1"]
  ] satisfies ReadonlyArray<readonly [string, string, string, string]>)("replays %s as one unpartitioned TalentBrew China total", async (
    sourceId,
    titleSelector,
    locationSelector,
    jobUrl
  ) => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
    if (plan?.adapterId !== "html-table") throw new Error(`missing ${sourceId} plan`);
    const entry = `<section id="search-results" data-ajax-url="/search-results" data-facet-term="1814991"
      data-facet-type="2" data-total-pages="2" data-total-job-results="2" data-records-per-page="1"></section>
      <section id="search-filters"><div data-enabled="false"><input class="filter-checkbox" checked
        data-id="1814991" data-facet-type="2" data-count="2" data-display="China" data-field-name="" /></div></section>`;
    const talentResponse = (page: number) => {
      const title = titleSelector === "h2" ? `<h2>职位 ${page}</h2>` : `<h2 class="title">职位 ${page}</h2>`;
      const location = locationSelector === "span.job-location"
        ? '<span class="job-location">上海</span>'
        : '<span class="location">上海</span>';
      const results = `<section id="search-results" data-current-page="${page}" data-total-pages="2"
        data-total-job-results="2" data-records-per-page="1"><ul id="search-results-list"><li>
        <button class="js-save-job-btn" data-job-id="job-${page}"></button>${title}
        <a href="${jobUrl.replace(/\/1$/u, `/${page}`)}">详情</a>${location}</li></ul></section>`;
      return JSON.stringify({
        filters: '<section id="search-filters"><input class="filter-checkbox" /></section>',
        hasContent: false,
        hasJobs: true,
        results
      });
    };
    const fetched = await createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => request.url.includes("/search-results")
        ? response(request, talentResponse(Number(new URL(request.url).searchParams.get("CurrentPage"))), "application/json")
        : response(request, entry)
    })(plan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error(fetched.ok ? "missing evidence" : fetched.failureReason);

    expect(fetched.fetchEvidence.declaredCompleteness).toMatchObject({
      kind: "OFFICIAL_TOTAL_COUNT",
      value: 2,
      scope: "SOURCE"
    });
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);

    const changedTotal = structuredClone(fetched.fetchEvidence);
    const changedRecord = JSON.parse(String(changedTotal.artifacts[2]!.body)) as { results: string };
    changedRecord.results = changedRecord.results
      .replace('data-total-job-results="2"', 'data-total-job-results="3"');
    changedTotal.artifacts[2]!.body = JSON.stringify(changedRecord);
    expect(validateStrictHtmlCompletenessProof(plan, changedTotal)).toBe(false);
  });

  it.each([
    ["source-otsuka-china-social", `<script>document.cookie="auth_token=value"</script>
      <section class="container Box"><h2>热招岗位</h2><p>公司始终将人力资源开发置于战略核心地位。</p><p>联系我们：zhaopin@chinaotsuka.com.cn</p></section>`, "REDACTED"],
    ["source-sandoz-china-social", `<main><section class="elementor elementor-1709">
      <h2>招聘</h2><p>请警惕虚假职位信息</p></section></main>`, "EXACT"]
  ] as const)("does not certify %s warning or HR prose as an official zero", async (sourceId, body, representation) => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
    if (plan?.adapterId !== "html-table") throw new Error(`missing ${sourceId} plan`);
    const fetched = await createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => response(request, body)
    })(plan);
    expect(fetched).toMatchObject({ ok: false, failureReason: "HTML_STATIC_PUBLIC_LIST_INVALID" });
    if (!fetched.fetchEvidence) throw new Error("missing diagnostic evidence");
    expect(fetched.fetchEvidence).toMatchObject({
      fetchCounts: { rawCount: 0, validCount: 0 },
      artifacts: [{ bodyRepresentation: representation }],
      pages: [{ rawJobIds: [], validJobIds: [], termination: "FAILED" }]
    });
    expect(fetched.fetchEvidence.declaredCompleteness).toBeUndefined();
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(false);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      jobs: [],
      truth: { completenessVerified: false }
    });
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it("binds Tupu page offsets to the archived POST request contract", async () => {
    const plan = basePlan({
      rowSelector: "tr.job",
      fields: {
        sourceJobId: { selector: "button", attribute: "data-job-id" },
        officialTitle: { selector: ".title" }, officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { selector: ".location" }
      },
      completenessProof: { kind: "CONFIGURED_CHANNEL_TRAVERSAL" },
      pagination: {
        totalPagesSelector: "#pageTurnUl li:first-child", totalPagesAttribute: "data-total-pages",
        pageSearchParam: "offset", maxPages: 2, ajaxMode: "tupu360"
      }
    });
    plan.source.officialEntryUrl = "https://jobs.example.test/site/position?recruitmentType=2";
    plan.source.officialChainEvidenceUrl = plan.source.officialEntryUrl;
    const page = (body: string) => `<table>${body}</table><ul id="pageTurnUl"><li>共 2 页</li><li
      data-action="pageTurn" data-pagenum="2" data-pagemax="2">2</li></ul>`;
    const evidence = await evidenceFor(plan, async request => request.method === "POST"
      ? response(request, page(row("three")))
      : response(request, page(`${row("one")}${row("two")}`)));
    expect(validateStrictHtmlCompletenessProof(plan, evidence)).toBe(true);

    const changed = structuredClone(evidence);
    changed.artifacts[1]!.extractorLocator = changed.artifacts[1]!.extractorLocator.replace(/[0-9a-f]$/u, "0");
    expect(validateStrictHtmlCompletenessProof(plan, changed)).toBe(false);
  });
});
