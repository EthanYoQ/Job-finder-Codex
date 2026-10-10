ALTER TYPE "SourceFailureDiagnosticCode" ADD VALUE 'OFFICIAL_HTTP_5XX' AFTER 'OFFICIAL_HTTP_504';
ALTER TYPE "TransportAttemptCode" ADD VALUE 'HCM_BROWSER_SUCCEEDED' AFTER 'HCM_BROWSER_LIST_FAILED';

ALTER TABLE "TransportAttemptEvidence"
ADD CONSTRAINT "TransportAttemptEvidence_code_outcome_check"
CHECK (
  ("code"::TEXT = 'HCM_DIRECT_FAILED' AND "transport" = 'DIRECT_HTTP' AND "outcome" = 'FAILED') OR
  ("code"::TEXT = 'HCM_BROWSER_SUCCEEDED' AND "transport" = 'BROWSER_SESSION' AND "outcome" = 'SUCCEEDED') OR
  ("code"::TEXT LIKE 'HCM_BROWSER_%' AND "code"::TEXT <> 'HCM_BROWSER_SUCCEEDED' AND
    "transport" = 'BROWSER_SESSION' AND "outcome" = 'FAILED')
) NOT VALID;

ALTER TABLE "CrawlBatchSourceResult"
ADD COLUMN "retryReasonCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Historical rows predate reason capture. Preserve their exact retry count without
-- inventing a timeout or HTTP status that was never recorded.
UPDATE "CrawlBatchSourceResult"
SET "retryReasonCodes" = array_fill(
  'LEGACY_RETRY_REASON_UNKNOWN'::TEXT,
  ARRAY["retryCount"]
)
WHERE "retryCount" > 0;

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
        '^(OFFICIAL_HTTP_TIMEOUT|OFFICIAL_HTTP_429|OFFICIAL_HTTP_5[0-9][0-9])(,(OFFICIAL_HTTP_TIMEOUT|OFFICIAL_HTTP_429|OFFICIAL_HTTP_5[0-9][0-9]))?$'
    )
  )
);
