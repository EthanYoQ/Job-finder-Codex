import { describe, expect, it } from "vitest";
import {
  createHttpHtmlSourceFetch,
  type HttpHtmlRequest,
  type HttpHtmlResponse
} from "../../src/crawler/httpHtmlSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import { candidateCompanies } from "../../src/data/companyRegistry";

type HtmlPlan = Extract<SourceCrawlPlan, { adapterId: "html-table" }>;

const capturedAt = "2026-07-16T00:00:00.000Z";

function livzonPlan(): HtmlPlan {
  const plan = getPlanBySourceId(
    buildStagedSourceCrawlPlans(candidateCompanies),
    "source-livzon-social"
  );
  if (plan?.adapterId !== "html-table") throw new Error("Missing Livzon HTML plan");
  return plan;
}

function response(request: HttpHtmlRequest, body: string): HttpHtmlResponse {
  return {
    status: 200,
    body,
    finalUrl: request.url,
    contentType: "text/html; charset=utf-8",
    capturedAt
  };
}

function pageUrl(page: number): string {
  return `https://www.livzon.com.cn/Social_list/p-${(page - 1) * 6}-6.html`;
}

function href(page: number): string {
  return `/Social_list/p-${(page - 1) * 6}-6.html`;
}

function jobRow(id: string, marker = "岗位职责") {
  return `<div class="cbox-1 p_loopitem"><div class="e_container-2 s_layout"><div class="cbox-2-0 p_item">
    <p class="e_text-5 s_title"><a href="/product/${id}.html">职位 ${id}</a></p>
    <div class="e_richText-11 s_title clearfix">${marker} 负责药品研发。 任职要求 本科及以上学历。</div>
  </div></div></div>`;
}

function nonJobRow(id: string) {
  return `<div class="cbox-1 p_loopitem"><div class="e_container-2 s_layout"><div class="cbox-2-0 p_item">
    <p class="e_text-5 s_title"><a href="/product/${id}.html">产品 ${id}</a></p>
    <div class="e_richText-11 s_title clearfix">【药品名称】产品说明。</div>
  </div></div></div>`;
}

function controls(page: number, total: number, options: {
  currentOverride?: number;
  nextOverride?: number;
  forceDisabledNext?: boolean;
  forceEnabledTerminalNext?: boolean;
} = {}) {
  const current = options.currentOverride ?? page;
  const visible = [...new Set([1, total, page - 1, page, page + 1])]
    .filter((value) => value >= 1 && value <= total)
    .sort((left, right) => left - right);
  const pages = visible.map((value) => value === current
    ? `<a class="page_a page_num current" href="javascript:;">${value}</a>`
    : `<a class="page_a page_num" href="${href(value)}">${value}</a>`
  ).join("");
  const previous = page === 1
    ? `<a href="${href(1)}" class="page_a page_prev disabled">&lt;</a>`
    : `<a href="${href(page - 1)}" class="page_a page_prev">&lt;</a>`;
  const intendedNext = options.nextOverride ?? Math.min(total, page + 1);
  const terminalEnabled = page === total && options.forceEnabledTerminalNext === true;
  const nextDisabled = options.forceDisabledNext === true || (page === total && !terminalEnabled);
  const next = `<a href="${href(intendedNext)}" class="page_a page_next${nextDisabled ? " disabled" : ""}">&gt;</a>`;
  return `<div class="p_page"><div class="page_con">${previous}${pages}${next}</div></div>`;
}

function pageHtml(page: number, total: number, options: Parameters<typeof controls>[2] & {
  rows?: string;
} = {}) {
  const rowCount = page === total ? 5 : 6;
  const rows = options.rows ?? Array.from(
    { length: rowCount },
    (_, index) => jobRow(`${page}-${index + 1}`)
  ).join("");
  return `<div id="c_product_list_041-17354888079290"><div class="e_loop-1 s_list"><div class="p_list">${rows}</div>${controls(page, total, options)}</div></div>`;
}

async function fetchFixture(
  plan: HtmlPlan,
  total: number,
  pageBody: (page: number) => string = (page) => pageHtml(page, total)
) {
  const requests: string[] = [];
  const fetched = await createHttpHtmlSourceFetch({
    now: () => new Date(capturedAt),
    http: async request => {
      requests.push(request.url);
      return response(request, pageBody(requests.length));
    }
  })(plan);
  return { fetched, requests };
}

describe("Livzon official social recruitment HTML", () => {
  it("binds the official offset entry and generic maintainable parsing policy in the company profile", () => {
    const plan = livzonPlan();
    expect(plan.source).toMatchObject({
      officialEntryUrl: "https://www.livzon.com.cn/Social_list/p-0-6.html",
      officialChainEvidenceUrl: "https://www.livzon.com.cn/Social_list/p-0-6.html",
      status: "VERIFIED_SCRAPABLE"
    });
    expect(plan.table).toMatchObject({
      rowSelector: "#c_product_list_041-17354888079290 .p_list > .p_loopitem",
      rowFilter: {
        selector: ".e_richText-11",
        pattern: "^(?:岗位职责|任职资格|任职要求)",
        requireAllCandidatesForCompleteness: true
      },
      completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
      fields: {
        officialTitle: { selector: ".e_text-5 a" },
        officialUrl: { selector: ".e_text-5 a", attribute: "href" },
        locationRaw: { value: "未披露" }
      },
      pagination: {
        pageUrlTemplate: "https://www.livzon.com.cn/Social_list/p-{page}-6.html",
        pageSearchParamMode: "offset",
        pageSize: 6,
        strictPageControls: {
          containerSelector: ".p_page .page_con",
          pageNumberSelector: "a.page_num",
          currentPageSelector: "a.page_num.current",
          previousPageSelector: "a.page_prev",
          nextPageSelector: "a.page_next",
          disabledClass: "disabled",
          currentHref: "javascript:;"
        }
      }
    });
    expect(plan.table.pagination?.maxPages).toBeGreaterThan(21);
  });

  it("proves a small three-page fixture and visits offsets 0, 6, 12", async () => {
    const plan = livzonPlan();
    const { fetched, requests } = await fetchFixture(plan, 3);
    expect(requests).toEqual([pageUrl(1), pageUrl(2), pageUrl(3)]);
    expect(fetched).toMatchObject({
      ok: true,
      paginationEvaluation: { safeCompleteness: true, derivedAnomalyCodes: [] },
      fetchEvidence: { pages: [{ requestedOffset: 0 }, { requestedOffset: 6 }, { requestedOffset: 12 }] }
    });
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected Livzon fixture evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 17, completenessStatus: "VERIFIED" }
    });
  });

  it("derives and proves the current 21-page fixture without hard-coding 21 in execution config", async () => {
    const plan = livzonPlan();
    const { fetched, requests } = await fetchFixture(plan, 21);
    expect(requests).toEqual(Array.from({ length: 21 }, (_, index) => pageUrl(index + 1)));
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected 21-page Livzon evidence");
    expect(fetched.fetchEvidence.pages.map((page) => page.requestedOffset))
      .toEqual(Array.from({ length: 21 }, (_, index) => index * 6));
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 125, completenessStatus: "VERIFIED" }
    });
  });

  it.each([
    ["current page drift", (page: number, total: number) => pageHtml(page, total, page === 2 ? { currentOverride: 3 } : {})],
    ["skipped next offset", (page: number, total: number) => pageHtml(page, total, page === 2 ? { nextOverride: 4 } : {})],
    ["premature terminal", (page: number, total: number) => pageHtml(page, total, page === 2 ? { forceDisabledNext: true } : {})],
    ["extra terminal next", (page: number, total: number) => pageHtml(page, total, page === total ? { forceEnabledTerminalNext: true } : {})]
  ])("rejects %s", async (_name, body) => {
    const plan = livzonPlan();
    const { fetched } = await fetchFixture(plan, 3, (page) => body(page, 3));
    if (fetched.ok && fetched.fetchEvidence) {
      expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(false);
    } else {
      expect(fetched.ok).toBe(false);
    }
  });

  it("does not certify or emit a product row mixed into the official list", async () => {
    const plan = livzonPlan();
    const { fetched } = await fetchFixture(plan, 3, (page) => pageHtml(page, 3, {
      rows: `${Array.from(
        { length: page === 3 ? 5 : 6 },
        (_, index) => jobRow(`${page}-job-${index + 1}`)
      ).join("")}${page === 1 ? nonJobRow("product") : ""}`
    }));
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected mixed-scope evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(false);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled.jobs).toHaveLength(17);
    expect(crawled.jobs.some((job) => job.officialTitle === "产品 product")).toBe(false);
    expect(crawled.truth.completenessVerified).toBe(false);
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
  });
});
