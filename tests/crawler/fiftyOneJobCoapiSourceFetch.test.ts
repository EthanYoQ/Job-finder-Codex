import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpRequest } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

const CAPTURED_AT = "2026-09-02T00:00:00.000Z";

describe("51job CoAPI official UI scope", () => {
  it("applies exclusions published by the official recruitment page instead of tuning to a count", async () => {
    const plan = getPlanBySourceId(
      buildStagedSourceCrawlPlans(candidateCompanies),
      "source-boehringer-ingelheim-china-social"
    );
    expect(plan).toBeDefined();
    const requests: OfficialJsonHttpRequest[] = [];
    const fetch = createOfficialJsonSourceFetch({
      now: () => new Date(CAPTURED_AT),
      http: async (request) => {
        requests.push(request);
        if (request.url.includes("/scripts/recruit.js")) {
          return response(request.url, `
            let sxsPosCode = [
              { code: "205909", jobareaname: "上海" },
            ]
            // official UI filters these rows before rendering
          `, "application/javascript");
        }
        return response(request.url, `jsoncallback({"status":"1","message":"接口调用成功","resultbody":{"totalnum":"2","joblist":[
          {"jobid":"visible-1","jobname":"Medical Advisor","jobareaname":"北京"},
          {"jobid":"hidden-1","jobname":"Intern ID205909","jobareaname":"上海"}
        ]}})`, "text/html");
      }
    });

    const crawled = await runSourceCrawl(plan!, { fetch });

    expect(crawled.status).toBe("SUCCESS");
    expect(crawled.jobs).toHaveLength(1);
    expect(crawled.jobs[0]).toMatchObject({
      officialTitle: "Medical Advisor",
      locationRaw: "北京"
    });
    expect(crawled.jobs[0]?.officialUrl).toContain("recruit_article_detail3.html?jobId=visible-1");
    expect(crawled.fetchEvidence?.fetchCounts).toEqual({
      rawCount: 2,
      parsedCount: 2,
      validCount: 1,
      parseDiscardCount: 0,
      validationDiscardCount: 1
    });
    expect(crawled.fetchEvidence?.fetchLosses).toMatchObject([
      { details: { code: "OFFICIAL_UI_EXCLUSION" } }
    ]);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]!.url).origin).toBe("https://coapi.51job.com");
  });
});

function response(url: string, body: string, contentType: string) {
  return {
    status: 200,
    body,
    finalUrl: url,
    contentType,
    capturedAt: CAPTURED_AT
  };
}
