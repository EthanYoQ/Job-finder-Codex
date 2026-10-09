-- An A-grade official-total certificate already records deterministic adapter
-- dedupe as a legal, hashed ledger. Preserve the official raw total while
-- allowing the terminal unique-job count to be lower by exactly those rows.
DO $repair$
DECLARE
    definition TEXT;
    repaired TEXT;
    old_fragment TEXT := $old$                    grifols_detail_artifact_count >= NEW."validationDiscardCount"
                ) THEN$old$;
    new_fragment TEXT := $new$                    grifols_detail_artifact_count >= NEW."validationDiscardCount"
                    OR (
                        NEW."completenessCertificate" IS NOT NULL AND
                        NEW."completenessCertificateSha256" IS NOT NULL AND
                        NEW."completenessCertificate"->>'schemaVersion' = 'a-grade-official-total-v2' AND
                        NEW."completenessCertificate"->>'grade' = 'A' AND
                        NEW."parseDiscardCount" = 0 AND NEW."validationDiscardCount" = 0 AND
                        NEW."normalizationDiscardCount" = 0 AND NEW."dedupeDiscardCount" > 0 AND
                        NEW."collisionCount" > 0 AND NEW."discardCount" = NEW."dedupeDiscardCount" AND
                        NEW."rawCount" = NEW."expectedJobCount" AND
                        NEW."parsedCount" = NEW."rawCount" AND NEW."validCount" = NEW."rawCount" AND
                        NEW."normalizedCount" = NEW."rawCount" AND NEW."dedupeInputCount" = NEW."rawCount" AND
                        NEW."expectedJobCount" = NEW."dedupeOutputCount" + NEW."dedupeDiscardCount" AND
                        NEW."adapterInputCount" = NEW."dedupeInputCount" AND
                        NEW."adapterOutputCount" = NEW."dedupeOutputCount" AND
                        NEW."adapterLossCount" = NEW."dedupeDiscardCount" AND
                        NEW."adapterCollisionGroupCount" = NEW."collisionCount" AND
                        NEW."completenessCertificate"->'counts'->'officialTotal' = to_jsonb(NEW."expectedJobCount") AND
                        NEW."completenessCertificate"->'counts'->'rawObservationCount' = to_jsonb(NEW."rawCount") AND
                        NEW."completenessCertificate"->'counts'->'legalDedupeCount' = to_jsonb(NEW."dedupeDiscardCount") AND
                        NEW."completenessCertificate"->'counts'->'finalUniqueJobCount' = to_jsonb(NEW."dedupeOutputCount") AND
                        (SELECT count(*) FROM "LossLedgerEntry" loss
                         WHERE loss."sourceResultId" = NEW."id" AND
                               loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                               loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId") =
                          NEW."dedupeDiscardCount" AND
                        (SELECT count(DISTINCT loss."winnerKey") FROM "LossLedgerEntry" loss
                         WHERE loss."sourceResultId" = NEW."id" AND
                               loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                               loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                               loss."stage" = 'DEDUPE' AND loss."candidateKey" IS NOT NULL AND
                               loss."winnerKey" IS NOT NULL) = NEW."collisionCount" AND
                        NOT EXISTS (
                          SELECT 1 FROM "LossLedgerEntry" loss
                          WHERE loss."sourceResultId" = NEW."id" AND
                                loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                                loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                                (loss."stage" <> 'DEDUPE' OR loss."candidateKey" IS NULL OR loss."winnerKey" IS NULL)
                        )
                    )
                ) THEN$new$;
BEGIN
    SELECT pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)
    INTO definition;

    IF position(old_fragment IN definition) = 0 THEN
        RAISE EXCEPTION 'enforce_source_result_state_machine official-total fragment was not found';
    END IF;
    repaired := replace(definition, old_fragment, new_fragment);
    IF repaired = definition OR position(old_fragment IN repaired) <> 0 THEN
        RAISE EXCEPTION 'enforce_source_result_state_machine A-grade dedupe repair did not apply exactly';
    END IF;

    EXECUTE repaired;
END;
$repair$;
