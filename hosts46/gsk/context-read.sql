WITH matching AS (
 SELECT r.* FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
 WHERE r."sourceId"=E'source-gsk-china-social' AND r."sourceConfigHash"=E'aa9bf82308c3b818a8c33b80561712b932389186c160ae83583a8c869eb54d74'
 AND r."completenessState"='VERIFIED' AND r."atomicCommitState"='COMMITTED'
 AND r."completenessCertificateSha256" IS NOT NULL
 AND r."completenessCertificate"->>'schemaVersion'=E'a-grade-official-total-v2' AND b.kind<>'MANUAL_SOURCE'
 ), jobs AS (
 SELECT j."dedupeKey",j."companyId",j."sourceId",j."sourceJobId",j."officialTitle",j."auxiliaryChineseTitle",j."officialUrl",j."listUrl",j."locationRaw",j.city,j.cities,j.category,j."officialPublishedAt",j."firstSeenAt",j."lastSeenAt",j."missingSuccessCount",j."lifecycleStatus",
 jsonb_build_object('atsKind',s."atsKind",'kind',s.kind,'status',s.status,'officialEntryUrl',s."officialEntryUrl",'officialChainEvidenceUrl',s."officialChainEvidenceUrl") AS source,
 jsonb_build_object('officialChineseName',c."officialChineseName") AS company
 FROM public."Job" j JOIN public."RecruitmentSource" s ON s.id=j."sourceId" JOIN public."Company" c ON c.id=j."companyId"
 WHERE j."sourceId"=E'source-gsk-china-social'
 ) SELECT jsonb_build_object('checkedAt',clock_timestamp(),'sourceId',E'source-gsk-china-social','sourceConfigSha256',E'aa9bf82308c3b818a8c33b80561712b932389186c160ae83583a8c869eb54d74',
 'jobs',coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j."lastSeenAt" DESC,j."dedupeKey") FROM jobs j),'[]'::jsonb),
 'latestAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" DESC,id DESC LIMIT 1),
 'firstAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" ASC,id ASC LIMIT 1),
 'candidateRow',(SELECT to_jsonb(r) FROM public."ReleaseCandidate" r WHERE id=E'dot-cloud-restored-fb0b8e3-20261005T2028Z'),
 'sourceRow',(SELECT to_jsonb(r) FROM public."RecruitmentSource" r WHERE id=E'source-gsk-china-social'),
 'companyRow',(SELECT to_jsonb(r) FROM public."Company" r WHERE id=E'company-gsk-china')) AS context;