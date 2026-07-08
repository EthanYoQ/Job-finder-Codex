import { describe, expect, it } from "vitest";
import { createHotjobWecruitSourceFetch } from "../../src/crawler/hotjobWecruitSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-haisco", officialChineseName: "海思科医药集团股份有限公司" },
  source: {
    id: "source-haisco-social",
    companyId: "company-haisco",
    kind: "SOCIAL",
    atsKind: "HOTJOB_WECRUIT",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://wecruit.hotjob.cn/SU6663b85a1eb8051cd22556e3/pb/social.html",
    officialChainEvidenceUrl: "https://www.haisco.com/recruitment.html"
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
  hotjob: {
    suiteKey: "SU6663b85a1eb8051cd22556e3",
    pageSize: 2,
    maxPages: 2
  }
} satisfies SourceCrawlPlan;

describe("createHotjobWecruitSourceFetch", () => {
  it("fetches paginated social jobs with form POST and builds official detail urls", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetcher = createHotjobWecruitSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push({ url: request.url, body: request.body });
        const body = new URLSearchParams(request.body);
        if (body.get("currentPage") === "1") {
          return {
            status: 200,
            body: JSON.stringify({
              data: {
                pageForm: {
                  totalPage: 2,
                  pageData: [
                    {
                      postName: "联盟管理总监Alliance Management(006222)",
                      postId: "6a4df8f19d291a0d358edb7e",
                      workPlaceStr: "北京市、成都市、上海市"
                    }
                  ]
                }
              }
            })
          };
        }

        return {
          status: 200,
          body: JSON.stringify({
            data: {
              pageForm: {
                totalPage: 2,
                pageData: [
                  {
                    postName: "医学信息沟通专员",
                    postId: "6a4df8f19d291a0d358edb7f",
                    workPlaceStr: "广州市"
                  }
                ]
              }
            }
          })
        };
      }
    });

    await expect(fetcher(plan)).resolves.toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: {
        jobs: [
          {
            sourceJobId: "6a4df8f19d291a0d358edb7e",
            title: "联盟管理总监Alliance Management(006222)",
            officialUrl:
              "https://wecruit.hotjob.cn/SU6663b85a1eb8051cd22556e3/pb/posDetail.html?postId=6a4df8f19d291a0d358edb7e&recruitType=2",
            locationRaw: "北京市、成都市、上海市"
          },
          {
            sourceJobId: "6a4df8f19d291a0d358edb7f",
            title: "医学信息沟通专员",
            officialUrl:
              "https://wecruit.hotjob.cn/SU6663b85a1eb8051cd22556e3/pb/posDetail.html?postId=6a4df8f19d291a0d358edb7f&recruitType=2",
            locationRaw: "广州市"
          }
        ]
      }
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.url).toBe(
      "https://wecruit.hotjob.cn/wecruit/positionInfo/listPosition/SU6663b85a1eb8051cd22556e3?iSaJAx=isAjax&request_locale=zh-CN"
    );
    expect(Object.fromEntries(new URLSearchParams(requests[0]?.body))).toMatchObject({
      isFrompb: "true",
      recruitType: "2",
      pageSize: "2",
      currentPage: "1"
    });
    expect(Object.fromEntries(new URLSearchParams(requests[1]?.body))).toMatchObject({
      currentPage: "2"
    });
  });

  it("fails non-Hotjob plans before formal crawl", async () => {
    const fetcher = createHotjobWecruitSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z")
    });

    await expect(
      fetcher({
        ...plan,
        source: { ...plan.source, atsKind: "WORKDAY" }
      })
    ).resolves.toMatchObject({
      ok: false,
      failureReason: "Hotjob Wecruit source fetch only supports HOTJOB_WECRUIT sources"
    });
  });

  it("fails non-2xx Hotjob responses", async () => {
    const fetcher = createHotjobWecruitSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 500, body: "server error" })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Hotjob Wecruit jobs API returned HTTP 500"
    });
  });
});
