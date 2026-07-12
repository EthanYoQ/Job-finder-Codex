import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { getP0ReadinessReport } from "../../src/readiness/p0Readiness";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3";
import type { CandidateCompany, CandidateRecruitmentSource } from "../../src/data/companyRegistry";

const firstRosterMember = confirmedCompanyRosterV3Members[0]!;
const secondRosterMember = confirmedCompanyRosterV3Members[1]!;
const sourceFor = (id: string, companyId = firstRosterMember.id): CandidateRecruitmentSource => ({
  id, companyId, kind: "SOCIAL", atsKind: "OFFICIAL_JSON", status: "VERIFIED_SCRAPABLE",
  officialEntryUrl: `https://${id}.example.com/jobs`, officialChainEvidenceUrl: `https://${id}.example.com/careers`
});
function exactRosterWithSources(entries: Readonly<Record<string, CandidateRecruitmentSource[]>>): CandidateCompany[] {
  return confirmedCompanyRosterV3Members.map((member, index) => ({
    id: member.id, officialChineseName: `药企${index}`, officialWebsiteUrl: `https://company-${index}.example.com`,
    pinyinName: `company-${index}`, category: member.category,
    targetStatus: entries[member.id] ? "ACTIVE" : "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
    sources: [...(entries[member.id] ?? [])]
  }));
}

describe("P0 readiness report", () => {
  it("blocks an exact confirmed 30+30 caller roster whose no-link adjudications lack startup-v3 authority", () => {
    const report = getP0ReadinessReport({ companies: exactRosterWithSources({}) });

    expect(report.canLaunchP0).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toContain("NO_LINK_AUTHORITY_MISSING");
  });

  it("reports the exact roster and dynamic official-link denominator", () => {
    const report = getP0ReadinessReport();

    expect(report.totalCandidates).toBe(60);
    expect(report.foreignPharmaCompanies).toBe(30);
    expect(report.domesticPharmaCompanies).toBe(30);
    expect(report.requiredOfficialLinkSources).toBeGreaterThanOrEqual(report.plannedOfficialLinkSources);
    expect(report.crawlEvidencedOfficialLinkSources).toBeLessThanOrEqual(report.requiredOfficialLinkSources);
    expect(report).not.toHaveProperty("requiredVerifiedCompanies");
    expect(report.canLaunchP0).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).not.toContain("VERIFIED_COMPANIES_BELOW_60");
  });

  it("blocks every research-pending source from active planning", () => {
    const report = getP0ReadinessReport();

    expect(report.requiredOfficialLinkSources).toBe(60);
    expect(report.plannedOfficialLinkSources).toBe(0);
    expect(report.sourcePlanOmissions).toHaveLength(60);
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

    expect(report.crawlEvidencedOfficialLinkSources).toBe(0);
    expect(report.blockers.map((blocker) => blocker.code)).toContain("VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN");
    expect(report.canLaunchP0).toBe(false);
  });

  it("blocks an active company whose social source is not verified scrapable", () => {
    const companies = Array.from({ length: 60 }, (_, index) => ({
      id: `company-pending-${index}`,
      officialChineseName: `待验证药企${index}`,
      pinyinName: `pending-${index}`,
      officialWebsiteUrl: `https://pending-${index}.example.com`,
      category: index < 30 ? "FOREIGN_PHARMA" as const : "DOMESTIC_PHARMA" as const,
      targetStatus: "ACTIVE" as const,
      sources: [{
        id: `source-pending-${index}`,
        companyId: `company-pending-${index}`,
        kind: "SOCIAL" as const,
        atsKind: "OFFICIAL_JSON" as const,
        status: "ENTRY_FOUND_PENDING_ADAPTER" as const,
        officialEntryUrl: `https://pending-${index}.example.com/jobs`,
        officialChainEvidenceUrl: `https://pending-${index}.example.com/careers`
      }]
    }));

    const report = getP0ReadinessReport({ companies });
    expect(report.requiredOfficialLinkSources).toBe(60);
    expect(report.blockers.map((blocker) => blocker.code)).toContain("INVALID_COMPANY_OFFICIAL_LINK_STATUS");
    expect(report.canLaunchP0).toBe(false);
  });

  it("blocks a duplicate source ID within one company without double-counting the denominator", () => {
    const source = sourceFor("source-duplicate");
    const report = getP0ReadinessReport({ companies: exactRosterWithSources({ [firstRosterMember.id]: [source, { ...source }] }) });
    expect(report.requiredOfficialLinkSources).toBe(1);
    expect(report.blockers.map((blocker) => blocker.code)).toContain("INVALID_SOURCE_GRAPH");
    expect(report.canLaunchP0).toBe(false);
  });

  it("blocks a duplicate source ID across companies without reusing one evidence identity", () => {
    const report = getP0ReadinessReport({ companies: exactRosterWithSources({
      [firstRosterMember.id]: [sourceFor("source-cross-duplicate", firstRosterMember.id)],
      [secondRosterMember.id]: [sourceFor("source-cross-duplicate", secondRosterMember.id)]
    }) });
    expect(report.requiredOfficialLinkSources).toBe(1);
    expect(report.blockers.map((blocker) => blocker.code)).toContain("INVALID_SOURCE_GRAPH");
  });

  it("blocks a source reassociated to the wrong owning company", () => {
    const report = getP0ReadinessReport({ companies: exactRosterWithSources({
      [firstRosterMember.id]: [sourceFor("source-misowned", secondRosterMember.id)]
    }) });
    expect(report.blockers.map((blocker) => blocker.code)).toContain("INVALID_SOURCE_GRAPH");
    expect(report.canLaunchP0).toBe(false);
  });

  it("keeps distinct correctly owned multi-source companies valid at the source-graph layer", () => {
    const report = getP0ReadinessReport({ companies: exactRosterWithSources({
      [firstRosterMember.id]: [sourceFor("source-distinct-a"), sourceFor("source-distinct-b")]
    }) });
    expect(report.requiredOfficialLinkSources).toBe(2);
    expect(report.blockers.map((blocker) => blocker.code)).not.toContain("INVALID_SOURCE_GRAPH");
  });
});
