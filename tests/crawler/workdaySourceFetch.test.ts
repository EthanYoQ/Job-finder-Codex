import { describe, expect, it } from "vitest";
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-pfizer-china", officialChineseName: "辉瑞" },
  source: {
    id: "source-pfizer-china-social",
    companyId: "company-pfizer-china",
    kind: "SOCIAL",
    atsKind: "WORKDAY",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
    officialChainEvidenceUrl: "https://www.pfizer.com/about/careers"
  },
  json: {
    jobsPath: "jobPostings",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    }
  },
  workday: {
    tenant: "pfizer",
    site: "PfizerCareers",
    searchText: "China",
    appliedFacets: { Location_Country: ["china-id"] },
    pageSize: 2,
    maxPages: 2
  }
} satisfies SourceCrawlPlan;

describe("createWorkdaySourceFetch", () => {
  it("fetches paginated Workday jobs and enriches official urls and Chinese cities", async () => {
    const requests: unknown[] = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body);
        if (body.offset === 0) {
          return {
            status: 200,
            body: JSON.stringify({
              total: 3,
              jobPostings: [
                {
                  title: "助理医学信息沟通专员",
                  externalPath: "/job/China---Shanghai---Shanghai/_4960384",
                  locationsText: "China - Shanghai - Shanghai",
                  bulletFields: ["4960384"]
                },
                {
                  title: "血友病客户解决方案大区经理",
                  externalPath: "/job/China---Beijing---Beijing/_4959317",
                  locationsText: "China - Beijing - Beijing",
                  bulletFields: ["4959317"]
                }
              ]
            })
          };
        }

        return {
          status: 200,
          body: JSON.stringify({
            total: 3,
            jobPostings: [
              {
                title: "Site Admin",
                externalPath: "/job/China---Jiangsu---Suzhou/_4950000",
                locationsText: "China - Jiangsu - Suzhou",
                bulletFields: ["4950000"]
              }
            ]
          })
        };
      }
    });

    await expect(fetcher(plan)).resolves.toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: {
        jobPostings: [
          {
            sourceJobId: "4960384",
            title: "助理医学信息沟通专员",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Shanghai---Shanghai/_4960384",
            locationRaw: "China - Shanghai - Shanghai",
            cities: ["上海"]
          },
          {
            sourceJobId: "4959317",
            title: "血友病客户解决方案大区经理",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Beijing---Beijing/_4959317",
            locationRaw: "China - Beijing - Beijing",
            cities: ["北京"]
          },
          {
            sourceJobId: "4950000",
            title: "Site Admin",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Jiangsu---Suzhou/_4950000",
            locationRaw: "China - Jiangsu - Suzhou",
            cities: ["苏州"]
          }
        ]
      }
    });

    expect(requests).toEqual([
      expect.objectContaining({
        url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
        method: "POST",
        body: JSON.stringify({
          appliedFacets: { Location_Country: ["china-id"] },
          searchText: "China",
          limit: 2,
          offset: 0
        })
      }),
      expect.objectContaining({
        url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
        method: "POST",
        body: JSON.stringify({
          appliedFacets: { Location_Country: ["china-id"] },
          searchText: "China",
          limit: 2,
          offset: 2
        })
      })
    ]);
  });

  it("fails non-Workday plans before formal crawl", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z")
    });

    await expect(
      fetcher({
        ...plan,
        source: { ...plan.source, atsKind: "MOKA" }
      })
    ).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday source fetch only supports WORKDAY sources"
    });
  });

  it("fails non-2xx Workday responses", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 500, body: "server error" })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday jobs API returned HTTP 500"
    });
  });
});
