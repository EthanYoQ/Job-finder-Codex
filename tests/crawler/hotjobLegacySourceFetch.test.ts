import { describe, expect, it } from "vitest";
import { createHotjobLegacySourceFetch } from "../../src/crawler/hotjobLegacySourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-sinocelltech", officialChineseName: "北京神州细胞生物技术集团股份公司" },
  source: {
    id: "source-sinocelltech-social",
    companyId: "company-sinocelltech",
    kind: "SOCIAL",
    atsKind: "HOTJOB_WECRUIT",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://www.hotjob.cn/wt/SCT/web/index",
    officialChainEvidenceUrl: "https://www.sinocelltech.com/Gather/job/pid/7.html"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw"
    }
  },
  hotjobLegacy: {
    listUrl: "https://www.hotjob.cn/wt/SCT/web/mode400/position/list",
    suitePath: "wt/SCT",
    pageSize: 2,
    maxPages: 1
  }
} satisfies SourceCrawlPlan;

describe("createHotjobLegacySourceFetch", () => {
  it("fetches legacy Hotjob positions and normalizes official urls", async () => {
    const requests: unknown[] = [];
    const fetcher = createHotjobLegacySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        return {
          status: 200,
          body: JSON.stringify({
            code: "00",
            data: {
              rowCount: 2,
              details: [
                { PostId: 164001, PostName: "知识产权高级经理", WorkPlace: "北京市" },
                { PostId: 212501, PostName: "医药代表【兰州-PD-1】", WorkPlace: "兰州市" }
              ]
            }
          })
        };
      }
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: {
        jobs: [
          {
            sourceJobId: "164001",
            title: "知识产权高级经理",
            officialUrl: "https://www.hotjob.cn/wt/SCT/web/index#/position/detail?postId=164001",
            locationRaw: "北京市"
          },
          {
            sourceJobId: "212501",
            title: "医药代表【兰州-PD-1】",
            officialUrl: "https://www.hotjob.cn/wt/SCT/web/index#/position/detail?postId=212501",
            locationRaw: "兰州市"
          }
        ]
      }
    });

    expect(requests).toEqual([
      expect.objectContaining({
        url: "https://www.hotjob.cn/wt/SCT/web/mode400/position/list",
        method: "POST",
        body: "pageSize=2&currentPage=1"
      })
    ]);
  });
});
