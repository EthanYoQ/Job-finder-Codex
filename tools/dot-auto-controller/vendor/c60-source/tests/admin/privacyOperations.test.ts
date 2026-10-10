import { describe, expect, it, vi } from "vitest";
import { processPrivacyRequest } from "../../src/admin/privacyOperations";

const context = { adminUserId: "admin-1", ip: "127.0.0.1", userAgent: "vitest" };

describe("privacy admin operations", () => {
  it("exports only portable feedback fields after exact contact verification", async () => {
    const audit = vi.fn(async () => ({}));
    const rows = [{ id: "p1", issueType: "PRIVACY_EXPORT", description: "export", status: "OPEN", createdAt: new Date("2026-07-01T00:00:00Z"), closedAt: null, companyId: null, jobId: null }];
    const tx = {
      feedback: {
        findUnique: vi.fn(async () => ({ ...rows[0], contact: "user@example.cn" })),
        findMany: vi.fn(async () => rows), updateMany: vi.fn()
      },
      adminAuditEvent: { create: audit }
    };
    const result = await processPrivacyRequest({ requestId: "p1", action: "EXPORT", verifiedContact: "user@example.cn" }, context, {
      db: { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } as never
    });
    expect(result).toMatchObject({ action: "EXPORT", requestId: "p1", records: rows });
    expect(JSON.stringify(result)).not.toContain("127.0.0.1");
    expect(audit).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ recordCount: 1, idsSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) }) });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("user@example.cn");
  });

  it("fails closed on wrong contact or non-privacy request", async () => {
    for (const request of [
      { issueType: "PRIVACY_DELETE", contact: "user@example.cn" },
      { issueType: "普通反馈", contact: "user@example.cn" }
    ]) {
      const updateMany = vi.fn();
      const tx = { feedback: { findUnique: vi.fn(async () => ({ id: "p1", ...request })), findMany: vi.fn(), updateMany }, adminAuditEvent: { create: vi.fn() } };
      await expect(processPrivacyRequest({ requestId: "p1", action: "DELETE", verifiedContact: request.issueType === "普通反馈" ? "user@example.cn" : "wrong@example.cn" }, context, {
        db: { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } as never
      })).rejects.toThrow("PRIVACY_REQUEST_VERIFICATION_FAILED");
      expect(updateMany).not.toHaveBeenCalled();
    }
  });

  it("does not let an admin change the action requested by the user", async () => {
    const tx = {
      feedback: {
        findUnique: vi.fn(async () => ({ id: "p1", issueType: "PRIVACY_EXPORT", contact: "user@example.cn" })),
        findMany: vi.fn(), updateMany: vi.fn()
      }, adminAuditEvent: { create: vi.fn() }
    };
    await expect(processPrivacyRequest({ requestId: "p1", action: "DELETE", verifiedContact: "user@example.cn" }, context, {
      db: { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } as never
    })).rejects.toThrow("PRIVACY_REQUEST_VERIFICATION_FAILED");
    expect(tx.feedback.updateMany).not.toHaveBeenCalled();
  });

  it("anonymizes matching feedback and closes the request in one transaction", async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const audit = vi.fn(async () => ({}));
    const tx = {
      feedback: {
        findUnique: vi.fn(async () => ({ id: "p1", issueType: "PRIVACY_DELETE", contact: "user@example.cn" })),
        findMany: vi.fn(async () => [{ id: "p1" }, { id: "f2" }]), updateMany
      }, adminAuditEvent: { create: audit }
    };
    const now = new Date("2026-07-13T00:00:00Z");
    const result = await processPrivacyRequest({ requestId: "p1", action: "DELETE", verifiedContact: "user@example.cn" }, context, {
      db: { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } as never, now: () => now
    });
    expect(result).toEqual({ action: "DELETE", requestId: "p1", anonymizedCount: 2 });
    expect(updateMany).toHaveBeenCalledWith({ where: { contact: "user@example.cn" }, data: expect.objectContaining({ contact: null, status: "CLOSED", closedAt: now }) });
    expect(JSON.stringify(audit.mock.calls)).not.toContain("user@example.cn");
  });
});
