import { describe, expect, it } from "vitest";
import {
  createHotjobLegacySourceFetch,
  type HotjobLegacyHttpRequest
} from "../../src/crawler/hotjobLegacySourceFetch";
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

function response(request: HotjobLegacyHttpRequest, body: unknown, status = 200) {
  return {
    status,
    body: typeof body === "string" ? body : JSON.stringify(body),
    finalUrl: request.url,
    contentType: "application/json",
    capturedAt: "2026-07-08T00:00:00.000Z"
  };
}

describe("createHotjobLegacySourceFetch", () => {
  it("fetches legacy Hotjob positions and normalizes official urls", async () => {
    const requests: unknown[] = [];
    const fetcher = createHotjobLegacySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        return response(request, {
            code: "00",
            data: {
              rowCount: 2,
              currentPage: 1,
              details: [
                { PostId: 164001, PostName: "知识产权高级经理", WorkPlace: "北京市" },
                { PostId: 212501, PostName: "医药代表【兰州-PD-1】", WorkPlace: "兰州市" }
              ]
            }
          });
      }
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: {
        jobs: [
          {
            sourceJobId: expect.stringMatching(/^hotjob:sha256:[0-9a-f]{64}$/),
            title: "知识产权高级经理",
            officialUrl: "https://www.hotjob.cn/wt/SCT/web/index#/position/detail?postId=164001",
            locationRaw: "北京市"
          },
          {
            sourceJobId: expect.stringMatching(/^hotjob:sha256:[0-9a-f]{64}$/),
            title: "医药代表【兰州-PD-1】",
            officialUrl: "https://www.hotjob.cn/wt/SCT/web/index#/position/detail?postId=212501",
            locationRaw: "兰州市"
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://www.hotjob.cn/wt/SCT/web/index",
        pageSize: 2,
        pagesVisited: 1
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

  it("fails instead of inflating count when pagination repeats the same positions", async () => {
    const paginatedPlan = {
      ...plan,
      hotjobLegacy: {
        ...plan.hotjobLegacy,
        maxPages: 2
      }
    };
    const fetcher = createHotjobLegacySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => response(request, {
          data: {
            rowCount: 4,
            currentPage: Number(new URLSearchParams(request.body).get("currentPage")),
            details: [
              { PostId: 164001, PostName: "知识产权高级经理", WorkPlace: "北京市" },
              { PostId: 212501, PostName: "医药代表【兰州-PD-1】", WorkPlace: "兰州市" }
            ]
          }
        })
    });

    await expect(fetcher(paginatedPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("pagination evidence failed")
    });
  });

  it("fetches query-page Hotjob JSON responses with pageCount and lowercase post fields", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const queryPagePlan = {
      ...plan,
      source: {
        ...plan.source,
        officialEntryUrl: "https://crc.wintalent.cn/wt/crpharma/web/index/social"
      },
      hotjobLegacy: {
        ...plan.hotjobLegacy,
        listUrl:
          "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?recruitType=2&keyWord=&positionName=&site=",
        paginationMode: "query-page",
        pageSize: 2,
        maxPages: 2
      }
    } satisfies SourceCrawlPlan;
    const fetcher = createHotjobLegacySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push({ url: request.url, body: request.body });
        const page = new URL(request.url).searchParams.get("page");

        return response(request, {
            pageCount: 2,
            currentPage: Number(page),
            postList:
              page === "2"
                ? [{ postId: 1124, postName: "质量研究岗", workPlace: "上海市" }]
                : [
                    { postId: 1127, postName: "自动化生产管理岗", workPlace: "成都市" },
                    { postId: 1126, postName: "精益生产管理岗", workPlace: "成都市" }
                  ]
          });
      }
    });

    await expect(fetcher(queryPagePlan)).resolves.toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: expect.stringMatching(/^hotjob:sha256:[0-9a-f]{64}$/),
            title: "自动化生产管理岗",
            officialUrl:
              "https://crc.wintalent.cn/wt/crpharma/web/index/social#/position/detail?postId=1127",
            locationRaw: "成都市"
          },
          {
            sourceJobId: expect.stringMatching(/^hotjob:sha256:[0-9a-f]{64}$/),
            title: "精益生产管理岗",
            officialUrl:
              "https://crc.wintalent.cn/wt/crpharma/web/index/social#/position/detail?postId=1126",
            locationRaw: "成都市"
          },
          {
            sourceJobId: expect.stringMatching(/^hotjob:sha256:[0-9a-f]{64}$/),
            title: "质量研究岗",
            officialUrl:
              "https://crc.wintalent.cn/wt/crpharma/web/index/social#/position/detail?postId=1124",
            locationRaw: "上海市"
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "OFFICIAL_TOTAL_PAGES",
        totalPages: 2,
        pageSize: 2,
        pagesVisited: 2
      }
    });

    expect(requests.map((request) => request.url)).toEqual([
      "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?recruitType=2&page=1",
      "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?recruitType=2&page=2"
    ]);
  });

  it("accepts the audited CR Pharma JSON body with its exact upstream text/html MIME drift", async () => {
    const crPlan = {
      ...plan,
      company: { id: "company-cr-pharma", officialChineseName: "华润医药控股有限公司" },
      source: {
        ...plan.source,
        id: "source-cr-pharma-social",
        companyId: "company-cr-pharma",
        officialEntryUrl: "https://crc.wintalent.cn/wt/crpharma/web/index/social",
        officialChainEvidenceUrl: "https://www.crpharm.com/"
      },
      hotjobLegacy: {
        listUrl: "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?recruitType=2",
        suitePath: "wt/crpharma",
        paginationMode: "query-page",
        pageSize: 10,
        maxPages: 1,
        mimeCompatibilityPolicy: "CRPHARMA_WINTALENT_TEXT_HTML_JSON_V1"
      }
    } satisfies SourceCrawlPlan;
    const fetcher = createHotjobLegacySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => ({
        ...response(request, {
          pageCount: 1,
          page: 1,
          rowCount: 1,
          rowSize: 10,
          postList: [{ postId: 1127, postName: "自动化生产管理岗", workPlace: "成都市" }]
        }),
        contentType: "text/html;charset=utf-8"
      })
    });

    await expect(fetcher(crPlan)).resolves.toMatchObject({
      ok: true,
      payload: { jobs: [{ title: "自动化生产管理岗", locationRaw: "成都市",
        officialUrl: "https://crc.wintalent.cn/wt/crpharma/web/index/webPositionN300!getOnePosition?postId=1127&recruitType=2&brandCode=1&columnId=2&importPost=0" }] },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        expectedJobCount: 1,
        totalPages: 1
      },
      fetchEvidence: {
        artifacts: [{
          contentType: "text/html;charset=utf-8",
          extractorLocator: expect.stringContaining("rowCount=$.rowCount")
        }],
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: 1,
          extractorLocator: expect.stringContaining("rowCount=$.rowCount")
        },
        fetchCounts: { rawCount: 1, validCount: 1 }
      }
    });
  });

  it("keeps the CR Pharma MIME compatibility policy bound to the exact source authority", async () => {
    const crLikePlan = {
      ...plan,
      source: {
        ...plan.source,
        id: "source-unrelated-social",
        officialEntryUrl: "https://crc.wintalent.cn/wt/crpharma/web/index/social"
      },
      hotjobLegacy: {
        listUrl: "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?recruitType=2",
        suitePath: "wt/crpharma",
        paginationMode: "query-page",
        pageSize: 10,
        maxPages: 1,
        mimeCompatibilityPolicy: "CRPHARMA_WINTALENT_TEXT_HTML_JSON_V1"
      }
    } satisfies SourceCrawlPlan;
    const fetcher = createHotjobLegacySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => ({
        ...response(request, { pageCount: 1, page: 1, postList: [] }),
        contentType: "text/html;charset=utf-8"
      })
    });

    await expect(fetcher(crLikePlan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Hotjob response has an invalid Content-Type"
    });
  });

  it("rejects non-JSON and ambiguous JSON under the CR Pharma MIME compatibility policy", async () => {
    const crPlan = {
      ...plan,
      company: { id: "company-cr-pharma", officialChineseName: "华润医药控股有限公司" },
      source: {
        ...plan.source,
        id: "source-cr-pharma-social",
        companyId: "company-cr-pharma",
        officialEntryUrl: "https://crc.wintalent.cn/wt/crpharma/web/index/social",
        officialChainEvidenceUrl: "https://www.crpharm.com/"
      },
      hotjobLegacy: {
        listUrl: "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?recruitType=2",
        suitePath: "wt/crpharma",
        paginationMode: "query-page",
        pageSize: 10,
        maxPages: 1,
        mimeCompatibilityPolicy: "CRPHARMA_WINTALENT_TEXT_HTML_JSON_V1"
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      "<html><title>not json</title></html>",
      '{"pageCount":1,"pageCount":2,"page":1,"postList":[]}'
    ];

    for (const body of bodies) {
      const fetcher = createHotjobLegacySourceFetch({
        now: () => new Date("2026-07-08T00:00:00.000Z"),
        http: async (request) => ({
          ...response(request, body),
          contentType: "text/html;charset=utf-8"
        })
      });
      await expect(fetcher(crPlan)).resolves.toMatchObject({
        ok: false,
        failureReason: "Hotjob response has an invalid Content-Type"
      });
    }
  });
});
