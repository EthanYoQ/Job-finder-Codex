import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleAdminApi } from "../../src/server/adminApi";

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createDb() {
  return {
    adminUser: { findUnique: vi.fn(async () => null) },
    adminSession: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({
        id: "session-1",
        adminUserId: "admin-1",
        tokenHash: tokenHash("valid-token"),
        status: "ACTIVE" as const,
        ip: "127.0.0.1",
        userAgent: "vitest",
        expiresAt: new Date("2026-07-09T00:00:00.000Z"),
        adminUser: { id: "admin-1", disabledAt: null }
      }))
    },
    manualCrawlRequest: { create: vi.fn(async () => ({ id: "manual-1" })) },
    adminAuditEvent: { create: vi.fn(async () => ({})) },
    feedback: {
      create: vi.fn(async () => ({ id: "feedback-1" })),
      update: vi.fn(async () => ({ id: "feedback-1", status: "REVIEWED" })),
      findMany: vi.fn(async () => [
        {
          id: "feedback-1",
          issueType: "职位信息有误",
          description: "城市写错",
          status: "OPEN",
          createdAt: new Date("2026-07-08T09:00:00.000Z"),
          companyId: "company-1",
          jobId: "job-1"
        }
      ])
    },
    recommendedCompany: {
      create: vi.fn(async () => ({ id: "recommendation-1" })),
      update: vi.fn(async () => ({ id: "recommendation-1", status: "REVIEWED" })),
      findMany: vi.fn(async () => [
        {
          id: "recommendation-1",
          companyName: "礼来",
          officialWebsiteUrl: "https://www.lilly.com/cn",
          recruitmentEntryUrl: null,
          reason: "补充覆盖",
          status: "OPEN",
          createdAt: new Date("2026-07-08T08:00:00.000Z")
        }
      ])
    },
    job: {
      findMany: vi.fn(async () => [
        {
          id: "job-other",
          officialTitle: "Unclassified Role",
          auxiliaryChineseTitle: "待分类职位",
          category: "OTHER",
          humanCorrectedCategory: null,
          company: { officialChineseName: "辉瑞" }
        }
      ]),
      update: vi.fn(async () => ({ id: "job-other" }))
    },
    recruitmentSource: {
      findMany: vi.fn(async () => [
        {
          id: "source-1",
          companyId: "company-1",
          status: "VERIFIED_SCRAPABLE" as const,
          company: { officialChineseName: "辉瑞" },
          crawlObservations: [
            {
              crawledAt: new Date("2026-07-08T10:00:00.000Z"),
              successful: true,
              structuredJobCount: 3,
              failureReason: null
            }
          ],
          _count: { jobs: 3 }
        }
      ])
    },
    crawlObservation: { findFirst: vi.fn(async () => null) },
    company: { findMany: vi.fn(async () => []) }
  };
}

function request(path: string, overrides: Partial<Parameters<typeof handleAdminApi>[0]> = {}) {
  return {
    method: "GET",
    path,
    headers: { authorization: "Bearer valid-token" },
    body: undefined,
    ip: "127.0.0.1",
    userAgent: "vitest",
    ...overrides
  };
}

describe("admin API", () => {
  it("returns dashboard data for an active admin session", async () => {
    const db = createDb();

    const response = await handleAdminApi(request("/admin/api/dashboard"), {
      db,
      now: () => new Date("2026-07-08T12:00:00.000Z")
    });

    expect(response.status).toBe(200);
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.body).toMatchObject({
      sources: [{ sourceId: "source-1", companyName: "辉瑞" }],
      feedbackQueue: [{ id: "feedback-1" }],
      recommendationQueue: [{ id: "recommendation-1" }],
      categoryCorrectionQueue: [{ jobId: "job-other", companyName: "辉瑞" }]
    });
    expect(db.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lifecycleStatus: "ACTIVE",
          visibleInFrontend: true,
          category: "OTHER",
          humanCorrectedCategory: null
        }
      })
    );
  });

  it("rejects invalid category corrections before admin operations run", async () => {
    const db = createDb();

    const response = await handleAdminApi(
      request("/admin/api/category-correction", {
        method: "POST",
        body: {
          jobId: "job-other",
          category: "不是合法类目",
          reason: "测试"
        }
      }),
      {
        db,
        now: () => new Date("2026-07-08T12:00:00.000Z")
      }
    );

    expect(response.status).toBe(400);
    expect(db.job.update).not.toHaveBeenCalled();
  });

  it("maps a duplicate active manual crawl from the default repository path to 409", async () => {
    const db = createDb() as ReturnType<typeof createDb> & { $transaction: Function };
    db.$transaction = async (callback: Function) => callback(manualCrawlTx({
      createError: Object.assign(new Error("duplicate"), {
        code: "P2002", meta: { constraint: "ManualCrawlRequest_one_active_per_source" }
      })
    }));
    const response = await handleAdminApi(request("/admin/api/manual-crawl", {
      method: "POST", body: { sourceId: "source-1", reason: "verify" }
    }), { db, now: () => new Date("2026-07-08T12:00:00.000Z") });
    expect(response).toMatchObject({ status: 409, body: { error: "ALREADY_ACTIVE" } });
  });

  it("maps a drifted ineligible manual crawl from the default repository path to 422", async () => {
    const db = createDb() as ReturnType<typeof createDb> & { $transaction: Function };
    db.$transaction = async (callback: Function) => callback(manualCrawlTx({ sourceStatus: "UNVERIFIED" }));
    const response = await handleAdminApi(request("/admin/api/manual-crawl", {
      method: "POST", body: { sourceId: "source-1", reason: "verify" }
    }), { db, now: () => new Date("2026-07-08T12:00:00.000Z") });
    expect(response).toMatchObject({ status: 422, body: { error: "NOT_EXECUTABLE" } });
  });

  it("processes a verified privacy export through the authenticated admin API", async () => {
    const db = createDb();
    const tx = {
      feedback: {
        findUnique: vi.fn(async () => ({ id: "privacy-1", issueType: "PRIVACY_EXPORT", contact: "user@example.cn" })),
        findMany: vi.fn(async () => [{
          id: "privacy-1", issueType: "PRIVACY_EXPORT", description: "export", status: "OPEN",
          createdAt: new Date("2026-07-08T00:00:00Z"), closedAt: null, companyId: null, jobId: null
        }]),
        updateMany: vi.fn()
      },
      adminAuditEvent: { create: vi.fn(async () => ({})) }
    };
    Object.assign(db, { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) });
    const response = await handleAdminApi(request("/admin/api/privacy-process", {
      method: "POST",
      body: { requestId: "privacy-1", action: "EXPORT", verifiedContact: "user@example.cn" }
    }), { db: db as never, now: () => new Date("2026-07-08T12:00:00Z") });
    expect(response).toMatchObject({ status: 200, body: { action: "EXPORT", requestId: "privacy-1" } });
    expect(tx.adminAuditEvent.create).toHaveBeenCalled();
  });
});

function manualCrawlTx(options: { createError?: unknown; sourceStatus?: string } = {}) {
  return {
    recruitmentSource: { findUnique: vi.fn(async () => ({
      id: "source-1", companyId: "company-roche-china", kind: "SOCIAL", atsKind: "MOKA",
      status: options.sourceStatus ?? "VERIFIED_SCRAPABLE"
    })) },
    manualCrawlRequest: { create: vi.fn(async () => {
      if (options.createError) throw options.createError;
      return { id: "manual-1" };
    }) },
    manualCrawlRequestEvent: { create: vi.fn(async () => ({})) },
    adminAuditEvent: { create: vi.fn(async () => ({})) }
  };
}
