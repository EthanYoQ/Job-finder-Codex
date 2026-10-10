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
  inclusionReason: "FOREIGN_PHARMA",
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
          expectedJobCount: null,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
          completenessEvidenceUrl:
            "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs",
          completenessBlockerReason: null,
          totalPages: 1,
          pageSize: 50,
          pagesVisited: 1,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: null
        },
        {
          id: "obs-older",
          sourceId: "source-beigene-social",
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          successful: true,
          structuredJobCount: 50,
          expectedJobCount: null,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
          completenessEvidenceUrl:
            "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs",
          completenessBlockerReason: null,
          totalPages: 1,
          pageSize: 50,
          pagesVisited: 1,
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
        stableRequiredFields: ["company", "title", "officialUrl", "location"],
        completenessStatus: "VERIFIED",
        completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
        completenessEvidenceUrl:
          "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs",
        totalPages: 1,
        pageSize: 50,
        pagesVisited: 1
      }),
      expect.objectContaining({
        id: "obs-older",
        stableRequiredFields: ["company", "title", "officialUrl", "location"]
      })
    ]);
  });

  it("does not let persisted observations bypass active independently verified plans", () => {
    const report = getP0ReadinessReport(toP0ReadinessInput([persistedBeigene]));

    expect(report.crawlEvidencedOfficialLinkSources).toBe(0);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "CANDIDATE_POOL_OUT_OF_RANGE"
    );
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN"
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
                expectedJobCount: null,
                completenessStatus: "FAILED",
                completenessEvidenceKind: "FETCH_FAILURE",
                completenessEvidenceUrl:
                  "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs",
                completenessBlockerReason: "blocked",
                totalPages: null,
                pageSize: null,
                pagesVisited: null,
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

    expect(report.crawlEvidencedOfficialLinkSources).toBe(0);
  });

  it("does not let a handwritten partial audit legalize a zero-source no-link company", () => {
    const noSource = { ...persistedBeigene, sources: [] };
    expect(toP0ReadinessInput([noSource]).companies?.[0]?.targetStatus).toBe("BLOCKED_EVIDENCE_GAP");
    const forged = (toP0ReadinessInput as unknown as (...args: unknown[]) => ReturnType<typeof toP0ReadinessInput>)([noSource], [{
      companyId: noSource.id,
      category: "FOREIGN_PHARMA",
      status: "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"
    }]);
    expect(forged.companies?.[0]?.targetStatus).toBe("BLOCKED_EVIDENCE_GAP");
  });

  it("rejects unknown persisted categories instead of mapping them to foreign", () => {
    expect(() => toP0ReadinessInput([{ ...persistedBeigene, inclusionReason: "OTHER" }])).toThrow(/category/i);
  });
});
