import { describe, expect, it, vi } from "vitest";
import { runStagedReadinessCommand } from "../../scripts/p0-staged-readiness";
import type { StagedReleaseReadinessReport } from "../../src/readiness/stagedReleaseReadiness";

function report(canRelease: boolean): StagedReleaseReadinessReport {
  return {
    mode: "PHASE1",
    canRelease,
    rosterCompanyCount: 60,
    foreignCompanyCount: 30,
    domesticCompanyCount: 30,
    authorizedExclusionCount: 2,
    stableCompanyIds: Array.from({ length: canRelease ? 45 : 44 }, (_, index) => `company-${index}`),
    stableCompanyCount: canRelease ? 45 : 44,
    minimumStableCompanyCount: 45,
    freshnessMaximumMs: 30 * 60 * 60 * 1_000,
    releaseCandidateStatus: "READY_FOR_QA",
    issues: canRelease ? [] : [{
      code: "MINIMUM_STABLE_COMPANIES_NOT_MET",
      message: "Only 44 companies are currently stable; 45 are required."
    }]
  };
}

describe("staged readiness CLI", () => {
  it("requires the fixed phase1 mode and rejects preview or threshold overrides", async () => {
    for (const args of [[], ["--mode"], ["--mode", "unknown"], ["--mode", "public-beta"],
      ["--mode", "phase1", "--minimum", "1"]]) {
      const loadReport = vi.fn();
      const lines: string[] = [];
      await expect(runStagedReadinessCommand(args, { loadReport, writeLine: (line) => lines.push(line) }))
        .resolves.toEqual({ exitCode: 2 });
      expect(loadReport).not.toHaveBeenCalled();
      expect(lines[0]).toMatch(/Usage:/);
    }
  });

  it("maps only --mode phase1 without exposing a threshold override", async () => {
    const loadReport = vi.fn(async () => report(true));
    const lines: string[] = [];
    const result = await runStagedReadinessCommand(["--mode", "phase1"], {
      loadReport,
      writeLine: (line) => lines.push(line)
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(loadReport).toHaveBeenCalledWith("PHASE1");
    expect(lines).toContain("Staged release readiness: PASS");
  });

  it("returns one and reports record-derived gaps when a hard gate fails", async () => {
    const lines: string[] = [];
    const result = await runStagedReadinessCommand(["--mode", "phase1"], {
      loadReport: async () => report(false),
      writeLine: (line) => lines.push(line)
    });
    expect(result).toEqual({ exitCode: 1 });
    expect(lines).toContain("Stable companies: 44 / 45");
    expect(lines).toContain("[FAIL] MINIMUM_STABLE_COMPANIES_NOT_MET: Only 44 companies are currently stable; 45 are required.");
    expect(lines.at(-1)).toBe("Staged release readiness: FAIL");
  });
});
