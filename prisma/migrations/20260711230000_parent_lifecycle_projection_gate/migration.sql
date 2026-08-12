CREATE FUNCTION assert_verified_parent_lifecycle_projection(p_rc TEXT,p_batch TEXT,p_source TEXT,p_result TEXT) RETURNS void LANGUAGE plpgsql AS $$
DECLARE current_hash TEXT;grace_hash TEXT;visible_hash TEXT;parent_current TEXT;parent_grace TEXT;parent_visible TEXT;parent_output TEXT;parent_atomic "AtomicCommitState";parent_completeness "CompletenessStatus";
BEGIN
  SELECT "atomicCommitState","completenessState","canonicalCurrentJobSetSha256","canonicalGraceJobSetSha256","canonicalVisibleJobSetSha256","canonicalOutputSetSha256"
    INTO parent_atomic,parent_completeness,parent_current,parent_grace,parent_visible,parent_output FROM "CrawlBatchSourceResult"
    WHERE id=p_result AND "releaseCandidateId"=p_rc AND "batchId"=p_batch AND "sourceId"=p_source;
  IF NOT FOUND OR parent_atomic<>'COMMITTED' OR parent_completeness<>'VERIFIED' THEN RETURN; END IF;
  SELECT encode(digest(convert_to('['||coalesce(string_agg(to_json("jobKey")::text,',' ORDER BY convert_to("jobKey",'UTF8')),'')||']','UTF8'),'sha256'),'hex') INTO current_hash FROM "LifecycleSetEvidenceMember" WHERE "sourceResultId"=p_result AND "releaseCandidateId"=p_rc AND "batchId"=p_batch AND "sourceId"=p_source AND "setKind"='CURRENT';
  SELECT encode(digest(convert_to('['||coalesce(string_agg(to_json("jobKey")::text,',' ORDER BY convert_to("jobKey",'UTF8')),'')||']','UTF8'),'sha256'),'hex') INTO grace_hash FROM "LifecycleSetEvidenceMember" WHERE "sourceResultId"=p_result AND "releaseCandidateId"=p_rc AND "batchId"=p_batch AND "sourceId"=p_source AND "setKind"='GRACE';
  SELECT encode(digest(convert_to('['||coalesce(string_agg(to_json("jobKey")::text,',' ORDER BY convert_to("jobKey",'UTF8')),'')||']','UTF8'),'sha256'),'hex') INTO visible_hash FROM "LifecycleSetEvidenceMember" WHERE "sourceResultId"=p_result AND "releaseCandidateId"=p_rc AND "batchId"=p_batch AND "sourceId"=p_source AND "setKind"='VISIBLE';
  IF parent_current IS NULL OR parent_grace IS NULL OR parent_visible IS NULL OR parent_output IS NULL OR parent_output IS DISTINCT FROM parent_current OR current_hash IS DISTINCT FROM parent_current OR grace_hash IS DISTINCT FROM parent_grace OR visible_hash IS DISTINCT FROM parent_visible THEN
    RAISE EXCEPTION 'verified committed parent lifecycle projection mismatch';
  END IF;
END $$;

CREATE FUNCTION validate_verified_parent_lifecycle_projection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM assert_verified_parent_lifecycle_projection(NEW."releaseCandidateId",NEW."batchId",NEW."sourceId",NEW.id);RETURN NULL;END $$;

CREATE CONSTRAINT TRIGGER "CrawlBatchSourceResult_verified_lifecycle_projection"
AFTER INSERT OR UPDATE
ON "CrawlBatchSourceResult" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_verified_parent_lifecycle_projection();
