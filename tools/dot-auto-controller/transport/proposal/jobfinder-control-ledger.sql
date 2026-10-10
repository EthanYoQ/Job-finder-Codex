-- SOURCE PROPOSAL ONLY. NOT an installed or registered Prisma migration.
-- No database execution, role creation, grant, or credential action is authorized.
-- PostgreSQL 17 target; review/register the real migration and NEW native history
-- profile/candidate first. Applying outside Prisma would evade the native guard.
-- Installation requires a separately authorized provisioning principal. This
-- deliberately fails if the role/schema already exists; never silently adopt it.
BEGIN;
SET LOCAL lock_timeout = '1000ms';
SET LOCAL statement_timeout = '8000ms';
DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='dot_jobfinder_writer'
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname='dot_jobfinder_writer') THEN
    RAISE EXCEPTION 'LEDGER_RESTRICTED_WRITER_PREREQUISITE';
  END IF;
END;
$preflight$;
CREATE ROLE dot_jobfinder_ledger_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA jobfinder_control AUTHORIZATION dot_jobfinder_ledger_owner;
REVOKE ALL ON SCHEMA jobfinder_control FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA jobfinder_control TO dot_jobfinder_writer;
GRANT USAGE ON SCHEMA public, extensions TO dot_jobfinder_ledger_owner;
-- No native INSERT/UPDATE/DELETE/MAINTAIN is granted to the function owner.
GRANT SELECT ON public."CrawlBatchSourceResult", public."CrawlBatch",
  public."CrawlCoordinatorLock", public."LifecycleSetEvidenceMember"
  TO dot_jobfinder_ledger_owner;
GRANT EXECUTE ON FUNCTION extensions.digest(bytea,text) TO dot_jobfinder_ledger_owner;

CREATE TABLE jobfinder_control.dispatch_intent (
  request_id uuid PRIMARY KEY,
  project_id text NOT NULL CHECK (project_id='yiopvxysxrtrnvqxwgbx'),
  candidate_id text NOT NULL, source_id text NOT NULL, batch_id text NOT NULL,
  source_result_id text NOT NULL UNIQUE, holder_id uuid NOT NULL UNIQUE,
  request_sha256 text NOT NULL UNIQUE CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  sql_sha256 text NOT NULL UNIQUE CHECK (sql_sha256 ~ '^[a-f0-9]{64}$'),
  original jsonb NOT NULL,
  state text NOT NULL DEFAULT 'MAY_HAVE_BEEN_SENT'
    CHECK (state IN ('MAY_HAVE_BEEN_SENT','COMMITTED_EXACT')),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  UNIQUE (project_id,candidate_id,source_id,batch_id,source_result_id),
  UNIQUE (batch_id,source_id),
  CHECK (source_result_id=batch_id||'--'||source_id),
  CHECK ((state='MAY_HAVE_BEEN_SENT' AND resolved_at IS NULL)
      OR (state='COMMITTED_EXACT' AND resolved_at IS NOT NULL))
);
-- A second unknown across ANY source/candidate/project cannot create a new slot.
CREATE UNIQUE INDEX dispatch_intent_one_global_unresolved
  ON jobfinder_control.dispatch_intent ((true)) WHERE state='MAY_HAVE_BEEN_SENT';
ALTER TABLE jobfinder_control.dispatch_intent OWNER TO dot_jobfinder_ledger_owner;
ALTER TABLE jobfinder_control.dispatch_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobfinder_control.dispatch_intent FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_owner_only ON jobfinder_control.dispatch_intent
  TO dot_jobfinder_ledger_owner USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE jobfinder_control.dispatch_intent FROM PUBLIC, anon, authenticated, service_role, dot_jobfinder_writer;

CREATE FUNCTION jobfinder_control._protect_intent_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $body$
BEGIN
  IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'LEDGER_DELETE_FORBIDDEN'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','resolved_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','resolved_at'])
    OR OLD.state <> 'MAY_HAVE_BEEN_SENT' OR NEW.state <> 'COMMITTED_EXACT'
    OR OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'LEDGER_IMMUTABLE_INTENT';
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER dispatch_intent_immutable BEFORE UPDATE OR DELETE
  ON jobfinder_control.dispatch_intent FOR EACH ROW
  EXECUTE FUNCTION jobfinder_control._protect_intent_v1();

-- Input validator uses the actual native composite types. Missing optional
-- source fields become SQL NULL, matching the original exact-outcome helper.
-- Unknown keys and coercions (e.g. JSON string -> integer) are rejected.
CREATE FUNCTION jobfinder_control._assert_original_v1(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET TimeZone = 'UTC' AS $body$
DECLARE
  s public."CrawlBatchSourceResult"; b public."CrawlBatch"; k text;
  source_fields CONSTANT text[] := ARRAY['id','releaseCandidateId','batchId','sourceId','transportState','adapterState','completenessState','atomicCommitState','sourceConfigHash','adapterVersion','officialEntryId','officialSurfaceIds','officialChannelIds','startedAt','finishedAt','rawCount','parsedCount','validCount','normalizedCount','dedupeInputCount','dedupeOutputCount','parseDiscardCount','validationDiscardCount','normalizationDiscardCount','dedupeDiscardCount','collisionCount','discardCount','expectedJobCount','expectedEvidenceKind','expectedSurfaceSha256','visitedSurfaceSha256','expectedChannelSha256','visitedChannelSha256','canonicalCurrentJobSetSha256','canonicalGraceJobSetSha256','canonicalVisibleJobSetSha256','canonicalOutputSetSha256','adapterInputCount','adapterOutputCount','adapterLossCount','adapterCollisionGroupCount','adapterReconciliationSha256','collisionLedgerSha256','blockerCode','completenessCertificate','completenessCertificateSha256','baselinePreviousSourceResultId','baselinePreviousJobCount','baselineChangeReason','blockerReason','failureCategory','failureDiagnosticCode','fetchAttemptCount','retryCount','retryReasonCodes','failureCode','failureReason']::text[];
  batch_fields CONSTANT text[] := ARRAY['id','releaseCandidateId','commitSha','rosterSha256','sourcePlanSha256','sourceConfigSha256','adapterBundleSha256','kind','manualCrawlRequestId','plannedSourceIds','plannedSourceSetSha256','plannedSourceCount','ownerId','heartbeatAt','startedAt']::text[];
  original_fields CONSTANT text[] := ARRAY['schemaVersion','projectId','candidateId','sourceId','sourceConfigSha256','batchId','sourceResultId','requestId','requestSha256','sqlSha256','holderId','dispatchBefore','expiresAt','overallDeadline','expectedSourceResult','expectedBatch']::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p)<>'object' OR octet_length(p::text)>16777216 THEN
    RAISE EXCEPTION 'LEDGER_ORIGINAL_SHAPE';
  END IF;
  IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p) key)
     IS DISTINCT FROM (SELECT array_agg(key ORDER BY key) FROM unnest(original_fields) key)
    OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR p->>'projectId' IS DISTINCT FROM 'yiopvxysxrtrnvqxwgbx' THEN
    RAISE EXCEPTION 'LEDGER_ORIGINAL_KEYS';
  END IF;
  FOREACH k IN ARRAY ARRAY['candidateId','sourceId','batchId','sourceResultId'] LOOP
    IF jsonb_typeof(p->k)<>'string' OR p->>k !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$' THEN
      RAISE EXCEPTION 'LEDGER_ID_SHAPE'; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['requestId','holderId'] LOOP
    IF jsonb_typeof(p->k)<>'string' OR p->>k !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' THEN
      RAISE EXCEPTION 'LEDGER_UUID_SHAPE'; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['sourceConfigSha256','requestSha256','sqlSha256'] LOOP
    IF jsonb_typeof(p->k)<>'string' OR p->>k !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'LEDGER_SHA_SHAPE'; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['dispatchBefore','expiresAt','overallDeadline'] LOOP
    IF jsonb_typeof(p->k)<>'number' OR p->>k !~ '^[0-9]{1,16}$'
      OR (p->>k)::numeric>9007199254740991 THEN RAISE EXCEPTION 'LEDGER_DEADLINE_SHAPE'; END IF;
  END LOOP;
  IF (p->>'dispatchBefore')::bigint >= (p->>'expiresAt')::bigint
    OR (p->>'expiresAt')::bigint > (p->>'overallDeadline')::bigint
    OR p->>'sourceResultId' IS DISTINCT FROM (p->>'batchId')||'--'||(p->>'sourceId') THEN
    RAISE EXCEPTION 'LEDGER_BINDING';
  END IF;
  IF jsonb_typeof(p->'expectedSourceResult') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p->'expectedBatch') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'LEDGER_NATIVE_EXPECTATION';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p->'expectedSourceResult') key WHERE NOT key=ANY(source_fields))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p->'expectedBatch') key WHERE NOT key=ANY(batch_fields)) THEN
    RAISE EXCEPTION 'LEDGER_NATIVE_UNKNOWN_FIELD';
  END IF;
  s := jsonb_populate_record(NULL::public."CrawlBatchSourceResult",p->'expectedSourceResult');
  b := jsonb_populate_record(NULL::public."CrawlBatch",p->'expectedBatch');
  FOREACH k IN ARRAY ARRAY['rawCount','parsedCount','validCount','normalizedCount','dedupeInputCount','dedupeOutputCount','parseDiscardCount','validationDiscardCount','normalizationDiscardCount','dedupeDiscardCount','collisionCount','discardCount'] LOOP
    IF to_jsonb(s)->>k IS NULL OR (to_jsonb(s)->>k)::bigint<0 THEN RAISE EXCEPTION 'LEDGER_SOURCE_REQUIRED'; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['officialSurfaceIds','officialChannelIds','retryReasonCodes'] LOOP
    IF jsonb_typeof(p->'expectedSourceResult'->k) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'LEDGER_SOURCE_REQUIRED'; END IF;
  END LOOP;
  IF s."adapterVersion" IS NULL OR s."adapterVersion"='' THEN RAISE EXCEPTION 'LEDGER_SOURCE_REQUIRED'; END IF;
  FOREACH k IN ARRAY source_fields LOOP
    IF k IN ('startedAt','finishedAt') THEN
      IF p->'expectedSourceResult'->>k IS NULL OR
        p->'expectedSourceResult'->>k IS DISTINCT FROM to_char((to_jsonb(s)->>k)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
        RAISE EXCEPTION 'LEDGER_NATIVE_TIMESTAMP'; END IF;
    ELSIF coalesce(p->'expectedSourceResult'->k,'null'::jsonb) IS DISTINCT FROM to_jsonb(s)->k THEN
      RAISE EXCEPTION 'LEDGER_NATIVE_SOURCE_TYPE';
    END IF;
  END LOOP;
  FOREACH k IN ARRAY batch_fields LOOP
    IF k IN ('startedAt','heartbeatAt') THEN
      IF p->'expectedBatch'->>k IS NULL OR
        p->'expectedBatch'->>k IS DISTINCT FROM to_char((to_jsonb(b)->>k)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
        RAISE EXCEPTION 'LEDGER_NATIVE_TIMESTAMP'; END IF;
    ELSIF coalesce(p->'expectedBatch'->k,'null'::jsonb) IS DISTINCT FROM to_jsonb(b)->k THEN
      RAISE EXCEPTION 'LEDGER_NATIVE_BATCH_TYPE';
    END IF;
  END LOOP;
  IF s.id IS DISTINCT FROM p->>'sourceResultId' OR s."batchId" IS DISTINCT FROM p->>'batchId'
    OR s."releaseCandidateId" IS DISTINCT FROM p->>'candidateId' OR s."sourceId" IS DISTINCT FROM p->>'sourceId'
    OR s."sourceConfigHash" IS DISTINCT FROM p->>'sourceConfigSha256'
    OR s."transportState" IS DISTINCT FROM 'SUCCEEDED' OR s."adapterState" IS DISTINCT FROM 'SUCCEEDED'
    OR s."completenessState" IS DISTINCT FROM 'VERIFIED' OR s."atomicCommitState" IS DISTINCT FROM 'COMMITTED'
    OR s."failureCode" IS NOT NULL OR s."finishedAt" IS NULL OR s."startedAt" IS NULL
    OR s."finishedAt" < s."startedAt" OR s."finishedAt" > to_timestamp((p->>'expiresAt')::numeric/1000)::timestamp
    OR b.id IS DISTINCT FROM p->>'batchId' OR b."releaseCandidateId" IS DISTINCT FROM p->>'candidateId'
    OR b.kind IS DISTINCT FROM 'SCHEDULED' OR b."manualCrawlRequestId" IS NOT NULL
    OR b."plannedSourceIds" IS DISTINCT FROM jsonb_build_array(p->>'sourceId') OR b."plannedSourceCount" IS DISTINCT FROM 1
    OR b."startedAt" IS DISTINCT FROM s."startedAt" OR b."heartbeatAt" IS DISTINCT FROM b."startedAt"
    OR b."plannedSourceSetSha256" IS DISTINCT FROM encode(extensions.digest(convert_to('['||to_json(p->>'sourceId')::text||']','UTF8'),'sha256'),'hex')
    OR b."commitSha" IS NULL OR b."commitSha" !~ '^[a-f0-9]{40}$'
    OR b."ownerId" IS NULL OR b."ownerId"='' THEN RAISE EXCEPTION 'LEDGER_NATIVE_BINDING';
  END IF;
  FOREACH k IN ARRAY ARRAY['rosterSha256','sourcePlanSha256','sourceConfigSha256','adapterBundleSha256'] LOOP
    IF to_jsonb(b)->>k IS NULL OR to_jsonb(b)->>k !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'LEDGER_BATCH_SHA'; END IF;
  END LOOP;
END;
$body$;

CREATE FUNCTION jobfinder_control.claim_dispatch_v1(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC'
SET lock_timeout = '1000ms' AS $body$
DECLARE i jobfinder_control.dispatch_intent;
BEGIN
  IF session_user <> 'dot_jobfinder_writer' OR current_setting('transaction_isolation') <> 'read committed'
    OR current_setting('synchronous_commit') <> 'on' THEN
    RAISE EXCEPTION 'LEDGER_DIRECT_WRITER_READ_COMMITTED_REQUIRED'; END IF;
  PERFORM jobfinder_control._assert_original_v1(p);
  IF clock_timestamp() >= to_timestamp((p->>'dispatchBefore')::numeric/1000) THEN
    RAISE EXCEPTION 'LEDGER_CLAIM_EXPIRED'; END IF;
  IF EXISTS (SELECT 1 FROM public."CrawlBatch" WHERE id=p->>'batchId' OR status='RUNNING')
    OR EXISTS (SELECT 1 FROM public."CrawlBatchSourceResult" WHERE id=p->>'sourceResultId' OR "atomicCommitState"='PENDING')
    OR EXISTS (SELECT 1 FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl' AND "holderId"<>'') THEN
    RAISE EXCEPTION 'LEDGER_NATIVE_UNKNOWN_OR_HELD'; END IF;
  -- Plain INSERT, never ON CONFLICT/UPSERT. Lost claim ack cannot authorize a
  -- second publication. A repeated tuple/request or global unknown raises.
  INSERT INTO jobfinder_control.dispatch_intent
    (request_id,project_id,candidate_id,source_id,batch_id,source_result_id,holder_id,request_sha256,sql_sha256,original)
  VALUES ((p->>'requestId')::uuid,p->>'projectId',p->>'candidateId',p->>'sourceId',p->>'batchId',
    p->>'sourceResultId',(p->>'holderId')::uuid,p->>'requestSha256',p->>'sqlSha256',p)
  RETURNING * INTO i;
  -- Recheck after a possible uniqueness wait, using the unmodified deadline.
  IF clock_timestamp() >= to_timestamp((p->>'dispatchBefore')::numeric/1000) THEN
    RAISE EXCEPTION 'LEDGER_CLAIM_EXPIRED'; END IF;
  RETURN jsonb_build_object('state',i.state,'original',i.original,'claimedAt',i.claimed_at);
END;
$body$;

CREATE FUNCTION jobfinder_control.read_unresolved_v1(p_project text,p_source text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $body$
BEGIN
  IF session_user <> 'dot_jobfinder_writer' OR p_project IS DISTINCT FROM 'yiopvxysxrtrnvqxwgbx'
    OR p_source IS NULL OR p_source !~ '^source-[a-z0-9-]+$' THEN RAISE EXCEPTION 'LEDGER_READ_SCOPE'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'projectId',p_project,'sourceId',p_source,
    'ledgerVersion','dispatch-intent-v1','checkedAt',clock_timestamp(),'unresolved',
    coalesce((SELECT jsonb_agg(jsonb_build_object('state',i.state,'original',i.original,'claimedAt',i.claimed_at)
      ORDER BY i.claimed_at,i.request_id) FROM jobfinder_control.dispatch_intent i
      WHERE i.state='MAY_HAVE_BEEN_SENT'),'[]'::jsonb));
  -- Deliberately NO source predicate: another source's UNKNOWN blocks all.
END;
$body$;

CREATE FUNCTION jobfinder_control.read_dispatch_v1(p_project text,p_request uuid,p_sha text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC' AS $body$
DECLARE i jobfinder_control.dispatch_intent;
BEGIN
  IF session_user <> 'dot_jobfinder_writer' OR p_project IS DISTINCT FROM 'yiopvxysxrtrnvqxwgbx'
    OR p_request IS NULL OR p_sha IS NULL OR p_sha !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'LEDGER_READ_SCOPE'; END IF;
  SELECT * INTO i FROM jobfinder_control.dispatch_intent
    WHERE project_id=p_project AND request_id=p_request AND request_sha256=p_sha;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('state',i.state,'original',i.original,'claimedAt',i.claimed_at,'resolvedAt',i.resolved_at);
END;
$body$;

CREATE FUNCTION jobfinder_control.resolve_committed_v1(p_project text,p_request uuid,p_sha text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET TimeZone = 'UTC'
SET lock_timeout = '1000ms' AS $body$
DECLARE i jobfinder_control.dispatch_intent; exact boolean;
BEGIN
  IF session_user <> 'dot_jobfinder_writer' OR p_project IS DISTINCT FROM 'yiopvxysxrtrnvqxwgbx'
    OR p_request IS NULL OR p_sha IS NULL OR p_sha !~ '^[a-f0-9]{64}$'
    OR current_setting('transaction_isolation') <> 'read committed'
    OR current_setting('synchronous_commit') <> 'on' THEN RAISE EXCEPTION 'LEDGER_RESOLVE_SCOPE'; END IF;
  SELECT * INTO i FROM jobfinder_control.dispatch_intent
    WHERE project_id=p_project AND request_id=p_request AND request_sha256=p_sha FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_ORIGINAL_NOT_FOUND'; END IF;
  IF i.state='COMMITTED_EXACT' THEN
    RETURN jsonb_build_object('state',i.state,'requestId',i.request_id,'requestSha256',i.request_sha256,'resolvedAt',i.resolved_at);
  END IF;
  -- One SQL statement = one MVCC snapshot for every native source/batch/member/
  -- lock check. No caller-provided outcome, SQL, table name, callback, or clock.
  SELECT EXISTS (
    SELECT 1 FROM public."CrawlBatchSourceResult" s
    JOIN public."CrawlBatch" b ON b.id=s."batchId"
    JOIN public."CrawlCoordinatorLock" l ON l.id='formal-crawl'
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public."CrawlBatchSourceResult",i.original->'expectedSourceResult') e
    CROSS JOIN LATERAL jsonb_populate_record(NULL::public."CrawlBatch",i.original->'expectedBatch') eb
    CROSS JOIN LATERAL (
      SELECT count(*) AS n,
        encode(extensions.digest(convert_to('['||coalesce(string_agg(to_json(m."jobKey")::text,',' ORDER BY convert_to(m."jobKey",'UTF8')),'')||']','UTF8'),'sha256'),'hex') AS current_hash,
        encode(extensions.digest(convert_to('['||coalesce(string_agg('['||to_json(m."sourceId")::text||','||to_json(m."jobKey")::text||']',',' ORDER BY convert_to('['||to_json(m."sourceId")::text||','||to_json(m."jobKey")::text||']','UTF8')),'')||']','UTF8'),'sha256'),'hex') AS aggregate_hash
      FROM public."LifecycleSetEvidenceMember" m WHERE m."releaseCandidateId"=i.candidate_id
        AND m."batchId"=i.batch_id AND m."sourceResultId"=i.source_result_id AND m."sourceId"=i.source_id AND m."setKind"='CURRENT'
    ) members
    WHERE s.id=i.source_result_id AND s."releaseCandidateId"=i.candidate_id AND s."sourceId"=i.source_id AND s."batchId"=i.batch_id
      -- Exact 57-field native terminal map; typed timestamps/JSON/arrays/nulls.
      AND s."id" IS NOT DISTINCT FROM e."id"
      AND s."releaseCandidateId" IS NOT DISTINCT FROM e."releaseCandidateId"
      AND s."batchId" IS NOT DISTINCT FROM e."batchId"
      AND s."sourceId" IS NOT DISTINCT FROM e."sourceId"
      AND s."transportState" IS NOT DISTINCT FROM e."transportState"
      AND s."adapterState" IS NOT DISTINCT FROM e."adapterState"
      AND s."completenessState" IS NOT DISTINCT FROM e."completenessState"
      AND s."atomicCommitState" IS NOT DISTINCT FROM e."atomicCommitState"
      AND s."sourceConfigHash" IS NOT DISTINCT FROM e."sourceConfigHash"
      AND s."adapterVersion" IS NOT DISTINCT FROM e."adapterVersion"
      AND s."officialEntryId" IS NOT DISTINCT FROM e."officialEntryId"
      AND s."officialSurfaceIds" IS NOT DISTINCT FROM e."officialSurfaceIds"
      AND s."officialChannelIds" IS NOT DISTINCT FROM e."officialChannelIds"
      AND s."startedAt" IS NOT DISTINCT FROM e."startedAt"
      AND s."finishedAt" IS NOT DISTINCT FROM e."finishedAt"
      AND s."rawCount" IS NOT DISTINCT FROM e."rawCount"
      AND s."parsedCount" IS NOT DISTINCT FROM e."parsedCount"
      AND s."validCount" IS NOT DISTINCT FROM e."validCount"
      AND s."normalizedCount" IS NOT DISTINCT FROM e."normalizedCount"
      AND s."dedupeInputCount" IS NOT DISTINCT FROM e."dedupeInputCount"
      AND s."dedupeOutputCount" IS NOT DISTINCT FROM e."dedupeOutputCount"
      AND s."parseDiscardCount" IS NOT DISTINCT FROM e."parseDiscardCount"
      AND s."validationDiscardCount" IS NOT DISTINCT FROM e."validationDiscardCount"
      AND s."normalizationDiscardCount" IS NOT DISTINCT FROM e."normalizationDiscardCount"
      AND s."dedupeDiscardCount" IS NOT DISTINCT FROM e."dedupeDiscardCount"
      AND s."collisionCount" IS NOT DISTINCT FROM e."collisionCount"
      AND s."discardCount" IS NOT DISTINCT FROM e."discardCount"
      AND s."expectedJobCount" IS NOT DISTINCT FROM e."expectedJobCount"
      AND s."expectedEvidenceKind" IS NOT DISTINCT FROM e."expectedEvidenceKind"
      AND s."expectedSurfaceSha256" IS NOT DISTINCT FROM e."expectedSurfaceSha256"
      AND s."visitedSurfaceSha256" IS NOT DISTINCT FROM e."visitedSurfaceSha256"
      AND s."expectedChannelSha256" IS NOT DISTINCT FROM e."expectedChannelSha256"
      AND s."visitedChannelSha256" IS NOT DISTINCT FROM e."visitedChannelSha256"
      AND s."canonicalCurrentJobSetSha256" IS NOT DISTINCT FROM e."canonicalCurrentJobSetSha256"
      AND s."canonicalGraceJobSetSha256" IS NOT DISTINCT FROM e."canonicalGraceJobSetSha256"
      AND s."canonicalVisibleJobSetSha256" IS NOT DISTINCT FROM e."canonicalVisibleJobSetSha256"
      AND s."canonicalOutputSetSha256" IS NOT DISTINCT FROM e."canonicalOutputSetSha256"
      AND s."adapterInputCount" IS NOT DISTINCT FROM e."adapterInputCount"
      AND s."adapterOutputCount" IS NOT DISTINCT FROM e."adapterOutputCount"
      AND s."adapterLossCount" IS NOT DISTINCT FROM e."adapterLossCount"
      AND s."adapterCollisionGroupCount" IS NOT DISTINCT FROM e."adapterCollisionGroupCount"
      AND s."adapterReconciliationSha256" IS NOT DISTINCT FROM e."adapterReconciliationSha256"
      AND s."collisionLedgerSha256" IS NOT DISTINCT FROM e."collisionLedgerSha256"
      AND s."blockerCode" IS NOT DISTINCT FROM e."blockerCode"
      AND s."completenessCertificate" IS NOT DISTINCT FROM e."completenessCertificate"
      AND s."completenessCertificateSha256" IS NOT DISTINCT FROM e."completenessCertificateSha256"
      AND s."baselinePreviousSourceResultId" IS NOT DISTINCT FROM e."baselinePreviousSourceResultId"
      AND s."baselinePreviousJobCount" IS NOT DISTINCT FROM e."baselinePreviousJobCount"
      AND s."baselineChangeReason" IS NOT DISTINCT FROM e."baselineChangeReason"
      AND s."blockerReason" IS NOT DISTINCT FROM e."blockerReason"
      AND s."failureCategory" IS NOT DISTINCT FROM e."failureCategory"
      AND s."failureDiagnosticCode" IS NOT DISTINCT FROM e."failureDiagnosticCode"
      AND s."fetchAttemptCount" IS NOT DISTINCT FROM e."fetchAttemptCount"
      AND s."retryCount" IS NOT DISTINCT FROM e."retryCount"
      AND s."retryReasonCodes" IS NOT DISTINCT FROM e."retryReasonCodes"
      AND s."failureCode" IS NOT DISTINCT FROM e."failureCode"
      AND s."failureReason" IS NOT DISTINCT FROM e."failureReason"
      AND b."id" IS NOT DISTINCT FROM eb."id"
      AND b."releaseCandidateId" IS NOT DISTINCT FROM eb."releaseCandidateId"
      AND b."commitSha" IS NOT DISTINCT FROM eb."commitSha"
      AND b."rosterSha256" IS NOT DISTINCT FROM eb."rosterSha256"
      AND b."sourcePlanSha256" IS NOT DISTINCT FROM eb."sourcePlanSha256"
      AND b."sourceConfigSha256" IS NOT DISTINCT FROM eb."sourceConfigSha256"
      AND b."adapterBundleSha256" IS NOT DISTINCT FROM eb."adapterBundleSha256"
      AND b."kind" IS NOT DISTINCT FROM eb."kind"
      AND b."manualCrawlRequestId" IS NOT DISTINCT FROM eb."manualCrawlRequestId"
      AND b."plannedSourceIds" IS NOT DISTINCT FROM eb."plannedSourceIds"
      AND b."plannedSourceSetSha256" IS NOT DISTINCT FROM eb."plannedSourceSetSha256"
      AND b."plannedSourceCount" IS NOT DISTINCT FROM eb."plannedSourceCount"
      AND b."ownerId" IS NOT DISTINCT FROM eb."ownerId"
      AND b."startedAt" IS NOT DISTINCT FROM eb."startedAt"
      AND s."transportState"='SUCCEEDED' AND s."adapterState"='SUCCEEDED'
      AND s."completenessState"='VERIFIED' AND s."atomicCommitState"='COMMITTED'
      AND b.status='SUCCESS' AND b."plannedSourceCount"=1
      AND b."transportSucceededCount"=1 AND b."adapterSucceededCount"=1
      AND b."completenessVerifiedCount"=1 AND b."atomicCommittedCount"=1
      AND b."transportFailedCount"=0 AND b."adapterFailedCount"=0
      AND b."completenessIncompleteCount"=0 AND b."atomicFailedCount"=0
      AND b."failedSourceCount"=0 AND b."blockedSourceCount"=0 AND b."skippedSourceCount"=0
      AND (SELECT count(*) FROM public."CrawlBatchSourceResult" other WHERE other."batchId"=i.batch_id)=1
      -- Native permits capture clocks up to 1 second ahead. Prisma's native
      -- TIMESTAMP(3) may round by 0.5 ms; do not impose stricter time ordering.
      AND b."finishedAt" IS NOT NULL AND b."heartbeatAt">=s."finishedAt"-interval '1001 milliseconds'
      AND b."finishedAt">=s."finishedAt"-interval '1001 milliseconds'
      AND b."finishedAt"<=to_timestamp((i.original->>'expiresAt')::numeric/1000)::timestamp
      AND b."heartbeatAt"<=to_timestamp((i.original->>'expiresAt')::numeric/1000)::timestamp
      AND members.n=s."dedupeOutputCount" AND members.current_hash=s."canonicalCurrentJobSetSha256"
      AND members.current_hash=s."canonicalOutputSetSha256" AND members.aggregate_hash=b."aggregateJobSetSha256"
      AND l."holderId"='' AND l."holderId"<>i.holder_id::text
      AND l.metadata='portable-quality-sync-v1:released'
      AND l."heartbeatAt">=(b."finishedAt" AT TIME ZONE 'UTC')-interval '1 millisecond'
  ) INTO exact;
  IF exact IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('state','HOLD','requestId',i.request_id,'requestSha256',i.request_sha256,
      'reason','NATIVE_COMMIT_NOT_EXACT','retryAuthorized',false);
  END IF;
  UPDATE jobfinder_control.dispatch_intent SET state='COMMITTED_EXACT',resolved_at=clock_timestamp()
    WHERE request_id=i.request_id RETURNING * INTO i;
  RETURN jsonb_build_object('state',i.state,'requestId',i.request_id,'requestSha256',i.request_sha256,'resolvedAt',i.resolved_at);
END;
$body$;
-- Absence, even after expiresAt, NEVER clears the slot. No absence API exists.
-- Safe absence resolution needs separately proven synchronization with the
-- native transaction, not a sleep, clock comparison, or caller's success flag.

ALTER FUNCTION jobfinder_control._protect_intent_v1() OWNER TO dot_jobfinder_ledger_owner;
ALTER FUNCTION jobfinder_control._assert_original_v1(jsonb) OWNER TO dot_jobfinder_ledger_owner;
ALTER FUNCTION jobfinder_control.claim_dispatch_v1(jsonb) OWNER TO dot_jobfinder_ledger_owner;
ALTER FUNCTION jobfinder_control.read_unresolved_v1(text,text) OWNER TO dot_jobfinder_ledger_owner;
ALTER FUNCTION jobfinder_control.read_dispatch_v1(text,uuid,text) OWNER TO dot_jobfinder_ledger_owner;
ALTER FUNCTION jobfinder_control.resolve_committed_v1(text,uuid,text) OWNER TO dot_jobfinder_ledger_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA jobfinder_control FROM PUBLIC, anon, authenticated, service_role, dot_jobfinder_writer;
GRANT EXECUTE ON FUNCTION jobfinder_control.claim_dispatch_v1(jsonb),
  jobfinder_control.read_unresolved_v1(text,text), jobfinder_control.read_dispatch_v1(text,uuid,text),
  jobfinder_control.resolve_committed_v1(text,uuid,text) TO dot_jobfinder_writer;
ALTER DEFAULT PRIVILEGES FOR ROLE dot_jobfinder_ledger_owner IN SCHEMA jobfinder_control REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
