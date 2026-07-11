ALTER TABLE "ReleaseCandidate"
  ADD COLUMN "sourceTreeHash" TEXT,
  ADD COLUMN "runtimeTreeHash" TEXT;

UPDATE "ReleaseCandidate"
SET "status" = 'INVALIDATED',
    "sourceTreeHash" = repeat('0', 64),
    "runtimeTreeHash" = repeat('0', 64)
WHERE "sourceTreeHash" IS NULL OR "runtimeTreeHash" IS NULL;

ALTER TABLE "ReleaseCandidate"
  ADD CONSTRAINT "ReleaseCandidate_tree_hash_format_check"
    CHECK ("sourceTreeHash" ~ '^[0-9a-f]{64}$' AND "runtimeTreeHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "ReleaseCandidate_release_tree_not_legacy_check"
    CHECK ("status" NOT IN ('READY_FOR_QA', 'RELEASED') OR
      ("sourceTreeHash" <> repeat('0', 64) AND "runtimeTreeHash" <> repeat('0', 64))),
  ALTER COLUMN "sourceTreeHash" SET NOT NULL,
  ALTER COLUMN "runtimeTreeHash" SET NOT NULL;

CREATE OR REPLACE FUNCTION "prevent_release_candidate_identity_mutation"() RETURNS TRIGGER AS $$
BEGIN
    IF OLD."goalId" IS DISTINCT FROM NEW."goalId" OR OLD."version" IS DISTINCT FROM NEW."version" OR
       OLD."commitSha" IS DISTINCT FROM NEW."commitSha" OR OLD."dbSnapshotHash" IS DISTINCT FROM NEW."dbSnapshotHash" OR
       OLD."schemaHash" IS DISTINCT FROM NEW."schemaHash" OR OLD."migrationVersion" IS DISTINCT FROM NEW."migrationVersion" OR
       OLD."rosterHash" IS DISTINCT FROM NEW."rosterHash" OR OLD."sourcePlanHash" IS DISTINCT FROM NEW."sourcePlanHash" OR
       OLD."sourceConfigHash" IS DISTINCT FROM NEW."sourceConfigHash" OR OLD."adapterBundleHash" IS DISTINCT FROM NEW."adapterBundleHash" OR
       OLD."oracleVersion" IS DISTINCT FROM NEW."oracleVersion" OR OLD."sourceTreeHash" IS DISTINCT FROM NEW."sourceTreeHash" OR
       OLD."runtimeTreeHash" IS DISTINCT FROM NEW."runtimeTreeHash" THEN
        RAISE EXCEPTION 'ReleaseCandidate identity fields are immutable';
    END IF;
    IF OLD."status" = 'INVALIDATED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
        RAISE EXCEPTION 'Invalidated ReleaseCandidate is terminal';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;
