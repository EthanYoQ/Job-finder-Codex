import { describe, expect, it } from "vitest";
import {
  assertTrustedBaselineTransition,
  evaluateCompletenessAnomaly,
  selectCompletenessValidationTrigger,
  transitionTrustedCompletenessBaseline,
  type TrustedCompletenessBaseline
} from "../../src/crawler/completenessAnomalyPolicy";

const baseline: TrustedCompletenessBaseline = {
  sourceId: "source-viatris-social",
  sourceResultId: "verified-source-result-1",
  sourceConfigSha256: "a".repeat(64),
  certificateGrade: "B",
  certificateSha256: "b".repeat(64),
  certifiedJobCount: 50,
  verifiedAt: "2026-08-12T00:00:00.000Z"
};

describe("completeness anomaly policy", () => {
  it("triggers only when the default decline reaches both 40 percent and 20 jobs", () => {
    expect(evaluateCompletenessAnomaly({ baseline, currentJobCount: 30 }).triggerCodes)
      .toEqual(["TRUSTED_COUNT_DROP"]);
    expect(evaluateCompletenessAnomaly({ baseline, currentJobCount: 31 }).triggerCodes)
      .toEqual([]);
    expect(evaluateCompletenessAnomaly({
      baseline: { ...baseline, certifiedJobCount: 100 },
      currentJobCount: 60
    }).triggerCodes).toEqual(["TRUSTED_COUNT_DROP"]);
    expect(evaluateCompletenessAnomaly({
      baseline: { ...baseline, certifiedJobCount: 100 },
      currentJobCount: 59
    }).triggerCodes).toEqual(["TRUSTED_COUNT_DROP"]);
    expect(evaluateCompletenessAnomaly({
      baseline: { ...baseline, certifiedJobCount: 100 },
      currentJobCount: 61
    }).triggerCodes).toEqual([]);
    expect(evaluateCompletenessAnomaly({
      baseline: { ...baseline, certifiedJobCount: 30 },
      currentJobCount: 10
    }).triggerCodes).toEqual(["TRUSTED_COUNT_DROP"]);
    expect(evaluateCompletenessAnomaly({
      baseline: { ...baseline, certifiedJobCount: 19 },
      currentJobCount: 0
    }).triggerCodes).toEqual([]);
  });

  it("does not treat ordinary additions, removals, or exact repeat counts as proof or failure", () => {
    expect(evaluateCompletenessAnomaly({ baseline, currentJobCount: 49 })).toMatchObject({
      independentValidationRequired: false,
      triggerCodes: []
    });
    expect(evaluateCompletenessAnomaly({ baseline, currentJobCount: 50 }).triggerCodes).toEqual([]);
    expect(evaluateCompletenessAnomaly({ baseline, currentJobCount: 80 }).triggerCodes).toEqual([]);
  });

  it.each([
    "REPEATED_RESPONSE_FINGERPRINT",
    "REPEATED_JOB_ID_SET_WITH_NEXT",
    "CURSOR_NOT_ADVANCING",
    "OFFSET_NOT_ADVANCING",
    "MAX_PAGES_WITH_NEXT",
    "EXPECTED_CHANNEL_NOT_VISITED"
  ] as const)("treats %s as an independent truncation trigger", (anomalyCode) => {
    expect(evaluateCompletenessAnomaly({
      baseline,
      currentJobCount: 50,
      paginationAnomalyCodes: [anomalyCode]
    })).toMatchObject({
      independentValidationRequired: true,
      triggerCodes: [`PAGINATION_${anomalyCode}`]
    });
  });

  it("triggers on an unproven full last page and on an exact declared adapter capacity", () => {
    expect(evaluateCompletenessAnomaly({
      baseline,
      currentJobCount: 50,
      finalPage: { returnedPageSize: 10, requestedPageSize: 10, terminalSignalProven: false }
    }).triggerCodes).toEqual(["FULL_LAST_PAGE_WITHOUT_TERMINAL"]);
    expect(evaluateCompletenessAnomaly({
      baseline,
      currentJobCount: 100,
      suspiciousAdapterCapacity: 100
    }).triggerCodes).toEqual(["SUSPICIOUS_ADAPTER_CAPACITY_REACHED"]);
  });

  it("triggers whenever the last captured page still exposes a next-page signal", () => {
    expect(evaluateCompletenessAnomaly({
      baseline,
      currentJobCount: 45,
      finalPage: {
        returnedPageSize: 5,
        requestedPageSize: 10,
        terminalSignalProven: false,
        nextSignalPresent: true
      }
    }).triggerCodes).toEqual(["LAST_PAGE_WITH_NEXT_SIGNAL"]);
  });

  it("advances the trusted baseline only after a certificate and preserves why it changed", () => {
    expect(transitionTrustedCompletenessBaseline({
      previous: baseline,
      verified: {
        sourceId: baseline.sourceId,
        sourceResultId: "verified-source-result-2",
        sourceConfigSha256: baseline.sourceConfigSha256,
        certificateGrade: "B",
        certificateSha256: "c".repeat(64),
        certifiedJobCount: 10,
        verifiedAt: "2026-08-13T00:00:00.000Z"
      }
    })).toMatchObject({
      previousSourceResultId: baseline.sourceResultId,
      previousJobCount: 50,
      currentJobCount: 10,
      changeReason: "INDEPENDENT_VALIDATION_CONFIRMED_DECREASE"
    });
    expect(() => transitionTrustedCompletenessBaseline({
      previous: baseline,
      verified: { ...baseline, sourceResultId: "unverified", certificateSha256: "" }
    })).toThrow(/certificate/i);
    expect(transitionTrustedCompletenessBaseline({
      previous: { ...baseline, certificateGrade: "A", certifiedJobCount: 100 },
      verified: {
        ...baseline,
        sourceResultId: "official-result-2",
        certificateGrade: "A",
        certificateSha256: "d".repeat(64),
        certifiedJobCount: 10,
        verifiedAt: "2026-08-13T00:00:00.000Z"
      }
    })).toMatchObject({
      previousJobCount: 100,
      currentJobCount: 10,
      changeReason: "OFFICIAL_EVIDENCE_CONFIRMED_DECREASE"
    });
  });

  it("selects bounded browser validation triggers without turning stable runs into mandatory refreshes", () => {
    expect(selectCompletenessValidationTrigger({
      baseline: null,
      currentSourceConfigSha256: baseline.sourceConfigSha256,
      anomaly: { independentValidationRequired: false }
    })).toBe("INITIAL_QUALIFICATION");
    expect(selectCompletenessValidationTrigger({
      baseline,
      currentSourceConfigSha256: "c".repeat(64),
      anomaly: { independentValidationRequired: false }
    })).toBe("CONFIG_CHANGED");
    expect(selectCompletenessValidationTrigger({
      baseline,
      currentSourceConfigSha256: baseline.sourceConfigSha256,
      anomaly: { independentValidationRequired: true }
    })).toBe("ANOMALY_TRIGGERED");
    expect(selectCompletenessValidationTrigger({
      baseline,
      currentSourceConfigSha256: baseline.sourceConfigSha256,
      anomaly: { independentValidationRequired: false }
    })).toBe("STABLE_RUN");
  });

  it.each([
    {
      label: "initial transition with previous values",
      input: { previousSourceResultId: "previous", previousJobCount: 10,
        currentSourceResultId: "current", currentJobCount: 10, certificateGrade: "A" as const,
        changeReason: "OFFICIAL_EVIDENCE_CONFIRMED_INITIAL" }
    },
    {
      label: "non-initial transition without previous values",
      input: { previousSourceResultId: null, previousJobCount: null,
        currentSourceResultId: "current", currentJobCount: 10, certificateGrade: "B" as const,
        changeReason: "INDEPENDENT_VALIDATION_CONFIRMED_UNCHANGED" }
    },
    {
      label: "decrease reason whose count increased",
      input: { previousSourceResultId: "previous", previousJobCount: 10,
        currentSourceResultId: "current", currentJobCount: 11, certificateGrade: "B" as const,
        changeReason: "INDEPENDENT_VALIDATION_CONFIRMED_DECREASE" }
    },
    {
      label: "official reason with an independent certificate",
      input: { previousSourceResultId: null, previousJobCount: null,
        currentSourceResultId: "current", currentJobCount: 10, certificateGrade: "B" as const,
        changeReason: "OFFICIAL_EVIDENCE_CONFIRMED_INITIAL" }
    }
  ])("rejects $label", ({ input }) => {
    expect(() => assertTrustedBaselineTransition(input)).toThrow(/trusted baseline/i);
  });
});
