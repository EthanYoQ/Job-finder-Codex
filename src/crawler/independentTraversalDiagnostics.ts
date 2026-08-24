export const B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES = Object.freeze([
  "B_GRADE_SOURCE_BINDING_FAILED",
  "B_GRADE_COMPANY_BINDING_FAILED",
  "B_GRADE_POLICY_REGISTRATION_FAILED",
  "B_GRADE_KEY_POLICY_FAILED",
  "B_GRADE_PARTITION_PROOF_FAILED",
  "B_GRADE_PARTITION_CONTROL_SET_FAILED",
  "B_GRADE_PARTITION_DECLARATION_FAILED",
  "B_GRADE_PARTITION_EXPANSION_FAILED",
  "B_GRADE_PARTITION_URL_NORMALIZATION_FAILED",
  "B_GRADE_PARTITION_ROW_EXTRACTION_FAILED",
  "B_GRADE_PARTITION_COVERAGE_FAILED",
  "B_GRADE_VALIDATOR_ABORTED",
  "B_GRADE_POLICY_BINDING_FAILED",
  "B_GRADE_BROWSER_NAVIGATION_FAILED",
  "B_GRADE_BROWSER_READINESS_FAILED",
  "B_GRADE_REQUEST_PROTOCOL_FAILED",
  "B_GRADE_PAGINATION_FAILED",
  "B_GRADE_RECONCILIATION_FAILED",
  "B_GRADE_EVIDENCE_VALIDATION_FAILED",
  "B_GRADE_VALIDATOR_EXECUTION_FAILED"
] as const);

export type BGradeIndependentTraversalFailureCode =
  (typeof B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES)[number];

const B_GRADE_FAILURE_CODE_SET = new Set<string>(B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES);
const CLOSED_B_GRADE_FAILURE_REASON =
  "B-grade independent traversal failed at a closed diagnostic stage";
const SAFE_VALIDATOR_MESSAGES = new Set([
  "Plan-bound HTML browser validator navigation failed",
  "Qilu browser validator entry URL mismatch",
  "Qilu browser validator navigation failed",
  "Qilu browser validator page declaration invalid",
  "Qilu browser validator rendered row count invalid",
  "Qilu browser validator row shape invalid",
  "Qilu browser validator job navigation missing",
  "Qilu browser validator job URL invalid",
  "Qilu browser validator location scope is ambiguous or outside the audited exclusion policy",
  "Qilu browser validator next-page control missing",
  "Qilu browser validator terminal next control remained enabled",
  "Qilu browser validator rendered page did not stabilize"
]);

export function tagBGradeIndependentTraversalFailure(
  error: unknown,
  code: BGradeIndependentTraversalFailureCode
): unknown {
  if (readTaggedFailureCode(error)) return error;
  const tagged = error instanceof Error ? error : new Error(code);
  if (Object.isExtensible(tagged)) {
    Object.defineProperty(tagged, "bGradeIndependentTraversalFailureCode", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: code
    });
  }
  return tagged;
}

export function classifyBGradeIndependentTraversalFailure(
  error: unknown
): BGradeIndependentTraversalFailureCode {
  const tagged = readTaggedFailureCode(error);
  if (tagged) return tagged;
  const message = error instanceof Error ? error.message : "";
  if (/(?:\bnavigation\b|\bpage\.goto\b)/iu.test(message)) {
    return "B_GRADE_BROWSER_NAVIGATION_FAILED";
  }
  if (/\bsource binding mismatch\b/iu.test(message)) return "B_GRADE_SOURCE_BINDING_FAILED";
  if (/\bcompany binding mismatch\b/iu.test(message)) return "B_GRADE_COMPANY_BINDING_FAILED";
  if (/\bregistered policy mismatch\b/iu.test(message)) return "B_GRADE_POLICY_REGISTRATION_FAILED";
  if (/\b(?:key policy mismatch|URL policy is unavailable)\b/iu.test(message)) {
    return "B_GRADE_KEY_POLICY_FAILED";
  }
  if (/\b(?:binding|policy)\b/iu.test(message)) return "B_GRADE_POLICY_BINDING_FAILED";
  if (/\b(?:rendered|stabilize|attached|selector|control)\b/iu.test(message)) {
    return "B_GRADE_BROWSER_READINESS_FAILED";
  }
  if (/\b(?:request|response)\b/iu.test(message)) return "B_GRADE_REQUEST_PROTOCOL_FAILED";
  if (/\b(?:page|pagination|partition|continuation|next)\b/iu.test(message)) {
    return "B_GRADE_PAGINATION_FAILED";
  }
  if (/\b(?:reconcile|mismatch|identity|scope|raw row|raw set|match key)\b/iu.test(message)) {
    return "B_GRADE_RECONCILIATION_FAILED";
  }
  if (/\b(?:observedAt|expiresAt|certificate|validation equation)\b/iu.test(message)) {
    return "B_GRADE_EVIDENCE_VALIDATION_FAILED";
  }
  return "B_GRADE_VALIDATOR_EXECUTION_FAILED";
}

export function safeBGradeIndependentTraversalFailureReason(error: unknown): string {
  const normalized = error instanceof Error
    ? error.message.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim()
    : "";
  if (isSafeBGradeIndependentTraversalFailureReason(normalized)) return normalized;
  const detail = normalized.split(":", 1)[0]?.trim() ?? "";
  return SAFE_VALIDATOR_MESSAGES.has(detail)
    ? `B-grade independent traversal failed: ${detail}`
    : `B-grade independent traversal failed: ${classifyBGradeIndependentTraversalFailure(error)}`;
}

export function isSafeBGradeIndependentTraversalFailureReason(value: unknown): boolean {
  if (value === CLOSED_B_GRADE_FAILURE_REASON) return true;
  if (typeof value !== "string" || !value.startsWith("B-grade independent traversal failed: ")) {
    return false;
  }
  const detail = value.slice("B-grade independent traversal failed: ".length);
  return SAFE_VALIDATOR_MESSAGES.has(detail) || B_GRADE_FAILURE_CODE_SET.has(detail);
}

function readTaggedFailureCode(error: unknown): BGradeIndependentTraversalFailureCode | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as Record<string, unknown>).bGradeIndependentTraversalFailureCode;
  return typeof code === "string" && B_GRADE_FAILURE_CODE_SET.has(code)
    ? code as BGradeIndependentTraversalFailureCode
    : undefined;
}
