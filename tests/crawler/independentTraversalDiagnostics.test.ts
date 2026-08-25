import { describe, expect, it } from "vitest";
import {
  classifyBGradeIndependentTraversalFailure,
  safeBGradeIndependentTraversalFailureReason
} from "../../src/crawler/independentTraversalDiagnostics";

describe("B-grade independent traversal diagnostics", () => {
  it("classifies browser navigation failures without exposing the raw error", () => {
    const failure = new Error("Plan-bound HTML browser validator navigation failed: https://secret.invalid/jobs");

    expect(classifyBGradeIndependentTraversalFailure(failure)).toBe("B_GRADE_BROWSER_NAVIGATION_FAILED");
  });

  it("classifies Playwright page.goto timeouts as browser navigation failures", () => {
    const failure = new Error("page.goto: Timeout 30000ms exceeded before DOMContentLoaded");

    expect(classifyBGradeIndependentTraversalFailure(failure)).toBe("B_GRADE_BROWSER_NAVIGATION_FAILED");
  });

  it("fails closed with a generic code for an unrecognized error", () => {
    expect(classifyBGradeIndependentTraversalFailure(new Error("secret runtime detail")))
      .toBe("B_GRADE_VALIDATOR_EXECUTION_FAILED");
  });

  it("retains an allowlisted validator stage while removing dynamic secret-bearing detail", () => {
    const failure = new Error(
      "Plan-bound HTML browser validator navigation failed: https://secret.invalid/jobs?token=private"
    );

    expect(safeBGradeIndependentTraversalFailureReason(failure)).toBe(
      "B-grade independent traversal failed: Plan-bound HTML browser validator navigation failed"
    );
    expect(safeBGradeIndependentTraversalFailureReason(new Error("secret runtime detail"))).toBe(
      "B-grade independent traversal failed: B_GRADE_VALIDATOR_EXECUTION_FAILED"
    );
    expect(safeBGradeIndependentTraversalFailureReason(
      new Error("Qilu browser validator page declaration invalid")
    )).toBe(
      "B-grade independent traversal failed: Qilu browser validator page declaration invalid"
    );
    expect(safeBGradeIndependentTraversalFailureReason(
      new Error("Xiuzheng browser validator HUMAN_RESOURCE_ROUTE navigation failed", {
        cause: new Error("https://secret.invalid/?token=private")
      })
    )).toBe(
      "B-grade independent traversal failed: Xiuzheng browser validator HUMAN_RESOURCE_ROUTE navigation failed"
    );
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
