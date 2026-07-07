import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("source crawl planning", () => {
  it("creates crawl plans only for social sources with official entry and chain evidence", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);

    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((plan) => plan.source.kind === "SOCIAL")).toBe(true);
    expect(plans.every((plan) => plan.source.officialEntryUrl)).toBe(true);
    expect(plans.every((plan) => plan.source.officialChainEvidenceUrl)).toBe(true);
    expect(plans.some((plan) => plan.company.id === "company-hengrui")).toBe(false);
  });

  it("assigns deterministic adapter ids for representative source types", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")?.adapterId).toBe(
      "official-json"
    );
    expect(getPlanBySourceId(plans, "source-novartis-social")?.adapterId).toBe("html-table");
    expect(getPlanBySourceId(plans, "source-fosun-pharma-social")?.adapterId).toBe(
      "html-table"
    );
    expect(getPlanBySourceId(plans, "source-cspc-social")?.adapterId).toBe("official-json");
  });
});
