export type HumanBaselineDeltaSeverity = "NONE" | "SMALL" | "LARGE" | "UNKNOWN";

export type HumanBaselineHistoricalAssessment =
  | "MATCH"
  | "UNKNOWN_BASELINE"
  | "PIPELINE_FAILURE"
  | "CURRENT_METHOD_UNVERIFIED"
  | "EXPLAINED_BASELINE_SCOPE_CONFLICT"
  | "EXPLAINED_UPSTREAM_DUPLICATE"
  | "EXPLAINED_SCOPE_EXCLUSION"
  | "HISTORICAL_DELTA_UNRESOLVED";

export interface HumanBaselineDiscrepancyInput {
  baselineCount: number | null;
  actualCount: number | null;
  crawlStatus: "SUCCESS" | "FAILED";
  completenessVerified: boolean;
  unaccountedLossCount: number;
  baselineScopeConflict: boolean;
  rawInputCount: number;
  legalDedupeCount: number;
  scopeExcludedCount: number;
  hasBaselineJobSet: boolean;
}

export interface HumanBaselineDiscrepancyAssessment {
  delta: number | null;
  deltaSeverity: HumanBaselineDeltaSeverity;
  reviewRequired: boolean;
  blocking: boolean;
  historicalAssessment: HumanBaselineHistoricalAssessment;
  baselineJobSetAvailable: boolean;
}

export function assessHumanBaselineDiscrepancy(
  input: HumanBaselineDiscrepancyInput
): HumanBaselineDiscrepancyAssessment {
  const shared = { baselineJobSetAvailable: input.hasBaselineJobSet };

  if (input.crawlStatus !== "SUCCESS" || input.actualCount === null) {
    return {
      ...shared,
      delta: null,
      deltaSeverity: "UNKNOWN",
      reviewRequired: true,
      blocking: true,
      historicalAssessment: "PIPELINE_FAILURE"
    };
  }

  if (input.baselineCount === null) {
    return {
      ...shared,
      delta: null,
      deltaSeverity: "UNKNOWN",
      reviewRequired: true,
      blocking: true,
      historicalAssessment: "UNKNOWN_BASELINE"
    };
  }

  const delta = input.actualCount - input.baselineCount;
  const deltaSeverity = delta === 0 ? "NONE" : Math.abs(delta) <= 2 ? "SMALL" : "LARGE";

  if (!input.completenessVerified || input.unaccountedLossCount > 0) {
    return {
      ...shared,
      delta,
      deltaSeverity,
      reviewRequired: true,
      blocking: true,
      historicalAssessment: "CURRENT_METHOD_UNVERIFIED"
    };
  }

  if (delta === 0) {
    return {
      ...shared,
      delta,
      deltaSeverity,
      reviewRequired: false,
      blocking: false,
      historicalAssessment: "MATCH"
    };
  }

  const discrepancySeverity: "SMALL" | "LARGE" = Math.abs(delta) <= 2 ? "SMALL" : "LARGE";

  if (input.baselineScopeConflict) {
    return explained(input, delta, discrepancySeverity, "EXPLAINED_BASELINE_SCOPE_CONFLICT");
  }

  if (
    input.rawInputCount === input.baselineCount &&
    input.legalDedupeCount > 0 &&
    input.rawInputCount - input.legalDedupeCount === input.actualCount
  ) {
    return explained(input, delta, discrepancySeverity, "EXPLAINED_UPSTREAM_DUPLICATE");
  }

  if (
    input.rawInputCount === input.baselineCount &&
    input.scopeExcludedCount > 0 &&
    input.rawInputCount - input.scopeExcludedCount === input.actualCount
  ) {
    return explained(input, delta, discrepancySeverity, "EXPLAINED_SCOPE_EXCLUSION");
  }

  return {
    ...shared,
    delta,
    deltaSeverity,
    reviewRequired: true,
    blocking: true,
    historicalAssessment: "HISTORICAL_DELTA_UNRESOLVED"
  };
}

function explained(
  input: HumanBaselineDiscrepancyInput,
  delta: number,
  deltaSeverity: Exclude<HumanBaselineDeltaSeverity, "NONE" | "UNKNOWN">,
  historicalAssessment: Extract<
    HumanBaselineHistoricalAssessment,
    "EXPLAINED_BASELINE_SCOPE_CONFLICT" | "EXPLAINED_UPSTREAM_DUPLICATE" | "EXPLAINED_SCOPE_EXCLUSION"
  >
): HumanBaselineDiscrepancyAssessment {
  return {
    baselineJobSetAvailable: input.hasBaselineJobSet,
    delta,
    deltaSeverity,
    reviewRequired: true,
    blocking: false,
    historicalAssessment
  };
}
