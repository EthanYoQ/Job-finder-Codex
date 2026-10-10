ALTER TYPE "TransportAttemptCode" ADD VALUE IF NOT EXISTS 'JNJ_DIRECT_FAILED';
ALTER TYPE "TransportAttemptCode" ADD VALUE IF NOT EXISTS 'JNJ_BROWSER_SESSION_FAILED';
ALTER TYPE "TransportAttemptCode" ADD VALUE IF NOT EXISTS 'JNJ_BROWSER_FETCH_FAILED';
ALTER TYPE "TransportAttemptCode" ADD VALUE IF NOT EXISTS 'JNJ_BROWSER_SUCCEEDED';

ALTER TABLE "TransportAttemptEvidence"
DROP CONSTRAINT "TransportAttemptEvidence_code_outcome_check";

ALTER TABLE "TransportAttemptEvidence"
ADD CONSTRAINT "TransportAttemptEvidence_code_outcome_check"
CHECK (
  ("code"::TEXT = 'HCM_DIRECT_FAILED' AND "transport" = 'DIRECT_HTTP' AND "outcome" = 'FAILED') OR
  ("code"::TEXT = 'HCM_BROWSER_SUCCEEDED' AND "transport" = 'BROWSER_SESSION' AND "outcome" = 'SUCCEEDED') OR
  ("code"::TEXT LIKE 'HCM_BROWSER_%' AND "code"::TEXT <> 'HCM_BROWSER_SUCCEEDED' AND
    "transport" = 'BROWSER_SESSION' AND "outcome" = 'FAILED') OR
  ("sourceId" = 'source-johnson-innovative-medicine-social' AND "code"::TEXT = 'JNJ_DIRECT_FAILED' AND
    "transport" = 'DIRECT_HTTP' AND "outcome" = 'FAILED') OR
  ("sourceId" = 'source-johnson-innovative-medicine-social' AND "code"::TEXT = 'JNJ_BROWSER_SESSION_FAILED' AND
    "transport" = 'BROWSER_SESSION' AND "outcome" = 'FAILED') OR
  ("sourceId" = 'source-johnson-innovative-medicine-social' AND "code"::TEXT = 'JNJ_BROWSER_FETCH_FAILED' AND
    "transport" = 'BROWSER_SESSION' AND "outcome" = 'FAILED') OR
  ("sourceId" = 'source-johnson-innovative-medicine-social' AND "code"::TEXT = 'JNJ_BROWSER_SUCCEEDED' AND
    "transport" = 'BROWSER_SESSION' AND "outcome" = 'SUCCEEDED')
) NOT VALID;

CREATE OR REPLACE FUNCTION "enforce_source_result_state_machine"() RETURNS TRIGGER AS $$
DECLARE
    observation RECORD;
    artifact RECORD;
    observation_count INTEGER;
    pagination_count INTEGER;
    grifols_scope_exclusion_count INTEGER;
    grifols_scope_exclusion_distinct_index_count INTEGER;
    invalid_grifols_scope_exclusion_count INTEGER;
    grifols_detail_artifact_count INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."atomicCommitState" <> 'PENDING' THEN
            RAISE EXCEPTION 'Terminal CrawlBatchSourceResult rows cannot be deleted';
        END IF;
        RAISE EXCEPTION 'Planned PENDING CrawlBatchSourceResult rows cannot be deleted';
    END IF;

    IF OLD."atomicCommitState" <> 'PENDING' THEN
        RAISE EXCEPTION 'Terminal CrawlBatchSourceResult rows are immutable';
    END IF;
    IF NEW."atomicCommitState" = 'PENDING' THEN
        RAISE EXCEPTION 'CrawlBatchSourceResult must transition from PENDING exactly once';
    END IF;
    IF OLD."id" IS DISTINCT FROM NEW."id" OR
       OLD."releaseCandidateId" IS DISTINCT FROM NEW."releaseCandidateId" OR
       OLD."batchId" IS DISTINCT FROM NEW."batchId" OR
       OLD."sourceId" IS DISTINCT FROM NEW."sourceId" OR
       OLD."sourceConfigHash" IS DISTINCT FROM NEW."sourceConfigHash" OR
       OLD."adapterVersion" IS DISTINCT FROM NEW."adapterVersion" OR
       OLD."officialEntryId" IS DISTINCT FROM NEW."officialEntryId" OR
       OLD."officialSurfaceIds" IS DISTINCT FROM NEW."officialSurfaceIds" OR
       OLD."officialChannelIds" IS DISTINCT FROM NEW."officialChannelIds" OR
       OLD."startedAt" IS DISTINCT FROM NEW."startedAt" OR
       OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
        RAISE EXCEPTION 'CrawlBatchSourceResult identity and planned metadata are immutable';
    END IF;
    IF NEW."transportState" = 'PENDING' OR NEW."adapterState" = 'PENDING' OR
       NEW."completenessState" = 'PENDING' OR NEW."finishedAt" IS NULL THEN
        RAISE EXCEPTION 'Terminal CrawlBatchSourceResult state is incomplete';
    END IF;
    IF NEW."atomicCommitState" = 'COMMITTED' THEN
        IF NEW."transportState" <> 'SUCCEEDED' OR NEW."adapterState" <> 'SUCCEEDED' OR
           NEW."completenessState" NOT IN ('VERIFIED', 'INCOMPLETE', 'NEEDS_MANUAL_COMPLETENESS_REVIEW') OR
           NEW."failureCode" IS NOT NULL OR NEW."failureReason" IS NOT NULL THEN
            RAISE EXCEPTION 'COMMITTED source result terminal state is inconsistent';
        END IF;
        IF NEW."completenessState" = 'VERIFIED' THEN
            IF NEW."blockerCode" IS NOT NULL OR NEW."blockerReason" IS NOT NULL THEN
                RAISE EXCEPTION 'VERIFIED source result cannot claim a blocker';
            END IF;
        ELSIF NEW."blockerCode" IS NULL OR btrim(NEW."blockerCode") = '' OR
              NEW."blockerReason" IS NULL OR btrim(NEW."blockerReason") = '' THEN
            RAISE EXCEPTION 'INCOMPLETE or NEEDS_MANUAL source result requires blocker code and reason';
        END IF;

        SELECT count(*) INTO observation_count
        FROM "CrawlObservation"
        WHERE "sourceResultId" = NEW."id" AND "releaseCandidateId" = NEW."releaseCandidateId" AND
              "batchId" = NEW."batchId" AND "sourceId" = NEW."sourceId";
        IF observation_count <> 1 THEN
            RAISE EXCEPTION 'COMMITTED source result requires exactly one same-tuple observation';
        END IF;
        SELECT * INTO observation
        FROM "CrawlObservation"
        WHERE "sourceResultId" = NEW."id" AND "releaseCandidateId" = NEW."releaseCandidateId" AND
              "batchId" = NEW."batchId" AND "sourceId" = NEW."sourceId";

        IF observation."successful" IS NOT TRUE OR observation."transportSucceeded" IS NOT TRUE OR
           observation."adapterSucceeded" IS NOT TRUE OR observation."atomicCommitSucceeded" IS NOT TRUE OR
           observation."completenessVerified" IS DISTINCT FROM (NEW."completenessState" = 'VERIFIED') OR
           observation."completenessStatus" IS DISTINCT FROM NEW."completenessState" OR
           observation."sourceConfigSha256" IS DISTINCT FROM NEW."sourceConfigHash" OR
           observation."adapterVersion" IS DISTINCT FROM NEW."adapterVersion" OR
           observation."rawCount" IS DISTINCT FROM NEW."rawCount" OR
           observation."parsedCount" IS DISTINCT FROM NEW."parsedCount" OR
           observation."validCount" IS DISTINCT FROM NEW."validCount" OR
           observation."normalizedCount" IS DISTINCT FROM NEW."normalizedCount" OR
           observation."dedupeInputCount" IS DISTINCT FROM NEW."dedupeInputCount" OR
           observation."dedupeOutputCount" IS DISTINCT FROM NEW."dedupeOutputCount" OR
           observation."structuredJobCount" IS DISTINCT FROM NEW."dedupeOutputCount" OR
           observation."parseDiscardCount" IS DISTINCT FROM NEW."parseDiscardCount" OR
           observation."validationDiscardCount" IS DISTINCT FROM NEW."validationDiscardCount" OR
           observation."normalizationDiscardCount" IS DISTINCT FROM NEW."normalizationDiscardCount" OR
           observation."dedupeDiscardCount" IS DISTINCT FROM NEW."dedupeDiscardCount" OR
           observation."discardCount" IS DISTINCT FROM NEW."discardCount" OR
           observation."collisionCount" IS DISTINCT FROM NEW."collisionCount" OR
           observation."expectedJobCount" IS DISTINCT FROM NEW."expectedJobCount" OR
           observation."completenessEvidenceKind" IS DISTINCT FROM NEW."expectedEvidenceKind" OR
           observation."completenessBlockerReason" IS DISTINCT FROM NEW."blockerReason" OR
           observation."expectedSurfaceSha256" IS DISTINCT FROM NEW."expectedSurfaceSha256" OR
           observation."visitedSurfaceSha256" IS DISTINCT FROM NEW."visitedSurfaceSha256" OR
           observation."expectedChannelSha256" IS DISTINCT FROM NEW."expectedChannelSha256" OR
           observation."visitedChannelSha256" IS DISTINCT FROM NEW."visitedChannelSha256" OR
           observation."canonicalOutputSha256" IS DISTINCT FROM NEW."canonicalCurrentJobSetSha256" OR
           observation."canonicalGraceSha256" IS DISTINCT FROM NEW."canonicalGraceJobSetSha256" OR
           observation."canonicalVisibleSha256" IS DISTINCT FROM NEW."canonicalVisibleJobSetSha256" THEN
            RAISE EXCEPTION 'COMMITTED source result observation does not match terminal evidence';
        END IF;

        SELECT * INTO artifact
        FROM "EvidenceArtifact"
        WHERE "id" = observation."officialEvidenceArtifactId" AND
              "sourceResultId" = NEW."id" AND "releaseCandidateId" = NEW."releaseCandidateId" AND
              "batchId" = NEW."batchId" AND "sourceId" = NEW."sourceId";
        IF NOT FOUND THEN
            RAISE EXCEPTION 'COMMITTED source result requires a same-tuple official artifact';
        END IF;
        SELECT count(*) INTO pagination_count
        FROM "PaginationEvidence"
        WHERE "sourceResultId" = NEW."id" AND "releaseCandidateId" = NEW."releaseCandidateId" AND
              "batchId" = NEW."batchId" AND "sourceId" = NEW."sourceId";
        IF pagination_count = 0 THEN
            RAISE EXCEPTION 'COMMITTED source result requires same-tuple pagination evidence';
        END IF;
        IF observation."pagesVisited" IS DISTINCT FROM pagination_count THEN
            RAISE EXCEPTION 'COMMITTED observation pagesVisited does not match pagination evidence';
        END IF;
        IF artifact."kind" NOT IN ('OFFICIAL_COMPANY_PAGE', 'REDIRECT_TRACE', 'ATS_PAGE', 'ATS_API_RESPONSE', 'PAGINATION_PAGE') OR
           artifact."extractorLocator" IS NULL OR btrim(artifact."extractorLocator") = '' THEN
            RAISE EXCEPTION 'COMMITTED source result requires a located official network artifact';
        END IF;

        IF NEW."completenessState" = 'VERIFIED' THEN
            IF NEW."expectedSurfaceSha256" IS NULL OR NEW."visitedSurfaceSha256" IS NULL OR
               NEW."expectedChannelSha256" IS NULL OR NEW."visitedChannelSha256" IS NULL OR
               NEW."canonicalCurrentJobSetSha256" IS NULL OR NEW."canonicalGraceJobSetSha256" IS NULL OR
               NEW."canonicalVisibleJobSetSha256" IS NULL OR observation."canonicalRawSha256" IS NULL OR
               observation."paginationTraceSha256" IS NULL OR
               NEW."expectedSurfaceSha256" <> NEW."visitedSurfaceSha256" OR
               NEW."expectedChannelSha256" <> NEW."visitedChannelSha256" THEN
                RAISE EXCEPTION 'VERIFIED source result requires complete matching coverage and canonical hashes';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "PaginationEvidence" pagination
                WHERE pagination."sourceResultId" = NEW."id" AND
                      (cardinality(pagination."anomalyCodes") <> 0 OR
                       pagination."termination" IN ('REPEATED_CURSOR', 'MAX_PAGE_LIMIT', 'FAILED', 'ABORTED'))
            ) THEN
                RAISE EXCEPTION 'VERIFIED source result has unsafe pagination evidence';
            END IF;
            IF NEW."expectedEvidenceKind" = 'OFFICIAL_TOTAL_COUNT' AND
               (NEW."expectedJobCount" IS NULL OR NEW."expectedJobCount" <> NEW."dedupeOutputCount") THEN
                SELECT count(*), count(DISTINCT loss."details"->>'recordIndex')
                INTO grifols_scope_exclusion_count, grifols_scope_exclusion_distinct_index_count
                FROM "LossLedgerEntry" loss
                WHERE loss."sourceResultId" = NEW."id" AND
                      loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                      loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId";

                SELECT count(*) INTO invalid_grifols_scope_exclusion_count
                FROM "LossLedgerEntry" loss
                WHERE loss."sourceResultId" = NEW."id" AND
                      loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                      loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND NOT (
                        loss."stage" = 'VALIDATION' AND
                        loss."reason" = 'official detail places the job outside mainland China' AND
                        loss."rawLocator" ~ '^grifols-detail-[0-9]{4}#grifols-successfactors-detail-v1[|]html:canonical[+]streetAddress[+]content-location$' AND
                        jsonb_typeof(loss."details"->'recordIndex') = 'number' AND
                        loss."details"->>'recordIndex' ~ '^(0|[1-9][0-9]*)$' AND
                        loss."details"->>'code' = 'VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE' AND
                        loss."details" = jsonb_build_object(
                          'code', 'VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE',
                          'recordIndex', loss."details"->'recordIndex'
                        ) AND
                        loss."candidateKey" IS NULL AND loss."winnerKey" IS NULL
                      );

                SELECT count(*) INTO grifols_detail_artifact_count
                FROM "EvidenceArtifact" artifact
                WHERE artifact."sourceResultId" = NEW."id" AND
                      artifact."releaseCandidateId" = NEW."releaseCandidateId" AND
                      artifact."batchId" = NEW."batchId" AND artifact."sourceId" = NEW."sourceId" AND
                      artifact."kind" = 'ATS_PAGE' AND
                      artifact."extractorLocator" = 'grifols-successfactors-detail-v1|html:canonical+streetAddress+content-location';

                IF NOT (
                    NEW."sourceId" = 'source-grifols-china-social' AND
                    NEW."expectedJobCount" IS NOT NULL AND NEW."validationDiscardCount" > 0 AND
                    NEW."parseDiscardCount" = 0 AND NEW."normalizationDiscardCount" = 0 AND
                    NEW."dedupeDiscardCount" = 0 AND NEW."rawCount" = NEW."expectedJobCount" AND
                    NEW."parsedCount" = NEW."rawCount" AND NEW."validCount" = NEW."dedupeOutputCount" AND
                    NEW."expectedJobCount" = NEW."dedupeOutputCount" + NEW."validationDiscardCount" AND
                    grifols_scope_exclusion_count = NEW."validationDiscardCount" AND
                    grifols_scope_exclusion_distinct_index_count = NEW."validationDiscardCount" AND
                    invalid_grifols_scope_exclusion_count = 0 AND
                    grifols_detail_artifact_count >= NEW."validationDiscardCount"
                ) THEN
                    RAISE EXCEPTION 'VERIFIED official total must equal dedupe output';
                END IF;
            END IF;
        END IF;
    ELSIF NEW."atomicCommitState" = 'NOT_ATTEMPTED' THEN
        IF NEW."completenessState" <> 'FAILED' OR NEW."failureCode" IS NULL OR btrim(NEW."failureCode") = '' OR
           NEW."failureReason" IS NULL OR btrim(NEW."failureReason") = '' OR
           (NEW."transportState" IN ('FAILED', 'BLOCKED', 'SKIPPED') AND NEW."adapterState" <> 'SKIPPED') OR
           (NEW."transportState" = 'SUCCEEDED' AND NEW."adapterState" NOT IN ('FAILED', 'BLOCKED', 'SKIPPED')) OR
           NEW."transportState" NOT IN ('SUCCEEDED', 'FAILED', 'BLOCKED', 'SKIPPED') THEN
            RAISE EXCEPTION 'NOT_ATTEMPTED source result terminal state is inconsistent';
        END IF;
    ELSIF NEW."atomicCommitState" IN ('FAILED', 'ROLLED_BACK') THEN
        IF NEW."transportState" <> 'SUCCEEDED' OR NEW."adapterState" <> 'SUCCEEDED' OR
           NEW."completenessState" <> 'FAILED' OR NEW."failureCode" IS NULL OR btrim(NEW."failureCode") = '' OR
           NEW."failureReason" IS NULL OR btrim(NEW."failureReason") = '' THEN
            RAISE EXCEPTION 'FAILED or ROLLED_BACK source result terminal state is inconsistent';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported CrawlBatchSourceResult terminal state';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
