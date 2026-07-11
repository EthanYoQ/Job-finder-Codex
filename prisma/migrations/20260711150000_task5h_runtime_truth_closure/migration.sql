ALTER TABLE "CrawlBatchSourceResult"
  ALTER COLUMN "officialEntryId" DROP NOT NULL;

ALTER TABLE "TransportAttemptEvidence"
  ADD COLUMN "pageTraceSha256" TEXT NOT NULL,
  ADD COLUMN "lossLedgerSha256" TEXT NOT NULL,
  ADD COLUMN "paginationEvaluationSha256" TEXT NOT NULL;

ALTER TABLE "TransportAttemptEvidence"
  ADD CONSTRAINT "TransportAttemptEvidence_pageTraceSha256_format"
    CHECK ("pageTraceSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransportAttemptEvidence_lossLedgerSha256_format"
    CHECK ("lossLedgerSha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "TransportAttemptEvidence_paginationEvaluationSha256_format"
    CHECK ("paginationEvaluationSha256" ~ '^[0-9a-f]{64}$');
