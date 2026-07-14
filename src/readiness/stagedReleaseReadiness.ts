import { assertExactConfirmedCompanyRosterV3 } from "../data/confirmedCompanyRosterV3";
import {
  AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS,
  PHASE1_MINIMUM_STABLE_COMPANIES,
  isUserAuthorizedPhase1Exclusion
} from "../data/phase1ScopePolicy";
import {
  DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS,
  type CompanyPublicationRecord,
  type CompanyPublicationSnapshot,
  type PublicationHealth,
  type PublicationState
} from "../domain/publicationEligibility";

export { PHASE1_MINIMUM_STABLE_COMPANIES };
export { DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS };

export type StagedReleaseMode = "PHASE1";

export type StagedReleaseReadinessIssueCode =
  | "DUPLICATE_COMPANY"
  | "RELEASE_CANDIDATE_NOT_RELEASE_ELIGIBLE"
  | "CANONICAL_ROSTER_MISMATCH"
  | "AUTHORIZED_EXCLUSION_MISMATCH"
  | "INVALID_PUBLICATION_STATE"
  | "MISSING_LAST_SUCCESS"
  | "STALE_LAST_SUCCESS"
  | "FUTURE_LAST_SUCCESS"
  | "SNAPSHOT_ELIGIBLE_COMPANY_DRIFT"
  | "SNAPSHOT_ELIGIBLE_SOURCE_DRIFT"
  | "SNAPSHOT_STATE_COUNT_DRIFT"
  | "SNAPSHOT_HEALTH_COUNT_DRIFT"
  | "MINIMUM_STABLE_COMPANIES_NOT_MET";

export interface StagedReleaseReadinessIssue {
  code: StagedReleaseReadinessIssueCode;
  message: string;
  companyId?: string;
}

export interface StagedReleaseReadinessInput {
  snapshot: CompanyPublicationSnapshot;
  mode: StagedReleaseMode;
  currentTime: Date;
  releaseCandidateStatus: string;
  freshnessMaximumMs?: number;
}

export interface StagedReleaseReadinessReport {
  mode: StagedReleaseMode;
  releaseCandidateStatus: string;
  canRelease: boolean;
  rosterCompanyCount: number;
  foreignCompanyCount: number;
  domesticCompanyCount: number;
  authorizedExclusionCount: number;
  stableCompanyIds: string[];
  stableCompanyCount: number;
  minimumStableCompanyCount: number;
  freshnessMaximumMs: number;
  issues: StagedReleaseReadinessIssue[];
}

const PUBLICATION_STATES: readonly PublicationState[] = [
  "PUBLISHING",
  "VERIFYING",
  "OFFICIAL_LINK_ONLY",
  "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
  "USER_AUTHORIZED_PHASE1_EXCLUSION"
];
const PUBLICATION_HEALTH: readonly PublicationHealth[] = ["HEALTHY", "DEGRADED", "NOT_APPLICABLE"];

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function canonicalIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function exactIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(canonicalIds(left)) === JSON.stringify(canonicalIds(right)) &&
    new Set(left).size === left.length && new Set(right).size === right.length;
}

function derivedCounts<T extends string>(values: readonly T[], keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length])) as Record<T, number>;
}

function sameCounts<T extends string>(left: Record<T, number>, right: Record<T, number>, keys: readonly T[]): boolean {
  return keys.every((key) => left[key] === right[key]);
}

function addIssue(
  issues: StagedReleaseReadinessIssue[],
  code: StagedReleaseReadinessIssueCode,
  message: string,
  companyId?: string
): void {
  issues.push({ code, message, ...(companyId ? { companyId } : {}) });
}

function stablePublicationRecord(
  company: CompanyPublicationRecord,
  input: { currentTimeMs: number; freshnessMaximumMs: number },
  issues: StagedReleaseReadinessIssue[]
): boolean {
  if (company.state !== "PUBLISHING") {
    if (company.eligibleSourceIds.length > 0) {
      addIssue(issues, "INVALID_PUBLICATION_STATE", "A non-publishing company exposes eligible sources.", company.companyId);
    }
    return false;
  }
  if (
    company.health !== "HEALTHY" ||
    company.stagedSourceIds.length === 0 ||
    !exactIds(company.eligibleSourceIds, company.stagedSourceIds)
  ) {
    addIssue(issues, "INVALID_PUBLICATION_STATE", "Publishing requires healthy status and the exact non-empty staged source set.", company.companyId);
    return false;
  }
  if (company.lastSuccessAt === null) {
    addIssue(issues, "MISSING_LAST_SUCCESS", "Publishing company is missing its last successful scheduled refresh.", company.companyId);
    return false;
  }
  const ageMs = input.currentTimeMs - company.lastSuccessAt.getTime();
  if (ageMs < 0) {
    addIssue(issues, "FUTURE_LAST_SUCCESS", "Last successful refresh is in the future.", company.companyId);
    return false;
  }
  if (ageMs >= input.freshnessMaximumMs) {
    addIssue(issues, "STALE_LAST_SUCCESS", "Last successful refresh is older than the allowed freshness window.", company.companyId);
    return false;
  }
  return true;
}

export function evaluateStagedReleaseReadiness(
  input: StagedReleaseReadinessInput
): StagedReleaseReadinessReport {
  const freshnessMaximumMs = input.freshnessMaximumMs ?? DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS;
  const minimumStableCompanyCount = PHASE1_MINIMUM_STABLE_COMPANIES;
  if (!Number.isFinite(input.currentTime.getTime())) throw new Error("INVALID_STAGED_READINESS_CURRENT_TIME");
  if (!Number.isSafeInteger(freshnessMaximumMs) || freshnessMaximumMs <= 0) {
    throw new Error("INVALID_STAGED_READINESS_FRESHNESS_MAXIMUM");
  }
  const issues: StagedReleaseReadinessIssue[] = [];
  if (!["READY_FOR_QA", "RELEASED"].includes(input.releaseCandidateStatus)) {
    addIssue(
      issues,
      "RELEASE_CANDIDATE_NOT_RELEASE_ELIGIBLE",
      `Release candidate status ${input.releaseCandidateStatus || "MISSING"} is not release eligible.`
    );
  }
  const companyIds = new Set<string>();
  for (const company of input.snapshot.companies) {
    if (companyIds.has(company.companyId)) {
      addIssue(issues, "DUPLICATE_COMPANY", "Publication snapshot contains a duplicate company.", company.companyId);
    }
    companyIds.add(company.companyId);
  }

  try {
    assertExactConfirmedCompanyRosterV3(input.snapshot.companies.map(({ companyId: id, category }) => ({ id, category })));
  } catch {
    addIssue(issues, "CANONICAL_ROSTER_MISMATCH", "Publication snapshot is not the exact confirmed 30 plus 30 roster.");
  }

  for (const company of input.snapshot.companies) {
    const shouldBeExcluded = isUserAuthorizedPhase1Exclusion(company.companyId);
    if (shouldBeExcluded !== (company.state === "USER_AUTHORIZED_PHASE1_EXCLUSION")) {
      addIssue(issues, "AUTHORIZED_EXCLUSION_MISMATCH", "Authorized Phase 1 exclusion state does not match the canonical company id.", company.companyId);
    }
  }
  for (const exclusionId of AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS) {
    if (!companyIds.has(exclusionId)) {
      addIssue(issues, "AUTHORIZED_EXCLUSION_MISMATCH", "Authorized Phase 1 exclusion is missing.", exclusionId);
    }
  }

  const stableCompanyIds = canonicalIds(input.snapshot.companies
    .filter((company) => stablePublicationRecord(company, {
      currentTimeMs: input.currentTime.getTime(),
      freshnessMaximumMs
    }, issues))
    .map(({ companyId }) => companyId));
  const stableIdSet = new Set(stableCompanyIds);
  const stableSourceIds = canonicalIds(input.snapshot.companies
    .filter(({ companyId }) => stableIdSet.has(companyId))
    .flatMap(({ eligibleSourceIds }) => eligibleSourceIds));

  const snapshotEligibleCompanyIds = canonicalIds(input.snapshot.eligibleCompanyIds);
  if (!exactIds(snapshotEligibleCompanyIds, stableCompanyIds)) {
    const driftIds = canonicalIds([...snapshotEligibleCompanyIds, ...stableCompanyIds])
      .filter((companyId) => snapshotEligibleCompanyIds.includes(companyId) !== stableIdSet.has(companyId));
    for (const companyId of driftIds.length > 0 ? driftIds : [undefined]) {
      addIssue(issues, "SNAPSHOT_ELIGIBLE_COMPANY_DRIFT", "Snapshot eligible companies do not match current healthy and fresh records.", companyId);
    }
  }
  if (!exactIds(input.snapshot.eligibleSourceIds, stableSourceIds)) {
    addIssue(issues, "SNAPSHOT_ELIGIBLE_SOURCE_DRIFT", "Snapshot eligible sources do not match current stable companies.");
  }

  const actualStateCounts = derivedCounts(input.snapshot.companies.map(({ state }) => state), PUBLICATION_STATES);
  if (!sameCounts(input.snapshot.countsByState, actualStateCounts, PUBLICATION_STATES)) {
    addIssue(issues, "SNAPSHOT_STATE_COUNT_DRIFT", "Snapshot state totals do not match company records.");
  }
  const actualHealthCounts = derivedCounts(input.snapshot.companies.map(({ health }) => health), PUBLICATION_HEALTH);
  if (!sameCounts(input.snapshot.countsByHealth, actualHealthCounts, PUBLICATION_HEALTH)) {
    addIssue(issues, "SNAPSHOT_HEALTH_COUNT_DRIFT", "Snapshot health totals do not match company records.");
  }

  if (stableCompanyIds.length < minimumStableCompanyCount) {
    addIssue(
      issues,
      "MINIMUM_STABLE_COMPANIES_NOT_MET",
      `Only ${stableCompanyIds.length} companies are currently stable; ${minimumStableCompanyCount} are required.`
    );
  }

  return {
    mode: input.mode,
    releaseCandidateStatus: input.releaseCandidateStatus,
    canRelease: issues.length === 0,
    rosterCompanyCount: input.snapshot.companies.length,
    foreignCompanyCount: input.snapshot.companies.filter(({ category }) => category === "FOREIGN_PHARMA").length,
    domesticCompanyCount: input.snapshot.companies.filter(({ category }) => category === "DOMESTIC_PHARMA").length,
    authorizedExclusionCount: input.snapshot.companies
      .filter(({ state }) => state === "USER_AUTHORIZED_PHASE1_EXCLUSION").length,
    stableCompanyIds,
    stableCompanyCount: stableCompanyIds.length,
    minimumStableCompanyCount,
    freshnessMaximumMs,
    issues
  };
}
