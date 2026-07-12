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
});
