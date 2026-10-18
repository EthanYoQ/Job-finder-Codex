import { isJobProjectionDeltaReceipt, verifyJobProjectionDeltaReceipt, hashJobPersistedProjection, type JobProjectionDeltaReceipt, type JobProjectionMember } from "./jobProjectionDeltaReceipt";
import { SANOFI_HISTORICAL_PUBLIC_PLAN } from "./sanofiHistoricalPublicPlan";
import { isSanofiPublicTransitionPlan, isSanofiHistoricalPublicCandidate, assertSanofiHistoricalPublicRow } from "./sanofiPublicTransition";
import { getPortableCoverageScope } from "../release/portableCoveragePolicy";
import { B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION, SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION, isCurrentBGradeCertificateSchema, requiresBGradeTraversalCertificate, verifyBGradeTraversalCertificateReceipt, type BGradeTraversalCertificate } from "../crawler/traversalCertificate";
import { candidateCompanies } from "../data/companyRegistry";
import { buildStagedSourceCrawlPlans } from "../crawler/sourcePlan";
import { supportsStrictOfficialTotalCertificate } from "../crawler/runSourceCrawl";
import { isProvenUnstartedBatchAbort } from "./unstartedBatchAbort";
import { getPortableSourceCoverageHold } from "../release/portableSourceCoverageHolds";
import { createHash } from "node:crypto";
import { getSourceQualityPolicy, SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA, verifySourceQualityReceipt, type SourceQualityReceipt } from "../crawler/sourceQualityAdmission";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { hashCanonicalStringSet } from "../crawler/runtimeBatchIdentity";
import { fromPrismaJobCategory } from "../db/prismaMappers";
import type { PortableSourceResultRow, PortableLifecycleMemberRow, PortableJobRow } from "../db/portablePublicSnapshotRepository";
import { DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS } from "./publicationEligibility";
import { A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION, verifyAGradeCompletenessCertificateReceipt, verifySanofiHistoricalPublicReceipt, type AGradeOfficialTotalCertificate } from "../crawler/completenessCertificate";
import type { DatabaseSearchJobResult } from "../server/jobSearchService";

const A_GRADE_PUBLIC_POLICY = "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1" as const;
// Bind real A receipts to the actual current canonical plan, rather than a
// second per-company list. Existing issuer scope and membership checks remain.
const A_GRADE_PUBLIC_CONFIGS: Readonly<Record<string,string>>=Object.freeze(Object.fromEntries(
  buildStagedSourceCrawlPlans(candidateCompanies).filter(plan=>getPortableCoverageScope().requiredSourceIds.includes(plan.source.id)&&supportsStrictOfficialTotalCertificate(plan))
    .map(plan=>[plan.source.id,sourcePlanConfigSha256(plan)])));
const SANOFI_COMPACT_PUBLIC_POLICY = "PRE_COMMIT_DUAL_CHAIN_ATTESTATION_V1" as const;
const B_GRADE_PUBLIC_POLICY = "STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2" as const;
// Only reviewed source-specific COMPLETE_PAGE_TRAVERSAL integrations are public here.
const B_GRADE_PUBLIC_CONFIGS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  buildStagedSourceCrawlPlans(candidateCompanies).filter(plan =>
    ["source-pfizer-china-social", "source-bayer-healthcare-social", "source-servier-china-social", "source-sanofi-china-social"].includes(plan.source.id) &&
    getPortableCoverageScope().requiredSourceIds.includes(plan.source.id) && requiresBGradeTraversalCertificate(plan))
    .map(plan => [plan.source.id, sourcePlanConfigSha256(plan)])));
type PublicBReceipt = Extract<BGradeTraversalCertificate, {schemaVersion: typeof B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION | typeof SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION}>;
type PublicReceipt = SourceQualityReceipt | AGradeOfficialTotalCertificate | PublicBReceipt;

export interface PortableSnapshotOptions {
  currentTime: Date;
  /** May tighten the 30-hour stale threshold, never relax it. Age alone does not hide accepted jobs. */
  freshnessMaximumMs?: number;
}
export type PortableSnapshotReason =
  | "SOURCE_COVERAGE_REVIEW_PENDING" | "USER_AUTHORIZED_EXCLUSION" | "UNSUPPORTED_CURRENT_POLICY" | "CURRENT_CONFIG_HAS_NO_ACCEPTED_RECEIPT"
  | "RECEIPT_INTEGRITY_HOLD" | "LATEST_ATTEMPT_FAILED" | "LATEST_ATTEMPT_RUNNING"
  | "LAST_GOOD_STALE" | "PROJECTION_INTEGRITY_HOLD" | "STALE_JOB_ROWS";
export interface PortableSourceStatus {
  companyId: string;
  sourceId: string;
  currentConfigSha256: string;
  policyId: typeof SOURCE_QUALITY_POLICY_ID | typeof A_GRADE_PUBLIC_POLICY | typeof B_GRADE_PUBLIC_POLICY | typeof SANOFI_COMPACT_PUBLIC_POLICY | null;
  state: "PUBLISHING" | "HOLD" | "EXCLUDED";
  health: "HEALTHY" | "DEGRADED" | "UNVERIFIED" | "NOT_APPLICABLE";
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  reasons: PortableSnapshotReason[];
  visibilityFloor: string | null;
  selectedSourceResultId: string | null;
  lastAttemptAt: string | null;
  lastAcceptedAt: string | null;
  lastSuccessAt: string | null;
  /** Count of jobs observed in the accepted crawl, not a failed attempt or grace-set size. */
  lastAcceptedJobCount: number | null;
  /** Counts of the verified Servier portal, separate from its China-only public projection. */
  sourceScopeSummary?: {portalJobCount: number; verifiedChinaJobCount: number; unknownCountryJobCount: number};
}
export interface PortableSourceSelection extends PortableSourceStatus {
  /** Internal only. Never return receipts or raw source-result diagnostics from the API. */
  selected: AcceptedPortableSource | null;
}
interface AcceptedPortableSource {
  result: PortableSourceResultRow;
  receipt: PublicReceipt;
  deltaReceipt?: JobProjectionDeltaReceipt;
  /** Original receipt validation at its acceptance time, never a new observation. */
  historicalObservations?: Map<string, AcceptedPortableSource>;
}
export interface PortablePublicJob extends DatabaseSearchJobResult {
  companyId: string;
  sourceId: string;
  sourceResultId: string;
  cities: string[];
  lastSeenAt: string;
  lastConfirmedObservedAt?: string;
  inGrace: boolean;
}
export interface PortableProjectedSource extends PortableSourceStatus {
  /** Null means unavailable/integrity hold, whereas zero is an actual verified empty projection. */
  visibleJobCount: number | null;
  staleJobCount: number;
  jobs: PortablePublicJob[];
}
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const validDate = (date: unknown): date is Date => date instanceof Date && Number.isFinite(date.getTime());
function maximumAge(options: PortableSnapshotOptions): number {
  const maximum = options.freshnessMaximumMs ?? DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS;
  if (!validDate(options.currentTime) || !Number.isFinite(maximum) || maximum <= 0 || maximum > DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS) {
    throw new Error("INVALID_PORTABLE_PUBLICATION_FRESHNESS");
  }
  return maximum;
}
function fresh(iso: string, options: PortableSnapshotOptions): boolean {
  const age = options.currentTime.getTime() - Date.parse(iso);
  return age >= 0 && age < maximumAge(options);
}
function supportsPublicAGrade(plan: SourceCrawlPlan): boolean {
  return A_GRADE_PUBLIC_CONFIGS[plan.source.id] === sourcePlanConfigSha256(plan);
}
export function supportsPublicBGrade(plan: SourceCrawlPlan): boolean {
  return B_GRADE_PUBLIC_CONFIGS[plan.source.id] === sourcePlanConfigSha256(plan);
}
function observedAt(receipt: PublicReceipt, row: PortableSourceResultRow): string {
  return receipt.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION ? receipt.observedAt :
    (receipt.schemaVersion === B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION || receipt.schemaVersion === SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION) ? row.observations[0]!.crawledAt.toISOString() : receipt.observation.crawledAt;
}
/** Delta manifests commit the original crawl observation, which can precede
 * an A certificate's independent official-total observation. Keep the latter
 * as source freshness/quality authority; bind job sightings to the former. */
function deltaObservationAt(receipt: PublicReceipt, row: PortableSourceResultRow): string {
  if (receipt.schemaVersion !== A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION) return observedAt(receipt, row);
  const observation = row.observations?.[0];
  if (row.observations?.length !== 1 || !observation ||
      !validDate(row.startedAt) || !validDate(row.finishedAt) ||
      !validDate(observation.observedFrom) || !validDate(observation.observedTo) || !validDate(observation.crawledAt) ||
      observation.observedFrom.getTime() !== row.startedAt.getTime() || observation.observedTo.getTime() !== row.finishedAt.getTime() ||
      observation.crawledAt < row.startedAt || observation.crawledAt > row.finishedAt ||
      observation.sourceId !== row.sourceId || observation.sourceResultId !== row.id || observation.batchId !== row.batchId ||
      observation.releaseCandidateId !== row.releaseCandidateId || observation.sourceConfigSha256 !== row.sourceConfigHash ||
      observation.adapterVersion !== row.adapterVersion || observation.successful !== true || observation.transportSucceeded !== true ||
      observation.adapterSucceeded !== true || observation.completenessVerified !== true || observation.atomicCommitSucceeded !== true ||
      observation.canonicalOutputSha256 !== row.canonicalOutputSetSha256) throw new Error("PORTABLE_DELTA_OBSERVATION_DRIFT");
  return observation.crawledAt.toISOString();
}
function acceptedAt(selected: NonNullable<PortableSourceSelection["selected"]>): string {
  return selected.result.finishedAt!.toISOString();
}
function claimedReceipt(row: PortableSourceResultRow, plan: SourceCrawlPlan): boolean {
  const receipt = row.completenessCertificate as {schemaVersion?: unknown; policyId?: unknown} | null;
  if (isSanofiPublicTransitionPlan(plan)) {
    if (isSanofiHistoricalPublicCandidate(row)) return receipt?.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION;
    if (row.sourceConfigHash !== sourcePlanConfigSha256(plan)) return false;
  }
  return isJobProjectionDeltaReceipt(receipt) || receipt?.schemaVersion === SOURCE_QUALITY_RECEIPT_SCHEMA || receipt?.policyId === SOURCE_QUALITY_POLICY_ID ||
    receipt?.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION && supportsPublicAGrade(plan) ||
    isCurrentBGradeCertificateSchema(receipt?.schemaVersion) && supportsPublicBGrade(plan);
}
function verifyAcceptedAGrade(row: PortableSourceResultRow, plan: SourceCrawlPlan, now: Date): AGradeOfficialTotalCertificate {
  const fail = (): never => { throw new Error("PUBLIC_A_GRADE_RECEIPT_DRIFT"); };
  const historicalSanofi = isSanofiPublicTransitionPlan(plan) && isSanofiHistoricalPublicCandidate(row);
  if (historicalSanofi) assertSanofiHistoricalPublicRow(row, plan);
  else if (!supportsPublicAGrade(plan)) fail();
  const receiptPlan = historicalSanofi ? SANOFI_HISTORICAL_PUBLIC_PLAN : plan;
  const verifyReceipt = historicalSanofi ? verifySanofiHistoricalPublicReceipt : verifyAGradeCompletenessCertificateReceipt;
  verifyReceipt({certificate: row.completenessCertificate, certificateSha256: row.completenessCertificateSha256 ?? "", expected: {
    releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceResultId: row.id,
    sourceId: plan.source.id, companyId: plan.company.id, sourceConfigSha256: sourcePlanConfigSha256(receiptPlan),
    surfaceIds: [receiptPlan.source.surfaceId!], channelIds: receiptPlan.expectedChannels!.map(channel => channel.channelId),
    canonicalJobSetSha256: row.canonicalOutputSetSha256 ?? "", adapterReconciliationSha256: row.adapterReconciliationSha256 ?? "",
    collisionLedgerSha256: row.collisionLedgerSha256 ?? ""
  }});
  // Keep the original verified certificate, without manufacturing a portable receipt.
  const receipt = row.completenessCertificate as AGradeOfficialTotalCertificate;
  const observationTime = Date.parse(receipt.observedAt);
  if (row.sourceId !== plan.source.id || row.sourceConfigHash !== receipt.binding.sourceConfigSha256 ||
      row.batch.id !== row.batchId || row.batch.releaseCandidateId !== row.releaseCandidateId || row.batch.kind !== "SCHEDULED" ||
      row.transportState !== "SUCCEEDED" || row.adapterState !== "SUCCEEDED" || row.completenessState !== "VERIFIED" || row.atomicCommitState !== "COMMITTED" ||
      row.failureCode || row.failureReason || row.blockerCode || row.blockerReason ||
      !validDate(row.startedAt) || !validDate(row.finishedAt) || row.finishedAt.getTime() > now.getTime() ||
      observationTime < row.startedAt.getTime() || observationTime > row.finishedAt.getTime()) fail();
  const count = receipt.counts, collisions = receipt.legalDedupeLedger.length;
  const counts = {rawCount: count.rawObservationCount, parsedCount: count.parsedCount, validCount: count.validCount,
    normalizedCount: count.normalizedCount, dedupeInputCount: count.dedupeInputCount, dedupeOutputCount: count.finalUniqueJobCount,
    parseDiscardCount: count.parseDiscardCount, validationDiscardCount: count.validationDiscardCount, normalizationDiscardCount: count.normalizationDiscardCount,
    dedupeDiscardCount: count.legalDedupeCount, collisionCount: collisions, discardCount: count.validationDiscardCount + count.legalDedupeCount,
    adapterInputCount: count.validCount, adapterOutputCount: count.finalUniqueJobCount, adapterLossCount: count.legalDedupeCount, adapterCollisionGroupCount: collisions};
  const surfaceHash = hashCanonicalStringSet(receipt.scope.surfaceIds), channelHash = hashCanonicalStringSet(receipt.scope.channelIds);
  if (Object.entries(counts).some(([key, value]) => row[key as keyof typeof counts] !== value) ||
      row.expectedJobCount !== count.officialTotal || row.expectedEvidenceKind !== receipt.declaration.kind ||
      row.canonicalCurrentJobSetSha256 !== receipt.output.canonicalJobSetSha256 ||
      row.officialSurfaceIds.length !== receipt.scope.surfaceIds.length || hashCanonicalStringSet(row.officialSurfaceIds) !== surfaceHash ||
      row.officialChannelIds.length !== receipt.scope.channelIds.length || hashCanonicalStringSet(row.officialChannelIds) !== channelHash ||
      row.expectedSurfaceSha256 !== surfaceHash || row.visitedSurfaceSha256 !== surfaceHash ||
      row.expectedChannelSha256 !== channelHash || row.visitedChannelSha256 !== channelHash) fail();
  return receipt;
}
function verifyAcceptedBGrade(row: PortableSourceResultRow, plan: SourceCrawlPlan, now: Date): PublicBReceipt {
  const fail = (): never => { throw new Error("PUBLIC_B_GRADE_RECEIPT_DRIFT"); };
  if (!supportsPublicBGrade(plan) || row.observations?.length !== 1) fail();
  const observation = row.observations[0]!;
  // A committed Sanofi compact attestation proves acceptance at its recorded finish time; current freshness remains diagnostic.
  const receiptTime = row.sourceId === "source-sanofi-china-social" &&
    (row.completenessCertificate as {schemaVersion?: unknown} | null)?.schemaVersion === SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION &&
    row.atomicCommitState === "COMMITTED" && row.completenessState === "VERIFIED" && validDate(row.finishedAt) && row.finishedAt <= now ? row.finishedAt : now;
  verifyBGradeTraversalCertificateReceipt({certificate: row.completenessCertificate, certificateSha256: row.completenessCertificateSha256 ?? "", now: receiptTime, expected: {
    releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceResultId: row.id,
    sourceId: plan.source.id, companyId: plan.company.id, sourceConfigSha256: sourcePlanConfigSha256(plan),
    surfaceIds: [plan.source.surfaceId!], channelIds: plan.expectedChannels!.map(channel => channel.channelId),
    canonicalJobSetSha256: row.canonicalOutputSetSha256 ?? "", adapterReconciliationSha256: row.adapterReconciliationSha256 ?? "",
    collisionLedgerSha256: row.collisionLedgerSha256 ?? "", canonicalRawEvidenceIdSetSha256: observation.canonicalRawSha256 ?? "",
    ...(plan.source.id==="source-sanofi-china-social" && row.sanofiArtifacts ? {sanofiArtifacts:row.sanofiArtifacts} : {})
  }});
  const receipt = row.completenessCertificate as PublicBReceipt;
  const count = receipt.counts, normalized = count.finalUniqueJobCount + count.dedupeDiscardCount;
  const counts = {rawCount: normalized + count.validationDiscardCount, parsedCount: normalized + count.validationDiscardCount,
    validCount: normalized, normalizedCount: normalized, dedupeInputCount: normalized, dedupeOutputCount: count.finalUniqueJobCount,
    parseDiscardCount: count.parseDiscardCount, validationDiscardCount: count.validationDiscardCount, normalizationDiscardCount: count.normalizationDiscardCount,
    dedupeDiscardCount: count.dedupeDiscardCount, collisionCount: receipt.output.collisionGroups?.length ?? 0,
    discardCount: count.validationDiscardCount + count.dedupeDiscardCount, adapterInputCount: normalized,
    adapterOutputCount: count.finalUniqueJobCount, adapterLossCount: count.dedupeDiscardCount, adapterCollisionGroupCount: receipt.output.collisionGroups?.length ?? 0};
  const surfaces = hashCanonicalStringSet(receipt.scope.surfaceIds), channels = hashCanonicalStringSet(receipt.scope.channelIds);
  if (row.sourceId !== plan.source.id || row.sourceConfigHash !== receipt.binding.sourceConfigSha256 ||
      receipt.independentValidation.sourceConfigSha256 !== row.sourceConfigHash ||
      row.batch.id !== row.batchId || row.batch.releaseCandidateId !== row.releaseCandidateId || row.batch.kind !== "SCHEDULED" ||
      row.transportState !== "SUCCEEDED" || row.adapterState !== "SUCCEEDED" || row.completenessState !== "VERIFIED" || row.atomicCommitState !== "COMMITTED" ||
      row.failureCode || row.failureReason || row.blockerCode || row.blockerReason ||
      !validDate(row.startedAt) || !validDate(row.finishedAt) || row.finishedAt.toISOString() !== receipt.issuedAt || row.finishedAt > now ||
      !validDate(observation.observedFrom) || !validDate(observation.observedTo) || !validDate(observation.crawledAt) ||
      observation.observedFrom.getTime() !== row.startedAt.getTime() || observation.observedTo.getTime() !== row.finishedAt.getTime() ||
      observation.crawledAt < row.startedAt || observation.crawledAt > row.finishedAt ||
      observation.sourceId !== row.sourceId || observation.sourceResultId !== row.id || observation.batchId !== row.batchId ||
      observation.releaseCandidateId !== row.releaseCandidateId || observation.sourceConfigSha256 !== row.sourceConfigHash || observation.adapterVersion !== row.adapterVersion ||
      observation.successful !== true || observation.transportSucceeded !== true || observation.adapterSucceeded !== true ||
      observation.completenessVerified !== true || observation.atomicCommitSucceeded !== true ||
      row.canonicalOutputSetSha256 !== receipt.output.canonicalJobSetSha256 ||
      row.adapterReconciliationSha256 !== receipt.output.adapterReconciliationSha256 || row.collisionLedgerSha256 !== receipt.output.collisionLedgerSha256 ||
      observation.canonicalOutputSha256 !== receipt.output.canonicalJobSetSha256 || observation.paginationTraceSha256 !== receipt.mainTraversal.paginationTraceSha256 ||
      Object.entries(counts).some(([key, value]) => row[key as keyof typeof counts] !== value) ||
      row.expectedEvidenceKind !== "COMPLETE_PAGE_TRAVERSAL" || row.expectedJobCount !== null ||
      row.canonicalCurrentJobSetSha256 !== receipt.output.canonicalJobSetSha256 ||
      row.officialSurfaceIds.length !== receipt.scope.surfaceIds.length || hashCanonicalStringSet(row.officialSurfaceIds) !== surfaces ||
      row.officialChannelIds.length !== receipt.scope.channelIds.length || hashCanonicalStringSet(row.officialChannelIds) !== channels ||
      receipt.independentValidation.surfaceIds.length !== receipt.scope.surfaceIds.length || hashCanonicalStringSet(receipt.independentValidation.surfaceIds) !== surfaces ||
      receipt.independentValidation.channelIds.length !== receipt.scope.channelIds.length || hashCanonicalStringSet(receipt.independentValidation.channelIds) !== channels ||
      row.expectedSurfaceSha256 !== surfaces || row.visitedSurfaceSha256 !== surfaces || row.expectedChannelSha256 !== channels || row.visitedChannelSha256 !== channels) fail();
  return receipt;
}
function verifyLegacyAccepted(row: PortableSourceResultRow, plan: SourceCrawlPlan, now: Date): PublicReceipt {
  if (isCurrentBGradeCertificateSchema((row.completenessCertificate as {schemaVersion?: unknown} | null)?.schemaVersion)) {
    return verifyAcceptedBGrade(row, plan, now);
  }
  if ((row.completenessCertificate as {schemaVersion?: unknown} | null)?.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION) {
    return verifyAcceptedAGrade(row, plan, now);
  }
  const receipt = verifySourceQualityReceipt({receipt: row.completenessCertificate, receiptSha256: row.completenessCertificateSha256 ?? "", expected: {
    releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceResultId: row.id,
    sourceId: row.sourceId, sourceConfigSha256: row.sourceConfigHash, adapterVersion: row.adapterVersion
  }});
  const fail = (): never => { throw new Error("PORTABLE_ACCEPTED_RECEIPT_DRIFT"); };
  if (row.batch.id !== row.batchId || row.batch.releaseCandidateId !== row.releaseCandidateId || row.batch.kind !== "SCHEDULED" ||
      row.transportState !== "SUCCEEDED" || row.adapterState !== "SUCCEEDED" || row.completenessState !== "VERIFIED" || row.atomicCommitState !== "COMMITTED" ||
      row.failureCode || row.failureReason || row.blockerCode || row.blockerReason ||
      !validDate(row.startedAt) || !validDate(row.finishedAt) || row.finishedAt.toISOString() !== receipt.issuedAt ||
      row.startedAt.getTime() > Date.parse(receipt.acquisition.startedAt) || row.finishedAt.getTime() > now.getTime() ||
      Date.parse(receipt.observation.crawledAt) < Date.parse(receipt.acquisition.startedAt) ||
      Date.parse(receipt.observation.crawledAt) > Date.parse(receipt.acquisition.finishedAt) ||
      receipt.companyId !== plan.company.id || receipt.binding.sourceId !== plan.source.id ||
      receipt.binding.sourceConfigSha256 !== sourcePlanConfigSha256(plan) || receipt.policyId !== getSourceQualityPolicy(plan)) fail();
  const count = receipt.counts;
  const counts = {rawCount: count.rawCount, parsedCount: count.parsedCount, validCount: count.validCount, normalizedCount: count.validCount,
    dedupeInputCount: count.dedupeInputCount, dedupeOutputCount: count.finalUniqueJobCount, parseDiscardCount: count.parseDiscardCount,
    validationDiscardCount: count.validationDiscardCount, normalizationDiscardCount: count.normalizationDiscardCount,
    dedupeDiscardCount: count.dedupeDiscardCount, collisionCount: count.collisionCount, discardCount: count.validationDiscardCount + count.dedupeDiscardCount,
    adapterInputCount: count.validCount, adapterOutputCount: count.finalUniqueJobCount, adapterLossCount: count.dedupeDiscardCount, adapterCollisionGroupCount: count.collisionCount};
  if (Object.entries(counts).some(([key, value]) => row[key as keyof typeof counts] !== value) ||
      row.expectedJobCount !== receipt.observation.expectedJobCount || row.expectedEvidenceKind !== receipt.observation.expectedEvidenceKind ||
      row.canonicalCurrentJobSetSha256 !== receipt.output.canonicalJobKeySetSha256 || row.canonicalOutputSetSha256 !== receipt.output.canonicalJobKeySetSha256 ||
      row.adapterReconciliationSha256 !== receipt.ledger.adapterReconciliationSha256 || row.collisionLedgerSha256 !== receipt.ledger.collisionLedgerSha256 ||
      hashCanonicalStringSet(row.officialSurfaceIds) !== hashCanonicalStringSet(receipt.surfaceIds) ||
      hashCanonicalStringSet(row.officialChannelIds) !== hashCanonicalStringSet(receipt.channelIds) ||
      hashCanonicalStringSet(receipt.surfaceIds) !== hashCanonicalStringSet([plan.source.surfaceId!]) ||
      hashCanonicalStringSet(receipt.channelIds) !== hashCanonicalStringSet(plan.expectedChannels!.map(channel => channel.channelId))) fail();
  return receipt;
}
function verifyAccepted(row: PortableSourceResultRow, plan: SourceCrawlPlan, now: Date): AcceptedPortableSource {
  if (!isJobProjectionDeltaReceipt(row.completenessCertificate)) {
    return {result: row, receipt: verifyLegacyAccepted(row, plan, now)};
  }
  const deltaReceipt = verifyJobProjectionDeltaReceipt(row.completenessCertificate, row.completenessCertificateSha256 ?? "", {
    releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceId: row.sourceId, sourceResultId: row.id
  });
  const receipt = verifyLegacyAccepted({...row, completenessCertificate: deltaReceipt.legacyCertificate as PortableSourceResultRow["completenessCertificate"],
    completenessCertificateSha256: deltaReceipt.legacyCertificateSha256}, plan, now);
  if (!validDate(row.finishedAt) || deltaReceipt.verifiedAt !== row.finishedAt.toISOString() ||
      deltaReceipt.observedAt !== deltaObservationAt(receipt, row)) throw new Error("PORTABLE_DELTA_OBSERVATION_DRIFT");
  return {result: row, receipt, deltaReceipt};
}

/** Historical presence is proved at its original acceptance time. An expired old
 * B validation cannot grant present publication, but may prove a prior sighting. */
function bindHistoricalObservations(selected: AcceptedPortableSource, attempts: readonly PortableSourceResultRow[], plan: SourceCrawlPlan): void {
  if (!selected.deltaReceipt) return;
  const references = [...new Set(selected.deltaReceipt.members.filter(member => member.missingCount === 1).map(member => member.lastPresentResultId))];
  const history = new Map<string, AcceptedPortableSource>();
  for (const id of references) {
    const rows = attempts.filter(row => row.id === id);
    const row = rows[0];
    if (rows.length !== 1 || !row || !validDate(row.finishedAt) || row.finishedAt >= selected.result.finishedAt!) {
      throw new Error("PORTABLE_DELTA_LAST_PRESENT_DRIFT");
    }
    history.set(id, verifyAccepted(row, plan, row.finishedAt));
  }
  selected.historicalObservations = history;
}

function neutralNotDue(row: PortableSourceResultRow): boolean {
  return row.failureCode === "SOURCE_NOT_DUE" && row.transportState === "SKIPPED" && row.adapterState === "SKIPPED" &&
    row.completenessState === "FAILED" && row.atomicCommitState === "NOT_ATTEMPTED" && validDate(row.finishedAt) &&
    row.dedupeOutputCount === 0 && row.expectedJobCount === null && row.completenessCertificate === null;
}

/** Per-source selection is independent of release-wide batch success or legacy qualification counts. */
export function selectPortableSourceSnapshots(
  plans: readonly SourceCrawlPlan[], rows: readonly PortableSourceResultRow[], options: PortableSnapshotOptions
): PortableSourceSelection[] {
  maximumAge(options);
  const ids = new Set<string>();
  return plans.map(plan => {
    if (ids.has(plan.source.id) || plan.company.id !== plan.source.companyId) throw new Error("INVALID_PORTABLE_PUBLICATION_PLAN_SET");
    ids.add(plan.source.id);
    const currentConfigSha256 = sourcePlanConfigSha256(plan);
    const policyId = getSourceQualityPolicy(plan) ?? (supportsPublicBGrade(plan) ? B_GRADE_PUBLIC_POLICY : supportsPublicAGrade(plan) ? A_GRADE_PUBLIC_POLICY : null);
    const base: PortableSourceSelection = {companyId: plan.company.id, sourceId: plan.source.id, currentConfigSha256, policyId,
      state: "HOLD", health: "UNVERIFIED", freshness: "UNKNOWN", reasons: [], visibilityFloor: null,
      selectedSourceResultId: null, lastAttemptAt: null, lastAcceptedAt: null, lastSuccessAt: null, lastAcceptedJobCount: null, selected: null};
    const coverageHold = getPortableSourceCoverageHold(plan.source.id);
    if (coverageHold) return {...base, reasons: [coverageHold]};
    if (policyId === null) return {...base, reasons: ["UNSUPPORTED_CURRENT_POLICY"] as PortableSnapshotReason[]};
    const sanofiTransition = isSanofiPublicTransitionPlan(plan);
    // All scheduled writers are visible during this one-source transition. An
    // unknown successor can replace mutable jobs even without a usable receipt.
    const attempts = rows.filter(row => row.sourceId === plan.source.id &&
      (row.sourceConfigHash === currentConfigSha256 || sanofiTransition) && row.batch.kind === "SCHEDULED");
    const accepted: NonNullable<PortableSourceSelection["selected"]>[] = [];
    let integrityHold = false;
    const invalidCertifiedHistory: PortableSourceResultRow[] = [];
    for (const row of attempts) {
      if (!validDate(row.startedAt) || row.startedAt > options.currentTime || (row.finishedAt !== null && (!validDate(row.finishedAt) || row.finishedAt > options.currentTime))) integrityHold = true;
      if (row.atomicCommitState !== "COMMITTED" || row.completenessState !== "VERIFIED" || !claimedReceipt(row, plan)) continue;
      try { accepted.push(verifyAccepted(row, plan, options.currentTime)); }
      catch {
        const certificate = row.completenessCertificate as {schemaVersion?: unknown; legacyCertificate?: {schemaVersion?: unknown}} | null;
        const schema = isJobProjectionDeltaReceipt(certificate) ? certificate?.legacyCertificate?.schemaVersion : certificate?.schemaVersion;
        if (schema === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION || isCurrentBGradeCertificateSchema(schema)) invalidCertifiedHistory.push(row);
        else integrityHold = true;
      }
    }
    accepted.sort((a, b) => compare(acceptedAt(a), acceptedAt(b)) || compare(a.result.id, b.result.id));
    const selected = accepted.at(-1) ?? null;
    // A later complete source snapshot is independent of malformed earlier certificate history.
    // A latest/overlapping invalid receipt still prevents fallback to older data.
    if (invalidCertifiedHistory.some(row=>!selected||!validDate(row.finishedAt)||row.finishedAt>=selected.result.startedAt)) integrityHold=true;
    const meaningful = attempts.filter(row => !neutralNotDue(row) && !isProvenUnstartedBatchAbort(row, options.currentTime)).sort((a, b) =>
      a.startedAt.getTime() - b.startedAt.getTime() || compare(a.id, b.id));
    const latest = meaningful.at(-1);
    base.lastAttemptAt = latest && validDate(latest.startedAt) && latest.startedAt <= options.currentTime ? latest.startedAt.toISOString() : null;
    if (selected) {
      const {receipt, result} = selected;
      try { bindHistoricalObservations(selected, attempts, plan); } catch { integrityHold = true; }
      const firstSameSchema = accepted.find(entry => entry.receipt.schemaVersion === receipt.schemaVersion)!;
      Object.assign(base, {selected, visibilityFloor: acceptedAt(firstSameSchema), selectedSourceResultId: result.id,
        policyId: receipt.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION ? A_GRADE_PUBLIC_POLICY : (receipt.schemaVersion === B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION || receipt.schemaVersion === SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION) ? (receipt.schemaVersion === SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION ? SANOFI_COMPACT_PUBLIC_POLICY : B_GRADE_PUBLIC_POLICY) : receipt.policyId,
        lastAcceptedAt: acceptedAt(selected), lastSuccessAt: observedAt(receipt, result), lastAcceptedJobCount: receipt.counts.finalUniqueJobCount,
        state: "PUBLISHING", health: "HEALTHY", freshness: fresh(observedAt(receipt, result), options) ? "FRESH" : "STALE"});
      if (plan.source.id === "source-servier-china-social" && receipt.schemaVersion === B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION) {
        base.sourceScopeSummary = {portalJobCount: result.rawCount, verifiedChinaJobCount: receipt.counts.finalUniqueJobCount,
          unknownCountryJobCount: receipt.counts.validationDiscardCount};
      }
      // A different committed writer after portable cutover can have replaced mutable Job rows.
      if (attempts.some(row => row.atomicCommitState === "COMMITTED" &&
          (sanofiTransition || row.completenessState === "VERIFIED") && !claimedReceipt(row, plan) &&
          (!sanofiTransition || row.id !== result.id) &&
          (sanofiTransition ? !validDate(row.finishedAt) || row.finishedAt >= result.startedAt :
            validDate(row.finishedAt) && row.finishedAt.getTime() >= Date.parse(base.visibilityFloor!)))) integrityHold = true;
      // A committed CN attempt ends the historical fallback even when its
      // completeness state/receipt is unusable. A later good B stands alone.
      if (sanofiTransition && receipt.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION &&
          attempts.some(row => row.id !== result.id && row.atomicCommitState === "COMMITTED" &&
            (!validDate(row.finishedAt) || row.finishedAt >= result.startedAt))) integrityHold = true;
      // Freshness is diagnostic. Only evidence/lifecycle failures affect publication or health.
      if (base.freshness === "STALE") base.reasons.push("LAST_GOOD_STALE");
      if (latest && latest.id !== result.id && latest.startedAt >= result.startedAt) {
        base.health = "DEGRADED";
        if (isCurrentBGradeCertificateSchema(receipt.schemaVersion)) base.state = "HOLD";
        base.reasons.push(latest.finishedAt === null ? "LATEST_ATTEMPT_RUNNING" : "LATEST_ATTEMPT_FAILED");
      }
    }
    if (integrityHold) return {...base, state: "HOLD" as const, health: "DEGRADED" as const, reasons: ["RECEIPT_INTEGRITY_HOLD"] as PortableSnapshotReason[]};
    if (!selected) base.reasons.push("CURRENT_CONFIG_HAS_NO_ACCEPTED_RECEIPT");
    return base;
  }).sort((a, b) => compare(a.sourceId, b.sourceId));
}

export function verifiedMembers(selected: NonNullable<PortableSourceSelection["selected"]>, members: readonly PortableLifecycleMemberRow[]): Map<string, number> {
  const result = selected.result;
  const sets = {CURRENT: new Map<string, number>(), GRACE: new Map<string, number>(), VISIBLE: new Map<string, number>()};
  for (const member of members) {
    const set = sets[member.setKind];
    if (!set || member.releaseCandidateId !== result.releaseCandidateId || member.batchId !== result.batchId ||
        member.sourceId !== result.sourceId || member.sourceResultId !== result.id || member.lifecycleStatus !== "ACTIVE" ||
        member.jobKeySha256 !== createHash("sha256").update(member.jobKey).digest("hex") || set.has(member.jobKey) ||
        ![0, 1].includes(member.missingCount) || (member.setKind === "CURRENT" && member.missingCount !== 0) ||
        (member.setKind === "GRACE" && member.missingCount !== 1)) throw new Error("PORTABLE_LIFECYCLE_MEMBER_DRIFT");
    set.set(member.jobKey, member.missingCount);
  }
  if (sets.CURRENT.size !== result.dedupeOutputCount ||
      hashCanonicalStringSet([...sets.CURRENT.keys()]) !== result.canonicalCurrentJobSetSha256 ||
      hashCanonicalStringSet([...sets.GRACE.keys()]) !== result.canonicalGraceJobSetSha256 ||
      hashCanonicalStringSet([...sets.VISIBLE.keys()]) !== result.canonicalVisibleJobSetSha256 ||
      sets.VISIBLE.size !== sets.CURRENT.size + sets.GRACE.size ||
      [...sets.CURRENT].some(([key, missing]) => sets.GRACE.has(key) || sets.VISIBLE.get(key) !== missing) ||
      [...sets.GRACE].some(([key, missing]) => sets.VISIBLE.get(key) !== missing)) throw new Error("PORTABLE_LIFECYCLE_SET_DRIFT");
  if (selected.receipt.schemaVersion === B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION || selected.receipt.schemaVersion === SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION) {
    const traversal = selected.receipt.mainTraversal;
    const keys = [...sets.CURRENT.keys()].map(key => traversal.matchKeyKind === "JOB_DEDUPE_KEY" ? key :
      key.startsWith(`${result.sourceId}:`) ? key.slice(result.sourceId.length + 1) : "");
    if (keys.some(key => !key) || hashCanonicalStringSet(keys) !== traversal.canonicalMatchKeySetSha256) throw new Error("PUBLIC_B_GRADE_FINAL_MEMBER_DRIFT");
  }
  return selected.deltaReceipt || selected.receipt.schemaVersion === SOURCE_QUALITY_RECEIPT_SCHEMA ? sets.VISIBLE : sets.CURRENT;
}

function verifiedDeltaMembers(selected: AcceptedPortableSource, members: readonly PortableLifecycleMemberRow[],
  historicalMembers: readonly PortableLifecycleMemberRow[]): Map<string, JobProjectionMember> | undefined {
  const delta = selected.deltaReceipt;
  if (!delta) return undefined;
  if (members.length !== delta.members.length) throw new Error("PORTABLE_DELTA_MEMBER_COUNT_DRIFT");
  const memberKey = (member: {setKind: string; jobKey: string}) => JSON.stringify([member.setKind, member.jobKey]);
  const actual = new Map(members.map(member => [memberKey(member), member]));
  if (actual.size !== members.length) throw new Error("PORTABLE_DELTA_DUPLICATE_MEMBER");
  const validatedHistory = new Set<string>();
  for (const member of delta.members) {
    const stored = actual.get(memberKey(member));
    if (!stored || (["releaseCandidateId", "batchId", "sourceId", "sourceResultId", "setKind", "jobKey", "jobKeySha256", "lifecycleStatus", "missingCount"] as const)
      .some(key => stored[key] !== member[key])) throw new Error("PORTABLE_DELTA_MEMBER_DRIFT");
    if (member.missingCount === 1) {
      const reference = selected.historicalObservations?.get(member.lastPresentResultId);
      if (!reference || reference.result.sourceId !== selected.result.sourceId ||
          member.lastConfirmedObservedAt !== deltaObservationAt(reference.receipt, reference.result) ||
          member.lifecycleLastSeenAt !== acceptedAt(reference)) throw new Error("PORTABLE_DELTA_LAST_PRESENT_DRIFT");
      const previousMembers = historicalMembers.filter(row => row.sourceResultId === reference.result.id);
      if (!validatedHistory.has(reference.result.id)) {
        verifiedMembers(reference, previousMembers);
        validatedHistory.add(reference.result.id);
      }
      if (!previousMembers.some(row => row.setKind === "CURRENT" && row.jobKey === member.jobKey && row.missingCount === 0)) {
        throw new Error("PORTABLE_DELTA_LAST_PRESENT_MEMBER_DRIFT");
      }
    }
  }
  return new Map(delta.members.filter(member => member.setKind === "VISIBLE").map(member => [member.jobKey, member]));
}

/** The mutable Job table is only a projection, never authority. Extra legacy rows are ignored. */
export function projectPortableSourceJobs(
  selection: PortableSourceSelection, members: readonly PortableLifecycleMemberRow[], rows: readonly PortableJobRow[], options: PortableSnapshotOptions,
  historicalMembers: readonly PortableLifecycleMemberRow[] = []
): PortableProjectedSource {
  maximumAge(options);
  const {selected, ...status} = selection;
  const output: PortableProjectedSource = {...status, reasons: [...status.reasons], visibleJobCount: null, staleJobCount: 0, jobs: []};
  if (!selected || output.state !== "PUBLISHING") return output;
  if (!fresh(observedAt(selected.receipt, selected.result), options)) {
    output.freshness = "STALE";
    output.reasons = [...new Set([...output.reasons, "LAST_GOOD_STALE" as const])];
  }
  try {
    if (selected.result.finishedAt!.getTime() > options.currentTime.getTime()) throw new Error("PORTABLE_FUTURE_SOURCE_RESULT");
    const visible = verifiedMembers(selected, members);
    const deltaMembers = verifiedDeltaMembers(selected, members, historicalMembers);
    const jobsByKey = new Map<string, PortableJobRow>();
    for (const row of rows) {
      if (row.sourceId !== output.sourceId || !visible.has(row.dedupeKey)) continue;
      if (jobsByKey.has(row.dedupeKey)) throw new Error("PORTABLE_DUPLICATE_JOB");
      jobsByKey.set(row.dedupeKey, row);
    }
    for (const [key, missingCount] of visible) {
      const row = jobsByKey.get(key);
      const deltaMember = deltaMembers?.get(key);
      if (!row || row.companyId !== output.companyId || row.lifecycleStatus !== "ACTIVE" || !row.visibleInFrontend || row.missingSuccessCount !== missingCount ||
          (deltaMembers ? !deltaMember || hashJobPersistedProjection(row) !== deltaMember.jobProjectionSha256 :
            !validDate(row.lastSeenAt) || row.lastSeenAt.getTime() < Date.parse(output.visibilityFloor!) || row.lastSeenAt.getTime() > Date.parse(output.lastAcceptedAt!) ||
            (missingCount === 0 && row.lastSeenAt.toISOString() !== output.lastAcceptedAt) ||
            (missingCount === 1 && row.lastSeenAt.toISOString() >= output.lastAcceptedAt!)) ||
          !row.officialTitle.trim() || !row.officialUrl.trim() || !row.locationRaw.trim() || row.cities.length === 0 ||
          !fromPrismaJobCategory(row.humanCorrectedCategory ?? row.category) || (row.officialPublishedAt !== null && !validDate(row.officialPublishedAt))) {
        throw new Error("PORTABLE_JOB_PROJECTION_DRIFT");
      }
      const lastSeenAt = deltaMember?.lifecycleLastSeenAt ?? row.lastSeenAt.toISOString();
      const freshnessObservedAt = deltaMember?.lastConfirmedObservedAt ?? lastSeenAt;
      if (!fresh(freshnessObservedAt, options)) output.staleJobCount++;
      output.jobs.push({id: row.id, companyId: row.companyId, sourceId: row.sourceId, sourceResultId: selected.result.id,
        title: row.humanCorrectedTitle || row.auxiliaryChineseTitle || row.officialTitle, officialTitle: row.officialTitle,
        officialPublishedAt: row.officialPublishedAt?.toISOString() ?? null, city: row.city, cities: [...row.cities], locationRaw: row.locationRaw,
        category: fromPrismaJobCategory(row.humanCorrectedCategory ?? row.category), isNew: row.isNew, officialUrl: row.officialUrl,
        lastSeenAt, ...(deltaMember ? {lastConfirmedObservedAt: deltaMember.lastConfirmedObservedAt} : {}), inGrace: missingCount === 1});
    }
    output.jobs.sort((a, b) => compare(a.id, b.id));
    output.visibleJobCount = output.jobs.length;
    if (output.staleJobCount > 0) output.reasons.push("STALE_JOB_ROWS");
    return output;
  } catch {
    return {...output, state: "HOLD", health: "DEGRADED", visibleJobCount: null, staleJobCount: 0, jobs: [], reasons: [...output.reasons, "PROJECTION_INTEGRITY_HOLD"]};
  }
}
