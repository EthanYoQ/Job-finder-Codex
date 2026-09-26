import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";

describe("Pfizer public China source contract", () => {
  it("uses the exact Workday China-country facet without hidden worker-type or city exclusions", () => {
    const plan = getPlanBySourceId(
      buildStagedSourceCrawlPlans(candidateCompanies),
      "source-pfizer-china-social"
    );
    if (plan?.adapterId !== "official-json" || !plan.workday) {
      throw new Error("Expected canonical Pfizer Workday plan");
    }
    expect(plan.workday).toMatchObject({
      tenant: "pfizer",
      site: "PfizerCareers",
      appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
      laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION"
    });
    expect(plan.workday).not.toHaveProperty("facetDescriptorBoundary");
    expect(plan.workday).not.toHaveProperty("locationFacetPolicy");
    expect(plan.workday).not.toHaveProperty("opaqueMultiLocationDetailPolicy");
  });

  it("binds the country facet into staged-plan identity", () => {
    const plan = getPlanBySourceId(
      buildStagedSourceCrawlPlans(candidateCompanies),
      "source-pfizer-china-social"
    );
    if (plan?.adapterId !== "official-json" || !plan.workday) throw new Error("Expected Pfizer plan");
    const changed = {
      ...plan,
      workday: { ...plan.workday, appliedFacets: {} }
    } as typeof plan;
    expect(sourcePlanConfigSha256(changed)).not.toBe(sourcePlanConfigSha256(plan));
  });
});
