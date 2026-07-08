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
    expect(plans.some((plan) => plan.company.id === "company-hengrui")).toBe(true);
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

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")?.adapterId).toBe("html-table");
    expect(getPlanBySourceId(plans, "source-novartis-social")?.adapterId).toBe("html-table");
    expect(getPlanBySourceId(plans, "source-fosun-pharma-social")?.adapterId).toBe(
      "html-table"
    );
    expect(getPlanBySourceId(plans, "source-cspc-social")?.adapterId).toBe("official-json");
    const beigenePlan = getPlanBySourceId(plans, "source-beigene-social");
    expect(beigenePlan?.adapterId).toBe("official-json");
    if (beigenePlan?.adapterId !== "official-json") {
      throw new Error("Expected Beigene plan to use official-json adapter");
    }
    expect(beigenePlan.json).toMatchObject({
      jobsPath: "data.jobs",
      fields: {
        sourceJobId: "id",
        officialTitle: "title",
        officialUrl: "officialUrl",
        locationRaw: "locationRaw",
        cities: "cities"
      },
      defaultCategory: "其他"
    });
  });

  it("configures direct HTML and Moka crawl plans for wave 1 verified sources", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-astrazeneca-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "#search-results-list li",
        fields: {
          officialTitle: { selector: "a.search-results-link h2" },
          officialUrl: { selector: "a.search-results-link", attribute: "href" },
          locationRaw: { selector: "span.job-location" }
        }
      }
    });

    expect(byId.get("source-novartis-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "table.views-table tbody tr",
        fields: {
          officialTitle: { selector: "td.views-field-field-job-title a" },
          officialUrl: {
            selector: "td.views-field-field-job-title a",
            attribute: "href"
          },
          locationRaw: { selector: "td.views-field-field-job-work-location" }
        }
      }
    });

    expect(byId.get("source-fosun-pharma-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "table tr",
        fields: {
          officialTitle: { selector: "td:nth-child(1) a" },
          officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(4) a" }
        }
      }
    });

    expect(byId.get("source-hengrui-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
        officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html"
      }
    });

    expect(byId.get("source-kelun-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://kelun.zhiye.com/social",
        officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html"
      },
      table: {
        rowSelector: ".jobsTable tr:not(.title)",
        fields: {
          officialTitle: { selector: "td:nth-child(1) a" },
          officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(5)" }
        }
      }
    });
  });
});
