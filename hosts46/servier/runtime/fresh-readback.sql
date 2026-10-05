WITH latest_successful AS (
 SELECT s.id AS "sourceResultId",s."sourceId",s."batchId",s."releaseCandidateId",s."sourceConfigHash",s."startedAt",s."finishedAt"
 FROM public."CrawlBatchSourceResult" s JOIN public."CrawlBatch" b ON b.id=s."batchId" AND b."releaseCandidateId"=s."releaseCandidateId"
 WHERE s."sourceId"='source-servier-china-social' AND s."atomicCommitState"='COMMITTED' AND s."completenessState"='VERIFIED'
 AND b.status='SUCCESS' AND b.kind<>'MANUAL_SOURCE'
 ORDER BY s."finishedAt" DESC,s.id DESC LIMIT 1
)
SELECT clock_timestamp() AS "checkedAt",
 (SELECT jsonb_agg(to_jsonb(r)) FROM public."ReleaseCandidate" r WHERE id='dot-cloud-restored-fb0b8e3-20261005T2028Z') AS "candidateRows",
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId",
 (SELECT coalesce(jsonb_agg(jsonb_build_object('migrationName',migration_name,'checksum',checksum,'finishedAt',finished_at,'rolledBackAt',rolled_back_at) ORDER BY migration_name),'[]'::jsonb) FROM public."_prisma_migrations") AS "migrationRows",
 (SELECT md5(pg_get_functiondef(to_regprocedure('public.enforce_source_result_state_machine()')))) AS "sourceResultGuardMd5",
 (SELECT coalesce(jsonb_agg(jsonb_build_object('sourceResultId',s.id,'sourceId',s."sourceId",'batchId',s."batchId",'candidateId',s."releaseCandidateId",'batchCandidateId',b."releaseCandidateId",'candidateStatus',c.status,'candidateVersion',c.version,'candidateMigrationVersion',c."migrationVersion",'candidateSchemaHash',c."schemaHash",'sourceConfigHash',s."sourceConfigHash",'batchStatus',b.status,'atomicCommitState',s."atomicCommitState",'batchStartedAt',b."startedAt",'sourceStartedAt',s."startedAt",'sourceFinishedAt',s."finishedAt") ORDER BY b."startedAt",s.id),'[]'::jsonb)
  FROM public."CrawlBatchSourceResult" s JOIN public."CrawlBatch" b ON b.id=s."batchId" LEFT JOIN public."ReleaseCandidate" c ON c.id=s."releaseCandidateId" WHERE s."sourceId"='source-servier-china-social' AND b.status='RUNNING') AS "sameSourceRunning",
 (SELECT to_jsonb(s)||jsonb_build_object('observations',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',o.id,'sourceResultId',o."sourceResultId",'sourceId',o."sourceId",'batchId',o."batchId",'releaseCandidateId',o."releaseCandidateId",'sourceConfigSha256',o."sourceConfigSha256",
   'crawledAt',o."crawledAt",'observedFrom',o."observedFrom",'observedTo',o."observedTo",'successful',o.successful,
   'transportSucceeded',o."transportSucceeded",'adapterSucceeded',o."adapterSucceeded",'completenessVerified',o."completenessVerified",'atomicCommitSucceeded',o."atomicCommitSucceeded") ORDER BY o.id)
   FROM public."CrawlObservation" o WHERE o."sourceResultId"=s."sourceResultId" AND o."sourceId"=s."sourceId" AND o."batchId"=s."batchId" AND o."releaseCandidateId"=s."releaseCandidateId"),'[]'::jsonb)) FROM latest_successful s) AS "latestSuccessfulSource";
