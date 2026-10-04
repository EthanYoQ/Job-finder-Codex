-- P0 Launch Cohort: Remove 19 non-launch companies and their recruitment sources.
-- Product scope is 41 companies (P0_LAUNCH_MANIFEST, cohortId p0-human-verified-41-v1).
-- This migration is fail-closed: every precondition is asserted, any violation aborts the transaction.
-- Pre-verified 2026-09-27: 19 companies have 0 jobs and 0 downstream evidence; only Company + RecruitmentSource rows exist.

DO $$
DECLARE
  v_job_count integer;
  v_downstream_count integer;
  v_target_company_count integer;
  v_source_count_before integer;
  v_deleted_sources integer;
  v_deleted_companies integer;
  v_final_company_count integer;
  v_final_job_count integer;
BEGIN
  -- Guard 1: the 19 non-launch companies must have 0 jobs.
  SELECT COUNT(*) INTO v_job_count FROM "Job" WHERE "companyId" IN (
    'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
    'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
    'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
    'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
    'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'
  );
  IF v_job_count <> 0 THEN
    RAISE EXCEPTION 'P0_LAUNCH_COHORT_41 ABORT: % jobs reference non-launch companies (expected 0). Refusing to delete companies with real job data.', v_job_count;
  END IF;

  -- Guard 2: all downstream evidence tables must have 0 rows referencing the 19 companies' sources.
  SELECT COUNT(*) INTO v_downstream_count FROM (
    SELECT 1 FROM "CrawlObservation" WHERE "sourceId" IN (SELECT "id" FROM "RecruitmentSource" WHERE "companyId" IN (
      'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
      'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
      'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
      'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
      'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'))
    UNION ALL
    SELECT 1 FROM "CrawlBatchSourceResult" WHERE "sourceId" IN (SELECT "id" FROM "RecruitmentSource" WHERE "companyId" IN (
      'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
      'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
      'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
      'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
      'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'))
    UNION ALL
    SELECT 1 FROM "EvidenceArtifact" WHERE "sourceId" IN (SELECT "id" FROM "RecruitmentSource" WHERE "companyId" IN (
      'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
      'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
      'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
      'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
      'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'))
    UNION ALL
    SELECT 1 FROM "PaginationEvidence" WHERE "sourceId" IN (SELECT "id" FROM "RecruitmentSource" WHERE "companyId" IN (
      'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
      'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
      'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
      'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
      'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'))
    UNION ALL
    SELECT 1 FROM "LossLedgerEntry" WHERE "sourceId" IN (SELECT "id" FROM "RecruitmentSource" WHERE "companyId" IN (
      'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
      'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
      'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
      'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
      'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'))
    UNION ALL
    SELECT 1 FROM "TransportAttemptEvidence" WHERE "sourceId" IN (SELECT "id" FROM "RecruitmentSource" WHERE "companyId" IN (
      'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
      'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
      'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
      'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
      'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'))
    UNION ALL
    SELECT 1 FROM "ManualCrawlRequest" WHERE "sourceId" IN (SELECT "id" FROM "RecruitmentSource" WHERE "companyId" IN (
      'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
      'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
      'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
      'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
      'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'))
  ) AS downstream;
  IF v_downstream_count <> 0 THEN
    RAISE EXCEPTION 'P0_LAUNCH_COHORT_41 ABORT: % downstream evidence rows reference non-launch sources (expected 0). Refusing to delete real evidence.', v_downstream_count;
  END IF;

  -- Guard 3: exactly the 19 target companies must exist.
  SELECT COUNT(*) INTO v_target_company_count FROM "Company" WHERE "id" IN (
    'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
    'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
    'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
    'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
    'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'
  );
  IF v_target_company_count <> 19 THEN
    RAISE EXCEPTION 'P0_LAUNCH_COHORT_41 ABORT: found % of the 19 target companies (expected exactly 19).', v_target_company_count;
  END IF;

  -- Snapshot source count for exact-delete verification.
  SELECT COUNT(*) INTO v_source_count_before FROM "RecruitmentSource" WHERE "companyId" IN (
    'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
    'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
    'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
    'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
    'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'
  );

  -- Delete RecruitmentSources for the 19 non-launch companies first (FK constraint).
  DELETE FROM "RecruitmentSource" WHERE "companyId" IN (
    'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
    'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
    'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
    'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
    'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'
  );
  GET DIAGNOSTICS v_deleted_sources = ROW_COUNT;
  IF v_deleted_sources <> v_source_count_before THEN
    RAISE EXCEPTION 'P0_LAUNCH_COHORT_41 ABORT: deleted % sources but % existed before delete.', v_deleted_sources, v_source_count_before;
  END IF;

  -- Delete the 19 non-launch Company rows.
  DELETE FROM "Company" WHERE "id" IN (
    'company-3sbio','company-apeloa','company-buchang','company-changchun-high-tech',
    'company-dongyangguang','company-gphl','company-huahai','company-humanwell',
    'company-jimin-kexin','company-livzon','company-lunan','company-nhu',
    'company-north-china-pharma','company-sinopharm','company-tianjin-pharma',
    'company-tongrentang','company-xinhua-pharma','company-xiuzheng','company-yangzijiang'
  );
  GET DIAGNOSTICS v_deleted_companies = ROW_COUNT;
  IF v_deleted_companies <> 19 THEN
    RAISE EXCEPTION 'P0_LAUNCH_COHORT_41 ABORT: deleted % companies (expected exactly 19).', v_deleted_companies;
  END IF;

  -- Guard 4: final company count must be exactly 41.
  SELECT COUNT(*) INTO v_final_company_count FROM "Company";
  IF v_final_company_count <> 41 THEN
    RAISE EXCEPTION 'P0_LAUNCH_COHORT_41 ABORT: final company count is % (expected exactly 41).', v_final_company_count;
  END IF;

  -- Guard 5: report final job total (all 3189 jobs belong to launch companies; unchanged expected).
  SELECT COUNT(*) INTO v_final_job_count FROM "Job";

  RAISE NOTICE 'P0_LAUNCH_COHORT_41 OK: deleted % companies and % sources; companies now %, jobs %.',
    v_deleted_companies, v_deleted_sources, v_final_company_count, v_final_job_count;
END $$;
