import { isJobProjectionDeltaReceipt, hashJobPersistedProjection, jobProjectionMemberSchema, type JobProjectionDeltaReceipt, type JobProjectionMember } from "./jobProjectionDeltaReceipt";
import { isSanofiPublicTransitionPlan, isSanofiHistoricalPublicCandidate, assertSanofiHistoricalPublicRow } from "./sanofiPublicTransition";
import { getPortableCoverageScope } from "../release/portableCoveragePolicy";
import { B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION, BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION, isCurrentBGradeCertificateSchema, requiresBGradeTraversalCertificate } from "../crawler/traversalCertificate";
import { candidateCompanies } from "../data/companyRegistry";
import { buildStagedSourceCrawlPlans } from "../crawler/sourcePlan";
import { supportsStrictOfficialTotalCertificate } from "../crawler/runSourceCrawl";
import { isProvenUnstartedBatchAbort } from "./unstartedBatchAbort";
import { getPortableSourceCoverageHold } from "../release/portableSourceCoverageHolds";
import { createHash } from "node:crypto";
import { getSourceQualityPolicy, SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA } from "../crawler/sourceQualityAdmission";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { hashCanonicalStringSet } from "../crawler/runtimeBatchIdentity";
import { fromPrismaJobCategory } from "../db/prismaMappers";
import type { PortableSourceResultRow, PortableLifecycleMemberRow, PortableJobRow } from "../db/portablePublicSnapshotRepository";
import { DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS } from "./publicationEligibility";
import { A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION } from "../crawler/completenessCertificate";
import type { DatabaseSearchJobResult } from "../server/jobSearchService";

const A_GRADE_PUBLIC_POLICY = "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1" as const;
// Bind real A receipts to the actual current canonical plan, rather than a
// second per-company list. Existing issuer scope and membership checks remain.
const A_GRADE_PUBLIC_CONFIGS: Readonly<Record<string,string>>=Object.freeze(Object.fromEntries(
  buildStagedSourceCrawlPlans(candidateCompanies).filter(plan=>getPortableCoverageScope().requiredSourceIds.includes(plan.source.id)&&supportsStrictOfficialTotalCertificate(plan))
    .map(plan=>[plan.source.id,sourcePlanConfigSha256(plan)])));
const COMPACT_PUBLIC_POLICY = "PRE_COMMIT_DUAL_CHAIN_ATTESTATION_V1" as const;
const B_GRADE_PUBLIC_POLICY = "STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2" as const;
// Only reviewed source-specific COMPLETE_PAGE_TRAVERSAL integrations are public here.
const B_GRADE_PUBLIC_CONFIGS: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  buildStagedSourceCrawlPlans(candidateCompanies).filter(plan =>
    ["source-pfizer-china-social", "source-bayer-healthcare-social", "source-servier-china-social", "source-sanofi-china-social"].includes(plan.source.id) &&
    getPortableCoverageScope().requiredSourceIds.includes(plan.source.id) && requiresBGradeTraversalCertificate(plan))
    .map(plan => [plan.source.id, sourcePlanConfigSha256(plan)])));
interface PublicReceipt {
  schemaVersion: string;
  policyId?: typeof SOURCE_QUALITY_POLICY_ID;
  observedAt?: string;
  observation?: {crawledAt: string};
  counts: {finalUniqueJobCount: number; validationDiscardCount: number};
  mainTraversal?: {matchKeyKind: string; canonicalMatchKeySetSha256: string};
}
type CommittedDelta = Pick<JobProjectionDeltaReceipt, "binding" | "verifiedAt" | "observedAt" | "members">;

/** Same projection for database JSON and existing in-memory review adapters.
 * Raw evidence is validated at atomic publication, never replayed by the web reader. */
export function compactCommittedCertificate(value: unknown, includeMembers = true): unknown {
  if (value === null || typeof value !== "object") return value;
  const c = value as Record<string, any>;
  if (isJobProjectionDeltaReceipt(c)) return {schemaVersion: c.schemaVersion, binding: c.binding,
    verifiedAt: c.verifiedAt, observedAt: c.observedAt, members: includeMembers ? c.members : [],
    legacyCertificate: compactCommittedCertificate(c.legacyCertificate)};
  return {schemaVersion: c.schemaVersion, policyId: c.policyId, observedAt: c.observedAt,
    observation: c.observation && {crawledAt: c.observation.crawledAt},
    counts: c.counts && {finalUniqueJobCount: c.counts.finalUniqueJobCount, validationDiscardCount: c.counts.validationDiscardCount},
    mainTraversal: c.mainTraversal && {matchKeyKind: c.mainTraversal.matchKeyKind, canonicalMatchKeySetSha256: c.mainTraversal.canonicalMatchKeySetSha256}};
}

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
  policyId: typeof SOURCE_QUALITY_POLICY_ID | typeof A_GRADE_PUBLIC_POLICY | typeof B_GRADE_PUBLIC_POLICY | typeof COMPACT_PUBLIC_POLICY | null;
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
  deltaReceipt?: CommittedDelta;
  /** Original committed sighting metadata, never a new observation. */
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
/** Merck's reviewed page-capacity change preserves the same China publication scope.
 * Old commits remain readable only under this exact successor; issuer policy stays current. */
export function portableCommittedConfigHashes(plan: SourceCrawlPlan): readonly string[] {
  const current = sourcePlanConfigSha256(plan);
  return plan.source.id === "source-merck-china-social" && current === "1f4b28ecba11e7fd299e51d7cd351529983d086ef18a2b5bd005e431812db212"
    ? [current, "3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38"] : [current];
}
export function supportsPublicBGrade(plan: SourceCrawlPlan): boolean {
  return B_GRADE_PUBLIC_CONFIGS[plan.source.id] === sourcePlanConfigSha256(plan);
}
function observedAt(receipt: PublicReceipt, row: PortableSourceResultRow): string {
  return receipt.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION ? receipt.observedAt! :
    isCurrentBGradeCertificateSchema(receipt.schemaVersion) ? row.observations[0]!.crawledAt.toISOString() : receipt.observation!.crawledAt;
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
function readCommittedSource(row: PortableSourceResultRow, plan: SourceCrawlPlan, now: Date): AcceptedPortableSource {
  const certificate = compactCommittedCertificate(row.completenessCertificate) as PublicReceipt & CommittedDelta & {legacyCertificate?: PublicReceipt};
  const deltaReceipt = isJobProjectionDeltaReceipt(certificate) ? certificate : undefined;
  const receipt = deltaReceipt ? certificate.legacyCertificate! : certificate;
  const historicalSanofi = isSanofiPublicTransitionPlan(plan) && isSanofiHistoricalPublicCandidate(row);
  if (historicalSanofi) assertSanofiHistoricalPublicRow(row, plan);
  const supported = receipt?.schemaVersion === SOURCE_QUALITY_RECEIPT_SCHEMA ? receipt.policyId === getSourceQualityPolicy(plan) :
    receipt?.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION ? historicalSanofi || supportsPublicAGrade(plan) :
    isCurrentBGradeCertificateSchema(receipt?.schemaVersion) && supportsPublicBGrade(plan);
  // Keep the read boundary and current publication rules; COMMITTED owns evidence admission.
  if (!supported || receipt.schemaVersion === BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION && plan.source.id !== "source-bayer-healthcare-social" || row.sourceId !== plan.source.id || (!historicalSanofi && !portableCommittedConfigHashes(plan).includes(row.sourceConfigHash)) ||
      row.batch.id !== row.batchId || row.batch.releaseCandidateId !== row.releaseCandidateId || row.batch.kind !== "SCHEDULED" ||
      row.transportState !== "SUCCEEDED" || row.adapterState !== "SUCCEEDED" || row.completenessState !== "VERIFIED" || row.atomicCommitState !== "COMMITTED" ||
      row.failureCode || row.failureReason || row.blockerCode || row.blockerReason ||
      !/^[a-f0-9]{64}$/.test(row.completenessCertificateSha256 ?? "") ||
      !validDate(row.startedAt) || !validDate(row.finishedAt) || row.startedAt > row.finishedAt || row.finishedAt > now ||
      !receipt.counts || receipt.counts.finalUniqueJobCount !== row.dedupeOutputCount) throw Error("PORTABLE_COMMITTED_RESULT_DRIFT");
  const observationTime = Date.parse(observedAt(receipt, row));
  if (!Number.isFinite(observationTime) || observationTime < row.startedAt.getTime() || observationTime > row.finishedAt.getTime()) throw Error("PORTABLE_COMMITTED_OBSERVATION_DRIFT");
  // Proof TTL belongs to atomic admission. An accepted observation can become
  // stale, but its age alone does not revoke the published snapshot.
  if (deltaReceipt) {
    if (["releaseCandidateId", "batchId", "sourceId"].some(key => deltaReceipt.binding?.[key as keyof typeof deltaReceipt.binding] !== row[key as keyof PortableSourceResultRow]) ||
        deltaReceipt.binding?.sourceResultId !== row.id || deltaReceipt.verifiedAt !== row.finishedAt.toISOString() ||
        deltaReceipt.observedAt !== deltaObservationAt(receipt, row)) throw Error("PORTABLE_DELTA_OBSERVATION_DRIFT");
    deltaReceipt.members = jobProjectionMemberSchema.array().parse(deltaReceipt.members);
  }
  return {result: row, receipt, ...(deltaReceipt ? {deltaReceipt} : {})};
}

/** GRACE retains its original committed CURRENT sighting and observation time. */
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
    history.set(id, readCommittedSource(row, plan, row.finishedAt));
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
    const committedConfigHashes = portableCommittedConfigHashes(plan);
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
      (committedConfigHashes.includes(row.sourceConfigHash) || sanofiTransition) && row.batch.kind === "SCHEDULED");
    const accepted: NonNullable<PortableSourceSelection["selected"]>[] = [];
    let integrityHold = false;
    const invalidCertifiedHistory: PortableSourceResultRow[] = [];
    for (const row of attempts) {
      if (!validDate(row.startedAt) || row.startedAt > options.currentTime || (row.finishedAt !== null && (!validDate(row.finishedAt) || row.finishedAt > options.currentTime))) integrityHold = true;
      if (row.atomicCommitState !== "COMMITTED" || row.completenessState !== "VERIFIED" || !claimedReceipt(row, plan)) continue;
      try { accepted.push(readCommittedSource(row, plan, options.currentTime)); }
      catch {
        const certificate = row.completenessCertificate as {schemaVersion?: unknown; legacyCertificate?: {schemaVersion?: unknown}} | null;
        const schema = isJobProjectionDeltaReceipt(certificate) ? certificate?.legacyCertificate?.schemaVersion : certificate?.schemaVersion;
        if (schema === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION || isCurrentBGradeCertificateSchema(schema)) invalidCertifiedHistory.push(row);
        else integrityHold = true;
      }
    }
    accepted.sort((a, b) => compare(acceptedAt(a), acceptedAt(b)) || compare(a.result.id, b.result.id));
    const selected = accepted.at(-1) ?? null;
    // A later complete snapshot supersedes earlier malformed A/B metadata.
    // A latest/overlapping invalid commitment still prevents fallback.
    if (invalidCertifiedHistory.some(row=>!selected||!validDate(row.finishedAt)||row.finishedAt>=selected.result.startedAt)) integrityHold=true;
    const meaningful = attempts.filter(row => !neutralNotDue(row) && !isProvenUnstartedBatchAbort(row, options.currentTime)).sort((a, b) =>
      a.startedAt.getTime() - b.startedAt.getTime() || compare(a.id, b.id));
    const latest = meaningful.at(-1);
    base.lastAttemptAt = latest && validDate(latest.startedAt) && latest.startedAt <= options.currentTime ? latest.startedAt.toISOString() : null;
    if (selected) {
      const {receipt, result} = selected;
      try { bindHistoricalObservations(selected, attempts, plan); } catch { integrityHold = true; }
      const firstSameSchema = accepted.find(entry => entry.receipt.schemaVersion === receipt.schemaVersion || plan.source.id === "source-bayer-healthcare-social" && [entry.receipt.schemaVersion, receipt.schemaVersion].every(schema => schema === B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION || schema === BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION))!;
      Object.assign(base, {selected, visibilityFloor: acceptedAt(firstSameSchema), selectedSourceResultId: result.id,
        policyId: receipt.schemaVersion === A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION ? A_GRADE_PUBLIC_POLICY : isCurrentBGradeCertificateSchema(receipt.schemaVersion) ? (receipt.schemaVersion === B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION ? B_GRADE_PUBLIC_POLICY : COMPACT_PUBLIC_POLICY) : receipt.policyId!,
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
        // A later failed/running attempt cannot erase verified last-good jobs; projection checks below still reject changed rows.
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
  if (isCurrentBGradeCertificateSchema(selected.receipt.schemaVersion)) {
    const traversal = selected.receipt.mainTraversal!;
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
    if (member.missingCount === 0 && (member.lastPresentResultId !== selected.result.id ||
        member.lastConfirmedObservedAt !== delta.observedAt || member.lifecycleLastSeenAt !== delta.verifiedAt)) throw Error("PORTABLE_DELTA_CURRENT_OBSERVATION_DRIFT");
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

