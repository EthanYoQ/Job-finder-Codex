-- Append-only Gilead and Novo China source policy registration.
-- SQL45 adds two source/company/config tuples; all SQL44 checks stay unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) <> 'f7f4db5f64b8d35568f01731c6d3eb67' THEN
  RAISE EXCEPTION 'Source state-machine drift: inspect before admitting Gilead and Novo China policies';
 END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.enforce_source_result_state_machine()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    quality JSONB;
    portable_quality_valid BOOLEAN := FALSE;
    observation RECORD;
    official_artifact RECORD;
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

        -- Portable source receipts are a distinct reviewed policy, never an A/B grade.
        -- The application owns acquisition and replays archived bodies. SQL binds the
        -- receipt to this terminal row, its observation, accounting and current registry.
        quality := NEW."completenessCertificate";
        IF quality->>'schemaVersion' = 'plan-bound-source-quality-v1' OR
           quality->>'policyId' = 'PLAN_BOUND_SOURCE_QUALITY_V1' OR
           NEW."baselineChangeReason" LIKE 'PLAN_BOUND_REPLAY_CONFIRMED_%' THEN
            portable_quality_valid := (
            (NEW."atomicCommitState" = 'COMMITTED' AND NEW."completenessState" = 'VERIFIED') AND
            (quality->>'schemaVersion' = 'plan-bound-source-quality-v1') AND
            (quality->>'policyId' = 'PLAN_BOUND_SOURCE_QUALITY_V1') AND
            (quality->>'proofBasis' = 'PLAN_BOUND_ARCHIVED_RESPONSE_REPLAY') AND
            (NOT (quality ? 'grade')) AND
            (NEW."completenessCertificateSha256" ~ '^[0-9a-f]{64}$') AND
            (quality->'binding' = jsonb_build_object(
                'releaseCandidateId', NEW."releaseCandidateId", 'batchId', NEW."batchId",
                'sourceResultId', NEW."id", 'sourceId', NEW."sourceId",
                'sourceConfigSha256', NEW."sourceConfigHash", 'adapterVersion', NEW."adapterVersion")) AND
            (EXISTS (SELECT 1 FROM (VALUES
                ('source-gilead-china-social','company-gilead-china','bdb31408948240f810347b6ba217407b0b50c9327c9600b4115a2a7a0869e40c'),
                ('source-novo-nordisk-china-social','company-novo-nordisk-china','2b79c0304952bfea93d2e50e2ebfb7668760043eb6c841b51597893378648805'),
                ('source-merck-china-social','company-merck-china','3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38'),
                ('source-biogen-china-social','company-biogen-china','47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348'),
                ('source-bms-china-social','company-bms-china','e0d783cbc8fc887e1697db6d86cb0abb8058ca6793cd32752055271c022ca137'),
                ('source-ucb-china-social','company-ucb-china','0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146'),
                ('source-grifols-china-social','company-grifols-china','614ac95db03986792bf1a42a856a403e747165f1b3a94d8588d49f2016c522c7'),
                ('source-novartis-social','company-novartis','1dcb83b63182c3b496a1137678baae55201276b4e041b60b6cbe1fab30990a91'),
                ('source-takeda-china-social','company-takeda-china','048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f'),
                ('source-boehringer-ingelheim-china-social','company-boehringer-ingelheim-china','86abb89ac25980acc5e9e3c82741a3415138f53f321f1050c4ae849efd4132de'),
                ('source-viatris-social','company-viatris','5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9'),
                ('source-abbvie-china-social','company-abbvie-china','4bc13113d0ea829b7df6935081d009ac389f24c97340390f09bbb7ad5234e5a9'),
                ('source-astellas-china-social','company-astellas-china','d3a6153703eeb204c9626e2b45e75d0d9dfcc65865c49066be6ec7a34dec88bc'),
                ('source-qilu-social','company-qilu','0ca38d0cd6550e9567cc3e7ca6772d3b91497f5a59530f5359f823a6c62d5773'),
                ('source-fosun-pharma-social','company-fosun-pharma','0227ec8d384900a48b2973f128908f7e9435d4bc991efd9a5b14ea5a3d1042b2'),
                ('source-cspc-social','company-cspc','5fbeee6e6b8d95f05d2b8771908f206ba8f45eea32a6208f21490a058332d409'),
                ('source-hengrui-social','company-hengrui','93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e'),
                ('source-kelun-social','company-kelun','9fe0cb0d7c308567f6010aa6181f36c595b97df739ecd528cab97070f47572cb'),
                ('source-hansoh-social','company-hansoh','94d0982064af5a70386e017dec29cec1115c08480df2934e8d4cf0ddf644d740')
            ) AS reviewed(source_id, company_id, config_hash)
            WHERE reviewed.source_id = NEW."sourceId" AND reviewed.config_hash = NEW."sourceConfigHash"
              AND reviewed.company_id = quality->>'companyId')) AND
            (quality->'surfaceIds' @> to_jsonb(NEW."officialSurfaceIds") AND
            quality->'surfaceIds' <@ to_jsonb(NEW."officialSurfaceIds") AND
            jsonb_array_length(quality->'surfaceIds') = cardinality(NEW."officialSurfaceIds")) AND
            (quality->'channelIds' @> to_jsonb(NEW."officialChannelIds") AND
            quality->'channelIds' <@ to_jsonb(NEW."officialChannelIds") AND
            jsonb_array_length(quality->'channelIds') = cardinality(NEW."officialChannelIds")) AND
            (quality->'counts' = jsonb_build_object('rawCount',NEW."rawCount",'parsedCount',NEW."parsedCount",'validCount',NEW."validCount",'parseDiscardCount',NEW."parseDiscardCount",'validationDiscardCount',NEW."validationDiscardCount",'normalizationDiscardCount',NEW."normalizationDiscardCount",'dedupeInputCount',NEW."dedupeInputCount",'dedupeDiscardCount',NEW."dedupeDiscardCount",'collisionCount',NEW."collisionCount",'finalUniqueJobCount',NEW."dedupeOutputCount")) AND
            (NEW."parseDiscardCount" = 0 AND NEW."normalizationDiscardCount" = 0 AND
            NEW."parsedCount" = NEW."rawCount" AND NEW."parsedCount" = NEW."validCount" + NEW."validationDiscardCount" AND
            NEW."normalizedCount" = NEW."validCount" AND NEW."dedupeInputCount" = NEW."validCount" AND
            NEW."dedupeOutputCount" + NEW."dedupeDiscardCount" = NEW."dedupeInputCount" AND
            NEW."discardCount" = NEW."validationDiscardCount" + NEW."dedupeDiscardCount" AND
            NEW."adapterInputCount" = NEW."dedupeInputCount" AND NEW."adapterOutputCount" = NEW."dedupeOutputCount" AND
            NEW."adapterLossCount" = NEW."dedupeDiscardCount" AND NEW."adapterCollisionGroupCount" = NEW."collisionCount") AND
            (quality->'ledger'->>'adapterReconciliationSha256' = NEW."adapterReconciliationSha256" AND
            quality->'ledger'->>'collisionLedgerSha256' = NEW."collisionLedgerSha256" AND
            quality->'output'->>'canonicalJobKeySetSha256' = NEW."canonicalCurrentJobSetSha256" AND
            quality->>'canonicalRawEvidenceIdSetSha256' = observation."canonicalRawSha256" AND
            quality->>'paginationTraceSha256' = observation."paginationTraceSha256") AND
            (quality->'observation'->'expectedJobCount' = COALESCE(to_jsonb(NEW."expectedJobCount"), 'null'::jsonb) AND
            quality->'observation'->>'expectedEvidenceKind' = NEW."expectedEvidenceKind"::text AND
            ((quality->'observation'->>'crawledAt')::timestamptz AT TIME ZONE 'UTC') = observation."crawledAt" AND
            ((quality->>'issuedAt')::timestamptz AT TIME ZONE 'UTC') = NEW."finishedAt" AND
            observation."observedTo" = NEW."finishedAt" AND observation."observedFrom" = NEW."startedAt") AND
            (quality->'declaredCompleteness'->>'scope' IN ('SOURCE','CHANNEL') AND
            quality->'declaredCompleteness'->>'kind' = NEW."expectedEvidenceKind"::text AND
            (NEW."expectedEvidenceKind" <> 'OFFICIAL_TOTAL_COUNT' OR (
                quality->'declaredCompleteness'->'value' = to_jsonb(NEW."expectedJobCount") AND
                NEW."expectedJobCount" = NEW."rawCount"))) AND
            (NEW."startedAt" <= ((quality->'acquisition'->>'startedAt')::timestamptz AT TIME ZONE 'UTC') AND
            ((quality->'acquisition'->>'startedAt')::timestamptz AT TIME ZONE 'UTC') <= observation."crawledAt" AND
            observation."crawledAt" <= ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC') AND
            ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC') <= NEW."finishedAt" AND
            ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC') - ((quality->'acquisition'->>'startedAt')::timestamptz AT TIME ZONE 'UTC') <= interval '30 minutes' AND
            NEW."finishedAt" - ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC') <= interval '30 minutes' AND
            NEW."finishedAt" <= (clock_timestamp() AT TIME ZONE 'UTC') + interval '2 minutes' AND
            NEW."finishedAt" >= (clock_timestamp() AT TIME ZONE 'UTC') - interval '30 minutes' ) AND
            ((SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id") = NEW."discardCount" AND
            (SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND loss."stage" = 'VALIDATION') = NEW."validationDiscardCount" AND
            (SELECT count(DISTINCT (COALESCE(loss."details"->>'pageSequence','GLOBAL'), loss."details"->>'recordIndex')) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND loss."stage" = 'VALIDATION') = NEW."validationDiscardCount" AND
            (SELECT count(DISTINCT loss."rawLocator") FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND loss."stage" = 'VALIDATION') = NEW."validationDiscardCount" AND
            (SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND loss."stage" = 'DEDUPE') = NEW."dedupeDiscardCount" AND
            (SELECT count(DISTINCT loss."winnerKey") FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND loss."stage" = 'DEDUPE') = NEW."collisionCount" AND
            NOT EXISTS (SELECT 1 FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id" AND (
                loss."releaseCandidateId" IS DISTINCT FROM NEW."releaseCandidateId" OR loss."batchId" IS DISTINCT FROM NEW."batchId" OR
                loss."sourceId" IS DISTINCT FROM NEW."sourceId" OR loss."rawLocator" IS NULL OR btrim(loss."rawLocator") = '' OR
                loss."stage" NOT IN ('VALIDATION','DEDUPE') OR
                (loss."stage" = 'VALIDATION' AND (COALESCE(loss."details"->>'recordIndex','') !~ '^(0|[1-9][0-9]*)$' OR
                  (loss."details" ? 'pageSequence' AND (jsonb_typeof(loss."details"->'pageSequence') IS DISTINCT FROM 'number' OR
                    COALESCE(loss."details"->>'pageSequence','') !~ '^(0|[1-9][0-9]*)$')) OR
                  loss."candidateKey" IS NOT NULL OR loss."winnerKey" IS NOT NULL)) OR
                (loss."stage" = 'DEDUPE' AND (loss."candidateKey" IS NULL OR loss."winnerKey" IS NULL))))) AND
            (NOT EXISTS (SELECT 1 FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND (a."id" = observation."officialEvidenceArtifactId" OR a."id" IN (SELECT p."artifactId" FROM "PaginationEvidence" p WHERE p."sourceResultId" = NEW."id")) AND (
                a."capturedAt" < ((quality->'acquisition'->>'startedAt')::timestamptz AT TIME ZONE 'UTC') OR
                a."capturedAt" > ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC'))) AND
            NOT EXISTS (SELECT 1 FROM "PaginationEvidence" p WHERE p."sourceResultId" = NEW."id" AND (
                p."capturedAt" < ((quality->'acquisition'->>'startedAt')::timestamptz AT TIME ZONE 'UTC') OR
                p."capturedAt" > ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC'))))
            ) IS TRUE;
            IF NOT portable_quality_valid THEN
                RAISE EXCEPTION 'Portable source quality receipt does not match terminal evidence';
            END IF;
        END IF;

        SELECT * INTO official_artifact
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
        IF official_artifact."kind" NOT IN ('OFFICIAL_COMPANY_PAGE', 'REDIRECT_TRACE', 'ATS_PAGE', 'ATS_API_RESPONSE', 'PAGINATION_PAGE') OR
           official_artifact."extractorLocator" IS NULL OR btrim(official_artifact."extractorLocator") = '' THEN
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
            IF NEW."expectedEvidenceKind" = 'OFFICIAL_TOTAL_COUNT' AND NOT portable_quality_valid AND
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
$function$
;
COMMIT;
