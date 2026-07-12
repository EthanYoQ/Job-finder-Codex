CREATE OR REPLACE FUNCTION public.assert_verified_parent_lifecycle_projection(
  p_rc TEXT, p_batch TEXT, p_source TEXT, p_result TEXT
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE
  current_hash TEXT;
  grace_hash TEXT;
  visible_hash TEXT;
  parent_current TEXT;
  parent_grace TEXT;
  parent_visible TEXT;
  parent_output TEXT;
  parent_atomic public."AtomicCommitState";
  parent_completeness public."CompletenessStatus";
  parent_kind public."CrawlBatchKind";
  empty_set_hash CONSTANT TEXT := '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';
BEGIN
  SELECT r."atomicCommitState", r."completenessState", r."canonicalCurrentJobSetSha256",
         r."canonicalGraceJobSetSha256", r."canonicalVisibleJobSetSha256",
         r."canonicalOutputSetSha256", b."kind"
  INTO parent_atomic, parent_completeness, parent_current, parent_grace, parent_visible,
       parent_output, parent_kind
  FROM public."CrawlBatchSourceResult" r
  JOIN public."CrawlBatch" b ON b."id" = r."batchId"
  WHERE r.id = p_result AND r."releaseCandidateId" = p_rc AND r."batchId" = p_batch
    AND r."sourceId" = p_source;

  IF NOT FOUND OR parent_atomic <> 'COMMITTED' OR parent_completeness <> 'VERIFIED' THEN
    RETURN;
  END IF;

  IF parent_kind = 'MANUAL_SOURCE' THEN
    IF parent_current IS NULL OR parent_grace IS NULL OR parent_visible IS NULL OR parent_output IS NULL
       OR parent_output IS DISTINCT FROM parent_current
       OR parent_grace IS DISTINCT FROM empty_set_hash
       OR parent_visible IS DISTINCT FROM empty_set_hash THEN
      RAISE EXCEPTION 'verified manual preview lifecycle isolation mismatch';
    END IF;
    RETURN;
  END IF;

  SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to('[' ||
    coalesce(pg_catalog.string_agg(pg_catalog.to_json(m."jobKey")::text, ','
      ORDER BY pg_catalog.convert_to(m."jobKey", 'UTF8')), '') || ']', 'UTF8'), 'sha256'), 'hex')
  INTO current_hash
  FROM public."LifecycleSetEvidenceMember" m
  WHERE m."sourceResultId" = p_result AND m."releaseCandidateId" = p_rc
    AND m."batchId" = p_batch AND m."sourceId" = p_source AND m."setKind" = 'CURRENT';

  SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to('[' ||
    coalesce(pg_catalog.string_agg(pg_catalog.to_json(m."jobKey")::text, ','
      ORDER BY pg_catalog.convert_to(m."jobKey", 'UTF8')), '') || ']', 'UTF8'), 'sha256'), 'hex')
  INTO grace_hash
  FROM public."LifecycleSetEvidenceMember" m
  WHERE m."sourceResultId" = p_result AND m."releaseCandidateId" = p_rc
    AND m."batchId" = p_batch AND m."sourceId" = p_source AND m."setKind" = 'GRACE';

  SELECT pg_catalog.encode(extensions.digest(pg_catalog.convert_to('[' ||
    coalesce(pg_catalog.string_agg(pg_catalog.to_json(m."jobKey")::text, ','
      ORDER BY pg_catalog.convert_to(m."jobKey", 'UTF8')), '') || ']', 'UTF8'), 'sha256'), 'hex')
  INTO visible_hash
  FROM public."LifecycleSetEvidenceMember" m
  WHERE m."sourceResultId" = p_result AND m."releaseCandidateId" = p_rc
    AND m."batchId" = p_batch AND m."sourceId" = p_source AND m."setKind" = 'VISIBLE';

  IF parent_current IS NULL OR parent_grace IS NULL OR parent_visible IS NULL OR parent_output IS NULL
     OR parent_output IS DISTINCT FROM parent_current
     OR current_hash IS DISTINCT FROM parent_current
     OR grace_hash IS DISTINCT FROM parent_grace
     OR visible_hash IS DISTINCT FROM parent_visible THEN
    RAISE EXCEPTION 'verified committed parent lifecycle projection mismatch';
  END IF;
END $$;

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
  PERFORM public.assert_verified_parent_lifecycle_projection(
    NEW."releaseCandidateId", NEW."batchId", NEW."sourceId", NEW."sourceResultId"
  );
  RETURN NULL;
END $$;

ALTER FUNCTION public.assert_verified_parent_lifecycle_projection(TEXT,TEXT,TEXT,TEXT) OWNER TO CURRENT_USER;
ALTER FUNCTION public.validate_lifecycle_set_member_projection() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION public.assert_verified_parent_lifecycle_projection(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_lifecycle_set_member_projection() FROM PUBLIC;
