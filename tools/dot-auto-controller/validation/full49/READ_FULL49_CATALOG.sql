BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='4000ms';
SELECT json_build_object(
 'observedAt',clock_timestamp(),'serverVersion',current_setting('server_version_num'),
 'ledger',(SELECT json_agg(json_build_object('migrationName',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL) ORDER BY migration_name) FROM public."_prisma_migrations"),
 'crypto',(SELECT json_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion) FROM pg_extension e JOIN pg_namespace n ON e.extnamespace=n.oid WHERE e.extname='pgcrypto'),
 'functions',(SELECT json_object_agg(v.name,md5(pg_get_functiondef(to_regprocedure(v.name)))) FROM (VALUES ('public.enforce_source_result_state_machine()'),('public.job_projection_canonical_json(jsonb)'),('public.job_persisted_projection_sha256(public."Job")'),('public.job_delta_effective_legacy_certificate(jsonb,text,jsonb,timestamp without time zone)'),('public.validate_job_delta_commit_projection()')) v(name)),
 'triggers',(SELECT json_agg(json_build_object('tableName',v.tab,'name',v.name,'md5',md5(pg_get_triggerdef(t.oid)),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred)) FROM (VALUES ('CrawlBatchSourceResult','CrawlBatchSourceResult_delta_commit_projection'),('CrawlBatchSourceResult','CrawlBatchSourceResult_verified_lifecycle_projection'),('LifecycleSetEvidenceMember','LifecycleSetEvidenceMember_exact_projection'),('TransportAttemptEvidence','TransportAttemptEvidence_nonempty_refs')) v(tab,name) LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.'||quote_ident(v.tab)) AND t.tgname=v.name),
 'baselineCheckMd5',(SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public."CrawlBatchSourceResult"'::regclass AND conname='CrawlBatchSourceResult_baseline_transition_shape_check'),
 'sourceGuardProsrcSha256',(SELECT encode(extensions.digest(convert_to(prosrc,'UTF8'),'sha256'),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.enforce_source_result_state_machine()')),
 'fencePresent',to_regprocedure('public.guard_v75_retired_source_publication()') IS NOT NULL);
COMMIT;
