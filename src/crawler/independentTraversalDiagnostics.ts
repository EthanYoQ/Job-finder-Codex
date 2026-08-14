export const B_GRADE_INDEPENDENT_TRAVERSAL_FAILURE_CODES = Object.freeze([
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

export function classifyBGradeIndependentTraversalFailure(
  error: unknown
): BGradeIndependentTraversalFailureCode {
  const message = error instanceof Error ? error.message : "";
  if (/\bnavigation\b/iu.test(message)) return "B_GRADE_BROWSER_NAVIGATION_FAILED";
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
