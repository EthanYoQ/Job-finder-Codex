import { describe, expect, it } from "vitest";
import { createHttpHtmlSourceFetch, type HttpHtmlRequest, type HttpHtmlResponse } from "../../src/crawler/httpHtmlSourceFetch";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
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
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-fosun-pharma-social");
    if (plan?.adapterId !== "html-table") throw new Error("missing canonical Fosun plan");
    const fetch = createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => response(request, `<div class="page"><a href="/social/?PageIndex=1">1</a></div>
        <table><tr><td><a href="/socialxq?jobId=one">医学经理</a></td><td></td><td></td><td><a>上海</a></td></tr></table>`)
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
    const evidence = await evidenceFor(plan, async request => {
      const page = new URL(request.url).searchParams.get("page") ?? "1";
      return response(request, `<div id="results" data-total-pages="3"></div><table>${row(page)}</table>`);
    });
    expect(validateStrictHtmlCompletenessProof(plan, evidence)).toBe(true);

    const changedBody = structuredClone(evidence);
    changedBody.artifacts[1]!.body = String(changedBody.artifacts[1]!.body).replace("data-total-pages=\"3\"", "data-total-pages=\"2\"");
    expect(validateStrictHtmlCompletenessProof(plan, changedBody)).toBe(false);

    const changedUrl = structuredClone(evidence);
    changedUrl.artifacts[1]!.requestedUrl = "https://jobs.example.test/search?page=99";
    changedUrl.artifacts[1]!.finalUrl = "https://jobs.example.test/search?page=99";
    expect(validateStrictHtmlCompletenessProof(plan, changedUrl)).toBe(false);
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
          ]
        }
      }
    });
    plan.expectedChannels = [
      { channelId: "fixed", kind: "SOCIAL" },
      { channelId: "regular", kind: "SOCIAL" }
    ];
    const entry = `<section id="search-results" data-ajax-url="/results" data-facet-term="cn" data-facet-type="2"
      data-total-pages="2" data-total-job-results="2" data-records-per-page="1"></section>
      <div id="search-filters"><div data-enabled="false"><input class="filter-checkbox" checked data-id="cn" data-facet-type="2" data-count="2" data-display="China" data-field-name="" /></div>
      <div data-enabled="true"><input class="filter-checkbox" data-id="Fixed" data-facet-type="5" data-count="1" data-display="Fixed" data-field-name="job_type" /></div>
      <div data-enabled="true"><input class="filter-checkbox" data-id="Regular" data-facet-type="5" data-count="1" data-display="Regular" data-field-name="job_type" /></div></div>`;
    const evidence = await evidenceFor(plan, async request => {
      if (!request.url.includes("/results")) return response(request, entry);
      const url = new URL(request.url);
      const channel = [...url.searchParams.entries()].find(([key]) => key.startsWith("FacetFilters[1]") && key.endsWith(".Display"))?.[1] ?? "missing";
      const id = channel.toLowerCase();
      return response(request, JSON.stringify({
        results: `<section id="search-results" data-current-page="1" data-total-pages="1" data-total-job-results="1" data-records-per-page="1"><table>${row(id)}</table></section>`
      }), "application/json");
    });
    expect(validateStrictHtmlCompletenessProof(plan, evidence)).toBe(true);

    const changed = structuredClone(evidence);
    changed.artifacts[1]!.requestedUrl += "&unexpected=true";
    changed.artifacts[1]!.finalUrl += "&unexpected=true";
    expect(validateStrictHtmlCompletenessProof(plan, changed)).toBe(false);
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
    const page = (body: string) => `<table>${body}</table><ul id="pageTurnUl"><li>共 2 页</li><li onclick="pageTurn(2,2)">2</li></ul>`;
    const evidence = await evidenceFor(plan, async request => request.method === "POST"
      ? response(request, page(row("three")))
      : response(request, page(`${row("one")}${row("two")}`)));
    expect(validateStrictHtmlCompletenessProof(plan, evidence)).toBe(true);

    const changed = structuredClone(evidence);
    changed.artifacts[1]!.extractorLocator = changed.artifacts[1]!.extractorLocator.replace(/[0-9a-f]$/u, "0");
    expect(validateStrictHtmlCompletenessProof(plan, changed)).toBe(false);
  });
});
