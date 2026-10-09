/** Exact local candidate files, not a production schema/registration claim. */
export const JOB_DELTA_MIGRATION_NAME = "20261006172300_job_projection_delta_contract" as const;
export const JOB_DELTA_MIGRATION_SHA256 = "25e30c2075a4116220a2d5f0765a076381d7cb219a94f1276c414164dc122c31";
export const JOB_DELTA_SOURCE_GUARD_PROSRC_SHA256 = "54f635d262fcadb964cee91ea8ff348125669bdc773705291569f35dd9ddbcdb";
export const JOB_DELTA_FUNCTION_MD5 = {
  "public.enforce_source_result_state_machine()": "fac1516db472af363ce52bca410e92a0",
  "public.job_projection_canonical_json(jsonb)": "7e74cc83d45888cbf901dbde1dc3c006",
  "public.job_persisted_projection_sha256(public.\"Job\")": "3e3a68a0e2265d6fbd7d7fbce6244093",
  "public.job_delta_effective_legacy_certificate(jsonb,text,jsonb,timestamp without time zone)": "e77cc7f32b6675e8c5f964fe6811281f",
  "public.validate_job_delta_commit_projection()": "8d08bb641673587662dff4e429443aa5"
} as const;
export const JOB_DELTA_BASELINE_CHECK_MD5 = "fa582a6ef2ad17d1df23dfc1041032d2";
export const JOB_DELTA_TRIGGER_PROFILES = [
  {
    "name": "CrawlBatchSourceResult_delta_commit_projection",
    "tableName": "CrawlBatchSourceResult",
    "md5": "4d2b7e20e63a99eca78b443a876f9ce7"
  },
  {
    "name": "CrawlBatchSourceResult_verified_lifecycle_projection",
    "tableName": "CrawlBatchSourceResult",
    "md5": "606aa7f3f18e236896f46fa4a36c7d88"
  },
  {
    "name": "LifecycleSetEvidenceMember_exact_projection",
    "tableName": "LifecycleSetEvidenceMember",
    "md5": "29e4f477e8eb6fc9999cd13d8fe276cd"
  },
  {
    "name": "TransportAttemptEvidence_nonempty_refs",
    "tableName": "TransportAttemptEvidence",
    "md5": "0ae792e1b0a4b3227643081e9c6302b3"
  }
] as const;
