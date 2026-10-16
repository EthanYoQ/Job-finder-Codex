CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "LifecycleSetEvidenceMember" ADD CONSTRAINT "LifecycleSetEvidenceMember_jobKey_digest_exact"
CHECK ("jobKeySha256" = encode(digest(convert_to("jobKey", 'UTF8'), 'sha256'), 'hex'));

CREATE OR REPLACE FUNCTION validate_lifecycle_set_member_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kinds "LifecycleSetKind"[]; s "JobLifecycleStatus"; c INTEGER;
  current_hash TEXT; grace_hash TEXT; visible_hash TEXT;
  parent_current TEXT; parent_grace TEXT; parent_visible TEXT; parent_output TEXT;
BEGIN
  SELECT array_agg("setKind" ORDER BY "setKind"), min("lifecycleStatus"::text)::"JobLifecycleStatus", min("missingCount")
    INTO kinds,s,c FROM "LifecycleSetEvidenceMember"
    WHERE "releaseCandidateId"=NEW."releaseCandidateId" AND "batchId"=NEW."batchId" AND "sourceId"=NEW."sourceId" AND "sourceResultId"=NEW."sourceResultId" AND "jobKey"=NEW."jobKey";
  IF NOT ((s='ACTIVE' AND c=0 AND kinds=ARRAY['CURRENT','VISIBLE']::"LifecycleSetKind"[])
     OR (s='ACTIVE' AND c=1 AND kinds=ARRAY['GRACE','VISIBLE']::"LifecycleSetKind"[])) THEN
    RAISE EXCEPTION 'invalid lifecycle set member cross-set projection';
  END IF;

  SELECT encode(digest(convert_to('[' || coalesce(string_agg(to_json("jobKey")::text, ',' ORDER BY convert_to("jobKey",'UTF8')), '') || ']', 'UTF8'),'sha256'),'hex')
    INTO current_hash FROM "LifecycleSetEvidenceMember" WHERE "sourceResultId"=NEW."sourceResultId" AND "releaseCandidateId"=NEW."releaseCandidateId" AND "batchId"=NEW."batchId" AND "sourceId"=NEW."sourceId" AND "setKind"='CURRENT';
  SELECT encode(digest(convert_to('[' || coalesce(string_agg(to_json("jobKey")::text, ',' ORDER BY convert_to("jobKey",'UTF8')), '') || ']', 'UTF8'),'sha256'),'hex')
    INTO grace_hash FROM "LifecycleSetEvidenceMember" WHERE "sourceResultId"=NEW."sourceResultId" AND "releaseCandidateId"=NEW."releaseCandidateId" AND "batchId"=NEW."batchId" AND "sourceId"=NEW."sourceId" AND "setKind"='GRACE';
  SELECT encode(digest(convert_to('[' || coalesce(string_agg(to_json("jobKey")::text, ',' ORDER BY convert_to("jobKey",'UTF8')), '') || ']', 'UTF8'),'sha256'),'hex')
    INTO visible_hash FROM "LifecycleSetEvidenceMember" WHERE "sourceResultId"=NEW."sourceResultId" AND "releaseCandidateId"=NEW."releaseCandidateId" AND "batchId"=NEW."batchId" AND "sourceId"=NEW."sourceId" AND "setKind"='VISIBLE';

  SELECT "canonicalCurrentJobSetSha256","canonicalGraceJobSetSha256","canonicalVisibleJobSetSha256","canonicalOutputSetSha256"
    INTO parent_current,parent_grace,parent_visible,parent_output FROM "CrawlBatchSourceResult"
    WHERE id=NEW."sourceResultId" AND "releaseCandidateId"=NEW."releaseCandidateId" AND "batchId"=NEW."batchId" AND "sourceId"=NEW."sourceId" AND "atomicCommitState"='COMMITTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'lifecycle set members require a committed source result'; END IF;
  IF parent_output IS DISTINCT FROM parent_current OR current_hash IS DISTINCT FROM parent_current OR grace_hash IS DISTINCT FROM parent_grace OR visible_hash IS DISTINCT FROM parent_visible THEN
    RAISE EXCEPTION 'lifecycle member sets do not match parent canonical commitments';
  END IF;
  RETURN NULL;
END $$;
