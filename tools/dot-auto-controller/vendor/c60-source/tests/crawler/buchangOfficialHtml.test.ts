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

function plan(): HtmlPlan {
  const value = getPlanBySourceId(
    buildStagedSourceCrawlPlans(candidateCompanies),
    "source-buchang-social"
  );
  if (value?.adapterId !== "html-table") {
    throw new Error("Missing Buchang official HTML plan");
  }
  return value;
}

function page({ totalJobs = 1, totalPages = 1 }: { totalJobs?: number; totalPages?: number } = {}) {
  const options = Array.from({ length: totalPages }, (_, index) =>
    `<option value="${index + 1}">${index + 1}</option>`
  ).join("");
  return `<form id="ctl00"><div id="mycontetn"><table class="Ju-ZhaoPin"><tbody>
    <tr><th>职位名称</th><th>所属单位</th><th>发布者</th><th>工作地点</th><th>类别</th><th>发布日期</th></tr>
    <tr class="main_1"><td><a href="ZhaoPinDetial.aspx?ID=c82b55e1-57f9-41e9-a349-3b2a068ee51e">医药推广合作伙伴</a></td>
    <td>步长制药</td><td>组织发展部</td><td></td><td>111</td><td>2025-05-16</td></tr>
    </tbody></table></div><span id="totallcount">${totalJobs}</span>
    <span id="lblCurrentPage">1</span><select id="drop1">${options}</select></form>`;
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

describe("Buchang official social recruitment page", () => {
  it("binds the official one-page source and certifies its declared job total losslessly", async () => {
    const sourcePlan = plan();
    expect(sourcePlan).toMatchObject({
      source: {
        officialEntryUrl: "https://www.buchang.com/FormMy/Joinus/ZhaoXianNaShi",
        officialChainEvidenceUrl: "https://www.buchang.com/FormMy/Joinus/ZhaoXianNaShi"
      },
      table: {
        completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
        pagination: {
          totalPagesSelector: "#drop1 option[value]:not([value='请选择'])",
          totalPagesMode: "max",
          expectedJobCountSelector: "#totallcount",
          maxPages: 1
        }
      }
    });

    const fetched = await createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => response(request, page())
    })(sourcePlan);
    expect(fetched).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1 },
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 1 }
      }
    });
    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected exact Buchang evidence");
    expect(validateStrictHtmlCompletenessProof(sourcePlan, fetched.fetchEvidence)).toBe(true);

    const crawled = await runSourceCrawl(sourcePlan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { structuredJobCount: 1, completenessStatus: "VERIFIED", expectedJobCount: 1 }
    });
    expect(crawled.jobs).toMatchObject([{
      sourceJobId: "c82b55e1-57f9-41e9-a349-3b2a068ee51e",
      officialTitle: "医药推广合作伙伴",
      officialUrl: "https://www.buchang.com/FormMy/Joinus/ZhaoPinDetial.aspx?ID=c82b55e1-57f9-41e9-a349-3b2a068ee51e",
      locationRaw: "未披露"
    }]);
  });

  it("fails closed when the official total exceeds extracted rows or the page count grows", async () => {
    const sourcePlan = plan();
    for (const html of [page({ totalJobs: 2 }), page({ totalJobs: 1, totalPages: 2 })]) {
      const fetched = await createHttpHtmlSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => response(request, html)
      })(sourcePlan);
      if (fetched.ok && fetched.fetchEvidence) {
        expect(validateStrictHtmlCompletenessProof(sourcePlan, fetched.fetchEvidence)).toBe(false);
      } else {
        expect(fetched.ok).toBe(false);
      }
    }
  });
});
