import { describe, expect, it, vi } from "vitest";
import { checkDeploymentReadiness, createCachedDeploymentReadiness } from "../../src/server/deploymentReadiness";

const EXPECTED = [
  { migrationName: "001", checksum: "a".repeat(64) },
  { migrationName: "002", checksum: "b".repeat(64) }
];
const migrationRows = EXPECTED.map(({ migrationName, checksum }) => ({
  migration_name: migrationName, checksum, finished_at: new Date("2026-08-13T00:00:00Z"), rolled_back_at: null
}));
const base = {
  databaseUrl: "postgresql://user:password@db/jobfinder",
  expectedMigrations: EXPECTED,
  adminEmail: "owner@example.com",
  adminPasswordHash: `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`
};

describe("deployment readiness", () => {
  it("is ready only when database, exact local migrations, and configured administrator agree", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: migrationRows })
      .mockResolvedValueOnce({ rows: [{ initialized: true }] });
    await expect(checkDeploymentReadiness({ ...base,
      createClient: () => ({ connect: async () => undefined, query, end: async () => undefined })
    })).resolves.toBe(true);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('"passwordHash" = $2'), [
      base.adminEmail, base.adminPasswordHash
    ]);
  });

  it.each([
    ["missing migration", migrationRows.slice(0, 1), [{ initialized: true }]],
    ["unfinished migration", [...migrationRows, { migration_name: "003", checksum: "c".repeat(64), finished_at: null, rolled_back_at: null }], [{ initialized: true }]],
    ["checksum drift", [{ ...migrationRows[0], checksum: "0".repeat(64) }, migrationRows[1]], [{ initialized: true }]],
    ["missing administrator", migrationRows, [{ initialized: false }]]
  ])("fails closed for %s", async (_label, migrations, admins) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: migrations }).mockResolvedValueOnce({ rows: admins });
    await expect(checkDeploymentReadiness({ ...base,
      createClient: () => ({ connect: async () => undefined, query, end: async () => undefined })
    })).resolves.toBe(false);
  });

  it("allows an explicitly rolled-back historical attempt when each local migration has one successful row", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { migration_name: "001", checksum: "0".repeat(64), finished_at: null, rolled_back_at: new Date("2026-08-12T00:00:00Z") },
        ...migrationRows
      ] })
      .mockResolvedValueOnce({ rows: [{ initialized: true }] });
    await expect(checkDeploymentReadiness({ ...base,
      createClient: () => ({ connect: async () => undefined, query, end: async () => undefined })
    })).resolves.toBe(true);
  });

  it("fails closed when the database connection is unavailable", async () => {
    const query = vi.fn();
    await expect(checkDeploymentReadiness({ ...base,
      createClient: () => ({
        connect: async () => { throw new Error("connection refused"); },
        query,
        end: async () => undefined
      })
    })).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("fails closed when cleanup rejects or hangs and coalesces concurrent checks", async () => {
    const query = vi.fn()
      .mockResolvedValue({ rows: migrationRows })
      .mockResolvedValueOnce({ rows: migrationRows })
      .mockResolvedValueOnce({ rows: [{ initialized: true }] });
    await expect(checkDeploymentReadiness({ ...base, timeoutMs: 20,
      createClient: () => ({ connect: async () => undefined, query, end: async () => { throw new Error("end"); } })
    })).resolves.toBe(false);

    let connectCalls = 0;
    const cached = createCachedDeploymentReadiness({ ...base,
      createClient: () => ({
        connect: async () => { connectCalls += 1; },
        query: vi.fn().mockResolvedValueOnce({ rows: migrationRows }).mockResolvedValueOnce({ rows: [{ initialized: true }] }),
        end: async () => undefined
      })
    });
    await expect(Promise.all([cached(), cached(), cached()])).resolves.toEqual([true, true, true]);
    expect(connectCalls).toBe(1);
  });

  it("requires the full production bootstrap configuration", async () => {
    await expect(checkDeploymentReadiness({ ...base, adminPasswordHash: "" })).resolves.toBe(false);
  });
});
