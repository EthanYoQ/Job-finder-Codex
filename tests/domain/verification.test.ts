import { describe, expect, it } from "vitest";
import "../../src/domain/company";
import type { Company, CrawlObservation, RecruitmentSource } from "../../src/domain/company";
import {
  canLaunchP0,
  countVerifiedCompanies,
  isVerifiedScrapable
} from "../../src/domain/verification";

const requiredFields = ["company", "title", "officialUrl", "location"] as const;

describe("company source domain", () => {
  it("represents a company with official social and campus source separation", () => {
    const socialSource: RecruitmentSource = {
      id: "source-hengrui-social",
      companyId: "company-hengrui",
      kind: "SOCIAL",
      atsKind: "MOKA",
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/careers",
      status: "VERIFIED_SCRAPABLE"
    };

    const company: Company = {
      id: "company-hengrui",
      officialChineseName: "江苏恒瑞医药股份有限公司",
      officialWebsiteUrl: "https://www.hengrui.com",
      pinyinName: "jiang su heng rui yi yao gu fen you xian gong si",
      inclusionReason: "国内头部药企、已实测",
      sources: [socialSource]
    };

    expect(company.sources[0]?.kind).toBe("SOCIAL");
    expect(company.sources[0]?.status).toBe("VERIFIED_SCRAPABLE");
  });
});

describe("verified scrapable gate", () => {
  const source: RecruitmentSource = {
    id: "source-astrazeneca-social",
    companyId: "company-astrazeneca",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
    officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers",
    status: "ENTRY_FOUND_PENDING_ADAPTER"
  };

  it("rejects sources that have only one successful crawl", () => {
    const observations: CrawlObservation[] = [
      {
        id: "crawl-1",
        sourceId: source.id,
        crawledAt: new Date("2026-07-07T08:00:00Z"),
        successful: true,
        structuredJobCount: 12,
        stableRequiredFields: [...requiredFields]
      }
    ];

    expect(isVerifiedScrapable(source, observations)).toBe(false);
  });

  it("accepts sources with official evidence and two successful stable crawls", () => {
    const observations: CrawlObservation[] = [
      {
        id: "crawl-1",
        sourceId: source.id,
        crawledAt: new Date("2026-07-07T08:00:00Z"),
        successful: true,
        structuredJobCount: 12,
        stableRequiredFields: [...requiredFields]
      },
      {
        id: "crawl-2",
        sourceId: source.id,
        crawledAt: new Date("2026-07-07T20:00:00Z"),
        successful: true,
        structuredJobCount: 12,
        stableRequiredFields: [...requiredFields]
      }
    ];

    expect(isVerifiedScrapable(source, observations)).toBe(true);
  });

  it("blocks P0 launch until at least 50 companies are verified scrapable", () => {
    const companies: Company[] = Array.from({ length: 49 }, (_, index) => ({
      id: `company-${index}`,
      officialChineseName: `测试药企${index}`,
      officialWebsiteUrl: `https://example-${index}.com`,
      pinyinName: `ce shi yao qi ${index}`,
      inclusionReason: "测试样本",
      sources: [
        {
          ...source,
          id: `source-${index}`,
          companyId: `company-${index}`
        }
      ]
    }));
    const observationsBySource = Object.fromEntries(
      companies.map((company) => {
        const sourceId = company.sources[0]!.id;
        return [
          sourceId,
          [
            {
              id: `${sourceId}-crawl-1`,
              sourceId,
              crawledAt: new Date("2026-07-07T08:00:00Z"),
              successful: true,
              structuredJobCount: 1,
              stableRequiredFields: [...requiredFields]
            },
            {
              id: `${sourceId}-crawl-2`,
              sourceId,
              crawledAt: new Date("2026-07-07T20:00:00Z"),
              successful: true,
              structuredJobCount: 1,
              stableRequiredFields: [...requiredFields]
            }
          ] satisfies CrawlObservation[]
        ];
      })
    );

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(49);
    expect(canLaunchP0(companies, observationsBySource)).toBe(false);
  });
});
