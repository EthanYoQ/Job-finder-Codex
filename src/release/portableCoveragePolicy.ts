import { P0_LAUNCH_MANIFEST } from "./launchManifest";

/** Current required coverage, independent of the immutable historical launch manifest. */
export const PORTABLE_COVERAGE_POLICY_ID = "PORTABLE_REQUIRED_COHORT_40_V1" as const;
export interface PortableCoverageExclusion {
  companyId: string;
  sourceId: string;
  reasonCode: "USER_AUTHORIZED_EXCLUSION";
}
export interface PortableCoverageScope {
  policyId: typeof PORTABLE_COVERAGE_POLICY_ID;
  historicalCompanyIds: string[];
  historicalSourceIds: string[];
  requiredCompanyIds: string[];
  requiredSourceIds: string[];
  exclusions: PortableCoverageExclusion[];
}

/** Return new values on every read; callers cannot mutate the shared policy. */
export function getPortableCoverageScope(): PortableCoverageScope {
  const historical = P0_LAUNCH_MANIFEST.companies;
  const excluded = historical.find(company => company.companyId === "company-united-lab");
  if (historical.length !== 41 || new Set(historical.map(company => company.companyId)).size !== 41 ||
      new Set(historical.map(company => company.source.sourceId)).size !== 41 || excluded?.source.sourceId !== "source-united-lab-social") {
    throw new Error("PORTABLE_COVERAGE_MANIFEST_DRIFT");
  }
  const required = historical.filter(company => company.companyId !== excluded.companyId);
  return {
    policyId: PORTABLE_COVERAGE_POLICY_ID,
    historicalCompanyIds: historical.map(company => company.companyId),
    historicalSourceIds: historical.map(company => company.source.sourceId),
    requiredCompanyIds: required.map(company => company.companyId),
    requiredSourceIds: required.map(company => company.source.sourceId),
    exclusions: [{companyId: excluded.companyId, sourceId: excluded.source.sourceId, reasonCode: "USER_AUTHORIZED_EXCLUSION"}]
  };
}
