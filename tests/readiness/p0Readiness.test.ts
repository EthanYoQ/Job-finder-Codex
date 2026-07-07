import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { P0_MIN_VERIFIED_SCRAPABLE_COMPANIES } from "../../src/domain/verification";
import { getP0ReadinessReport } from "../../src/readiness/p0Readiness";

describe("P0 readiness report", () => {
  it("keeps the current project blocked until 50 crawl-evidenced companies are ready", () => {
    const report = getP0ReadinessReport();

    expect(report.totalCandidates).toBeGreaterThanOrEqual(80);
    expect(report.totalCandidates).toBeLessThanOrEqual(120);
    expect(report.requiredVerifiedCompanies).toBe(P0_MIN_VERIFIED_SCRAPABLE_COMPANIES);
    expect(report.crawlEvidencedVerifiedCompanies).toBeLessThan(50);
    expect(report.canLaunchP0).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_COMPANIES_BELOW_50"
    );
  });

  it("flags registry sources that are labelled verified but cannot be planned for crawl", () => {
    const report = getP0ReadinessReport();

    expect(report.declaredVerifiedSocialSources).toBeGreaterThan(
      report.configuredVerifiedSocialSources
    );
    expect(report.verifiedSourcesMissingCrawlPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "source-beigene-social",
          companyId: "company-beigene",
          companyName: "百济神州"
        })
      ])
    );
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN"
    );
  });

  it("allows a synthetic launch only when 50 companies have configured plans and stable observations", () => {
    const readyCompanies = Array.from({ length: 80 }, (_, index) => ({
      id: `company-ready-${index}`,
      officialChineseName: `测试药企${index}`,
      pinyinName: `ceshi-${index}`,
      officialWebsiteUrl: `https://company-${index}.example.com`,
      inclusionReason: "测试样本",
      sources: [
        {
          id: `source-ready-${index}-social`,
          companyId: `company-ready-${index}`,
          kind: "SOCIAL" as const,
          atsKind: "OFFICIAL_JSON" as const,
          status: index < 50 ? ("VERIFIED_SCRAPABLE" as const) : ("ENTRY_FOUND_PENDING_ADAPTER" as const),
          officialEntryUrl: `https://company-${index}.example.com/jobs`,
          officialChainEvidenceUrl: `https://company-${index}.example.com/careers`
        }
      ]
    }));
    const configuredSourceIds = new Set(
      readyCompanies.slice(0, 50).map((company) => company.sources[0]!.id)
    );
    const observationsBySource = Object.fromEntries(
      readyCompanies.slice(0, 50).map((company) => {
        const sourceId = company.sources[0]!.id;
        return [
          sourceId,
          [
            {
              id: `${sourceId}-crawl-1`,
              sourceId,
              crawledAt: new Date("2026-07-07T08:00:00Z"),
              successful: true,
              structuredJobCount: 3,
              stableRequiredFields: ["company", "title", "officialUrl", "location"] as const
            },
            {
              id: `${sourceId}-crawl-2`,
              sourceId,
              crawledAt: new Date("2026-07-07T20:00:00Z"),
              successful: true,
              structuredJobCount: 3,
              stableRequiredFields: ["company", "title", "officialUrl", "location"] as const
            }
          ]
        ];
      })
    );

    const report = getP0ReadinessReport({
      companies: readyCompanies,
      configuredSourceIds,
      observationsBySource
    });

    expect(report.crawlEvidencedVerifiedCompanies).toBe(50);
    expect(report.blockers).toEqual([]);
    expect(report.canLaunchP0).toBe(true);
  });
});
