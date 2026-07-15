import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const capturedAt = "2026-07-15T00:00:00.000Z";
const plans = buildStagedSourceCrawlPlans(candidateCompanies);

function planFor(sourceId: string): HtmlPlan {
  const plan = getPlanBySourceId(plans, sourceId);
  if (plan?.adapterId !== "html-table") throw new Error(`Missing HTML plan ${sourceId}`);
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

async function fetchHtml(
  plan: HtmlPlan,
  http: (request: HttpHtmlRequest) => Promise<HttpHtmlResponse>
) {
  return createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http })(plan);
}

function apeloaRow(id: string, location = "浙江") {
  return `<div class="ev"><div class="table99 name"><div><p>${id}</p></div><div><p>社招</p></div><div><p>研发</p></div><div><p>${location}</p></div></div><div class="down"><div class="mailto"><p>${id}@example.test</p></div></div></div>`;
}

function apeloaHtml(options: { labels?: [string, string]; pagination?: boolean } = {}) {
  const labels = options.labels ?? ["社会招聘", "校园招聘"];
  return `<section class="join2"><div class="tabbar"><div class="ev"><h2>${labels[0]}</h2></div><div class="ev"><h2>${labels[1]}</h2></div></div>
    <div class="tab-content"><div class="main">${apeloaRow("社会职位一")}${apeloaRow("社会职位二")}</div>
    <div class="main">${apeloaRow("校园职位")}</div></div>${options.pagination ? "<nav class='pagination'></nav>" : ""}</section>
    <script>function setCookie(name, value) { document.cookie = name + '=' + escape(value) + ';path=/'; }</script>`;
}

function astellasPdf(id: string) {
  return `<a href="/content/dam/astellas-com/global/zh/careers/${id}.pdf"><span>${id}</span><span>arrow_forward</span></a>`;
}

function astellasHtml(options: { duplicateContainer?: boolean; outsidePdf?: boolean; pagination?: boolean; zero?: boolean } = {}) {
  const rows = options.zero ? "" : `${astellasPdf("China External Innovation Lead")}${astellasPdf("Data Management Lead")}`;
  const accordion = `<div class="cmp-accordion" data-cmp-is="accordion">${rows}</div>`;
  return `${accordion}${options.duplicateContainer ? accordion : ""}${options.outsidePdf ? astellasPdf("Outside") : ""}${options.pagination ? "<nav class='pagination'></nav>" : ""}`;
}

function bayerRow(id: number, location = "ShangHai, ShangHai, CN") {
  return `<tr><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/${id}">职位 ${id}</a></td><td class="colLocation">${location}</td></tr>`;
}

function bayerPage(page: number, total = 12, locationOverride?: string) {
  const start = page === 1 ? 1 : 11;
  const end = page === 1 ? 10 : 12;
  const rows = Array.from({ length: end - start + 1 }, (_, index) =>
    bayerRow(start + index, index === 0 && locationOverride ? locationOverride : undefined)
  ).join("");
  return `<div id="searchresults" aria-label="搜索结果： China. 第 ${page} 页，共 2 页，结果 ${start} 到 ${end} / ${total}"><table><tbody>${rows}</tbody></table></div>
    <div class="paginationLabel">结果 ${start} – ${end} / ${total}</div>`;
}

function novartisRow(id: string, title = `职位 ${id}`, location = "中国") {
  return `<tr><td class="views-field-field-job-title"><a href="/careers/career-search/job/details/${id}">${title}</a></td><td class="views-field-field-job-work-location">${location}</td></tr>`;
}

function novartisPage(
  active: number,
  ids: readonly string[],
  options: {
    activeOverride?: number;
    nextEnabledOnLast?: boolean;
    titles?: Record<string, string>;
    locations?: Record<string, string>;
  } = {}
) {
  const total = 3;
  const renderedActive = options.activeOverride ?? active;
  const labels = Array.from({ length: total }, (_, index) => {
    const page = index + 1;
    const title = page === renderedActive
      ? `page ${page} active out of ${total} pages`
      : `page ${page} out of ${total} pages`;
    return `<li class="page-item${page === renderedActive ? " active" : ""}"><a class="page-link" title="${title}"${page === renderedActive ? "" : ` href="?page=${page - 1}"`}>${page}</a></li>`;
  }).join("");
  const final = active === total;
  const next = final && !options.nextEnabledOnLast
    ? `<li class="page-item pager__item--next"><a href="" title="Go to next page" rel="next" class="page-link btn disabled">Next</a></li>`
    : `<li class="page-item pager__item--next"><a href="?page=${active}" title="Go to next page" rel="next" class="page-link">Next</a></li>`;
  const rows = ids.map((id) => novartisRow(id, options.titles?.[id], options.locations?.[id])).join("");
  return `<table class="views-table"><tbody>${rows}</tbody></table><ul class="pagination">${labels}${next}</ul>`;
}

describe("four audited official HTML sources", () => {
  it("binds each audited source to its fail-closed plan policy", () => {
    expect(planFor("source-apeloa-social").table).toMatchObject({
      rowSelector: ".join2 .tab-content > .main:first-child > .ev",
      completenessProof: { kind: "STATIC_PUBLIC_LIST", sourcePolicy: "APELOA_SOCIAL_TABS_V1" },
      staticPublicList: {
        containerSelector: ".join2 .tab-content > .main:first-child",
        excludedPartitionSelectors: [".join2 .tab-content > .main:nth-child(2)"]
      }
    });
    expect(planFor("source-apeloa-social").table.staticPublicList)
      .not.toHaveProperty("allowRedactedPositivePartial");

    expect(planFor("source-astellas-china-social").table).toMatchObject({
      rowSelector: "a[href$='.pdf'][href*='/global/zh/']",
      completenessProof: { kind: "STATIC_PUBLIC_LIST", sourcePolicy: "ASTELLAS_CHINA_PDF_ACCORDION_V1" },
      staticPublicList: { containerSelector: ".cmp-accordion[data-cmp-is='accordion']" },
      fields: { officialTitle: { selector: "span:first-child" } }
    });
    expect(planFor("source-astellas-china-social").table).not.toHaveProperty("pagination");

    expect(planFor("source-bayer-healthcare-social").table).toMatchObject({
      completenessProof: { kind: "OFFICIAL_TOTAL_PAGES", sourcePolicy: "BAYER_CHINA_SUCCESSFACTORS_V1" },
      pagination: {
        totalPagesSelector: "#searchresults[aria-label]",
        totalPagesAttribute: "aria-label",
        totalPagesPattern: "共\\s*([1-9]\\d*)\\s*页",
        pageSearchParam: "startrow",
        pageSearchParamMode: "offset",
        pageSize: 10,
        maxPages: 100,
        expectedJobCountSelector: ".paginationLabel",
        expectedJobCountPattern: "\\s*(\\d+)\\s*$"
      }
    });

    expect(planFor("source-novartis-social").table).toMatchObject({
      completenessProof: { kind: "OFFICIAL_TOTAL_PAGES", sourcePolicy: "NOVARTIS_CHINA_SLIDING_WINDOW_V1" },
      pagination: {
        totalPagesSelector: ".pagination .page-link[title*='out of'][title*='pages']",
        totalPagesAttribute: "title",
        totalPagesPattern: "out of\\s+([1-9]\\d*)\\s+pages",
        totalPagesMode: "max",
        pageSearchParam: "page",
        pageNumberOffset: -1,
        maxPages: 20,
        officialWindowMode: "NOVARTIS_PAGE_WINDOW_V1"
      }
    });
  });

  it("verifies only Apeloa social rows, keeps a generic cookie setter exact, and rejects tab drift", async () => {
    const plan = planFor("source-apeloa-social");
    const fetched = await fetchHtml(plan, async request => response(request, apeloaHtml()));
    expect(fetched).toMatchObject({
      ok: true,
      fetchEvidence: {
        artifacts: [{ bodyRepresentation: "EXACT" }],
        fetchCounts: { rawCount: 2, validCount: 2 }
      }
    });
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected Apeloa evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 2, completenessStatus: "VERIFIED" }
    });
    expect(crawled.jobs.map((job) => job.officialTitle)).toEqual(["社会职位一", "社会职位二"]);

    for (const body of [
      apeloaHtml({ labels: ["校园招聘", "社会招聘"] }),
      apeloaHtml({ pagination: true })
    ]) {
      const drifted = await fetchHtml(plan, async request => response(request, body));
      if (drifted.ok && drifted.fetchEvidence) {
        expect(validateStrictHtmlCompletenessProof(plan, drifted.fetchEvidence)).toBe(false);
      } else {
        expect(drifted.ok).toBe(false);
      }
    }
  });

  it("keeps the old 19-row Apeloa fixture noncertifying because its tab labels were not archived", async () => {
    const plan = planFor("source-apeloa-social");
    const html = readFileSync(resolve(
      process.cwd(),
      "src/crawler/fixtures/static-official-sources/apeloa.html"
    ), "utf8");
    const fetched = await fetchHtml(plan, async request => response(request, html));
    expect(fetched).toMatchObject({
      ok: true,
      fetchEvidence: {
        artifacts: [{ bodyRepresentation: "EXACT" }],
        fetchCounts: { rawCount: 19, validCount: 19 }
      }
    });
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected archived Apeloa evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(false);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: false },
      observation: { structuredJobCount: 19, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }
    });
  });

  it("verifies Astellas' unique static accordion and rejects duplicate, empty, outside-PDF, or paginated surfaces", async () => {
    const plan = planFor("source-astellas-china-social");
    const fetched = await fetchHtml(plan, async request => response(request, astellasHtml()));
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected Astellas evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 2, completenessStatus: "VERIFIED" }
    });
    expect(crawled.jobs.map((job) => job.officialTitle)).toEqual([
      "China External Innovation Lead",
      "Data Management Lead"
    ]);

    for (const body of [
      astellasHtml({ duplicateContainer: true }),
      astellasHtml({ zero: true }),
      astellasHtml({ outsidePdf: true }),
      astellasHtml({ pagination: true })
    ]) {
      const drifted = await fetchHtml(plan, async request => response(request, body));
      if (drifted.ok && drifted.fetchEvidence) {
        expect(validateStrictHtmlCompletenessProof(plan, drifted.fetchEvidence)).toBe(false);
      } else {
        expect(drifted.ok).toBe(false);
      }
    }
  });

  it("replays Bayer's China offset pages and rejects foreign locations or declared-total drift", async () => {
    const plan = planFor("source-bayer-healthcare-social");
    const requests: string[] = [];
    const fetched = await fetchHtml(plan, async request => {
      requests.push(request.url);
      const url = new URL(request.url);
      expect(url.searchParams.get("locationsearch")).toBe("China");
      return response(request, bayerPage(url.searchParams.get("startrow") === "10" ? 2 : 1));
    });
    expect(requests).toEqual([
      "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN",
      "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN&startrow=10"
    ]);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected Bayer evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 12, completenessStatus: "VERIFIED" }
    });

    const foreign = await fetchHtml(plan, async request => {
      const second = new URL(request.url).searchParams.get("startrow") === "10";
      return response(request, bayerPage(second ? 2 : 1, 12, second ? "Berlin, DE" : undefined));
    });
    if (!foreign.ok || !foreign.fetchEvidence) throw new Error("Expected foreign-location evidence");
    expect(validateStrictHtmlCompletenessProof(plan, foreign.fetchEvidence)).toBe(false);

    const driftedTotal = await fetchHtml(plan, async request => {
      const second = new URL(request.url).searchParams.get("startrow") === "10";
      return response(request, bayerPage(second ? 2 : 1, second ? 13 : 12));
    });
    if (!driftedTotal.ok || !driftedTotal.fetchEvidence) throw new Error("Expected drift evidence");
    expect(validateStrictHtmlCompletenessProof(plan, driftedTotal.fetchEvidence)).toBe(false);
  });

  it("accepts only Novartis' advancing official page window and deduplicates output by official URL", async () => {
    const plan = planFor("source-novartis-social");
    const requests: string[] = [];
    const bodies = [
      novartisPage(1, ["a", "b", "c"]),
      novartisPage(2, ["c", "d", "e"]),
      novartisPage(3, ["e", "f"])
    ];
    const fetched = await fetchHtml(plan, async request => {
      requests.push(request.url);
      return response(request, bodies[requests.length - 1]!);
    });
    expect(requests).toEqual([
      "https://prod1.novartis.com/careers/career-search/tag/LOC_CN",
      "https://prod1.novartis.com/careers/career-search/tag/LOC_CN?page=1",
      "https://prod1.novartis.com/careers/career-search/tag/LOC_CN?page=2"
    ]);
    expect(fetched).toMatchObject({
      ok: true,
      fetchEvidence: { fetchCounts: { rawCount: 8, validCount: 8 } },
      paginationEvaluation: { safeCompleteness: true, derivedAnomalyCodes: [] }
    });
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected Novartis evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 6, completenessStatus: "VERIFIED" }
    });
    expect(crawled.jobs.map((job) => job.officialUrl).sort()).toEqual(
      ["a", "b", "c", "d", "e", "f"].map((id) =>
        `https://prod1.novartis.com/careers/career-search/job/details/${id}`
      ).sort()
    );
  });

  it("accepts only independently replayed Novartis rows with auditable mainland-China locations", async () => {
    const plan = planFor("source-novartis-social");
    const locations = {
      a: "上海",
      b: "Shanghai, China",
      c: "北京，中国",
      d: "China",
      e: "Guangzhou, Guangdong, China",
      f: "中国大陆"
    };
    const bodies = [
      novartisPage(1, ["a", "b", "c"], { locations }),
      novartisPage(2, ["c", "d", "e"], { locations }),
      novartisPage(3, ["e", "f"], { locations })
    ];
    let index = 0;
    const fetched = await fetchHtml(plan, async request => response(request, bodies[index++]!));
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected mainland-China evidence");
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 6, completenessStatus: "VERIFIED" }
    });
  });

  it.each([
    ["foreign-only", "Basel, Switzerland"],
    ["mixed mainland and foreign", "Shanghai, China / Basel, Switzerland"],
    ["unknown", "Remote"],
    ["empty", "   "]
  ])("fails closed for Novartis %s location rows", async (_name, location) => {
    const plan = planFor("source-novartis-social");
    const locations = { d: location };
    const bodies = [
      novartisPage(1, ["a", "b", "c"]),
      novartisPage(2, ["c", "d", "e"], { locations }),
      novartisPage(3, ["e", "f"])
    ];
    let index = 0;
    const fetched = await fetchHtml(plan, async request => response(request, bodies[index++]!));
    if (!fetched.ok || !fetched.fetchEvidence) {
      expect(fetched.ok).toBe(false);
      return;
    }
    expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(false);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled.truth.completenessVerified).toBe(false);
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it.each([
    ["repeated response body", (() => {
      const first = novartisPage(1, ["a", "b", "c"]);
      return [first, first, novartisPage(3, ["d"])];
    })()],
    ["whole-page URL repetition", [
      novartisPage(1, ["a", "b", "c"]),
      novartisPage(2, ["a", "b", "c"], { titles: { a: "职位 a changed" } }),
      novartisPage(3, ["d"])
    ]],
    ["active-page drift", [
      novartisPage(1, ["a", "b"]),
      novartisPage(2, ["b", "c"], { activeOverride: 3 }),
      novartisPage(3, ["c", "d"])
    ]],
    ["enabled last next control", [
      novartisPage(1, ["a", "b"]),
      novartisPage(2, ["b", "c"]),
      novartisPage(3, ["c", "d"], { nextEnabledOnLast: true })
    ]]
  ])("rejects Novartis drift: %s", async (_name, bodies) => {
    const plan = planFor("source-novartis-social");
    let index = 0;
    const fetched = await fetchHtml(plan, async request => response(request, bodies[index++]!));
    if (fetched.ok && fetched.fetchEvidence) {
      expect(validateStrictHtmlCompletenessProof(plan, fetched.fetchEvidence)).toBe(false);
    } else {
      expect(fetched.ok).toBe(false);
    }
  });
});
