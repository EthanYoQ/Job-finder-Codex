CREATE OR REPLACE FUNCTION public.validate_lifecycle_set_member_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE
  kinds public."LifecycleSetKind"[];
  s public."JobLifecycleStatus";
  c INTEGER;
  parent_atomic public."AtomicCommitState";
  parent_completeness public."CompletenessStatus";
  parent_kind public."CrawlBatchKind";
BEGIN
  SELECT r."atomicCommitState", r."completenessState", b."kind"
  INTO parent_atomic, parent_completeness, parent_kind
  FROM public."CrawlBatchSourceResult" r
  JOIN public."CrawlBatch" b ON b."id" = r."batchId"
  WHERE r.id = NEW."sourceResultId" AND r."releaseCandidateId" = NEW."releaseCandidateId"
    AND r."batchId" = NEW."batchId" AND r."sourceId" = NEW."sourceId";

  IF NOT FOUND OR parent_atomic <> 'COMMITTED' OR parent_completeness <> 'VERIFIED' THEN
    RAISE EXCEPTION 'lifecycle set members require a verified committed source result';
  END IF;
  IF parent_kind = 'MANUAL_SOURCE' THEN
    RAISE EXCEPTION 'manual source preview forbids lifecycle set members';
  END IF;

  SELECT pg_catalog.array_agg(m."setKind" ORDER BY m."setKind"),
         pg_catalog.min(m."lifecycleStatus"::text)::public."JobLifecycleStatus",
         pg_catalog.min(m."missingCount")
  INTO kinds, s, c
  FROM public."LifecycleSetEvidenceMember" m
  WHERE m."releaseCandidateId" = NEW."releaseCandidateId" AND m."batchId" = NEW."batchId"
    AND m."sourceId" = NEW."sourceId" AND m."sourceResultId" = NEW."sourceResultId"
    AND m."jobKey" = NEW."jobKey";

  IF NOT ((s = 'ACTIVE' AND c = 0 AND kinds = ARRAY['CURRENT','VISIBLE']::public."LifecycleSetKind"[])
      OR (s = 'ACTIVE' AND c = 1 AND kinds = ARRAY['GRACE','VISIBLE']::public."LifecycleSetKind"[])) THEN
    RAISE EXCEPTION 'invalid lifecycle set member cross-set projection';
  END IF;
  RETURN NULL;
END $$;

ALTER FUNCTION public.validate_lifecycle_set_member_projection() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.validate_lifecycle_set_member_projection() FROM PUBLIC;
