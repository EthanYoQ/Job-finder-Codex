BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH publication AS (
WITH matching AS (
 SELECT r.*,coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public."CrawlObservation" o WHERE o."sourceResultId"=r.id),'[]'::jsonb) AS observations FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
 WHERE r."sourceId"=E'source-biogen-china-social' AND r."sourceConfigHash"=E'47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348'
 AND r."completenessState"='VERIFIED' AND r."atomicCommitState"='COMMITTED'
 AND r."completenessCertificateSha256" IS NOT NULL
 AND (CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)->>'schemaVersion'=E'plan-bound-source-quality-v1' AND (CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)->>'policyId'=E'PLAN_BOUND_SOURCE_QUALITY_V1' AND b.kind<>'MANUAL_SOURCE'
 ), jobs AS (
 SELECT j."dedupeKey",j."companyId",j."sourceId",j."sourceJobId",j."officialTitle",j."auxiliaryChineseTitle",j."officialUrl",j."listUrl",j."locationRaw",j.city,j.cities,j.category,j."officialPublishedAt",j."firstSeenAt",j."lastSeenAt",j."missingSuccessCount",j."lifecycleStatus",j."visibleInFrontend",j."isNew",
 jsonb_build_object('atsKind',s."atsKind",'kind',s.kind,'status',s.status,'officialEntryUrl',s."officialEntryUrl",'officialChainEvidenceUrl',s."officialChainEvidenceUrl") AS source,
 jsonb_build_object('officialChineseName',c."officialChineseName") AS company
 FROM public."Job" j JOIN public."RecruitmentSource" s ON s.id=j."sourceId" JOIN public."Company" c ON c.id=j."companyId"
 WHERE j."sourceId"=E'source-biogen-china-social'
 ) SELECT jsonb_build_object('checkedAt',clock_timestamp(),'sourceId',E'source-biogen-china-social','sourceConfigSha256',E'47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348',
 'jobs',coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j."lastSeenAt" DESC,j."dedupeKey") FROM jobs j),'[]'::jsonb),
 'latestAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" DESC,id DESC LIMIT 1),
 'firstAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" ASC,id ASC LIMIT 1),
 'candidateRow',(SELECT to_jsonb(r) FROM public."ReleaseCandidate" r WHERE id=E'dot-cloud-c51-recovered-3a240076-20261008'),
 'sourceRow',(SELECT to_jsonb(r) FROM public."RecruitmentSource" r WHERE id=E'source-biogen-china-social'),
 'companyRow',(SELECT to_jsonb(r) FROM public."Company" r WHERE id=E'company-biogen-china')) AS context
), writers AS (
 SELECT to_jsonb(r)||jsonb_build_object('batch',to_jsonb(b),'observations',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public."CrawlObservation" o WHERE o."sourceResultId"=r.id),'[]'::jsonb),'_count',jsonb_build_object(
  'transportAttempts',(SELECT count(*) FROM public."TransportAttemptEvidence" x WHERE x."sourceResultId"=r.id),
  'evidenceArtifacts',(SELECT count(*) FROM public."EvidenceArtifact" x WHERE x."sourceResultId"=r.id),
  'observations',(SELECT count(*) FROM public."CrawlObservation" x WHERE x."sourceResultId"=r.id),
  'paginationEvidence',(SELECT count(*) FROM public."PaginationEvidence" x WHERE x."sourceResultId"=r.id),
  'lossLedgerEntries',(SELECT count(*) FROM public."LossLedgerEntry" x WHERE x."sourceResultId"=r.id),
  'lifecycleSetMembers',(SELECT count(*) FROM public."LifecycleSetEvidenceMember" x WHERE x."sourceResultId"=r.id))) AS row FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE r."sourceId"=E'source-biogen-china-social' AND r."sourceConfigHash"=E'47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348' AND b.kind='SCHEDULED'
), jobs AS (SELECT to_jsonb(j) AS row FROM public."Job" j WHERE j."sourceId"=E'source-biogen-china-social'), member_ids AS (SELECT context->'latestAccepted'->>'id' AS id FROM publication UNION SELECT x->>'lastPresentResultId' FROM publication p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.context->'latestAccepted'->'completenessCertificate'->'members','[]'::jsonb)) x WHERE x->>'missingCount'='1'), members AS (SELECT to_jsonb(m) AS row FROM public."LifecycleSetEvidenceMember" m WHERE m."sourceId"=E'source-biogen-china-social' AND m."sourceResultId" IN (SELECT id FROM member_ids)), artifacts AS (SELECT NULL::jsonb AS row WHERE false)
SELECT jsonb_build_object(
 'writerInventory',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'batchId',r."batchId",'startedAt',r."startedAt",'finishedAt',r."finishedAt",'atomicCommitState',r."atomicCommitState",'sourceConfigHash',r."sourceConfigHash",'batchKind',b.kind) ORDER BY r."startedAt",r.id),'[]'::jsonb) FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE r."sourceId"=E'source-biogen-china-social'),
 'evidenceScope','All current-config scheduled result receipts and verification counts; all source physical jobs; selected receipt and grace lineage members; no historical artifact bodies or metadata',
 'schemaVersion','biogen-reader-before-v1','sqlContract','TAKEDA_PORTABLE_READER_BEFORE_V1',
 'sourceId',E'source-biogen-china-social','sourceConfigSha256','47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348',
 'checkedAt',clock_timestamp(),'transactionReadOnly',current_setting('transaction_read_only'),'isolationLevel',current_setting('transaction_isolation'),
 'publicationContext',(SELECT context FROM publication),
 'results',coalesce((SELECT jsonb_agg(row ORDER BY row->>'id') FROM writers),'[]'::jsonb),
 'jobs',coalesce((SELECT jsonb_agg(row ORDER BY row->>'id') FROM jobs),'[]'::jsonb),
 'members',coalesce((SELECT jsonb_agg(row ORDER BY row->>'id') FROM members),'[]'::jsonb),
 'artifacts',coalesce((SELECT jsonb_agg(row ORDER BY row->>'id') FROM artifacts),'[]'::jsonb),
 'inventory',jsonb_build_object(
  'results',jsonb_build_object('count',(SELECT count(*) FROM writers),'ids',coalesce((SELECT jsonb_agg(row->>'id' ORDER BY row->>'id') FROM writers),'[]'::jsonb)),
  'jobs',jsonb_build_object('count',(SELECT count(*) FROM jobs),'ids',coalesce((SELECT jsonb_agg(row->>'id' ORDER BY row->>'id') FROM jobs),'[]'::jsonb)),
  'members',jsonb_build_object('count',(SELECT count(*) FROM members),'ids',coalesce((SELECT jsonb_agg(row->>'id' ORDER BY row->>'id') FROM members),'[]'::jsonb)),
  'artifacts',jsonb_build_object('count',(SELECT count(*) FROM artifacts),'ids',coalesce((SELECT jsonb_agg(row->>'id' ORDER BY row->>'id') FROM artifacts),'[]'::jsonb))
 )) AS reader_before;
ROLLBACK;
