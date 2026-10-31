-- Preserve terminal pre-request manual batches without inventing ownership.
-- These legacy rows remain available for audit, but detaching their RC identity
-- and clearing their kind prevents them from satisfying staged publication.
DO $$
DECLARE
  unsafe_count BIGINT;
BEGIN
  SELECT count(*)
  INTO unsafe_count
  FROM "CrawlBatch" AS batch
  WHERE batch."kind" = 'MANUAL_SOURCE'
    AND NOT EXISTS (
      SELECT 1 FROM "ManualCrawlRequest" AS request
      WHERE request."crawlBatchId" = batch."id"
    )
    AND (
      batch."finishedAt" IS NULL
      OR batch."status" NOT IN ('INCOMPLETE', 'ABORTED', 'SUCCESS', 'FAILED')
      OR EXISTS (SELECT 1 FROM "CrawlBatchSourceResult" AS child WHERE child."batchId" = batch."id")
      OR EXISTS (SELECT 1 FROM "EvidenceArtifact" AS child WHERE child."batchId" = batch."id")
      OR EXISTS (SELECT 1 FROM "PaginationEvidence" AS child WHERE child."batchId" = batch."id")
      OR EXISTS (SELECT 1 FROM "LossLedgerEntry" AS child WHERE child."batchId" = batch."id")
      OR EXISTS (SELECT 1 FROM "TransportAttemptEvidence" AS child WHERE child."batchId" = batch."id")
      OR EXISTS (SELECT 1 FROM "LifecycleSetEvidenceMember" AS child WHERE child."batchId" = batch."id")
      OR EXISTS (
        SELECT 1 FROM "CrawlObservation" AS child
        WHERE child."batchId" = batch."id" AND child."releaseCandidateId" IS NOT NULL
      )
    );

  IF unsafe_count <> 0 THEN
    RAISE EXCEPTION 'LEGACY_MANUAL_BATCH_QUARANTINE_UNSAFE_COUNT:%', unsafe_count;
  END IF;
END $$;

UPDATE "CrawlBatch" AS batch
SET "kind" = NULL,
    "releaseCandidateId" = NULL
WHERE batch."kind" = 'MANUAL_SOURCE'
  AND batch."finishedAt" IS NOT NULL
  AND batch."status" IN ('INCOMPLETE', 'ABORTED', 'SUCCESS', 'FAILED')
  AND NOT EXISTS (
    SELECT 1 FROM "ManualCrawlRequest" AS request
    WHERE request."crawlBatchId" = batch."id"
  )
  AND NOT EXISTS (SELECT 1 FROM "CrawlBatchSourceResult" AS child WHERE child."batchId" = batch."id")
  AND NOT EXISTS (SELECT 1 FROM "EvidenceArtifact" AS child WHERE child."batchId" = batch."id")
  AND NOT EXISTS (SELECT 1 FROM "PaginationEvidence" AS child WHERE child."batchId" = batch."id")
  AND NOT EXISTS (SELECT 1 FROM "LossLedgerEntry" AS child WHERE child."batchId" = batch."id")
  AND NOT EXISTS (SELECT 1 FROM "TransportAttemptEvidence" AS child WHERE child."batchId" = batch."id")
  AND NOT EXISTS (SELECT 1 FROM "LifecycleSetEvidenceMember" AS child WHERE child."batchId" = batch."id")
  AND NOT EXISTS (
    SELECT 1 FROM "CrawlObservation" AS child
    WHERE child."batchId" = batch."id" AND child."releaseCandidateId" IS NOT NULL
  );
