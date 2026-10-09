import { describe, expect, it, vi } from "vitest";
import {
  assertActiveAdminSession,
  createAdminSession,
  hashAdminPassword,
  verifyAdminPassword,
  type AdminAuthDb,
  type AdminSessionContext
} from "../../src/admin/auth";

type SessionRecord = {
  id: string;
  adminUserId: string;
  tokenHash: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  ip: string;
  userAgent: string;
  expiresAt: Date;
  adminUser: {
    id: string;
    disabledAt: Date | null;
  };
};

function buildSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    adminUserId: "admin-1",
    tokenHash: "token-hash",
    status: "ACTIVE",
    ip: "127.0.0.1",
    userAgent: "vitest",
    expiresAt: new Date("2026-07-09T00:00:00.000Z"),
    adminUser: {
      id: "admin-1",
      disabledAt: null
    },
    ...overrides
  };
}

function fakeDb(session?: SessionRecord | null): AdminAuthDb & {
  created: unknown[];
  findUnique: ReturnType<typeof vi.fn>;
} {
  const created: unknown[] = [];
  const findUnique = vi.fn(() => Promise.resolve(session ?? null));

  return {
    created,
    findUnique,
    adminSession: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        created.push(args);

        return Promise.resolve({
          id: "session-1",
          ...args.data
        });
      }),
      findUnique
    }
  };
}

describe("admin auth", () => {
  const context: AdminSessionContext = { ip: "127.0.0.1", userAgent: "vitest" };

  it("hashes and verifies admin passwords without storing the plaintext", async () => {
    const encoded = await hashAdminPassword("correct horse battery staple", "fixed-salt");

    expect(encoded).toMatch(/^scrypt\$fixed-salt\$[a-f0-9]+$/);
    expect(encoded).not.toContain("correct horse battery staple");
    await expect(verifyAdminPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("creates an active admin session with a hashed token and exact 24 hour expiry", async () => {
    const db = fakeDb();
    const now = new Date("2026-07-08T00:00:00.000Z");
    const result = await createAdminSession("admin-1", context, {
      db,
      now: () => now,
      randomToken: () => "raw-token"
    });

    expect(result.token).toBe("raw-token");
    expect(db.created).toHaveLength(1);
    expect(db.created[0]).toMatchObject({
      data: {
        adminUserId: "admin-1",
        status: "ACTIVE",
        ip: "127.0.0.1",
        userAgent: "vitest",
        expiresAt: new Date("2026-07-09T00:00:00.000Z")
      }
    });
    expect(JSON.stringify(db.created[0])).not.toContain("raw-token");
    expect((db.created[0] as { data: { tokenHash: string } }).data.tokenHash).toHaveLength(64);
  });

  it("returns the session when the token hash, status, expiry, and context are valid", async () => {
    const db = fakeDb(buildSession());
    const session = await assertActiveAdminSession("token", context, {
      db,
      now: () => new Date("2026-07-08T00:00:00.000Z")
    });

    expect(session.adminUserId).toBe("admin-1");
    expect(db.findUnique).toHaveBeenCalledWith({
      where: {
        tokenHash: "3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0"
      },
      include: {
        adminUser: true
      }
    });
  });

  it("rejects a missing session", async () => {
    await expect(assertActiveAdminSession("token", context, { db: fakeDb() })).rejects.toThrow(
      "Admin session is not active"
    );
  });

  it("rejects a revoked session", async () => {
    await expect(
      assertActiveAdminSession("token", context, {
        db: fakeDb(buildSession({ status: "REVOKED" })),
        now: () => new Date("2026-07-08T00:00:00.000Z")
      })
    ).rejects.toThrow("Admin session is not active");
  });

  it("rejects an expired session", async () => {
    await expect(
      assertActiveAdminSession("token", context, {
        db: fakeDb(buildSession({ expiresAt: new Date("2026-07-08T00:00:00.000Z") })),
        now: () => new Date("2026-07-08T00:00:00.000Z")
      })
    ).rejects.toThrow("Admin session is not active");
  });

  it("rejects a disabled admin user", async () => {
    await expect(
      assertActiveAdminSession("token", context, {
        db: fakeDb(
          buildSession({
            adminUser: {
              id: "admin-1",
              disabledAt: new Date("2026-07-08T00:00:00.000Z")
            }
          })
        ),
        now: () => new Date("2026-07-08T00:00:00.000Z")
      })
    ).rejects.toThrow("Admin session is not active");
  });

  it("rejects a session with mismatched ip", async () => {
    await expect(
      assertActiveAdminSession("token", context, {
        db: fakeDb(buildSession({ ip: "127.0.0.2" })),
        now: () => new Date("2026-07-08T00:00:00.000Z")
      })
    ).rejects.toThrow("Admin session is not active");
  });

  it("rejects a session with mismatched user agent", async () => {
    await expect(
      assertActiveAdminSession("token", context, {
        db: fakeDb(buildSession({ userAgent: "other-agent" })),
        now: () => new Date("2026-07-08T00:00:00.000Z")
      })
    ).rejects.toThrow("Admin session is not active");
  });
});
