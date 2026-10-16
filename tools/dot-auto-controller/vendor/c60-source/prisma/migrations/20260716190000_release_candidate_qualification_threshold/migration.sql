ALTER TABLE "ReleaseCandidate"
  ADD COLUMN "minimumStableCompanyCount" INTEGER NOT NULL DEFAULT 45,
  ADD CONSTRAINT "ReleaseCandidate_minimum_stable_company_count_check"
    CHECK ("minimumStableCompanyCount" BETWEEN 1 AND 60);

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
    IF OLD."status" = 'INVALIDATED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
        RAISE EXCEPTION 'Invalidated ReleaseCandidate is terminal';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
