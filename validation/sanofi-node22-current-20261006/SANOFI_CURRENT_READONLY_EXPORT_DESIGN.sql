-- DESIGN ONLY: NOT EXECUTED. Single-source current snapshot, not a recreated old88 fixture.
-- The sole DB owner decides whether to run it. No credentials or body/path columns are selected.
-- Use an already-authorized read-only connection. This one SELECT has one MVCC snapshot.
-- A BLOCKED status is inconclusive: NEVER compare an empty/limited export as if complete.
-- One SELECT has a single MVCC snapshot. Owner must enforce an actual <=5000ms
-- statement timeout/cancellation budget on its existing read-only connection.
-- Do not rely on set_config(statement_timeout) inside this SELECT.
-- SQL output timestamp fields without offsets represent the schema's UTC timestamps.
WITH
params AS (
  SELECT 'source-sanofi-china-social'::text AS source_id,
    'company-sanofi-china'::text AS company_id,
    '2925884ffb70805a106c730a5b24a8992b0d13ce0348de28639e27d1bbfeacee'::text AS current_config,
    'dot-sanofi-a-20261003T0445Z-b181c52--source-sanofi-china-social'::text AS pinned_result_id,
    '106fb80ad4e6c953d41a2dd67156f42e1bc4416766c98912a60ad59722df97c3'::text AS pinned_config
),
-- Preserve ALL scheduled history for this source, including unknown configs and failed/running attempts.
raw_results AS MATERIALIZED (
  SELECT r.* FROM public."CrawlBatchSourceResult" r
  JOIN public."CrawlBatch" b ON b.id=r."batchId"
  CROSS JOIN params p
  WHERE r."sourceId"=p.source_id AND b.kind='SCHEDULED'
  ORDER BY r."startedAt", r.id COLLATE "C" LIMIT 257
),
source_guard AS (
  SELECT count(*) AS result_count,
    COALESCE(sum(octet_length("completenessCertificate"::text)),0) AS certificate_json_bytes
  FROM raw_results
),
scoped_results AS MATERIALIZED (
  SELECT r.* FROM raw_results r CROSS JOIN source_guard g
  WHERE g.result_count BETWEEN 1 AND 256 AND g.certificate_json_bytes <= 4194304
),
result_rows AS MATERIALIZED (
  SELECT r."id", r."releaseCandidateId", r."batchId", r."sourceId", r."sourceConfigHash", r."adapterVersion", r."transportState", r."adapterState", r."completenessState", r."atomicCommitState", r."failureCategory", r."failureDiagnosticCode", r."fetchAttemptCount", r."retryCount", CASE WHEN r."retryReasonCodes" IS NULL OR cardinality(r."retryReasonCodes")=0 THEN r."retryReasonCodes" ELSE ARRAY['NONEMPTY_REDACTED']::text[] END AS "retryReasonCodes", CASE WHEN r."failureCode" IS NULL OR r."failureCode"='' OR r."failureCode"='SOURCE_NOT_DUE' OR r."failureCode"='BATCH_ABORTED_BEFORE_SOURCE_TERMINAL' THEN r."failureCode" ELSE '[NONEMPTY_REDACTED]' END AS "failureCode", CASE WHEN r."failureReason" IS NULL OR r."failureReason"='' OR r."failureReason"='Batch aborted before this source reached a terminal state' THEN r."failureReason" ELSE '[NONEMPTY_REDACTED]' END AS "failureReason", CASE WHEN r."blockerCode" IS NULL OR r."blockerCode"='' THEN r."blockerCode" ELSE '[NONEMPTY_REDACTED]' END AS "blockerCode", CASE WHEN r."blockerReason" IS NULL OR r."blockerReason"='' THEN r."blockerReason" ELSE '[NONEMPTY_REDACTED]' END AS "blockerReason", r."startedAt", r."finishedAt", r."rawCount", r."parsedCount", r."validCount", r."normalizedCount", r."dedupeInputCount", r."dedupeOutputCount", r."parseDiscardCount", r."validationDiscardCount", r."normalizationDiscardCount", r."dedupeDiscardCount", r."collisionCount", r."discardCount", r."adapterInputCount", r."adapterOutputCount", r."adapterLossCount", r."adapterCollisionGroupCount", r."expectedSurfaceSha256", r."visitedSurfaceSha256", r."expectedChannelSha256", r."visitedChannelSha256", r."expectedJobCount", r."expectedEvidenceKind", r."officialSurfaceIds", r."officialChannelIds", r."canonicalCurrentJobSetSha256", r."canonicalGraceJobSetSha256", r."canonicalVisibleJobSetSha256", r."canonicalOutputSetSha256", r."adapterReconciliationSha256", r."collisionLedgerSha256", r."completenessCertificate", r."completenessCertificateSha256",
    (SELECT to_jsonb(bx) FROM (SELECT b."id", b."releaseCandidateId", b."kind", b."status", b."commitSha", b."rosterSha256", b."sourcePlanSha256", b."sourceConfigSha256", b."adapterBundleSha256", b."startedAt", b."finishedAt") bx) AS batch,
    COALESCE((SELECT jsonb_agg(to_jsonb(ox)) FROM (
      SELECT o."sourceId", o."batchId", o."releaseCandidateId", o."sourceResultId", o."sourceConfigSha256", o."adapterVersion", o."observedFrom", o."observedTo", o."crawledAt", o."successful", o."transportSucceeded", o."adapterSucceeded", o."completenessVerified", o."atomicCommitSucceeded", o."canonicalRawSha256", o."canonicalOutputSha256", o."paginationTraceSha256" FROM public."CrawlObservation" o
      WHERE o."sourceResultId"=r.id ORDER BY o.id COLLATE "C" LIMIT 33
    ) ox),'[]'::jsonb) AS observations,
    jsonb_build_object(
      'transportAttempts', (SELECT count(*) FROM public."TransportAttemptEvidence" z WHERE z."sourceResultId"=r.id),
      'evidenceArtifacts', (SELECT count(*) FROM public."EvidenceArtifact" z WHERE z."sourceResultId"=r.id),
      'observations', (SELECT count(*) FROM public."CrawlObservation" z WHERE z."sourceResultId"=r.id),
      'paginationEvidence', (SELECT count(*) FROM public."PaginationEvidence" z WHERE z."sourceResultId"=r.id),
      'lossLedgerEntries', (SELECT count(*) FROM public."LossLedgerEntry" z WHERE z."sourceResultId"=r.id),
      'lifecycleSetMembers', (SELECT count(*) FROM public."LifecycleSetEvidenceMember" z WHERE z."sourceResultId"=r.id)
    ) AS "_count"
  FROM scoped_results r JOIN public."CrawlBatch" b ON b.id=r."batchId"
),
-- Mirrors the repository's prefetch selection, NOT receipt acceptance.
-- Both old and new source repositories use this selection for this one source.
prefetch_candidates AS MATERIALIZED (
  SELECT r.* FROM scoped_results r CROSS JOIN params p
  WHERE (r."sourceConfigHash"=p.current_config OR
    (r.id=p.pinned_result_id AND r."sourceConfigHash"=p.pinned_config))
    AND r."atomicCommitState"='COMMITTED' AND r."completenessState"='VERIFIED'
    AND r."finishedAt" IS NOT NULL
),
selected_prefetch AS MATERIALIZED (
  SELECT r.*, (SELECT min("finishedAt") FROM prefetch_candidates) AS floor
  FROM prefetch_candidates r
  ORDER BY r."finishedAt" DESC, r.id COLLATE "C" DESC LIMIT 1
),
members_raw AS MATERIALIZED (
  SELECT m."releaseCandidateId", m."batchId", m."sourceId", m."sourceResultId", m."setKind", m."jobKey", m."jobKeySha256", m."lifecycleStatus", m."missingCount" FROM public."LifecycleSetEvidenceMember" m
  JOIN selected_prefetch r ON r.id=m."sourceResultId"
  ORDER BY m."sourceResultId",m."setKind",m."jobKey" COLLATE "C" LIMIT 4097
),
jobs_raw AS MATERIALIZED (
  SELECT j."id", j."companyId", j."sourceId", j."dedupeKey", j."officialTitle", j."auxiliaryChineseTitle", j."humanCorrectedTitle", j."officialUrl", j."officialPublishedAt", j."city", j."cities", j."locationRaw", j."category", j."humanCorrectedCategory", j."isNew", j."lastSeenAt", j."lifecycleStatus", j."visibleInFrontend", j."missingSuccessCount" FROM selected_prefetch r CROSS JOIN params p
  JOIN public."Job" j ON j."sourceId"=p.source_id AND j."companyId"=p.company_id
  WHERE j."lifecycleStatus"='ACTIVE' AND j."visibleInFrontend"=true
    AND j."lastSeenAt">=r.floor AND j."lastSeenAt"<=r."finishedAt"
    AND EXISTS (SELECT 1 FROM members_raw m WHERE m."sourceResultId"=r.id
      AND m."setKind"='VISIBLE' AND m."jobKey"=j."dedupeKey")
  ORDER BY j."sourceId",j."dedupeKey" COLLATE "C" LIMIT 2049
),
-- Only metadata that can match current Sanofi identity proof locators.
-- Preserve kinds and duplicates; do not hide malformed metadata by filtering to an expected kind.
artifacts_raw AS MATERIALIZED (
  SELECT a."releaseCandidateId", a."batchId", a."sourceResultId", a."sourceId", a."kind", a."sha256", a."extractorLocator" FROM scoped_results r
  JOIN public."EvidenceArtifact" a ON a."sourceResultId"=r.id
    AND a."sourceId"=r."sourceId" AND a."batchId"=r."batchId"
    AND a."releaseCandidateId"=r."releaseCandidateId"
  WHERE r."atomicCommitState"='COMMITTED' AND r."completenessState"='VERIFIED'
    AND r."completenessCertificate"->>'grade'='B'
    AND (a."extractorLocator"='sanofi-cn-module-anomalies-v2'
      OR a."extractorLocator" LIKE 'sanofi-cn-detail-v2|request-contract-v2|sha256:%')
  ORDER BY a."sourceResultId",a.id COLLATE "C" LIMIT 2049
),
export_guard AS (
  SELECT g.*, (SELECT count(*) FROM members_raw) AS member_count,
    (SELECT count(*) FROM jobs_raw) AS job_count,
    (SELECT count(*) FROM artifacts_raw) AS artifact_count,
    COALESCE((SELECT max(("_count"->>'observations')::bigint) FROM result_rows),0) AS max_observations,
    COALESCE((SELECT sum(("_count"->>'observations')::bigint) FROM result_rows),0) AS observation_count
  FROM source_guard g
),
status AS (
  SELECT g.*, CASE
    WHEN result_count=0 THEN 'BLOCKED_NO_SOURCE_HISTORY'
    WHEN result_count>256 THEN 'BLOCKED_SOURCE_HISTORY_CAP'
    WHEN certificate_json_bytes>4194304 THEN 'BLOCKED_CERTIFICATE_JSON_CAP'
    WHEN NOT EXISTS (SELECT 1 FROM scoped_results r CROSS JOIN params p WHERE r.id=p.pinned_result_id) THEN 'BLOCKED_PINNED_HISTORY_MISSING'
    WHEN member_count>4096 THEN 'BLOCKED_MEMBERS_CAP'
    WHEN job_count>2048 THEN 'BLOCKED_JOBS_CAP'
    WHEN artifact_count>2048 THEN 'BLOCKED_ARTIFACT_METADATA_CAP'
    WHEN max_observations>32 THEN 'BLOCKED_OBSERVATION_CAP'
    WHEN 2*result_count+observation_count+member_count+job_count+artifact_count>4096 THEN 'BLOCKED_TOTAL_RECORD_CAP'
    ELSE 'COMPLETE_SINGLE_SOURCE_EXPORT' END AS export_status
  FROM export_guard g
),
packet AS (
SELECT jsonb_build_object(
  'schemaVersion','sanofi-current-readonly-comparison-v1',
  'exportStatus',s.export_status,
  'capturedAt',statement_timestamp(),
  'sourceId',(SELECT source_id FROM params),
  'bounds',to_jsonb(s),
  'isHistoricalFixture',false,
  'diagnosticTextNormalization','null/empty preserved; recognized skip/abort code and exact abort text preserved; other text represented only as nonempty. Retry reasons preserve empty/nonempty only.',
  'snapshot',CASE WHEN s.export_status='COMPLETE_SINGLE_SOURCE_EXPORT' THEN jsonb_build_object(
    'results',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x."startedAt",x.id COLLATE "C") FROM result_rows x),'[]'::jsonb),
    'members',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM members_raw x),'[]'::jsonb),
    'jobs',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM jobs_raw x),'[]'::jsonb),
    'artifacts',COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM artifacts_raw x),'[]'::jsonb)
  ) ELSE NULL END
) AS current_source_snapshot
FROM status s
)
SELECT CASE WHEN octet_length(current_source_snapshot::text)<=8388608
  THEN current_source_snapshot
  ELSE jsonb_build_object('schemaVersion','sanofi-current-readonly-comparison-v1',
    'exportStatus','BLOCKED_OUTPUT_8MIB_CAP','snapshot',NULL,'isHistoricalFixture',false)
END AS current_source_snapshot
FROM packet;
