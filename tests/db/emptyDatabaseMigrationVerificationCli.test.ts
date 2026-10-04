import { readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REVIEWED_APP_TABLE_NAMES,
  REVIEWED_FUNCTION_NAMES,
  REVIEWED_INDEX_NAMES,
  REVIEWED_INDEX_DEFINITION_SHA256,
  REVIEWED_MIGRATION_NAMES,
  REVIEWED_USER_TYPE_NAMES,
  createEmptyDatabaseVerificationDeps,
  formatEmptyDatabaseMigrationVerificationFailure,
  verifyReviewedMigrationTree
} from "../../src/db/emptyDatabaseMigrationVerificationCli";

import { resolveEmptyDatabaseVerificationConfig, runEmptyDatabaseMigrationVerification } from "../../src/db/emptyDatabaseMigrationVerification";

const fixtureRoots: string[] = [];
afterEach(() => { for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function supportedHistoryRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), "historical-empty-verification-"));
  fixtureRoots.push(root);
  for (const name of REVIEWED_MIGRATION_NAMES) {
    const dir = resolve(root, "prisma/migrations", name);
    mkdirSync(dir, { recursive: true });
    copyFileSync(resolve(process.cwd(), "prisma/migrations", name, "migration.sql"), resolve(dir, "migration.sql"));
  }
  return root;
}

describe("empty database migration verification CLI contract", () => {
  it("preserves historical 34-migration PG16 allowlists and refuses the existing-only candidate", () => {
    const actualMigrations = readdirSync(resolve(process.cwd(), "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(REVIEWED_MIGRATION_NAMES).toHaveLength(34);
    expect(actualMigrations).toHaveLength(49);
    expect(actualMigrations.slice(0, 34)).toEqual([...REVIEWED_MIGRATION_NAMES].sort());
    expect(() => verifyReviewedMigrationTree(actualMigrations)).toThrow(/existing-database-only/i);
    expect(REVIEWED_APP_TABLE_NAMES).toHaveLength(25);
    expect(new Set(REVIEWED_APP_TABLE_NAMES).size).toBe(25);
    expect(REVIEWED_APP_TABLE_NAMES).toEqual(expect.arrayContaining([
      "AiEnrichmentRequest", "AiEnrichmentAttempt", "AiEnrichmentResult", "AiTranslationCache"
    ]));
    expect(REVIEWED_APP_TABLE_NAMES).toContain("ManualCrawlRequestEvent");
    expect(REVIEWED_USER_TYPE_NAMES).toHaveLength(33);
    expect(REVIEWED_USER_TYPE_NAMES).toEqual(expect.arrayContaining([
      "ManualCrawlEventActor",
      "ManualCrawlEventType",
      "ManualCrawlFailureCode",
      "SourceFailureCategory",
      "SourceFailureDiagnosticCode"
    ]));
    expect(REVIEWED_FUNCTION_NAMES).toHaveLength(18);
    expect(REVIEWED_FUNCTION_NAMES).toEqual(expect.arrayContaining([
      "prevent_transport_attempt_artifact_mutation",
      "prevent_transport_attempt_mutation",
      "prevent_manual_crawl_request_event_mutation",
      "prevent_manual_crawl_request_source_mutation",
      "prevent_crawl_batch_kind_or_manual_binding_mutation",
      "guard_crawl_batch_source_result_insert",
      "require_transport_attempt_artifact_ref"
    ]));
    expect(REVIEWED_FUNCTION_NAMES).not.toContain("prevent_committed_source_result_mutation");
    expect(REVIEWED_INDEX_NAMES).toHaveLength(104);
    expect(REVIEWED_INDEX_NAMES).toEqual(expect.arrayContaining([
      "CrawlBatchSourceResult_id_releaseCandidateId_batchId_sourceId_k",
      "EvidenceArtifact_id_releaseCandidateId_batchId_sourceId_sourceR",
      "ManualCrawlRequestEvent_adminUserId_createdAt_idx",
      "ManualCrawlRequestEvent_pkey",
      "ManualCrawlRequestEvent_requestId_createdAt_idx",
      "ManualCrawlRequest_crawlBatchId_idx",
      "ManualCrawlRequest_one_active_per_source",
      "ManualCrawlRequest_ownerId_leaseExpiresAt_idx",
      "TransportAttemptEvidence_releaseCandidateId_batchId_sourceId_id"
    ]));
    expect(REVIEWED_INDEX_DEFINITION_SHA256)
      .toBe("d83911447578a1174f081fac6b5f6f12d5aa9f22b76338327a2e321f4c581129");
  });

  it("reports the existing-only boundary without exposing arbitrary failure details", () => {
    let refusal: unknown;
    try { verifyReviewedMigrationTree(["20260927120000_p0_launch_cohort_41_companies"]); }
    catch (error) { refusal = error; }
    expect(formatEmptyDatabaseMigrationVerificationFailure(refusal)).toMatch(/existing-database-only/i);
    expect(formatEmptyDatabaseMigrationVerificationFailure(new Error("postgresql://user:secret@db/test")))
      .toBe("Empty database migration verification failed.");
    const entryPoint = readFileSync(resolve(process.cwd(), "scripts/verify-empty-db-migrations.ts"), "utf8");
    expect(entryPoint).toContain("formatEmptyDatabaseMigrationVerificationFailure(error)");
  });

  it("refuses local migration drift before any command can run", () => {
    expect(() => verifyReviewedMigrationTree(["20260710000000_baseline"]))
      .toThrow(/reviewed migration tree/i);
  });

  it("rejects the exported factory/orchestrator composition against the actual recovery tree before any command", async () => {
    const databaseName = "jobfinder_empty_verify_a1b2c3d4e5f60708";
    const config = resolveEmptyDatabaseVerificationConfig({
      EMPTY_DB_VERIFICATION: "1", EMPTY_DB_NETWORK_INTERNAL: "1", EMPTY_DB_HOST_PORT_BINDINGS: "none",
      EMPTY_DB_EXPECTED_DATABASE: databaseName, EMPTY_DB_EXPECTED_SYSTEM_IDENTIFIER: "7659954889866510370",
      EMPTY_DB_FORBIDDEN_SYSTEM_IDENTIFIERS: "7659954889866510369",
      DATABASE_URL: `postgresql://verify:dummy@empty-postgres/${databaseName}?schema=public`
    });
    const outputs = ["psql (PostgreSQL) 16.14", JSON.stringify({ currentDatabase: databaseName, serverVersion: "16.14",
      systemIdentifier: "7659954889866510370", isTemplate: false }),
      JSON.stringify({ publicSchemaObjectCount: 0, migrationTableExists: false, migrationRowCount: 0 })];
    const spawn = vi.fn(() => ({ status: outputs.length ? 0 : 1, stdout: outputs.shift() ?? "", stderr: "" }));
    await expect(async () => runEmptyDatabaseMigrationVerification(config,
      createEmptyDatabaseVerificationDeps(process.cwd(), spawn))).rejects.toThrow(/existing-database-only/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rechecks the actual tree at replay after the dependency factory has been created", async () => {
    const root = supportedHistoryRoot();
    const spawn = vi.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    const deps = createEmptyDatabaseVerificationDeps(root, spawn);
    const name = "20260927120000_p0_launch_cohort_41_companies";
    const dir = resolve(root, "prisma/migrations", name);
    mkdirSync(dir);
    copyFileSync(resolve(process.cwd(), "prisma/migrations", name, "migration.sql"), resolve(dir, "migration.sql"));
    await expect(deps.runCommand({ stage: "first-migrate-deploy", executable: process.execPath,
      args: [deps.prismaCliPath, "migrate", "deploy"], cwd: root, env: {}, shell: false }))
      .rejects.toThrow(/existing-database-only/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("constructs exact local dependency paths and preserves shell false", async () => {
    const run = vi.fn(() => ({ status: 0, stdout: "ok", stderr: "" }));
    const root = supportedHistoryRoot();
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
      const deps = createEmptyDatabaseVerificationDeps(supportedHistoryRoot(), run);
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
    expect(docs).toMatch(/25.*application tables/iu);
  });
});
