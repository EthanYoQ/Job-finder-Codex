import { describe, expect, it, vi } from "vitest";
import { createFeedback, createRecommendedCompany } from "../../src/server/feedbackService";

describe("anonymous feedback service", () => {
  it("stores feedback and recommended company submissions with abuse signals", async () => {
    const feedbackCreates: unknown[] = [];
    const recommendedCreates: unknown[] = [];
    const db = {
      feedback: {
        create: vi.fn(async (args) => {
          feedbackCreates.push(args);
          return { id: "f1" };
        })
      },
      recommendedCompany: {
        create: vi.fn(async (args) => {
          recommendedCreates.push(args);
          return { id: "r1" };
        })
      }
    };
    const context = { ip: "1.2.3.4", userAgent: "Mozilla/5.0" };

    await expect(
      createFeedback({ issueType: "错误链接", description: "官方链接打不开", companyId: "c1", jobId: "j1" }, context, db)
    ).resolves.toEqual({ id: "f1", status: "OPEN" });
    await expect(
      createRecommendedCompany({ companyName: "测试药企", officialWebsiteUrl: "https://example.cn" }, context, db)
    ).resolves.toEqual({ id: "r1", status: "OPEN" });
    expect(feedbackCreates[0]).toMatchObject({
      data: { ip: "1.2.3.4", userAgent: "Mozilla/5.0", companyId: "c1", jobId: "j1" }
    });
    expect(recommendedCreates[0]).toMatchObject({
      data: { ip: "1.2.3.4", userAgent: "Mozilla/5.0", companyName: "测试药企" }
    });
  });
});
