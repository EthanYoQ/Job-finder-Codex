CREATE FUNCTION public.guard_v75_retired_source_publication() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $v75_guard$
DECLARE candidate_status public."ReleaseCandidateStatus";
BEGIN
  IF NEW."releaseCandidateId" IS DISTINCT FROM 'dot-cloud-native-d02f4f5-20261011' THEN
    RETURN NEW;
  END IF;
  -- Guard all new source-result rows, including direct COMMITTED insertion.
  -- Failure finalization remains governed by the unchanged existing state machine.
  IF TG_OP = 'UPDATE' AND NEW."atomicCommitState"::text <> 'COMMITTED' THEN
    RETURN NEW;
  END IF;
  SELECT c.status INTO candidate_status
    FROM public."ReleaseCandidate" c
    WHERE c.id = NEW."releaseCandidateId"
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V75_FENCE_CANDIDATE_MISSING'; END IF;
  IF candidate_status::text = 'INVALIDATED' THEN
    RAISE EXCEPTION 'V75_FENCE_CANDIDATE_RETIRED';
  END IF;
  RETURN NEW;
END;
$v75_guard$;

CREATE TRIGGER "CrawlBatchSourceResult_v75_retired_candidate_guard"
BEFORE INSERT OR UPDATE ON public."CrawlBatchSourceResult"
FOR EACH ROW EXECUTE FUNCTION public.guard_v75_retired_source_publication();
