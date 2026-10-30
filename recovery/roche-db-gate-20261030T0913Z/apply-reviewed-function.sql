SET LOCAL lock_timeout='1000ms';
SET LOCAL statement_timeout='8000ms';
LOCK TABLE public."CrawlCoordinatorLock" IN EXCLUSIVE MODE;
DO $roche_repair$
DECLARE original text; replacement text;
BEGIN
 IF clock_timestamp() >= '2026-10-30T09:40:00Z'::timestamptz THEN RAISE EXCEPTION 'ROCHE_REPAIR_EXPIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl' AND coalesce("holderId",'')<>'') THEN RAISE EXCEPTION 'ROCHE_REPAIR_ACTIVE_OWNER'; END IF;
 original := pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure);
 IF encode(sha256(convert_to(original,'UTF8')),'hex') <> 'ae320e6bdfa442cef3f221f2e586ad5f90dfe3335938d8f29be5208b91c4299b' THEN RAISE EXCEPTION 'ROCHE_REPAIR_ORIGINAL_CHANGED'; END IF;
 replacement := replace(original,$marker$                ) THEN
                    RAISE EXCEPTION 'VERIFIED official total must equal dedupe output';$marker$,$replacement$                    OR (
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
                    )
                ) THEN
                    RAISE EXCEPTION 'VERIFIED official total must equal dedupe output';$replacement$);
 IF encode(sha256(convert_to(replacement,'UTF8')),'hex') <> '186f55d8ff1f86fcfd4b6e4f763a85496aaba934b8776f21428f99f0dfb9f20d' THEN RAISE EXCEPTION 'ROCHE_REPAIR_CANDIDATE_CHANGED'; END IF;
 EXECUTE replacement;
END
$roche_repair$;
