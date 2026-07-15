import { describe, expect, it, vi } from "vitest";
import { hashCanonicalStringSet, type RuntimeBatchIdentity } from "../../src/crawler/runtimeBatchIdentity";
import {
  finalizeStagedInitialQualification,
  formatInitialQualificationPauseNotification
} from "../../src/crawler/stagedCrawlCli";

const IDENTITY: RuntimeBatchIdentity = {
  releaseCandidateId: "rc-qualification",
  commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64),
  sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64),
  batchKind: "SCHEDULED",
  ownerId: "staged-scheduler",
  expectedPlannedSourceIds: ["source-a"],
  expectedPlannedSourceSetSha256: hashCanonicalStringSet(["source-a"]),
  expectedPlannedSourceCount: 1
};

function deps(input: {
  status?: string;
  completedRoundCount?: number;
  stableCompanyCount?: number;
  canRelease?: boolean;
  transitionCount?: number;
} = {}) {
  return {
    loadReleaseCandidateStatus: vi.fn(async () => input.status ?? "BUILDING"),
    countCompletedQualificationRounds: vi.fn(async () => input.completedRoundCount ?? 2),
    loadProspectiveReadiness: vi.fn(async () => ({
      canRelease: input.canRelease ?? (input.stableCompanyCount ?? 44) >= 45,
      stableCompanyCount: input.stableCompanyCount ?? 44,
      minimumStableCompanyCount: 45,
      issues: []
    })),
    transitionReleaseCandidate: vi.fn(async () => input.transitionCount ?? 1)
  };
}

describe("staged initial qualification finalization", () => {
  it("invalidates and returns one explicit pause decision after a second completed round below 45", async () => {
    const fixture = deps({ stableCompanyCount: 44 });

    const decision = await finalizeStagedInitialQualification(IDENTITY, fixture);

    expect(decision).toEqual({
      state: "PAUSED_BELOW_MINIMUM",
      completedRoundCount: 2,
      stableCompanyCount: 44,
      minimumStableCompanyCount: 45
    });
    if (decision.state !== "PAUSED_BELOW_MINIMUM") throw new Error("Expected pause decision");
    expect(fixture.transitionReleaseCandidate).toHaveBeenCalledOnce();
    expect(fixture.transitionReleaseCandidate).toHaveBeenCalledWith(IDENTITY, "BUILDING", "INVALIDATED");
    expect(formatInitialQualificationPauseNotification(decision)).toContain("PAUSED_BELOW_MINIMUM");
    expect(formatInitialQualificationPauseNotification(decision)).toContain("44/45");
  });

  it("advances only to READY_FOR_QA after the second completed round reaches 45", async () => {
    const fixture = deps({ stableCompanyCount: 45, canRelease: true });

    await expect(finalizeStagedInitialQualification(IDENTITY, fixture)).resolves.toEqual({
      state: "READY_FOR_QA",
      completedRoundCount: 2,
      stableCompanyCount: 45,
      minimumStableCompanyCount: 45
    });
    expect(fixture.transitionReleaseCandidate).toHaveBeenCalledWith(IDENTITY, "BUILDING", "READY_FOR_QA");
    expect(fixture.transitionReleaseCandidate).not.toHaveBeenCalledWith(IDENTITY, "BUILDING", "RELEASED");
  });

  it("continues after only one genuinely completed round without reading readiness or changing status", async () => {
    const fixture = deps({ completedRoundCount: 1 });

    await expect(finalizeStagedInitialQualification(IDENTITY, fixture)).resolves.toEqual({
      state: "CONTINUE_INITIAL_QUALIFICATION",
      completedRoundCount: 1,
      stableCompanyCount: null,
      minimumStableCompanyCount: 45
    });
    expect(fixture.loadProspectiveReadiness).not.toHaveBeenCalled();
    expect(fixture.transitionReleaseCandidate).not.toHaveBeenCalled();
  });

  it("waits for independent QA after READY_FOR_QA without self-releasing", async () => {
    const fixture = deps({ status: "READY_FOR_QA", completedRoundCount: 99, stableCompanyCount: 1 });

    await expect(finalizeStagedInitialQualification(IDENTITY, fixture)).resolves.toEqual({
      state: "AWAITING_QA",
      completedRoundCount: null,
      stableCompanyCount: null,
      minimumStableCompanyCount: 45
    });
    expect(fixture.countCompletedQualificationRounds).not.toHaveBeenCalled();
    expect(fixture.loadProspectiveReadiness).not.toHaveBeenCalled();
    expect(fixture.transitionReleaseCandidate).not.toHaveBeenCalled();
  });

  it("does not reapply the 45-company gate after RELEASED", async () => {
    const fixture = deps({ status: "RELEASED", completedRoundCount: 99, stableCompanyCount: 1 });

    await expect(finalizeStagedInitialQualification(IDENTITY, fixture)).resolves.toEqual({
      state: "PER_COMPANY_PUBLICATION",
      completedRoundCount: null,
      stableCompanyCount: null,
      minimumStableCompanyCount: 45
    });
    expect(fixture.countCompletedQualificationRounds).not.toHaveBeenCalled();
    expect(fixture.loadProspectiveReadiness).not.toHaveBeenCalled();
    expect(fixture.transitionReleaseCandidate).not.toHaveBeenCalled();
  });

  it("fails closed instead of claiming a transition when the conditional identity-bound update loses", async () => {
    const fixture = deps({ stableCompanyCount: 44, transitionCount: 0 });
    await expect(finalizeStagedInitialQualification(IDENTITY, fixture))
      .rejects.toThrow(/transition.*exactly one/i);
  });

  it("rejects a third completed BUILDING round", async () => {
    const fixture = deps({ completedRoundCount: 3 });
    await expect(finalizeStagedInitialQualification(IDENTITY, fixture))
      .rejects.toThrow(/ROUND_LIMIT/i);
    expect(fixture.transitionReleaseCandidate).not.toHaveBeenCalled();
  });
});
