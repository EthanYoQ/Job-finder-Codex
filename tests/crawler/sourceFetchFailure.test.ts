import { describe, expect, it } from "vitest";
import {
  isRetryableSourceTransportFailure,
  retryableHttpTransportFailure,
  retryableTransportFailureFromError,
  safeSourceTransportFailureReason
} from "../../src/crawler/sourceFetchFailure";
import {
  atomicEvidenceFailureCode,
  sourceExecutionFailureCode,
  tagAtomicEvidencePersistenceStage,
  transportFailureDiagnosticBundle
} from "../../src/crawler/sourceFailureDiagnostics";

describe("source transport retry classification", () => {
  it("maps thrown network failures to closed transport stages", () => {
    const cases = [
      [{ code: "ENOTFOUND" }, "SOURCE_FETCH_DNS_FAILED"],
      [{ cause: { code: "CERT_HAS_EXPIRED" } }, "SOURCE_FETCH_TLS_FAILED"],
      [{ cause: { code: "ECONNRESET" } }, "SOURCE_FETCH_CONNECT_FAILED"],
      [{ name: "AbortError" }, "SOURCE_FETCH_ABORTED"],
      [new Error("private response text"), "SOURCE_FETCH_EXECUTION_FAILED"]
    ] as const;

    expect(cases.map(([error]) => sourceExecutionFailureCode(error)))
      .toEqual(cases.map(([, code]) => code));
  });

  it.each([429, 500, 501, 502, 503, 504, 599])("allows transient HTTP status %s", (status) => {
    expect(retryableHttpTransportFailure(status)).toEqual({
      code: `OFFICIAL_HTTP_${status}`,
      retryable: true
    });
  });

  it.each([400, 401, 403, 404, 422, 600])("does not retry non-transient HTTP status %s", (status) => {
    expect(retryableHttpTransportFailure(status)).toBeUndefined();
  });

  it("does not convert configuration or parse errors into retries", () => {
    expect(retryableTransportFailureFromError(new Error("JSON parse failed"))).toBeUndefined();
    expect(retryableTransportFailureFromError(new Error("pagination config invalid"))).toBeUndefined();
  });

  it.each([
    ["OFFICIAL_PAGINATION_SNAPSHOT_DRIFT", "Official recruitment pagination changed during traversal"],
    ["OFFICIAL_BROWSER_SESSION_ERROR", "Official recruitment browser session failed before evidence capture"]
  ] as const)("allows the reviewed transient condition %s without raw details", (code, reason) => {
    const failure = { code, retryable: true as const, stage: "PAGE" as const };
    expect(isRetryableSourceTransportFailure(failure)).toBe(true);
    expect(safeSourceTransportFailureReason(failure)).toBe(reason);
  });

  it.each([
    { code: "ECONNRESET" },
    { cause: { code: "EAI_AGAIN" } },
    new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })
  ])("classifies a closed set of nested network exceptions as retryable", (error) => {
    expect(retryableTransportFailureFromError(error)).toEqual({
      code: "OFFICIAL_NETWORK_ERROR",
      retryable: true
    });
  });

  it("does not retry TLS, abort, or unclassified fetch exceptions", () => {
    expect(retryableTransportFailureFromError({ cause: { code: "CERT_HAS_EXPIRED" } })).toBeUndefined();
    expect(retryableTransportFailureFromError({ name: "AbortError" })).toBeUndefined();
    expect(retryableTransportFailureFromError(new TypeError("fetch failed"))).toBeUndefined();
  });

  it("persists a bounded generic diagnostic for any other retryable 5xx status", () => {
    expect(transportFailureDiagnosticBundle(
      retryableHttpTransportFailure(599),
      { fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_HTTP_599"] }
    )).toEqual({
      failureCategory: "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
      failureDiagnosticCode: "OFFICIAL_HTTP_5XX",
      fetchAttemptCount: 2,
      retryCount: 1,
      retryReasonCodes: ["OFFICIAL_HTTP_599"]
    });
  });

  it("persists bounded network retry diagnostics without raw exception text", () => {
    expect(transportFailureDiagnosticBundle(
      { code: "OFFICIAL_NETWORK_ERROR", retryable: true },
      { fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_NETWORK_ERROR"] }
    )).toEqual({
      failureCategory: "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
      failureDiagnosticCode: "OFFICIAL_NETWORK_ERROR",
      fetchAttemptCount: 2,
      retryCount: 1,
      retryReasonCodes: ["OFFICIAL_NETWORK_ERROR"]
    });
  });
});

describe("atomic evidence persistence diagnostics", () => {
  it.each([
    ["P2028", {}, "ATOMIC_EVIDENCE_TRANSACTION_TIMEOUT"],
    ["P2000", {}, "ATOMIC_EVIDENCE_VALUE_TOO_LONG"],
    ["P2003", {}, "ATOMIC_EVIDENCE_FOREIGN_KEY_FAILED"],
    ["P2002", { modelName: "EvidenceArtifact", target: ["path"] },
      "ATOMIC_EVIDENCE_ARTIFACT_PATH_CONFLICT"],
    ["P2002", { modelName: "Job", target: ["sourceId", "dedupeKey"] },
      "ATOMIC_EVIDENCE_JOB_IDENTITY_CONFLICT"],
    ["P2002", { modelName: "PaginationEvidence", target: ["sourceResultId", "sequence"] },
      "ATOMIC_EVIDENCE_PAGINATION_IDENTITY_CONFLICT"],
    ["P2002", { modelName: "LifecycleSetEvidenceMember", target: ["id"] },
      "ATOMIC_EVIDENCE_LIFECYCLE_IDENTITY_CONFLICT"],
    ["P2002", { modelName: "Unknown", target: ["unknown"] },
      "ATOMIC_EVIDENCE_UNIQUE_CONSTRAINT_FAILED"],
    ["P2004", { database_error: "CrawlBatchSourceResult_verified_lifecycle_projection" },
      "ATOMIC_EVIDENCE_LIFECYCLE_PROJECTION_FAILED"],
    ["P2004", { database_error: "other check" }, "ATOMIC_EVIDENCE_CONSTRAINT_FAILED"]
  ])("maps %s without retaining raw database text", (code, meta, expected) => {
    expect(atomicEvidenceFailureCode({ code, meta })).toBe(expected);
  });

  it("collapses unknown errors without retaining their message or metadata", () => {
    expect(atomicEvidenceFailureCode(new Error("secret database detail")))
      .toBe("ATOMIC_EVIDENCE_COMMIT_FAILED");
  });

  it.each([
    ["ATTESTATION", "ATOMIC_EVIDENCE_ATTESTATION_FAILED"],
    ["INPUT_VALIDATION", "ATOMIC_EVIDENCE_INPUT_VALIDATION_FAILED"],
    ["SOURCE_RESULT_VALIDATION", "ATOMIC_EVIDENCE_SOURCE_RESULT_VALIDATION_FAILED"],
    ["COMMAND_VALIDATION", "ATOMIC_EVIDENCE_COMMAND_VALIDATION_FAILED"],
    ["ARTIFACT_VALIDATION", "ATOMIC_EVIDENCE_ARTIFACT_VALIDATION_FAILED"],
    ["CERTIFICATE_VALIDATION", "ATOMIC_EVIDENCE_CERTIFICATE_VALIDATION_FAILED"],
    ["PAGINATION_VALIDATION", "ATOMIC_EVIDENCE_PAGINATION_VALIDATION_FAILED"],
    ["LOSS_LEDGER_VALIDATION", "ATOMIC_EVIDENCE_LOSS_LEDGER_VALIDATION_FAILED"],
    ["RECONCILIATION_VALIDATION", "ATOMIC_EVIDENCE_RECONCILIATION_VALIDATION_FAILED"],
    ["TRANSPORT_ATTEMPT_VALIDATION", "ATOMIC_EVIDENCE_TRANSPORT_ATTEMPT_VALIDATION_FAILED"],
    ["COMMITTED_EVIDENCE_VALIDATION", "ATOMIC_EVIDENCE_COMMITTED_EVIDENCE_VALIDATION_FAILED"],
    ["OWNERSHIP_FENCE", "ATOMIC_EVIDENCE_OWNERSHIP_FENCE_FAILED"],
    ["ARTIFACT_WRITE", "ATOMIC_EVIDENCE_ARTIFACT_WRITE_FAILED"],
    ["PAGINATION_WRITE", "ATOMIC_EVIDENCE_PAGINATION_WRITE_FAILED"],
    ["LOSS_LEDGER_WRITE", "ATOMIC_EVIDENCE_LOSS_LEDGER_WRITE_FAILED"],
    ["TRANSPORT_ATTEMPT_WRITE", "ATOMIC_EVIDENCE_TRANSPORT_ATTEMPT_WRITE_FAILED"],
    ["OBSERVATION_WRITE", "ATOMIC_EVIDENCE_OBSERVATION_WRITE_FAILED"],
    ["JOB_WRITE", "ATOMIC_EVIDENCE_JOB_WRITE_FAILED"],
    ["LIFECYCLE_WRITE", "ATOMIC_EVIDENCE_LIFECYCLE_WRITE_FAILED"],
    ["SOURCE_TERMINAL_WRITE", "ATOMIC_EVIDENCE_SOURCE_TERMINAL_WRITE_FAILED"],
    ["TRANSACTION_COMMIT", "ATOMIC_EVIDENCE_TRANSACTION_COMMIT_FAILED"]
  ] as const)("maps the redacted %s stage without serializing it", (stage, expected) => {
    const error = tagAtomicEvidencePersistenceStage(new Error("database secret"), stage);
    expect(atomicEvidenceFailureCode(error)).toBe(expected);
    expect(JSON.stringify(error)).not.toContain(stage);
    expect(JSON.stringify(error)).not.toContain("database secret");
  });
});
