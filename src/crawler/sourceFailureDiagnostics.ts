import {
  isRetryableSourceTransportFailure,
  type SourceTransportFailure
} from "./sourceFetchFailure";
import type { SourceFetchAttemptTracker } from "./runSourceCrawl";

export const SOURCE_FAILURE_CATEGORIES = [
  "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
  "SOURCE_TIME_LIMIT_REACHED",
  "OFFICIAL_SOURCE_REVIEW_REQUIRED",
  "EVIDENCE_PERSISTENCE_FAILURE",
  "UNCLASSIFIED_SOURCE_FAILURE"
] as const;

export type SourceFailureCategory = typeof SOURCE_FAILURE_CATEGORIES[number];

export const SOURCE_FAILURE_DIAGNOSTIC_CODES = [
  "OFFICIAL_HTTP_TIMEOUT",
  "OFFICIAL_NETWORK_ERROR",
  "OFFICIAL_BROWSER_SESSION_ERROR",
  "OFFICIAL_PAGINATION_SNAPSHOT_DRIFT",
  "OFFICIAL_HTTP_429",
  "OFFICIAL_HTTP_502",
  "OFFICIAL_HTTP_503",
  "OFFICIAL_HTTP_504",
  "OFFICIAL_HTTP_5XX",
  "SOURCE_ATTEMPT_TIMEOUT",
  "FETCH_EXECUTION_FAILED",
  "FETCH_FAILED_CLOSED",
  "ADAPTER_EXECUTION_FAILED",
  "ADAPTER_FAILED_CLOSED",
  "EVIDENCE_PROCESSING_FAILED",
  "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL"
] as const;

export type SourceFailureDiagnosticCode = typeof SOURCE_FAILURE_DIAGNOSTIC_CODES[number];

export interface SourceFailureDiagnosticBundle {
  failureCategory: SourceFailureCategory;
  failureDiagnosticCode: SourceFailureDiagnosticCode;
  fetchAttemptCount: number;
  retryCount: number;
  retryReasonCodes: SourceFetchAttemptTracker["retryReasonCodes"];
}

export const SOURCE_EXECUTION_FAILURE_CODES = Object.freeze([
  "SOURCE_FETCH_DNS_FAILED",
  "SOURCE_FETCH_TLS_FAILED",
  "SOURCE_FETCH_CONNECT_FAILED",
  "SOURCE_FETCH_ABORTED",
  "SOURCE_FETCH_EXECUTION_FAILED"
] as const);

export type SourceExecutionFailureCode = typeof SOURCE_EXECUTION_FAILURE_CODES[number];

export function sourceExecutionFailureCode(error: unknown): SourceExecutionFailureCode {
  const facts = errorFacts(error);
  if (["ENOTFOUND", "EAI_AGAIN"].includes(facts.code ?? "")) return "SOURCE_FETCH_DNS_FAILED";
  if (/^(?:ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|UNABLE_TO_VERIFY_)/u.test(facts.code ?? "")) {
    return "SOURCE_FETCH_TLS_FAILED";
  }
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET"].includes(facts.code ?? "")) return "SOURCE_FETCH_CONNECT_FAILED";
  if (facts.name === "AbortError" || facts.code === "ABORT_ERR") return "SOURCE_FETCH_ABORTED";
  return "SOURCE_FETCH_EXECUTION_FAILED";
}

const ATOMIC_STAGE_FAILURE_CODE = {
  ATTESTATION: "ATOMIC_EVIDENCE_ATTESTATION_FAILED",
  INPUT_VALIDATION: "ATOMIC_EVIDENCE_INPUT_VALIDATION_FAILED",
  SOURCE_RESULT_VALIDATION: "ATOMIC_EVIDENCE_SOURCE_RESULT_VALIDATION_FAILED",
  COMMAND_VALIDATION: "ATOMIC_EVIDENCE_COMMAND_VALIDATION_FAILED",
  ARTIFACT_VALIDATION: "ATOMIC_EVIDENCE_ARTIFACT_VALIDATION_FAILED",
  CERTIFICATE_VALIDATION: "ATOMIC_EVIDENCE_CERTIFICATE_VALIDATION_FAILED",
  PAGINATION_VALIDATION: "ATOMIC_EVIDENCE_PAGINATION_VALIDATION_FAILED",
  LOSS_LEDGER_VALIDATION: "ATOMIC_EVIDENCE_LOSS_LEDGER_VALIDATION_FAILED",
  RECONCILIATION_VALIDATION: "ATOMIC_EVIDENCE_RECONCILIATION_VALIDATION_FAILED",
  TRANSPORT_ATTEMPT_VALIDATION: "ATOMIC_EVIDENCE_TRANSPORT_ATTEMPT_VALIDATION_FAILED",
  COMMITTED_EVIDENCE_VALIDATION: "ATOMIC_EVIDENCE_COMMITTED_EVIDENCE_VALIDATION_FAILED",
  OWNERSHIP_FENCE: "ATOMIC_EVIDENCE_OWNERSHIP_FENCE_FAILED",
  ARTIFACT_WRITE: "ATOMIC_EVIDENCE_ARTIFACT_WRITE_FAILED",
  PAGINATION_WRITE: "ATOMIC_EVIDENCE_PAGINATION_WRITE_FAILED",
  LOSS_LEDGER_WRITE: "ATOMIC_EVIDENCE_LOSS_LEDGER_WRITE_FAILED",
  TRANSPORT_ATTEMPT_WRITE: "ATOMIC_EVIDENCE_TRANSPORT_ATTEMPT_WRITE_FAILED",
  OBSERVATION_WRITE: "ATOMIC_EVIDENCE_OBSERVATION_WRITE_FAILED",
  JOB_WRITE: "ATOMIC_EVIDENCE_JOB_WRITE_FAILED",
  LIFECYCLE_WRITE: "ATOMIC_EVIDENCE_LIFECYCLE_WRITE_FAILED",
  SOURCE_TERMINAL_WRITE: "ATOMIC_EVIDENCE_SOURCE_TERMINAL_WRITE_FAILED",
  TRANSACTION_COMMIT: "ATOMIC_EVIDENCE_TRANSACTION_COMMIT_FAILED"
} as const;

export type AtomicEvidencePersistenceStage = keyof typeof ATOMIC_STAGE_FAILURE_CODE;

export const ATOMIC_EVIDENCE_PERSISTENCE_STAGES = Object.freeze(
  Object.keys(ATOMIC_STAGE_FAILURE_CODE) as AtomicEvidencePersistenceStage[]
);

export const ATOMIC_EVIDENCE_FAILURE_CODES = [
  "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT",
  "ATOMIC_EVIDENCE_VALUE_TOO_LONG",
  "ATOMIC_EVIDENCE_ARTIFACT_PATH_CONFLICT",
  "ATOMIC_EVIDENCE_JOB_IDENTITY_CONFLICT",
  "ATOMIC_EVIDENCE_PAGINATION_IDENTITY_CONFLICT",
  "ATOMIC_EVIDENCE_LIFECYCLE_IDENTITY_CONFLICT",
  "ATOMIC_EVIDENCE_UNIQUE_CONSTRAINT_FAILED",
  "ATOMIC_EVIDENCE_FOREIGN_KEY_FAILED",
  "ATOMIC_EVIDENCE_LIFECYCLE_PROJECTION_FAILED",
  "ATOMIC_EVIDENCE_CONSTRAINT_FAILED",
  ...Object.values(ATOMIC_STAGE_FAILURE_CODE),
  "ATOMIC_EVIDENCE_COMMIT_FAILED"
] as const;

export type AtomicEvidenceFailureCode = typeof ATOMIC_EVIDENCE_FAILURE_CODES[number];

const PERSISTENCE_STAGE_SET = new Set<string>(ATOMIC_EVIDENCE_PERSISTENCE_STAGES);

const CATEGORY_SET = new Set<string>(SOURCE_FAILURE_CATEGORIES);
const DIAGNOSTIC_CODE_SET = new Set<string>(SOURCE_FAILURE_DIAGNOSTIC_CODES);

export function isSourceFailureCategory(value: unknown): value is SourceFailureCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

export function isSourceFailureDiagnosticCode(value: unknown): value is SourceFailureDiagnosticCode {
  return typeof value === "string" && DIAGNOSTIC_CODE_SET.has(value);
}

export function sourceFailureDiagnosticBundle(
  failureCategory: SourceFailureCategory,
  failureDiagnosticCode: SourceFailureDiagnosticCode,
  tracker: Pick<SourceFetchAttemptTracker, "fetchAttemptCount" | "retryCount" | "retryReasonCodes">
): SourceFailureDiagnosticBundle {
  return {
    failureCategory,
    failureDiagnosticCode,
    fetchAttemptCount: tracker.fetchAttemptCount,
    retryCount: tracker.retryCount,
    retryReasonCodes: [...tracker.retryReasonCodes]
  };
}

export function transportFailureDiagnosticBundle(
  failure: SourceTransportFailure | undefined,
  tracker: Pick<SourceFetchAttemptTracker, "fetchAttemptCount" | "retryCount" | "retryReasonCodes">
): SourceFailureDiagnosticBundle {
  return isRetryableSourceTransportFailure(failure)
    ? sourceFailureDiagnosticBundle(
        "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
        isSourceFailureDiagnosticCode(failure.code) ? failure.code : "OFFICIAL_HTTP_5XX",
        tracker
      )
    : sourceFailureDiagnosticBundle(
        "UNCLASSIFIED_SOURCE_FAILURE",
        "FETCH_FAILED_CLOSED",
        tracker
      );
}

export function sourceFailureCategoryLabel(category: SourceFailureCategory): string {
  switch (category) {
    case "TEMPORARY_OFFICIAL_SOURCE_FAILURE":
      return "官网招聘入口暂时不可用";
    case "SOURCE_TIME_LIMIT_REACHED":
      return "官网抓取超过时间限制";
    case "OFFICIAL_SOURCE_REVIEW_REQUIRED":
      return "官网招聘入口内容需要复核";
    case "EVIDENCE_PERSISTENCE_FAILURE":
      return "抓取结果保存失败";
    case "UNCLASSIFIED_SOURCE_FAILURE":
      return "抓取失败，原因待核验";
  }
}

export function atomicEvidenceFailureCode(error: unknown): AtomicEvidenceFailureCode {
  const prisma = prismaErrorFacts(error);
  if (prisma.code === "P2028") return "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT";
  if (prisma.code === "P2000") return "ATOMIC_EVIDENCE_VALUE_TOO_LONG";
  if (prisma.code === "P2003") return "ATOMIC_EVIDENCE_FOREIGN_KEY_FAILED";
  if (prisma.code === "P2004") {
    return prisma.databaseError?.includes("LifecycleSetEvidenceMember") ||
      prisma.databaseError?.includes("lifecycle_projection")
      ? "ATOMIC_EVIDENCE_LIFECYCLE_PROJECTION_FAILED"
      : "ATOMIC_EVIDENCE_CONSTRAINT_FAILED";
  }
  if (prisma.code === "P2002") {
    if (prisma.modelName === "EvidenceArtifact" && prisma.targets.has("path")) {
      return "ATOMIC_EVIDENCE_ARTIFACT_PATH_CONFLICT";
    }
    if (prisma.modelName === "Job" && prisma.targets.has("sourceId") && prisma.targets.has("dedupeKey")) {
      return "ATOMIC_EVIDENCE_JOB_IDENTITY_CONFLICT";
    }
    if (prisma.modelName === "PaginationEvidence" && prisma.targets.has("sourceResultId") &&
        prisma.targets.has("sequence")) {
      return "ATOMIC_EVIDENCE_PAGINATION_IDENTITY_CONFLICT";
    }
    if (prisma.modelName === "LifecycleSetEvidenceMember") {
      return "ATOMIC_EVIDENCE_LIFECYCLE_IDENTITY_CONFLICT";
    }
    return "ATOMIC_EVIDENCE_UNIQUE_CONSTRAINT_FAILED";
  }
  const stage = atomicEvidencePersistenceStage(error);
  return stage ? ATOMIC_STAGE_FAILURE_CODE[stage] : "ATOMIC_EVIDENCE_COMMIT_FAILED";
}

export function tagAtomicEvidencePersistenceStage(
  error: unknown,
  stage: AtomicEvidencePersistenceStage
): unknown {
  if (typeof error === "object" && error !== null && Object.isExtensible(error)) {
    if (atomicEvidencePersistenceStage(error)) return error;
    Object.defineProperty(error, "atomicEvidencePersistenceStage", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: stage
    });
    return error;
  }
  const safeError = new Error(ATOMIC_STAGE_FAILURE_CODE[stage]);
  Object.defineProperty(safeError, "atomicEvidencePersistenceStage", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: stage
  });
  return safeError;
}

export function atomicEvidencePersistenceStage(error: unknown): AtomicEvidencePersistenceStage | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const value = (error as Record<string, unknown>).atomicEvidencePersistenceStage;
  return typeof value === "string" && PERSISTENCE_STAGE_SET.has(value)
    ? value as AtomicEvidencePersistenceStage
    : undefined;
}

function prismaErrorFacts(error: unknown): {
  code?: string;
  modelName?: string;
  targets: ReadonlySet<string>;
  databaseError?: string;
} {
  if (typeof error !== "object" || error === null) return { targets: new Set() };
  const record = error as Record<string, unknown>;
  const meta = typeof record.meta === "object" && record.meta !== null
    ? record.meta as Record<string, unknown>
    : {};
  const targets = Array.isArray(meta.target)
    ? meta.target.filter((value): value is string => typeof value === "string")
    : typeof meta.target === "string" ? [meta.target] : [];
  return {
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof meta.modelName === "string" ? { modelName: meta.modelName } : {}),
    targets: new Set(targets),
    ...(typeof meta.database_error === "string" ? { databaseError: meta.database_error } : {})
  };
}

function errorFacts(error: unknown): { code?: string; name?: string } {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null && !seen.has(current); depth += 1) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : undefined;
    const name = typeof record.name === "string" ? record.name : undefined;
    if (code !== undefined || name === "AbortError") return { ...(code ? { code } : {}), ...(name ? { name } : {}) };
    current = record.cause;
  }
  return {};
}
