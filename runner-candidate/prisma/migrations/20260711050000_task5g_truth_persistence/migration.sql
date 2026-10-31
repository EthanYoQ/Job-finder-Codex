ALTER TYPE "PaginationTermination" ADD VALUE IF NOT EXISTS 'CONTINUE';
ALTER TYPE "PaginationAnomalyCode" ADD VALUE IF NOT EXISTS 'RETURNED_PAGE_SIZE_MISMATCH';
ALTER TYPE "PaginationAnomalyCode" ADD VALUE IF NOT EXISTS 'INTERMEDIATE_SHORT_PAGE';
ALTER TYPE "PaginationAnomalyCode" ADD VALUE IF NOT EXISTS 'DECLARED_CAPACITY_CONTRADICTION';
ALTER TYPE "PaginationAnomalyCode" ADD VALUE IF NOT EXISTS 'RAW_ID_OVERLAP_ACROSS_PAGES';

CREATE TYPE "TransportAttemptKind" AS ENUM ('DIRECT_HTTP', 'BROWSER_SESSION');
CREATE TYPE "TransportAttemptOutcome" AS ENUM ('FAILED', 'SUCCEEDED');
CREATE TYPE "TransportAttemptCode" AS ENUM ('HCM_DIRECT_FAILED', 'HCM_BROWSER_SESSION_FAILED',
  'HCM_BROWSER_ENTRY_FAILED', 'HCM_BROWSER_COUNT_FAILED', 'HCM_BROWSER_LIST_FAILED');

ALTER TABLE "CrawlBatchSourceResult"
  ADD COLUMN "canonicalOutputSetSha256" TEXT,
  ADD COLUMN "adapterInputCount" INTEGER,
  ADD COLUMN "adapterOutputCount" INTEGER,
  ADD COLUMN "adapterLossCount" INTEGER,
  ADD COLUMN "adapterCollisionGroupCount" INTEGER,
  ADD COLUMN "adapterReconciliationSha256" TEXT,
  ADD COLUMN "collisionLedgerSha256" TEXT;

ALTER TABLE "EvidenceArtifact" ADD COLUMN "redactionCommitmentSha256" TEXT NOT NULL;
ALTER TABLE "PaginationEvidence"
  ADD COLUMN "requestedPageSize" INTEGER,
  ADD COLUMN "returnedPageSize" INTEGER;
ALTER TABLE "CrawlObservation" ADD COLUMN "artifactRedactionCommitmentSha256" TEXT;

ALTER TABLE "CrawlBatchSourceResult" ADD CONSTRAINT "CrawlBatchSourceResult_task5g_truth_check" CHECK (
  ("atomicCommitState" <> 'COMMITTED' AND "canonicalOutputSetSha256" IS NULL AND
    "adapterInputCount" IS NULL AND "adapterOutputCount" IS NULL AND "adapterLossCount" IS NULL AND
    "adapterCollisionGroupCount" IS NULL AND "adapterReconciliationSha256" IS NULL AND "collisionLedgerSha256" IS NULL)
  OR
  ("atomicCommitState" = 'COMMITTED' AND "canonicalOutputSetSha256" ~ '^[0-9a-f]{64}$' AND
    "adapterReconciliationSha256" ~ '^[0-9a-f]{64}$' AND "collisionLedgerSha256" ~ '^[0-9a-f]{64}$' AND
    "adapterInputCount" >= 0 AND "adapterOutputCount" >= 0 AND "adapterLossCount" >= 0 AND
    "adapterCollisionGroupCount" >= 0 AND
    "adapterInputCount" = "adapterOutputCount" + "adapterLossCount" AND
    "adapterOutputCount" = "dedupeOutputCount" AND "adapterCollisionGroupCount" = "collisionCount")
);
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_page_capacity_check" CHECK (
  ("requestedPageSize" IS NULL OR "requestedPageSize" > 0) AND
  ("returnedPageSize" IS NULL OR "returnedPageSize" > 0)
);
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_redaction_commitment_check"
  CHECK ("redactionCommitmentSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_task5g_redaction_check" CHECK (
  ("releaseCandidateId" IS NULL AND "artifactRedactionCommitmentSha256" IS NULL) OR
  ("releaseCandidateId" IS NOT NULL AND "artifactRedactionCommitmentSha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "TransportAttemptEvidence" (
  "id" TEXT NOT NULL,
  "releaseCandidateId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceResultId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "transport" "TransportAttemptKind" NOT NULL,
  "outcome" "TransportAttemptOutcome" NOT NULL,
  "code" "TransportAttemptCode" NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "evidenceCommitmentSha256" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  CONSTRAINT "TransportAttemptEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransportAttemptEvidence_value_check" CHECK (
    "sequence" >= 0 AND
    "evidenceCommitmentSha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "TransportAttemptEvidence_tuple_key"
  ON "TransportAttemptEvidence"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId");
CREATE UNIQUE INDEX "TransportAttemptEvidence_sourceResultId_sequence_key"
  ON "TransportAttemptEvidence"("sourceResultId", "sequence");
CREATE INDEX "TransportAttemptEvidence_releaseCandidateId_batchId_sourceId_idx"
  ON "TransportAttemptEvidence"("releaseCandidateId", "batchId", "sourceId");
ALTER TABLE "TransportAttemptEvidence" ADD CONSTRAINT "TransportAttemptEvidence_source_result_tuple_fkey"
  FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId")
  REFERENCES "CrawlBatchSourceResult"("id", "releaseCandidateId", "batchId", "sourceId") ON DELETE RESTRICT;
ALTER TABLE "TransportAttemptEvidence" ADD CONSTRAINT "TransportAttemptEvidence_batch_rc_tuple_fkey"
  FOREIGN KEY ("batchId", "releaseCandidateId") REFERENCES "CrawlBatch"("id", "releaseCandidateId") ON DELETE RESTRICT;
ALTER TABLE "TransportAttemptEvidence" ADD CONSTRAINT "TransportAttemptEvidence_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE RESTRICT;

CREATE TABLE "TransportAttemptArtifact" (
  "attemptId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "releaseCandidateId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceResultId" TEXT NOT NULL,
  CONSTRAINT "TransportAttemptArtifact_pkey" PRIMARY KEY ("attemptId", "artifactId")
);
CREATE INDEX "TransportAttemptArtifact_artifactId_idx" ON "TransportAttemptArtifact"("artifactId");
ALTER TABLE "TransportAttemptArtifact" ADD CONSTRAINT "TransportAttemptArtifact_attempt_tuple_fkey"
  FOREIGN KEY ("attemptId", "releaseCandidateId", "batchId", "sourceId", "sourceResultId")
  REFERENCES "TransportAttemptEvidence"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") ON DELETE RESTRICT;
ALTER TABLE "TransportAttemptArtifact" ADD CONSTRAINT "TransportAttemptArtifact_artifact_tuple_fkey"
  FOREIGN KEY ("artifactId", "releaseCandidateId", "batchId", "sourceId", "sourceResultId")
  REFERENCES "EvidenceArtifact"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION prevent_transport_attempt_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'TransportAttemptEvidence is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "TransportAttemptEvidence_immutable" BEFORE UPDATE OR DELETE ON "TransportAttemptEvidence"
FOR EACH ROW EXECUTE FUNCTION prevent_transport_attempt_mutation();
