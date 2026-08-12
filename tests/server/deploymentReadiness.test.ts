import { describe, expect, it, vi } from "vitest";
import { checkDeploymentReadiness } from "../../src/server/deploymentReadiness";

describe("deployment readiness", () => {
  it("is ready only when database, all local migrations, and administrator initialization agree", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ migration_name: "001" }, { migration_name: "002" }] })
      .mockResolvedValueOnce({ rows: [{ initialized: true }] });
    await expect(checkDeploymentReadiness({
      databaseUrl: "postgresql://user:password@db/jobfinder",
      expectedMigrationNames: ["001", "002"],
      adminEmail: "owner@example.com",
      createClient: () => ({ connect: async () => undefined, query, end: async () => undefined })
    })).resolves.toBe(true);
  });

  it.each([
    ["missing migration", [{ migration_name: "001" }], [{ initialized: true }]],
    ["missing administrator", [{ migration_name: "001" }, { migration_name: "002" }], [{ initialized: false }]]
  ])("fails closed for %s", async (_label, migrationRows, adminRows) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: migrationRows }).mockResolvedValueOnce({ rows: adminRows });
    await expect(checkDeploymentReadiness({
      databaseUrl: "postgresql://user:password@db/jobfinder",
      expectedMigrationNames: ["001", "002"],
      adminEmail: "owner@example.com",
      createClient: () => ({ connect: async () => undefined, query, end: async () => undefined })
    })).resolves.toBe(false);
  });
});
