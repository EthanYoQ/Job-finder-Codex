import { describe, expect, it, vi } from "vitest";
import {
  getP0ReadinessReportFromDb,
  type P0ReadinessPrismaDb
} from "../../src/readiness/prismaReadiness";
import type { PersistedReadinessCompanyRow } from "../../src/readiness/persistedReadiness";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { P0_MIN_VERIFIED_SCRAPABLE_COMPANIES } from "../../src/domain/verification";

describe("Prisma readiness report", () => {
  it("queries companies, sources, and latest crawl observations for the readiness gate", async () => {
    const rows = [
      {
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
                id: "obs-2",
                sourceId: "source-beigene-social",
                crawledAt: new Date("2026-07-08T20:00:00.000Z"),
                successful: true,
                structuredJobCount: 50,
                stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
                failureReason: null
              },
              {
                id: "obs-1",
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
      }
    ] satisfies PersistedReadinessCompanyRow[];
    const findMany = vi.fn(async () => rows);
    const db = { company: { findMany } } satisfies P0ReadinessPrismaDb;

    const report = await getP0ReadinessReportFromDb(db);

    expect(findMany).toHaveBeenCalledWith({
      include: {
        sources: {
          include: {
            crawlObservations: {
              orderBy: { crawledAt: "desc" },
              take: 2
            }
          }
        }
      },
      orderBy: { pinyinName: "asc" }
    });
    expect(report.totalCandidates).toBe(candidateCompanies.length);
    expect(report.declaredVerifiedSocialSources).toBe(P0_MIN_VERIFIED_SCRAPABLE_COMPANIES);
    expect(report.crawlEvidencedVerifiedCompanies).toBe(1);
    expect(report.canLaunchP0).toBe(false);
  });
});
