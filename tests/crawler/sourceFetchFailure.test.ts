import { describe, expect, it } from "vitest";
import {
  retryableHttpTransportFailure,
  retryableTransportFailureFromError
} from "../../src/crawler/sourceFetchFailure";
import {
  atomicEvidenceFailureCode,
  transportFailureDiagnosticBundle
} from "../../src/crawler/sourceFailureDiagnostics";

describe("source transport retry classification", () => {
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
});
