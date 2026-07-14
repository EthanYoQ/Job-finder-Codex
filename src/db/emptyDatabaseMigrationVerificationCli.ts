import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveEmptyDatabaseVerificationConfig,
  runEmptyDatabaseMigrationVerification,
  type CommandInvocation,
  type CommandResult,
  type EmptyDatabaseMigrationVerificationDeps,
  type EmptyDatabaseMigrationVerificationReport
} from "./emptyDatabaseMigrationVerification";

export const REVIEWED_MIGRATION_NAMES = [
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
  "20260714053000_repair_legacy_offline_count_two"
] as const;

export const REVIEWED_APP_TABLE_NAMES = [
  "AccessEvent", "AdminAuditEvent", "AdminSession", "AdminUser", "AiEnrichmentAttempt", "AiEnrichmentRequest",
  "AiEnrichmentResult", "AiTranslationCache", "Company", "CrawlBatch",
  "CrawlBatchSourceResult", "CrawlObservation", "EvidenceArtifact", "Feedback", "Job",
  "LifecycleSetEvidenceMember", "LossLedgerEntry", "ManualCrawlRequest", "ManualCrawlRequestEvent", "PaginationEvidence",
  "RecommendedCompany", "RecruitmentSource", "ReleaseCandidate", "TransportAttemptArtifact",
  "TransportAttemptEvidence"
] as const;

export const REVIEWED_USER_TYPE_NAMES = [
  "AdapterState", "AdminRole", "AdminSessionStatus", "AiEnrichmentAttemptOutcome", "AiEnrichmentStatus", "AtomicCommitState", "AtsKind",
  "CompletenessEvidenceKind", "CompletenessStatus", "CrawlBatchKind", "CrawlStatus",
  "EvidenceArtifactKind", "FeedbackStatus", "JobCategory", "JobLifecycleStatus", "LifecycleSetKind",
  "LossStage", "ManualCrawlEventActor", "ManualCrawlEventType", "ManualCrawlFailureCode", "ManualCrawlStatus",
  "PaginationAnomalyCode", "PaginationTermination", "ReleaseCandidateStatus",
  "RequiredJobField", "SourceKind", "TransportAttemptCode", "TransportAttemptKind",
  "TransportAttemptOutcome", "TransportState", "VerificationStatus"
] as const;

export const REVIEWED_FUNCTION_NAMES = [
  "assert_verified_parent_lifecycle_projection", "enforce_source_result_state_machine",
  "enforce_ai_enrichment_attempt_transition",
  "guard_crawl_batch_source_result_insert",
  "prevent_crawl_batch_kind_or_manual_binding_mutation",
  "prevent_ai_enrichment_immutable_mutation", "prevent_immutable_evidence_mutation", "prevent_manual_crawl_request_event_mutation",
  "prevent_manual_crawl_request_source_mutation", "prevent_rc_observation_mutation",
  "prevent_release_candidate_delete", "prevent_release_candidate_identity_mutation",
  "prevent_transport_attempt_artifact_mutation", "prevent_transport_attempt_mutation",
  "reject_lifecycle_set_member_mutation", "require_transport_attempt_artifact_ref",
  "validate_lifecycle_set_member_projection", "validate_verified_parent_lifecycle_projection"
] as const;

export const REVIEWED_INDEX_NAMES = [
  "AccessEvent_eventType_occurredAt_idx", "AccessEvent_ip_occurredAt_idx", "AccessEvent_pkey",
  "AdminAuditEvent_action_createdAt_idx", "AdminAuditEvent_adminUserId_createdAt_idx", "AdminAuditEvent_pkey",
  "AdminSession_adminUserId_status_idx", "AdminSession_expiresAt_idx", "AdminSession_pkey",
  "AdminSession_tokenHash_key", "AdminUser_email_key", "AdminUser_pkey", "AdminUser_role_idx",
  "AiEnrichmentAttempt_pkey", "AiEnrichmentAttempt_requestId_sequence_key", "AiEnrichmentAttempt_requestId_startedAt_idx",
  "AiEnrichmentRequest_id_inputHash_jobId_key", "AiEnrichmentRequest_id_inputHash_key", "AiEnrichmentRequest_jobId_inputHash_key", "AiEnrichmentRequest_ownerId_leaseExpiresAt_idx",
  "AiEnrichmentRequest_pkey", "AiEnrichmentRequest_status_createdAt_idx",
  "AiEnrichmentResult_jobId_createdAt_idx", "AiEnrichmentResult_pkey", "AiEnrichmentResult_requestId_inputHash_jobId_key", "AiEnrichmentResult_requestId_inputHash_key",
  "AiEnrichmentResult_requestId_key", "AiEnrichmentResult_requiresReview_createdAt_idx",
  "AiTranslationCache_identity_key", "AiTranslationCache_pkey",
  "Company_officialChineseName_key", "Company_pinyinName_idx", "Company_pkey",
  "CrawlBatch_id_releaseCandidateId_key", "CrawlBatch_ownerId_heartbeatAt_idx", "CrawlBatch_pkey",
  "CrawlBatch_releaseCandidateId_startedAt_idx", "CrawlBatch_status_startedAt_idx",
  "CrawlBatchSourceResult_batchId_sourceId_key", "CrawlBatchSourceResult_id_releaseCandidateId_batchId_sourceId_k",
  "CrawlBatchSourceResult_pkey", "CrawlBatchSourceResult_releaseCandidateId_sourceId_idx",
  "CrawlBatchSourceResult_sourceId_finishedAt_idx", "CrawlObservation_batchId_sourceId_idx",
  "CrawlObservation_officialEvidenceArtifactId_idx", "CrawlObservation_pkey",
  "CrawlObservation_releaseCandidateId_sourceId_idx", "CrawlObservation_sourceId_crawledAt_idx",
  "CrawlObservation_sourceResultId_idx", "CrawlObservation_successful_idx",
  "EvidenceArtifact_id_releaseCandidateId_batchId_sourceId_sourceR", "EvidenceArtifact_path_key",
  "EvidenceArtifact_pkey", "EvidenceArtifact_releaseCandidateId_batchId_sourceId_idx",
  "EvidenceArtifact_sha256_idx", "EvidenceArtifact_sourceId_capturedAt_idx",
  "EvidenceArtifact_sourceResultId_channelId_idx", "Feedback_pkey", "Feedback_status_createdAt_idx",
  "Job_city_category_idx", "Job_companyId_lifecycleStatus_idx", "Job_firstSeenAt_idx", "Job_pkey",
  "Job_sourceId_dedupeKey_key", "Job_visibleInFrontend_lifecycleStatus_idx",
  "LifecycleSetEvidenceMember_jobKeySha256_idx", "LifecycleSetEvidenceMember_pkey",
  "LifecycleSetEvidenceMember_sourceResultId_setKind_idx", "LifecycleSetEvidenceMember_tuple_kind_jobKey_key",
  "LossLedgerEntry_candidateKey_idx", "LossLedgerEntry_pkey", "LossLedgerEntry_releaseCandidateId_batchId_sourceId_idx",
  "LossLedgerEntry_sourceResultId_stage_idx", "LossLedgerEntry_winnerKey_idx",
  "ManualCrawlRequestEvent_adminUserId_createdAt_idx", "ManualCrawlRequestEvent_pkey",
  "ManualCrawlRequestEvent_requestId_createdAt_idx", "ManualCrawlRequest_crawlBatchId_idx",
  "ManualCrawlRequest_one_active_per_source", "ManualCrawlRequest_ownerId_leaseExpiresAt_idx", "ManualCrawlRequest_pkey",
  "ManualCrawlRequest_requestedById_createdAt_idx", "ManualCrawlRequest_sourceId_status_idx",
  "ManualCrawlRequest_status_createdAt_idx", "PaginationEvidence_artifactId_idx", "PaginationEvidence_pkey",
  "PaginationEvidence_releaseCandidateId_batchId_sourceId_idx",
  "PaginationEvidence_sourceResultId_channelId_requestedPage_idx", "PaginationEvidence_sourceResultId_sequence_key",
  "RecommendedCompany_pkey", "RecommendedCompany_status_createdAt_idx", "RecruitmentSource_companyId_kind_idx",
  "RecruitmentSource_pkey", "RecruitmentSource_status_idx", "ReleaseCandidate_commitSha_idx",
  "ReleaseCandidate_goalId_version_key", "ReleaseCandidate_pkey", "ReleaseCandidate_status_createdAt_idx",
  "TransportAttemptArtifact_artifactId_idx", "TransportAttemptArtifact_pkey", "TransportAttemptEvidence_pkey",
  "TransportAttemptEvidence_releaseCandidateId_batchId_sourceId_id",
  "TransportAttemptEvidence_sourceResultId_sequence_key", "TransportAttemptEvidence_tuple_key"
] as const;

// Reviewed from pinned PG16 live output ordered by index name with C collation.
export const REVIEWED_INDEX_DEFINITION_SHA256 = "d83911447578a1174f081fac6b5f6f12d5aa9f22b76338327a2e321f4c581129";

interface SpawnResult {
  status: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
  error?: Error;
}

type SpawnCommand = (executable: string, args: readonly string[], options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  encoding: "utf8";
  shell: false;
  windowsHide: true;
  maxBuffer: number;
}) => SpawnResult;

export function verifyReviewedMigrationTree(actualNames: readonly string[]): void {
  const actual = [...actualNames].sort(compareUtf8);
  const reviewed = [...REVIEWED_MIGRATION_NAMES].sort(compareUtf8);
  if (JSON.stringify(actual) !== JSON.stringify(reviewed)) {
    throw new Error("Empty database migration verification refused: local tree does not match the reviewed migration tree");
  }
}

export function createEmptyDatabaseVerificationDeps(
  projectRoot: string,
  spawnCommand: SpawnCommand = spawnSync
): EmptyDatabaseMigrationVerificationDeps {
  return {
    projectRoot,
    nodeExecutable: process.execPath,
    prismaCliPath: resolve(projectRoot, "node_modules", "prisma", "build", "index.js"),
    psqlExecutable: "/usr/local/bin/psql",
    pgDumpExecutable: "/usr/local/bin/pg_dump",
    expectedMigrationNames: REVIEWED_MIGRATION_NAMES,
    expectedAppTableNames: REVIEWED_APP_TABLE_NAMES,
    expectedUserTypeNames: REVIEWED_USER_TYPE_NAMES,
    expectedFunctionNames: REVIEWED_FUNCTION_NAMES,
    expectedIndexNames: REVIEWED_INDEX_NAMES,
    expectedIndexDefinitionSha256: REVIEWED_INDEX_DEFINITION_SHA256,
    runCommand: async (invocation: CommandInvocation): Promise<CommandResult> => {
      const result = spawnCommand(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: { ...safeHostEnvironment(process.env), ...invocation.env },
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024
      });
      return {
        status: result.status,
        stdout: asText(result.stdout),
        stderr: asText(result.stderr),
        ...(result.error === undefined ? {} : { error: result.error })
      };
    }
  };
}

export async function executeEmptyDatabaseMigrationVerificationCli(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = process.cwd()
): Promise<EmptyDatabaseMigrationVerificationReport> {
  const migrationRoot = resolve(projectRoot, "prisma", "migrations");
  const actualMigrations = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  verifyReviewedMigrationTree(actualMigrations);
  const config = resolveEmptyDatabaseVerificationConfig(env);
  return runEmptyDatabaseMigrationVerification(config, createEmptyDatabaseVerificationDeps(projectRoot));
}

function safeHostEnvironment(host: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "HOME", "USERPROFILE", "TMPDIR", "TEMP", "TMP", "NODE_ENV", "SystemRoot"];
  return Object.fromEntries(allowed.flatMap((name) => {
    const value = host[name];
    return value === undefined ? [] : [[name, value]];
  }));
}

function asText(value: string | Buffer | null | undefined): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}
