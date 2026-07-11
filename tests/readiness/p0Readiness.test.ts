import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { P0_MIN_VERIFIED_SCRAPABLE_COMPANIES } from "../../src/domain/verification";
import { getP0ReadinessReport } from "../../src/readiness/p0Readiness";

describe("P0 readiness report", () => {
  it("keeps the current project blocked until all 60 crawl-evidenced companies are ready", () => {
    const report = getP0ReadinessReport();

    expect(report.totalCandidates).toBe(60);
    expect(report.requiredVerifiedCompanies).toBe(P0_MIN_VERIFIED_SCRAPABLE_COMPANIES);
    expect(report.crawlEvidencedVerifiedCompanies).toBeLessThan(60);
    expect(report.canLaunchP0).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_COMPANIES_BELOW_60"
    );
  });

  it("blocks every research-pending source from active planning", () => {
    const report = getP0ReadinessReport();

    expect(report.declaredVerifiedSocialSources).toBe(46);
    expect(report.configuredVerifiedSocialSources).toBe(0);
    expect(report.verifiedSourcesMissingCrawlPlan).toHaveLength(46);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN"
    );
  });

  it("does not let caller-supplied configured ids bypass the independent oracle", () => {
    const readyCompanies = Array.from({ length: 60 }, (_, index) => ({
      id: `company-ready-${index}`,
      officialChineseName: `测试药企${index}`,
      pinyinName: `ceshi-${index}`,
      officialWebsiteUrl: `https://company-${index}.example.com`,
      category: "FOREIGN_PHARMA" as const,
      targetStatus: "ACTIVE" as const,
      sources: [
        {
          id: `source-ready-${index}-social`,
          companyId: `company-ready-${index}`,
          kind: "SOCIAL" as const,
          atsKind: "OFFICIAL_JSON" as const,
          status: "VERIFIED_SCRAPABLE" as const,
          officialEntryUrl: `https://company-${index}.example.com/jobs`,
          officialChainEvidenceUrl: `https://company-${index}.example.com/careers`
        }
      ]
    }));
    const configuredSourceIds = new Set(
      readyCompanies.map((company) => company.sources[0]!.id)
    );
    const observationsBySource = Object.fromEntries(
      readyCompanies.map((company) => {
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
              completenessStatus: "VERIFIED" as const,
              completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
              completenessEvidenceUrl: `https://${sourceId}.example.com/jobs`,
              stableRequiredFields: ["company", "title", "officialUrl", "location"] as const
            },
            {
              id: `${sourceId}-crawl-2`,
              sourceId,
              crawledAt: new Date("2026-07-07T20:00:00Z"),
              successful: true,
              structuredJobCount: 3,
              completenessStatus: "VERIFIED" as const,
              completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
              completenessEvidenceUrl: `https://${sourceId}.example.com/jobs`,
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

    expect(report.crawlEvidencedVerifiedCompanies).toBe(0);
    expect(report.blockers.map((blocker) => blocker.code)).toContain("VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN");
    expect(report.canLaunchP0).toBe(false);
  });
});
