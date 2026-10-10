ALTER TABLE "CrawlBatchSourceResult"
DROP CONSTRAINT "CrawlBatchSourceResult_loss_reconciliation_check";

ALTER TABLE "CrawlBatchSourceResult"
ADD CONSTRAINT "CrawlBatchSourceResult_loss_reconciliation_check" CHECK (
    "rawCount" = "parsedCount" + "parseDiscardCount" AND
    "parsedCount" = "validCount" + "validationDiscardCount" AND
    (
        (
            "atomicCommitState" = 'NOT_ATTEMPTED' AND
            "completenessState" = 'FAILED' AND
            "adapterState" IN ('FAILED', 'SKIPPED') AND
            "normalizedCount" = 0 AND
            "dedupeInputCount" = 0 AND
            "dedupeOutputCount" = 0 AND
            "normalizationDiscardCount" = 0 AND
            "dedupeDiscardCount" = 0 AND
            "collisionCount" = 0 AND
            "discardCount" = "parseDiscardCount" + "validationDiscardCount"
        ) OR (
            "validCount" = "normalizedCount" + "normalizationDiscardCount" AND
            "normalizedCount" = "dedupeInputCount" AND
            "dedupeInputCount" = "dedupeOutputCount" + "dedupeDiscardCount" AND
            "discardCount" = "parseDiscardCount" + "validationDiscardCount" +
                "normalizationDiscardCount" + "dedupeDiscardCount"
        )
    ) AND
    "rawCount" >= 0 AND "parsedCount" >= 0 AND "validCount" >= 0 AND "normalizedCount" >= 0 AND
    "dedupeInputCount" >= 0 AND "dedupeOutputCount" >= 0 AND
    "parseDiscardCount" >= 0 AND "validationDiscardCount" >= 0 AND
    "normalizationDiscardCount" >= 0 AND "dedupeDiscardCount" >= 0 AND
    "discardCount" >= 0 AND "collisionCount" >= 0
);
