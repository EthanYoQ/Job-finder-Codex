ALTER TYPE "SourceFailureDiagnosticCode"
ADD VALUE 'OFFICIAL_NETWORK_ERROR' AFTER 'OFFICIAL_HTTP_TIMEOUT';

ALTER TABLE "CrawlBatchSourceResult"
DROP CONSTRAINT "CrawlBatchSourceResult_retry_reason_codes_check";

ALTER TABLE "CrawlBatchSourceResult"
ADD CONSTRAINT "CrawlBatchSourceResult_retry_reason_codes_check"
CHECK (
  cardinality("retryReasonCodes") = COALESCE("retryCount", 0)
  AND (
    cardinality("retryReasonCodes") = 0
    OR array_to_string("retryReasonCodes", ',') ~
      '^LEGACY_RETRY_REASON_UNKNOWN(,LEGACY_RETRY_REASON_UNKNOWN)*$'
    OR (
      cardinality("retryReasonCodes") <= 2
      AND array_to_string("retryReasonCodes", ',') ~
        '^(OFFICIAL_HTTP_TIMEOUT|OFFICIAL_NETWORK_ERROR|OFFICIAL_HTTP_429|OFFICIAL_HTTP_5[0-9][0-9])(,(OFFICIAL_HTTP_TIMEOUT|OFFICIAL_NETWORK_ERROR|OFFICIAL_HTTP_429|OFFICIAL_HTTP_5[0-9][0-9]))?$'
    )
  )
);
