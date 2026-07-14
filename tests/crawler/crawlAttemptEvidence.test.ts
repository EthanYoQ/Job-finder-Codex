import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCrawlAttemptEvent,
  readLatestCrawlAttemptStartedAt,
  readLatestCrawlAttempt,
  writeCrawlAttemptEvent
} from "../../src/crawler/crawlAttemptEvidence";

const expectedIdentity = {
  releaseCandidateId: "rc-attempt",
  batchKind: "SCHEDULED" as const,
  commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64),
  sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64),
  plannedSourceSetSha256: "6".repeat(64),
  plannedSourceCount: 2
};

describe("crawl attempt execution evidence", () => {
  it("tracks bounded RUNNING and immutable FAILED terminal state without canonical batch claims", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-attempt-"));
    await expect(readLatestCrawlAttempt(root, { now: new Date("2026-07-12T08:00:00Z"), expectedIdentity }))
      .resolves.toEqual({ state: "MISSING" });
    const running = buildCrawlAttemptEvent({
      attemptId: "attempt-a",
      state: "RUNNING",
      startedAt: new Date("2026-07-12T08:00:00Z"),
      finishedAt: null,
      identity: null,
      authority: { advisoryLockAcquired: false, fileLockAcquired: false },
      canonicalSummaryBinding: null,
      failureCode: null
    });
    await writeCrawlAttemptEvent(root, running);
    await expect(readLatestCrawlAttempt(root, {
      now: new Date("2026-07-12T08:30:00Z"), expectedIdentity, maxRunningAgeHours: 2
    })).resolves.toMatchObject({ state: "RUNNING" });
    await expect(readLatestCrawlAttempt(root, {
      now: new Date("2026-07-12T11:00:00Z"), expectedIdentity, maxRunningAgeHours: 2
    })).resolves.toEqual({ state: "STALE" });

    await writeCrawlAttemptEvent(root, buildCrawlAttemptEvent({
      ...running,
      state: "FAILED",
      finishedAt: new Date("2026-07-12T08:05:00Z"),
      failureCode: "PRE_IDENTITY_FAILED"
    }));
    await expect(readLatestCrawlAttempt(root, {
      now: new Date("2026-07-12T08:06:00Z"), expectedIdentity
    })).resolves.toEqual({ state: "FAILED" });
  });

  it("accepts SUCCESS only with both execution locks, current identity, and canonical summary binding", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-attempt-success-"));
    const running = buildCrawlAttemptEvent({
      attemptId: "attempt-success",
      state: "RUNNING",
      startedAt: new Date("2026-07-12T08:00:00Z"),
      finishedAt: null,
      identity: null,
      authority: { advisoryLockAcquired: false, fileLockAcquired: false },
      canonicalSummaryBinding: null,
      failureCode: null
    });
    await writeCrawlAttemptEvent(root, running);
    await writeCrawlAttemptEvent(root, buildCrawlAttemptEvent({
      ...running,
      state: "SUCCESS",
      finishedAt: new Date("2026-07-12T09:00:00Z"),
      identity: expectedIdentity,
      authority: { advisoryLockAcquired: true, fileLockAcquired: true },
      canonicalSummaryBinding: { batchId: "batch-1", summarySha256: "a".repeat(64) },
      failureCode: null
    }));
    await expect(readLatestCrawlAttempt(root, {
      now: new Date("2026-07-12T09:01:00Z"), expectedIdentity,
      expectedCanonicalSummary: { batchId: "batch-1", summarySha256: "a".repeat(64) }
    })).resolves.toMatchObject({ state: "SUCCESS" });
    await expect(readLatestCrawlAttempt(root, {
      now: new Date("2026-07-12T09:01:00Z"), expectedIdentity: { ...expectedIdentity, plannedSourceCount: 3 },
      expectedCanonicalSummary: { batchId: "batch-1", summarySha256: "a".repeat(64) }
    })).resolves.toEqual({ state: "INVALID" });
    await expect(readLatestCrawlAttemptStartedAt(root)).resolves.toEqual(new Date("2026-07-12T08:00:00.000Z"));
  });

  it("selects the newest attempt deterministically so a concurrent loser cannot overwrite canonical truth", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-attempt-concurrent-"));
    for (const input of [
      {
        attemptId: "attempt-winner", state: "SUCCESS" as const,
        startedAt: new Date("2026-07-12T08:00:00Z"), finishedAt: new Date("2026-07-12T09:00:00Z"),
        identity: expectedIdentity, authority: { advisoryLockAcquired: true, fileLockAcquired: true },
        canonicalSummaryBinding: { batchId: "batch-1", summarySha256: "a".repeat(64) }, failureCode: null
      },
      {
        attemptId: "attempt-loser", state: "FAILED" as const,
        startedAt: new Date("2026-07-12T09:01:00Z"), finishedAt: new Date("2026-07-12T09:01:01Z"),
        identity: expectedIdentity, authority: { advisoryLockAcquired: false, fileLockAcquired: false },
        canonicalSummaryBinding: null, failureCode: "ADVISORY_LOCK_FAILED" as const
      }
    ]) await writeCrawlAttemptEvent(root, buildCrawlAttemptEvent(input));
    await expect(readLatestCrawlAttempt(root, {
      now: new Date("2026-07-12T09:02:00Z"), expectedIdentity,
      expectedCanonicalSummary: { batchId: "batch-1", summarySha256: "a".repeat(64) }
    })).resolves.toEqual({ state: "FAILED" });
  });

  it("fails closed when multiple attempts share the maximum startedAt", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-attempt-tied-"));
    for (const attemptId of ["attempt-a", "attempt-b"]) {
      await writeCrawlAttemptEvent(root, buildCrawlAttemptEvent({
        attemptId,
        state: "FAILED",
        startedAt: new Date("2026-07-12T09:00:00Z"),
        finishedAt: new Date("2026-07-12T09:00:01Z"),
        identity: expectedIdentity,
        authority: { advisoryLockAcquired: false, fileLockAcquired: false },
        canonicalSummaryBinding: null,
        failureCode: "ADVISORY_LOCK_FAILED"
      }));
    }
    await expect(readLatestCrawlAttempt(root, {
      now: new Date("2026-07-12T09:01:00Z"), expectedIdentity
    })).resolves.toEqual({ state: "INVALID" });
  });

  it("fails closed for unexpected directory entries, symlinks, and non-regular files", async () => {
    for (const contaminate of [
      (root: string) => writeFileSync(resolve(root, "unexpected.txt"), "unexpected"),
      (root: string) => mkdirSync(resolve(root, "unexpected-directory")),
      (root: string) => {
        writeFileSync(resolve(root, "target.json"), "{}\n");
        symlinkSync(resolve(root, "target.json"), resolve(root, "linked.json"), "file");
      }
    ]) {
      const root = mkdtempSync(resolve(tmpdir(), "job-finder-attempt-contaminated-"));
      contaminate(root);
      await expect(readLatestCrawlAttempt(root, {
        now: new Date("2026-07-12T09:01:00Z"), expectedIdentity
      })).resolves.toEqual({ state: "INVALID" });
    }
  });
});
