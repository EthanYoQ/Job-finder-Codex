import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import {
  buildDiscoverySourcePlanCandidates,
  buildStagedSourceCrawlPlans,
  getPlanBySourceId
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/crawler/fixtures/static-official-sources"
);

type ExpectedJob = { title: string; location: string; date?: string };
type StaticFixtureCase = {
  sourceId: string;
  fixture: string;
  sourceUrl: string;
  capturedAt: string;
  fullBodyByteCount: number;
  fullBodySha256: string;
  expectedCount: number;
  expectedJobs: readonly ExpectedJob[];
  containerSelector: string;
  rowSelector: string;
  titleSelector: string;
  locationSelector: string;
  dateSelector?: string;
  nextControlSelector: string;
  excludedRowSelector?: string;
  expectedExcludedJobs?: readonly ExpectedJob[];
};

const cases: readonly StaticFixtureCase[] = [
  {
    sourceId: "source-apeloa-social",
    fixture: "apeloa.html",
    sourceUrl: "https://www.apeloa.com/join.html",
    capturedAt: "2026-07-13T18:48:14.505Z",
    fullBodyByteCount: 185804,
    fullBodySha256: "e885c02b61498579788a9976d887b55ddbaeb7be2aa7f818b606d6b8d6efd2c4",
    expectedCount: 19,
    expectedJobs: [
      { title: "行政管理总监/部长", location: "横店", date: "发布时间：2026.07.10" },
      { title: "工艺研究员（初级、中级）", location: "浙江横店、上海", date: "发布时间：2025.09.10" },
      { title: "PRD组长（小分子工艺，多肽，流体）", location: "浙江横店、上海", date: "发布时间：2025.09.10" },
      { title: "PRD助理主任及以上 （小分子工艺，多肽，流体）", location: "浙江横店、上海", date: "发布时间：2025.09.10" },
      { title: "AD组长", location: "浙江横店、上海", date: "发布时间：2025.09.10" },
      { title: "AD主任", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "酶催化平台主任", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "酶催化首席科学家", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "CRO助理主任及以上", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "Project Manager（项目经理）", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "培训专员", location: "浙江横店、上海", date: "发布时间：2025.09.10" },
      { title: "流体生产主管", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "QA经理", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "QC经理", location: "浙江横店", date: "发布时间：2025.09.11" },
      { title: "项目QA", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "项目QC", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "QC研究员(检测方向)", location: "浙江横店", date: "发布时间：2025.09.11" },
      { title: "QC研究员(验证方向)", location: "浙江横店", date: "发布时间：2025.09.11" },
      { title: "仪器设备工程师", location: "浙江横店", date: "发布时间：2025.09.11" }
    ],
    containerSelector: ".join2 .tab-content > .main:first-child",
    rowSelector: ".join2 .tab-content > .main:first-child > .ev",
    titleSelector: ".table99.name > div:nth-child(1) > p",
    locationSelector: ".table99.name > div:nth-child(4) > p",
    dateSelector: ".down .mailto:first-of-type p",
    nextControlSelector: ".join2 .pagination, .join2 a[rel='next'], .join2 [data-page]",
    excludedRowSelector: ".join2 .tab-content > .main:nth-child(2) > .ev",
    expectedExcludedJobs: [
      { title: "合成研究员", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "分析研究员", location: "浙江横店/上海", date: "发布时间：2025.09.10" },
      { title: "制造工程师", location: "浙江横店、山东潍坊、浙江歌山", date: "发布时间：2025.09.10" },
      { title: "项目负责人", location: "横店", date: "发布时间：2025.09.10" },
      { title: "临床&终端销售经理", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "产品专员", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "制剂CDMO研发员", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "工艺研究员", location: "浙江横店/上海", date: "发布时间：2025.09.10" },
      { title: "运营专员", location: "浙江横店", date: "发布时间：2025.09.10" },
      { title: "报价专员", location: "浙江横店/上海", date: "发布时间：2025.09.10" },
      { title: "效率提升专员", location: "浙江横店/上海", date: "发布时间：2025.09.10" },
      { title: "HR专员", location: "浙江横店", date: "发布时间：2025.09.10" }
    ]
  },
  {
    sourceId: "source-huahai-social",
    fixture: "huahai.html",
    sourceUrl: "https://www.huahaipharm.com/zpgw.html",
    capturedAt: "2026-07-13T18:48:15.669Z",
    fullBodyByteCount: 22711,
    fullBodySha256: "9b0a718db14901534756d32970102871ed4bc59496f35e28f9406b79e21e33c6",
    expectedCount: 2,
    expectedJobs: [
      { title: "外贸业务员", location: "临海", date: "2023-12-25" },
      { title: "国际业务经理", location: "临海", date: "2023-12-20" }
    ],
    containerSelector: "table:has(tr.tr_title)",
    rowSelector: "tr.tr_title",
    titleSelector: "td:nth-child(1)",
    locationSelector: "td:nth-child(2)",
    dateSelector: "td:nth-child(5)",
    nextControlSelector: "table:has(tr.tr_title) .pagination, table:has(tr.tr_title) a[rel='next'], table:has(tr.tr_title) [data-page]"
  },
  {
    sourceId: "source-grand-pharma-social",
    fixture: "grand.html",
    sourceUrl: "https://job.grandpharma.cn/",
    capturedAt: "2026-07-13T18:48:19.777Z",
    fullBodyByteCount: 31136,
    fullBodySha256: "c921be1b5520a1c797cfa8238d11f289a52c10f345dc6c5b53cfc165d2f69f7d",
    expectedCount: 2,
    expectedJobs: [
      { title: "处方药全国医院开发业务总监", location: "西安" },
      { title: "研发财务BP业务经理", location: "武汉&南京" }
    ],
    containerSelector: ".job-list",
    rowSelector: ".job-card:has(a[href='#login'])",
    titleSelector: ".job-title",
    locationSelector: ".job-meta span:nth-child(1)",
    nextControlSelector: ".job-list .pagination, .job-list a[rel='next'], .job-list [data-page]",
    excludedRowSelector: ".job-card:has(a[href='schooldetail.html'])",
    expectedExcludedJobs: [{ title: "管理培训生", location: "全国" }]
  }
];

const normalizedText = (text: string): string => text.replace(/\s+/gu, " ").trim();

describe("sanitized exact static official source fixtures", () => {
  const discoveryPlans = buildDiscoverySourcePlanCandidates(candidateCompanies);
  const stagedPlans = buildStagedSourceCrawlPlans(candidateCompanies);

  it.each(cases)(
    "independently locks the official capture rows for $sourceId",
    ({
      sourceId,
      fixture,
      sourceUrl,
      capturedAt,
      fullBodyByteCount,
      fullBodySha256,
      expectedCount,
      expectedJobs,
      containerSelector,
      rowSelector,
      titleSelector,
      locationSelector,
      dateSelector,
      nextControlSelector,
      excludedRowSelector,
      expectedExcludedJobs = []
    }) => {
      const html = readFileSync(resolve(fixtureDirectory, fixture), "utf8");
      expect(html).toContain(`requested-url="${sourceUrl}"`);
      expect(html).toContain(`final-url="${sourceUrl}"`);
      expect(html).toContain(`status="200"`);
      expect(html).toContain(`captured-at="${capturedAt}"`);
      expect(html).toContain(`full-body-bytes="${fullBodyByteCount}"`);
      expect(html).toContain(`full-body-sha256="${fullBodySha256}"`);

      const $ = load(html);
      const containers = $(containerSelector);
      const rows = $(rowSelector).toArray();
      expect(containers).toHaveLength(1);
      expect($(nextControlSelector)).toHaveLength(0);
      expect(rows).toHaveLength(expectedCount);
      expect(expectedJobs).toHaveLength(expectedCount);
      const container = containers.get(0)!;
      expect(rows.every((row) => $.contains(container, row))).toBe(true);

      const independentlyParsed = rows.map((row) => ({
        title: normalizedText($(row).find(titleSelector).first().text()),
        location: normalizedText($(row).find(locationSelector).first().text()),
        ...(dateSelector ? { date: normalizedText($(row).find(dateSelector).first().text()) } : {})
      }));
      expect(independentlyParsed).toEqual(expectedJobs);

      const excludedRows = excludedRowSelector ? $(excludedRowSelector).toArray() : [];
      expect(excludedRows).toHaveLength(expectedExcludedJobs.length);
      expect(excludedRows.map((row) => ({
        title: normalizedText($(row).find(titleSelector).first().text()),
        location: normalizedText($(row).find(locationSelector).first().text()),
        ...(dateSelector ? { date: normalizedText($(row).find(dateSelector).first().text()) } : {})
      }))).toEqual(expectedExcludedJobs);

      const plan = getPlanBySourceId(discoveryPlans, sourceId);
      expect(plan?.adapterId).toBe("html-table");
      if (!plan || plan.adapterId !== "html-table") throw new Error(`missing HTML plan for ${sourceId}`);
      expect(plan.table.rowSelector).toBe(rowSelector);
      expect(plan.table.staticPublicList?.containerSelector).toBe(containerSelector);

      const result = htmlTableAdapter.extract({
        company: plan.company,
        source: plan.source,
        capturedAt,
        html,
        table: plan.table
      });
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") throw new Error(result.failureReason);
      expect(result.jobs).toHaveLength(expectedCount);
      expect(result.jobs.map(({ officialTitle, locationRaw }) => ({ title: officialTitle, location: locationRaw })))
        .toEqual(expectedJobs.map(({ title, location }) => ({ title, location })));
      expect(result.jobs.map((job) => job.sourceJobId)).toEqual(
        expectedJobs.map(() => expect.stringMatching(/^html:sha256:[0-9a-f]{64}$/))
      );
      expect(new Set(result.jobs.map((job) => job.sourceJobId))).toHaveLength(expectedCount);
      expect(result.jobs.every((job) => job.officialUrl === sourceUrl)).toBe(true);
      expect(result.jobs.every((job) => job.officialUrl === plan.source.officialEntryUrl)).toBe(true);
      for (const excluded of expectedExcludedJobs) {
        expect(result.jobs.map((job) => job.officialTitle)).not.toContain(excluded.title);
      }
    }
  );

  it("preserves Apeloa's first mailto publication-date structure for all 19 social and 12 campus rows", () => {
    const html = readFileSync(resolve(fixtureDirectory, "apeloa.html"), "utf8");
    const $ = load(html);
    const allRows = $(".join2 .tab-content > .main > .ev").toArray();
    expect($(".join2 .tab-content > .main:first-child > .ev")).toHaveLength(19);
    expect($(".join2 .tab-content > .main:nth-child(2) > .ev")).toHaveLength(12);
    expect(allRows).toHaveLength(31);
    for (const row of allRows) {
      const firstMailto = $(row).find(".down .mailto:first-of-type");
      expect(firstMailto).toHaveLength(1);
      expect(normalizedText(firstMailto.find("p").text())).toMatch(/^发布时间：\d{4}\.\d{2}\.\d{2}$/u);
    }
  });

  it("keeps Huahai's adjacent Liepin apply links but never emits them as official URLs", () => {
    const html = readFileSync(resolve(fixtureDirectory, "huahai.html"), "utf8");
    const $ = load(html);
    const links = $("tr.tr_title").toArray().map((row) => {
      const content = $(row).next();
      expect(content.is("tr.tr_content")).toBe(true);
      return content.find(".apply a").attr("href");
    });
    expect(links).toEqual([
      "https://m.liepin.com/job/1930160841.shtml",
      "https://m.liepin.com/job/1930160571.shtml"
    ]);
    for (const href of links) {
      const url = new URL(href!);
      expect(url.hostname).toBe("m.liepin.com");
      expect(url.search).toBe("");
    }

    const plan = getPlanBySourceId(discoveryPlans, "source-huahai-social");
    if (!plan || plan.adapterId !== "html-table") throw new Error("missing Huahai plan");
    const result = htmlTableAdapter.extract({
      company: plan.company,
      source: plan.source,
      capturedAt: "2026-07-13T18:48:15.669Z",
      html,
      table: plan.table
    });
    if (result.status !== "SUCCESS") throw new Error(result.failureReason);
    expect(result.jobs.map((job) => job.officialUrl)).toEqual([
      "https://www.huahaipharm.com/zpgw.html",
      "https://www.huahaipharm.com/zpgw.html"
    ]);
  });

  it("retains the selected ChinaOtsuka pharmaceutical source and leaves the excluded group page pending", () => {
    const active = getPlanBySourceId(stagedPlans, "source-otsuka-china-social");
    expect(active).toMatchObject({
      adapterId: "html-table",
      source: {
        officialEntryUrl: "https://chinaotsuka.com.cn/class/26",
        status: "VERIFIED_SCRAPABLE"
      },
      table: { completenessProof: { kind: "STATIC_PUBLIC_LIST" } }
    });
    expect(getPlanBySourceId(discoveryPlans, "source-otsuka-china-social-2")).toBeUndefined();
    expect(getPlanBySourceId(stagedPlans, "source-otsuka-china-social-2")).toBeUndefined();
  });
});
