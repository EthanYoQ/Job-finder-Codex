-- Extend the current terminal trigger; keep the original transaction and source proofs.
DO $patch$
DECLARE
  definition text := pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure);
  anchor text := $anchor$                    OR (
                        NEW."sourceId" = 'source-lilly-china-social' AND$anchor$;
  addition text := $addition$                    -- BEGIN JOB QUARANTINE TOTAL
                    OR (
                        NEW."completenessCertificate"->>'schemaVersion' = 'a-grade-official-total-v2' AND
                        NEW."completenessCertificate"->>'grade' = 'A' AND
                        NEW."completenessCertificate"->'binding' = jsonb_build_object(
                          'releaseCandidateId',NEW."releaseCandidateId",'batchId',NEW."batchId",'sourceId',NEW."sourceId",
                          'sourceResultId',NEW."id",'sourceConfigSha256',NEW."sourceConfigHash") AND
                        NEW."completenessCertificate"->'scope'->>'sourceId' = NEW."sourceId" AND
                        EXISTS (SELECT 1 FROM "RecruitmentSource" s WHERE s."id"=NEW."sourceId" AND
                          s."companyId"=NEW."completenessCertificate"->'scope'->>'companyId') AND
                        NEW."rawCount" = NEW."expectedJobCount" AND NEW."parsedCount" = NEW."rawCount" AND
                        NEW."validCount" = NEW."dedupeOutputCount" AND NEW."normalizedCount" = NEW."validCount" AND
                        NEW."dedupeInputCount" = NEW."validCount" AND NEW."parseDiscardCount"=0 AND
                        NEW."normalizationDiscardCount"=0 AND NEW."dedupeDiscardCount"=0 AND NEW."collisionCount"=0 AND
                        NEW."validationDiscardCount">0 AND NEW."discardCount"=NEW."validationDiscardCount" AND
                        NEW."expectedJobCount"=NEW."dedupeOutputCount"+NEW."validationDiscardCount" AND
                        NEW."adapterInputCount"=NEW."validCount" AND NEW."adapterOutputCount"=NEW."validCount" AND
                        NEW."adapterLossCount"=0 AND NEW."adapterCollisionGroupCount"=0 AND
                        NEW."completenessCertificate"->'counts' @> jsonb_build_object(
                          'officialTotal',NEW."expectedJobCount",'rawObservationCount',NEW."rawCount",
                          'parsedCount',NEW."parsedCount",'validCount',NEW."validCount",'normalizedCount',NEW."normalizedCount",
                          'dedupeInputCount',NEW."dedupeInputCount",'finalUniqueJobCount',NEW."dedupeOutputCount",
                          'validationDiscardCount',NEW."validationDiscardCount",'legalDedupeCount',0) AND
                        jsonb_typeof(NEW."completenessCertificate"->'jobQuarantineLedger')='array' AND
                        jsonb_array_length(NEW."completenessCertificate"->'jobQuarantineLedger')>0 AND
                        jsonb_array_length(NEW."completenessCertificate"->'jobQuarantineLedger')+
                          jsonb_array_length(COALESCE(NEW."completenessCertificate"->'legalScopeExclusionLedger','[]'::jsonb))=NEW."validationDiscardCount" AND
                        (SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId"=NEW."id")=NEW."validationDiscardCount" AND
                        (SELECT count(DISTINCT loss."rawLocator") FROM "LossLedgerEntry" loss WHERE loss."sourceResultId"=NEW."id")=NEW."validationDiscardCount" AND
                        NOT EXISTS (SELECT 1 FROM "LossLedgerEntry" loss WHERE loss."sourceResultId"=NEW."id" AND (
                          loss."releaseCandidateId"=NEW."releaseCandidateId" AND loss."batchId"=NEW."batchId" AND loss."sourceId"=NEW."sourceId" AND
                          loss."stage"='VALIDATION' AND loss."candidateKey" IS NULL AND loss."winnerKey" IS NULL AND (
                            (loss."details"->>'code'='JOB_QUARANTINED' AND
                              NEW."completenessCertificate"->'jobQuarantineLedger' @> jsonb_build_array(jsonb_build_object(
                                'rawLocatorSha256',encode(sha256(convert_to(loss."rawLocator",'UTF8')),'hex'),
                                'pageSequence',loss."details"->'pageSequence','recordIndex',loss."details"->'recordIndex')))
                            OR (loss."details"->>'code' IN ('ROCHE_DETAIL_DENIED','LILLY_OFFICIAL_APPLICATION_CLOSED','ORGANON_OFFICIAL_APPLICATION_CLOSED',
                              'VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE','VERIFIED_MOKA_OUT_OF_MAINLAND_SCOPE') AND
                              NEW."completenessCertificate"->'legalScopeExclusionLedger' @> jsonb_build_array(jsonb_build_object(
                                'code',loss."details"->>'code','rawLocatorSha256',encode(sha256(convert_to(loss."rawLocator",'UTF8')),'hex'))))
                          )) IS NOT TRUE) AND
                        (SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId"=NEW."id" AND loss."details"->>'code'='JOB_QUARANTINED')=
                          jsonb_array_length(NEW."completenessCertificate"->'jobQuarantineLedger') AND
                        (SELECT count(DISTINCT (q.value->>'pageSequence',q.value->>'recordIndex'))
                          FROM jsonb_array_elements(NEW."completenessCertificate"->'jobQuarantineLedger') q)=
                          jsonb_array_length(NEW."completenessCertificate"->'jobQuarantineLedger')
                    ) IS TRUE
                    -- END JOB QUARANTINE TOTAL
$addition$;
BEGIN
  IF position('-- BEGIN JOB QUARANTINE TOTAL' IN definition)>0 THEN
    RAISE EXCEPTION 'Job quarantine migration already installed; inspect current state';
  END IF;
  IF position(anchor IN definition)=0 THEN anchor:=replace(anchor,E'\n',E'\r\n'); END IF;
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'Source terminal trigger anchor changed; inspect current function';
  END IF;
  EXECUTE replace(definition,anchor,addition||anchor);
END
$patch$;
