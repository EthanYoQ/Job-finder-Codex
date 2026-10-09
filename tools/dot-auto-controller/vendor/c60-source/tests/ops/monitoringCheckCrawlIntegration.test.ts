// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrawlAttemptEvent, writeCrawlAttemptEvent } from "../../src/crawler/crawlAttemptEvidence";
import { buildTerminalCrawlSummary, writeCrawlSummaryAtomic } from "../../src/crawler/crawlSummary";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import { publishBackupAttemptReceipt } from "../../src/ops/backupAttemptReceipt";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("production monitoring crawl evidence", () => {
  it("drives the same CLI entrypoint from critical crawl failure to zero-alert recovery", async () => {
    mkdirSync(resolve(process.cwd(), "outputs"), { recursive: true });
    const root = mkdtempSync(resolve(process.cwd(), "outputs", "monitor-cli-integration-"));
    const backupRoot = mkdtempSync(resolve(tmpdir(), "monitor-cli-backup-"));
    roots.push(root, backupRoot);
    const summaryPath = resolve(root, "summary.json");
    const attemptDir = resolve(root, "attempts");
    const pausePath = resolve(root, "pause.json");
    const archiveName = "jobfinder-monitor-cli.dump";
    const archive = Buffer.from("backup");
    writeFileSync(resolve(backupRoot, archiveName), archive);
    await publishBackupAttemptReceipt(resolve(backupRoot, "latest-backup-attempt.json"), {
      decision: "SUCCEEDED", attemptedAt: "2026-08-13T01:00:00.000Z", completedAt: "2026-08-13T01:01:00.000Z",
      archiveName, archiveSha256: createHash("sha256").update(archive).digest("hex")
    });
    mkdirSync(attemptDir);
    const plannedSourceIds = ["source-a", "source-b"];
    const runtimeIdentity = {
      releaseCandidateId: "rc-monitor-cli", commitSha: "1".repeat(40), rosterSha256: "2".repeat(64),
      sourcePlanSha256: "3".repeat(64), sourceConfigSha256: "4".repeat(64), adapterBundleSha256: "5".repeat(64),
      batchKind: "SCHEDULED" as const, ownerId: "scheduler", expectedPlannedSourceIds: plannedSourceIds,
      expectedPlannedSourceSetSha256: hashCanonicalStringSet(plannedSourceIds), expectedPlannedSourceCount: 2
    };
    const identity = {
      releaseCandidateId: runtimeIdentity.releaseCandidateId, batchKind: runtimeIdentity.batchKind,
      commitSha: runtimeIdentity.commitSha, rosterSha256: runtimeIdentity.rosterSha256,
      sourcePlanSha256: runtimeIdentity.sourcePlanSha256, sourceConfigSha256: runtimeIdentity.sourceConfigSha256,
      adapterBundleSha256: runtimeIdentity.adapterBundleSha256,
      plannedSourceSetSha256: runtimeIdentity.expectedPlannedSourceSetSha256, plannedSourceCount: 2
    };
    const baseBatch = {
      status: "INCOMPLETE" as const, batchId: "batch-monitor-cli", plannedSourceCount: 2, dueSourceCount: 2,
      transportSuccessfulSourceCount: 2, transportFailedSourceCount: 0, adapterSuccessfulSourceCount: 2,
      adapterFailedSourceCount: 0, completenessVerifiedSourceCount: 1, completenessIncompleteSourceCount: 1,
      atomicCommittedSourceCount: 2, atomicFailedSourceCount: 0, successfulSourceCount: 1, failedSourceCount: 0,
      blockedSourceCount: 1, skippedSourceCount: 0
    };
    const finishedAt = new Date("2026-08-13T02:00:00.000Z");
    const failedSummary = buildTerminalCrawlSummary({ identity: runtimeIdentity, batch: baseBatch,
      capturedAt: new Date("2026-08-13T01:50:00.000Z"), finishedAt,
      consecutiveFailuresByCompany: { "mandatory-company": 1 } });
    const atomicOps = {
      mkdir: async (path: string, options: { recursive: true; mode: number }) => {
        const { mkdir } = await import("node:fs/promises"); await mkdir(path, options);
      },
      open: async (path: string, flags: "wx", mode: number) => {
        const handle = await import("node:fs/promises").then(({ open }) => open(path, flags, mode));
        return { writeFile: (data: string, options: { encoding: "utf8" }) => handle.writeFile(data, options),
          sync: () => handle.sync(), close: () => handle.close() };
      },
      rename: async (from: string, to: string) => import("node:fs/promises").then(({ rename }) => rename(from, to)),
      unlink: async (path: string) => import("node:fs/promises").then(({ unlink }) => unlink(path)),
      randomId: () => "monitor-cli"
    };
    await writeCrawlSummaryAtomic(summaryPath, failedSummary, atomicOps);
    const summaryHash = createHash("sha256").update(`${JSON.stringify(failedSummary, null, 2)}\n`).digest("hex");
    const attempt = buildCrawlAttemptEvent({ attemptId: "monitor-cli", state: "SUCCESS",
      startedAt: new Date("2026-08-13T01:50:00.000Z"), finishedAt, identity,
      authority: { advisoryLockAcquired: true, fileLockAcquired: true },
      canonicalSummaryBinding: { batchId: baseBatch.batchId, summarySha256: summaryHash }, failureCode: null });
    await writeCrawlAttemptEvent(attemptDir, attempt);
    Object.assign(process.env, { STAGED_CRAWL_SUMMARY_PATH: summaryPath, STAGED_CRAWL_ATTEMPT_DIR: attemptDir,
      STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: pausePath, BACKUP_DIR: backupRoot,
      MONITORING_NOW: "2026-08-13T02:01:00.000Z", MONITOR_STATE_DIR: resolve(root, "state"),
      RESTORE_RECEIPT_PATH: resolve(root, "missing-restore.json") });
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...values) => errors.push(values.join(" ")));
    const { runMonitoringCheck } = await import("../../ops/monitoring-check");
    const healthyRestore = { latestRestoreAt: "2026-08-13T01:00:00.000Z", latestRestoreSucceeded: true };

    await runMonitoringCheck({ databaseReachable: true, expectedIdentity: identity,
      health: { ok: true, statusCode: 200 }, restore: healthyRestore });
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/MANDATORY_COMPANY_FAILURE/u);
    expect(errors.join("\n")).toMatch(/CRAWL_COMPLETENESS_FAILURE/u);

    const successBatch = { ...baseBatch, status: "SUCCESS" as const, completenessVerifiedSourceCount: 2,
      completenessIncompleteSourceCount: 0, successfulSourceCount: 2, blockedSourceCount: 0 };
    const successSummary = buildTerminalCrawlSummary({ identity: runtimeIdentity, batch: successBatch,
      capturedAt: new Date("2026-08-13T01:50:00.000Z"), finishedAt, consecutiveFailuresByCompany: {} });
    await writeCrawlSummaryAtomic(summaryPath, successSummary, { ...atomicOps, randomId: () => "monitor-cli-recovery" });
    const successSummaryHash = createHash("sha256").update(`${JSON.stringify(successSummary, null, 2)}\n`).digest("hex");
    await writeCrawlAttemptEvent(attemptDir, buildCrawlAttemptEvent({
      attemptId: "monitor-cli-recovery", state: "SUCCESS", startedAt: new Date("2026-08-13T01:50:01.000Z"),
      finishedAt, identity, authority: { advisoryLockAcquired: true, fileLockAcquired: true },
      canonicalSummaryBinding: { batchId: successBatch.batchId, summarySha256: successSummaryHash }, failureCode: null
    }));
    errors.length = 0;
    process.exitCode = undefined;
    await runMonitoringCheck({ databaseReachable: true, expectedIdentity: identity,
      health: { ok: true, statusCode: 200 }, restore: healthyRestore });
    expect(process.exitCode, errors.join("\n")).toBeUndefined();
    expect(errors.join("\n")).not.toMatch(/MANDATORY_COMPANY_FAILURE|CRAWL_COMPLETENESS_FAILURE/u);
  });
});
