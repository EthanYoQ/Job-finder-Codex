-- CreateEnum
CREATE TYPE "ReleaseCandidateStatus" AS ENUM ('TRUST_FREEZE', 'BUILDING', 'READY_FOR_QA', 'QA_FAILED', 'RELEASED', 'INVALIDATED');
CREATE TYPE "CrawlBatchKind" AS ENUM ('FULL_RELEASE', 'SCHEDULED', 'MANUAL_SOURCE', 'BASELINE');
CREATE TYPE "TransportState" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'SKIPPED');
CREATE TYPE "AdapterState" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'SKIPPED');
CREATE TYPE "AtomicCommitState" AS ENUM ('PENDING', 'COMMITTED', 'ROLLED_BACK', 'NOT_ATTEMPTED', 'FAILED');
CREATE TYPE "EvidenceArtifactKind" AS ENUM ('OFFICIAL_COMPANY_PAGE', 'REDIRECT_TRACE', 'ATS_PAGE', 'ATS_API_RESPONSE', 'PAGINATION_PAGE', 'SCREENSHOT', 'DEDUPE_LEDGER', 'ORACLE_RESULT', 'COMMAND_OUTPUT');
CREATE TYPE "LossStage" AS ENUM ('PARSE', 'VALIDATION', 'NORMALIZATION', 'DEDUPE');
CREATE TYPE "PaginationTermination" AS ENUM ('NEXT_ABSENT', 'DECLARED_TOTAL_REACHED', 'EMPTY_PAGE', 'REPEATED_CURSOR', 'MAX_PAGE_LIMIT', 'FAILED', 'ABORTED');
CREATE TYPE "PaginationAnomalyCode" AS ENUM ('REPEATED_RESPONSE_FINGERPRINT', 'REPEATED_JOB_ID_SET_WITH_NEXT', 'CURSOR_NOT_ADVANCING', 'OFFSET_NOT_ADVANCING', 'INTERMEDIATE_EMPTY_PAGE', 'TOTAL_CHANGED', 'MAX_PAGES_WITH_NEXT', 'EXPECTED_CHANNEL_NOT_VISITED', 'RETURNED_PAGE_MISMATCH');

-- CreateTable
CREATE TABLE "ReleaseCandidate" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "commitSha" TEXT NOT NULL,
    "dbSnapshotHash" TEXT NOT NULL,
    "schemaHash" TEXT NOT NULL,
    "migrationVersion" TEXT NOT NULL,
    "rosterHash" TEXT NOT NULL,
    "sourcePlanHash" TEXT NOT NULL,
    "sourceConfigHash" TEXT NOT NULL,
    "adapterBundleHash" TEXT NOT NULL,
    "oracleVersion" TEXT NOT NULL,
    "status" "ReleaseCandidateStatus" NOT NULL DEFAULT 'TRUST_FREEZE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    CONSTRAINT "ReleaseCandidate_pkey" PRIMARY KEY ("id")
);

-- AlterTable: every added batch field is nullable so legacy rows remain ineligible evidence.
ALTER TABLE "CrawlBatch"
    ADD COLUMN "releaseCandidateId" TEXT,
    ADD COLUMN "commitSha" TEXT,
    ADD COLUMN "rosterSha256" TEXT,
    ADD COLUMN "sourcePlanSha256" TEXT,
    ADD COLUMN "sourceConfigSha256" TEXT,
    ADD COLUMN "adapterBundleSha256" TEXT,
    ADD COLUMN "kind" "CrawlBatchKind",
    ADD COLUMN "plannedSourceIds" JSONB,
    ADD COLUMN "plannedSourceSetSha256" TEXT,
    ADD COLUMN "plannedSourceCount" INTEGER,
    ADD COLUMN "transportSucceededCount" INTEGER,
    ADD COLUMN "transportFailedCount" INTEGER,
    ADD COLUMN "adapterSucceededCount" INTEGER,
    ADD COLUMN "adapterFailedCount" INTEGER,
    ADD COLUMN "completenessVerifiedCount" INTEGER,
    ADD COLUMN "completenessIncompleteCount" INTEGER,
    ADD COLUMN "atomicCommittedCount" INTEGER,
    ADD COLUMN "atomicFailedCount" INTEGER,
    ADD COLUMN "failedSourceCount" INTEGER,
    ADD COLUMN "blockedSourceCount" INTEGER,
    ADD COLUMN "skippedSourceCount" INTEGER,
    ADD COLUMN "ownerId" TEXT,
    ADD COLUMN "heartbeatAt" TIMESTAMP(3),
    ADD COLUMN "aggregateJobSetSha256" TEXT;

-- CreateTable
CREATE TABLE "CrawlBatchSourceResult" (
    "id" TEXT NOT NULL,
    "releaseCandidateId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "transportState" "TransportState" NOT NULL,
    "adapterState" "AdapterState" NOT NULL,
    "completenessState" "CompletenessStatus" NOT NULL,
    "atomicCommitState" "AtomicCommitState" NOT NULL,
    "sourceConfigHash" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "officialEntryId" TEXT NOT NULL,
    "officialSurfaceIds" TEXT[] NOT NULL,
    "officialChannelIds" TEXT[] NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "rawCount" INTEGER NOT NULL,
    "parsedCount" INTEGER NOT NULL,
    "validCount" INTEGER NOT NULL,
    "normalizedCount" INTEGER NOT NULL,
    "dedupeInputCount" INTEGER NOT NULL,
    "dedupeOutputCount" INTEGER NOT NULL,
    "parseDiscardCount" INTEGER NOT NULL,
    "validationDiscardCount" INTEGER NOT NULL,
    "normalizationDiscardCount" INTEGER NOT NULL,
    "dedupeDiscardCount" INTEGER NOT NULL,
    "collisionCount" INTEGER NOT NULL,
    "discardCount" INTEGER NOT NULL,
    "expectedJobCount" INTEGER,
    "expectedEvidenceKind" "CompletenessEvidenceKind",
    "expectedSurfaceSha256" TEXT,
    "visitedSurfaceSha256" TEXT,
    "expectedChannelSha256" TEXT,
    "visitedChannelSha256" TEXT,
    "canonicalCurrentJobSetSha256" TEXT,
    "canonicalGraceJobSetSha256" TEXT,
    "canonicalVisibleJobSetSha256" TEXT,
    "blockerCode" TEXT,
    "blockerReason" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrawlBatchSourceResult_pkey" PRIMARY KEY ("id")
);

-- AlterTable: nullable additions intentionally do not backfill historical observations.
ALTER TABLE "CrawlObservation" DROP CONSTRAINT "CrawlObservation_batchId_fkey";
ALTER TABLE "CrawlObservation"
    ALTER COLUMN "batchId" DROP NOT NULL,
    ADD COLUMN "releaseCandidateId" TEXT,
    ADD COLUMN "sourceResultId" TEXT,
    ADD COLUMN "commitSha" TEXT,
    ADD COLUMN "rosterSha256" TEXT,
    ADD COLUMN "sourcePlanSha256" TEXT,
    ADD COLUMN "sourceConfigSha256" TEXT,
    ADD COLUMN "adapterVersion" TEXT,
    ADD COLUMN "observedFrom" TIMESTAMP(3),
    ADD COLUMN "observedTo" TIMESTAMP(3),
    ADD COLUMN "transportSucceeded" BOOLEAN,
    ADD COLUMN "adapterSucceeded" BOOLEAN,
    ADD COLUMN "completenessVerified" BOOLEAN,
    ADD COLUMN "atomicCommitSucceeded" BOOLEAN,
    ADD COLUMN "rawCount" INTEGER,
    ADD COLUMN "parsedCount" INTEGER,
    ADD COLUMN "validCount" INTEGER,
    ADD COLUMN "normalizedCount" INTEGER,
    ADD COLUMN "dedupeInputCount" INTEGER,
    ADD COLUMN "dedupeOutputCount" INTEGER,
    ADD COLUMN "parseDiscardCount" INTEGER,
    ADD COLUMN "validationDiscardCount" INTEGER,
    ADD COLUMN "normalizationDiscardCount" INTEGER,
    ADD COLUMN "dedupeDiscardCount" INTEGER,
    ADD COLUMN "discardCount" INTEGER,
    ADD COLUMN "collisionCount" INTEGER,
    ADD COLUMN "canonicalRawSha256" TEXT,
    ADD COLUMN "canonicalOutputSha256" TEXT,
    ADD COLUMN "canonicalGraceSha256" TEXT,
    ADD COLUMN "canonicalVisibleSha256" TEXT,
    ADD COLUMN "expectedSurfaceSha256" TEXT,
    ADD COLUMN "visitedSurfaceSha256" TEXT,
    ADD COLUMN "expectedChannelSha256" TEXT,
    ADD COLUMN "visitedChannelSha256" TEXT,
    ADD COLUMN "paginationTraceSha256" TEXT,
    ADD COLUMN "officialEvidenceArtifactId" TEXT;

-- CreateTable
CREATE TABLE "EvidenceArtifact" (
    "id" TEXT NOT NULL,
    "releaseCandidateId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceResultId" TEXT NOT NULL,
    "channelId" TEXT,
    "kind" "EvidenceArtifactKind" NOT NULL,
    "requestedUrl" TEXT,
    "finalUrl" TEXT,
    "httpStatus" INTEGER,
    "contentType" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteCount" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "extractorLocator" TEXT NOT NULL,
    "captureToolName" TEXT NOT NULL,
    "captureToolVersion" TEXT NOT NULL,
    CONSTRAINT "EvidenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaginationEvidence" (
    "id" TEXT NOT NULL,
    "releaseCandidateId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceResultId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "channelId" TEXT,
    "requestedCursor" TEXT,
    "returnedCursor" TEXT,
    "requestedOffset" INTEGER,
    "returnedOffset" INTEGER,
    "requestedPage" INTEGER,
    "returnedPage" INTEGER,
    "responseFingerprintSha256" TEXT NOT NULL,
    "rawJobIdSetSha256" TEXT NOT NULL,
    "validJobIdSetSha256" TEXT NOT NULL,
    "declaredTotal" INTEGER,
    "declaredCount" INTEGER,
    "declaredPages" INTEGER,
    "nextPageSignalBefore" TEXT,
    "nextPageSignalAfter" TEXT,
    "termination" "PaginationTermination" NOT NULL,
    "anomalyCodes" "PaginationAnomalyCode"[],
    "capturedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaginationEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossLedgerEntry" (
    "id" TEXT NOT NULL,
    "releaseCandidateId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceResultId" TEXT NOT NULL,
    "stage" "LossStage" NOT NULL,
    "reason" TEXT NOT NULL,
    "rawLocator" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "candidateKey" TEXT,
    "winnerKey" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LossLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- Fail-closed checks: legacy rows remain nullable, while every RC-bound row must be complete.
ALTER TABLE "CrawlBatch" ADD CONSTRAINT "CrawlBatch_rc_provenance_check" CHECK (
    "releaseCandidateId" IS NULL OR (
        "commitSha" IS NOT NULL AND "rosterSha256" IS NOT NULL AND
        "sourcePlanSha256" IS NOT NULL AND "sourceConfigSha256" IS NOT NULL AND
        "adapterBundleSha256" IS NOT NULL AND "kind" IS NOT NULL AND
        "plannedSourceIds" IS NOT NULL AND "plannedSourceSetSha256" IS NOT NULL AND
        "plannedSourceCount" IS NOT NULL AND
        "transportSucceededCount" IS NOT NULL AND "transportFailedCount" IS NOT NULL AND
        "adapterSucceededCount" IS NOT NULL AND "adapterFailedCount" IS NOT NULL AND
        "completenessVerifiedCount" IS NOT NULL AND "completenessIncompleteCount" IS NOT NULL AND
        "atomicCommittedCount" IS NOT NULL AND "atomicFailedCount" IS NOT NULL AND
        "failedSourceCount" IS NOT NULL AND "blockedSourceCount" IS NOT NULL AND
        "skippedSourceCount" IS NOT NULL AND "ownerId" IS NOT NULL AND "heartbeatAt" IS NOT NULL AND
        "plannedSourceCount" >= 0 AND
        "transportSucceededCount" >= 0 AND "transportFailedCount" >= 0 AND
        "adapterSucceededCount" >= 0 AND "adapterFailedCount" >= 0 AND
        "completenessVerifiedCount" >= 0 AND "completenessIncompleteCount" >= 0 AND
        "atomicCommittedCount" >= 0 AND "atomicFailedCount" >= 0 AND
        "failedSourceCount" >= 0 AND "blockedSourceCount" >= 0 AND "skippedSourceCount" >= 0 AND
        ("status" = 'RUNNING' OR ("finishedAt" IS NOT NULL AND "aggregateJobSetSha256" IS NOT NULL))
    )
);

ALTER TABLE "CrawlBatchSourceResult" ADD CONSTRAINT "CrawlBatchSourceResult_loss_reconciliation_check" CHECK (
    "rawCount" = "parsedCount" + "parseDiscardCount" AND
    "parsedCount" = "validCount" + "validationDiscardCount" AND
    "validCount" = "normalizedCount" + "normalizationDiscardCount" AND
    "normalizedCount" = "dedupeInputCount" AND
    "dedupeInputCount" = "dedupeOutputCount" + "dedupeDiscardCount" AND
    "discardCount" = "parseDiscardCount" + "validationDiscardCount" + "normalizationDiscardCount" + "dedupeDiscardCount" AND
    "rawCount" >= 0 AND "parsedCount" >= 0 AND "validCount" >= 0 AND "normalizedCount" >= 0 AND
    "dedupeInputCount" >= 0 AND "dedupeOutputCount" >= 0 AND
    "parseDiscardCount" >= 0 AND "validationDiscardCount" >= 0 AND
    "normalizationDiscardCount" >= 0 AND "dedupeDiscardCount" >= 0 AND
    "discardCount" >= 0 AND "collisionCount" >= 0
);

ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_rc_provenance_check" CHECK (
    "releaseCandidateId" IS NULL OR (
        "batchId" IS NOT NULL AND "sourceResultId" IS NOT NULL AND "officialEvidenceArtifactId" IS NOT NULL AND
        "commitSha" IS NOT NULL AND
        "rosterSha256" IS NOT NULL AND "sourcePlanSha256" IS NOT NULL AND
        "sourceConfigSha256" IS NOT NULL AND "adapterVersion" IS NOT NULL AND
        "observedFrom" IS NOT NULL AND "observedTo" IS NOT NULL AND
        "transportSucceeded" IS NOT NULL AND "adapterSucceeded" IS NOT NULL AND
        "completenessVerified" IS NOT NULL AND "atomicCommitSucceeded" IS NOT NULL AND
        "rawCount" IS NOT NULL AND "parsedCount" IS NOT NULL AND "validCount" IS NOT NULL AND
        "normalizedCount" IS NOT NULL AND "dedupeInputCount" IS NOT NULL AND "dedupeOutputCount" IS NOT NULL AND
        "parseDiscardCount" IS NOT NULL AND "validationDiscardCount" IS NOT NULL AND
        "normalizationDiscardCount" IS NOT NULL AND "dedupeDiscardCount" IS NOT NULL AND
        "discardCount" IS NOT NULL AND "collisionCount" IS NOT NULL
    )
);

ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_loss_reconciliation_check" CHECK (
    "releaseCandidateId" IS NULL OR (
        "rawCount" = "parsedCount" + "parseDiscardCount" AND
        "parsedCount" = "validCount" + "validationDiscardCount" AND
        "validCount" = "normalizedCount" + "normalizationDiscardCount" AND
        "normalizedCount" = "dedupeInputCount" AND
        "dedupeInputCount" = "dedupeOutputCount" + "dedupeDiscardCount" AND
        "discardCount" = "parseDiscardCount" + "validationDiscardCount" + "normalizationDiscardCount" + "dedupeDiscardCount" AND
        "rawCount" >= 0 AND "parsedCount" >= 0 AND "validCount" >= 0 AND "normalizedCount" >= 0 AND
        "dedupeInputCount" >= 0 AND "dedupeOutputCount" >= 0 AND
        "parseDiscardCount" >= 0 AND "validationDiscardCount" >= 0 AND
        "normalizationDiscardCount" >= 0 AND "dedupeDiscardCount" >= 0 AND
        "discardCount" >= 0 AND "collisionCount" >= 0
    )
);

ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_network_provenance_check" CHECK (
    "kind" NOT IN ('OFFICIAL_COMPANY_PAGE', 'REDIRECT_TRACE', 'ATS_PAGE', 'ATS_API_RESPONSE', 'PAGINATION_PAGE') OR (
        "requestedUrl" IS NOT NULL AND "finalUrl" IS NOT NULL AND
        "httpStatus" IS NOT NULL AND "contentType" IS NOT NULL
    )
);

-- CreateIndex
CREATE INDEX "ReleaseCandidate_commitSha_idx" ON "ReleaseCandidate"("commitSha");
CREATE INDEX "ReleaseCandidate_status_createdAt_idx" ON "ReleaseCandidate"("status", "createdAt");
CREATE UNIQUE INDEX "ReleaseCandidate_goalId_version_key" ON "ReleaseCandidate"("goalId", "version");
CREATE UNIQUE INDEX "CrawlBatch_id_releaseCandidateId_key" ON "CrawlBatch"("id", "releaseCandidateId");
CREATE INDEX "CrawlBatch_releaseCandidateId_startedAt_idx" ON "CrawlBatch"("releaseCandidateId", "startedAt");
CREATE INDEX "CrawlBatch_status_startedAt_idx" ON "CrawlBatch"("status", "startedAt");
CREATE INDEX "CrawlBatch_ownerId_heartbeatAt_idx" ON "CrawlBatch"("ownerId", "heartbeatAt");
CREATE INDEX "CrawlBatchSourceResult_releaseCandidateId_sourceId_idx" ON "CrawlBatchSourceResult"("releaseCandidateId", "sourceId");
CREATE INDEX "CrawlBatchSourceResult_sourceId_finishedAt_idx" ON "CrawlBatchSourceResult"("sourceId", "finishedAt");
CREATE UNIQUE INDEX "CrawlBatchSourceResult_batchId_sourceId_key" ON "CrawlBatchSourceResult"("batchId", "sourceId");
CREATE UNIQUE INDEX "CrawlBatchSourceResult_id_releaseCandidateId_batchId_sourceId_key" ON "CrawlBatchSourceResult"("id", "releaseCandidateId", "batchId", "sourceId");
CREATE INDEX "CrawlObservation_releaseCandidateId_sourceId_idx" ON "CrawlObservation"("releaseCandidateId", "sourceId");
CREATE INDEX "CrawlObservation_batchId_sourceId_idx" ON "CrawlObservation"("batchId", "sourceId");
CREATE INDEX "CrawlObservation_officialEvidenceArtifactId_idx" ON "CrawlObservation"("officialEvidenceArtifactId");
CREATE INDEX "CrawlObservation_sourceResultId_idx" ON "CrawlObservation"("sourceResultId");
CREATE UNIQUE INDEX "EvidenceArtifact_path_key" ON "EvidenceArtifact"("path");
CREATE UNIQUE INDEX "EvidenceArtifact_id_releaseCandidateId_batchId_sourceId_sourceResultId_key" ON "EvidenceArtifact"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId");
CREATE INDEX "EvidenceArtifact_sha256_idx" ON "EvidenceArtifact"("sha256");
CREATE INDEX "EvidenceArtifact_releaseCandidateId_batchId_sourceId_idx" ON "EvidenceArtifact"("releaseCandidateId", "batchId", "sourceId");
CREATE INDEX "EvidenceArtifact_sourceId_capturedAt_idx" ON "EvidenceArtifact"("sourceId", "capturedAt");
CREATE INDEX "EvidenceArtifact_sourceResultId_channelId_idx" ON "EvidenceArtifact"("sourceResultId", "channelId");
CREATE INDEX "PaginationEvidence_releaseCandidateId_batchId_sourceId_idx" ON "PaginationEvidence"("releaseCandidateId", "batchId", "sourceId");
CREATE UNIQUE INDEX "PaginationEvidence_sourceResultId_sequence_key" ON "PaginationEvidence"("sourceResultId", "sequence");
CREATE INDEX "PaginationEvidence_sourceResultId_channelId_requestedPage_idx" ON "PaginationEvidence"("sourceResultId", "channelId", "requestedPage");
CREATE INDEX "PaginationEvidence_artifactId_idx" ON "PaginationEvidence"("artifactId");
CREATE INDEX "LossLedgerEntry_releaseCandidateId_batchId_sourceId_idx" ON "LossLedgerEntry"("releaseCandidateId", "batchId", "sourceId");
CREATE INDEX "LossLedgerEntry_sourceResultId_stage_idx" ON "LossLedgerEntry"("sourceResultId", "stage");
CREATE INDEX "LossLedgerEntry_candidateKey_idx" ON "LossLedgerEntry"("candidateKey");
CREATE INDEX "LossLedgerEntry_winnerKey_idx" ON "LossLedgerEntry"("winnerKey");

-- AddForeignKey
ALTER TABLE "CrawlBatch" ADD CONSTRAINT "CrawlBatch_releaseCandidateId_fkey" FOREIGN KEY ("releaseCandidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlBatchSourceResult" ADD CONSTRAINT "CrawlBatchSourceResult_releaseCandidateId_fkey" FOREIGN KEY ("releaseCandidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlBatchSourceResult" ADD CONSTRAINT "CrawlBatchSourceResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrawlBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlBatchSourceResult" ADD CONSTRAINT "CrawlBatchSourceResult_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlBatchSourceResult" ADD CONSTRAINT "CrawlBatchSourceResult_batch_rc_tuple_fkey" FOREIGN KEY ("batchId", "releaseCandidateId") REFERENCES "CrawlBatch"("id", "releaseCandidateId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrawlBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_releaseCandidateId_fkey" FOREIGN KEY ("releaseCandidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_officialEvidenceArtifactId_fkey" FOREIGN KEY ("officialEvidenceArtifactId") REFERENCES "EvidenceArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_sourceResultId_fkey" FOREIGN KEY ("sourceResultId") REFERENCES "CrawlBatchSourceResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_source_result_tuple_fkey" FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId") REFERENCES "CrawlBatchSourceResult"("id", "releaseCandidateId", "batchId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_batch_rc_tuple_fkey" FOREIGN KEY ("batchId", "releaseCandidateId") REFERENCES "CrawlBatch"("id", "releaseCandidateId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_official_artifact_tuple_fkey" FOREIGN KEY ("officialEvidenceArtifactId", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") REFERENCES "EvidenceArtifact"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_releaseCandidateId_fkey" FOREIGN KEY ("releaseCandidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrawlBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_sourceResultId_fkey" FOREIGN KEY ("sourceResultId") REFERENCES "CrawlBatchSourceResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_source_result_tuple_fkey" FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId") REFERENCES "CrawlBatchSourceResult"("id", "releaseCandidateId", "batchId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceArtifact" ADD CONSTRAINT "EvidenceArtifact_batch_rc_tuple_fkey" FOREIGN KEY ("batchId", "releaseCandidateId") REFERENCES "CrawlBatch"("id", "releaseCandidateId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_releaseCandidateId_fkey" FOREIGN KEY ("releaseCandidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrawlBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_sourceResultId_fkey" FOREIGN KEY ("sourceResultId") REFERENCES "CrawlBatchSourceResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "EvidenceArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_source_result_tuple_fkey" FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId") REFERENCES "CrawlBatchSourceResult"("id", "releaseCandidateId", "batchId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_batch_rc_tuple_fkey" FOREIGN KEY ("batchId", "releaseCandidateId") REFERENCES "CrawlBatch"("id", "releaseCandidateId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaginationEvidence" ADD CONSTRAINT "PaginationEvidence_artifact_tuple_fkey" FOREIGN KEY ("artifactId", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") REFERENCES "EvidenceArtifact"("id", "releaseCandidateId", "batchId", "sourceId", "sourceResultId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossLedgerEntry" ADD CONSTRAINT "LossLedgerEntry_releaseCandidateId_fkey" FOREIGN KEY ("releaseCandidateId") REFERENCES "ReleaseCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossLedgerEntry" ADD CONSTRAINT "LossLedgerEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrawlBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossLedgerEntry" ADD CONSTRAINT "LossLedgerEntry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossLedgerEntry" ADD CONSTRAINT "LossLedgerEntry_sourceResultId_fkey" FOREIGN KEY ("sourceResultId") REFERENCES "CrawlBatchSourceResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossLedgerEntry" ADD CONSTRAINT "LossLedgerEntry_source_result_tuple_fkey" FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId") REFERENCES "CrawlBatchSourceResult"("id", "releaseCandidateId", "batchId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LossLedgerEntry" ADD CONSTRAINT "LossLedgerEntry_batch_rc_tuple_fkey" FOREIGN KEY ("batchId", "releaseCandidateId") REFERENCES "CrawlBatch"("id", "releaseCandidateId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable identity/evidence enforcement. Batch and source-result tables remain mutable for controlled state transitions.
CREATE FUNCTION "prevent_release_candidate_identity_mutation"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."goalId" IS DISTINCT FROM NEW."goalId" OR
       OLD."version" IS DISTINCT FROM NEW."version" OR
       OLD."commitSha" IS DISTINCT FROM NEW."commitSha" OR
       OLD."dbSnapshotHash" IS DISTINCT FROM NEW."dbSnapshotHash" OR
       OLD."schemaHash" IS DISTINCT FROM NEW."schemaHash" OR
       OLD."migrationVersion" IS DISTINCT FROM NEW."migrationVersion" OR
       OLD."rosterHash" IS DISTINCT FROM NEW."rosterHash" OR
       OLD."sourcePlanHash" IS DISTINCT FROM NEW."sourcePlanHash" OR
       OLD."sourceConfigHash" IS DISTINCT FROM NEW."sourceConfigHash" OR
       OLD."adapterBundleHash" IS DISTINCT FROM NEW."adapterBundleHash" OR
       OLD."oracleVersion" IS DISTINCT FROM NEW."oracleVersion" THEN
        RAISE EXCEPTION 'ReleaseCandidate identity fields are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReleaseCandidate_identity_immutable"
BEFORE UPDATE ON "ReleaseCandidate"
FOR EACH ROW EXECUTE FUNCTION "prevent_release_candidate_identity_mutation"();

CREATE FUNCTION "prevent_release_candidate_delete"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ReleaseCandidate rows must be invalidated, not deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReleaseCandidate_delete_guard"
BEFORE DELETE ON "ReleaseCandidate"
FOR EACH ROW EXECUTE FUNCTION "prevent_release_candidate_delete"();

CREATE FUNCTION "prevent_immutable_evidence_mutation"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EvidenceArtifact_append_only"
BEFORE UPDATE OR DELETE ON "EvidenceArtifact"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_evidence_mutation"();

CREATE TRIGGER "PaginationEvidence_append_only"
BEFORE UPDATE OR DELETE ON "PaginationEvidence"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_evidence_mutation"();

CREATE TRIGGER "LossLedgerEntry_append_only"
BEFORE UPDATE OR DELETE ON "LossLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_immutable_evidence_mutation"();

CREATE FUNCTION "prevent_rc_observation_mutation"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."releaseCandidateId" IS NOT NULL THEN
            RAISE EXCEPTION 'RC-bound CrawlObservation rows are immutable';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD."releaseCandidateId" IS NOT NULL OR NEW."releaseCandidateId" IS NOT NULL THEN
        RAISE EXCEPTION 'RC-bound CrawlObservation rows are insert-only';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrawlObservation_rc_immutable"
BEFORE UPDATE OR DELETE ON "CrawlObservation"
FOR EACH ROW EXECUTE FUNCTION "prevent_rc_observation_mutation"();

CREATE FUNCTION "prevent_committed_source_result_mutation"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."atomicCommitState" = 'COMMITTED' THEN
        RAISE EXCEPTION 'Committed CrawlBatchSourceResult rows are immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CrawlBatchSourceResult_committed_immutable"
BEFORE UPDATE OR DELETE ON "CrawlBatchSourceResult"
FOR EACH ROW EXECUTE FUNCTION "prevent_committed_source_result_mutation"();
