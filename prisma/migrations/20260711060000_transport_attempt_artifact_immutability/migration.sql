CREATE OR REPLACE FUNCTION prevent_transport_attempt_artifact_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'TransportAttemptArtifact is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "TransportAttemptArtifact_immutable" BEFORE UPDATE OR DELETE ON "TransportAttemptArtifact"
FOR EACH ROW EXECUTE FUNCTION prevent_transport_attempt_artifact_mutation();

CREATE OR REPLACE FUNCTION require_transport_attempt_artifact_ref() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "TransportAttemptArtifact" WHERE "attemptId" = NEW."id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'TransportAttemptEvidence_nonempty_refs',
      MESSAGE = 'TransportAttemptEvidence requires at least one immutable artifact reference';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "TransportAttemptEvidence_nonempty_refs"
AFTER INSERT ON "TransportAttemptEvidence" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_transport_attempt_artifact_ref();
