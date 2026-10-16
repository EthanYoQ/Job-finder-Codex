ALTER TABLE "CrawlBatchSourceResult"
ADD COLUMN "baselinePreviousSourceResultId" TEXT,
ADD COLUMN "baselinePreviousJobCount" INTEGER,
ADD COLUMN "baselineChangeReason" TEXT;

ALTER TABLE "CrawlBatchSourceResult"
ADD CONSTRAINT "CrawlBatchSourceResult_baseline_transition_shape_check"
CHECK (
  ("baselineChangeReason" IS NULL
    AND "baselinePreviousSourceResultId" IS NULL
    AND "baselinePreviousJobCount" IS NULL)
  OR
  ("baselineChangeReason" IS NOT NULL
    AND "completenessState" = 'VERIFIED'
    AND "completenessCertificate" IS NOT NULL
    AND "baselineChangeReason" IN (
      'OFFICIAL_EVIDENCE_CONFIRMED_INITIAL',
      'OFFICIAL_EVIDENCE_CONFIRMED_INCREASE',
      'OFFICIAL_EVIDENCE_CONFIRMED_DECREASE',
      'OFFICIAL_EVIDENCE_CONFIRMED_UNCHANGED',
      'INDEPENDENT_VALIDATION_CONFIRMED_INITIAL',
      'INDEPENDENT_VALIDATION_CONFIRMED_INCREASE',
      'INDEPENDENT_VALIDATION_CONFIRMED_DECREASE',
      'INDEPENDENT_VALIDATION_CONFIRMED_UNCHANGED'
    )
    AND (
      ("baselineChangeReason" IN (
          'OFFICIAL_EVIDENCE_CONFIRMED_INITIAL',
          'INDEPENDENT_VALIDATION_CONFIRMED_INITIAL'
        )
        AND "baselinePreviousSourceResultId" IS NULL
        AND "baselinePreviousJobCount" IS NULL)
      OR
      ("baselinePreviousSourceResultId" IS NOT NULL
        AND "baselinePreviousSourceResultId" <> "id"
        AND "baselinePreviousJobCount" >= 0
        AND (
          ("baselineChangeReason" IN (
              'OFFICIAL_EVIDENCE_CONFIRMED_INCREASE',
              'INDEPENDENT_VALIDATION_CONFIRMED_INCREASE'
            ) AND "dedupeOutputCount" > "baselinePreviousJobCount")
          OR
          ("baselineChangeReason" IN (
              'OFFICIAL_EVIDENCE_CONFIRMED_DECREASE',
              'INDEPENDENT_VALIDATION_CONFIRMED_DECREASE'
            ) AND "dedupeOutputCount" < "baselinePreviousJobCount")
          OR
          ("baselineChangeReason" IN (
              'OFFICIAL_EVIDENCE_CONFIRMED_UNCHANGED',
              'INDEPENDENT_VALIDATION_CONFIRMED_UNCHANGED'
            ) AND "dedupeOutputCount" = "baselinePreviousJobCount")
        ))
    )
    AND (
      ("baselineChangeReason" LIKE 'OFFICIAL_EVIDENCE_CONFIRMED_%'
        AND "completenessCertificate"->>'grade' = 'A')
      OR
      ("baselineChangeReason" LIKE 'INDEPENDENT_VALIDATION_CONFIRMED_%'
        AND "completenessCertificate"->>'grade' = 'B')
    ))
);
