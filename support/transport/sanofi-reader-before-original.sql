BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='8s';
WITH publication AS (
WITH matching AS (
 SELECT r.*,coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public."CrawlObservation" o WHERE o."sourceResultId"=r.id),'[]'::jsonb) AS observations,coalesce((
 SELECT jsonb_agg(jsonb_build_object('releaseCandidateId',a."releaseCandidateId",'batchId',a."batchId",'sourceResultId',a."sourceResultId",'sourceId',a."sourceId",'kind',a.kind,'extractorLocator',a."extractorLocator",'sha256',a.sha256,'byteCount',a."byteCount",'capturedAt',to_char(a."capturedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY a.kind,a."extractorLocator",a.id)
 FROM public."EvidenceArtifact" a
 WHERE a."releaseCandidateId"=r."releaseCandidateId" AND a."batchId"=r."batchId" AND a."sourceResultId"=r.id AND a."sourceId"=r."sourceId"
 AND ((((CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)->>'schemaVersion')=E'sanofi-cn-dual-chain-attestation-v1') OR
 (((CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)->>'schemaVersion')='b-grade-independent-traversal-v2' AND ((a.kind='ORACLE_RESULT' AND a."extractorLocator"='sanofi-cn-module-anomalies-v2') OR (a.kind='ATS_PAGE' AND a."extractorLocator" IN (
 SELECT 'sanofi-cn-detail-v2|request-contract-v2|sha256:'||encode(extensions.digest(convert_to(
 '{"body":null,"coordinate":{"id":'||to_json(h->>'id')::text||'},"family":"html","method":"GET","role":"sanofi-cn-detail","url":'||to_json(h->>'officialUrl')::text||',"v":2}','UTF8'),'sha256'),'hex')
 FROM jsonb_array_elements(coalesce(((CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)#>>'{mainTraversal,sanofiIdentityProof,oracleBody}')::jsonb->'entries','[]'::jsonb)) h
 WHERE h->>'code'='SANOFI_CN_FOREIGN_HEADER_NATIVE_AUTHORITY'
 )))))),'[]'::jsonb) AS "evidenceArtifacts" FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
 WHERE r."sourceId"=E'source-viatris-social' AND r."sourceConfigHash"=E'5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9'
 AND r."completenessState"='VERIFIED' AND r."atomicCommitState"='COMMITTED'
 AND r."completenessCertificateSha256" IS NOT NULL
 AND (CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)->>'schemaVersion' IN (E'__ORIGINAL_CERTIFICATE_SCHEMA__',E'sanofi-cn-dual-chain-attestation-v1') AND (NOT __ORIGINAL_REQUIRES_PORTABLE_POLICY__ OR (CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)->>'policyId'=E'PLAN_BOUND_SOURCE_QUALITY_V1') AND b.kind<>'MANUAL_SOURCE'
 ), jobs AS (
 SELECT j."dedupeKey",j."companyId",j."sourceId",j."sourceJobId",j."officialTitle",j."auxiliaryChineseTitle",j."officialUrl",j."listUrl",j."locationRaw",j.city,j.cities,j.category,j."officialPublishedAt",j."firstSeenAt",j."lastSeenAt",j."missingSuccessCount",j."lifecycleStatus",j."visibleInFrontend",j."isNew",
 jsonb_build_object('atsKind',s."atsKind",'kind',s.kind,'status',s.status,'officialEntryUrl',s."officialEntryUrl",'officialChainEvidenceUrl',s."officialChainEvidenceUrl") AS source,
 jsonb_build_object('officialChineseName',c."officialChineseName") AS company
 FROM public."Job" j JOIN public."RecruitmentSource" s ON s.id=j."sourceId" JOIN public."Company" c ON c.id=j."companyId"
 WHERE j."sourceId"=E'source-viatris-social'
 ) SELECT jsonb_build_object('checkedAt',clock_timestamp(),'sourceId',E'source-viatris-social','sourceConfigSha256',E'5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9',
 'jobs',coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j."lastSeenAt" DESC,j."dedupeKey") FROM jobs j),'[]'::jsonb),
 'latestAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" DESC,id DESC LIMIT 1),
 'firstAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" ASC,id ASC LIMIT 1),
 'candidateRow',(SELECT to_jsonb(r) FROM public."ReleaseCandidate" r WHERE id=E'dot-cloud-native-c2b39d9-20261016'),
 'sourceRow',(SELECT to_jsonb(r) FROM public."RecruitmentSource" r WHERE id=E'source-viatris-social'),
 'companyRow',(SELECT to_jsonb(r) FROM public."Company" r WHERE id=E'company-viatris')) AS context
), latest_writer AS (
 SELECT r.id FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
 WHERE r."sourceId"=E'source-viatris-social' AND r."sourceConfigHash"=E'5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9'
 AND b.kind='SCHEDULED' AND r."atomicCommitState"='COMMITTED' AND r."completenessState"='VERIFIED'
 ORDER BY r."finishedAt" DESC,r.id DESC LIMIT 1
), writers AS (
 SELECT (to_jsonb(r)-'completenessCertificate')||jsonb_build_object('completenessCertificate',CASE WHEN r."completenessCertificate" IS NULL THEN NULL WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1'
      THEN jsonb_build_object('schemaVersion',r."completenessCertificate"->'schemaVersion','binding',r."completenessCertificate"->'binding',
        'verifiedAt',r."completenessCertificate"->'verifiedAt','observedAt',r."completenessCertificate"->'observedAt',
        'members',CASE WHEN r.id IN (SELECT id FROM latest_writer) THEN r."completenessCertificate"->'members' ELSE '[]'::jsonb END,'legacyCertificate',jsonb_build_object('schemaVersion',c.value->'schemaVersion','policyId',c.value->'policyId','observedAt',c.value->'observedAt',
    'observation',CASE WHEN c.value->'observation' IS NOT NULL THEN jsonb_build_object('crawledAt',c.value#>'{observation,crawledAt}') END,
    'counts',jsonb_build_object('finalUniqueJobCount',c.value#>'{counts,finalUniqueJobCount}','validationDiscardCount',c.value#>'{counts,validationDiscardCount}'),
    'mainTraversal',CASE WHEN c.value->'mainTraversal' IS NOT NULL THEN jsonb_build_object('matchKeyKind',c.value#>'{mainTraversal,matchKeyKind}','canonicalMatchKeySetSha256',c.value#>'{mainTraversal,canonicalMatchKeySetSha256}') END))
      ELSE jsonb_build_object('schemaVersion',c.value->'schemaVersion','policyId',c.value->'policyId','observedAt',c.value->'observedAt',
    'observation',CASE WHEN c.value->'observation' IS NOT NULL THEN jsonb_build_object('crawledAt',c.value#>'{observation,crawledAt}') END,
    'counts',jsonb_build_object('finalUniqueJobCount',c.value#>'{counts,finalUniqueJobCount}','validationDiscardCount',c.value#>'{counts,validationDiscardCount}'),
    'mainTraversal',CASE WHEN c.value->'mainTraversal' IS NOT NULL THEN jsonb_build_object('matchKeyKind',c.value#>'{mainTraversal,matchKeyKind}','canonicalMatchKeySetSha256',c.value#>'{mainTraversal,canonicalMatchKeySetSha256}') END) END,'batch',to_jsonb(b),'observations',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public."CrawlObservation" o WHERE o."sourceResultId"=r.id),'[]'::jsonb),'_count',jsonb_build_object(
  'transportAttempts',(SELECT count(*) FROM public."TransportAttemptEvidence" x WHERE x."sourceResultId"=r.id),
  'evidenceArtifacts',(SELECT count(*) FROM public."EvidenceArtifact" x WHERE x."sourceResultId"=r.id),
  'observations',(SELECT count(*) FROM public."CrawlObservation" x WHERE x."sourceResultId"=r.id),
  'paginationEvidence',(SELECT count(*) FROM public."PaginationEvidence" x WHERE x."sourceResultId"=r.id),
  'lossLedgerEntries',(SELECT count(*) FROM public."LossLedgerEntry" x WHERE x."sourceResultId"=r.id),
  'lifecycleSetMembers',(SELECT count(*) FROM public."LifecycleSetEvidenceMember" x WHERE x."sourceResultId"=r.id))) AS row FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
 CROSS JOIN LATERAL (SELECT CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END AS value) c WHERE r."sourceId"=E'source-viatris-social' AND b.kind='SCHEDULED'
), jobs AS (SELECT to_jsonb(j) AS row FROM public."Job" j WHERE j."sourceId"=E'source-viatris-social'), members AS (SELECT to_jsonb(m) AS row FROM public."LifecycleSetEvidenceMember" m WHERE m."sourceId"=E'source-viatris-social'), artifacts AS (SELECT '{}'::jsonb AS row WHERE FALSE)

SELECT jsonb_build_object(
 'writerInventory',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'batchId',r."batchId",'startedAt',r."startedAt",'finishedAt',r."finishedAt",'atomicCommitState',r."atomicCommitState",'sourceConfigHash',r."sourceConfigHash",'batchKind',b.kind) ORDER BY r."startedAt",r.id),'[]'::jsonb) FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE r."sourceId"=E'source-viatris-social'),
 'evidenceScope','Original Sanofi transition: compact scheduled headers and latest manifest, source jobs and lifecycle members; publisher context artifact commitments unchanged; no reader historical artifact proofs',
 'schemaVersion','viatris-reader-before-v1','sqlContract','TAKEDA_PORTABLE_READER_BEFORE_V1',
 'sourceId',E'source-viatris-social','sourceConfigSha256','5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9',
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

