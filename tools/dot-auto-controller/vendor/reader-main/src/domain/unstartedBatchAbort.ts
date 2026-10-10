import type { PortableSourceResultRow } from "../db/portablePublicSnapshotRepository";

export const BATCH_ABORTED_BEFORE_SOURCE_TERMINAL = "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL";
const zeroCounts = ["rawCount", "parsedCount", "validCount", "normalizedCount", "dedupeInputCount", "dedupeOutputCount",
  "parseDiscardCount", "validationDiscardCount", "normalizationDiscardCount", "dedupeDiscardCount", "collisionCount", "discardCount"] as const;
const absentOutputs = ["expectedJobCount", "expectedEvidenceKind", "expectedSurfaceSha256", "visitedSurfaceSha256",
  "expectedChannelSha256", "visitedChannelSha256", "canonicalCurrentJobSetSha256", "canonicalGraceJobSetSha256",
  "canonicalVisibleJobSetSha256", "canonicalOutputSetSha256", "adapterInputCount", "adapterOutputCount", "adapterLossCount",
  "adapterCollisionGroupCount", "adapterReconciliationSha256", "collisionLedgerSha256", "completenessCertificate",
  "completenessCertificateSha256", "blockerCode", "blockerReason"] as const;
const evidenceRelations = ["transportAttempts", "evidenceArtifacts", "observations", "paginationEvidence", "lossLedgerEntries", "lifecycleSetMembers"] as const;
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/** Only an exact empty terminal result proves that recruitment was never attempted.
 * Missing counters or relation counts are unknown, never equivalent to zero.
 * Callers must first bind the result to the current source/configuration.
 * RUNNING is only used by persisted batch accounting before finalization. */
export function isProvenUnstartedBatchAbort(
  row: Partial<PortableSourceResultRow>, now: Date, expectedBatchStatus: "FAILED" | "RUNNING" = "FAILED"
): boolean {
  return row.failureCode === BATCH_ABORTED_BEFORE_SOURCE_TERMINAL &&
    row.failureDiagnosticCode === BATCH_ABORTED_BEFORE_SOURCE_TERMINAL &&
    row.failureCategory === "UNCLASSIFIED_SOURCE_FAILURE" &&
    row.failureReason === "Batch aborted before this source reached a terminal state" &&
    (row.transportState === "FAILED" || row.transportState === "SKIPPED") && row.adapterState === "SKIPPED" &&
    row.completenessState === "FAILED" && row.atomicCommitState === "NOT_ATTEMPTED" &&
    row.fetchAttemptCount === 0 && row.retryCount === 0 && Array.isArray(row.retryReasonCodes) && row.retryReasonCodes.length === 0 &&
    typeof row.batchId === "string" && row.batchId.length > 0 && typeof row.releaseCandidateId === "string" && row.releaseCandidateId.length > 0 &&
    row.batch?.id === row.batchId && row.batch.releaseCandidateId === row.releaseCandidateId &&
    row.batch.kind === "SCHEDULED" && row.batch.status === expectedBatchStatus &&
    validDate(now) && validDate(row.startedAt) && validDate(row.finishedAt) && row.startedAt <= row.finishedAt && row.finishedAt <= now &&
    zeroCounts.every(key => row[key] === 0) && absentOutputs.every(key => row[key] === null) &&
    evidenceRelations.every(key => row._count?.[key] === 0);
}
