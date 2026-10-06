import { createHash } from "node:crypto";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA, type SourceQualityReceipt } from "../../src/crawler/sourceQualityAdmission";
import type { PortableSourceResultRow, PortableLifecycleMemberRow, PortableJobRow } from "../../src/db/portablePublicSnapshotRepository";
export const NOW = new Date("2026-10-01T12:00:00.000Z");
export const FIRST = "2026-10-01T00:00:00.000Z";
export const SECOND = "2026-10-01T11:00:00.000Z";
export const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-hansoh-social")!;
const SHA = "a".repeat(64);
export function digest(value: unknown): string {
  function canonical(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    if (v && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
    return JSON.stringify(v);
  }
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function accepted(at = FIRST, keys = ["job-1"], grace: string[] = [], currentPlan = plan) {
  const plan = currentPlan;
  const id = `result-${Date.parse(at)}`;
  const binding = { releaseCandidateId: "portable-reader", batchId: `batch-${Date.parse(at)}`, sourceResultId: id, sourceId: plan.source.id, sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: SHA };
  const currentKeys = keys.map(key => `${plan.source.id}:${key}`);
  const graceKeys = grace.map(key => `${plan.source.id}:${key}`);
  const receipt: SourceQualityReceipt = {
    schemaVersion: SOURCE_QUALITY_RECEIPT_SCHEMA, policyId: SOURCE_QUALITY_POLICY_ID, proofBasis: "PLAN_BOUND_ARCHIVED_RESPONSE_REPLAY",
    binding, companyId: plan.company.id,
    acquisition: { id: "00000000-0000-4000-8000-000000000001", startedAt: at, finishedAt: at }, issuedAt: at,
    surfaceIds: [plan.source.surfaceId!], channelIds: plan.expectedChannels!.map(c => c.channelId).sort(),
    sourceEvidenceSha256: SHA, artifactManifestSha256: SHA, paginationTraceSha256: SHA, paginationRowsSha256: SHA, canonicalRawEvidenceIdSetSha256: SHA,
    counts: { rawCount: keys.length, parsedCount: keys.length, validCount: keys.length, parseDiscardCount: 0, validationDiscardCount: 0, normalizationDiscardCount: 0, dedupeInputCount: keys.length, dedupeDiscardCount: 0, collisionCount: 0, finalUniqueJobCount: keys.length },
    ledger: { adapterReconciliationSha256: SHA, fetchLossLedgerSha256: SHA, collisionLedgerSha256: SHA, atomicLossLedgerSha256: SHA },
    output: { canonicalJobKeySetSha256: hashCanonicalStringSet(currentKeys), jobsSha256: SHA },
    observation: { crawledAt: at, expectedJobCount: keys.length, expectedEvidenceKind: "OFFICIAL_TOTAL_COUNT", stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"] },
    declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: keys.length, scope: "SOURCE" }
  };
  const result: PortableSourceResultRow = {
    id, releaseCandidateId: binding.releaseCandidateId, batchId: binding.batchId, sourceId: plan.source.id,
    sourceConfigHash: binding.sourceConfigSha256, adapterVersion: SHA,
    transportState: "SUCCEEDED", adapterState: "SUCCEEDED", completenessState: "VERIFIED", atomicCommitState: "COMMITTED",
    failureCode: null, failureReason: null, blockerCode: null, blockerReason: null,
    failureCategory: null, failureDiagnosticCode: null, fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [],
    expectedSurfaceSha256: null, visitedSurfaceSha256: null, expectedChannelSha256: null, visitedChannelSha256: null,
    observations: [],
    _count: {transportAttempts: 1, evidenceArtifacts: 1, observations: 1, paginationEvidence: 1, lossLedgerEntries: 0, lifecycleSetMembers: keys.length * 2},
    startedAt: new Date(at), finishedAt: new Date(at), dedupeOutputCount: keys.length,
    rawCount: keys.length, parsedCount: keys.length, validCount: keys.length, normalizedCount: keys.length, dedupeInputCount: keys.length,
    parseDiscardCount: 0, validationDiscardCount: 0, normalizationDiscardCount: 0, dedupeDiscardCount: 0, collisionCount: 0,
    adapterInputCount: keys.length, adapterOutputCount: keys.length, adapterLossCount: 0, adapterCollisionGroupCount: 0, discardCount: 0,
    expectedJobCount: keys.length, expectedEvidenceKind: "OFFICIAL_TOTAL_COUNT",
    officialSurfaceIds: [...receipt.surfaceIds], officialChannelIds: [...receipt.channelIds],
    canonicalCurrentJobSetSha256: hashCanonicalStringSet(currentKeys), canonicalGraceJobSetSha256: hashCanonicalStringSet(graceKeys), canonicalVisibleJobSetSha256: hashCanonicalStringSet([...currentKeys, ...graceKeys]), canonicalOutputSetSha256: hashCanonicalStringSet(currentKeys),
    adapterReconciliationSha256: SHA, collisionLedgerSha256: SHA,
    completenessCertificate: receipt, completenessCertificateSha256: digest(receipt),
    batch: { id: binding.batchId, releaseCandidateId: binding.releaseCandidateId, kind: "SCHEDULED", status: "SUCCESS", commitSha: "a".repeat(40), rosterSha256: SHA, sourcePlanSha256: SHA,
      sourceConfigSha256: SHA, adapterBundleSha256: SHA, startedAt: new Date(at), finishedAt: new Date(at) }
  };
  const members: PortableLifecycleMemberRow[] = [...currentKeys.map(jobKey => ({ jobKey, missingCount: 0 })), ...graceKeys.map(jobKey => ({ jobKey, missingCount: 1 }))].flatMap(({jobKey, missingCount}) =>
    [missingCount === 0 ? "CURRENT" as const : "GRACE" as const, "VISIBLE" as const].map(setKind => ({
      releaseCandidateId: binding.releaseCandidateId, batchId: binding.batchId, sourceId: plan.source.id, sourceResultId: id,
      setKind, jobKey, jobKeySha256: createHash("sha256").update(jobKey).digest("hex"), lifecycleStatus: "ACTIVE" as const, missingCount
    })));
  return { result, receipt, members };
}
export function job(key = "job-1", lastSeen = FIRST, missing = 0): PortableJobRow {
  return { id: key, companyId: plan.company.id, sourceId: plan.source.id, dedupeKey: `${plan.source.id}:${key}`, sourceJobId: key, listUrl: null,
    officialTitle: "销售职位", auxiliaryChineseTitle: null, humanCorrectedTitle: null, officialUrl: `https://hspharm.zhiye.com/social/detail?jobAdId=${key}`, officialPublishedAt: null,
    city: "上海", cities: ["上海"], locationRaw: "上海", category: "SALES", humanCorrectedCategory: null, isNew: false,
    lastSeenAt: new Date(lastSeen), lifecycleStatus: "ACTIVE", visibleInFrontend: true, missingSuccessCount: missing };
}
export function failed(at = SECOND): PortableSourceResultRow {
  const row = accepted(at, []).result;
  return {...row, transportState: "FAILED", adapterState: "SKIPPED", completenessState: "FAILED", atomicCommitState: "NOT_ATTEMPTED", completenessCertificate: null, completenessCertificateSha256: null, failureCode: "FETCH_FAILED"};
}

/** Exact persisted shape created when batch closure precedes source acquisition. */
export function unstartedAbort(at = SECOND, transportState: "FAILED" | "SKIPPED" = "FAILED"): PortableSourceResultRow {
  const row = failed(at);
  return {...row, transportState, failureCode: "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL",
    failureReason: "Batch aborted before this source reached a terminal state",
    failureCategory: "UNCLASSIFIED_SOURCE_FAILURE", failureDiagnosticCode: "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL",
    fetchAttemptCount: 0, retryCount: 0, retryReasonCodes: [],
    expectedJobCount: null, expectedEvidenceKind: null,
    adapterInputCount: null, adapterOutputCount: null, adapterLossCount: null, adapterCollisionGroupCount: null,
    canonicalCurrentJobSetSha256: null, canonicalGraceJobSetSha256: null, canonicalVisibleJobSetSha256: null,
    canonicalOutputSetSha256: null, adapterReconciliationSha256: null, collisionLedgerSha256: null,
    expectedSurfaceSha256: null, visitedSurfaceSha256: null, expectedChannelSha256: null, visitedChannelSha256: null,
    observations: [],
    _count: {transportAttempts: 0, evidenceArtifacts: 0, observations: 0, paginationEvidence: 0, lossLedgerEntries: 0, lifecycleSetMembers: 0},
    batch: {...row.batch, status: "FAILED"}
  } as PortableSourceResultRow;
}
export const ambiguousAbortMutations: [string, (row: any) => void][] = [
  ["started request", row => {row.fetchAttemptCount = 1;}],
  ["unknown request count", row => {row.fetchAttemptCount = null;}],
  ["unknown retry count", row => {row.retryCount = null;}],
  ["retry", row => {row.retryCount = 1;}],
  ["retry reason", row => {row.retryReasonCodes = ["OFFICIAL_HTTP_503"];}],
  ["missing diagnostics", row => {row.failureDiagnosticCode = null;}],
  ["started diagnostic", row => {row.failureDiagnosticCode = "FETCH_EXECUTION_FAILED";}],
  ["transport evidence", row => {row._count.transportAttempts = 1;}],
  ["artifact evidence", row => {row._count.evidenceArtifacts = 1;}],
  ["missing evidence counts", row => {delete row._count;}],
  ["observation", row => {row._count.observations = 1;}],
  ["pagination", row => {row._count.paginationEvidence = 1;}],
  ["loss ledger", row => {row._count.lossLedgerEntries = 1;}],
  ["lifecycle membership", row => {row._count.lifecycleSetMembers = 1;}],
  ["produced row", row => {row.rawCount = 1;}],
  ["expected count", row => {row.expectedJobCount = 0;}],
  ["certificate", row => {row.completenessCertificate = {};}],
  ["certificate hash", row => {row.completenessCertificateSha256 = SHA;}],
  ["committed", row => {row.atomicCommitState = "COMMITTED";}],
  ["adapter started", row => {row.adapterState = "FAILED";}],
  ["batch binding", row => {row.batch.id = "wrong";}],
  ["release binding", row => {row.batch.releaseCandidateId = "wrong";}],
  ["successful batch", row => {row.batch.status = "SUCCESS";}]
];
