import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  promoteStagedReleaseCandidate,
  type IndependentReleaseQaEvidence,
  type ReleaseCandidatePromotionRow
} from "../../src/readiness/stagedReleasePromotion";

const NOW = new Date("2026-07-16T15:00:00.000Z");
const stableCompanyIds = Array.from({ length: 55 }, (_, index) => `company-${String(index + 1).padStart(2, "0")}`);

function candidate(overrides: Partial<ReleaseCandidatePromotionRow> = {}): ReleaseCandidatePromotionRow {
  return {
    id: "p0-rc-20260716-016",
    goalId: "job-finder-phase1-launch",
    version: 10,
    commitSha: "c".repeat(40),
    dbSnapshotHash: "0".repeat(64),
    schemaHash: "1".repeat(64),
    migrationVersion: "20260716210000_release_candidate_promotion_gate",
    rosterHash: "2".repeat(64),
    sourcePlanHash: "3".repeat(64),
    sourceConfigHash: "4".repeat(64),
    adapterBundleHash: "5".repeat(64),
    sourceTreeHash: "6".repeat(64),
    runtimeTreeHash: "7".repeat(64),
    oracleVersion: "staged-official-source-v1",
    minimumStableCompanyCount: 55,
    status: "READY_FOR_QA",
    releaseQaEvidenceSha256: null,
    finalizedAt: null,
    ...overrides
  };
}

function evidence(row = candidate(), overrides: Partial<IndependentReleaseQaEvidence> = {}): string {
  return JSON.stringify({
    schemaVersion: "p0-independent-release-qa-v1",
    decision: "PASS",
    releaseCandidateId: row.id,
    goalId: row.goalId,
    version: row.version,
    commitSha: row.commitSha,
    dbSnapshotHash: row.dbSnapshotHash,
    schemaHash: row.schemaHash,
    migrationVersion: row.migrationVersion,
    rosterHash: row.rosterHash,
    sourcePlanHash: row.sourcePlanHash,
    sourceConfigHash: row.sourceConfigHash,
    adapterBundleHash: row.adapterBundleHash,
    sourceTreeHash: row.sourceTreeHash,
    runtimeTreeHash: row.runtimeTreeHash,
    oracleVersion: row.oracleVersion,
    minimumStableCompanyCount: row.minimumStableCompanyCount,
    stableCompanyCount: stableCompanyIds.length,
    stableCompanyIds,
    reviewedAt: "2026-07-16T14:55:00.000Z",
    reviewerId: "independent-qa-agent-01",
    reviewMode: "INDEPENDENT_READ_ONLY_QA",
    readOnlyReview: true,
    implementationParticipated: false,
    ...overrides
  } satisfies IndependentReleaseQaEvidence);
}

function gate(stableIds = stableCompanyIds, canRelease = true) {
  return {
    canRelease,
    readiness: {
      canRelease,
      releaseCandidateStatus: "READY_FOR_QA",
      stableCompanyCount: stableIds.length,
      stableCompanyIds: stableIds,
      minimumStableCompanyCount: 55,
      issues: []
    },
    dataQuality: { canRelease, issues: [] }
  };
}

function deps(row = candidate(), report = gate(), updateCount = 1) {
  return {
    now: () => NOW,
    loadCandidate: vi.fn(async () => row),
    loadGateReport: vi.fn(async () => report),
    updateReleased: vi.fn(async () => updateCount)
  };
}

describe("staged release promotion", () => {
  it("promotes exactly one READY_FOR_QA candidate bound to fresh independent PASS evidence", async () => {
    const row = candidate();
    const qaEvidenceText = evidence(row);
    const d = deps(row);
    const result = await promoteStagedReleaseCandidate({
      releaseCandidateId: row.id,
      qaEvidenceText
    }, d);

    const sha256 = createHash("sha256").update(qaEvidenceText, "utf8").digest("hex");
    expect(result).toEqual({ releaseCandidateId: row.id, status: "RELEASED", releaseQaEvidenceSha256: sha256 });
    expect(d.updateReleased).toHaveBeenCalledWith(expect.objectContaining({
      releaseCandidate: row,
      releaseQaEvidenceSha256: sha256,
      finalizedAt: NOW
    }));
  });

  it("rejects 54 stable companies without updating", async () => {
    const row = candidate();
    const only54 = stableCompanyIds.slice(0, 54);
    const d = deps(row, gate(only54, false));
    await expect(promoteStagedReleaseCandidate({
      releaseCandidateId: row.id,
      qaEvidenceText: evidence(row, { stableCompanyIds: only54, stableCompanyCount: 54 })
    }, d)).rejects.toThrow("STAGED_RELEASE_QA_STABLE_COMPANY_SET_INVALID");
    expect(d.updateReleased).not.toHaveBeenCalled();
  });

  it("rejects candidate identity drift, non-independent evidence, and a non-ready status", async () => {
    const row = candidate();
    for (const [qaEvidenceText, current] of [
      [evidence(row, { sourcePlanHash: "f".repeat(64) }), row],
      [evidence(row, { implementationParticipated: true } as unknown as Partial<IndependentReleaseQaEvidence>), row],
      [evidence(row), candidate({ status: "BUILDING" })]
    ] as const) {
      const d = deps(current);
      await expect(promoteStagedReleaseCandidate({ releaseCandidateId: row.id, qaEvidenceText }, d))
        .rejects.toThrow();
      expect(d.updateReleased).not.toHaveBeenCalled();
    }
  });

  it("rejects non-string reviewer identity and review time values", async () => {
    const row = candidate();
    for (const override of [{ reviewerId: 123 }, { reviewedAt: 123 }]) {
      const d = deps(row);
      await expect(promoteStagedReleaseCandidate({
        releaseCandidateId: row.id,
        qaEvidenceText: evidence(row, override as unknown as Partial<IndependentReleaseQaEvidence>)
      }, d)).rejects.toThrow("STAGED_RELEASE_QA_INDEPENDENCE_INVALID");
      expect(d.updateReleased).not.toHaveBeenCalled();
    }
  });

  it("rejects stable-company drift and a conditional update that did not change exactly one row", async () => {
    const row = candidate();
    const drifted = [...stableCompanyIds.slice(0, 54), "company-other"];
    const driftDeps = deps(row, gate(drifted));
    await expect(promoteStagedReleaseCandidate({
      releaseCandidateId: row.id,
      qaEvidenceText: evidence(row)
    }, driftDeps)).rejects.toThrow("STAGED_RELEASE_QA_STABLE_COMPANY_DRIFT");

    const updateDeps = deps(row, gate(), 0);
    await expect(promoteStagedReleaseCandidate({
      releaseCandidateId: row.id,
      qaEvidenceText: evidence(row)
    }, updateDeps)).rejects.toThrow("STAGED_RELEASE_PROMOTION_UPDATE_COUNT:0");
  });
});
