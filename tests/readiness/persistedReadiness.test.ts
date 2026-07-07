import { describe, expect, it } from "vitest";
import { getP0ReadinessReport } from "../../src/readiness/p0Readiness";
import {
  toP0ReadinessInput,
  type PersistedReadinessCompanyRow
} from "../../src/readiness/persistedReadiness";

const persistedBeigene: PersistedReadinessCompanyRow = {
  id: "company-beigene",
  officialChineseName: "百济神州",
  officialWebsiteUrl: "https://www.beonemedicines.com.cn/",
  pinyinName: "baiji-shenzhou",
  inclusionReason: "知名 Biotech、已实测",
  sources: [
    {
      id: "source-beigene-social",
      companyId: "company-beigene",
      kind: "SOCIAL",
      atsKind: "MOKA",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl:
        "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs",
      officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/",
      campusEntryUrl: null,
      crawlObservations: [
        {
          id: "obs-newest",
          sourceId: "source-beigene-social",
          crawledAt: new Date("2026-07-08T20:00:00.000Z"),
          successful: true,
          structuredJobCount: 50,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: null
        },
        {
          id: "obs-older",
          sourceId: "source-beigene-social",
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          successful: true,
          structuredJobCount: 50,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: null
        }
      ]
    }
  ]
};

describe("persisted readiness mapper", () => {
  it("maps persisted Prisma-style rows into the pure readiness gate input", () => {
    const input = toP0ReadinessInput([persistedBeigene]);

    expect(input.companies?.[0]).toMatchObject({
      id: "company-beigene",
      officialChineseName: "百济神州",
      officialWebsiteUrl: "https://www.beonemedicines.com.cn/"
    });
    expect(input.observationsBySource?.["source-beigene-social"]).toEqual([
      expect.objectContaining({
        id: "obs-newest",
        stableRequiredFields: ["company", "title", "officialUrl", "location"]
      }),
      expect.objectContaining({
        id: "obs-older",
        stableRequiredFields: ["company", "title", "officialUrl", "location"]
      })
    ]);
  });

  it("lets persisted stable observations count as crawl-evidenced readiness", () => {
    const report = getP0ReadinessReport(toP0ReadinessInput([persistedBeigene]));

    expect(report.crawlEvidencedVerifiedCompanies).toBe(1);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "CANDIDATE_POOL_OUT_OF_RANGE"
    );
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_COMPANIES_BELOW_50"
    );
  });

  it("does not count failed latest observations even when an older pair succeeded", () => {
    const rows: PersistedReadinessCompanyRow[] = [
      {
        ...persistedBeigene,
        sources: [
          {
            ...persistedBeigene.sources[0]!,
            crawlObservations: [
              {
                id: "obs-failed-latest",
                sourceId: "source-beigene-social",
                crawledAt: new Date("2026-07-09T08:00:00.000Z"),
                successful: false,
                structuredJobCount: 0,
                stableRequiredFields: [],
                failureReason: "blocked"
              },
              ...persistedBeigene.sources[0]!.crawlObservations
            ]
          }
        ]
      }
    ];

    const report = getP0ReadinessReport(toP0ReadinessInput(rows));

    expect(report.crawlEvidencedVerifiedCompanies).toBe(0);
  });
});
