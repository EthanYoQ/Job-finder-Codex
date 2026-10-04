import { describe, expect, it } from "vitest";
import { createHttpHtmlSourceFetch, type HttpHtmlRequest } from "../../src/crawler/httpHtmlSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-09-02T00:00:00.000Z";

describe("Kelun official detail identity reconciliation", () => {
  it("preserves distinct official detail rows when the displayed requisition code repeats", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-kelun-social");
    if (plan?.adapterId !== "html-table") throw new Error("missing Kelun HTML plan");

    const rawRows = [
      { detailId: "401", title: "市场经理 (J13184)", location: "四川省·成都市" },
      { detailId: "402", title: "市场经理（J13184）", location: "四川省·成都市" },
      { detailId: "403", title: "招商主管 (J12879)", location: "上海市" },
      { detailId: "404", title: "招商主管 (J12879)", location: "上海市" },
      { detailId: "405", title: "产品经理 (J12724)", location: "北京市" },
      { detailId: "406", title: "产品经理 (J12724)", location: "北京市" },
      { detailId: "407", title: "医学经理 (J14000)", location: "广东省·广州市" }
    ] as const;
    const expectedDetailIds = rawRows.map(({ detailId }) => detailId);
    const body = `<div class="page"><a href="/social?PageIndex=1">1</a></div>
      <table class="jobsTable">${rawRows.map(({ detailId, title, location }) =>
        `<tr><td><a href="/job_show/${detailId}">${title}</a></td><td></td><td></td><td></td><td title="${location}">${location}</td></tr>`
      ).join("")}</table>`;
    const fetch = createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request: HttpHtmlRequest) => ({
        status: 200,
        body,
        finalUrl: request.url,
        contentType: "text/html; charset=utf-8",
        capturedAt
      })
    });

    const fetched = await fetch(plan);
    if (!fetched.ok || !fetched.fetchEvidence) {
      throw new Error(fetched.ok ? "missing Kelun fetch evidence" : fetched.failureReason);
    }
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    if (!crawled.reconciliation) throw new Error("missing Kelun reconciliation evidence");

    expect(fetched.fetchEvidence.fetchCounts).toMatchObject({
      rawCount: rawRows.length,
      validCount: rawRows.length
    });
    expect(crawled.status).toBe("SUCCESS");
    expect(crawled.jobs.map(({ sourceJobId }) => sourceJobId).sort()).toEqual(expectedDetailIds.sort());
    expect(crawled.reconciliation).toMatchObject({
      rawInputCount: rawRows.length,
      validBeforeDedupeCount: rawRows.length,
      dedupeInputCount: rawRows.length,
      dedupeOutputCount: rawRows.length,
      adapterLosses: [],
      collisionGroups: []
    });
  });
});
