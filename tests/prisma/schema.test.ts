import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const schemaPath = resolve(process.cwd(), "prisma", "schema.prisma");
const schema = readFileSync(schemaPath, "utf8");
const lifecycleMemberMigration=readFileSync(resolve(process.cwd(),"prisma","migrations","20260711210000_lifecycle_set_evidence_members","migration.sql"),"utf8");
const lifecycleCryptoMigration=readFileSync(resolve(process.cwd(),"prisma","migrations","20260711220000_lifecycle_set_cryptographic_closure","migration.sql"),"utf8");
const lifecycleParentMigration=readFileSync(resolve(process.cwd(),"prisma","migrations","20260711230000_parent_lifecycle_projection_gate","migration.sql"),"utf8");
const lifecycleSecurityMigration=readFileSync(resolve(process.cwd(),"prisma","migrations","20260711240000_lifecycle_trigger_security_closure","migration.sql"),"utf8");
const baselineMigration = readFileSync(
  resolve(process.cwd(), "prisma", "migrations", "20260710000000_baseline", "migration.sql"),
  "utf8"
);
const phase1Migration = readFileSync(
  resolve(process.cwd(), "prisma", "migrations", "20260710010000_phase1_evidence", "migration.sql"),
  "utf8"
);
const crawlStatusValuesMigrationPath = resolve(
  process.cwd(), "prisma", "migrations", "20260710005000_crawl_status_values", "migration.sql"
);
const crawlStatusValuesMigration = existsSync(crawlStatusValuesMigrationPath)
  ? readFileSync(crawlStatusValuesMigrationPath, "utf8")
  : "";
const completenessPendingMigrationPath = resolve(
  process.cwd(), "prisma", "migrations", "20260710015000_completeness_pending", "migration.sql"
);
const completenessPendingMigration = existsSync(completenessPendingMigrationPath)
  ? readFileSync(completenessPendingMigrationPath, "utf8")
  : "";
const sourceStateMachineMigrationPath = resolve(
  process.cwd(), "prisma", "migrations", "20260710020000_source_result_state_machine", "migration.sql"
);
const sourceStateMachineMigration = existsSync(sourceStateMachineMigrationPath)
  ? readFileSync(sourceStateMachineMigrationPath, "utf8")
  : "";

function block(kind: "enum" | "model", name: string): string {
  const match = schema.match(new RegExp(`${kind} ${name}\\s+\\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`Missing ${kind} ${name}`);
  }
  return match[1]!;
}

function enumMembers(name: string): string[] {
  return block("enum", name)
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0]!)
    .filter(Boolean);
}

function migrationConstraint(name: string): string {
  const match = phase1Migration.match(
    new RegExp(`CONSTRAINT "${name}" CHECK \\(\\n([\\s\\S]*?)\\n\\);`)
  );
  if (!match) {
    throw new Error(`Missing migration constraint ${name}`);
  }
  return match[1]!;
}

function migrationFunction(name: string): string {
  const match = phase1Migration.match(
    new RegExp(`CREATE FUNCTION "${name}"\\(\\) RETURNS TRIGGER AS \\$\\$([\\s\\S]*?)\\$\\$ LANGUAGE plpgsql;`)
  );
  if (!match) {
    throw new Error(`Missing migration function ${name}`);
  }
  return match[1]!;
}

function baselineEnumMembers(name: string): string[] {
  const match = baselineMigration.match(new RegExp(`CREATE TYPE "${name}" AS ENUM \\(([^;]+)\\);`));
  if (!match) {
    throw new Error(`Missing baseline enum ${name}`);
  }
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((member) => member[1]!);
}

function baselineTableColumns(name: string): string[] {
  const match = baselineMigration.match(new RegExp(`CREATE TABLE "${name}" \\(\\n([\\s\\S]*?)\\n\\);`));
  if (!match) {
    throw new Error(`Missing baseline table ${name}`);
  }
  return match[1]!
    .split("\n")
    .map((line) => line.match(/^\s+"([^"]+)"/)?.[1])
    .filter((column): column is string => Boolean(column));
}

describe("prisma schema", () => {
  it("commits CrawlStatus values before the Phase 1 migration uses them", () => {
    const migrationDirectories = readdirSync(resolve(process.cwd(), "prisma", "migrations"), {
      withFileTypes: true
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(migrationDirectories).toEqual([
      "20260710000000_baseline", "20260710005000_crawl_status_values", "20260710010000_phase1_evidence",
      "20260710015000_completeness_pending", "20260710020000_source_result_state_machine",
      "20260711050000_task5g_truth_persistence",
      "20260711060000_transport_attempt_artifact_immutability",
      "20260711150000_task5h_runtime_truth_closure",
      "20260711210000_lifecycle_set_evidence_members",
      "20260711220000_lifecycle_set_cryptographic_closure"
      ,"20260711230000_parent_lifecycle_projection_gate"
      ,"20260711240000_lifecycle_trigger_security_closure"
      ,"20260712020000_release_runtime_identity"
      ,"20260713010000_manual_crawl_request_ownership"
      ,"20260713020000_privacy_request_retention"
      ,"20260713030000_manual_crawl_preview_isolation"
      ,"20260713035000_quarantine_legacy_unbound_manual_batches"
      ,"20260713040000_manual_batch_binding_and_kind_immutability"
      ,"20260713050000_ai_enrichment_persistence"
    ]);
    const statements = crawlStatusValuesMigration
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    expect(statements).toEqual([
      'ALTER TYPE "CrawlStatus" ADD VALUE \'RUNNING\' BEFORE \'SUCCESS\';',
      'ALTER TYPE "CrawlStatus" ADD VALUE \'INCOMPLETE\' BEFORE \'SUCCESS\';',
      'ALTER TYPE "CrawlStatus" ADD VALUE \'ABORTED\' BEFORE \'SUCCESS\';'
    ]);
    expect(phase1Migration).not.toMatch(/ALTER TYPE "CrawlStatus" ADD VALUE/);
    expect(phase1Migration).toContain('"status" = \'RUNNING\'');
  });

  it("invalidates legacy RC rows before making runtime identity hashes mandatory",()=>{
    const sql=readFileSync(resolve(process.cwd(),"prisma/migrations/20260712020000_release_runtime_identity/migration.sql"),"utf8");
    expect(sql).toMatch(/ADD COLUMN "sourceTreeHash" TEXT,/);expect(sql).toMatch(/SET "status" = 'INVALIDATED'/);
    expect(sql).toMatch(/repeat\('0', 64\)/);expect(sql.indexOf("UPDATE \"ReleaseCandidate\"")).toBeLessThan(sql.indexOf('ALTER COLUMN "sourceTreeHash" SET NOT NULL'));
    expect(sql).toContain("ReleaseCandidate_release_tree_not_legacy_check");
    for(const field of ["goalId","version","commitSha","dbSnapshotHash","schemaHash","migrationVersion","rosterHash","sourcePlanHash","sourceConfigHash","adapterBundleHash","oracleVersion","sourceTreeHash","runtimeTreeHash"])expect(sql).toContain(`OLD."${field}" IS DISTINCT FROM NEW."${field}"`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION "prevent_release_candidate_identity_mutation"/);expect(sql).toMatch(/SECURITY DEFINER SET search_path = pg_catalog, public/);
    expect(sql).toMatch(/OLD\."status" = 'INVALIDATED' AND NEW\."status" IS DISTINCT FROM OLD\."status"/);
    for(const attempted of ["BUILDING","QA_FAILED","TRUST_FREEZE","READY_FOR_QA","RELEASED"])expect(attempted).not.toBe("INVALIDATED");
  });

  it("security-hardens lifecycle triggers and rejects members for non-verified parents",()=>{
    expect(lifecycleSecurityMigration).toContain("ALTER EXTENSION pgcrypto SET SCHEMA extensions");
    expect(lifecycleSecurityMigration).toContain("SECURITY DEFINER SET search_path=pg_catalog,public,extensions");
    expect(lifecycleSecurityMigration).toContain("parent_atomic<>'COMMITTED' OR parent_completeness<>'VERIFIED'");
    expect(lifecycleSecurityMigration).toContain("extensions.digest");
    expect(lifecycleSecurityMigration).toContain('FROM public."LifecycleSetEvidenceMember"');
    expect(lifecycleSecurityMigration).toContain("REVOKE ALL ON FUNCTION");
  });

  it("defers verified parent full-set validation even when no member row exists",()=>{
    expect(lifecycleParentMigration).toContain('CREATE CONSTRAINT TRIGGER "CrawlBatchSourceResult_verified_lifecycle_projection"');
    expect(lifecycleParentMigration).toContain('AFTER INSERT OR UPDATE');
    expect(lifecycleParentMigration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(lifecycleParentMigration).toContain("parent_atomic<>'COMMITTED' OR parent_completeness<>'VERIFIED'");
    expect(lifecycleParentMigration).toContain("coalesce(string_agg");
  });

  it("closes lifecycle member commitments with pgcrypto and UTF8 canonical full-set hashes",()=>{
    expect(lifecycleCryptoMigration).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(lifecycleCryptoMigration).toContain('digest(convert_to("jobKey", \'UTF8\'), \'sha256\')');
    expect(lifecycleCryptoMigration).toContain('ORDER BY convert_to("jobKey",\'UTF8\')');
    expect(lifecycleCryptoMigration).toContain("string_agg(to_json(\"jobKey\")::text, ','");
    expect(lifecycleCryptoMigration).toContain("parent_output IS DISTINCT FROM parent_current");
  });

  it("persists immutable tuple-bound lifecycle set members with exact database projections",()=>{
    expect(schema).toContain("model LifecycleSetEvidenceMember");
    expect(schema).toContain("@@unique([releaseCandidateId, batchId, sourceId, sourceResultId, setKind, jobKey])");
    expect(lifecycleMemberMigration).toContain('FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId")');
    expect(lifecycleMemberMigration).toContain('"LifecycleSetEvidenceMember_projection"');
    expect(lifecycleMemberMigration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(lifecycleMemberMigration).toContain('BEFORE UPDATE OR DELETE');
  });

  it("matches the pre-mutation clone physical baseline catalog order", () => {
    expect(baselineEnumMembers("AtsKind")).toEqual([
      "OFFICIAL_HTML", "OFFICIAL_JSON", "MOKA", "BEISEN_ZHIYE", "WORKDAY", "SUCCESSFACTORS",
      "REDSEA", "BROWSER_FALLBACK", "UNKNOWN", "HOTJOB_WECRUIT"
    ]);
    expect(baselineTableColumns("CrawlObservation")).toEqual([
      "id", "sourceId", "batchId", "crawledAt", "successful", "structuredJobCount", "stableRequiredFields",
      "failureReason", "expectedJobCount", "completenessBlockerReason", "completenessEvidenceKind",
      "completenessEvidenceUrl", "completenessStatus", "pageSize", "pagesVisited", "totalPages"
    ]);
    expect(baselineMigration).not.toContain('CREATE TABLE "ReleaseCandidate"');
  });

  it("validates the PostgreSQL data model", () => {
    const output = execSync("npm run --silent prisma:validate", {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" }
    });

    expect(output).toMatch(/is valid/i);
  }, 15_000);

  it("stores a required per-source dedupe key for jobs", () => {
    expect(schema).toMatch(/dedupeKey\s+String/);
    expect(schema).toMatch(/@@unique\(\[sourceId,\s*dedupeKey\]\)/);
  });

  it("stores job classification with typed enum fields and audit metadata", () => {
    expect(schema).toMatch(/enum JobCategory\s+\{/);
    expect(schema).toMatch(/SALES\s+@map\("销售"\)/);
    expect(schema).toMatch(/OTHER\s+@map\("其他"\)/);
    expect(schema).toMatch(/category\s+JobCategory/);
    expect(schema).toMatch(/secondaryCategory\s+JobCategory\?/);
    expect(schema).toMatch(/classificationConfidence\s+Float\?/);
    expect(schema).toMatch(/classificationRationale\s+String\?/);
    expect(schema).toMatch(/classificationModelVersion\s+String\?/);
    expect(schema).toMatch(/classificationHardRuleHit\s+String\?/);
    expect(schema).toMatch(/humanCorrectedCategory\s+JobCategory\?/);
    expect(schema).toMatch(/humanCorrectedSecondaryCategory\s+JobCategory\?/);
    expect(schema).toMatch(/humanCorrectionReason\s+String\?/);
    expect(schema).toMatch(/humanCorrectedAt\s+DateTime\?/);
  });

  it("types crawl stable required fields with a Prisma enum array", () => {
    expect(schema).toMatch(/enum RequiredJobField\s+\{/);
    expect(schema).toMatch(/COMPANY\s+@map\("company"\)/);
    expect(schema).toMatch(/TITLE\s+@map\("title"\)/);
    expect(schema).toMatch(/OFFICIAL_URL\s+@map\("officialUrl"\)/);
    expect(schema).toMatch(/LOCATION\s+@map\("location"\)/);
    expect(schema).toMatch(/stableRequiredFields\s+RequiredJobField\[\]/);
    expect(schema).toMatch(/expectedJobCount\s+Int\?/);
  });

  it("stores crawl completeness evidence fields", () => {
    expect(schema).toMatch(/enum CompletenessStatus\s+\{/);
    expect(enumMembers("CompletenessStatus")).toEqual([
      "PENDING", "VERIFIED", "NEEDS_MANUAL_COMPLETENESS_REVIEW", "INCOMPLETE", "FAILED"
    ]);
    expect(schema).toMatch(/VERIFIED/);
    expect(schema).toMatch(/NEEDS_MANUAL_COMPLETENESS_REVIEW/);
    expect(schema).toMatch(/INCOMPLETE/);
    expect(schema).toMatch(/FAILED/);
    expect(schema).toMatch(/enum CompletenessEvidenceKind\s+\{/);
    expect(schema).toMatch(/OFFICIAL_TOTAL_COUNT/);
    expect(schema).toMatch(/COMPLETE_PAGE_TRAVERSAL/);
    expect(schema).toMatch(/WEAK_MANUAL_SAMPLE/);
    expect(schema).toMatch(/completenessStatus\s+CompletenessStatus\?/);
    expect(schema).toMatch(/completenessEvidenceKind\s+CompletenessEvidenceKind\?/);
    expect(schema).toMatch(/completenessEvidenceUrl\s+String\?/);
    expect(schema).toMatch(/completenessBlockerReason\s+String\?/);
    expect(schema).toMatch(/totalPages\s+Int\?/);
    expect(schema).toMatch(/pageSize\s+Int\?/);
    expect(schema).toMatch(/pagesVisited\s+Int\?/);
  });

  it("adds PENDING in a committed forward enum migration before the state-machine migration uses it", () => {
    expect(completenessPendingMigration.trim()).toBe(
      'ALTER TYPE "CompletenessStatus" ADD VALUE \'PENDING\' BEFORE \'VERIFIED\';'
    );
    expect(sourceStateMachineMigration).not.toMatch(/ALTER TYPE "CompletenessStatus"/);
  });

  it("replaces the generic source-result guard with a one-way PENDING state machine", () => {
    expect(sourceStateMachineMigration).toContain('DROP TRIGGER "CrawlBatchSourceResult_committed_immutable"');
    expect(sourceStateMachineMigration).toContain('DROP FUNCTION "prevent_committed_source_result_mutation"');
    expect(sourceStateMachineMigration).toContain('OLD."atomicCommitState" <> \'PENDING\'');
    expect(sourceStateMachineMigration).toContain('NEW."atomicCommitState" = \'PENDING\'');
    for (const field of [
      "id", "releaseCandidateId", "batchId", "sourceId", "sourceConfigHash", "adapterVersion",
      "officialEntryId", "officialSurfaceIds", "officialChannelIds", "startedAt", "createdAt"
    ]) expect(sourceStateMachineMigration).toContain(`OLD."${field}" IS DISTINCT FROM NEW."${field}"`);
    expect(sourceStateMachineMigration).toContain('NEW."finishedAt" IS NULL');
    expect(sourceStateMachineMigration).toContain('NEW."transportState" = \'PENDING\'');
    expect(sourceStateMachineMigration).toContain('NEW."adapterState" = \'PENDING\'');
    expect(sourceStateMachineMigration).toContain('NEW."completenessState" = \'PENDING\'');
    expect(sourceStateMachineMigration).toContain('NEW."atomicCommitState" = \'COMMITTED\'');
    expect(sourceStateMachineMigration).toContain(
      'NEW."completenessState" NOT IN (\'VERIFIED\', \'INCOMPLETE\', \'NEEDS_MANUAL_COMPLETENESS_REVIEW\')'
    );
    expect(sourceStateMachineMigration).toContain('NEW."completenessState" = \'VERIFIED\'');
    expect(sourceStateMachineMigration).toContain('BEFORE UPDATE OR DELETE ON "CrawlBatchSourceResult"');
  });

  it("encodes the complete terminal truth table in the database trigger", () => {
    expect(sourceStateMachineMigration).toContain('NEW."atomicCommitState" = \'COMMITTED\'');
    expect(sourceStateMachineMigration).toContain('NEW."atomicCommitState" = \'NOT_ATTEMPTED\'');
    expect(sourceStateMachineMigration).toContain('NEW."atomicCommitState" IN (\'FAILED\', \'ROLLED_BACK\')');
    expect(sourceStateMachineMigration).toContain("NEW.\"completenessState\" NOT IN ('VERIFIED', 'INCOMPLETE', 'NEEDS_MANUAL_COMPLETENESS_REVIEW')");
    expect(sourceStateMachineMigration).toContain("NEW.\"atomicCommitState\" IN ('FAILED', 'ROLLED_BACK')");
    expect(sourceStateMachineMigration).toContain("NEW.\"transportState\" IN ('FAILED', 'BLOCKED', 'SKIPPED')");
    expect(sourceStateMachineMigration).toContain("NEW.\"adapterState\" <> 'SKIPPED'");
    expect(sourceStateMachineMigration).toContain("NEW.\"transportState\" = 'SUCCEEDED'");
    expect(sourceStateMachineMigration).toContain("NEW.\"adapterState\" NOT IN ('FAILED', 'BLOCKED', 'SKIPPED')");
    expect(sourceStateMachineMigration).toContain('NEW."failureCode" IS NOT NULL');
    expect(sourceStateMachineMigration).toContain('NEW."failureReason" IS NOT NULL');
  });

  it("makes COMMITTED source results self-proving from same-tuple evidence", () => {
    expect(sourceStateMachineMigration).toContain('FROM "CrawlObservation"');
    expect(sourceStateMachineMigration).toContain('FROM "EvidenceArtifact"');
    expect(sourceStateMachineMigration).toContain('FROM "PaginationEvidence"');
    expect(sourceStateMachineMigration).toContain('observation_count <> 1');
    expect(sourceStateMachineMigration).toContain('pagination_count = 0');
    for (const field of [
      "rawCount", "parsedCount", "validCount", "normalizedCount", "dedupeInputCount", "dedupeOutputCount",
      "parseDiscardCount", "validationDiscardCount", "normalizationDiscardCount", "dedupeDiscardCount",
      "discardCount", "collisionCount", "expectedJobCount", "expectedSurfaceSha256", "visitedSurfaceSha256",
      "expectedChannelSha256", "visitedChannelSha256"
    ]) expect(sourceStateMachineMigration).toContain(`observation."${field}" IS DISTINCT FROM NEW."${field}"`);
    expect(sourceStateMachineMigration).toContain('observation."canonicalOutputSha256" IS DISTINCT FROM NEW."canonicalCurrentJobSetSha256"');
    expect(sourceStateMachineMigration).toContain('observation."canonicalGraceSha256" IS DISTINCT FROM NEW."canonicalGraceJobSetSha256"');
    expect(sourceStateMachineMigration).toContain('observation."canonicalVisibleSha256" IS DISTINCT FROM NEW."canonicalVisibleJobSetSha256"');
    expect(sourceStateMachineMigration).toContain('observation."completenessBlockerReason" IS DISTINCT FROM NEW."blockerReason"');
    expect(sourceStateMachineMigration).toContain('observation."pagesVisited" IS DISTINCT FROM pagination_count');
    expect(sourceStateMachineMigration).toContain("cardinality(pagination.\"anomalyCodes\") <> 0");
    expect(sourceStateMachineMigration).toContain("pagination.\"termination\" IN ('REPEATED_CURSOR', 'MAX_PAGE_LIMIT', 'FAILED', 'ABORTED')");
    expect(sourceStateMachineMigration).toContain("artifact.\"kind\" NOT IN ('OFFICIAL_COMPANY_PAGE', 'REDIRECT_TRACE', 'ATS_PAGE', 'ATS_API_RESPONSE', 'PAGINATION_PAGE')");
    expect(sourceStateMachineMigration).toContain('NEW."expectedJobCount" <> NEW."dedupeOutputCount"');
  });

  it("requires truthful zero/null PENDING rows", () => {
    expect(sourceStateMachineMigration).toContain('CrawlBatchSourceResult_pending_state_check');
    for (const counter of [
      "rawCount", "parsedCount", "validCount", "normalizedCount", "dedupeInputCount", "dedupeOutputCount",
      "parseDiscardCount", "validationDiscardCount", "normalizationDiscardCount", "dedupeDiscardCount",
      "collisionCount", "discardCount"
    ]) expect(sourceStateMachineMigration).toContain(`"${counter}" = 0`);
    for (const field of [
      "finishedAt", "expectedJobCount", "expectedEvidenceKind", "expectedSurfaceSha256", "visitedSurfaceSha256",
      "expectedChannelSha256", "visitedChannelSha256", "canonicalCurrentJobSetSha256",
      "canonicalGraceJobSetSha256", "canonicalVisibleJobSetSha256", "blockerCode", "blockerReason",
      "failureCode", "failureReason"
    ]) expect(sourceStateMachineMigration).toContain(`"${field}" IS NULL`);
  });

  it("uses the exact release and batch vocabularies", () => {
    expect(enumMembers("CrawlStatus")).toEqual(["RUNNING", "INCOMPLETE", "ABORTED", "SUCCESS", "FAILED"]);
    expect(enumMembers("ReleaseCandidateStatus")).toEqual([
      "TRUST_FREEZE", "BUILDING", "READY_FOR_QA", "QA_FAILED", "RELEASED", "INVALIDATED"
    ]);
    expect(enumMembers("CrawlBatchKind")).toEqual(["FULL_RELEASE", "SCHEDULED", "MANUAL_SOURCE", "BASELINE"]);
    const rc = block("model", "ReleaseCandidate");
    for (const field of [
      "goalId", "commitSha", "dbSnapshotHash", "schemaHash", "migrationVersion", "rosterHash",
      "sourcePlanHash", "sourceConfigHash", "adapterBundleHash", "oracleVersion", "status", "createdAt", "finalizedAt"
    ]) {
      expect(rc, field).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    expect(rc).not.toMatch(/goalSha256|updatedAt/);
    const batch = block("model", "CrawlBatch");
    for (const field of [
      "releaseCandidateId", "commitSha", "rosterSha256", "sourcePlanSha256", "sourceConfigSha256",
      "adapterBundleSha256", "kind", "plannedSourceIds", "plannedSourceSetSha256", "plannedSourceCount",
      "transportSucceededCount", "transportFailedCount", "adapterSucceededCount", "adapterFailedCount",
      "completenessVerifiedCount", "completenessIncompleteCount", "atomicCommittedCount", "atomicFailedCount",
      "failedSourceCount", "blockedSourceCount", "skippedSourceCount", "ownerId", "heartbeatAt", "aggregateJobSetSha256"
    ]) {
      expect(batch, field).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
  });

  it("stores exact source result provenance and reconciliable loss counters", () => {
    const result = block("model", "CrawlBatchSourceResult");
    for (const field of [
      "sourceConfigHash", "adapterVersion", "officialEntryId", "officialSurfaceIds", "officialChannelIds",
      "expectedJobCount", "expectedEvidenceKind", "rawCount", "parsedCount", "validCount", "normalizedCount",
      "dedupeInputCount", "dedupeOutputCount", "parseDiscardCount", "validationDiscardCount",
      "normalizationDiscardCount", "dedupeDiscardCount", "collisionCount", "discardCount"
    ]) {
      expect(result, field).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    expect(result).toMatch(/^\s*finishedAt\s+DateTime\?\s*$/m);
    expect(result).not.toMatch(/^\s*dedupeCount\s+/m);
    expect(enumMembers("LossStage")).toEqual(["PARSE", "VALIDATION", "NORMALIZATION", "DEDUPE"]);
  });

  it("stores direct nullable observation provenance and exact reconciliation counters", () => {
    const observation = block("model", "CrawlObservation");
    for (const field of [
      "releaseCandidateId", "batchId", "sourceResultId", "commitSha", "rosterSha256", "sourcePlanSha256",
      "sourceConfigSha256", "adapterVersion", "rawCount", "parsedCount", "validCount", "normalizedCount",
      "dedupeInputCount", "dedupeOutputCount", "parseDiscardCount", "validationDiscardCount",
      "normalizationDiscardCount", "dedupeDiscardCount", "discardCount", "collisionCount"
    ]) {
      expect(observation, field).toMatch(new RegExp(`^\\s*${field}\\s+[^\\n]+\\?`, "m"));
    }
    expect(observation).not.toMatch(/^\s*dedupeCount\s+/m);
  });

  it("stores exact immutable artifact and pagination evidence fields", () => {
    expect(enumMembers("EvidenceArtifactKind")).toEqual([
      "OFFICIAL_COMPANY_PAGE", "REDIRECT_TRACE", "ATS_PAGE", "ATS_API_RESPONSE", "PAGINATION_PAGE",
      "SCREENSHOT", "DEDUPE_LEDGER", "ORACLE_RESULT", "COMMAND_OUTPUT"
    ]);
    const artifact = block("model", "EvidenceArtifact");
    for (const field of [
      "sourceResultId", "channelId", "requestedUrl", "finalUrl", "httpStatus", "contentType", "capturedAt",
      "sha256", "byteCount", "path", "extractorLocator", "captureToolName", "captureToolVersion"
    ]) {
      expect(artifact, field).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    for (const field of ["requestedUrl", "finalUrl", "httpStatus", "contentType"]) {
      expect(artifact, field).toMatch(new RegExp(`^\\s*${field}\\s+[^\\n]+\\?`, "m"));
    }

    expect(enumMembers("PaginationAnomalyCode")).toEqual([
      "REPEATED_RESPONSE_FINGERPRINT", "REPEATED_JOB_ID_SET_WITH_NEXT", "CURSOR_NOT_ADVANCING",
      "OFFSET_NOT_ADVANCING", "INTERMEDIATE_EMPTY_PAGE", "TOTAL_CHANGED", "MAX_PAGES_WITH_NEXT",
      "EXPECTED_CHANNEL_NOT_VISITED", "RETURNED_PAGE_MISMATCH", "RETURNED_PAGE_SIZE_MISMATCH",
      "INTERMEDIATE_SHORT_PAGE", "DECLARED_CAPACITY_CONTRADICTION", "RAW_ID_OVERLAP_ACROSS_PAGES"
    ]);
    const pagination = block("model", "PaginationEvidence");
    for (const field of [
      "sequence", "channelId", "requestedCursor", "returnedCursor", "requestedOffset", "returnedOffset",
      "requestedPage", "returnedPage", "responseFingerprintSha256", "rawJobIdSetSha256", "validJobIdSetSha256",
      "declaredTotal", "declaredCount", "declaredPages", "nextPageSignalBefore", "nextPageSignalAfter", "termination"
    ]) {
      expect(pagination, field).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    expect(pagination).toMatch(/^\s*anomalyCodes\s+PaginationAnomalyCode\[\]\s*$/m);
    expect(pagination).toMatch(/@@unique\(\[sourceResultId,\s*sequence\]\)/);
  });

  it("defines fail-closed migration checks, tuple integrity, and append-only triggers", () => {
    expect(baselineMigration).toContain('CREATE TABLE "CrawlObservation"');
    expect(baselineMigration).not.toContain('CREATE TABLE "ReleaseCandidate"');
    expect(phase1Migration).toMatch(/CHECK\s*\(\s*"releaseCandidateId" IS NULL OR/);
    expect(phase1Migration).toContain('CrawlObservation_rc_provenance_check');
    expect(phase1Migration).toContain('CrawlBatch_rc_provenance_check');
    expect(phase1Migration).toContain('CrawlBatchSourceResult_loss_reconciliation_check');
    expect(phase1Migration).toContain('CrawlObservation_loss_reconciliation_check');
    expect(phase1Migration).toContain('FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId")');
    expect(phase1Migration).toContain('prevent_immutable_evidence_mutation');
    expect(phase1Migration).toContain('prevent_rc_observation_mutation');
    expect(phase1Migration).toContain('BEFORE UPDATE OR DELETE ON "EvidenceArtifact"');
    expect(phase1Migration).toContain('BEFORE UPDATE OR DELETE ON "PaginationEvidence"');
    expect(phase1Migration).toContain('BEFORE UPDATE OR DELETE ON "LossLedgerEntry"');
    expect(phase1Migration).not.toMatch(/^\s*(INSERT|UPDATE|DELETE)\s/im);
  });

  it("requires tuple-consistent artifacts and raw pagination evidence", () => {
    const artifact = block("model", "EvidenceArtifact");
    const pagination = block("model", "PaginationEvidence");
    expect(artifact).toMatch(/^\s*sourceResultId\s+String\s*$/m);
    expect(artifact).toMatch(/@@unique\(\[id,\s*releaseCandidateId,\s*batchId,\s*sourceId,\s*sourceResultId\]\)/);
    expect(pagination).toMatch(/^\s*artifactId\s+String\s*$/m);
    expect(phase1Migration).toContain(
      'FOREIGN KEY ("artifactId", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") REFERENCES "EvidenceArtifact"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId")'
    );
    expect(phase1Migration).toContain(
      'FOREIGN KEY ("officialEvidenceArtifactId", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") REFERENCES "EvidenceArtifact"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId")'
    );
    const observationCheck = migrationConstraint("CrawlObservation_rc_provenance_check");
    expect(observationCheck).toContain('"sourceResultId" IS NOT NULL');
    expect(observationCheck).toContain('"officialEvidenceArtifactId" IS NOT NULL');
    for (const table of ["CrawlBatchSourceResult", "CrawlObservation", "EvidenceArtifact", "PaginationEvidence", "LossLedgerEntry"]) {
      expect(phase1Migration, table).toContain(`CONSTRAINT "${table}_batch_rc_tuple_fkey"`);
    }
  });

  it("guards RC deletion, every RC-bound observation, and committed source results", () => {
    expect(phase1Migration).toContain('BEFORE DELETE ON "ReleaseCandidate"');
    expect(phase1Migration).toContain('prevent_release_candidate_delete');
    const observationGuard = migrationFunction("prevent_rc_observation_mutation");
    expect(observationGuard).toContain('OLD."releaseCandidateId" IS NOT NULL');
    expect(phase1Migration).toContain('BEFORE UPDATE OR DELETE ON "CrawlObservation"');
    const sourceResultGuard = migrationFunction("prevent_committed_source_result_mutation");
    expect(sourceResultGuard).toContain('OLD."atomicCommitState" = \'COMMITTED\'');
    expect(phase1Migration).toContain('BEFORE UPDATE OR DELETE ON "CrawlBatchSourceResult"');
  });

  it("prevents promoting legacy observations into RC evidence by update", () => {
    const observationGuard = migrationFunction("prevent_rc_observation_mutation");
    expect(observationGuard).toContain("IF TG_OP = 'DELETE' THEN");
    expect(observationGuard).toContain('IF OLD."releaseCandidateId" IS NOT NULL THEN');
    expect(observationGuard).toContain(
      'IF OLD."releaseCandidateId" IS NOT NULL OR NEW."releaseCandidateId" IS NOT NULL THEN'
    );
  });

  it("checks every persisted counter is nonnegative", () => {
    const batchCheck = migrationConstraint("CrawlBatch_rc_provenance_check");
    for (const counter of [
      "plannedSourceCount", "transportSucceededCount", "transportFailedCount", "adapterSucceededCount",
      "adapterFailedCount", "completenessVerifiedCount", "completenessIncompleteCount", "atomicCommittedCount",
      "atomicFailedCount", "failedSourceCount", "blockedSourceCount", "skippedSourceCount"
    ]) {
      expect(batchCheck, counter).toContain(`"${counter}" >= 0`);
    }
    const sourceCheck = migrationConstraint("CrawlBatchSourceResult_loss_reconciliation_check");
    const observationCheck = migrationConstraint("CrawlObservation_loss_reconciliation_check");
    for (const counter of [
      "rawCount", "parsedCount", "validCount", "normalizedCount", "dedupeInputCount", "dedupeOutputCount",
      "parseDiscardCount", "validationDiscardCount", "normalizationDiscardCount", "dedupeDiscardCount",
      "discardCount", "collisionCount"
    ]) {
      expect(sourceCheck, counter).toContain(`"${counter}" >= 0`);
      expect(observationCheck, counter).toContain(`"${counter}" >= 0`);
    }
  });

  it("requires complete HTTP provenance for every network artifact kind", () => {
    const networkCheck = migrationConstraint("EvidenceArtifact_network_provenance_check");
    for (const kind of [
      "OFFICIAL_COMPANY_PAGE", "REDIRECT_TRACE", "ATS_PAGE", "ATS_API_RESPONSE", "PAGINATION_PAGE"
    ]) {
      expect(networkCheck).toContain(`'${kind}'`);
    }
    for (const field of ["requestedUrl", "finalUrl", "httpStatus", "contentType"]) {
      expect(networkCheck).toContain(`"${field}" IS NOT NULL`);
    }
  });

  it("documents separate existing-clone and empty-database validation procedures", () => {
    const procedure = readFileSync(
      resolve(process.cwd(), "docs", "migration-validation.md"),
      "utf8"
    );
    expect(procedure).toContain("prisma migrate resolve --applied 20260710000000_baseline");
    expect(procedure).toContain("Existing-clone procedure");
    expect(procedure).toContain("Empty-database procedure");
    expect(procedure).toMatch(/row counts/i);
    expect(procedure).toMatch(/checksum/i);
  });

  it("stores frontend visibility, new labels, and multi-city job evidence", () => {
    expect(schema).toMatch(/visibleInFrontend\s+Boolean\s+@default\(true\)/);
    expect(schema).toMatch(/isNew\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/cities\s+String\[\]\s+@default\(\[\]\)/);
    expect(schema).toMatch(/@@index\(\[visibleInFrontend,\s*lifecycleStatus\]\)/);
  });

  it("stores protected admin users, sessions, audit events, and manual crawl requests", () => {
    expect(schema).toMatch(/enum AdminRole\s+\{/);
    expect(schema).toMatch(/ADMIN/);
    expect(schema).toMatch(/enum AdminSessionStatus\s+\{/);
    expect(schema).toMatch(/ACTIVE/);
    expect(schema).toMatch(/REVOKED/);
    expect(schema).toMatch(/EXPIRED/);
    expect(schema).toMatch(/enum ManualCrawlStatus\s+\{/);
    expect(schema).toMatch(/QUEUED/);
    expect(schema).toMatch(/RUNNING/);
    expect(schema).toMatch(/SUCCEEDED/);
    expect(schema).toMatch(/FAILED/);
    expect(schema).toMatch(/model AdminUser\s+\{/);
    expect(schema).toMatch(/email\s+String\s+@unique/);
    expect(schema).toMatch(/passwordHash\s+String/);
    expect(schema).toMatch(/model AdminSession\s+\{/);
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/expiresAt\s+DateTime/);
    expect(schema).toMatch(/model AdminAuditEvent\s+\{/);
    expect(schema).toMatch(/action\s+String/);
    expect(schema).toMatch(/model ManualCrawlRequest\s+\{/);
    expect(schema).toMatch(/sourceId\s+String/);
    expect(schema).toMatch(/requestedById\s+String/);
    expect(schema).toMatch(/status\s+ManualCrawlStatus\s+@default\(QUEUED\)/);
  });

  it("models Task 5G strict reconciliation, page capacity, redaction and prior attempts", () => {
    const result = block("model", "CrawlBatchSourceResult");
    const page = block("model", "PaginationEvidence");
    const artifact = block("model", "EvidenceArtifact");
    expect(result).toMatch(/canonicalOutputSetSha256\s+String\?/);
    for (const field of ["adapterInputCount", "adapterOutputCount", "adapterLossCount", "adapterCollisionGroupCount"]) {
      expect(result).toMatch(new RegExp(`${field}\\s+Int\\?`));
    }
    expect(result).toMatch(/adapterReconciliationSha256\s+String/);
    expect(result).toMatch(/collisionLedgerSha256\s+String/);
    expect(page).toMatch(/requestedPageSize\s+Int\?/);
    expect(page).toMatch(/returnedPageSize\s+Int\?/);
    expect(artifact).toMatch(/redactionCommitmentSha256\s+String/);
    expect(schema).toMatch(/model TransportAttemptEvidence\s+\{/);
    expect(schema).toMatch(/model TransportAttemptArtifact\s+\{/);
    expect(schema).toMatch(/enum TransportAttemptCode\s+\{/);
    const task5gMigration = readFileSync(resolve(process.cwd(), "prisma", "migrations",
      "20260711060000_transport_attempt_artifact_immutability", "migration.sql"), "utf8");
    expect(task5gMigration).toContain("TransportAttemptArtifact_immutable");
    expect(task5gMigration).toContain("prevent_transport_attempt_artifact_mutation");
    expect(task5gMigration).toContain("TransportAttemptEvidence_nonempty_refs");
    expect(task5gMigration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(schema).toContain("CONTINUE");
    expect(schema).toContain("INTERMEDIATE_SHORT_PAGE");
    expect(schema).toContain("RETURNED_PAGE_SIZE_MISMATCH");
    expect(schema).toContain("DECLARED_CAPACITY_CONTRADICTION");
  });
});
