import { describe, expect, it } from "vitest";
import { buildAdminDashboardModel } from "../../src/admin/adminViewModel";

describe("buildAdminDashboardModel", () => {
  it("sorts critical source failures first and exposes only minimal source fields", () => {
    const model = buildAdminDashboardModel({
      sourceHealth: [
        {
          sourceId: "source-stable",
          companyId: "company-1",
          companyName: "稳定药企",
          verificationStatus: "VERIFIED_SCRAPABLE",
          structuredJobCount: 42,
          consecutiveFailureCount: 0,
          latestObservation: {
            crawledAt: new Date("2026-07-08T10:00:00.000Z"),
            successful: true,
            structuredJobCount: 5,
            failureReason: null
          }
        },
        {
          sourceId: "source-failing",
          companyId: "company-2",
          companyName: "告警药企",
          verificationStatus: "VERIFIED_SCRAPABLE",
          structuredJobCount: 4,
          consecutiveFailureCount: 3,
          latestObservation: {
            crawledAt: new Date("2026-07-08T11:00:00.000Z"),
            successful: false,
            structuredJobCount: 0,
            failureReason: "timeout"
          },
          latestFailure: {
            finishedAt: new Date("2026-07-08T11:00:00.000Z"),
            reason: "Official recruitment endpoint was temporarily unavailable (HTTP 503)",
            category: "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
            diagnosticCode: "OFFICIAL_HTTP_503",
            fetchAttemptCount: 2,
            retryCount: 1
          }
        }
      ],
      feedbackQueue: [],
      recommendationQueue: [],
      categoryCorrectionQueue: []
    });

    expect(model.sources.map((source) => source.sourceId)).toEqual(["source-failing", "source-stable"]);
    const firstSource = model.sources[0];

    expect(firstSource).toEqual({
      sourceId: "source-failing",
      companyName: "告警药企",
      verificationStatus: "VERIFIED_SCRAPABLE",
      structuredJobCount: 4,
      consecutiveFailureCount: 3,
      latestCrawledAt: "2026-07-08T11:00:00.000Z",
      latestOutcomeLabel: "失败",
      latestFailureReason: "Official recruitment endpoint was temporarily unavailable (HTTP 503)",
      latestFailureCategoryLabel: "官网招聘入口暂时不可用",
      latestFetchAttemptCount: 2,
      latestRetryCount: 1,
      canQueueManualCrawl: true
    });
    expect(firstSource).toBeDefined();
    expect("companyId" in firstSource!).toBe(false);
  });

  it("keeps admin review queues minimal and excludes raw job export fields", () => {
    const model = buildAdminDashboardModel({
      sourceHealth: [],
      feedbackQueue: [
        {
          id: "feedback-1",
          companyName: "辉瑞",
          jobTitle: "MSL",
          issueType: "链接不可用",
          description: "链接跳转到 404",
          status: "OPEN",
          createdAt: new Date("2026-07-08T09:00:00.000Z")
        }
      ],
      recommendationQueue: [
        {
          id: "recommendation-1",
          companyName: "礼来",
          officialWebsiteUrl: "https://www.lilly.com/cn",
          note: "用户推荐",
          status: "OPEN",
          createdAt: new Date("2026-07-08T08:00:00.000Z")
        }
      ],
      categoryCorrectionQueue: [
        {
          jobId: "job-1",
          companyName: "阿斯利康",
          jobTitle: "医学科学联络官",
          currentCategory: "其他",
          suggestedCategory: "医学事务"
        }
      ]
    });

    expect(model.feedbackQueue[0]).toEqual({
      id: "feedback-1",
      companyName: "辉瑞",
      jobTitle: "MSL",
      issueType: "链接不可用",
      description: "链接跳转到 404",
      status: "OPEN",
      createdAt: "2026-07-08T09:00:00.000Z"
    });
    expect(model.recommendationQueue[0]).toEqual({
      id: "recommendation-1",
      companyName: "礼来",
      officialWebsiteUrl: "https://www.lilly.com/cn",
      note: "用户推荐",
      status: "OPEN",
      createdAt: "2026-07-08T08:00:00.000Z"
    });
    expect(model.categoryCorrectionQueue[0]).toEqual({
      jobId: "job-1",
      companyName: "阿斯利康",
      jobTitle: "医学科学联络官",
      currentCategory: "其他",
      suggestedCategory: "医学事务"
    });
    expect("rawJobRows" in model).toBe(false);
    expect("bulkExport" in model).toBe(false);
  });

  it("shows the contact and request type needed to process a privacy request", () => {
    const model = buildAdminDashboardModel({
      sourceHealth: [], recommendationQueue: [], categoryCorrectionQueue: [],
      feedbackQueue: [{
        id: "privacy-1", companyName: "未关联公司", jobTitle: "未关联职位",
        issueType: "PRIVACY_DELETE", description: "delete", contact: "user@example.cn",
        status: "OPEN", createdAt: new Date("2026-07-13T00:00:00Z")
      }]
    });
    expect(model.feedbackQueue[0]).toMatchObject({ issueType: "PRIVACY_DELETE", contact: "user@example.cn" });
  });
});
