import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  REVIEWED_APP_TABLE_NAMES,
  REVIEWED_FUNCTION_NAMES,
  REVIEWED_INDEX_NAMES,
  REVIEWED_INDEX_DEFINITION_SHA256,
  REVIEWED_MIGRATION_NAMES,
  REVIEWED_USER_TYPE_NAMES,
  createEmptyDatabaseVerificationDeps,
  verifyReviewedMigrationTree
} from "../../src/db/emptyDatabaseMigrationVerificationCli";

describe("empty database migration verification CLI contract", () => {
  it("uses explicit reviewed 13-migration and 20-table allowlists matching the repository", () => {
    const actualMigrations = readdirSync(resolve(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(REVIEWED_MIGRATION_NAMES).toHaveLength(13);
    expect([...REVIEWED_MIGRATION_NAMES].sort()).toEqual(actualMigrations);
    expect(REVIEWED_APP_TABLE_NAMES).toHaveLength(20);
    expect(new Set(REVIEWED_APP_TABLE_NAMES).size).toBe(20);
    expect(REVIEWED_USER_TYPE_NAMES).toHaveLength(26);
    expect(REVIEWED_FUNCTION_NAMES).toHaveLength(12);
    expect(REVIEWED_FUNCTION_NAMES).toEqual(expect.arrayContaining([
      "prevent_transport_attempt_artifact_mutation",
      "prevent_transport_attempt_mutation",
      "require_transport_attempt_artifact_ref"
    ]));
    expect(REVIEWED_FUNCTION_NAMES).not.toContain("prevent_committed_source_result_mutation");
    expect(REVIEWED_INDEX_NAMES).toHaveLength(81);
    expect(REVIEWED_INDEX_NAMES).toEqual(expect.arrayContaining([
      "CrawlBatchSourceResult_id_releaseCandidateId_batchId_sourceId_k",
      "EvidenceArtifact_id_releaseCandidateId_batchId_sourceId_sourceR",
      "TransportAttemptEvidence_releaseCandidateId_batchId_sourceId_id"
    ]));
    expect(REVIEWED_INDEX_DEFINITION_SHA256)
      .toBe("22f0439dfce6c95968a146ab599890ac8192ffd301a088c93f7c4b030c19370e");
  });

  it("refuses local migration drift before any command can run", () => {
    expect(() => verifyReviewedMigrationTree(["20260710000000_baseline"]))
      .toThrow(/reviewed migration tree/i);
  });

  it("constructs exact local dependency paths and preserves shell false", async () => {
    const run = vi.fn(() => ({ status: 0, stdout: "ok", stderr: "" }));
    const root = resolve("C:\\repo");
    const deps = createEmptyDatabaseVerificationDeps(root, run);
    expect(deps).toMatchObject({
      projectRoot: root,
      nodeExecutable: process.execPath,
      prismaCliPath: resolve(root, "node_modules", "prisma", "build", "index.js"),
      psqlExecutable: "/usr/local/bin/psql",
      pgDumpExecutable: "/usr/local/bin/pg_dump"
    });
    await deps.runCommand({ stage: "probe", executable: "tool", args: ["--version"], cwd: root, env: {}, shell: false });
    expect(run).toHaveBeenCalledWith("tool", ["--version"], expect.objectContaining({ shell: false, cwd: root }));
  });

  it("does not inherit arbitrary host secrets into child processes", async () => {
    const prior = process.env.EMPTY_VERIFY_UNRELATED_PRODUCTION_SECRET;
    process.env.EMPTY_VERIFY_UNRELATED_PRODUCTION_SECRET = "must-not-reach-child";
    try {
      const run = vi.fn((_executable: string, _args: readonly string[], _options: { env: NodeJS.ProcessEnv }) =>
        ({ status: 0, stdout: "ok", stderr: "" }));
      const deps = createEmptyDatabaseVerificationDeps(process.cwd(), run);
      await deps.runCommand({
        stage: "probe", executable: "tool", args: [], cwd: process.cwd(),
        env: { PGDATABASE: "safe-target" }, shell: false
      });
      const options = run.mock.calls[0]![2];
      expect(options.env).toMatchObject({ PGDATABASE: "safe-target" });
      expect(options.env).not.toHaveProperty("EMPTY_VERIFY_UNRELATED_PRODUCTION_SECRET");
    } finally {
      if (prior === undefined) delete process.env.EMPTY_VERIFY_UNRELATED_PRODUCTION_SECRET;
      else process.env.EMPTY_VERIFY_UNRELATED_PRODUCTION_SECRET = prior;
    }
  });

  it("exposes only the guarded CLI package entry and documents the isolation contract", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:verify-empty-migrations"]).toBe("tsx scripts/verify-empty-db-migrations.ts");
    const docs = readFileSync(resolve(process.cwd(), "docs", "migration-validation.md"), "utf8");
    expect(docs).toContain("EMPTY_DB_VERIFICATION=1");
    expect(docs).toContain("EMPTY_DB_EXPECTED_SYSTEM_IDENTIFIER");
    expect(docs).toMatch(/No pending migrations to apply/u);
    expect(docs).toMatch(/20.*application tables/iu);
  });
});
