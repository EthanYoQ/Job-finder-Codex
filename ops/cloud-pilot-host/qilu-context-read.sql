WITH matching AS (
 SELECT r.* FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
 WHERE r."sourceId"='source-lilly-china-social'
 AND r."sourceConfigHash"='34ac4d47a1b69389e567b53df64062f10ed50a1d34cb0b4876d3c9af85e68c97'
 AND r."completenessState"='VERIFIED' AND r."atomicCommitState"='COMMITTED'
 AND r."completenessCertificateSha256" IS NOT NULL
 AND r."completenessCertificate"->>'schemaVersion'='plan-bound-source-quality-v1'
 AND b.kind<>'MANUAL_SOURCE'
), jobs AS (
 SELECT j."dedupeKey",j."companyId",j."sourceId",j."sourceJobId",j."officialTitle",j."auxiliaryChineseTitle",j."officialUrl",j."listUrl",j."locationRaw",j.city,j.cities,j.category,j."officialPublishedAt",j."firstSeenAt",j."lastSeenAt",j."missingSuccessCount",j."lifecycleStatus",
 jsonb_build_object('atsKind',s."atsKind",'kind',s.kind,'status',s.status,'officialEntryUrl',s."officialEntryUrl",'officialChainEvidenceUrl',s."officialChainEvidenceUrl") AS source,
 jsonb_build_object('officialChineseName',c."officialChineseName") AS company
 FROM public."Job" j JOIN public."RecruitmentSource" s ON s.id=j."sourceId"
 JOIN public."Company" c ON c.id=j."companyId" WHERE j."sourceId"='source-lilly-china-social'
 ORDER BY j."lastSeenAt" DESC,j."dedupeKey"
)
SELECT jsonb_build_object('classification','READ_ONLY_PERSISTED_CONTEXT_NOT_NEW_PUBLICATION_AUTHORITY','checkedAt',clock_timestamp(),
 'leaseEmpty',(SELECT "holderId"='' FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl'),
 'sourceId','source-lilly-china-social','sourceConfigSha256','34ac4d47a1b69389e567b53df64062f10ed50a1d34cb0b4876d3c9af85e68c97',
 'jobs',coalesce((SELECT jsonb_agg(to_jsonb(jobs)) FROM jobs),'[]'::jsonb),
 'latestAccepted',(SELECT to_jsonb(matching) FROM matching ORDER BY "finishedAt" DESC,id DESC LIMIT 1),
 'firstAccepted',(SELECT to_jsonb(matching) FROM matching ORDER BY "finishedAt" ASC,id ASC LIMIT 1),
 'baselineCompleted',EXISTS(SELECT 1 FROM public."CrawlObservation" o JOIN public."CrawlBatch" b ON b.id=o."batchId" WHERE o."sourceId"='source-lilly-china-social' AND o.successful AND b.kind<>'MANUAL_SOURCE'),
 'servingCandidate',(SELECT to_jsonb(rc) FROM public."ReleaseCandidate" rc WHERE id='portable-0a1f60c-20261002')) AS context;
