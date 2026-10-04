import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { formatMigrationProcessFailure } from "../../scripts/ops-bootstrap";

describe("deployment bootstrap migration diagnostics", () => {
  it("preserves bounded actionable failure context without exposing database credentials", () => {
    const databaseUrl = "postgresql://jobfinder:formal-qualification-password@postgres/jobfinder?schema=public";
    const message = formatMigrationProcessFailure({
      status: 1,
      signal: null,
      stderr: `P1001 cannot reach ${databaseUrl}\nsecondary postgresql://other:secret@postgres/other`
    }, databaseUrl);

    expect(message).toContain("status=1");
    expect(message).toContain("P1001");
    expect(message).toContain("[REDACTED_DATABASE_URL]");
    expect(message).toContain("postgresql://[REDACTED_URI]");
    expect(message).not.toContain("formal-qualification-password");
    expect(message).not.toContain("other:secret");
  });

  it("redacts normalized PostgreSQL credentials and bounds diagnostics", () => {
    const databaseUrl = "postgresql://user:p%40ss@postgres/jobfinder?schema=public";
    const message = formatMigrationProcessFailure({
      status: 1,
      signal: null,
      stderr: `postgre\u001b[31msql://user:p@ss@postgres/jobfinder ${"x".repeat(2_100)}`
    }, databaseUrl);

    expect(message.length).toBeLessThanOrEqual(
      "Database migration failed (status=1, signal=none, error=none): ".length + 2_000
    );
    expect(message).not.toContain("p%40ss");
    expect(message).not.toContain("p@ss");
    expect(message).not.toContain("\u001b");
    expect(message).toContain("postgresql://[REDACTED_URI]");
  });

  it("reports spawn-level failures without inventing stderr", () => {
    const error = Object.assign(new Error("spawn failed"), { code: "ETIMEDOUT" });
    expect(formatMigrationProcessFailure({ status: null, signal: "SIGTERM", stderr: "", error }, "postgresql://redacted"))
      .toBe("Database migration failed (status=null, signal=SIGTERM, error=ETIMEDOUT): no stderr");
  });
});

describe("guarded generic migration execution", () => {
  it("refuses this existing-only migration tree before spawning Prisma", async () => {
    const { runDeploymentMigrations } = await import("../../scripts/ops-bootstrap");
    const spawn = vi.fn();
    expect(() => runDeploymentMigrations("postgresql://user:secret@db/jobfinder", process.cwd(), spawn))
      .toThrow(/existing-database-only/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("preserves migration execution for a supported history without recovery-only SQL", async () => {
    const { runDeploymentMigrations } = await import("../../scripts/ops-bootstrap");
    const root = mkdtempSync(join(tmpdir(), "supported-migration-history-"));
    try {
      mkdirSync(join(root, "prisma/migrations/20260710000000_baseline"), { recursive: true });
      writeFileSync(join(root, "prisma/migrations/20260710000000_baseline/migration.sql"), "SELECT 1;\n");
      const spawn = vi.fn(() => ({ status: 0, signal: null, stderr: "" }));
      expect(() => runDeploymentMigrations("postgresql://user:secret@db/jobfinder", root, spawn)).not.toThrow();
      expect(spawn).toHaveBeenCalledOnce();
      expect(spawn).toHaveBeenCalledWith(process.execPath, [
        resolve(root, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", "prisma/schema.prisma"
      ], expect.objectContaining({ cwd: root, shell: false }));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
