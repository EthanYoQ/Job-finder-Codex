import { describe, expect, it } from "vitest";
import { getPortableCoverageScope } from "../../src/release/portableCoveragePolicy";
import { P0_LAUNCH_MANIFEST } from "../../src/release/launchManifest";
describe("portable required coverage policy", () => {
  it("preserves the historical41 manifest and explicitly excludes United Lab from required40", () => {
    const before = structuredClone(P0_LAUNCH_MANIFEST);
    const scope = getPortableCoverageScope();
    expect(scope.policyId).toBe("PORTABLE_REQUIRED_COHORT_40_V1");
    expect(scope.historicalCompanyIds).toHaveLength(41);
    expect(scope.requiredCompanyIds).toHaveLength(40);
    expect(scope.requiredSourceIds).toHaveLength(40);
    expect(scope.exclusions).toEqual([{companyId: "company-united-lab", sourceId: "source-united-lab-social", reasonCode: "USER_AUTHORIZED_EXCLUSION"}]);
    expect(scope.requiredCompanyIds).not.toContain("company-united-lab");
    expect(scope.requiredSourceIds).not.toContain("source-united-lab-social");
    expect(P0_LAUNCH_MANIFEST).toEqual(before);
  });
  it("returns independent scope values so a caller cannot change the shared runtime policy", () => {
    const scope = getPortableCoverageScope(); scope.requiredCompanyIds.length = 0; scope.exclusions[0]!.companyId = "changed";
    expect(getPortableCoverageScope().requiredCompanyIds).toHaveLength(40);
    expect(getPortableCoverageScope().exclusions[0]!.companyId).toBe("company-united-lab");
  });
});
