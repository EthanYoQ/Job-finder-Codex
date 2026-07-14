import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { selectAndMapLatestSourceResults } from "../../scripts/p0-staged-data-quality";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";

type SourceResultRow = Parameters<typeof selectAndMapLatestSourceResults>[0][number];

const releaseCandidateId = "rc-current";
const sourceId = "source-a";
const currentBatchIdentity = {
  releaseCandidateId,
  commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64),
  sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64),
  batchKind: "SCHEDULED" as const,
  ownerId: "staged-scheduler",
  expectedPlannedSourceIds: [sourceId],
  expectedPlannedSourceSetSha256: "6".repeat(64),
  expectedPlannedSourceCount: 1
};
const key = "source-a:job-1";
const currentHash = canonicalStringSetSha256([key]);
const emptyHash = canonicalStringSetSha256([]);

function row(id: string, startedAt: string): SourceResultRow {
  const batchId = `batch-${id}`;
  return {
    id,
    releaseCandidateId,
    batchId,
    sourceId,
    sourceConfigHash: "a".repeat(64),
    transportState: "SUCCEEDED",
    adapterState: "SUCCEEDED",
    completenessState: "VERIFIED",
    atomicCommitState: "COMMITTED",
    failureCode: null,
    startedAt: new Date(startedAt),
    finishedAt: new Date(new Date(startedAt).getTime() + 30_000),
    dedupeOutputCount: 1,
    expectedJobCount: 1,
    canonicalOutputSetSha256: currentHash,
    canonicalCurrentJobSetSha256: currentHash,
    canonicalGraceJobSetSha256: emptyHash,
    canonicalVisibleJobSetSha256: currentHash,
    batch: {
      id: batchId,
      releaseCandidateId,
      kind: "SCHEDULED",
      status: "SUCCESS",
      startedAt: new Date(startedAt),
      commitSha: currentBatchIdentity.commitSha,
      rosterSha256: currentBatchIdentity.rosterSha256,
      sourcePlanSha256: currentBatchIdentity.sourcePlanSha256,
      sourceConfigSha256: currentBatchIdentity.sourceConfigSha256,
      adapterBundleSha256: currentBatchIdentity.adapterBundleSha256,
      plannedSourceIds: currentBatchIdentity.expectedPlannedSourceIds,
      plannedSourceSetSha256: currentBatchIdentity.expectedPlannedSourceSetSha256,
      plannedSourceCount: currentBatchIdentity.expectedPlannedSourceCount,
      ownerId: currentBatchIdentity.ownerId
    },
    observations: [{
      releaseCandidateId,
      batchId,
      sourceResultId: id,
      sourceId,
      sourceConfigSha256: "a".repeat(64),
      successful: true,
      transportSucceeded: true,
      adapterSucceeded: true,
      completenessVerified: true,
      atomicCommitSucceeded: true,
      structuredJobCount: 1,
      expectedJobCount: 1,
      completenessStatus: "VERIFIED",
      canonicalOutputSha256: currentHash,
      canonicalGraceSha256: emptyHash,
      canonicalVisibleSha256: currentHash
    }],
    lifecycleSetMembers: ["CURRENT", "VISIBLE"].map((setKind) => ({
      releaseCandidateId,
      batchId,
      sourceId,
      sourceResultId: id,
      setKind: setKind as "CURRENT" | "VISIBLE",
      jobKey: key,
      jobKeySha256: createHash("sha256").update(key, "utf8").digest("hex"),
      lifecycleStatus: "ACTIVE" as const,
      missingCount: 0
    }))
  };
}

describe("staged data-quality database mapping", () => {
  it("selects the latest completed result even when an older result succeeded", () => {
    const older = row("result-old", "2026-07-15T00:01:00.000Z");
    const latest = row("result-latest", "2026-07-16T00:01:00.000Z");
    latest.transportState = "FAILED";
    latest.atomicCommitState = "NOT_ATTEMPTED";

    const mapped = selectAndMapLatestSourceResults(
      [latest, older],
      currentBatchIdentity,
      new Set([sourceId])
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      sourceResultId: "result-latest",
      transportState: "FAILED",
      atomicCommitState: "NOT_ATTEMPTED"
    });
  });

  it("ignores a successful in-progress source but selects an in-progress terminal failure", () => {
    const completed = row("result-completed", "2026-07-15T00:01:00.000Z");
    const running = row("result-running", "2026-07-16T00:01:00.000Z");
    running.batch.status = "RUNNING";

    expect(selectAndMapLatestSourceResults(
      [completed, running],
      currentBatchIdentity,
      new Set([sourceId])
    )[0]?.sourceResultId).toBe("result-completed");

    running.transportState = "FAILED";
    running.adapterState = "SKIPPED";
    running.completenessState = "FAILED";
    running.atomicCommitState = "NOT_ATTEMPTED";
    expect(selectAndMapLatestSourceResults(
      [completed, running],
      currentBatchIdentity,
      new Set([sourceId])
    )[0]?.sourceResultId).toBe("result-running");
  });

  it("ignores a canonical SOURCE_NOT_DUE result but fails closed when that marker is malformed", () => {
    const completed = row("result-completed", "2026-07-15T00:01:00.000Z");
    const notDue = row("result-not-due", "2026-07-16T00:01:00.000Z");
    Object.assign(notDue, {
      transportState: "SKIPPED",
      adapterState: "SKIPPED",
      completenessState: "FAILED",
      atomicCommitState: "NOT_ATTEMPTED",
      failureCode: "SOURCE_NOT_DUE",
      dedupeOutputCount: 0,
      expectedJobCount: null,
      canonicalOutputSetSha256: null,
      canonicalCurrentJobSetSha256: null,
      canonicalGraceJobSetSha256: null,
      canonicalVisibleJobSetSha256: null,
      observations: [],
      lifecycleSetMembers: []
    });

    expect(selectAndMapLatestSourceResults(
      [completed, notDue],
      currentBatchIdentity,
      new Set([sourceId])
    )[0]?.sourceResultId).toBe("result-completed");

    notDue.transportState = "FAILED";
    expect(() => selectAndMapLatestSourceResults(
      [completed, notDue],
      currentBatchIdentity,
      new Set([sourceId])
    )).toThrow(/OBSERVATION_COUNT/);
  });

  it("fails closed when any parent batch identity field differs from current authority", () => {
    const drift = row("result-drift", "2026-07-15T00:01:00.000Z");
    (drift.batch as unknown as Record<string, unknown>).commitSha = "f".repeat(40);
    expect(() => selectAndMapLatestSourceResults(
      [drift],
      currentBatchIdentity,
      new Set([sourceId])
    )).toThrow(/BATCH_IDENTITY_DRIFT/);
  });

  it("fails closed on duplicate observations or forged lifecycle keys", () => {
    const duplicateObservation = row("result-duplicate", "2026-07-15T00:01:00.000Z");
    duplicateObservation.observations.push({ ...duplicateObservation.observations[0]! });
    expect(() => selectAndMapLatestSourceResults(
      [duplicateObservation],
      currentBatchIdentity,
      new Set([sourceId])
    )).toThrow(/OBSERVATION_COUNT/);

    const forgedLifecycle = row("result-forged", "2026-07-15T00:01:00.000Z");
    forgedLifecycle.lifecycleSetMembers[0]!.jobKeySha256 = "0".repeat(64);
    expect(() => selectAndMapLatestSourceResults(
      [forgedLifecycle],
      currentBatchIdentity,
      new Set([sourceId])
    )).toThrow(/LIFECYCLE_TUPLE_DRIFT/);
  });
});
