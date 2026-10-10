import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrawlAttemptEvent, writeCrawlAttemptEvent } from "../../src/crawler/crawlAttemptEvidence";
import { buildTerminalCrawlSummary, type CrawlEvidenceIdentity } from "../../src/crawler/crawlSummary";
import {
  buildInitialQualificationPauseEvidence,
  writeInitialQualificationPauseEvidence
} from "../../src/crawler/initialQualificationPauseEvidence";
import { readInitialQualificationPauseBundle } from "../../src/crawler/initialQualificationPauseBundle";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

const runtimeIdentity = Object.freeze({
  releaseCandidateId: "rc-paused",
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
const evidenceIdentity: CrawlEvidenceIdentity = Object.freeze({
  releaseCandidateId: runtimeIdentity.releaseCandidateId,
  batchKind: runtimeIdentity.batchKind,
  commitSha: runtimeIdentity.commitSha,
  rosterSha256: runtimeIdentity.rosterSha256,
  sourcePlanSha256: runtimeIdentity.sourcePlanSha256,
  sourceConfigSha256: runtimeIdentity.sourceConfigSha256,
  adapterBundleSha256: runtimeIdentity.adapterBundleSha256,
  plannedSourceSetSha256: runtimeIdentity.expectedPlannedSourceSetSha256,
  plannedSourceCount: runtimeIdentity.expectedPlannedSourceCount
});

async function fixture(overrides: {
  markerAttemptId?: string;
  attemptId?: string;
  attemptNotificationKey?: string;
  attemptStableCount?: number;
} = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "job-finder-pause-bundle-"));
  roots.push(root);
  const pausePath = resolve(root, "pause.json");
  const summaryPath = resolve(root, "summary.json");
  const attemptDir = resolve(root, "attempts");
  const batch = {
    status: "SUCCESS" as const,
    batchId: "batch-two",
    plannedSourceCount: 2, dueSourceCount: 2,
    transportSuccessfulSourceCount: 2, transportFailedSourceCount: 0,
    adapterSuccessfulSourceCount: 2, adapterFailedSourceCount: 0,
    completenessVerifiedSourceCount: 2, completenessIncompleteSourceCount: 0,
    atomicCommittedSourceCount: 2, atomicFailedSourceCount: 0,
    successfulSourceCount: 2, failedSourceCount: 0, blockedSourceCount: 0, skippedSourceCount: 0
  };
  const summary = buildTerminalCrawlSummary({
    identity: runtimeIdentity,
    batch,
    capturedAt: new Date("2026-07-15T00:01:00.000Z"),
    finishedAt: new Date("2026-07-15T00:05:00.000Z"),
    consecutiveFailuresByCompany: {}
  });
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  const summarySha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  writeFileSync(summaryPath, serialized, "utf8");
  const evidence = buildInitialQualificationPauseEvidence({
    attemptId: overrides.markerAttemptId ?? "attempt-two",
    identity: runtimeIdentity,
    batchId: batch.batchId,
    canonicalSummarySha256: summarySha256,
    completedRoundCount: 2,
    stableCompanyCount: 44,
    minimumStableCompanyCount: 45,
    recordedAt: new Date("2026-07-15T00:05:00.000Z")
  });
  await writeInitialQualificationPauseEvidence(pausePath, evidence);
  const attemptId = overrides.attemptId ?? "attempt-two";
  const startedAt = new Date("2026-07-15T00:01:00.000Z");
  await writeCrawlAttemptEvent(attemptDir, buildCrawlAttemptEvent({
    attemptId, state: "RUNNING", startedAt, finishedAt: null, identity: null,
    authority: { advisoryLockAcquired: false, fileLockAcquired: false },
    canonicalSummaryBinding: null, failureCode: null
  }));
  await writeCrawlAttemptEvent(attemptDir, buildCrawlAttemptEvent({
    attemptId, state: "PAUSED", startedAt, finishedAt: new Date("2026-07-15T00:05:00.000Z"),
    identity: evidenceIdentity,
    authority: { advisoryLockAcquired: true, fileLockAcquired: true },
    canonicalSummaryBinding: { batchId: batch.batchId, summarySha256 }, failureCode: null,
    initialQualificationPause: {
      reasonCode: evidence.reasonCode,
      notificationKey: overrides.attemptNotificationKey ?? evidence.notificationKey,
      completedRoundCount: 2,
      stableCompanyCount: overrides.attemptStableCount ?? evidence.stableCompanyCount,
      minimumStableCompanyCount: evidence.minimumStableCompanyCount
    }
  }));
  return { root, pausePath, summaryPath, attemptDir, evidence, summaryPathValue: serialized };
}

function read(input: Awaited<ReturnType<typeof fixture>>, options: {
  activeIdentity?: CrawlEvidenceIdentity;
  candidateStatus?: string;
} = {}) {
  return readInitialQualificationPauseBundle({
    pausePath: input.pausePath,
    summaryPath: input.summaryPath,
    attemptDir: input.attemptDir,
    now: new Date("2026-07-15T00:06:00.000Z"),
    ...(options.activeIdentity ? { activeIdentity: options.activeIdentity } : {}),
    loadCandidateStatus: vi.fn(async () => options.candidateStatus ?? "INVALIDATED")
  });
}

describe("initial qualification pause evidence bundle", () => {
  it("accepts only a full marker-summary-PAUSED-attempt bundle for the INVALIDATED candidate", async () => {
    const input = await fixture();
    await expect(read(input)).resolves.toMatchObject({ state: "PAUSED", evidence: input.evidence });
  });

  it("rejects summary hash, attempt id, count, and notification-key drift", async () => {
    const summaryDrift = await fixture();
    writeFileSync(summaryDrift.summaryPath, `${summaryDrift.summaryPathValue} `, "utf8");
    await expect(read(summaryDrift)).resolves.toEqual({ state: "INVALID" });

    await expect(read(await fixture({ markerAttemptId: "attempt-marker", attemptId: "attempt-other" })))
      .resolves.toEqual({ state: "INVALID" });
    await expect(read(await fixture({ attemptStableCount: 43 }))).resolves.toEqual({ state: "INVALID" });
    await expect(read(await fixture({ attemptNotificationKey: "9".repeat(64) })))
      .resolves.toEqual({ state: "INVALID" });
  });

  it("does not let a valid old-RC marker pause a new active candidate, but rejects a damaged marker", async () => {
    const input = await fixture();
    const activeIdentity = { ...evidenceIdentity, releaseCandidateId: "rc-new" };
    rmSync(input.summaryPath);
    rmSync(input.attemptDir, { recursive: true, force: true });
    await expect(read(input, { activeIdentity })).resolves.toEqual({ state: "STALE_FOR_ACTIVE_IDENTITY" });

    writeFileSync(input.pausePath, "{bad", "utf8");
    await expect(read(input, { activeIdentity })).resolves.toEqual({ state: "INVALID" });
  });

  it("lets a current active RELEASED identity override a fully valid old pause, and requires INVALIDATED without active authority", async () => {
    const input = await fixture();
    await expect(read(input, { activeIdentity: evidenceIdentity }))
      .resolves.toEqual({ state: "STALE_FOR_ACTIVE_IDENTITY" });
    await expect(read(input, { candidateStatus: "RELEASED" })).resolves.toEqual({ state: "INVALID" });
  });
});
