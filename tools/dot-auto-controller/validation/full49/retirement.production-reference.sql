BEGIN ISOLATION LEVEL READ COMMITTED;
-- REVIEW DRAFT. No production execution is authorized by this file.
-- Requires one surrounding transaction. Do not split into autocommit statements.
SET LOCAL statement_timeout = '4000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL standard_conforming_strings = on;

DO $v75_preflight$
DECLARE
  actual public."ReleaseCandidate"%ROWTYPE;
  expected public."ReleaseCandidate"%ROWTYPE;
  formal_holder text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'V75_FENCE_READ_COMMITTED_REQUIRED';
  END IF;
  -- Same order as the existing DB_STARTED publisher. Never clear/reassign holder.
  SELECT "holderId" INTO formal_holder FROM public."CrawlCoordinatorLock"
    WHERE id = 'formal-crawl' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V75_FENCE_FORMAL_ROW_MISSING'; END IF;
  IF formal_holder IS DISTINCT FROM '' THEN RAISE EXCEPTION 'V75_FENCE_FORMAL_BUSY'; END IF;

  -- Drain existing relevant transactions before installing the new trigger.
  -- These locks allow ordinary SELECT but exclude concurrent relation writers.
  LOCK TABLE public."Job", public."CrawlBatchSourceResult", public."CrawlBatch"
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO actual FROM public."ReleaseCandidate"
    WHERE id = 'dot-cloud-native-d02f4f5-20261011' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V75_FENCE_CANDIDATE_MISSING'; END IF;
  SELECT * INTO expected FROM jsonb_populate_record(
    NULL::public."ReleaseCandidate", '{"id":"dot-cloud-native-d02f4f5-20261011","goalId":"jobfinder-portable-required-40","status":"BUILDING","version":75,"commitSha":"d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f","createdAt":"2026-10-11T10:08:08.337","rosterHash":"ac44a7c7077e23ffa5367dc4bb8a11b254feebc8a190ae7c27481c7269a5a659","schemaHash":"91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a","finalizedAt":null,"oracleVersion":"staged-official-source-v1","dbSnapshotHash":"497022f2a1458e9c2d4ce045bbdf7cfd3486c4e80125b3513a542b4c90ef0d04","sourcePlanHash":"331cc04ae9fb82aeb8001df41c720d0a308dc1402f63b612dcc924276438e1fc","sourceTreeHash":"f23a3b69c170579e58e5b3aaba09a2a4f16dcb66014f4fcd945a4ae0349b30af","runtimeTreeHash":"ff62c1961775cf079a86a96157ad3c44ab5b66b6c1829bca670582b85091ca62","migrationVersion":"20261006172300_job_projection_delta_contract","sourceConfigHash":"dce68ae12803ac1278fe2c4bac5457e63c41f58164ceeb2841322e2ee87a1ef3","adapterBundleHash":"235e54bc98a468cb73b58273c785df229658974bafe053e6fb28595bf376d855","releaseQaEvidenceSha256":null,"minimumStableCompanyCount":41}'::jsonb);
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(to_jsonb(actual)) AS keys(k))
      IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys('{"id":"dot-cloud-native-d02f4f5-20261011","goalId":"jobfinder-portable-required-40","status":"BUILDING","version":75,"commitSha":"d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f","createdAt":"2026-10-11T10:08:08.337","rosterHash":"ac44a7c7077e23ffa5367dc4bb8a11b254feebc8a190ae7c27481c7269a5a659","schemaHash":"91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a","finalizedAt":null,"oracleVersion":"staged-official-source-v1","dbSnapshotHash":"497022f2a1458e9c2d4ce045bbdf7cfd3486c4e80125b3513a542b4c90ef0d04","sourcePlanHash":"331cc04ae9fb82aeb8001df41c720d0a308dc1402f63b612dcc924276438e1fc","sourceTreeHash":"f23a3b69c170579e58e5b3aaba09a2a4f16dcb66014f4fcd945a4ae0349b30af","runtimeTreeHash":"ff62c1961775cf079a86a96157ad3c44ab5b66b6c1829bca670582b85091ca62","migrationVersion":"20261006172300_job_projection_delta_contract","sourceConfigHash":"dce68ae12803ac1278fe2c4bac5457e63c41f58164ceeb2841322e2ee87a1ef3","adapterBundleHash":"235e54bc98a468cb73b58273c785df229658974bafe053e6fb28595bf376d855","releaseQaEvidenceSha256":null,"minimumStableCompanyCount":41}'::jsonb) AS keys(k)) THEN
    RAISE EXCEPTION 'V75_FENCE_CANDIDATE_SCHEMA_DRIFT';
  END IF;
  IF to_jsonb(actual) IS DISTINCT FROM to_jsonb(expected) THEN
    RAISE EXCEPTION 'V75_FENCE_FULL_CANDIDATE_TUPLE_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM public."CrawlBatchSourceResult"
      WHERE "releaseCandidateId" = 'dot-cloud-native-d02f4f5-20261011'
        AND "atomicCommitState"::text = 'PENDING') THEN
    RAISE EXCEPTION 'V75_FENCE_PENDING_RESULTS_EXIST';
  END IF;
  IF to_regprocedure('public.guard_v75_retired_source_publication()') IS NOT NULL OR EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'public."CrawlBatchSourceResult"'::regclass
      AND tgname = 'CrawlBatchSourceResult_v75_retired_candidate_guard') THEN
    RAISE EXCEPTION 'V75_FENCE_ALREADY_PRESENT_RECONCILE_DO_NOT_RETRY';
  END IF;
END;
$v75_preflight$;

DO $schema50_history$
BEGIN
 LOCK TABLE public."_prisma_migrations" IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT count(*) FROM public."_prisma_migrations") <> 49 OR
    (SELECT count(DISTINCT migration_name) FROM public."_prisma_migrations") <> 49 OR EXISTS (
 SELECT 1 FROM public."_prisma_migrations" m FULL JOIN jsonb_to_recordset('[{"migrationName":"20260710000000_baseline","checksum":"4fdcb581708ac58a54076042daeede1e95e0e30b70ecb44746628628899f9ea5"},{"migrationName":"20260710005000_crawl_status_values","checksum":"0b8b060cc62a6cddfac1f0ae2571abd10f05ea20fe218fa1084973443ef4985d"},{"migrationName":"20260710010000_phase1_evidence","checksum":"85cfca6b4430baaf58a168175e18446d428808d69ab14758fcc46ebed377d749"},{"migrationName":"20260710015000_completeness_pending","checksum":"323a5d11ef6f48dc5b65e4605190e11f21dac7cdf6b8f4d86aaf23d9e4e45551"},{"migrationName":"20260710020000_source_result_state_machine","checksum":"29af5ebcafa874a829be6a071a0ae7e4c00ffed22e2b1b41acd5799680014998"},{"migrationName":"20260711050000_task5g_truth_persistence","checksum":"ea4c8416dd62bb7368c9b79b0cdfe2987afa3bcc5e9726c02b482b1c553e978b"},{"migrationName":"20260711060000_transport_attempt_artifact_immutability","checksum":"74748a3e48319b6e39aead158e658ed384e54fd874eb8c9f2ea58f6c303dd454"},{"migrationName":"20260711150000_task5h_runtime_truth_closure","checksum":"046381cc43edf9551e1ebd4629c4add665556ea4d89cc2b9962cd9158df34972"},{"migrationName":"20260711210000_lifecycle_set_evidence_members","checksum":"3152d9cdf10b4d04c1b775546d1127f6d689c21179ec4907b5f77e98e7bf741d"},{"migrationName":"20260711220000_lifecycle_set_cryptographic_closure","checksum":"f7c5bacc9d558cedbbaf332ea384b8d01c635a9f94495e375df752861f2ca4c9"},{"migrationName":"20260711230000_parent_lifecycle_projection_gate","checksum":"5eece361b4d5b01f6e867ff28e2081ee1febc499c218d675b09c9331d7bf35bf"},{"migrationName":"20260711240000_lifecycle_trigger_security_closure","checksum":"5ebb0b22c7c14e02de0de0df6e5ec88de1b9e12105b2b7ea064c6532fec93d22"},{"migrationName":"20260712020000_release_runtime_identity","checksum":"a9e02aa75fda3f91831acba4893f6a9c6fb723b0e47b829acfcf29c94a5050df"},{"migrationName":"20260713010000_manual_crawl_request_ownership","checksum":"f3b2fec28c76402d95d712a9f07b532fe6368a2e23bb551310fd116aff0fca96"},{"migrationName":"20260713020000_privacy_request_retention","checksum":"0502883a5386be381be4b93f27a4968b88f7c0cb9cb71f79069eeddff083c09d"},{"migrationName":"20260713030000_manual_crawl_preview_isolation","checksum":"76ee502c2329ff180e61b0e1ee6081bb2f6a6925baa950b639ef32b72b8789c9"},{"migrationName":"20260713035000_quarantine_legacy_unbound_manual_batches","checksum":"dc44a8720be3980d8350871a6c7ba39dee6e59897954caed9b1c27dcd4eeceb5"},{"migrationName":"20260713040000_manual_batch_binding_and_kind_immutability","checksum":"f80a08566fa3d6a891551cf6a2c04c8d4cd04ecf56748527d20c518da711ed17"},{"migrationName":"20260713050000_ai_enrichment_persistence","checksum":"99760a680cf3e8109c06f36e1f3ec09ac6d636c017d2fb7a1edac1a5bc612864"},{"migrationName":"20260714053000_repair_legacy_offline_count_two","checksum":"9f0d24e3e69c62194212b73028b2ce189da3921120eec28d4019d98cb5008c64"},{"migrationName":"20260715090000_atomic_evidence_commit_scaling","checksum":"3ba00cb12be5b70f71b421f010ece0e21d9fd0dda451e8b882a499bd5a3bfb2b"},{"migrationName":"20260716190000_release_candidate_qualification_threshold","checksum":"3b359a8c7d66128a849b651644bf79598a28394fdb7ec98c22c6cadbf860c220"},{"migrationName":"20260716210000_release_candidate_promotion_gate","checksum":"aade090681832348f44f8002f9cf64dad79f64db991637a5c39f5d8675d3b54e"},{"migrationName":"20260717090000_source_failure_diagnostics","checksum":"c1d858486c56a41ddbc46489ae39a3a221234a33951ddbd96685a18cf393a02f"},{"migrationName":"20260812231000_a_grade_completeness_certificate","checksum":"57e5d92b5520bce6817dbf067001037e596ae09fdf01d34a47af656aa12b3fc7"},{"migrationName":"20260813002000_trusted_completeness_baseline","checksum":"c9067ade70b02c5204f988604c273db34a1a94d0c0b4d84fe9d99955b743fb11"},{"migrationName":"20260813013000_transport_policy_retry_diagnostics","checksum":"49d2bbec31985956304c829818ccd3d2b0279dfeef6be88555ce7d224e5c8e69"},{"migrationName":"20260824070000_official_network_retry_diagnostics","checksum":"522f1d52846568579dd56896c99d83680e528de525a21424892599a2533a338c"},{"migrationName":"20260825093000_browser_and_pagination_retry_diagnostics","checksum":"31656155cad70ac5a841b4b022c11c27056d0fa2d2cc7c80e17bea710158d6c6"},{"migrationName":"20260825113000_failed_source_diagnostic_evidence","checksum":"f4af5d9b982e42c55f53d415baac1934568ed2b587b3e27fa186d194d6a2e514"},{"migrationName":"20260902090000_jnj_and_grifols_atomic_persistence","checksum":"6897c9b49f215383954f0c7326574dfd0fb2f6944bfd8bf9a5b6a30b79fc1296"},{"migrationName":"20260902093000_grifols_trigger_artifact_binding","checksum":"8f997add3cf96d44e188f4fdab71e54a7896336e2c09fb9f79e1748d697ac645"},{"migrationName":"20260902094500_a_grade_official_total_dedupe","checksum":"1d7be8f1fe26e033478694687963a805281af61de6575222ecc40335cd721ad9"},{"migrationName":"20260902095500_boehringer_verified_ui_exclusions","checksum":"f6ad25e94c6a8971f4545880e20037c6eb3814c130f51c926ea6886568c5f06b"},{"migrationName":"20260927110000_crawl_coordinator_table_lock","checksum":"5b8c19c744abe771124f4f0a9e7f985e34693ab05dc7a50da87d77b2bb69ca0c"},{"migrationName":"20260927120000_p0_launch_cohort_41_companies","checksum":"17b71a51cb5fd63575e7f04ac9f51fe9af72c85d70dd8badb5430ed259606c4d"},{"migrationName":"20261001120000_portable_source_quality_policy","checksum":"efabdfad4df69d179a252d12781c320475b1e17e038d918243bc195c2e15b496"},{"migrationName":"20261001151000_portable_loss_position_identity","checksum":"6d8d551d9725348aef46c95ebcae876c82fcd77186495c73f9e8a7c29c2bcbba"},{"migrationName":"20261001163000_portable_zero_based_loss_pages","checksum":"5b4bce23e62c78a198c011a0eba37f80f90fb03b0e9591d888188d9c15d224bf"},{"migrationName":"20261001174000_astellas_pdf_city_policy","checksum":"d01d1b7099c4de2c05d234a7a22fd7278f5dc3b8c1fd982613bf2b068f4fca50"},{"migrationName":"20261001181500_abbvie_reviewed_row_policy","checksum":"b26a25ae30ca08a2beeb60ac72238218543296e2c1bb691e8d811c46965bdc82"},{"migrationName":"20261001233000_verified_date_source_policy","checksum":"865a0dce5252e52614aef3232822e1f2acd7b42b26b8df629fe470b34e8b1713"},{"migrationName":"20261002001500_bms_mainland_geography_policy","checksum":"9ec3df9622f42d48b8472ee6e3bcd7421b0b0f7f0ae480e81d4ae7041636c791"},{"migrationName":"20261002011500_city_pending_source_policies","checksum":"35607b7bf3fd71424144c5958a8dfaedbca2bcfe69a63d55b43449f964d69774"},{"migrationName":"20261002020000_gilead_novo_source_policies","checksum":"fd24e0f031f9a34cb8ca1ef7c57703795735ddc386e5c0c62a8e3d175b73f18c"},{"migrationName":"20261002093322_novo_native_application_policy","checksum":"d0bc0f9092560bad7d0f77fde63b0df2db1cbc512f3babaf3bdd3328291c834d"},{"migrationName":"20261002101515_organon_source_policy","checksum":"96bb2c79d1bc4cdcaeeddb1e994b826cd7287f2de3654807c64aea3b2f8f214e"},{"migrationName":"20261003055000_jnj_dom_evidence_admission","checksum":"5b3c8bc039960433709fc7cd1c9d66b6d939c7a7068c00d4b304d4b4ea5e17ac"},{"migrationName":"20261006172300_job_projection_delta_contract","checksum":"25e30c2075a4116220a2d5f0765a076381d7cb219a94f1276c414164dc122c31"}]'::jsonb)
 e("migrationName" text,checksum text) ON m.migration_name=e."migrationName"
 WHERE m.migration_name IS NULL OR e."migrationName" IS NULL OR m.checksum IS DISTINCT FROM e.checksum
 OR m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL) THEN
 RAISE EXCEPTION 'SCHEMA50_PRIOR_HISTORY_DRIFT'; END IF;
 PERFORM set_config('jobfinder.schema50_started_at',clock_timestamp()::text,true);
END;
$schema50_history$;

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

-- Honest bookkeeping for canonical DDL executed by this connector transaction.
-- This is NOT a receipt claiming that Prisma's migration engine ran.
INSERT INTO public."_prisma_migrations"
 (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
VALUES (gen_random_uuid()::text,'b7c868b224ce1f13789f6f2cdcebafe95f1b2d83da1ac037d9a298cff79e3284',clock_timestamp(),'20261014141000_v75_retired_candidate_fence',
 '{"appliedBy":"official-connector","execution":"canonical-ddl-in-this-transaction","prismaEngineExecuted":false}',
 NULL,current_setting('jobfinder.schema50_started_at')::timestamptz,1);

DO $v75_retire$
DECLARE affected bigint;
BEGIN
  UPDATE public."ReleaseCandidate" SET status = 'INVALIDATED'
    WHERE id = 'dot-cloud-native-d02f4f5-20261011' AND "goalId" = 'jobfinder-portable-required-40'
      AND version = 75 AND "commitSha" = 'd02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f' AND status = 'BUILDING';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'V75_FENCE_RETIRE_COUNT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public."CrawlBatchSourceResult"'::regclass
        AND tgname = 'CrawlBatchSourceResult_v75_retired_candidate_guard' AND tgenabled = 'O'
        AND tgfoid = 'public.guard_v75_retired_source_publication()'::regprocedure) THEN
    RAISE EXCEPTION 'V75_FENCE_TRIGGER_NOT_ACTIVE';
  END IF;
END;
$v75_retire$;
-- Caller must COMMIT once and then verify with a separate official read.
-- A pre-COMMIT result is not a commit receipt. Unknown outcome must not be retried.

COMMIT;
