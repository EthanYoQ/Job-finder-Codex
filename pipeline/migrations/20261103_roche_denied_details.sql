-- Extend exact official-denial isolation without replaying historical migrations.
DO $patch$
DECLARE current_definition text := pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure);
BEGIN
  IF md5(current_definition) <> '0dc54c655f4b5d8c68c5e90e737e40fc' THEN
    RAISE EXCEPTION 'Source terminal trigger changed; inspect before applying';
  END IF;
  EXECUTE replace(current_definition,$anchor$                    OR (
                        NEW."sourceId" = 'source-roche-china-social' AND
                        NEW."completenessCertificate"->>'schemaVersion' = 'a-grade-official-total-v2' AND
                        NEW."completenessCertificate"->>'grade' = 'A' AND
                        NEW."rawCount" = NEW."expectedJobCount" AND NEW."parsedCount" = NEW."rawCount" AND
                        NEW."expectedJobCount" = NEW."dedupeOutputCount" + 1 AND
                        NEW."validCount" = NEW."dedupeOutputCount" AND NEW."normalizedCount" = NEW."validCount" AND
                        NEW."dedupeInputCount" = NEW."validCount" AND
                        NEW."parseDiscardCount" = 0 AND NEW."validationDiscardCount" = 1 AND
                        NEW."normalizationDiscardCount" = 0 AND NEW."dedupeDiscardCount" = 0 AND
                        NEW."collisionCount" = 0 AND NEW."discardCount" = 1 AND
                        NEW."adapterInputCount" = NEW."dedupeOutputCount" AND
                        NEW."adapterOutputCount" = NEW."dedupeOutputCount" AND NEW."adapterLossCount" = 0 AND
                        NEW."adapterCollisionGroupCount" = 0 AND grifols_scope_exclusion_count = 1 AND
                        EXISTS (
                            SELECT 1 FROM "LossLedgerEntry" loss
                            WHERE loss."sourceResultId" = NEW."id" AND
                                  loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                                  loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                                  loss."stage" = 'VALIDATION' AND
                                  loss."reason" = 'Roche approved official denial isolated; preserve existing row and its time' AND
                                  loss."details"->>'code' = 'ROCHE_DETAIL_DENIED' AND
                                  loss."details"->>'noteCode' = 'NO_OMISSION_NOT_VERIFIED' AND
                                  NEW."completenessCertificate"->'legalScopeExclusionLedger' = jsonb_build_array(jsonb_build_object(
                                      'rawLocatorSha256', encode(sha256(convert_to(loss."rawLocator",'UTF8')),'hex'),
                                      'recordIndex', loss."details"->'recordIndex', 'code', 'ROCHE_DETAIL_DENIED'))
                        ) AND EXISTS (
                            SELECT 1 FROM "EvidenceArtifact" artifact
                            WHERE artifact."sourceResultId" = NEW."id" AND
                                  artifact."releaseCandidateId" = NEW."releaseCandidateId" AND
                                  artifact."batchId" = NEW."batchId" AND artifact."sourceId" = NEW."sourceId" AND
                                  artifact."kind" = 'ATS_API_RESPONSE' AND artifact."httpStatus" = 403 AND
                                  artifact."requestedUrl" = artifact."finalUrl" AND
                                  artifact."requestedUrl" = 'https://roche.wd3.myworkdayjobs.com/wday/cxs/roche/roche-ext/job/Tianjin/------_202610-125686' AND
                                  artifact."extractorLocator" = 'roche-workday-jobposting-v1' AND
                                  artifact."capturedAt" BETWEEN NEW."startedAt" AND NEW."finishedAt"
                        )
                    )$anchor$,$replacement$                    OR (
                        NEW."sourceId" = 'source-roche-china-social' AND
                        NEW."completenessCertificate"->>'schemaVersion' = 'a-grade-official-total-v2' AND
                        NEW."completenessCertificate"->>'grade' = 'A' AND
                        NEW."completenessCertificate"->'binding' @> jsonb_build_object(
                          'releaseCandidateId',NEW."releaseCandidateId",'batchId',NEW."batchId",'sourceId',NEW."sourceId",'sourceResultId',NEW."id") AND
                        NEW."rawCount" = NEW."expectedJobCount" AND NEW."parsedCount" = NEW."rawCount" AND
                        NEW."expectedJobCount" = NEW."dedupeOutputCount" + NEW."validationDiscardCount" AND
                        NEW."validCount" = NEW."dedupeOutputCount" AND NEW."normalizedCount" = NEW."validCount" AND
                        NEW."dedupeInputCount" = NEW."validCount" AND NEW."validationDiscardCount" > 0 AND
                        NEW."parseDiscardCount" = 0 AND NEW."normalizationDiscardCount" = 0 AND NEW."dedupeDiscardCount" = 0 AND
                        NEW."collisionCount" = 0 AND NEW."discardCount" = NEW."validationDiscardCount" AND
                        NEW."adapterInputCount" = NEW."validCount" AND NEW."adapterOutputCount" = NEW."validCount" AND
                        NEW."adapterLossCount" = 0 AND NEW."adapterCollisionGroupCount" = 0 AND
                        NEW."completenessCertificate"->'counts' @> jsonb_build_object(
                          'officialTotal',NEW."expectedJobCount",'rawObservationCount',NEW."rawCount",'finalUniqueJobCount',NEW."dedupeOutputCount",
                          'validationDiscardCount',NEW."validationDiscardCount",'legalDedupeCount',0) AND
                        jsonb_array_length(NEW."completenessCertificate"->'legalScopeExclusionLedger') = NEW."validationDiscardCount" AND
                        (SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id") = NEW."validationDiscardCount" AND
                        (SELECT count(DISTINCT loss."rawLocator") FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id") = NEW."validationDiscardCount" AND
                        NOT EXISTS (SELECT 1 FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND (
                          loss."releaseCandidateId" = NEW."releaseCandidateId" AND loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                          loss."stage" = 'VALIDATION' AND loss."details"->>'code' = 'ROCHE_DETAIL_DENIED' AND
                          loss."details"->>'noteCode' = 'NO_OMISSION_NOT_VERIFIED' AND
                          loss."candidateKey" IS NULL AND loss."winnerKey" IS NULL AND
                          NEW."completenessCertificate"->'legalScopeExclusionLedger' @> jsonb_build_array(jsonb_build_object(
                            'rawLocatorSha256',encode(sha256(convert_to(loss."rawLocator",'UTF8')),'hex'),
                            'recordIndex',loss."details"->'recordIndex','code','ROCHE_DETAIL_DENIED'))
                        ) IS NOT TRUE) AND
                        (SELECT count(DISTINCT artifact."requestedUrl") FROM "EvidenceArtifact" artifact
                          WHERE artifact."sourceResultId" = NEW."id" AND artifact."releaseCandidateId" = NEW."releaseCandidateId" AND
                            artifact."batchId" = NEW."batchId" AND artifact."sourceId" = NEW."sourceId" AND
                            artifact."kind" = 'ATS_API_RESPONSE' AND artifact."httpStatus" = 403 AND
                            artifact."requestedUrl" = artifact."finalUrl" AND
                            artifact."requestedUrl" ~ '^https://roche[.]wd3[.]myworkdayjobs[.]com/wday/cxs/roche/roche-ext/job/[^/?#]+/[^/?#]*_[0-9]{6}-[0-9]+(-[1-9][0-9]*)?$' AND
                            artifact."extractorLocator" = 'roche-workday-jobposting-v1' AND
                            artifact."capturedAt" BETWEEN NEW."startedAt" AND NEW."finishedAt") = NEW."validationDiscardCount"
                    ) IS TRUE$replacement$);
  IF md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) <> '303bf4b9aa90ffc62c51df82a69b1130' THEN
    RAISE EXCEPTION 'Source terminal trigger readback mismatch';
  END IF;
END
$patch$;
