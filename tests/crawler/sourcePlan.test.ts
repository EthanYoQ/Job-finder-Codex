import { describe, expect, it } from "vitest";
import { candidateCompanies, type CandidateCompany } from "../../src/data/companyRegistry";
import { buildSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("source crawl planning", () => {
  it("creates crawl plans only for social sources with official entry and chain evidence", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);

    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((plan) => plan.source.kind === "SOCIAL")).toBe(true);
    expect(plans.every((plan) => plan.source.status === "VERIFIED_SCRAPABLE")).toBe(true);
    expect(plans.every((plan) => plan.source.officialEntryUrl)).toBe(true);
    expect(plans.every((plan) => plan.source.officialChainEvidenceUrl)).toBe(true);
    expect(plans.some((plan) => plan.company.id === "company-hengrui")).toBe(false);
  });

  it("does not plan pending sources even when they have official urls and adapter config", () => {
    const pendingConfiguredCompany: CandidateCompany = {
      id: "company-astrazeneca",
      officialChineseName: "阿斯利康制药有限公司",
      pinyinName: "asili-kang",
      inclusionReason: "local fixture for pending source filtering",
      sources: [
        {
          id: "source-astrazeneca-social",
          companyId: "company-astrazeneca",
          kind: "SOCIAL",
          atsKind: "OFFICIAL_JSON",
          status: "ENTRY_FOUND_PENDING_ADAPTER",
          officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
          officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers"
        }
      ]
    };

    const plans = buildSourceCrawlPlans([pendingConfiguredCompany]);

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")).toBeUndefined();
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
