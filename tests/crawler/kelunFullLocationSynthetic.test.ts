import { describe, expect, it } from "vitest";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import { createHttpHtmlSourceFetch } from "../../src/crawler/httpHtmlSourceFetch";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import { PLAN_BOUND_HTML_TRAVERSAL_POLICIES } from "../../src/crawler/planBoundHtmlTraversalValidator";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import { requiresBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { candidateCompanies } from "../../src/data/companyRegistry";

// Synthetic, non-certifying regression rows created for the Oct 1 reconstruction.
// IDs, titles, time and page placement are invented test data, not a site capture.
// The lost Sep 30 27-row fixture is NOT reconstructed or replayed by these tests.
const syntheticAt = "2026-10-01T00:00:00.000Z";
const syntheticRows = [
  { id: "990000001", title: "测试地区经理 (J99999)",
    location: "四川省-成都市-青羊区", visible: "四川省-成都市-...",
    cities: ["四川省-成都市-青羊区"] },
  { id: "990000002", title: "测试地区经理 (J99999)",
    location: "北京市,四川省-成都市,上海市,浙江省-杭州市", visible: "北京市,四川省-...",
    cities: ["北京市", "四川省-成都市", "上海市", "浙江省-杭州市"] },
  { id: "990000003", title: "测试产品经理 (J99998)",
    location: "上海市", visible: "上海市", cities: ["上海市"] }
] as const;

function plan() {
  const value = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-kelun-social");
  if (value?.adapterId !== "html-table") throw new Error("Missing canonical Kelun HTML plan");
  return value;
}

function rowHtml(row: typeof syntheticRows[number]) {
  return `<tr><td><a href="/job_show/${row.id}">${row.title}</a></td>
    <td></td><td></td><td></td><td title="${row.location}">${row.visible}</td></tr>`;
}

function extract(html: string, sourcePlan = plan()) {
  return htmlTableAdapter.extract({ ...sourcePlan, html, capturedAt: syntheticAt });
}

describe("Kelun full location repair: synthetic regression only", () => {
  it("projects complete district and multi-city title attributes, including an unclipped control", () => {
    const result = extract(`<table class="jobsTable">${syntheticRows.map(rowHtml).join("")}</table>`);
    expect(result.status).toBe("SUCCESS");
    expect(result.jobs.map(({ sourceJobId, locationRaw, cities }) => ({ sourceJobId, locationRaw, cities })))
      .toEqual(syntheticRows.map(row => ({ sourceJobId: row.id, locationRaw: row.location, cities: row.cities })));
    expect(result.reconciliation).toMatchObject({
      rawInputCount: 3, validBeforeDedupeCount: 3, dedupeOutputCount: 3,
      adapterLosses: [], collisionGroups: []
    });
  });

  it("changes only synthetic clipped location projections while preserving detail identities and dedupe keys", () => {
    const sourcePlan = plan();
    const oldPlan = structuredClone(sourcePlan);
    oldPlan.table.fields.locationRaw = { selector: "td:nth-child(5)" };
    const html = `<table class="jobsTable">${syntheticRows.map(rowHtml).join("")}</table>`;
    const current = extract(html, sourcePlan);
    const previous = extract(html, oldPlan);
    expect(current.jobs.map(buildJobDedupeKey)).toEqual(syntheticRows.map(row => `source-kelun-social:${row.id}`));
    expect(current.jobs.map(buildJobDedupeKey)).toEqual(previous.jobs.map(buildJobDedupeKey));
    expect(current.jobs.map(({ locationRaw, cities, ...unchanged }) => unchanged))
      .toEqual(previous.jobs.map(({ locationRaw, cities, ...unchanged }) => unchanged));
    expect(current.jobs.filter((job, index) => job.locationRaw !== previous.jobs[index]!.locationRaw)
      .map(({ sourceJobId }) => sourceJobId)).toEqual(["990000001", "990000002"]);
  });

  it.each(["", ' title=""', ' title="   "'])(
    "rejects a missing or blank title (%s) without falling back to visible text", attribute => {
      const result = extract(`<table class="jobsTable"><tr>
        <td><a href="/job_show/990000004">测试经理</a></td><td></td><td></td><td></td>
        <td${attribute}>四川省-成都市-...</td></tr></table>`);
      expect(result.status).toBe("FAILED");
      expect(result.jobs).toEqual([]);
      expect(result.reconciliation?.adapterLosses)
        .toEqual([{ stage: "VALIDATION", reason: "LOCATION_INVALID", rawIndex: 0 }]);
    }
  );

  it("preserves the marketing filter across three synthetic pages and independently replays their full locations", async () => {
    const sourcePlan = plan();
    const requestedUrls: URL[] = [];
    const fetched = await createHttpHtmlSourceFetch({
      now: () => new Date(syntheticAt),
      http: async request => {
        const url = new URL(request.url);
        requestedUrls.push(url);
        const pageNumber = Number(url.searchParams.get("PageIndex") ?? "1");
        const row = syntheticRows[pageNumber - 1];
        if (!row) throw new Error("Unexpected synthetic page");
        const links = [1, 2, 3].filter(page => pageNumber === 1 || page !== pageNumber);
        const pager = `<div class="page">${links.map(page =>
          `<a href="/social?r=&p=1%5E2&c=&d=&k=&PageIndex=${page}">${page}</a>`).join("")}</div>`;
        return { status: 200, body: `${pager}<table class="jobsTable">${rowHtml(row)}</table>`,
          finalUrl: request.url, contentType: "text/html; charset=utf-8", capturedAt: syntheticAt };
      }
    })(sourcePlan);
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Missing synthetic fetch evidence");
    const result = await runSourceCrawl(sourcePlan, { fetch: async () => fetched });
    expect(requestedUrls.map(url => url.searchParams.get("PageIndex"))).toEqual([null, "2", "3"]);
    expect(requestedUrls.every(url => url.searchParams.get("p") === "1^2")).toBe(true);
    expect(result.jobs.map(({ sourceJobId, locationRaw }) => ({ sourceJobId, locationRaw })))
      .toEqual(syntheticRows.map(row => ({ sourceJobId: row.id, locationRaw: row.location })));
    expect(result.reconciliation).toMatchObject({ rawInputCount: 3, dedupeOutputCount: 3,
      adapterLosses: [], collisionGroups: [] });
    // Parser proof on synthetic inputs is not real capture evidence or qualification.
    expect(validateStrictHtmlCompletenessProof(sourcePlan, fetched.fetchEvidence)).toBe(true);
    const missingPage = structuredClone(fetched.fetchEvidence);
    missingPage.artifacts.splice(1, 1);
    expect(validateStrictHtmlCompletenessProof(sourcePlan, missingPage)).toBe(false);
  });

  it("binds the changed location config without relaxing source scope or the mandatory B policy", () => {
    const sourcePlan = plan();
    const previous = structuredClone(sourcePlan);
    previous.table.fields.locationRaw = { selector: "td:nth-child(5)" };
    expect(sourcePlanConfigSha256(sourcePlan)).not.toBe(sourcePlanConfigSha256(previous));
    expect(requiresBGradeTraversalCertificate(sourcePlan)).toBe(true);
    expect(sourcePlan.source.id).toBe("source-kelun-social");
    expect(sourcePlan.company.id).toBe("company-kelun");
    expect(sourcePlan.source.officialEntryUrl).toBe("https://kelun.zhiye.com/social?r=&p=1%5E2&c=&d=&k=");
    expect(PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-kelun-social"].entryUrl)
      .toBe(sourcePlan.source.officialEntryUrl);
    expect(sourcePlan.table.completenessProof).toEqual({ kind: "OFFICIAL_TOTAL_PAGES" });
    expect(sourcePlan.table.pagination).toMatchObject({
      pageSearchParam: "PageIndex", totalPagesDeclaredOnEntryOnly: true, maxPages: 20
    });
  });
});
