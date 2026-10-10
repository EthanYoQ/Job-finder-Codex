import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import {
  buildInitialQualificationPauseEvidence,
  readInitialQualificationPauseEvidence,
  writeInitialQualificationPauseEvidence
} from "../../src/crawler/initialQualificationPauseEvidence";

const identity = Object.freeze({
  releaseCandidateId: "rc-qualification-pause",
  commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64),
  sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64),
  batchKind: "SCHEDULED" as const,
  ownerId: "staged-scheduler",
  expectedPlannedSourceIds: ["source-a", "source-b"],
  expectedPlannedSourceSetSha256: hashCanonicalStringSet(["source-a", "source-b"]),
  expectedPlannedSourceCount: 2
});

const expectedIdentity = Object.freeze({
  releaseCandidateId: identity.releaseCandidateId,
  batchKind: identity.batchKind,
  commitSha: identity.commitSha,
  rosterSha256: identity.rosterSha256,
  sourcePlanSha256: identity.sourcePlanSha256,
  sourceConfigSha256: identity.sourceConfigSha256,
  adapterBundleSha256: identity.adapterBundleSha256,
  plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
  plannedSourceCount: identity.expectedPlannedSourceCount
});

function evidence(recordedAt = new Date("2026-07-15T00:05:00.000Z")) {
  return buildInitialQualificationPauseEvidence({
    attemptId: "attempt-pause",
    identity,
    batchId: "batch-second-round",
    canonicalSummarySha256: "7".repeat(64),
    completedRoundCount: 2,
    stableCompanyCount: 44,
    minimumStableCompanyCount: 45,
    recordedAt
  });
}

describe("initial qualification pause evidence", () => {
  it("persists strict machine-readable pause truth bound to RC, batch, and exact counts", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-qualification-pause-"));
    const path = resolve(root, "pause.json");
    const marker = evidence();

    await writeInitialQualificationPauseEvidence(path, marker);

    await expect(readInitialQualificationPauseEvidence(path, { expectedIdentity })).resolves.toEqual({
      state: "VALID",
      evidence: marker
    });
    expect(marker).toMatchObject({
      state: "PAUSED_BELOW_MINIMUM",
      reasonCode: "INITIAL_QUALIFICATION_BELOW_MINIMUM_AFTER_TWO_COMPLETED_ROUNDS",
      releaseCandidateId: "rc-qualification-pause",
      batchId: "batch-second-round",
      canonicalSummarySha256: "7".repeat(64),
      stableCompanyCount: 44,
      minimumStableCompanyCount: 45,
      completedRoundCount: 2
    });
    expect(marker.notificationKey).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("derives a deterministic notification key and fails closed on identity/count tampering", async () => {
    expect(evidence(new Date("2026-07-15T00:06:00.000Z")).notificationKey).toBe(evidence().notificationKey);

    const root = mkdtempSync(resolve(tmpdir(), "job-finder-qualification-pause-tamper-"));
    const path = resolve(root, "pause.json");
    const marker = evidence();
    writeFileSync(path, JSON.stringify({ ...marker, stableCompanyCount: 45 }), "utf8");
    await expect(readInitialQualificationPauseEvidence(path, { expectedIdentity })).resolves.toEqual({ state: "INVALID" });

    writeFileSync(path, JSON.stringify(marker), "utf8");
    await expect(readInitialQualificationPauseEvidence(path, {
      expectedIdentity: { ...expectedIdentity, releaseCandidateId: "rc-other" }
    })).resolves.toEqual({ state: "INVALID" });
  });
});
