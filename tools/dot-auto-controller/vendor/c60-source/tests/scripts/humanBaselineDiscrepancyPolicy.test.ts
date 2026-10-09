import { describe, expect, it } from "vitest";
import { assessHumanBaselineDiscrepancy } from "../../scripts/human-baseline-discrepancy-policy";

const completeCurrentFetch = {
  crawlStatus: "SUCCESS" as const,
  completenessVerified: true,
  unaccountedLossCount: 0,
  baselineScopeConflict: false,
  rawInputCount: 100,
  legalDedupeCount: 0,
  scopeExcludedCount: 0,
  hasBaselineJobSet: false
};

describe("human baseline discrepancy policy", () => {
  it.each([-2, -1, 1, 2])(
    "requires review for a small non-zero delta of %s instead of assuming time drift",
    (delta) => {
      const baselineCount = 100;
      const result = assessHumanBaselineDiscrepancy({
        ...completeCurrentFetch,
        baselineCount,
        actualCount: baselineCount + delta,
        rawInputCount: baselineCount + delta
      });

      expect(result).toMatchObject({
        delta,
        reviewRequired: true,
        historicalAssessment: "HISTORICAL_DELTA_UNRESOLVED",
        blocking: true
      });
    }
  );

  it("does not infer time drift for a large delta without the baseline job set", () => {
    expect(assessHumanBaselineDiscrepancy({
      ...completeCurrentFetch,
      baselineCount: 37,
      actualCount: 50,
      rawInputCount: 50
    })).toMatchObject({
      delta: 13,
      deltaSeverity: "LARGE",
      historicalAssessment: "HISTORICAL_DELTA_UNRESOLVED",
      blocking: true
    });
  });

  it("records an exact upstream duplicate explanation without hiding the review", () => {
    expect(assessHumanBaselineDiscrepancy({
      ...completeCurrentFetch,
      baselineCount: 236,
      actualCount: 235,
      rawInputCount: 236,
      legalDedupeCount: 1
    })).toMatchObject({
      delta: -1,
      reviewRequired: true,
      historicalAssessment: "EXPLAINED_UPSTREAM_DUPLICATE",
      blocking: false
    });
  });

  it("records an exact mainland scope exclusion without treating it as crawler loss", () => {
    expect(assessHumanBaselineDiscrepancy({
      ...completeCurrentFetch,
      baselineCount: 2,
      actualCount: 1,
      rawInputCount: 2,
      scopeExcludedCount: 1
    })).toMatchObject({
      delta: -1,
      reviewRequired: true,
      historicalAssessment: "EXPLAINED_SCOPE_EXCLUSION",
      blocking: false
    });
  });

  it("keeps an explicitly documented baseline scope conflict separate from runtime correctness", () => {
    expect(assessHumanBaselineDiscrepancy({
      ...completeCurrentFetch,
      baselineCount: 177,
      actualCount: 5,
      rawInputCount: 5,
      baselineScopeConflict: true
    })).toMatchObject({
      reviewRequired: true,
      historicalAssessment: "EXPLAINED_BASELINE_SCOPE_CONFLICT",
      blocking: false
    });
  });

  it("blocks a self-consistent count when current completeness is not independently established", () => {
    expect(assessHumanBaselineDiscrepancy({
      ...completeCurrentFetch,
      baselineCount: 100,
      actualCount: 100,
      rawInputCount: 100,
      completenessVerified: false
    })).toMatchObject({
      reviewRequired: true,
      historicalAssessment: "CURRENT_METHOD_UNVERIFIED",
      blocking: true
    });
  });
});
