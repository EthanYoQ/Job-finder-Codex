-- The 51job API total includes rows that its own recruitment UI excludes.
-- Accept the difference only when the source-bound B certificate and every
-- exact OFFICIAL_UI_EXCLUSION ledger row reconcile to that difference.
DO $repair$
DECLARE
    definition TEXT;
    repaired TEXT;
    old_fragment TEXT := $old$                        NOT EXISTS (
                          SELECT 1 FROM "LossLedgerEntry" loss
                          WHERE loss."sourceResultId" = NEW."id" AND
                                loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                                loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                                (loss."stage" <> 'DEDUPE' OR loss."candidateKey" IS NULL OR loss."winnerKey" IS NULL)
                        )
                    )
                ) THEN$old$;
    new_fragment TEXT := $new$                        NOT EXISTS (
                          SELECT 1 FROM "LossLedgerEntry" loss
                          WHERE loss."sourceResultId" = NEW."id" AND
                                loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                                loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                                (loss."stage" <> 'DEDUPE' OR loss."candidateKey" IS NULL OR loss."winnerKey" IS NULL)
                        )
                    )
                    OR (
                        NEW."sourceId" = 'source-boehringer-ingelheim-china-social' AND
                        NEW."completenessCertificate" IS NOT NULL AND
                        NEW."completenessCertificateSha256" IS NOT NULL AND
                        NEW."completenessCertificate"->>'schemaVersion' = 'b-grade-independent-traversal-v2' AND
                        NEW."completenessCertificate"->>'grade' = 'B' AND
                        NEW."completenessCertificate"->'binding'->>'sourceId' = NEW."sourceId" AND
                        NEW."parseDiscardCount" = 0 AND NEW."validationDiscardCount" > 0 AND
                        NEW."normalizationDiscardCount" = 0 AND NEW."dedupeDiscardCount" = 0 AND
                        NEW."collisionCount" = 0 AND NEW."discardCount" = NEW."validationDiscardCount" AND
                        NEW."rawCount" = NEW."expectedJobCount" AND NEW."parsedCount" = NEW."rawCount" AND
                        NEW."validCount" = NEW."rawCount" - NEW."validationDiscardCount" AND
                        NEW."normalizedCount" = NEW."validCount" AND
                        NEW."dedupeInputCount" = NEW."validCount" AND
                        NEW."dedupeOutputCount" = NEW."validCount" AND
                        NEW."expectedJobCount" = NEW."dedupeOutputCount" + NEW."validationDiscardCount" AND
                        NEW."adapterInputCount" = NEW."dedupeInputCount" AND
                        NEW."adapterOutputCount" = NEW."dedupeOutputCount" AND NEW."adapterLossCount" = 0 AND
                        NEW."adapterCollisionGroupCount" = 0 AND
                        NEW."completenessCertificate"->'counts'->'validationDiscardCount' =
                          to_jsonb(NEW."validationDiscardCount") AND
                        NEW."completenessCertificate"->'counts'->'finalUniqueJobCount' =
                          to_jsonb(NEW."dedupeOutputCount") AND
                        (SELECT count(*) FROM "LossLedgerEntry" loss
                         WHERE loss."sourceResultId" = NEW."id" AND
                               loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                               loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId") =
                          NEW."validationDiscardCount" AND
                        (SELECT count(DISTINCT loss."details"->>'recordIndex') FROM "LossLedgerEntry" loss
                         WHERE loss."sourceResultId" = NEW."id" AND
                               loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                               loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId") =
                          NEW."validationDiscardCount" AND
                        NOT EXISTS (
                          SELECT 1 FROM "LossLedgerEntry" loss
                          WHERE loss."sourceResultId" = NEW."id" AND
                                loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                                loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                                (loss."stage" <> 'VALIDATION' OR
                                 loss."reason" <> '51job record excluded by official recruitment UI' OR
                                 loss."rawLocator" !~ '^official-json-page-0000#record:[0-9]+#sha256:[0-9a-f]{64}$' OR
                                 loss."details"->>'code' <> 'OFFICIAL_UI_EXCLUSION' OR
                                 loss."details"->>'recordIndex' !~ '^[0-9]+$')
                        )
                    )
                ) THEN$new$;
BEGIN
    SELECT pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)
    INTO definition;

    IF position(old_fragment IN definition) = 0 THEN
        RAISE EXCEPTION 'enforce_source_result_state_machine B-grade official UI fragment was not found';
    END IF;
    repaired := replace(definition, old_fragment, new_fragment);
    IF repaired = definition OR position(old_fragment IN repaired) <> 0 THEN
        RAISE EXCEPTION 'enforce_source_result_state_machine B-grade official UI repair did not apply exactly';
    END IF;

    EXECUTE repaired;
END;
$repair$;
