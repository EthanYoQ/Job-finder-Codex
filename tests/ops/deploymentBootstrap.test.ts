import { describe, expect, it, vi } from "vitest";
import { bootstrapDeployment, resolveDeploymentBootstrapConfig } from "../../src/ops/deploymentBootstrap";

const HASH = `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;

describe("deployment bootstrap", () => {
  it("migrates before creating one auditable administrator and is idempotent", async () => {
    const migrate = vi.fn(async () => undefined);
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "admin-1", email: "owner@example.com", passwordHash: HASH, disabledAt: null });
    const create = vi.fn(async () => ({ id: "admin-1" }));
    const auditCreate = vi.fn(async () => ({}));
    const lock = vi.fn(async () => undefined);
    const deps = {
      migrate,
      db: {
        $executeRawUnsafe: lock,
        adminUser: { findUnique, create },
        adminAuditEvent: { create: auditCreate }
      },
      transaction: async <T>(operation: (db: never) => Promise<T>) => operation(deps.db as never)
    };
    const config = resolveDeploymentBootstrapConfig({
      DATABASE_URL: "postgresql://user:password@db/jobfinder",
      ADMIN_EMAIL: "owner@example.com",
      ADMIN_PASSWORD_HASH: HASH,
      NODE_ENV: "production"
    });

    await expect(bootstrapDeployment(config, deps)).resolves.toMatchObject({ created: true });
    await expect(bootstrapDeployment(config, deps)).resolves.toMatchObject({ created: false });
    expect(migrate).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledTimes(2);
  });

  it("rejects missing, placeholder, or malformed production configuration without exposing secrets", () => {
    for (const env of [
      {},
      { DATABASE_URL: "postgresql://user:secret@db/jobfinder", ADMIN_EMAIL: "admin@example.com", ADMIN_PASSWORD_HASH: "placeholder", NODE_ENV: "production" },
      { DATABASE_URL: "postgresql://user:secret@db/jobfinder", ADMIN_EMAIL: "not-email", ADMIN_PASSWORD_HASH: HASH, NODE_ENV: "production" }
    ]) {
      expect(() => resolveDeploymentBootstrapConfig(env)).toThrow(/configuration/i);
      try { resolveDeploymentBootstrapConfig(env); } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    }
  });
});
