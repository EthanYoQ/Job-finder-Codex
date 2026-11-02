-- Extend the restored current trigger; do not replay historical Prisma migrations.
DO $patch$
DECLARE current_definition text := pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure);
BEGIN
  IF md5(current_definition) <> '9631f44b9ad3715a45f878adebb59576' THEN
    RAISE EXCEPTION 'Source terminal trigger changed; inspect before applying';
  END IF;
  EXECUTE replace(current_definition,$anchor$                    OR (
                        NEW."sourceId" = 'source-boehringer-ingelheim-china-social' AND$anchor$,$replacement$                    OR (
                        -- Lilly's original application can close while its search listing remains visible.
                        NEW."sourceId" = 'source-lilly-china-social' AND
                        NEW."completenessCertificate"->>'schemaVersion' = 'a-grade-official-total-v2' AND
                        NEW."completenessCertificate"->>'grade' = 'A' AND
                        NEW."completenessCertificate"->'binding' @> jsonb_build_object(
                          'releaseCandidateId',NEW."releaseCandidateId",'batchId',NEW."batchId",'sourceId',NEW."sourceId",'sourceResultId',NEW."id") AND
                        NEW."parseDiscardCount" = 0 AND NEW."normalizationDiscardCount" = 0 AND
                        NEW."dedupeDiscardCount" = 0 AND NEW."collisionCount" = 0 AND NEW."validationDiscardCount" > 0 AND
                        NEW."discardCount" = NEW."validationDiscardCount" AND
                        NEW."rawCount" = NEW."expectedJobCount" AND NEW."parsedCount" = NEW."rawCount" AND
                        NEW."validCount" = NEW."dedupeOutputCount" AND NEW."normalizedCount" = NEW."validCount" AND
                        NEW."dedupeInputCount" = NEW."validCount" AND
                        NEW."expectedJobCount" = NEW."dedupeOutputCount" + NEW."validationDiscardCount" AND
                        NEW."adapterInputCount" = NEW."dedupeInputCount" AND NEW."adapterOutputCount" = NEW."dedupeOutputCount" AND
                        NEW."adapterLossCount" = 0 AND NEW."adapterCollisionGroupCount" = 0 AND
                        NEW."completenessCertificate"->'counts' @> jsonb_build_object(
                          'officialTotal',NEW."expectedJobCount",'rawObservationCount',NEW."rawCount",
                          'finalUniqueJobCount',NEW."dedupeOutputCount",'validationDiscardCount',NEW."validationDiscardCount",'legalDedupeCount',0) AND
                        jsonb_array_length(NEW."completenessCertificate"->'legalScopeExclusionLedger') = NEW."validationDiscardCount" AND
                        (SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id") = NEW."validationDiscardCount" AND
                        (SELECT count(DISTINCT loss."rawLocator") FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id") = NEW."validationDiscardCount" AND
                        NOT EXISTS (SELECT 1 FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND (
                          loss."releaseCandidateId" = NEW."releaseCandidateId" AND loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                          loss."stage" = 'VALIDATION' AND loss."details"->>'code' = 'LILLY_OFFICIAL_APPLICATION_CLOSED' AND
                          loss."candidateKey" IS NULL AND loss."winnerKey" IS NULL AND
                          NEW."completenessCertificate"->'legalScopeExclusionLedger' @> jsonb_build_array(jsonb_build_object(
                            'code','LILLY_OFFICIAL_APPLICATION_CLOSED','rawLocatorSha256',encode(sha256(convert_to(loss."rawLocator",'UTF8')),'hex')))
                        ) IS NOT TRUE)
                    ) IS TRUE
                    OR (
                        NEW."sourceId" = 'source-boehringer-ingelheim-china-social' AND$replacement$);
  IF md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) <> '0dc54c655f4b5d8c68c5e90e737e40fc' THEN
    RAISE EXCEPTION 'Source terminal trigger readback mismatch';
  END IF;
END
$patch$;
