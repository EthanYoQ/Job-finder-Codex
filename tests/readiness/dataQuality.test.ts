import { describe, expect, it } from "vitest";
import { getP0DataQualityReport } from "../../src/readiness/dataQuality";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";

const successfulObservation = {
  successful: true,
  structuredJobCount: 283,
  expectedJobCount: 283,
  completenessStatus: "VERIFIED" as const,
  completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" as const,
  completenessEvidenceUrl: "https://careers.astrazeneca.com/search-jobs/china/7684/1/1",
  completenessBlockerReason: null,
  crawledAt: new Date("2026-07-08T08:00:00.000Z"),
  failureReason: null
};

describe("P0 data quality gate", () => {
  it("keeps legacy count-only diagnostics release-ineligible even when counts match", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-astrazeneca-social"],
      latestObservationsBySource: {
        "source-astrazeneca-social": successfulObservation
      },
      activeVisibleJobCountsBySource: {
        "source-astrazeneca-social": 283
      }
    });

    expect(report.canPass).toBe(false);
    expect(report).toMatchObject({mode:"LEGACY_DIAGNOSTIC",releaseEligible:false});
    expect(report.issues).toEqual([]);
  });

  it("passes strict set evidence with one legal first-miss grace job",()=>{
    const tuple={releaseCandidateId:"rc-1",batchId:"batch-1",sourceResultId:"result-1",sourceId:"source-1"};
    const currentKeys=["current"],visibleKeys=["current","grace"],grace={...tuple,key:"grace",status:"ACTIVE" as const,missingSuccessfulCrawlCount:1};
    const report=getP0DataQualityReport({mode:"STRICT_SET_EVIDENCE",plannedSourceIds:["source-1"],latestObservationsBySource:{"source-1":{...successfulObservation,...tuple,structuredJobCount:1,expectedJobCount:1}},activeVisibleJobCountsBySource:{"source-1":2},lifecycleSetEvidenceBySource:{"source-1":{...tuple,currentKeys,currentSha256:canonicalStringSetSha256(currentKeys),graceEntries:[grace],graceSha256:canonicalStringSetSha256(["grace"]),visibleKeys,visibleSha256:canonicalStringSetSha256(visibleKeys),lifecycleEntries:[{...tuple,key:"current",status:"ACTIVE",missingSuccessfulCrawlCount:0},grace]}}});
    expect(report).toMatchObject({canPass:true,releaseEligible:true,mode:"STRICT_SET_EVIDENCE",issues:[]});
  });

  it.each([
    ["old RC",{releaseCandidateId:"rc-old"},"OBSERVATION_TUPLE_MISMATCH"],
    ["wrong batch",{batchId:"batch-old"},"OBSERVATION_TUPLE_MISMATCH"],
    ["wrong result",{sourceResultId:"result-old"},"OBSERVATION_TUPLE_MISMATCH"],
    ["structured replacement",{structuredJobCount:2},"STRUCTURED_CURRENT_COUNT_MISMATCH"],
    ["visible contradiction",{},"VISIBLE_JOB_COUNT_MISMATCH"]
  ])("fails strict %s evidence",(_name,observationPatch,code)=>{
    const tuple={releaseCandidateId:"rc-1",batchId:"batch-1",sourceResultId:"result-1",sourceId:"source-1"};
    const currentKeys=["current"],visibleKeys=["current"];
    const report=getP0DataQualityReport({mode:"STRICT_SET_EVIDENCE",plannedSourceIds:["source-1"],latestObservationsBySource:{"source-1":{...successfulObservation,...tuple,structuredJobCount:1,expectedJobCount:1,...observationPatch}},activeVisibleJobCountsBySource:{"source-1":code==="VISIBLE_JOB_COUNT_MISMATCH"?2:1},lifecycleSetEvidenceBySource:{"source-1":{...tuple,currentKeys,currentSha256:canonicalStringSetSha256(currentKeys),graceEntries:[],graceSha256:canonicalStringSetSha256([]),visibleKeys,visibleSha256:canonicalStringSetSha256(visibleKeys),lifecycleEntries:[{...tuple,key:"current",status:"ACTIVE",missingSuccessfulCrawlCount:0}]}}});
    expect(report.issues).toContainEqual(expect.objectContaining({code}));expect(report.canPass).toBe(false);
  });

  it("fails when parsed jobs were folded before becoming visible", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-akeso-social"],
      latestObservationsBySource: {
        "source-akeso-social": {
          ...successfulObservation,
          structuredJobCount: 89,
          expectedJobCount: null,
          completenessStatus: "VERIFIED"
        }
      },
      activeVisibleJobCountsBySource: {
        "source-akeso-social": 5
      }
    });

    expect(report.canPass).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        sourceId: "source-akeso-social",
        code: "VISIBLE_JOB_COUNT_MISMATCH",
        message:
          "Latest successful observation has 89 structured jobs, but 5 active visible jobs are in the frontend.",
        observedCount: 89,
        activeVisibleCount: 5
      })
    ]);
  });

  it("fails when the latest observation is missing or failed", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-missing", "source-failed"],
      latestObservationsBySource: {
        "source-failed": {
          successful: false,
          structuredJobCount: 0,
          expectedJobCount: null,
          completenessStatus: "FAILED",
          completenessEvidenceKind: "FETCH_FAILURE" as const,
          completenessEvidenceUrl: null,
          completenessBlockerReason: "blocked",
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: "blocked"
        }
      },
      activeVisibleJobCountsBySource: {}
    });

    expect(report.canPass).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({ code: "MISSING_LATEST_OBSERVATION" }),
      expect.objectContaining({
        code: "LATEST_OBSERVATION_FAILED",
        evidenceKind: "FETCH_FAILURE"
      })
    ]);
  });

  it("fails when an unplanned source still has frontend-visible jobs", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-qilu-social"],
      latestObservationsBySource: {
        "source-qilu-social": {
          ...successfulObservation,
          structuredJobCount: 1,
          expectedJobCount: null,
          completenessStatus: "VERIFIED"
        }
      },
      activeVisibleJobCountsBySource: {
        "source-qilu-social": 1
      },
      unplannedActiveVisibleJobCountsBySource: {
        "source-salubris-social": 117
      }
    });

    expect(report.canPass).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        sourceId: "source-salubris-social",
        code: "UNPLANNED_VISIBLE_JOBS",
        message: "Unplanned source has 117 active visible jobs in the frontend.",
        activeVisibleCount: 117
      })
    ]);
  });

  it("fails when completeness status is missing or not verified", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-missing-completeness", "source-incomplete"],
      latestObservationsBySource: {
        "source-missing-completeness": {
          successful: true,
          structuredJobCount: 12,
          expectedJobCount: null,
          completenessStatus: null,
          completenessEvidenceUrl: null,
          completenessBlockerReason: null,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        },
        "source-incomplete": {
          successful: true,
          structuredJobCount: 1,
          expectedJobCount: 52,
          completenessStatus: "INCOMPLETE",
          completenessEvidenceUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China",
          completenessBlockerReason: "Fetched 1 of official JSON total 52",
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: {
        "source-missing-completeness": 12,
        "source-incomplete": 1
      }
    });

    expect(report.canPass).toBe(false);
    expect(report.issues).toEqual(
      expect.arrayContaining([
      expect.objectContaining({
        sourceId: "source-missing-completeness",
        code: "MISSING_COMPLETENESS_STATUS",
        observedCount: 12,
        expectedCount: null,
        completenessStatus: null
      }),
      expect.objectContaining({
        sourceId: "source-incomplete",
        code: "COMPLETENESS_NOT_VERIFIED",
        observedCount: 1,
        expectedCount: 52,
        completenessStatus: "INCOMPLETE",
        blockerReason: "Fetched 1 of official JSON total 52"
      })
      ])
    );
  });

  it("fails expected count mismatches against structured count before frontend counts", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-astrazeneca-social"],
      latestObservationsBySource: {
        "source-astrazeneca-social": {
          ...successfulObservation,
          structuredJobCount: 282,
          expectedJobCount: 283
        }
      },
      activeVisibleJobCountsBySource: {
        "source-astrazeneca-social": 282
      }
    });

    expect(report.canPass).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        sourceId: "source-astrazeneca-social",
        code: "EXPECTED_JOB_COUNT_MISMATCH",
        observedCount: 282,
        expectedCount: 283,
        evidenceKind: "OFFICIAL_TOTAL_COUNT"
      })
    ]);
  });

  it("passes the low-count gate with verified complete traversal and exact positive pages", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-sandoz-china-social"],
      highRiskLowCountSourceIds: ["source-sandoz-china-social"],
      latestObservationsBySource: {
        "source-sandoz-china-social": {
          successful: true,
          structuredJobCount: 2,
          expectedJobCount: null,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
          completenessEvidenceUrl: "https://www.sandoz.com/careers/job-search/",
          completenessBlockerReason: null,
          pagesVisited: 2,
          totalPages: 2,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: {
        "source-sandoz-china-social": 2
      }
    });

    expect(report.issues).toEqual([]);
  });

  it("passes the low-count gate with verified official total pages and exact positive pages", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-hotjob-social"],
      highRiskLowCountSourceIds: ["source-hotjob-social"],
      latestObservationsBySource: {
        "source-hotjob-social": {
          successful: true,
          structuredJobCount: 3,
          expectedJobCount: null,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "OFFICIAL_TOTAL_PAGES",
          completenessEvidenceUrl: "https://example.com/official-jobs",
          completenessBlockerReason: null,
          pagesVisited: 3,
          totalPages: 3,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: {
        "source-hotjob-social": 3
      }
    });

    expect(report.issues).toEqual([]);
  });

  it("passes the low-count gate with a verified exact official total and evidence URL", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-official-total"],
      highRiskLowCountSourceIds: ["source-official-total"],
      latestObservationsBySource: {
        "source-official-total": {
          successful: true,
          structuredJobCount: 3,
          expectedJobCount: 3,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: "https://example.com/official-total",
          completenessBlockerReason: null,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: { "source-official-total": 3 }
    });

    expect(report.issues).toEqual([]);
  });

  it("blocks high-risk low-count sources when the evidence kind is absent", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-missing-kind"],
      highRiskLowCountSourceIds: ["source-missing-kind"],
      latestObservationsBySource: {
        "source-missing-kind": {
          successful: true,
          structuredJobCount: 2,
          expectedJobCount: 2,
          completenessStatus: "VERIFIED",
          completenessEvidenceUrl: "https://example.com/jobs",
          completenessBlockerReason: null,
          pagesVisited: 2,
          totalPages: 2,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: { "source-missing-kind": 2 }
    });

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "HIGH_RISK_LOW_COUNT_WITHOUT_STRONG_COMPLETENESS_EVIDENCE",
        evidenceKind: null
      })
    );
  });

  it.each([
    ["missing URL", { completenessEvidenceUrl: null }],
    ["zero pages", { pagesVisited: 0 }],
    ["missing pages", { pagesVisited: null }],
    ["page-count mismatch", { pagesVisited: 1, totalPages: 2 }]
  ])("blocks low-count traversal with %s", (_name, evidencePatch) => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-sandoz-china-social"],
      highRiskLowCountSourceIds: ["source-sandoz-china-social"],
      latestObservationsBySource: {
        "source-sandoz-china-social": {
          successful: true,
          structuredJobCount: 2,
          expectedJobCount: 2,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
          completenessEvidenceUrl: "https://www.sandoz.com/careers/job-search/",
          completenessBlockerReason: null,
          pagesVisited: 2,
          totalPages: 2,
          ...evidencePatch,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: {
        "source-sandoz-china-social": 2
      }
    });

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        sourceId: "source-sandoz-china-social",
        code: "HIGH_RISK_LOW_COUNT_WITHOUT_STRONG_COMPLETENESS_EVIDENCE",
        observedCount: 2,
        expectedCount: 2,
        evidenceKind: "COMPLETE_PAGE_TRAVERSAL"
      })
    );
  });

  it("keeps weak manual samples blocked for high-risk low-count sources", () => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-cspc-social"],
      highRiskLowCountSourceIds: ["source-cspc-social"],
      latestObservationsBySource: {
        "source-cspc-social": {
          successful: true,
          structuredJobCount: 8,
          expectedJobCount: 8,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
          completenessEvidenceUrl: "https://www.cspc.cn/hr/index.html",
          completenessBlockerReason: null,
          pagesVisited: 1,
          totalPages: 1,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: { "source-cspc-social": 8 }
    });

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "HIGH_RISK_LOW_COUNT_WITHOUT_STRONG_COMPLETENESS_EVIDENCE",
        evidenceKind: "WEAK_MANUAL_SAMPLE"
      })
    );
  });

  it.each([
    ["missing expected count", { expectedJobCount: null }],
    ["non-equal expected count", { expectedJobCount: 4 }],
    ["missing evidence URL", { completenessEvidenceUrl: null }]
  ])("blocks low-count official totals with %s", (_name, evidencePatch) => {
    const report = getP0DataQualityReport({
      plannedSourceIds: ["source-official-total"],
      highRiskLowCountSourceIds: ["source-official-total"],
      latestObservationsBySource: {
        "source-official-total": {
          successful: true,
          structuredJobCount: 3,
          expectedJobCount: 3,
          completenessStatus: "VERIFIED",
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: "https://example.com/official-total",
          completenessBlockerReason: null,
          ...evidencePatch,
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          failureReason: null
        }
      },
      activeVisibleJobCountsBySource: { "source-official-total": 3 }
    });

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "HIGH_RISK_LOW_COUNT_WITHOUT_STRONG_COMPLETENESS_EVIDENCE",
        evidenceKind: "OFFICIAL_TOTAL_COUNT"
      })
    );
  });
});
