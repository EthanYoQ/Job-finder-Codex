CREATE TYPE "LifecycleSetKind" AS ENUM ('CURRENT', 'GRACE', 'VISIBLE');

CREATE TABLE "LifecycleSetEvidenceMember" (
  "id" TEXT NOT NULL,
  "releaseCandidateId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceResultId" TEXT NOT NULL,
  "setKind" "LifecycleSetKind" NOT NULL,
  "jobKey" TEXT NOT NULL,
  "jobKeySha256" TEXT NOT NULL,
  "lifecycleStatus" "JobLifecycleStatus" NOT NULL,
  "missingCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LifecycleSetEvidenceMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LifecycleSetEvidenceMember_job_key_nonblank" CHECK (btrim("jobKey") <> ''),
  CONSTRAINT "LifecycleSetEvidenceMember_job_key_sha256" CHECK ("jobKeySha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LifecycleSetEvidenceMember_projection" CHECK (
    ("setKind" = 'CURRENT' AND "lifecycleStatus" = 'ACTIVE' AND "missingCount" = 0) OR
    ("setKind" = 'GRACE' AND "lifecycleStatus" = 'ACTIVE' AND "missingCount" = 1) OR
    ("setKind" = 'VISIBLE' AND "lifecycleStatus" = 'ACTIVE' AND "missingCount" IN (0, 1))
  )
);

CREATE UNIQUE INDEX "LifecycleSetEvidenceMember_tuple_kind_jobKey_key" ON "LifecycleSetEvidenceMember"("releaseCandidateId", "batchId", "sourceId", "sourceResultId", "setKind", "jobKey");
CREATE INDEX "LifecycleSetEvidenceMember_sourceResultId_setKind_idx" ON "LifecycleSetEvidenceMember"("sourceResultId", "setKind");
CREATE INDEX "LifecycleSetEvidenceMember_jobKeySha256_idx" ON "LifecycleSetEvidenceMember"("jobKeySha256");
ALTER TABLE "LifecycleSetEvidenceMember" ADD CONSTRAINT "LifecycleSetEvidenceMember_sourceResultId_releaseCandidateId_batchId_sourceId_fkey" FOREIGN KEY ("sourceResultId", "releaseCandidateId", "batchId", "sourceId") REFERENCES "CrawlBatchSourceResult"("id", "releaseCandidateId", "batchId", "sourceId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_lifecycle_set_member_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LifecycleSetEvidenceMember is append-only'; END $$;
CREATE TRIGGER "LifecycleSetEvidenceMember_no_update_delete" BEFORE UPDATE OR DELETE ON "LifecycleSetEvidenceMember" FOR EACH ROW EXECUTE FUNCTION reject_lifecycle_set_member_mutation();

CREATE FUNCTION validate_lifecycle_set_member_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kinds "LifecycleSetKind"[]; s "JobLifecycleStatus"; c INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CrawlBatchSourceResult" r WHERE r."id"=NEW."sourceResultId" AND r."releaseCandidateId"=NEW."releaseCandidateId" AND r."batchId"=NEW."batchId" AND r."sourceId"=NEW."sourceId" AND r."atomicCommitState"='COMMITTED') THEN
    RAISE EXCEPTION 'lifecycle set members require a committed source result';
  END IF;
  SELECT array_agg("setKind" ORDER BY "setKind"), min("lifecycleStatus"::text)::"JobLifecycleStatus", min("missingCount")
    INTO kinds,s,c FROM "LifecycleSetEvidenceMember"
    WHERE "releaseCandidateId"=NEW."releaseCandidateId" AND "batchId"=NEW."batchId" AND "sourceId"=NEW."sourceId" AND "sourceResultId"=NEW."sourceResultId" AND "jobKey"=NEW."jobKey";
  IF (s='ACTIVE' AND c=0 AND kinds=ARRAY['CURRENT','VISIBLE']::"LifecycleSetKind"[])
     OR (s='ACTIVE' AND c=1 AND kinds=ARRAY['GRACE','VISIBLE']::"LifecycleSetKind"[]) THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'invalid lifecycle set member cross-set projection';
END $$;
CREATE CONSTRAINT TRIGGER "LifecycleSetEvidenceMember_exact_projection" AFTER INSERT ON "LifecycleSetEvidenceMember" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_lifecycle_set_member_projection();
