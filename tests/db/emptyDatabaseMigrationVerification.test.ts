import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  resolveEmptyDatabaseVerificationConfig,
  runEmptyDatabaseMigrationVerification,
  type CommandInvocation,
  type CommandResult
} from "../../src/db/emptyDatabaseMigrationVerification";
import { REVIEWED_INDEX_NAMES } from "../../src/db/emptyDatabaseMigrationVerificationCli";

const DATABASE_NAME = "jobfinder_empty_verify_a1b2c3d4e5f60708";

function safeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    EMPTY_DB_VERIFICATION: "1",
    EMPTY_DB_EXPECTED_DATABASE: DATABASE_NAME,
    EMPTY_DB_NETWORK_INTERNAL: "1",
    EMPTY_DB_HOST_PORT_BINDINGS: "none",
    EMPTY_DB_EXPECTED_SYSTEM_IDENTIFIER: "7659954889866510370",
    EMPTY_DB_FORBIDDEN_SYSTEM_IDENTIFIERS: "7659954889866510369",
    DATABASE_URL: `postgresql://verify:super-secret@empty-postgres/${DATABASE_NAME}?schema=public`,
    ...overrides
  };
}

describe("empty database migration verification guard", () => {
  it("accepts only an explicitly isolated randomly named empty verification database", () => {
    expect(resolveEmptyDatabaseVerificationConfig(safeEnv())).toMatchObject({
      databaseName: DATABASE_NAME,
      host: "empty-postgres",
      username: "verify",
      password: "super-secret"
    });
  });

  it.each([
    ["missing verification opt-in", { EMPTY_DB_VERIFICATION: undefined }],
    ["wrong verification opt-in", { EMPTY_DB_VERIFICATION: "true" }],
    ["missing exact expected name", { EMPTY_DB_EXPECTED_DATABASE: undefined }],
    ["mismatched expected name", { EMPTY_DB_EXPECTED_DATABASE: "jobfinder_empty_verify_ffffffffffffffff" }],
    ["short predictable suffix", {
      EMPTY_DB_EXPECTED_DATABASE: "jobfinder_empty_verify_short",
      DATABASE_URL: "postgresql://verify:super-secret@empty-postgres/jobfinder_empty_verify_short"
    }],
    ["known source database", {
      EMPTY_DB_EXPECTED_DATABASE: "p0_rc_20260710_001_p1_task4_20260710t181848",
      DATABASE_URL: "postgresql://verify:super-secret@empty-postgres/p0_rc_20260710_001_p1_task4_20260710t181848"
    }],
    ["localhost", { DATABASE_URL: `postgresql://verify:super-secret@localhost/${DATABASE_NAME}` }],
    ["loopback ipv4", { DATABASE_URL: `postgresql://verify:super-secret@127.0.0.1/${DATABASE_NAME}` }],
    ["loopback ipv6", { DATABASE_URL: `postgresql://verify:super-secret@[::1]/${DATABASE_NAME}` }],
    ["explicit host port", { DATABASE_URL: `postgresql://verify:super-secret@empty-postgres:5432/${DATABASE_NAME}` }],
    ["missing internal-network proof", { EMPTY_DB_NETWORK_INTERNAL: undefined }],
    ["host port proof not none", { EMPTY_DB_HOST_PORT_BINDINGS: "5432" }],
    ["missing expected system identity", { EMPTY_DB_EXPECTED_SYSTEM_IDENTIFIER: undefined }],
    ["invalid expected system identity", { EMPTY_DB_EXPECTED_SYSTEM_IDENTIFIER: "unknown" }],
    ["missing forbidden system identities", { EMPTY_DB_FORBIDDEN_SYSTEM_IDENTIFIERS: undefined }],
    ["expected system identity is forbidden", { EMPTY_DB_FORBIDDEN_SYSTEM_IDENTIFIERS: "7659954889866510370" }]
  ])("rejects %s", (_label, overrides) => {
    expect(() => resolveEmptyDatabaseVerificationConfig(safeEnv(overrides))).toThrow();
  });

  it("never includes the database URL or password in guard failures", () => {
    const env = safeEnv({ EMPTY_DB_VERIFICATION: undefined });
    try {
      resolveEmptyDatabaseVerificationConfig(env);
      throw new Error("expected guard failure");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(env.DATABASE_URL!);
      expect(message).not.toContain("super-secret");
    }
  });
});

const MIGRATIONS = [
  "20260710000000_baseline",
  "20260710005000_crawl_status_values",
  "20260710010000_phase1_evidence",
  "20260710015000_completeness_pending",
  "20260710020000_source_result_state_machine",
  "20260711050000_task5g_truth_persistence",
  "20260711060000_transport_attempt_artifact_immutability",
  "20260711150000_task5h_runtime_truth_closure",
  "20260711210000_lifecycle_set_evidence_members",
  "20260711220000_lifecycle_set_cryptographic_closure",
  "20260711230000_parent_lifecycle_projection_gate",
  "20260711240000_lifecycle_trigger_security_closure",
  "20260712020000_release_runtime_identity",
  "20260713010000_manual_crawl_request_ownership",
  "20260713020000_privacy_request_retention",
  "20260713030000_manual_crawl_preview_isolation",
  "20260713035000_quarantine_legacy_unbound_manual_batches",
  "20260713040000_manual_batch_binding_and_kind_immutability",
  "20260713050000_ai_enrichment_persistence",
  "20260714053000_repair_legacy_offline_count_two",
  "20260715090000_atomic_evidence_commit_scaling"
];

const APP_TABLES = [
  "AccessEvent", "AdminAuditEvent", "AdminSession", "AdminUser", "AiEnrichmentAttempt", "AiEnrichmentRequest",
  "AiEnrichmentResult", "AiTranslationCache", "Company", "CrawlBatch",
  "CrawlBatchSourceResult", "CrawlObservation", "EvidenceArtifact", "Feedback", "Job",
  "LifecycleSetEvidenceMember", "LossLedgerEntry", "ManualCrawlRequest", "ManualCrawlRequestEvent", "PaginationEvidence",
  "RecommendedCompany", "RecruitmentSource", "ReleaseCandidate", "TransportAttemptArtifact",
  "TransportAttemptEvidence"
].sort();

const USER_TYPES = [
  "AdapterState", "AdminRole", "AdminSessionStatus", "AiEnrichmentAttemptOutcome", "AiEnrichmentStatus", "AtomicCommitState", "AtsKind",
  "CompletenessEvidenceKind", "CompletenessStatus", "CrawlBatchKind", "CrawlStatus",
  "EvidenceArtifactKind", "FeedbackStatus", "JobCategory", "JobLifecycleStatus", "LifecycleSetKind",
  "LossStage", "ManualCrawlEventActor", "ManualCrawlEventType", "ManualCrawlFailureCode", "ManualCrawlStatus",
  "PaginationAnomalyCode", "PaginationTermination", "ReleaseCandidateStatus",
  "RequiredJobField", "SourceKind", "TransportAttemptCode", "TransportAttemptKind",
  "TransportAttemptOutcome", "TransportState", "VerificationStatus",
  "SourceFailureCategory", "SourceFailureDiagnosticCode"
].sort();

const FUNCTIONS = [
  "assert_verified_parent_lifecycle_projection", "enforce_ai_enrichment_attempt_transition", "enforce_source_result_state_machine",
  "guard_crawl_batch_source_result_insert",
  "prevent_crawl_batch_kind_or_manual_binding_mutation",
  "prevent_ai_enrichment_immutable_mutation", "prevent_immutable_evidence_mutation", "prevent_manual_crawl_request_event_mutation",
  "prevent_manual_crawl_request_source_mutation", "prevent_rc_observation_mutation",
  "prevent_release_candidate_delete", "prevent_release_candidate_identity_mutation",
  "prevent_transport_attempt_artifact_mutation", "prevent_transport_attempt_mutation",
  "reject_lifecycle_set_member_mutation", "require_transport_attempt_artifact_ref",
  "validate_lifecycle_set_member_projection", "validate_verified_parent_lifecycle_projection"
].sort();
const INDEX_DEFINITIONS = [...REVIEWED_INDEX_NAMES]
  .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
const INDEX_DEFINITION_SHA256 = createHash("sha256")
  .update(INDEX_DEFINITIONS.join("\n"), "utf8")
  .digest("hex");

function migratedAudit() {
  return {
    migrations: MIGRATIONS.map((migrationName) => ({
      migrationName,
      finishedAt: "2026-07-12T00:00:00.000Z" as string | null,
      rolledBackAt: null as string | null
    })),
    appTables: APP_TABLES,
    tableCounts: Object.fromEntries(APP_TABLES.map((table) => [table, 0])),
    nonTableRelations: [] as string[],
    userTypes: USER_TYPES,
    functions: FUNCTIONS,
    indexes: [...REVIEWED_INDEX_NAMES] as string[],
    standaloneBaseTypes: [] as string[],
    indexDefinitions: [...INDEX_DEFINITIONS] as string[]
  };
}

function result(stdout: string): CommandResult {
  return { status: 0, stdout, stderr: "" };
}

function deps(queue: CommandResult[], calls: CommandInvocation[] = []) {
  return {
    projectRoot: "C:\\repo", nodeExecutable: "C:\\node.exe",
    prismaCliPath: "C:\\repo\\node_modules\\prisma\\build\\index.js",
    psqlExecutable: "/usr/local/bin/psql", pgDumpExecutable: "/usr/local/bin/pg_dump",
    expectedMigrationNames: MIGRATIONS, expectedAppTableNames: APP_TABLES,
    expectedUserTypeNames: USER_TYPES, expectedFunctionNames: FUNCTIONS,
    expectedIndexNames: REVIEWED_INDEX_NAMES,
    expectedIndexDefinitionSha256: INDEX_DEFINITION_SHA256,
    runCommand: async (invocation: CommandInvocation) => {
      calls.push(invocation);
      const next = queue.shift();
      if (!next) throw new Error("unexpected command");
      return next;
    }
  };
}

function successQueue(audit = migratedAudit()): CommandResult[] {
  return [
    result("psql (PostgreSQL) 16.14\n"),
    result(JSON.stringify({ currentDatabase: DATABASE_NAME, serverVersion: "16.14", systemIdentifier: "7659954889866510370", isTemplate: false })),
    result(JSON.stringify({ publicSchemaObjectCount: 0, migrationTableExists: false, migrationRowCount: 0 })),
    result("All migrations have been successfully applied.\n"), result(JSON.stringify(audit)),
    result("CREATE TABLE public.\"Company\" ();\n"),
    result("No pending migrations to apply.\n"), result(JSON.stringify(audit)),
    result("CREATE TABLE public.\"Company\" ();\n")
  ];
}

describe("empty database migration verification orchestration", () => {
  it("audits an empty PG16 target, deploys exact local migrations twice, and proves the second deploy is a no-op", async () => {
    const calls: CommandInvocation[] = [];
    const queue = [
      result("psql (PostgreSQL) 16.14 (Debian 16.14-1.pgdg12+1)\n"),
      result(JSON.stringify({ currentDatabase: DATABASE_NAME, serverVersion: "16.14", systemIdentifier: "7659954889866510370", isTemplate: false })),
      result(JSON.stringify({ publicSchemaObjectCount: 0, migrationTableExists: false, migrationRowCount: 0 })),
      result("23 migrations found in prisma/migrations\nAll migrations have been successfully applied.\n"),
      result(JSON.stringify(migratedAudit())),
      result("-- PostgreSQL database dump\nCREATE TABLE public.\"Company\" ();\n"),
      result("23 migrations found in prisma/migrations\nNo pending migrations to apply.\n"),
      result(JSON.stringify(migratedAudit())),
      result("-- PostgreSQL database dump\nCREATE TABLE public.\"Company\" ();\n")
    ];
    const config = resolveEmptyDatabaseVerificationConfig(safeEnv());

    const report = await runEmptyDatabaseMigrationVerification(config, {
      projectRoot: "C:\\repo",
      nodeExecutable: "C:\\node.exe",
      prismaCliPath: "C:\\repo\\node_modules\\prisma\\build\\index.js",
      psqlExecutable: "/usr/local/bin/psql",
      pgDumpExecutable: "/usr/local/bin/pg_dump",
      expectedMigrationNames: MIGRATIONS,
      expectedAppTableNames: APP_TABLES,
      expectedUserTypeNames: USER_TYPES,
      expectedFunctionNames: FUNCTIONS,
      expectedIndexNames: REVIEWED_INDEX_NAMES,
      expectedIndexDefinitionSha256: INDEX_DEFINITION_SHA256,
      runCommand: async (invocation) => {
        calls.push(invocation);
        return queue.shift()!;
      }
    });

    expect(queue).toHaveLength(0);
    expect(report).toMatchObject({
      databaseName: DATABASE_NAME,
      serverVersion: "16.14",
      systemIdentifier: "7659954889866510370",
      migrationCount: 21,
      appTableCount: 25,
      allAppTableCountsZero: true,
      secondDeployNoop: true
    });
    expect(report.normalizedSchemaSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(calls).toHaveLength(9);
    expect(calls[3]).toMatchObject({
      executable: "C:\\node.exe",
      args: ["C:\\repo\\node_modules\\prisma\\build\\index.js", "migrate", "deploy", `--schema=${resolve("C:\\repo", "prisma", "schema.prisma")}`],
      shell: false
    });
    expect(calls[6]).toMatchObject({ executable: "C:\\node.exe", shell: false });
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain("super-secret");
      expect(call.args.join(" ")).not.toContain("postgresql://");
    }
    expect(calls[2]!.args.join(" ")).not.toContain("FROM public._prisma_migrations");
    expect(calls[2]!.args.join(" ")).toContain("pg_catalog.pg_proc");
    expect(calls[2]!.args.join(" ")).toContain("pg_catalog.pg_type");
    expect(calls[2]!.args.join(" ")).not.toMatch(/pg_type[^]*typtype\s+IN/u);
    expect(calls[4]!.args.join(" ")).toContain("table_name <> '_prisma_migrations'");
    expect(calls[4]!.args.join(" ")).not.toMatch(/table_name\s+IN\s*\(/u);
    expect(calls[4]!.args.join(" ")).toContain("pg_catalog.pg_get_indexdef");
    expect(calls[4]!.args.join(" ")).toContain("tbl.relname <> '_prisma_migrations'");
  });

  it("hashes index definitions in the canonical index-name order returned by SQL", async () => {
    const audit = migratedAudit();
    audit.indexDefinitions = audit.indexDefinitions.map((definition, index) =>
      index === 0 ? `z:${definition}` : index === 1 ? `a:${definition}` : definition
    );
    const expectedDigest = createHash("sha256")
      .update(audit.indexDefinitions.join("\n"), "utf8")
      .digest("hex");
    const verificationDeps = deps(successQueue(audit));
    verificationDeps.expectedIndexDefinitionSha256 = expectedDigest;

    await expect(runEmptyDatabaseMigrationVerification(
      resolveEmptyDatabaseVerificationConfig(safeEnv()),
      verificationDeps
    )).resolves.toMatchObject({ secondDeployNoop: true });
  });

  it("refuses a non-empty target before invoking Prisma", async () => {
    const calls: CommandInvocation[] = [];
    const queue = [
      result("psql (PostgreSQL) 16.14\n"),
      result(JSON.stringify({ currentDatabase: DATABASE_NAME, serverVersion: "16.14", systemIdentifier: "7659954889866510370", isTemplate: false })),
      result(JSON.stringify({ publicSchemaObjectCount: 1, migrationTableExists: false, migrationRowCount: 0 }))
    ];

    await expect(runEmptyDatabaseMigrationVerification(resolveEmptyDatabaseVerificationConfig(safeEnv()), {
      projectRoot: "C:\\repo",
      nodeExecutable: "C:\\node.exe",
      prismaCliPath: "C:\\repo\\node_modules\\prisma\\build\\index.js",
      psqlExecutable: "/usr/local/bin/psql",
      pgDumpExecutable: "/usr/local/bin/pg_dump",
      expectedMigrationNames: MIGRATIONS,
      expectedAppTableNames: APP_TABLES,
      expectedUserTypeNames: USER_TYPES,
      expectedFunctionNames: FUNCTIONS,
      expectedIndexNames: REVIEWED_INDEX_NAMES,
      expectedIndexDefinitionSha256: INDEX_DEFINITION_SHA256,
      runCommand: async (invocation) => { calls.push(invocation); return queue.shift()!; }
    })).rejects.toThrow(/not empty/i);

    expect(calls.some((call) => call.args.includes("migrate"))).toBe(false);
  });

  it("refuses even an empty pre-existing Prisma migration table before invoking Prisma", async () => {
    const calls: CommandInvocation[] = [];
    const queue = [
      result("psql (PostgreSQL) 16.14\n"),
      result(JSON.stringify({ currentDatabase: DATABASE_NAME, serverVersion: "16.14", systemIdentifier: "7659954889866510370", isTemplate: false })),
      result(JSON.stringify({ publicSchemaObjectCount: 0, migrationTableExists: true, migrationRowCount: 0 }))
    ];

    await expect(runEmptyDatabaseMigrationVerification(resolveEmptyDatabaseVerificationConfig(safeEnv()), {
      projectRoot: "C:\\repo", nodeExecutable: "C:\\node.exe",
      prismaCliPath: "C:\\repo\\node_modules\\prisma\\build\\index.js",
      psqlExecutable: "/usr/local/bin/psql", pgDumpExecutable: "/usr/local/bin/pg_dump",
      expectedMigrationNames: MIGRATIONS, expectedAppTableNames: APP_TABLES,
      expectedUserTypeNames: USER_TYPES, expectedFunctionNames: FUNCTIONS,
      expectedIndexNames: REVIEWED_INDEX_NAMES,
      expectedIndexDefinitionSha256: INDEX_DEFINITION_SHA256,
      runCommand: async (invocation) => { calls.push(invocation); return queue.shift()!; }
    })).rejects.toThrow(/not empty/i);

    expect(calls.some((call) => call.args.includes("migrate"))).toBe(false);
  });

  it.each([
    ["wrong selected database", { currentDatabase: "jobfinder_empty_verify_ffffffffffffffff", serverVersion: "16.14", systemIdentifier: "7659954889866510370", isTemplate: false }],
    ["non-PG16 server", { currentDatabase: DATABASE_NAME, serverVersion: "15.9", systemIdentifier: "7659954889866510370", isTemplate: false }],
    ["template database", { currentDatabase: DATABASE_NAME, serverVersion: "16.14", systemIdentifier: "7659954889866510370", isTemplate: true }],
    ["invalid system identifier", { currentDatabase: DATABASE_NAME, serverVersion: "16.14", systemIdentifier: "unknown", isTemplate: false }],
    ["unexpected server identity", { currentDatabase: DATABASE_NAME, serverVersion: "16.14", systemIdentifier: "7659954889866510371", isTemplate: false }]
  ])("refuses %s before migration", async (_label, identity) => {
    const calls: CommandInvocation[] = [];
    await expect(runEmptyDatabaseMigrationVerification(resolveEmptyDatabaseVerificationConfig(safeEnv()),
      deps([result("psql (PostgreSQL) 16.14\n"), result(JSON.stringify(identity))], calls))).rejects.toThrow();
    expect(calls.some((call) => call.args.includes("migrate"))).toBe(false);
  });

  it.each([
    ["missing migration", () => { const audit = migratedAudit(); audit.migrations.pop(); return audit; }],
    ["rolled-back migration", () => { const audit = migratedAudit(); audit.migrations[0]!.rolledBackAt = "2026-07-12T01:00:00Z"; return audit; }],
    ["unfinished migration", () => { const audit = migratedAudit(); audit.migrations[0]!.finishedAt = null; return audit; }],
    ["extra public table", () => { const audit = migratedAudit(); audit.appTables = [...audit.appTables, "UnexpectedTable"]; return audit; }],
    ["extra non-table object", () => { const audit = migratedAudit(); audit.nonTableRelations = ["UnexpectedView"]; return audit; }],
    ["extra index", () => { const audit = migratedAudit(); audit.indexes = [...audit.indexes, "Unexpected_idx"]; return audit; }],
    ["changed index definition", () => { const audit = migratedAudit(); audit.indexDefinitions[0] = "changed"; return audit; }],
    ["standalone base type", () => { const audit = migratedAudit(); audit.standaloneBaseTypes = ["unexpected_base"]; return audit; }],
    ["nonzero app row count", () => { const audit = migratedAudit(); audit.tableCounts.Company = 1; return audit; }]
  ])("refuses an invalid post-migration audit: %s", async (_label, mutate) => {
    const queue = successQueue(mutate());
    await expect(runEmptyDatabaseMigrationVerification(resolveEmptyDatabaseVerificationConfig(safeEnv()), deps(queue)))
      .rejects.toThrow(/migration|table|zero-row/i);
    expect(queue.length).toBeGreaterThan(0);
  });

  it("refuses a second deploy without the exact Prisma no-op confirmation", async () => {
    const queue = successQueue();
    queue[6] = result("Database is already in sync.\n");
    await expect(runEmptyDatabaseMigrationVerification(resolveEmptyDatabaseVerificationConfig(safeEnv()), deps(queue)))
      .rejects.toThrow(/confirmed no-op/i);
  });

  it("does not leak command stderr or credentials on command failure", async () => {
    const secret = "super-secret";
    const queue = successQueue();
    queue[3] = { status: 1, stdout: "", stderr: `DATABASE_URL=postgresql://verify:${secret}@empty-postgres/db` };
    await expect(runEmptyDatabaseMigrationVerification(resolveEmptyDatabaseVerificationConfig(safeEnv()), deps(queue)))
      .rejects.not.toThrow(secret);
  });
});
