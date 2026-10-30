CREATE OR REPLACE FUNCTION public.enforce_source_result_state_machine()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    job_verification_loss RECORD;
    job_verification_proof JSONB;
    job_verification_captured TIMESTAMP;
    -- BEGIN JOB DELTA DECLARATIONS
    delta_receipt jsonb;
    delta_receipt_sha256 text;
    delta_manifest jsonb;
    delta_member jsonb;
    delta_history public."CrawlBatchSourceResult"%ROWTYPE;
    delta_history_observed timestamp;
    delta_observed timestamp;
    delta_job public."Job"%ROWTYPE;
    delta_member_count integer;
    -- END JOB DELTA DECLARATIONS
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
    -- JOB_VERIFICATION is evidence-only: one historically bound original Novo native closure.
    -- This branch never admits a whole-source certificate or lifecycle publication.
    IF EXISTS (SELECT 1 FROM public."CrawlBatch" b WHERE b."id" = NEW."batchId" AND b."kind"::text = 'JOB_VERIFICATION') THEN
        IF (SELECT count(*) FROM public."LossLedgerEntry" l WHERE l."sourceResultId" = NEW."id") <> 1 THEN
            RAISE EXCEPTION 'JOB_VERIFICATION_SINGLE_CLOSURE_REQUIRED';
        END IF;
        SELECT * INTO job_verification_loss FROM public."LossLedgerEntry" l WHERE l."sourceResultId" = NEW."id";
        job_verification_proof := job_verification_loss."details";
        IF NOT (
            jsonb_typeof(job_verification_proof) = 'object' AND
            job_verification_proof ?& ARRAY['schemaVersion','code','recordIndex','nativeId','jobId','jobKey','officialUrl','previousSourceResultId','previousApplicationArtifactId','nativeUrl','capturedAt','nativeBodySha256','nativeClosureHtml','nativeClosureSha256'] AND
            job_verification_proof - ARRAY['schemaVersion','code','recordIndex','nativeId','jobId','jobKey','officialUrl','previousSourceResultId','previousApplicationArtifactId','nativeUrl','capturedAt','nativeBodySha256','nativeClosureHtml','nativeClosureSha256']::text[] = '{}'::jsonb AND
            NOT EXISTS (SELECT 1 FROM jsonb_each(job_verification_proof) e WHERE e.key <> 'recordIndex' AND
                (jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR btrim(e.value #>> '{}') = '')) AND
            job_verification_proof->>'schemaVersion' = 'novo-single-job-closure-v1' AND
            job_verification_proof->>'code' = 'OFFICIAL_APPLICATION_CLOSED' AND
            job_verification_proof->'recordIndex' = '0'::jsonb AND
            job_verification_proof->>'nativeId' ~ '^[0-9]+[.]en_GB$' AND
            job_verification_proof->>'officialUrl' = 'https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.' || (job_verification_proof->>'nativeId') || '.html' AND
            job_verification_proof->>'nativeUrl' ~ '^https://careers[.]novonordisk[.]com/job/[^/?#]+/[0-9]+/$' AND
            job_verification_proof->>'capturedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND
            job_verification_proof->>'nativeBodySha256' ~ '^[0-9a-f]{64}$' AND
            job_verification_proof->>'nativeClosureSha256' ~ '^[0-9a-f]{64}$' AND
            encode(sha256(convert_to(job_verification_proof->>'nativeClosureHtml', 'UTF8')), 'hex') = job_verification_proof->>'nativeClosureSha256' AND
            (job_verification_proof->>'nativeClosureHtml') ~ '^<div class="jobDisplay">' AND
            (job_verification_proof->>'nativeClosureHtml') !~* '<[[:space:]]*(a|script|style|form|input|button|iframe|svg|object|embed|template|noscript)([[:space:]>]|$)' AND
            (job_verification_proof->>'nativeClosureHtml') !~* '(href|src|on[a-z]+|style)[[:space:]]*=' AND
            btrim(regexp_replace(regexp_replace(job_verification_proof->>'nativeClosureHtml',
                '</?(div|p|strong)( class="[-A-Za-z0-9 _]*")?[[:space:]]*>', '', 'g'), '[[:space:]]+', ' ', 'g')) =
                'Thank you for your interest unfortunately, we are no longer accepting applicants to this position.'
        ) IS TRUE THEN RAISE EXCEPTION 'JOB_VERIFICATION_CLOSURE_PROOF_SHAPE'; END IF;
        -- Application replay must also call the existing novoApplicationStatus helper on the original body.
        -- SQL verifies the conservative closure-only fragment, exact artifact binding, and historical identity.
        job_verification_captured := (job_verification_proof->>'capturedAt')::timestamptz AT TIME ZONE 'UTC';
        IF NOT (
            NEW."sourceId" = 'source-novo-nordisk-china-social' AND
            NEW."transportState" = 'SUCCEEDED' AND NEW."adapterState" = 'SUCCEEDED' AND
            NEW."completenessState" = 'INCOMPLETE' AND NEW."atomicCommitState" = 'COMMITTED' AND
            NEW."failureCode" IS NULL AND NEW."failureReason" IS NULL AND
            NEW."failureCategory" IS NULL AND NEW."failureDiagnosticCode" IS NULL AND
            NEW."blockerCode" = 'JOB_SCOPE_ONLY_SOURCE_NOT_CRAWLED' AND
            NEW."blockerReason" = 'Only native job ' || (job_verification_proof->>'nativeId') || ' was verified; the full source was not crawled.' AND
            NEW."rawCount" = 1 AND NEW."parsedCount" = 1 AND NEW."validCount" = 0 AND
            NEW."normalizedCount" = 0 AND NEW."dedupeInputCount" = 0 AND NEW."dedupeOutputCount" = 0 AND
            NEW."parseDiscardCount" = 0 AND NEW."validationDiscardCount" = 1 AND
            NEW."normalizationDiscardCount" = 0 AND NEW."dedupeDiscardCount" = 0 AND
            NEW."collisionCount" = 0 AND NEW."discardCount" = 1 AND
            NEW."expectedJobCount" IS NULL AND NEW."expectedEvidenceKind" IS NULL AND
            NEW."expectedSurfaceSha256" IS NULL AND NEW."visitedSurfaceSha256" IS NULL AND
            NEW."expectedChannelSha256" IS NULL AND NEW."visitedChannelSha256" IS NULL AND
            NEW."canonicalCurrentJobSetSha256" IS NULL AND NEW."canonicalGraceJobSetSha256" IS NULL AND
            NEW."canonicalVisibleJobSetSha256" IS NULL AND NEW."completenessCertificate" IS NULL AND
            NEW."completenessCertificateSha256" IS NULL AND NEW."baselinePreviousSourceResultId" IS NULL AND
            NEW."baselinePreviousJobCount" IS NULL AND NEW."baselineChangeReason" IS NULL AND
            NEW."canonicalOutputSetSha256" = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' AND
            NEW."adapterInputCount" = 0 AND NEW."adapterOutputCount" = 0 AND NEW."adapterLossCount" = 0 AND
            NEW."adapterCollisionGroupCount" = 0 AND
            NEW."adapterReconciliationSha256" = '29fd8b7943c9fbb1e9737316e7e40a8809341f460ad6679153d072ac37071446' AND
            NEW."collisionLedgerSha256" = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' AND
            NEW."startedAt" <= job_verification_captured AND
            NEW."finishedAt" >= job_verification_captured AND
            EXISTS (SELECT 1 FROM public."CrawlBatch" b WHERE b."id" = NEW."batchId" AND
                b."releaseCandidateId" = NEW."releaseCandidateId" AND b."kind"::text = 'JOB_VERIFICATION' AND
                b."status" = 'RUNNING' AND b."plannedSourceCount" = 1 AND
                b."plannedSourceIds" = '["source-novo-nordisk-china-social"]'::jsonb AND
                b."manualCrawlRequestId" IS NULL)
        ) IS TRUE THEN RAISE EXCEPTION 'JOB_VERIFICATION_TERMINAL_SHAPE'; END IF;

        IF (SELECT count(*) FROM public."CrawlObservation" o WHERE o."sourceResultId" = NEW."id") <> 1 OR
           (SELECT count(*) FROM public."EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id") <> 1 OR
           (SELECT count(*) FROM public."LossLedgerEntry" l WHERE l."sourceResultId" = NEW."id") <> 1 OR
           EXISTS (SELECT 1 FROM public."PaginationEvidence" p WHERE p."sourceResultId" = NEW."id") OR
           EXISTS (SELECT 1 FROM public."LifecycleSetEvidenceMember" m WHERE m."sourceResultId" = NEW."id") THEN
            RAISE EXCEPTION 'JOB_VERIFICATION_EVIDENCE_CARDINALITY';
        END IF;
        SELECT * INTO observation FROM public."CrawlObservation" o WHERE o."sourceResultId" = NEW."id";
        IF NOT (
            observation."releaseCandidateId" = NEW."releaseCandidateId" AND observation."batchId" = NEW."batchId" AND
            observation."sourceId" = NEW."sourceId" AND observation."successful" IS FALSE AND
            observation."transportSucceeded" IS TRUE AND observation."adapterSucceeded" IS TRUE AND
            observation."atomicCommitSucceeded" IS TRUE AND observation."completenessVerified" IS FALSE AND
            observation."completenessStatus" = 'INCOMPLETE' AND observation."failureReason" IS NULL AND
            observation."sourceConfigSha256" = NEW."sourceConfigHash" AND observation."adapterVersion" = NEW."adapterVersion" AND
            observation."rawCount" = 1 AND observation."parsedCount" = 1 AND observation."validCount" = 0 AND
            observation."normalizedCount" = 0 AND observation."dedupeInputCount" = 0 AND observation."dedupeOutputCount" = 0 AND
            observation."structuredJobCount" = 0 AND observation."parseDiscardCount" = 0 AND
            observation."validationDiscardCount" = 1 AND observation."normalizationDiscardCount" = 0 AND
            observation."dedupeDiscardCount" = 0 AND observation."discardCount" = 1 AND observation."collisionCount" = 0 AND
            observation."expectedJobCount" IS NULL AND observation."completenessEvidenceKind" IS NULL AND
            observation."completenessBlockerReason" = NEW."blockerReason" AND
            observation."expectedSurfaceSha256" IS NULL AND observation."visitedSurfaceSha256" IS NULL AND
            observation."expectedChannelSha256" IS NULL AND observation."visitedChannelSha256" IS NULL AND
            observation."canonicalRawSha256" IS NULL AND observation."canonicalOutputSha256" IS NULL AND
            observation."canonicalGraceSha256" IS NULL AND observation."canonicalVisibleSha256" IS NULL AND
            observation."paginationTraceSha256" IS NULL AND observation."totalPages" IS NULL AND
            observation."pageSize" IS NULL AND observation."pagesVisited" = 0 AND
            cardinality(observation."stableRequiredFields") = 0 AND
            observation."observedFrom" = NEW."startedAt" AND observation."observedTo" = NEW."finishedAt" AND
            observation."crawledAt" = job_verification_captured
        ) IS TRUE THEN RAISE EXCEPTION 'JOB_VERIFICATION_OBSERVATION_MISMATCH'; END IF;

        SELECT * INTO official_artifact FROM public."EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id";
        IF NOT (
            official_artifact."id" = observation."officialEvidenceArtifactId" AND
            official_artifact."releaseCandidateId" = NEW."releaseCandidateId" AND
            official_artifact."batchId" = NEW."batchId" AND official_artifact."sourceId" = NEW."sourceId" AND
            official_artifact."kind" = 'OFFICIAL_COMPANY_PAGE' AND
            official_artifact."extractorLocator" = 'novo-application-' || (job_verification_proof->>'nativeId') AND
            official_artifact."requestedUrl" = job_verification_proof->>'nativeUrl' AND
            official_artifact."finalUrl" = official_artifact."requestedUrl" AND official_artifact."httpStatus" = 200 AND
            official_artifact."contentType" LIKE 'text/html%' AND official_artifact."byteCount" > 0 AND
            official_artifact."capturedAt" = job_verification_captured AND
            official_artifact."sha256" = job_verification_proof->>'nativeBodySha256' AND
            official_artifact."redactionCommitmentSha256" = observation."artifactRedactionCommitmentSha256"
        ) IS TRUE THEN RAISE EXCEPTION 'JOB_VERIFICATION_NATIVE_ARTIFACT_MISMATCH'; END IF;

        IF NOT (
            job_verification_loss."releaseCandidateId" = NEW."releaseCandidateId" AND
            job_verification_loss."batchId" = NEW."batchId" AND job_verification_loss."sourceId" = NEW."sourceId" AND
            job_verification_loss."stage" = 'VALIDATION' AND job_verification_loss."candidateKey" IS NULL AND
            job_verification_loss."winnerKey" IS NULL AND
            job_verification_loss."reason" = 'Novo official application explicitly no longer accepts applicants' AND
            job_verification_loss."rawLocator" = 'novo-single-job-' || (job_verification_proof->>'nativeId')
        ) IS TRUE THEN RAISE EXCEPTION 'JOB_VERIFICATION_CLOSURE_PROOF_MISMATCH'; END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public."EvidenceArtifact" a JOIN public."CrawlBatchSourceResult" r ON
                r."id" = a."sourceResultId" AND r."releaseCandidateId" = a."releaseCandidateId" AND
                r."batchId" = a."batchId" AND r."sourceId" = a."sourceId"
            JOIN public."CrawlBatch" prior_batch ON prior_batch."id" = r."batchId" AND
                prior_batch."releaseCandidateId" = r."releaseCandidateId" AND prior_batch."kind" = 'SCHEDULED'
            WHERE a."id" = job_verification_proof->>'previousApplicationArtifactId' AND
                a."sourceResultId" = job_verification_proof->>'previousSourceResultId' AND
                a."sourceId" = NEW."sourceId" AND a."extractorLocator" = 'novo-application-' || (job_verification_proof->>'nativeId') AND
                a."kind" = 'OFFICIAL_COMPANY_PAGE' AND a."httpStatus" = 200 AND
                a."finalUrl" = official_artifact."finalUrl" AND a."capturedAt" < job_verification_captured AND
                r."atomicCommitState" = 'COMMITTED' AND r."completenessState" = 'VERIFIED' AND
                r."finishedAt" < job_verification_captured AND
                EXISTS (SELECT 1 FROM public."LifecycleSetEvidenceMember" m WHERE m."sourceResultId" = r."id" AND
                    m."releaseCandidateId" = r."releaseCandidateId" AND m."batchId" = r."batchId" AND
                    m."sourceId" = r."sourceId" AND m."setKind" = 'VISIBLE' AND
                    m."lifecycleStatus" = 'ACTIVE' AND m."missingCount" IN (0, 1) AND
                    m."jobKey" = job_verification_proof->>'jobKey')
        ) OR NOT EXISTS (
            SELECT 1 FROM public."Job" j JOIN public."RecruitmentSource" rs ON
                rs."id" = j."sourceId" AND rs."companyId" = j."companyId"
            WHERE j."id" = job_verification_proof->>'jobId' AND
                j."sourceId" = NEW."sourceId" AND j."companyId" = 'company-novo-nordisk-china' AND
                j."dedupeKey" = job_verification_proof->>'jobKey' AND j."officialUrl" = job_verification_proof->>'officialUrl' AND
                j."lifecycleStatus" = 'ACTIVE' AND j."visibleInFrontend" IS TRUE
        ) THEN RAISE EXCEPTION 'JOB_VERIFICATION_HISTORICAL_IDENTITY_MISMATCH'; END IF;
        RETURN NEW;
    END IF;
    -- End Novo JOB_VERIFICATION branch. Every pre-existing branch below is unchanged.
    -- BEGIN JOB DELTA RECEIPT GATE
    -- A malformed wrapper must never fall through to a permissive legacy path.
    IF (NEW."completenessCertificate" IS NULL) IS DISTINCT FROM (NEW."completenessCertificateSha256" IS NULL) THEN
        RAISE EXCEPTION 'JOB_DELTA_CERTIFICATE_HASH_PAIR_MISMATCH';
    END IF;
    IF NEW."completenessCertificate" IS NOT NULL AND
        jsonb_typeof(NEW."completenessCertificate") IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'JOB_DELTA_CERTIFICATE_NOT_OBJECT';
    END IF;
    IF NEW."completenessCertificate"->>'schemaVersion' LIKE 'job-projection-%' OR
        NEW."completenessCertificate" ?| ARRAY['legacyCertificate','legacyCertificateSha256','projectionSchemaVersion','members','manifestSha256'] THEN
        delta_receipt := NEW."completenessCertificate";
        delta_receipt_sha256 := NEW."completenessCertificateSha256";
        IF NOT (
            delta_receipt->>'schemaVersion' = 'job-projection-delta-receipt-v1' AND
            delta_receipt->>'projectionSchemaVersion' = 'job-persisted-projection-v1' AND
            delta_receipt->>'detailEvidenceState' = 'UNKNOWN' AND
            delta_receipt ?& ARRAY['schemaVersion','projectionSchemaVersion','binding','verifiedAt','observedAt','legacyCertificate','legacyCertificateSha256','detailEvidenceState','members','manifestSha256'] AND
            delta_receipt - ARRAY['schemaVersion','projectionSchemaVersion','binding','verifiedAt','observedAt','legacyCertificate','legacyCertificateSha256','detailEvidenceState','members','manifestSha256'] = '{}'::jsonb AND
            jsonb_typeof(delta_receipt->'legacyCertificate') = 'object' AND
            delta_receipt->'legacyCertificate'->>'schemaVersion' IS DISTINCT FROM 'job-projection-delta-receipt-v1' AND
            jsonb_typeof(delta_receipt->'members') = 'array' AND
            jsonb_typeof(delta_receipt->'legacyCertificateSha256') = 'string' AND
            delta_receipt->>'legacyCertificateSha256' ~ '^[0-9a-f]{64}$' AND
            jsonb_typeof(delta_receipt->'manifestSha256') = 'string' AND
            delta_receipt->>'manifestSha256' ~ '^[0-9a-f]{64}$' AND
            delta_receipt_sha256 ~ '^[0-9a-f]{64}$' AND
            delta_receipt->'binding' = jsonb_build_object('releaseCandidateId',NEW."releaseCandidateId",'batchId',NEW."batchId",'sourceId',NEW."sourceId",'sourceResultId',NEW."id") AND
            NEW."atomicCommitState" = 'COMMITTED' AND NEW."completenessState" = 'VERIFIED' AND
            jsonb_typeof(delta_receipt->'verifiedAt') = 'string' AND jsonb_typeof(delta_receipt->'observedAt') = 'string' AND
            delta_receipt->>'verifiedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' AND
            delta_receipt->>'observedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' AND
            delta_receipt->>'verifiedAt' = to_char(NEW."finishedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        ) IS TRUE THEN RAISE EXCEPTION 'JOB_DELTA_RECEIPT_SHAPE_OR_BINDING'; END IF;
        IF delta_receipt_sha256 IS DISTINCT FROM encode(sha256(convert_to(public.job_projection_canonical_json(delta_receipt),'UTF8')),'hex') OR
            delta_receipt->>'legacyCertificateSha256' IS DISTINCT FROM encode(sha256(convert_to(public.job_projection_canonical_json(delta_receipt->'legacyCertificate'),'UTF8')),'hex') THEN
            RAISE EXCEPTION 'JOB_DELTA_RECEIPT_HASH_MISMATCH';
        END IF;
        SELECT count(*), min(o."crawledAt") INTO observation_count, delta_observed
        FROM public."CrawlObservation" o WHERE o."sourceResultId" = NEW."id" AND
            o."releaseCandidateId" = NEW."releaseCandidateId" AND o."batchId" = NEW."batchId" AND o."sourceId" = NEW."sourceId";
        IF NOT (observation_count = 1 AND delta_observed <= NEW."finishedAt" AND
            delta_receipt->>'observedAt' = to_char(delta_observed, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) IS TRUE THEN
            RAISE EXCEPTION 'JOB_DELTA_OBSERVATION_MISMATCH';
        END IF;
        SELECT coalesce(jsonb_agg(m.value ORDER BY convert_to(public.job_projection_canonical_json(m.value),'UTF8')), '[]'::jsonb)
        INTO delta_manifest FROM jsonb_array_elements(delta_receipt->'members') m;
        IF delta_manifest IS DISTINCT FROM delta_receipt->'members' OR delta_receipt->>'manifestSha256' IS DISTINCT FROM
            encode(sha256(convert_to(public.job_projection_canonical_json(delta_manifest),'UTF8')),'hex') THEN
            RAISE EXCEPTION 'JOB_DELTA_MANIFEST_HASH_MISMATCH';
        END IF;
        delta_member_count := jsonb_array_length(delta_manifest);
        IF delta_member_count <> (SELECT count(*) FROM public."LifecycleSetEvidenceMember" m WHERE m."sourceResultId" = NEW."id") OR
            delta_member_count <> (SELECT count(DISTINCT (m.value->>'jobKey',m.value->>'setKind')) FROM jsonb_array_elements(delta_manifest) m) THEN
            RAISE EXCEPTION 'JOB_DELTA_MEMBER_CARDINALITY';
        END IF;
        FOR delta_member IN SELECT value FROM jsonb_array_elements(delta_manifest) LOOP
            IF NOT (
                jsonb_typeof(delta_member) = 'object' AND
                delta_member ?& ARRAY['releaseCandidateId','batchId','sourceId','sourceResultId','setKind','jobKey','jobKeySha256','lifecycleStatus','missingCount','jobProjectionSha256','lastConfirmedObservedAt','lifecycleLastSeenAt','lastPresentResultId'] AND
                delta_member - ARRAY['releaseCandidateId','batchId','sourceId','sourceResultId','setKind','jobKey','jobKeySha256','lifecycleStatus','missingCount','jobProjectionSha256','lastConfirmedObservedAt','lifecycleLastSeenAt','lastPresentResultId'] = '{}'::jsonb AND
                NOT EXISTS (SELECT 1 FROM jsonb_each(delta_member) field WHERE field.key <> 'missingCount' AND
                    (jsonb_typeof(field.value) IS DISTINCT FROM 'string' OR field.value = '""'::jsonb)) AND
                delta_member->>'lifecycleStatus' = 'ACTIVE' AND delta_member->>'setKind' IN ('CURRENT','GRACE','VISIBLE') AND
                delta_member->'missingCount' IN ('0'::jsonb,'1'::jsonb) AND
                delta_member->>'jobKeySha256' = encode(sha256(convert_to(delta_member->>'jobKey','UTF8')),'hex') AND
                delta_member->>'jobProjectionSha256' ~ '^[0-9a-f]{64}$' AND
                delta_member->>'lastConfirmedObservedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' AND
                delta_member->>'lifecycleLastSeenAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' AND
                delta_member - ARRAY['jobProjectionSha256','lastConfirmedObservedAt','lifecycleLastSeenAt','lastPresentResultId'] =
                    jsonb_build_object('releaseCandidateId',NEW."releaseCandidateId",'batchId',NEW."batchId",'sourceId',NEW."sourceId",'sourceResultId',NEW."id",'setKind',delta_member->>'setKind','jobKey',delta_member->>'jobKey','jobKeySha256',delta_member->>'jobKeySha256','lifecycleStatus','ACTIVE','missingCount',delta_member->'missingCount')
            ) IS TRUE THEN RAISE EXCEPTION 'JOB_DELTA_MEMBER_SHAPE_OR_TUPLE'; END IF;
            IF NOT EXISTS (SELECT 1 FROM public."LifecycleSetEvidenceMember" m WHERE
                m."releaseCandidateId" = NEW."releaseCandidateId" AND m."batchId" = NEW."batchId" AND m."sourceId" = NEW."sourceId" AND m."sourceResultId" = NEW."id" AND
                m."setKind"::text = delta_member->>'setKind' AND m."jobKey" = delta_member->>'jobKey' AND
                m."jobKeySha256" = delta_member->>'jobKeySha256' AND m."lifecycleStatus"::text = delta_member->>'lifecycleStatus' AND to_jsonb(m."missingCount") = delta_member->'missingCount') THEN
                RAISE EXCEPTION 'JOB_DELTA_LSEM_MISMATCH';
            END IF;
            SELECT j.* INTO delta_job FROM public."Job" j JOIN public."RecruitmentSource" s ON s."id" = j."sourceId" AND s."companyId" = j."companyId"
            WHERE j."sourceId" = NEW."sourceId" AND j."dedupeKey" = delta_member->>'jobKey';
            IF NOT FOUND THEN RAISE EXCEPTION 'JOB_DELTA_PERSISTED_JOB_MISSING'; END IF;
            IF NOT (delta_job."lifecycleStatus"::text = delta_member->>'lifecycleStatus' AND
                to_jsonb(delta_job."missingSuccessCount") = delta_member->'missingCount' AND delta_job."visibleInFrontend" IS TRUE AND
                public.job_persisted_projection_sha256(delta_job) = delta_member->>'jobProjectionSha256') IS TRUE THEN
                RAISE EXCEPTION 'JOB_DELTA_PERSISTED_PROJECTION_MISMATCH';
            END IF;
            IF delta_member->'missingCount' = '0'::jsonb THEN
                IF NOT (delta_member->>'setKind' IN ('CURRENT','VISIBLE') AND delta_member->>'lastPresentResultId' = NEW."id" AND
                    delta_member->>'lastConfirmedObservedAt' = delta_receipt->>'observedAt' AND
                    delta_member->>'lifecycleLastSeenAt' = delta_receipt->>'verifiedAt') IS TRUE THEN
                    RAISE EXCEPTION 'JOB_DELTA_CURRENT_OBSERVATION_MISMATCH';
                END IF;
            ELSE
                SELECT r.* INTO delta_history FROM public."CrawlBatchSourceResult" r WHERE r."id" = delta_member->>'lastPresentResultId' AND
                    r."id" <> NEW."id" AND r."sourceId" = NEW."sourceId" AND r."atomicCommitState" = 'COMMITTED' AND r."completenessState" = 'VERIFIED' AND
                    r."finishedAt" < NEW."finishedAt" AND EXISTS (SELECT 1 FROM public."LifecycleSetEvidenceMember" m WHERE
                        m."releaseCandidateId" = r."releaseCandidateId" AND m."batchId" = r."batchId" AND m."sourceId" = r."sourceId" AND m."sourceResultId" = r."id" AND
                        m."setKind" = 'CURRENT' AND m."lifecycleStatus" = 'ACTIVE' AND m."missingCount" = 0 AND
                        m."jobKey" = delta_member->>'jobKey' AND m."jobKeySha256" = delta_member->>'jobKeySha256');
                IF NOT FOUND OR delta_member->>'setKind' NOT IN ('GRACE','VISIBLE') THEN
                    RAISE EXCEPTION 'JOB_DELTA_GRACE_HISTORY_MISSING';
                END IF;
                SELECT count(*), min(o."crawledAt") INTO observation_count, delta_history_observed
                FROM public."CrawlObservation" o WHERE o."sourceResultId" = delta_history."id" AND
                    o."releaseCandidateId" = delta_history."releaseCandidateId" AND o."batchId" = delta_history."batchId" AND o."sourceId" = delta_history."sourceId" AND
                    o."successful" IS TRUE AND o."transportSucceeded" IS TRUE AND o."adapterSucceeded" IS TRUE AND
                    o."atomicCommitSucceeded" IS TRUE AND o."completenessVerified" IS TRUE;
                IF NOT (observation_count = 1 AND delta_history_observed <= delta_history."finishedAt" AND
                    delta_member->>'lastConfirmedObservedAt' = to_char(delta_history_observed, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND
                    delta_member->>'lifecycleLastSeenAt' = to_char(delta_history."finishedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) IS TRUE THEN
                    RAISE EXCEPTION 'JOB_DELTA_GRACE_OBSERVATION_MISMATCH';
                END IF;
                IF delta_history."completenessCertificate"->>'schemaVersion' = 'job-projection-delta-receipt-v1' THEN
                    IF delta_history."completenessCertificateSha256" IS DISTINCT FROM encode(sha256(convert_to(public.job_projection_canonical_json(delta_history."completenessCertificate"),'UTF8')),'hex') OR
                        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(delta_history."completenessCertificate"->'members') h WHERE
                            h.value->>'setKind' = 'CURRENT' AND h.value->>'sourceResultId' = delta_history."id" AND
                            h.value->>'releaseCandidateId' = delta_history."releaseCandidateId" AND h.value->>'batchId' = delta_history."batchId" AND h.value->>'sourceId' = delta_history."sourceId" AND
                            h.value->>'jobKey' = delta_member->>'jobKey' AND h.value->>'jobKeySha256' = delta_member->>'jobKeySha256' AND
                            h.value->>'lifecycleStatus' = 'ACTIVE' AND h.value->'missingCount' = '0'::jsonb AND
                            h.value->>'lastPresentResultId' = delta_history."id" AND h.value->>'lastConfirmedObservedAt' = delta_member->>'lastConfirmedObservedAt' AND
                            h.value->>'lifecycleLastSeenAt' = delta_member->>'lifecycleLastSeenAt') THEN
                        RAISE EXCEPTION 'JOB_DELTA_GRACE_PRIOR_RECEIPT_MISMATCH';
                    END IF;
                ELSIF delta_job."lastSeenAt" IS DISTINCT FROM delta_history."finishedAt" THEN
                    RAISE EXCEPTION 'JOB_DELTA_GRACE_LEGACY_LAST_SEEN_MISMATCH';
                END IF;
            END IF;
        END LOOP;
        -- One grouped pass, not one whole-manifest scan for every member.
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(delta_manifest) m GROUP BY m.value->>'jobKey'
            HAVING count(*) <> 2 OR count(*) FILTER (WHERE m.value->>'setKind' = 'VISIBLE') <> 1 OR
                count(DISTINCT (m.value - 'setKind')) <> 1) THEN
            RAISE EXCEPTION 'JOB_DELTA_MEMBER_PAIR_MISMATCH';
        END IF;
        -- Run every original SQL48 check on the unchanged inner certificate.
        NEW."completenessCertificate" := delta_receipt->'legacyCertificate';
        NEW."completenessCertificateSha256" := delta_receipt->>'legacyCertificateSha256';
    END IF;
    -- END JOB DELTA RECEIPT GATE
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
                ('source-organon-china-social','company-organon-china','d56e212c03224c44b0be11afc07709ae9b2fbfd2a69c24ce773c0f192fa603d2'),
                ('source-gilead-china-social','company-gilead-china','bdb31408948240f810347b6ba217407b0b50c9327c9600b4115a2a7a0869e40c'),
                ('source-novo-nordisk-china-social','company-novo-nordisk-china','40305820c3aa3f36e74f06873c0ddd1a52266cb74d277b3a36137c81fc5c604e'),
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
            ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC') - ((quality->'acquisition'->>'startedAt')::timestamptz AT TIME ZONE 'UTC') <= CASE WHEN (quality->'acquisition'->>'origin'='REVIEWED_RETAINED_CAPTURE' AND NEW."sourceId"='source-novo-nordisk-china-social' AND quality->'acquisition'->>'manifestSha256' ~ '^[a-f0-9]{64}$') IS TRUE THEN interval '24 hours' ELSE interval '30 minutes' END AND
            NEW."finishedAt" - ((quality->'acquisition'->>'finishedAt')::timestamptz AT TIME ZONE 'UTC') <= CASE WHEN (quality->'acquisition'->>'origin'='REVIEWED_RETAINED_CAPTURE' AND NEW."sourceId"='source-novo-nordisk-china-social' AND quality->'acquisition'->>'manifestSha256' ~ '^[a-f0-9]{64}$') IS TRUE THEN interval '24 hours' ELSE interval '30 minutes' END AND
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
        -- BEGIN EXACT JNJ DOM ADMISSION: this exception does not admit other sources or HTTP-shaped DOM evidence.
        IF official_artifact."kind" NOT IN ('OFFICIAL_COMPANY_PAGE', 'REDIRECT_TRACE', 'ATS_PAGE', 'ATS_API_RESPONSE', 'PAGINATION_PAGE') OR
           official_artifact."extractorLocator" IS NULL OR btrim(official_artifact."extractorLocator") = '' THEN
            IF NOT (
                NEW."sourceId" = 'source-johnson-innovative-medicine-social' AND
                NEW."sourceConfigHash" = '80d9610e77965de2e15efba070735e77227c70efedb543d110bb259f75782cf3' AND
                EXISTS (SELECT 1 FROM "RecruitmentSource" source WHERE source."id" = NEW."sourceId" AND
                    source."companyId" = 'company-johnson-innovative-medicine' AND source."kind" = 'SOCIAL') AND
                NEW."completenessState" = 'VERIFIED' AND NEW."expectedEvidenceKind" = 'OFFICIAL_TOTAL_COUNT' AND
                NEW."officialSurfaceIds" = ARRAY['surface-johnson-innovative-medicine-social']::text[] AND
                NEW."officialChannelIds" = ARRAY['source:source-johnson-innovative-medicine-social:default']::text[] AND
                NEW."expectedJobCount" > 0 AND NEW."rawCount" = NEW."expectedJobCount" AND
                NEW."parsedCount" = NEW."rawCount" AND NEW."validCount" = NEW."rawCount" AND
                NEW."normalizedCount" = NEW."rawCount" AND NEW."dedupeInputCount" = NEW."rawCount" AND
                NEW."dedupeOutputCount" = NEW."rawCount" AND NEW."parseDiscardCount" = 0 AND
                NEW."validationDiscardCount" = 0 AND NEW."normalizationDiscardCount" = 0 AND
                NEW."dedupeDiscardCount" = 0 AND NEW."collisionCount" = 0 AND NEW."discardCount" = 0 AND
                NEW."adapterInputCount" = NEW."rawCount" AND NEW."adapterOutputCount" = NEW."rawCount" AND
                NEW."adapterLossCount" = 0 AND NEW."adapterCollisionGroupCount" = 0 AND
                NOT EXISTS (SELECT 1 FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id") AND
                official_artifact."kind" = 'COMMAND_OUTPUT' AND
                official_artifact."extractorLocator" = 'jnj-ui-dom-list-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP' AND
                right(official_artifact."path", length('/' || official_artifact."id" || '--jnj-dom-list-0000.bin')) =
                    '/' || official_artifact."id" || '--jnj-dom-list-0000.bin' AND
                quality->>'schemaVersion' = 'a-grade-official-total-v2' AND quality->>'grade' = 'A' AND
                quality - ARRAY['schemaVersion', 'grade', 'binding', 'scope', 'declaration', 'counts',
                    'legalDedupeLedger', 'legalScopeExclusionLedger', 'pagination', 'output', 'observedAt']::text[] = '{}'::jsonb AND
                quality->'binding' = jsonb_build_object(
                    'releaseCandidateId', NEW."releaseCandidateId", 'batchId', NEW."batchId",
                    'sourceResultId', NEW."id", 'sourceId', NEW."sourceId", 'sourceConfigSha256', NEW."sourceConfigHash") AND
                quality->'scope' = jsonb_build_object(
                    'companyId', 'company-johnson-innovative-medicine', 'sourceId', NEW."sourceId",
                    'recruitmentType', 'SOCIAL', 'geography', 'MAINLAND_CHINA', 'businessUnit', 'ALL',
                    'verificationPolicy', 'STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1',
                    'surfaceIds', to_jsonb(NEW."officialSurfaceIds"), 'channelIds', to_jsonb(NEW."officialChannelIds")) AND
                quality->'declaration' = jsonb_build_object(
                    'kind', 'OFFICIAL_TOTAL_COUNT', 'scope', 'SOURCE', 'artifactLogicalKey', 'jnj-dom-list-0000',
                    'artifactSha256', official_artifact."sha256", 'extractorLocator', official_artifact."extractorLocator") AND
                quality->'counts' = jsonb_build_object(
                    'officialTotal', NEW."expectedJobCount", 'rawObservationCount', NEW."rawCount",
                    'rawUniqueOfficialRecordCount', NEW."rawCount", 'parsedCount', NEW."parsedCount",
                    'validCount', NEW."validCount", 'normalizedCount', NEW."normalizedCount",
                    'dedupeInputCount', NEW."dedupeInputCount", 'legalDedupeCount', 0,
                    'finalUniqueJobCount', NEW."dedupeOutputCount", 'parseDiscardCount', 0,
                    'validationDiscardCount', 0, 'normalizationDiscardCount', 0) AND
                quality->'legalDedupeLedger' = '[]'::jsonb AND quality->'legalScopeExclusionLedger' = '[]'::jsonb AND
                quality->'pagination' = jsonb_build_object(
                    'pageCount', pagination_count,
                    -- The A certificate commits the derived repository trace; the observation commits raw page IDs.
                    'paginationTraceSha256', (
                        SELECT encode(sha256(convert_to('[' || string_agg(row_to_json(trace)::text, ',' ORDER BY trace.sequence) || ']', 'UTF8')), 'hex')
                        FROM (
                            SELECT 'jnj-dom-list-' || lpad(p."sequence"::text, 4, '0') AS "artifactLogicalKey",
                                p."sequence", p."channelId", p."requestedCursor", p."returnedCursor",
                                p."requestedOffset", p."returnedOffset", p."requestedPage", p."returnedPage",
                                p."requestedPageSize", p."returnedPageSize", p."responseFingerprintSha256",
                                p."rawJobIdSetSha256", p."validJobIdSetSha256", p."declaredTotal", p."declaredCount",
                                p."declaredPages", p."nextPageSignalBefore", p."nextPageSignalAfter",
                                p."termination", p."anomalyCodes",
                                to_char(p."capturedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt"
                            FROM "PaginationEvidence" p WHERE p."sourceResultId" = NEW."id" AND
                                p."releaseCandidateId" = NEW."releaseCandidateId" AND p."batchId" = NEW."batchId" AND p."sourceId" = NEW."sourceId"
                        ) trace
                    ),
                    'canonicalRawOfficialIdSetSha256', observation."canonicalRawSha256") AND
                quality->'output' = jsonb_build_object(
                    'canonicalJobSetSha256', NEW."canonicalCurrentJobSetSha256",
                    'adapterReconciliationSha256', NEW."adapterReconciliationSha256",
                    'collisionLedgerSha256', NEW."collisionLedgerSha256") AND
                NEW."canonicalOutputSetSha256" = NEW."canonicalCurrentJobSetSha256" AND
                NEW."adapterReconciliationSha256" ~ '^[0-9a-f]{64}$' AND
                NEW."collisionLedgerSha256" = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' AND
                observation."canonicalRawSha256" ~ '^[0-9a-f]{64}$' AND
                observation."paginationTraceSha256" ~ '^[0-9a-f]{64}$' AND
                ((quality->>'observedAt')::timestamptz AT TIME ZONE 'UTC') = official_artifact."capturedAt" AND
                observation."crawledAt" = (SELECT min(a."capturedAt") FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id") AND
                observation."observedFrom" = NEW."startedAt" AND observation."observedTo" = NEW."finishedAt" AND
                (SELECT max(a."capturedAt") - min(a."capturedAt") FROM "EvidenceArtifact" a
                    WHERE a."sourceResultId" = NEW."id") < interval '30 minutes' AND
                -- Match the application's UTF-8-key-sorted compact canonical JSON, without adding a SQL helper.
                NEW."completenessCertificateSha256" ~ '^[0-9a-f]{64}$' AND
                NEW."completenessCertificateSha256" = (
                    WITH RECURSIVE nodes(value, sort_path, prefix) AS (
                        SELECT quality, ARRAY[]::bigint[], ''::text
                        UNION ALL
                        SELECT child.value, nodes.sort_path || child.position,
                            CASE WHEN child.position > 1 THEN ',' ELSE '' END ||
                            CASE WHEN child.key IS NULL THEN '' ELSE to_json(child.key)::text || ':' END
                        FROM nodes
                        CROSS JOIN LATERAL (
                            SELECT entries.value, entries.key,
                                row_number() OVER (ORDER BY entries.key COLLATE "C") AS position
                            FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value) = 'object' THEN nodes.value ELSE '{}'::jsonb END) entries
                            UNION ALL
                            SELECT entries.value, NULL::text, entries.position
                            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value) = 'array' THEN nodes.value ELSE '[]'::jsonb END)
                                WITH ORDINALITY entries(value, position)
                        ) child
                    ), tokens AS (
                        SELECT sort_path, prefix || CASE jsonb_typeof(value)
                            WHEN 'object' THEN '{' WHEN 'array' THEN '[' ELSE value::text END AS token FROM nodes
                        UNION ALL
                        SELECT sort_path || 9223372036854775807::bigint,
                            CASE jsonb_typeof(value) WHEN 'object' THEN '}' ELSE ']' END
                        FROM nodes WHERE jsonb_typeof(value) IN ('object', 'array')
                    )
                    SELECT encode(sha256(convert_to(string_agg(token, '' ORDER BY sort_path), 'UTF8')), 'hex') FROM tokens
                ) AND
                pagination_count = (NEW."expectedJobCount" + 19) / 20 AND pagination_count BETWEEN 1 AND 20 AND
                (observation."totalPages" IS NULL OR observation."totalPages" = pagination_count) AND observation."pageSize" = 20 AND
                (SELECT count(DISTINCT p."artifactId") FROM "PaginationEvidence" p WHERE p."sourceResultId" = NEW."id") = pagination_count AND
                NOT EXISTS (
                    SELECT 1 FROM "PaginationEvidence" p LEFT JOIN "EvidenceArtifact" a ON a."id" = p."artifactId"
                    WHERE p."sourceResultId" = NEW."id" AND (
                        p."releaseCandidateId" = NEW."releaseCandidateId" AND p."batchId" = NEW."batchId" AND
                        p."sourceId" = NEW."sourceId" AND a."sourceResultId" = NEW."id" AND
                        a."releaseCandidateId" = NEW."releaseCandidateId" AND a."batchId" = NEW."batchId" AND
                        a."sourceId" = NEW."sourceId" AND p."sequence" BETWEEN 0 AND pagination_count - 1 AND
                        p."requestedPage" = p."sequence" + 1 AND p."returnedPage" = p."requestedPage" AND
                        p."requestedOffset" = p."sequence" * 20 AND p."returnedOffset" = p."requestedOffset" AND
                        p."requestedPageSize" = 20 AND p."returnedPageSize" = 20 AND
                        p."requestedCursor" IS NULL AND p."returnedCursor" IS NULL AND p."channelId" IS NULL AND
                        p."declaredTotal" = NEW."expectedJobCount" AND p."declaredCount" = NEW."expectedJobCount" AND
                        p."declaredPages" = pagination_count AND cardinality(p."anomalyCodes") = 0 AND
                        p."termination"::text = CASE WHEN p."sequence" = pagination_count - 1 THEN 'DECLARED_TOTAL_REACHED' ELSE 'CONTINUE' END AND
                        p."nextPageSignalBefore" IS NOT DISTINCT FROM CASE WHEN p."sequence" = 0 THEN NULL ELSE 'https://www.careers.jnj.com/en/jobs/?page=' || (p."sequence" + 1)::text || '&country=China&origin=global#results' END AND
                        p."nextPageSignalAfter" IS NOT DISTINCT FROM CASE WHEN p."sequence" = pagination_count - 1 THEN NULL ELSE 'https://www.careers.jnj.com/en/jobs/?page=' || (p."sequence" + 2)::text || '&country=China&origin=global#results' END AND
                        p."responseFingerprintSha256" = a."sha256" AND p."rawJobIdSetSha256" = p."validJobIdSetSha256" AND
                        p."rawJobIdSetSha256" ~ '^[0-9a-f]{64}$' AND p."capturedAt" = a."capturedAt" AND
                        a."extractorLocator" = 'jnj-ui-dom-list-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP' AND
                        right(a."path", length('/' || a."id" || '--jnj-dom-list-0000.bin')) = '/' || a."id" || '--jnj-dom-list-' || lpad(p."sequence"::text, 4, '0') || '.bin' AND
                        (p."sequence" <> 0 OR p."artifactId" = official_artifact."id")
                    ) IS NOT TRUE
                ) AND
                NOT EXISTS (
                    SELECT 1 FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND (
                        a."releaseCandidateId" = NEW."releaseCandidateId" AND a."batchId" = NEW."batchId" AND a."sourceId" = NEW."sourceId" AND
                        a."kind" = 'COMMAND_OUTPUT' AND a."captureToolName" = 'jnj-browser-ui-dom-observation' AND a."captureToolVersion" = '1' AND
                        a."requestedUrl" IS NULL AND a."finalUrl" IS NULL AND a."httpStatus" IS NULL AND a."contentType" IS NULL AND
                        a."channelId" IS NULL AND a."sha256" ~ '^[0-9a-f]{64}$' AND a."byteCount" > 0 AND
                        a."capturedAt" BETWEEN NEW."startedAt" AND NEW."finishedAt" AND (
                            (a."extractorLocator" = 'jnj-ui-dom-list-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP' AND
                                a."path" ~ '/[0-9a-f]{64}--jnj-dom-list-[0-9]{4}[.]bin$') OR
                            (a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP' AND
                                a."path" ~ '/[0-9a-f]{64}--jnj-dom-detail-r-[0-9]+[.]bin$'))
                    ) IS NOT TRUE
                ) AND
                (SELECT count(*) FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND
                    a."extractorLocator" = 'jnj-ui-dom-list-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP') = pagination_count AND
                (SELECT count(*) FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND
                    a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP') = NEW."expectedJobCount" AND
                (SELECT count(DISTINCT substring(a."path" FROM '--(jnj-dom-detail-r-[0-9]+)[.]bin$'))
                    FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND
                    a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP') = NEW."expectedJobCount"
            ) IS TRUE THEN
                RAISE EXCEPTION 'COMMITTED source result requires a located official network artifact';
            END IF;
        END IF;
        -- END EXACT JNJ DOM ADMISSION

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
                    OR (
                        NEW."sourceId" = 'source-roche-china-social' AND
                        NEW."completenessCertificate"->>'schemaVersion' = 'a-grade-official-total-v2' AND
                        NEW."completenessCertificate"->>'grade' = 'A' AND
                        NEW."rawCount" = NEW."expectedJobCount" AND NEW."parsedCount" = NEW."rawCount" AND
                        NEW."expectedJobCount" = NEW."dedupeOutputCount" + NEW."validationDiscardCount" AND
                        NEW."validCount" = NEW."dedupeOutputCount" AND NEW."normalizedCount" = NEW."validCount" AND
                        NEW."dedupeInputCount" = NEW."validCount" AND
                        NEW."parseDiscardCount" = 0 AND NEW."validationDiscardCount" > 0 AND
                        NEW."normalizationDiscardCount" = 0 AND NEW."dedupeDiscardCount" = 0 AND
                        NEW."collisionCount" = 0 AND NEW."discardCount" = NEW."validationDiscardCount" AND
                        NEW."adapterInputCount" = NEW."dedupeOutputCount" AND
                        NEW."adapterOutputCount" = NEW."dedupeOutputCount" AND NEW."adapterLossCount" = 0 AND
                        NEW."adapterCollisionGroupCount" = 0 AND grifols_scope_exclusion_count = NEW."validationDiscardCount" AND
                        jsonb_array_length(NEW."completenessCertificate"->'legalScopeExclusionLedger') = NEW."validationDiscardCount" AND
                        (
                            SELECT count(DISTINCT loss."rawLocator") FROM "LossLedgerEntry" loss
                            WHERE loss."sourceResultId" = NEW."id" AND
                                  loss."releaseCandidateId" = NEW."releaseCandidateId" AND
                                  loss."batchId" = NEW."batchId" AND loss."sourceId" = NEW."sourceId" AND
                                  loss."stage" = 'VALIDATION' AND
                                  loss."reason" = 'Roche approved official denial isolated; preserve existing row and its time' AND
                                  loss."details"->>'code' = 'ROCHE_DETAIL_DENIED' AND
                                  loss."details"->>'noteCode' = 'NO_OMISSION_NOT_VERIFIED' AND
                                  NEW."completenessCertificate"->'legalScopeExclusionLedger' @> jsonb_build_array(jsonb_build_object(
                                      'rawLocatorSha256', encode(sha256(convert_to(loss."rawLocator",'UTF8')),'hex'),
                                      'recordIndex', loss."details"->'recordIndex', 'code', 'ROCHE_DETAIL_DENIED'))
                        ) = NEW."validationDiscardCount" AND (
                            SELECT count(DISTINCT artifact."requestedUrl") FROM "EvidenceArtifact" artifact
                            WHERE artifact."sourceResultId" = NEW."id" AND
                                  artifact."releaseCandidateId" = NEW."releaseCandidateId" AND
                                  artifact."batchId" = NEW."batchId" AND artifact."sourceId" = NEW."sourceId" AND
                                  artifact."kind" = 'ATS_API_RESPONSE' AND artifact."httpStatus" = 403 AND
                                  artifact."requestedUrl" = artifact."finalUrl" AND
                                  artifact."requestedUrl" ~ '^https://roche[.]wd3[.]myworkdayjobs[.]com/wday/cxs/roche/roche-ext/job/[^/?#]+/[^/?#]*_[0-9]{6}-[0-9]+(-[1-9][0-9]*)?$' AND
                                  artifact."extractorLocator" = 'roche-workday-jobposting-v1' AND
                                  artifact."capturedAt" BETWEEN NEW."startedAt" AND NEW."finishedAt"
                        ) = NEW."validationDiscardCount"
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
    -- BEGIN JOB DELTA RECEIPT RESTORE
    IF delta_receipt IS NOT NULL THEN
        NEW."completenessCertificate" := delta_receipt;
        NEW."completenessCertificateSha256" := delta_receipt_sha256;
    END IF;
    -- END JOB DELTA RECEIPT RESTORE
    RETURN NEW;
END;
$function$
