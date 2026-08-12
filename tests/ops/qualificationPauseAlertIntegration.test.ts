// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrawlAttemptEvent, writeCrawlAttemptEvent } from "../../src/crawler/crawlAttemptEvidence";
import { readInitialQualificationPauseBundle } from "../../src/crawler/initialQualificationPauseBundle";
import {
  buildTerminalCrawlSummary,
  readCrawlSummaryFile,
  writeCrawlSummaryAtomic
} from "../../src/crawler/crawlSummary";
import {
  buildInitialQualificationPauseEvidence,
  writeInitialQualificationPauseEvidence
} from "../../src/crawler/initialQualificationPauseEvidence";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import {
  runStagedCrawlOperation,
  type StagedCrawlRuntime
} from "../../src/crawler/stagedCrawlCli";
import { deliverOpsAlerts } from "../../src/server/alertDelivery";
import {
  acknowledgeDeliveredOneShotAlerts,
  filterAcknowledgedOneShotAlerts
} from "../../src/server/oneShotAlertDelivery";
import { evaluateOpsAlerts } from "../../src/server/opsMonitoring";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("qualification pause operations alert integration", () => {
  it("recovers a failed second-round pause bundle and exposes its one-shot alert after restart", async () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), "job-finder-failed-pause-"));
    const stateDir = mkdtempSync(resolve(tmpdir(), "job-finder-failed-pause-state-"));
    const attemptDir = resolve(outputRoot, "attempts");
    const summaryPath = resolve(outputRoot, "summary.json");
    const pausePath = resolve(outputRoot, "pause.json");
    cleanupPaths.push(outputRoot, stateDir);

    const plannedSourceIds = ["source-a", "source-b"];
    const identity = {
      releaseCandidateId: "rc-failed-pause-integration",
      commitSha: "1".repeat(40),
      rosterSha256: "2".repeat(64),
      sourcePlanSha256: "3".repeat(64),
      sourceConfigSha256: "4".repeat(64),
      adapterBundleSha256: "5".repeat(64),
      batchKind: "SCHEDULED" as const,
      ownerId: "staged-scheduler",
      expectedPlannedSourceIds: plannedSourceIds,
      expectedPlannedSourceSetSha256: hashCanonicalStringSet(plannedSourceIds),
      expectedPlannedSourceCount: plannedSourceIds.length
    };
    const evidenceIdentity = {
      releaseCandidateId: identity.releaseCandidateId,
      batchKind: identity.batchKind,
      commitSha: identity.commitSha,
      rosterSha256: identity.rosterSha256,
      sourcePlanSha256: identity.sourcePlanSha256,
      sourceConfigSha256: identity.sourceConfigSha256,
      adapterBundleSha256: identity.adapterBundleSha256,
      plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
      plannedSourceCount: identity.expectedPlannedSourceCount
    };
    const batch = {
      status: "FAILED" as const,
      batchId: "batch-failed-second-round",
      plannedSourceCount: 2,
      dueSourceCount: 2,
      transportSuccessfulSourceCount: 1,
      transportFailedSourceCount: 1,
      adapterSuccessfulSourceCount: 1,
      adapterFailedSourceCount: 0,
      completenessVerifiedSourceCount: 1,
      completenessIncompleteSourceCount: 0,
      atomicCommittedSourceCount: 1,
      atomicFailedSourceCount: 1,
      successfulSourceCount: 1,
      failedSourceCount: 1,
      blockedSourceCount: 0,
      skippedSourceCount: 0
    };
    const startedAt = new Date("2026-07-15T00:01:00.000Z");
    const finishedAt = new Date("2026-07-15T00:05:00.000Z");
    const now = new Date("2026-07-15T00:06:00.000Z");
    const runtime: StagedCrawlRuntime = {
      run: vi.fn(async () => ({
        syncedCompanyCount: 60,
        syncedSourceCount: 2,
        hiddenUnplannedVisibleJobCount: 0,
        batch,
        identity
      })),
      loadConsecutiveFailuresByCompany: vi.fn(async () => ({ "company-a": 2 })),
      finalizeInitialQualification: vi.fn(async () => ({
        state: "PAUSED_BELOW_MINIMUM" as const,
        completedRoundCount: 2 as const,
        stableCompanyCount: 44,
        minimumStableCompanyCount: 45
      })),
      disconnect: vi.fn(async () => undefined)
    };
    const notify = vi.fn();

    const operation = await runStagedCrawlOperation({
      attemptId: "attempt-failed-second-round",
      startedAt,
      capturedAt: startedAt,
      attemptDir,
      summaryPath,
      initialQualificationPausePath: pausePath,
      schedulerOwnsAttempt: false,
      deps: {
        acquireAdvisoryLock: async () => ({ release: async () => undefined }),
        acquireFileLock: async () => ({ close: async () => undefined }),
        unlinkFileLock: async () => undefined,
        assertBrowserReady: async () => undefined,
        createRuntime: async () => runtime,
        writeAttemptEvent: writeCrawlAttemptEvent,
        writeSummary: (path, summary) => writeCrawlSummaryAtomic(path, summary, {
          mkdir,
          open: (target, flags, mode) => open(target, flags, mode),
          rename,
          unlink,
          randomId: randomUUID
        }),
        writeInitialQualificationPauseEvidence,
        notifyInitialQualificationPause: notify,
        now: () => finishedAt
      }
    });

    expect(operation.exitCode).toBe(1);
    expect(notify).toHaveBeenCalledOnce();
    const persistedSummary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
      terminalStatus: string;
      counters: { atomicFailedSourceCount: number; failedSourceCount: number };
    };
    expect(persistedSummary).toMatchObject({
      terminalStatus: "FAILED",
      counters: { atomicFailedSourceCount: 1, failedSourceCount: 1 }
    });
    await expect(readCrawlSummaryFile(summaryPath, {
      now,
      expectedIdentity: evidenceIdentity,
      allowIncompleteScheduled: true
    })).resolves.toEqual({ state: "INVALID" });

    const bundle = await readInitialQualificationPauseBundle({
      pausePath,
      summaryPath,
      attemptDir,
      now,
      loadCandidateStatus: async () => "INVALIDATED"
    });
    expect(bundle).toMatchObject({ state: "PAUSED" });
    if (bundle.state !== "PAUSED") throw new Error(`Expected PAUSED bundle, received ${bundle.state}`);

    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: finishedAt.toISOString(), latestBackupSucceeded: true },
      crawl: {
        authorityState: "PAUSED",
        attemptState: "PAUSED",
        summaryState: "VALID",
        globalSuccessRate: batch.successfulSourceCount / batch.plannedSourceCount,
        consecutiveFailuresByCompany: { "company-a": 2 },
        initialQualificationPause: {
          notificationKey: bundle.evidence.notificationKey,
          releaseCandidateId: bundle.evidence.releaseCandidateId,
          batchId: bundle.evidence.batchId,
          completedRoundCount: bundle.evidence.completedRoundCount,
          stableCompanyCount: bundle.evidence.stableCompanyCount,
          minimumStableCompanyCount: bundle.evidence.minimumStableCompanyCount
        }
      }
    });
    const first = await filterAcknowledgedOneShotAlerts(alerts, stateDir);
    expect(first).toContainEqual(expect.objectContaining({
      code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM",
      dedupeKey: `initial-qualification-pause:${bundle.evidence.notificationKey}`
    }));
    await acknowledgeDeliveredOneShotAlerts(first, stateDir, now);
    await expect(filterAcknowledgedOneShotAlerts(alerts, stateDir)).resolves.not.toContainEqual(
      expect.objectContaining({ code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM" })
    );
  });

  it("cross-validates the pause bundle, delivers it once, and persists acknowledgement", async () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), "job-finder-monitor-pause-"));
    const attemptDir = resolve(outputRoot, "attempts");
    const summaryPath = resolve(outputRoot, "summary.json");
    const pausePath = resolve(outputRoot, "pause.json");
    const stateDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitor-state-"));
    cleanupPaths.push(outputRoot, stateDir);

    const plannedSourceIds = ["source-a", "source-b"];
    const identity = {
      releaseCandidateId: "rc-pause-integration",
      commitSha: "1".repeat(40),
      rosterSha256: "2".repeat(64),
      sourcePlanSha256: "3".repeat(64),
      sourceConfigSha256: "4".repeat(64),
      adapterBundleSha256: "5".repeat(64),
      batchKind: "SCHEDULED" as const,
      ownerId: "staged-scheduler",
      expectedPlannedSourceIds: plannedSourceIds,
      expectedPlannedSourceSetSha256: hashCanonicalStringSet(plannedSourceIds),
      expectedPlannedSourceCount: plannedSourceIds.length
    };
    const evidenceIdentity = {
      releaseCandidateId: identity.releaseCandidateId,
      batchKind: identity.batchKind,
      commitSha: identity.commitSha,
      rosterSha256: identity.rosterSha256,
      sourcePlanSha256: identity.sourcePlanSha256,
      sourceConfigSha256: identity.sourceConfigSha256,
      adapterBundleSha256: identity.adapterBundleSha256,
      plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
      plannedSourceCount: identity.expectedPlannedSourceCount
    };
    const batch = {
      status: "SUCCESS" as const,
      batchId: "batch-second-round",
      plannedSourceCount: 2,
      dueSourceCount: 2,
      transportSuccessfulSourceCount: 2,
      transportFailedSourceCount: 0,
      adapterSuccessfulSourceCount: 2,
      adapterFailedSourceCount: 0,
      completenessVerifiedSourceCount: 2,
      completenessIncompleteSourceCount: 0,
      atomicCommittedSourceCount: 2,
      atomicFailedSourceCount: 0,
      successfulSourceCount: 2,
      failedSourceCount: 0,
      blockedSourceCount: 0,
      skippedSourceCount: 0
    };
    const startedAt = new Date("2026-07-15T00:01:00.000Z");
    const finishedAt = new Date("2026-07-15T00:05:00.000Z");
    const now = new Date("2026-07-15T00:06:00.000Z");
    const summary = buildTerminalCrawlSummary({
      identity,
      batch,
      capturedAt: startedAt,
      finishedAt,
      consecutiveFailuresByCompany: {}
    });
    const serializedSummary = `${JSON.stringify(summary, null, 2)}\n`;
    writeFileSync(summaryPath, serializedSummary, "utf8");
    const summarySha256 = createHash("sha256").update(serializedSummary, "utf8").digest("hex");
    const pause = buildInitialQualificationPauseEvidence({
      attemptId: "attempt-second-round",
      identity,
      batchId: batch.batchId,
      canonicalSummarySha256: summarySha256,
      completedRoundCount: 2,
      stableCompanyCount: 44,
      minimumStableCompanyCount: 45,
      recordedAt: finishedAt
    });
    await writeInitialQualificationPauseEvidence(pausePath, pause);
    await writeCrawlAttemptEvent(attemptDir, buildCrawlAttemptEvent({
      attemptId: pause.attemptId,
      state: "RUNNING",
      startedAt,
      finishedAt: null,
      identity: null,
      authority: { advisoryLockAcquired: false, fileLockAcquired: false },
      canonicalSummaryBinding: null,
      failureCode: null
    }));
    await writeCrawlAttemptEvent(attemptDir, buildCrawlAttemptEvent({
      attemptId: pause.attemptId,
      state: "PAUSED",
      startedAt,
      finishedAt,
      identity: evidenceIdentity,
      authority: { advisoryLockAcquired: true, fileLockAcquired: true },
      canonicalSummaryBinding: { batchId: batch.batchId, summarySha256 },
      failureCode: null,
      initialQualificationPause: {
        reasonCode: pause.reasonCode,
        notificationKey: pause.notificationKey,
        completedRoundCount: pause.completedRoundCount,
        stableCompanyCount: pause.stableCompanyCount,
        minimumStableCompanyCount: pause.minimumStableCompanyCount
      }
    }));

    const payloads: Array<{ alerts: Array<{ code: string; dedupeKey?: string }> }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        payloads.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as (typeof payloads)[number]);
        response.statusCode = 204;
        response.end();
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test alert receiver has no port");

    const runMonitoringCycle = async () => {
      const bundle = await readInitialQualificationPauseBundle({
        pausePath,
        summaryPath,
        attemptDir,
        now,
        loadCandidateStatus: async () => "INVALIDATED"
      });
      if (bundle.state !== "PAUSED") throw new Error(`Expected PAUSED bundle, received ${bundle.state}`);
      const candidateAlerts = evaluateOpsAlerts({
        now,
        health: { ok: false, statusCode: 503 },
        backup: { latestBackupAt: finishedAt.toISOString(), latestBackupSucceeded: true },
        crawl: {
          authorityState: "PAUSED",
          attemptState: "PAUSED",
          summaryState: "VALID",
          globalSuccessRate: 1,
          consecutiveFailuresByCompany: {},
          initialQualificationPause: {
            notificationKey: bundle.evidence.notificationKey,
            releaseCandidateId: bundle.evidence.releaseCandidateId,
            batchId: bundle.evidence.batchId,
            completedRoundCount: bundle.evidence.completedRoundCount,
            stableCompanyCount: bundle.evidence.stableCompanyCount,
            minimumStableCompanyCount: bundle.evidence.minimumStableCompanyCount
          }
        }
      });
      const alerts = await filterAcknowledgedOneShotAlerts(candidateAlerts, stateDir);
      await deliverOpsAlerts(alerts, {
        endpoint: `http://127.0.0.1:${address.port}/alerts`,
        allowInsecureHttp: true,
        now: () => now
      });
      await acknowledgeDeliveredOneShotAlerts(alerts, stateDir, now);
      return alerts;
    };

    try {
      const first = await runMonitoringCycle();
      const second = await runMonitoringCycle();

      expect(first).toContainEqual(expect.objectContaining({
        code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM",
        dedupeKey: `initial-qualification-pause:${pause.notificationKey}`
      }));
      expect(second).not.toContainEqual(expect.objectContaining({
        code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM"
      }));
      expect(payloads).toHaveLength(2);
      expect(payloads[0]!.alerts).toContainEqual(expect.objectContaining({
        dedupeKey: `initial-qualification-pause:${pause.notificationKey}`
      }));
      expect(payloads[1]!.alerts).not.toContainEqual(expect.objectContaining({
        code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM"
      }));
      expect(readdirSync(stateDir)).toEqual([
        `initial-qualification-pause-${pause.notificationKey}.json`
      ]);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
