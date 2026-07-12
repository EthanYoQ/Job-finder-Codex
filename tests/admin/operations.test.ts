import { describe, expect, it } from "vitest";
import {
  applyJobCategoryCorrection,
  listSourceHealth,
  queueManualCrawl,
  reviewFeedback,
  reviewRecommendedCompany,
  type AdminOperationContext,
  type AdminOperationsDb
} from "../../src/admin/operations";

const adminContext: AdminOperationContext = {
  adminUserId: "admin-1",
  ip: "127.0.0.1",
  userAgent: "vitest"
};

describe("admin operations", () => {
  it("queues through the transactional manual crawl repository", async () => {
    const enqueues: Array<unknown> = [];
    const db = createDb();

    const result = await queueManualCrawl(
      { sourceId: "source-1", reason: "manual verification" },
      adminContext,
      {
        db,
        manualCrawlRequestRepository: {
          async enqueue(input) {
            enqueues.push(input);
            return { id: "crawl-1" };
          }
        }
      }
    );

    expect(result).toEqual({ id: "crawl-1" });
    expect(enqueues).toEqual([
      {
        sourceId: "source-1",
        requestedById: "admin-1",
        reason: "manual verification",
        ip: "127.0.0.1",
        userAgent: "vitest"
      }
    ]);
  });

  it("reviews feedback with allowed statuses and writes audit metadata", async () => {
    const feedbackUpdates: Array<unknown> = [];
    const auditCreates: Array<unknown> = [];
    const db = createDb({
      feedback: {
        async update(args) {
          feedbackUpdates.push(args);
          return { id: "feedback-1", status: "REVIEWED" };
        }
      },
      adminAuditEvent: {
        async create(args) {
          auditCreates.push(args);
          return { id: "audit-1" };
        }
      }
    });

    const result = await reviewFeedback(
      { feedbackId: "feedback-1", status: "REVIEWED", note: "duplicate resolved" },
      adminContext,
      { db }
    );

    expect(result).toEqual({ id: "feedback-1", status: "REVIEWED" });
    expect(feedbackUpdates).toEqual([
      {
        where: { id: "feedback-1" },
        data: { status: "REVIEWED" }
      }
    ]);
    expect(auditCreates).toEqual([
      {
        data: {
          adminUserId: "admin-1",
          action: "REVIEW_FEEDBACK",
          targetType: "Feedback",
          targetId: "feedback-1",
          ip: "127.0.0.1",
          userAgent: "vitest",
          metadata: {
            feedbackId: "feedback-1",
            status: "REVIEWED",
            note: "duplicate resolved"
          }
        }
      }
    ]);
  });

  it("rejects unsupported feedback statuses", async () => {
    const db = createDb();

    await expect(
      reviewFeedback({ feedbackId: "feedback-1", status: "OPEN", note: "no-op" }, adminContext, { db })
    ).rejects.toThrow("Invalid feedback review status");
  });

  it("reviews recommended companies without moving them into frontend company data", async () => {
    const recommendedCompanyUpdates: Array<unknown> = [];
    const auditCreates: Array<unknown> = [];
    const db = createDb({
      recommendedCompany: {
        async update(args) {
          recommendedCompanyUpdates.push(args);
          return { id: "recommendation-1", status: "CLOSED" };
        }
      },
      adminAuditEvent: {
        async create(args) {
          auditCreates.push(args);
          return { id: "audit-1" };
        }
      }
    });

    const result = await reviewRecommendedCompany(
      { recommendationId: "recommendation-1", status: "CLOSED", note: "already tracked" },
      adminContext,
      { db, now: () => new Date("2026-07-08T12:00:00.000Z") }
    );

    expect(result).toEqual({ id: "recommendation-1", status: "CLOSED" });
    expect(recommendedCompanyUpdates).toEqual([
      {
        where: { id: "recommendation-1" },
        data: { status: "CLOSED", closedAt: new Date("2026-07-08T12:00:00.000Z") }
      }
    ]);
    expect(auditCreates).toEqual([
      {
        data: {
          adminUserId: "admin-1",
          action: "REVIEW_RECOMMENDED_COMPANY",
          targetType: "RecommendedCompany",
          targetId: "recommendation-1",
          ip: "127.0.0.1",
          userAgent: "vitest",
          metadata: {
            recommendationId: "recommendation-1",
            status: "CLOSED",
            note: "already tracked"
          }
        }
      }
    ]);
  });

  it("rejects unsupported recommended company statuses", async () => {
    const db = createDb();

    await expect(
      reviewRecommendedCompany(
        { recommendationId: "recommendation-1", status: "PENDING", note: "no-op" },
        adminContext,
        { db }
      )
    ).rejects.toThrow("Invalid recommended company review status");
  });

  it("applies human category corrections using domain labels and writes an audit event", async () => {
    const jobUpdates: Array<unknown> = [];
    const auditCreates: Array<unknown> = [];
    const correctedAt = new Date("2026-07-08T09:00:00.000Z");
    const db = createDb({
      job: {
        async update(args) {
          jobUpdates.push(args);
          return { id: "job-1" };
        }
      },
      adminAuditEvent: {
        async create(args) {
          auditCreates.push(args);
          return { id: "audit-1" };
        }
      }
    });

    const result = await applyJobCategoryCorrection(
      {
        jobId: "job-1",
        category: "医学事务",
        secondaryCategory: "市场",
        reason: "human review"
      },
      adminContext,
      { db, now: () => correctedAt }
    );

    expect(result).toEqual({ id: "job-1" });
    expect(jobUpdates).toEqual([
      {
        where: { id: "job-1" },
        data: {
          humanCorrectedCategory: "MEDICAL_AFFAIRS",
          humanCorrectedSecondaryCategory: "MARKETING",
          humanCorrectionReason: "human review",
          humanCorrectedAt: correctedAt
        }
      }
    ]);
    expect(auditCreates).toEqual([
      {
        data: {
          adminUserId: "admin-1",
          action: "APPLY_JOB_CATEGORY_CORRECTION",
          targetType: "Job",
          targetId: "job-1",
          ip: "127.0.0.1",
          userAgent: "vitest",
          metadata: {
            jobId: "job-1",
            category: "医学事务",
            secondaryCategory: "市场",
            reason: "human review"
          }
        }
      }
    ]);
  });

  it("clears an existing secondary category correction when no secondary category is supplied", async () => {
    const jobUpdates: Array<unknown> = [];
    const auditCreates: Array<unknown> = [];
    const correctedAt = new Date("2026-07-08T11:00:00.000Z");
    const db = createDb({
      job: {
        async update(args) {
          jobUpdates.push(args);
          return { id: "job-2" };
        }
      },
      adminAuditEvent: {
        async create(args) {
          auditCreates.push(args);
          return { id: "audit-2" };
        }
      }
    });

    const result = await applyJobCategoryCorrection(
      {
        jobId: "job-2",
        category: "销售",
        reason: "clear stale secondary category"
      },
      adminContext,
      { db, now: () => correctedAt }
    );

    expect(result).toEqual({ id: "job-2" });
    expect(jobUpdates).toEqual([
      {
        where: { id: "job-2" },
        data: {
          humanCorrectedCategory: "SALES",
          humanCorrectedSecondaryCategory: null,
          humanCorrectionReason: "clear stale secondary category",
          humanCorrectedAt: correctedAt
        }
      }
    ]);
    expect(auditCreates).toEqual([
      {
        data: {
          adminUserId: "admin-1",
          action: "APPLY_JOB_CATEGORY_CORRECTION",
          targetType: "Job",
          targetId: "job-2",
          ip: "127.0.0.1",
          userAgent: "vitest",
          metadata: {
            jobId: "job-2",
            category: "销售",
            reason: "clear stale secondary category"
          }
        }
      }
    ]);
  });

  it("lists source health from observations and counts without exposing raw job rows", async () => {
    const findManyArgs: Array<unknown> = [];
    const db = createDb({
      recruitmentSource: {
        async findMany(args) {
          findManyArgs.push(args);
          return [
            {
              id: "source-1",
              companyId: "company-1",
              status: "VERIFIED_SCRAPABLE",
              company: {
                officialChineseName: "测试药企"
              },
              crawlObservations: [
                {
                  crawledAt: new Date("2026-07-08T10:00:00.000Z"),
                  successful: false,
                  structuredJobCount: 3,
                  failureReason: "timeout"
                },
                {
                  crawledAt: new Date("2026-07-08T08:00:00.000Z"),
                  successful: false,
                  structuredJobCount: 1,
                  failureReason: "timeout"
                },
                {
                  crawledAt: new Date("2026-07-07T10:00:00.000Z"),
                  successful: true,
                  structuredJobCount: 4,
                  failureReason: null
                }
              ],
              _count: {
                jobs: 11
              }
            }
          ];
        }
      }
    });

    const result = await listSourceHealth({ db });

    expect(findManyArgs).toEqual([
      {
        include: {
          company: {
            select: {
              officialChineseName: true
            }
          },
          crawlObservations: {
            orderBy: {
              crawledAt: "desc"
            },
            select: {
              crawledAt: true,
              successful: true,
              structuredJobCount: true,
              failureReason: true
            }
          },
          _count: {
            select: {
              jobs: true
            }
          }
        }
      }
    ]);
    expect(result).toEqual([
      {
        sourceId: "source-1",
        companyId: "company-1",
        companyName: "测试药企",
        verificationStatus: "VERIFIED_SCRAPABLE",
        structuredJobCount: 11,
        consecutiveFailureCount: 2,
        latestObservation: {
          crawledAt: new Date("2026-07-08T10:00:00.000Z"),
          successful: false,
          structuredJobCount: 3,
          failureReason: "timeout"
        }
      }
    ]);
  });
});

function createDb(overrides: Partial<AdminOperationsDb> = {}): AdminOperationsDb {
  return {
    manualCrawlRequest: {
      async create() {
        throw new Error("manualCrawlRequest.create not stubbed");
      },
      ...overrides.manualCrawlRequest
    },
    adminAuditEvent: {
      async create() {
        throw new Error("adminAuditEvent.create not stubbed");
      },
      ...overrides.adminAuditEvent
    },
    feedback: {
      async update() {
        throw new Error("feedback.update not stubbed");
      },
      ...overrides.feedback
    },
    recommendedCompany: {
      async update() {
        throw new Error("recommendedCompany.update not stubbed");
      },
      ...overrides.recommendedCompany
    },
    job: {
      async update() {
        throw new Error("job.update not stubbed");
      },
      ...overrides.job
    },
    recruitmentSource: {
      async findMany() {
        return [];
      },
      ...overrides.recruitmentSource
    }
  };
}
