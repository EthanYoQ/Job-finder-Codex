CREATE TYPE "SourceFailureCategory" AS ENUM (
  'TEMPORARY_OFFICIAL_SOURCE_FAILURE',
  'SOURCE_TIME_LIMIT_REACHED',
  'OFFICIAL_SOURCE_REVIEW_REQUIRED',
  'EVIDENCE_PERSISTENCE_FAILURE',
  'UNCLASSIFIED_SOURCE_FAILURE'
);

CREATE TYPE "SourceFailureDiagnosticCode" AS ENUM (
  'OFFICIAL_HTTP_TIMEOUT',
  'OFFICIAL_HTTP_429',
  'OFFICIAL_HTTP_502',
  'OFFICIAL_HTTP_503',
  'OFFICIAL_HTTP_504',
  'SOURCE_ATTEMPT_TIMEOUT',
  'FETCH_EXECUTION_FAILED',
  'FETCH_FAILED_CLOSED',
  'ADAPTER_EXECUTION_FAILED',
  'ADAPTER_FAILED_CLOSED',
  'EVIDENCE_PROCESSING_FAILED',
  'BATCH_ABORTED_BEFORE_SOURCE_TERMINAL'
);

ALTER TABLE "CrawlBatchSourceResult"
  ADD COLUMN "failureCategory" "SourceFailureCategory",
  ADD COLUMN "failureDiagnosticCode" "SourceFailureDiagnosticCode",
  ADD COLUMN "fetchAttemptCount" INTEGER,
  ADD COLUMN "retryCount" INTEGER;

ALTER TABLE "CrawlBatchSourceResult"
  ADD CONSTRAINT "CrawlBatchSourceResult_failure_diagnostic_bundle_check" CHECK (
    (
      "failureCategory" IS NULL AND
      "failureDiagnosticCode" IS NULL AND
      "fetchAttemptCount" IS NULL AND
      "retryCount" IS NULL
    ) OR (
      "failureCategory" IS NULL AND
      "failureDiagnosticCode" IS NULL AND
      "fetchAttemptCount" IS NOT NULL AND
      "retryCount" IS NOT NULL AND
      "fetchAttemptCount" > 0 AND
      "retryCount" >= 0 AND
      "retryCount" < "fetchAttemptCount" AND
      "transportState" = 'SUCCEEDED' AND
      "adapterState" = 'SUCCEEDED' AND
      "atomicCommitState" = 'COMMITTED' AND
      "failureCode" IS NULL
    ) OR (
      "failureCategory" IS NOT NULL AND
      "failureDiagnosticCode" IS NOT NULL AND
      "fetchAttemptCount" IS NOT NULL AND
      "retryCount" IS NOT NULL AND
      "fetchAttemptCount" >= 0 AND
      "retryCount" >= 0 AND
      "atomicCommitState" <> 'PENDING' AND
      "failureCode" IS NOT NULL AND
      (
        ("fetchAttemptCount" > 0 AND "retryCount" < "fetchAttemptCount") OR
        (
          "fetchAttemptCount" = 0 AND
          "retryCount" = 0 AND
          "failureDiagnosticCode" = 'BATCH_ABORTED_BEFORE_SOURCE_TERMINAL'
        )
      )
    )
  );
