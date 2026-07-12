import { describe, expect, it, vi } from "vitest";
import { runPrivacyRetention } from "../../src/server/privacyRetention";

describe("privacy retention", () => {
  it("uses event time and closedAt cutoffs and returns aggregate counts", async () => {
    const access = vi.fn(async () => ({ count: 3 }));
    const feedback = vi.fn(async () => ({ count: 2 }));
    const recommendation = vi.fn(async () => ({ count: 1 }));
    const audit = vi.fn(async () => ({ count: 4 }));
    const now = new Date("2026-07-13T00:00:00Z");
    const result = await runPrivacyRetention({
      accessEvent: { deleteMany: access },
      feedback: { updateMany: feedback },
      recommendedCompany: { updateMany: recommendation },
      adminAuditEvent: { deleteMany: audit }
    }, now);
    expect(result).toEqual({ accessEventsDeleted: 3, feedbackAnonymized: 2, recommendationsAnonymized: 1, adminAuditEventsDeleted: 4 });
    expect(access).toHaveBeenCalledWith({ where: { occurredAt: { lt: new Date("2026-04-14T00:00:00.000Z") } } });
    expect(feedback).toHaveBeenCalledWith({ where: expect.objectContaining({ status: "CLOSED", closedAt: { lt: new Date("2026-01-14T00:00:00.000Z") } }), data: expect.objectContaining({ contact: null }) });
    expect(recommendation).toHaveBeenCalledWith({ where: expect.objectContaining({ status: "CLOSED", closedAt: { lt: new Date("2026-01-14T00:00:00.000Z") } }), data: expect.objectContaining({ ip: "ANONYMIZED" }) });
    expect(audit).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date("2024-07-13T00:00:00.000Z") } } });
  });

  it("makes a second run over the same state report zero changes", async () => {
    let accessExists = true;
    let auditExists = true;
    const feedback = { contact: "user@example.cn" as string | null, description: "closed", ip: "1.2.3.4", userAgent: "ua" };
    const recommendation = { companyName: "Company", officialWebsiteUrl: "https://example.cn" as string | null, recruitmentEntryUrl: null, reason: null, ip: "1.2.3.4", userAgent: "ua" };
    const db = {
      accessEvent: { deleteMany: async () => { const count = accessExists ? 1 : 0; accessExists = false; return { count }; } },
      adminAuditEvent: { deleteMany: async () => { const count = auditExists ? 1 : 0; auditExists = false; return { count }; } },
      feedback: { updateMany: async (args: { data: Record<string, unknown> }) => {
        const changed = feedback.contact !== null || feedback.description !== "[RETENTION_ANONYMIZED]" || feedback.ip !== "ANONYMIZED" || feedback.userAgent !== "ANONYMIZED";
        if (changed) Object.assign(feedback, args.data);
        return { count: changed ? 1 : 0 };
      } },
      recommendedCompany: { updateMany: async (args: { data: Record<string, unknown> }) => {
        const changed = recommendation.companyName !== "[RETENTION_ANONYMIZED]" || recommendation.officialWebsiteUrl !== null || recommendation.ip !== "ANONYMIZED" || recommendation.userAgent !== "ANONYMIZED";
        if (changed) Object.assign(recommendation, args.data);
        return { count: changed ? 1 : 0 };
      } }
    };
    const first = await runPrivacyRetention(db, new Date("2026-07-13T00:00:00Z"));
    const second = await runPrivacyRetention(db, new Date("2026-07-13T00:00:00Z"));
    expect(first).toEqual({ accessEventsDeleted: 1, feedbackAnonymized: 1, recommendationsAnonymized: 1, adminAuditEventsDeleted: 1 });
    expect(second).toEqual({ accessEventsDeleted: 0, feedbackAnonymized: 0, recommendationsAnonymized: 0, adminAuditEventsDeleted: 0 });
  });
});
