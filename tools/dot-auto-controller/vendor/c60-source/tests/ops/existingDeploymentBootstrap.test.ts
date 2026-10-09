import { describe, expect, it, vi } from "vitest";
import { bootstrapExistingDeployment } from "../../src/ops/deploymentBootstrap";

const HASH = `scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
const config = { databaseUrl: "postgresql://db/test", adminEmail: "owner@example.com", adminPasswordHash: HASH };

describe("explicit existing-database bootstrap", () => {
  it("preflights before administrator writes and preserves audited idempotence", async () => {
    const events: string[] = [];
    const preflight = vi.fn(async () => { events.push("preflight"); });
    const findUnique = vi.fn().mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "admin-1", email: config.adminEmail, passwordHash: HASH, disabledAt: null });
    const create = vi.fn(async () => ({ id: "admin-1" }));
    const auditCreate = vi.fn(async () => ({}));
    const lock = vi.fn(async () => { events.push("lock"); });
    const db = { $executeRawUnsafe: lock, adminUser: { findUnique, create }, adminAuditEvent: { create: auditCreate } };
    const transaction = async <T>(operation: (db: never) => Promise<T>) => { events.push("transaction"); return operation(db as never); };
    await expect(bootstrapExistingDeployment(config, { preflight, transaction })).resolves.toMatchObject({ created: true });
    await expect(bootstrapExistingDeployment(config, { preflight, transaction })).resolves.toMatchObject({ created: false });
    expect(events).toEqual(["preflight", "transaction", "lock", "preflight", "transaction", "lock"]);
    expect(create).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it("refuses before administrator transactions when history preflight fails", async () => {
    const transaction = vi.fn();
    const preflight = vi.fn(async () => { throw new Error("Existing-database-only preflight refused"); });
    await expect(bootstrapExistingDeployment(config, { preflight, transaction })).rejects.toThrow(/existing-database-only/i);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("explicit existing-only entry-point contracts", () => {
  it("exports offline-importable bootstrap and read-only preflight commands", async () => {
    const bootstrap = await import("../../scripts/ops-bootstrap-existing");
    const preflight = await import("../../scripts/ops-preflight-existing");
    const migrate = await import("../../scripts/ops-migrate");
    expect(bootstrap.runExistingDeploymentBootstrap).toBeTypeOf("function");
    expect(preflight.runExistingDatabasePreflight).toBeTypeOf("function");
    expect(migrate.runGuardedMigration).toBeTypeOf("function");
  });
});
