import { describe, expect, it } from "vitest";
import { classifyBGradeIndependentTraversalFailure } from "../../src/crawler/independentTraversalDiagnostics";

describe("B-grade independent traversal diagnostics", () => {
  it("classifies browser navigation failures without exposing the raw error", () => {
    const failure = new Error("Plan-bound HTML browser validator navigation failed: https://secret.invalid/jobs");

    expect(classifyBGradeIndependentTraversalFailure(failure)).toBe("B_GRADE_BROWSER_NAVIGATION_FAILED");
  });

  it("fails closed with a generic code for an unrecognized error", () => {
    expect(classifyBGradeIndependentTraversalFailure(new Error("secret runtime detail")))
      .toBe("B_GRADE_VALIDATOR_EXECUTION_FAILED");
  });

  it("maps validator failures to the closed diagnostic stages used by exact-source diagnostics", () => {
    const cases = [
      ["B-grade independent validator source binding mismatch", "B_GRADE_SOURCE_BINDING_FAILED"],
      ["Plan-bound HTML browser validation company binding mismatch", "B_GRADE_COMPANY_BINDING_FAILED"],
      ["B-grade browser validation registered policy mismatch", "B_GRADE_POLICY_REGISTRATION_FAILED"],
      ["Plan-bound HTML browser validator key policy mismatch", "B_GRADE_KEY_POLICY_FAILED"],
      ["browser validator rendered list did not stabilize", "B_GRADE_BROWSER_READINESS_FAILED"],
      ["browser validator request contract mismatch", "B_GRADE_REQUEST_PROTOCOL_FAILED"],
      ["browser validator pagination declaration changed", "B_GRADE_PAGINATION_FAILED"],
      ["browser validation raw set does not reconcile", "B_GRADE_RECONCILIATION_FAILED"],
      ["browser validation observedAt is invalid", "B_GRADE_EVIDENCE_VALIDATION_FAILED"]
    ] as const;

    expect(cases.map(([message]) => classifyBGradeIndependentTraversalFailure(new Error(message))))
      .toEqual(cases.map(([, code]) => code));
  });
});
