import { describe, expect, it, vi } from "vitest";
import { runStagedDataQualityCommand } from "../../scripts/p0-staged-data-quality";
import type { StagedDataQualityReport } from "../../src/readiness/stagedDataQuality";
import type { StagedReleaseReadinessReport } from "../../src/readiness/stagedReleaseReadiness";

function dataQuality(canRelease: boolean): StagedDataQualityReport {
  return {
    canRelease,
    eligibleSourceCount: 51,
    publicVisibleJobCount: 1_234,
    issues: canRelease ? [] : [{
      code: "PUBLIC_JOB_SET_MISMATCH",
      sourceId: "source-a",
      message: "Database public jobs do not match the committed visible lifecycle set."
    }]
  };
}

function readiness(canRelease: boolean): StagedReleaseReadinessReport {
  return {
    mode: "PHASE1",
    releaseCandidateStatus: "READY_FOR_QA",
    canRelease,
    rosterCompanyCount: 60,
    foreignCompanyCount: 30,
    domesticCompanyCount: 30,
    authorizedExclusionCount: 2,
    stableCompanyIds: Array.from({ length: canRelease ? 45 : 44 }, (_, index) => `company-${index}`),
    stableCompanyCount: canRelease ? 45 : 44,
    minimumStableCompanyCount: 45,
    freshnessMaximumMs: 30 * 60 * 60 * 1_000,
    issues: canRelease ? [] : [{
      code: "MINIMUM_STABLE_COMPANIES_NOT_MET",
      message: "Only 44 companies are currently stable; 45 are required."
    }]
  };
}

function report(canRelease: boolean) {
  return {
    canRelease,
    readiness: readiness(canRelease),
    dataQuality: dataQuality(canRelease)
  };
}

describe("staged data-quality CLI", () => {
  it("accepts no caller-controlled company, source, or threshold arguments", async () => {
    for (const args of [["--source", "source-a"], ["--minimum", "1"], ["--db"]]) {
      const loadReport = vi.fn();
      const lines: string[] = [];
      await expect(runStagedDataQualityCommand(args, { loadReport, writeLine: (line) => lines.push(line) }))
        .resolves.toEqual({ exitCode: 2 });
      expect(loadReport).not.toHaveBeenCalled();
      expect(lines).toEqual(["Usage: npm run p0:staged-data-quality"]);
    }
  });

  it("loads the current database-derived publication set and passes exact data", async () => {
    const loadReport = vi.fn(async () => report(true));
    const lines: string[] = [];
    const result = await runStagedDataQualityCommand([], {
      loadReport,
      writeLine: (line) => lines.push(line)
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(loadReport).toHaveBeenCalledOnce();
    expect(lines).toEqual([
      "Stable companies: 45 / 45",
      "Eligible sources: 51",
      "Public visible jobs: 1234",
      "Staged data quality: PASS"
    ]);
  });

  it("fails closed and reports record-derived source gaps", async () => {
    const lines: string[] = [];
    const result = await runStagedDataQualityCommand([], {
      loadReport: async () => report(false),
      writeLine: (line) => lines.push(line)
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(lines).toContain(
      "[FAIL] PUBLIC_JOB_SET_MISMATCH (source-a): Database public jobs do not match the committed visible lifecycle set."
    );
    expect(lines).toContain(
      "[FAIL] MINIMUM_STABLE_COMPANIES_NOT_MET: Only 44 companies are currently stable; 45 are required."
    );
    expect(lines.at(-1)).toBe("Staged data quality: FAIL");
  });
});
