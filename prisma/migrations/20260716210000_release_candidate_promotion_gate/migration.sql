ALTER TABLE "ReleaseCandidate"
  ADD COLUMN "releaseQaEvidenceSha256" TEXT,
  ADD CONSTRAINT "ReleaseCandidate_release_qa_evidence_hash_format_check"
    CHECK ("releaseQaEvidenceSha256" IS NULL OR "releaseQaEvidenceSha256" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION "prevent_release_candidate_identity_mutation"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."goalId" IS DISTINCT FROM NEW."goalId" OR OLD."version" IS DISTINCT FROM NEW."version" OR
       OLD."commitSha" IS DISTINCT FROM NEW."commitSha" OR OLD."dbSnapshotHash" IS DISTINCT FROM NEW."dbSnapshotHash" OR
       OLD."schemaHash" IS DISTINCT FROM NEW."schemaHash" OR OLD."migrationVersion" IS DISTINCT FROM NEW."migrationVersion" OR
       OLD."rosterHash" IS DISTINCT FROM NEW."rosterHash" OR OLD."sourcePlanHash" IS DISTINCT FROM NEW."sourcePlanHash" OR
       OLD."sourceConfigHash" IS DISTINCT FROM NEW."sourceConfigHash" OR OLD."adapterBundleHash" IS DISTINCT FROM NEW."adapterBundleHash" OR
       OLD."oracleVersion" IS DISTINCT FROM NEW."oracleVersion" OR OLD."sourceTreeHash" IS DISTINCT FROM NEW."sourceTreeHash" OR
       OLD."runtimeTreeHash" IS DISTINCT FROM NEW."runtimeTreeHash" OR
       OLD."minimumStableCompanyCount" IS DISTINCT FROM NEW."minimumStableCompanyCount" THEN
        RAISE EXCEPTION 'ReleaseCandidate identity fields are immutable';
    END IF;

    IF OLD."status" IS DISTINCT FROM NEW."status" THEN
        IF NOT (
          (OLD."status" = 'TRUST_FREEZE' AND NEW."status" IN ('BUILDING', 'INVALIDATED')) OR
          (OLD."status" = 'BUILDING' AND NEW."status" IN ('READY_FOR_QA', 'INVALIDATED')) OR
          (OLD."status" = 'READY_FOR_QA' AND NEW."status" IN ('RELEASED', 'QA_FAILED', 'INVALIDATED'))
        ) THEN
          RAISE EXCEPTION 'ReleaseCandidate status transition is not allowed';
        END IF;
    END IF;

    IF OLD."status" = 'READY_FOR_QA' AND NEW."status" = 'RELEASED' THEN
        IF NEW."releaseQaEvidenceSha256" IS NULL OR
           NEW."releaseQaEvidenceSha256" !~ '^[0-9a-f]{64}$' OR
           NEW."finalizedAt" IS NULL THEN
          RAISE EXCEPTION 'Released ReleaseCandidate requires bound QA evidence and finalization time';
        END IF;
    ELSIF OLD."releaseQaEvidenceSha256" IS DISTINCT FROM NEW."releaseQaEvidenceSha256" OR
          OLD."finalizedAt" IS DISTINCT FROM NEW."finalizedAt" THEN
        RAISE EXCEPTION 'ReleaseCandidate QA evidence and finalization time are immutable outside release promotion';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
