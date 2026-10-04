export const DEFAULT_COMPLETENESS_DROP_PERCENT = 40;
export const DEFAULT_COMPLETENESS_DROP_MINIMUM_JOBS = 20;

const SHA256 = /^[0-9a-f]{64}$/u;
const TRUNCATION_ANOMALIES = new Set([
  "REPEATED_RESPONSE_FINGERPRINT",
  "REPEATED_JOB_ID_SET_WITH_NEXT",
  "CURSOR_NOT_ADVANCING",
  "OFFSET_NOT_ADVANCING",
  "MAX_PAGES_WITH_NEXT",
  "EXPECTED_CHANNEL_NOT_VISITED"
]);
const COMPLETENESS_ANOMALY_TRIGGER_CODES = new Set<string>([
  "TRUSTED_COUNT_DROP",
  ...[...TRUNCATION_ANOMALIES].map((code) => `PAGINATION_${code}`),
  "LAST_PAGE_WITH_NEXT_SIGNAL",
  "FULL_LAST_PAGE_WITHOUT_TERMINAL",
  "SUSPICIOUS_ADAPTER_CAPACITY_REACHED"
]);

export type TrustedCompletenessProofKind = "A" | "B" | "PLAN_BOUND_SOURCE_QUALITY_V1";

export interface TrustedCompletenessBaseline {
  sourceId: string;
  sourceResultId: string;
  sourceConfigSha256: string;
  /** Historical field name; the portable value is a proof kind, not an A/B grade. */
  certificateGrade: TrustedCompletenessProofKind;
  certificateSha256: string;
  certifiedJobCount: number;
  verifiedAt: string;
}

export interface PersistedTrustedCompletenessBaseline extends TrustedCompletenessBaseline {
  certificate: unknown;
  previousSourceResultId: string | null;
  previousJobCount: number | null;
  changeReason: TrustedBaselineChangeReason | null;
}

/** A reviewed scope/configuration change starts a new comparable series. The
 * prior row remains in history, but its count cannot qualify or veto this scope. */
export function comparablePortableBaseline<T extends TrustedCompletenessBaseline>(
  baseline: T | null, sourceId: string, sourceConfigSha256: string
): T | null {
  return baseline?.sourceId === sourceId && baseline.sourceConfigSha256 === sourceConfigSha256
    ? baseline : null;
}

export type CompletenessAnomalyTriggerCode =
  | "TRUSTED_COUNT_DROP"
  | `PAGINATION_${string}`
  | "LAST_PAGE_WITH_NEXT_SIGNAL"
  | "FULL_LAST_PAGE_WITHOUT_TERMINAL"
  | "SUSPICIOUS_ADAPTER_CAPACITY_REACHED";

export interface CompletenessAnomalyDecision {
  independentValidationRequired: boolean;
  triggerCodes: CompletenessAnomalyTriggerCode[];
  countChange: {
    previous: number;
    current: number;
    decrease: number;
    decreasePercent: number;
  } | null;
}

export function canonicalCompletenessAnomalyTriggerCodes(
  values: readonly string[]
): CompletenessAnomalyTriggerCode[] {
  if (values.length === 0 || values.some((value) => !COMPLETENESS_ANOMALY_TRIGGER_CODES.has(value))) {
    throw new Error("completeness anomaly trigger codes are empty or invalid");
  }
  return [...new Set(values)].sort((left, right) =>
    Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"))
  ) as CompletenessAnomalyTriggerCode[];
}

export type CompletenessValidationTrigger =
  | "INITIAL_QUALIFICATION"
  | "CONFIG_CHANGED"
  | "ANOMALY_TRIGGERED"
  | "STABLE_RUN";

export function selectCompletenessValidationTrigger(input: {
  baseline: TrustedCompletenessBaseline | null;
  currentSourceConfigSha256: string;
  anomaly: Pick<CompletenessAnomalyDecision, "independentValidationRequired">;
}): CompletenessValidationTrigger {
  if (!SHA256.test(input.currentSourceConfigSha256)) {
    throw new Error("current source config hash is invalid");
  }
  if (input.baseline === null) return "INITIAL_QUALIFICATION";
  assertTrustedCompletenessBaseline(input.baseline);
  if (input.baseline.sourceConfigSha256 !== input.currentSourceConfigSha256) return "CONFIG_CHANGED";
  return input.anomaly.independentValidationRequired ? "ANOMALY_TRIGGERED" : "STABLE_RUN";
}

export const TRUSTED_BASELINE_CHANGE_REASONS = Object.freeze([
  "OFFICIAL_EVIDENCE_CONFIRMED_INITIAL",
  "OFFICIAL_EVIDENCE_CONFIRMED_INCREASE",
  "OFFICIAL_EVIDENCE_CONFIRMED_DECREASE",
  "OFFICIAL_EVIDENCE_CONFIRMED_UNCHANGED",
  "INDEPENDENT_VALIDATION_CONFIRMED_INITIAL",
  "INDEPENDENT_VALIDATION_CONFIRMED_INCREASE",
  "INDEPENDENT_VALIDATION_CONFIRMED_DECREASE",
  "INDEPENDENT_VALIDATION_CONFIRMED_UNCHANGED",
  "PLAN_BOUND_REPLAY_CONFIRMED_INITIAL",
  "PLAN_BOUND_REPLAY_CONFIRMED_INCREASE",
  "PLAN_BOUND_REPLAY_CONFIRMED_DECREASE",
  "PLAN_BOUND_REPLAY_CONFIRMED_UNCHANGED"
] as const);

export type TrustedBaselineChangeReason = typeof TRUSTED_BASELINE_CHANGE_REASONS[number];
const TRUSTED_BASELINE_CHANGE_REASON_SET = new Set<string>(TRUSTED_BASELINE_CHANGE_REASONS);

export function isTrustedBaselineChangeReason(value: unknown): value is TrustedBaselineChangeReason {
  return typeof value === "string" && TRUSTED_BASELINE_CHANGE_REASON_SET.has(value);
}

export interface TrustedBaselineTransition {
  previousSourceResultId: string | null;
  previousJobCount: number | null;
  currentSourceResultId: string;
  currentJobCount: number;
  changeReason: TrustedBaselineChangeReason;
}

export function evaluateCompletenessAnomaly(input: {
  baseline: TrustedCompletenessBaseline | null;
  currentJobCount: number;
  paginationAnomalyCodes?: readonly string[];
  finalPage?: {
    returnedPageSize: number | null;
    requestedPageSize: number | null;
    terminalSignalProven: boolean;
    nextSignalPresent?: boolean;
  };
  suspiciousAdapterCapacity?: number | null;
  dropPercent?: number;
  dropMinimumJobs?: number;
}): CompletenessAnomalyDecision {
  assertNonnegativeInteger(input.currentJobCount, "current job count");
  const dropPercent = input.dropPercent ?? DEFAULT_COMPLETENESS_DROP_PERCENT;
  const dropMinimumJobs = input.dropMinimumJobs ?? DEFAULT_COMPLETENESS_DROP_MINIMUM_JOBS;
  if (!Number.isFinite(dropPercent) || dropPercent <= 0 || dropPercent > 100) {
    throw new Error("drop percent must be greater than zero and at most 100");
  }
  assertNonnegativeInteger(dropMinimumJobs, "drop minimum jobs");

  const triggerCodes = new Set<CompletenessAnomalyTriggerCode>();
  let countChange: CompletenessAnomalyDecision["countChange"] = null;
  const previous = input.baseline?.certifiedJobCount ?? null;
  if (input.baseline) assertTrustedCompletenessBaseline(input.baseline);
  if (previous !== null) {
    assertNonnegativeInteger(previous, "completeness reference job count");
    const decrease = Math.max(0, previous - input.currentJobCount);
    const decreasePercent = previous === 0 ? 0 : decrease / previous * 100;
    countChange = { previous, current: input.currentJobCount, decrease, decreasePercent };
    if (decrease >= dropMinimumJobs && decreasePercent >= dropPercent) {
      triggerCodes.add("TRUSTED_COUNT_DROP");
    }
  }

  for (const anomaly of input.paginationAnomalyCodes ?? []) {
    if (TRUNCATION_ANOMALIES.has(anomaly)) {
      triggerCodes.add(`PAGINATION_${anomaly}`);
    }
  }
  const finalPage = input.finalPage;
  if (finalPage?.nextSignalPresent && !finalPage.terminalSignalProven) {
    triggerCodes.add("LAST_PAGE_WITH_NEXT_SIGNAL");
  }
  if (finalPage && finalPage.requestedPageSize !== null && finalPage.returnedPageSize !== null &&
      finalPage.requestedPageSize > 0 && finalPage.returnedPageSize === finalPage.requestedPageSize &&
      !finalPage.terminalSignalProven) {
    triggerCodes.add("FULL_LAST_PAGE_WITHOUT_TERMINAL");
  }
  const suspiciousCapacity = input.suspiciousAdapterCapacity;
  if (suspiciousCapacity !== undefined && suspiciousCapacity !== null) {
    if (!Number.isSafeInteger(suspiciousCapacity) || suspiciousCapacity <= 0) {
      throw new Error("suspicious adapter capacity must be a positive integer");
    }
    if (input.currentJobCount === suspiciousCapacity) {
      triggerCodes.add("SUSPICIOUS_ADAPTER_CAPACITY_REACHED");
    }
  }

  return {
    independentValidationRequired: triggerCodes.size > 0,
    triggerCodes: [...triggerCodes],
    countChange
  };
}

export function transitionTrustedCompletenessBaseline(input: {
  previous: TrustedCompletenessBaseline | null;
  verified: TrustedCompletenessBaseline;
}): TrustedBaselineTransition {
  assertTrustedCompletenessBaseline(input.verified);
  if (input.previous) {
    assertTrustedCompletenessBaseline(input.previous);
    if (input.previous.sourceId !== input.verified.sourceId) {
      throw new Error("trusted baseline transition source mismatch");
    }
    if (Date.parse(input.verified.verifiedAt) < Date.parse(input.previous.verifiedAt)) {
      throw new Error("trusted baseline transition moved backwards in time");
    }
  }
  const direction = input.previous === null
    ? "INITIAL"
    : input.verified.certifiedJobCount > input.previous.certifiedJobCount
      ? "INCREASE"
      : input.verified.certifiedJobCount < input.previous.certifiedJobCount
        ? "DECREASE"
        : "UNCHANGED";
  const proof = proofReasonPrefix(input.verified.certificateGrade);
  return assertTrustedBaselineTransition({
    previousSourceResultId: input.previous?.sourceResultId ?? null,
    previousJobCount: input.previous?.certifiedJobCount ?? null,
    currentSourceResultId: input.verified.sourceResultId,
    currentJobCount: input.verified.certifiedJobCount,
    certificateGrade: input.verified.certificateGrade,
    changeReason: `${proof}_${direction}`
  });
}

export function assertTrustedBaselineTransition(input: {
  previousSourceResultId: string | null | undefined;
  previousJobCount: number | null | undefined;
  currentSourceResultId: string;
  currentJobCount: number;
  /** Historical field name; the portable value is a proof kind, not an A/B grade. */
  certificateGrade: TrustedCompletenessProofKind;
  changeReason: unknown;
}): TrustedBaselineTransition {
  if (!input.currentSourceResultId.trim()) throw new Error("trusted baseline current source result id is required");
  assertNonnegativeInteger(input.currentJobCount, "trusted baseline current job count");
  if (!isTrustedBaselineChangeReason(input.changeReason)) {
    throw new Error("trusted baseline transition change reason is invalid");
  }
  const previousId = input.previousSourceResultId ?? null;
  const previousCount = input.previousJobCount ?? null;
  const previousSupplied = previousId !== null || previousCount !== null;
  if ((previousId === null) !== (previousCount === null)) {
    throw new Error("trusted baseline transition previous identity and count must be supplied together");
  }
  if (previousId !== null) {
    if (!previousId.trim() || previousId === input.currentSourceResultId) {
      throw new Error("trusted baseline previous source result id is invalid");
    }
    assertNonnegativeInteger(previousCount!, "trusted baseline previous job count");
  }
  const expectedProof = `${proofReasonPrefix(input.certificateGrade)}_`;
  if (!input.changeReason.startsWith(expectedProof)) {
    throw new Error("trusted baseline transition reason does not match certificate grade");
  }
  const direction = input.changeReason.slice(expectedProof.length);
  if ((direction === "INITIAL") !== !previousSupplied) {
    throw new Error("trusted baseline initial transition previous values are inconsistent");
  }
  if (previousCount !== null) {
    const directionMatches = direction === "INCREASE"
      ? input.currentJobCount > previousCount
      : direction === "DECREASE"
        ? input.currentJobCount < previousCount
        : direction === "UNCHANGED" && input.currentJobCount === previousCount;
    if (!directionMatches) throw new Error("trusted baseline transition count direction is inconsistent");
  }
  return {
    previousSourceResultId: previousId,
    previousJobCount: previousCount,
    currentSourceResultId: input.currentSourceResultId,
    currentJobCount: input.currentJobCount,
    changeReason: input.changeReason
  };
}

export function assertTrustedCompletenessBaseline(
  value: TrustedCompletenessBaseline
): TrustedCompletenessBaseline {
  proofReasonPrefix(value.certificateGrade);
  if (!value.sourceId.trim() || !value.sourceResultId.trim()) {
    throw new Error("trusted baseline source identity is required");
  }
  if (!SHA256.test(value.sourceConfigSha256)) {
    throw new Error("trusted baseline source config hash is invalid");
  }
  if (!SHA256.test(value.certificateSha256)) {
    throw new Error("trusted baseline certificate hash is invalid");
  }
  assertNonnegativeInteger(value.certifiedJobCount, "trusted baseline certified job count");
  if (!Number.isFinite(Date.parse(value.verifiedAt))) {
    throw new Error("trusted baseline verification time is invalid");
  }
  return value;
}

function assertNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer`);
  }
}

function proofReasonPrefix(kind: TrustedCompletenessProofKind): string {
  if (kind === "A") return "OFFICIAL_EVIDENCE_CONFIRMED";
  if (kind === "B") return "INDEPENDENT_VALIDATION_CONFIRMED";
  if (kind === "PLAN_BOUND_SOURCE_QUALITY_V1") return "PLAN_BOUND_REPLAY_CONFIRMED";
  throw new Error("Trusted completeness proof kind is invalid");
}
