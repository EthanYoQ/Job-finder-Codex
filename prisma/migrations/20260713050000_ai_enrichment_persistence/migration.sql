CREATE TYPE "AiEnrichmentStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "AiEnrichmentAttemptOutcome" AS ENUM ('RUNNING', 'SUCCEEDED', 'RETRY_QUEUED', 'FAILED', 'STALE_REJECTED');

ALTER TABLE "Job"
  ADD COLUMN "classificationHardRuleHits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "classificationProvider" TEXT,
  ADD COLUMN "classificationPromptVersion" TEXT,
  ADD COLUMN "classificationInputHash" TEXT,
  ADD COLUMN "aiReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "humanCorrectedTitle" TEXT,
  ADD COLUMN "humanTitleCorrectionReason" TEXT,
  ADD COLUMN "humanTitleCorrectedAt" TIMESTAMP(3);

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_classificationInputHash_sha256" CHECK ("classificationInputHash" IS NULL OR "classificationInputHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "Job_human_title_correction_check" CHECK (
    ("humanCorrectedTitle" IS NULL AND "humanTitleCorrectionReason" IS NULL AND "humanTitleCorrectedAt" IS NULL)
    OR ("humanCorrectedTitle" IS NOT NULL AND btrim("humanCorrectedTitle") <> '' AND
        "humanTitleCorrectionReason" IS NOT NULL AND btrim("humanTitleCorrectionReason") <> '' AND
        "humanTitleCorrectedAt" IS NOT NULL)
  );

CREATE TABLE "AiEnrichmentRequest" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "officialTitleSnapshot" TEXT NOT NULL,
  "normalizedOfficialTitle" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "targetLanguage" TEXT NOT NULL,
  "status" "AiEnrichmentStatus" NOT NULL DEFAULT 'QUEUED',
  "ownerId" TEXT,
  "heartbeatAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AiEnrichmentRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiEnrichmentRequest_inputHash_sha256" CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AiEnrichmentRequest_retry_check" CHECK ("attemptCount" >= 0 AND "attemptCount" <= "maxAttempts" AND "maxAttempts" BETWEEN 1 AND 10),
  CONSTRAINT "AiEnrichmentRequest_owner_lease_check" CHECK (
    ("status" = 'RUNNING' AND "ownerId" IS NOT NULL AND btrim("ownerId") <> '' AND "heartbeatAt" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "ownerId" IS NULL AND "leaseExpiresAt" IS NULL)
  )
);

CREATE TABLE "AiEnrichmentAttempt" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "inputHash" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "outcome" "AiEnrichmentAttemptOutcome" NOT NULL,
  "failureCode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AiEnrichmentAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiEnrichmentAttempt_inputHash_sha256" CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AiEnrichmentAttempt_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "AiEnrichmentAttempt_outcome_check" CHECK (
    ("outcome" = 'RUNNING' AND "finishedAt" IS NULL AND "failureCode" IS NULL)
    OR ("outcome" = 'SUCCEEDED' AND "finishedAt" IS NOT NULL AND "failureCode" IS NULL)
    OR ("outcome" IN ('RETRY_QUEUED', 'FAILED', 'STALE_REJECTED') AND "finishedAt" IS NOT NULL AND "failureCode" IS NOT NULL)
  )
);

CREATE TABLE "AiTranslationCache" (
  "cacheKey" TEXT NOT NULL,
  "normalizedOfficialTitle" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "targetLanguage" TEXT NOT NULL,
  "auxiliaryChineseTitle" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiTranslationCache_pkey" PRIMARY KEY ("cacheKey"),
  CONSTRAINT "AiTranslationCache_cacheKey_sha256" CHECK ("cacheKey" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "AiEnrichmentResult" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "primaryCategory" "JobCategory" NOT NULL,
  "secondaryCategory" "JobCategory",
  "confidence" DOUBLE PRECISION NOT NULL,
  "safeRationale" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "hardRuleHits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "officialTitleSnapshot" TEXT NOT NULL,
  "auxiliaryChineseTitle" TEXT,
  "translationCacheKey" TEXT,
  "requiresReview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiEnrichmentResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiEnrichmentResult_inputHash_sha256" CHECK ("inputHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AiEnrichmentResult_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "AiEnrichmentResult_rationale_check" CHECK (btrim("safeRationale") <> '' AND length("safeRationale") <= 2000),
  CONSTRAINT "AiEnrichmentResult_low_confidence_review_check" CHECK (
    "confidence" >= 0.75 OR ("primaryCategory" = '其他' AND "secondaryCategory" IS NULL AND "requiresReview")
  )
);

CREATE UNIQUE INDEX "AiEnrichmentRequest_jobId_inputHash_key" ON "AiEnrichmentRequest"("jobId", "inputHash");
CREATE UNIQUE INDEX "AiEnrichmentRequest_id_inputHash_key" ON "AiEnrichmentRequest"("id", "inputHash");
CREATE UNIQUE INDEX "AiEnrichmentRequest_id_inputHash_jobId_key" ON "AiEnrichmentRequest"("id", "inputHash", "jobId");
CREATE INDEX "AiEnrichmentRequest_status_createdAt_idx" ON "AiEnrichmentRequest"("status", "createdAt");
CREATE INDEX "AiEnrichmentRequest_ownerId_leaseExpiresAt_idx" ON "AiEnrichmentRequest"("ownerId", "leaseExpiresAt");
CREATE UNIQUE INDEX "AiEnrichmentAttempt_requestId_sequence_key" ON "AiEnrichmentAttempt"("requestId", "sequence");
CREATE INDEX "AiEnrichmentAttempt_requestId_startedAt_idx" ON "AiEnrichmentAttempt"("requestId", "startedAt");
CREATE UNIQUE INDEX "AiTranslationCache_identity_key" ON "AiTranslationCache"("normalizedOfficialTitle", "provider", "modelVersion", "promptVersion", "targetLanguage");
CREATE UNIQUE INDEX "AiEnrichmentResult_requestId_key" ON "AiEnrichmentResult"("requestId");
CREATE UNIQUE INDEX "AiEnrichmentResult_requestId_inputHash_key" ON "AiEnrichmentResult"("requestId", "inputHash");
CREATE UNIQUE INDEX "AiEnrichmentResult_requestId_inputHash_jobId_key" ON "AiEnrichmentResult"("requestId", "inputHash", "jobId");
CREATE INDEX "AiEnrichmentResult_jobId_createdAt_idx" ON "AiEnrichmentResult"("jobId", "createdAt");
CREATE INDEX "AiEnrichmentResult_requiresReview_createdAt_idx" ON "AiEnrichmentResult"("requiresReview", "createdAt");

ALTER TABLE "AiEnrichmentRequest" ADD CONSTRAINT "AiEnrichmentRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiEnrichmentAttempt" ADD CONSTRAINT "AiEnrichmentAttempt_request_input_tuple_fkey" FOREIGN KEY ("requestId", "inputHash") REFERENCES "AiEnrichmentRequest"("id", "inputHash") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiEnrichmentResult" ADD CONSTRAINT "AiEnrichmentResult_request_input_job_tuple_fkey" FOREIGN KEY ("requestId", "inputHash", "jobId") REFERENCES "AiEnrichmentRequest"("id", "inputHash", "jobId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiEnrichmentResult" ADD CONSTRAINT "AiEnrichmentResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiEnrichmentResult" ADD CONSTRAINT "AiEnrichmentResult_translationCacheKey_fkey" FOREIGN KEY ("translationCacheKey") REFERENCES "AiTranslationCache"("cacheKey") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_ai_enrichment_immutable_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AI enrichment evidence rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiEnrichmentResult_immutable" BEFORE UPDATE OR DELETE ON "AiEnrichmentResult" FOR EACH ROW EXECUTE FUNCTION prevent_ai_enrichment_immutable_mutation();
CREATE TRIGGER "AiTranslationCache_immutable" BEFORE UPDATE OR DELETE ON "AiTranslationCache" FOR EACH ROW EXECUTE FUNCTION prevent_ai_enrichment_immutable_mutation();

CREATE FUNCTION enforce_ai_enrichment_attempt_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AI enrichment attempts cannot be deleted'; END IF;
  IF OLD."requestId" <> NEW."requestId" OR OLD."sequence" <> NEW."sequence" OR
     OLD."inputHash" <> NEW."inputHash" OR OLD."ownerId" <> NEW."ownerId" OR
     OLD."startedAt" <> NEW."startedAt" OR OLD."outcome" <> 'RUNNING' OR
     NEW."outcome" = 'RUNNING' THEN
    RAISE EXCEPTION 'invalid AI enrichment attempt transition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiEnrichmentAttempt_transition" BEFORE UPDATE OR DELETE ON "AiEnrichmentAttempt" FOR EACH ROW EXECUTE FUNCTION enforce_ai_enrichment_attempt_transition();
