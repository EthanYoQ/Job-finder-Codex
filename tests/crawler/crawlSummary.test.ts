import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { posix, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CRAWL_SUMMARY_SCHEMA_VERSION,
  buildExceptionalCrawlSummary,
  buildTerminalCrawlSummary,
  collectConsecutiveFailuresByCompany,
  crawlSummaryTemporaryPath,
  readCrawlSummaryFile,
  runAndPublishCrawlSummary,
  writeCrawlSummaryAtomic
} from "../../src/crawler/crawlSummary";
import type { P0CrawlBatchResult } from "../../src/crawler/runCrawlBatch";

const identity = {
  releaseCandidateId: "p0-rc-20260712-test",
  commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64),
  sourcePlanSha256: "3".repeat(64),
  sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64),
  batchKind: "FULL_RELEASE" as const,
  ownerId: "formal-crawler",
  expectedPlannedSourceIds: ["source-a", "source-b"],
  expectedPlannedSourceSetSha256: createHash("sha256")
    .update(JSON.stringify(["source-a", "source-b"]))
    .digest("hex"),
  expectedPlannedSourceCount: 2
};

const batch: P0CrawlBatchResult = {
  status: "INCOMPLETE",
  batchId: "batch-real",
  plannedSourceCount: 2,
  dueSourceCount: 2,
  transportSuccessfulSourceCount: 2,
  transportFailedSourceCount: 0,
  adapterSuccessfulSourceCount: 2,
  adapterFailedSourceCount: 0,
  completenessVerifiedSourceCount: 1,
  completenessIncompleteSourceCount: 1,
  atomicCommittedSourceCount: 2,
  atomicFailedSourceCount: 0,
  successfulSourceCount: 1,
  failedSourceCount: 0,
  blockedSourceCount: 1,
  skippedSourceCount: 0
};

describe("versioned crawl summary", () => {
  it("builds identity-bound metrics only from a real batch result and persisted source observations", async () => {
    const failures = await collectConsecutiveFailuresByCompany(
      [
        { companyId: "company-a", sourceId: "source-a" },
        { companyId: "company-a", sourceId: "source-b" },
        { companyId: "company-b", sourceId: "source-c" }
      ],
      async (sourceId) =>
        sourceId === "source-a"
          ? [
              { crawledAt: new Date("2026-07-12T09:00:00Z"), successful: false },
              { crawledAt: new Date("2026-07-12T08:00:00Z"), successful: false },
              { crawledAt: new Date("2026-07-11T20:00:00Z"), successful: true }
            ]
          : sourceId === "source-b"
            ? [{ crawledAt: new Date("2026-07-12T09:00:00Z"), successful: false }]
            : [{ crawledAt: new Date("2026-07-12T09:00:00Z"), successful: true }]
    );
    const summary = buildTerminalCrawlSummary({
      identity,
      batch,
      capturedAt: new Date("2026-07-12T08:00:00Z"),
      finishedAt: new Date("2026-07-12T09:05:00Z"),
      consecutiveFailuresByCompany: failures
    });

    expect(summary).toMatchObject({
      schemaVersion: CRAWL_SUMMARY_SCHEMA_VERSION,
      releaseCandidateId: identity.releaseCandidateId,
      batchId: "batch-real",
      commitSha: identity.commitSha,
      capturedAt: "2026-07-12T08:00:00.000Z",
      finishedAt: "2026-07-12T09:05:00.000Z",
      terminalStatus: "INCOMPLETE",
      counters: batch,
      globalSuccessRate: 0.5,
      sourceHealthStatus: "PERSISTED",
      consecutiveFailuresByCompany: { "company-a": 2, "company-b": 0 }
    });
  });

  it("classifies missing, malformed, unsupported, incomplete, and stale files fail closed", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-crawl-summary-"));
    const path = resolve(root, "crawl-summary.json");
    const now = new Date("2026-07-13T00:00:00Z");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "MISSING" });

    writeFileSync(path, "{bad", "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "INVALID" });

    writeFileSync(path, JSON.stringify({ schemaVersion: "future-v9" }), "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "INVALID" });

    writeFileSync(path, JSON.stringify({ schemaVersion: CRAWL_SUMMARY_SCHEMA_VERSION }), "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "INVALID" });

    const stale = buildTerminalCrawlSummary({
      identity,
      batch: { ...batch, status: "SUCCESS", successfulSourceCount: 2, blockedSourceCount: 0 },
      capturedAt: new Date("2026-07-12T07:00:00Z"),
      finishedAt: new Date("2026-07-12T08:00:00Z"),
      consecutiveFailuresByCompany: { "company-a": 0 }
    });
    writeFileSync(path, JSON.stringify(stale), "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toMatchObject({ state: "STALE" });

    const unavailable = buildTerminalCrawlSummary({
      identity,
      batch,
      capturedAt: new Date("2026-07-12T23:00:00Z"),
      finishedAt: new Date("2026-07-12T23:30:00Z"),
      consecutiveFailuresByCompany: null
    });
    writeFileSync(path, JSON.stringify(unavailable), "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "INVALID" });

    const incomplete = buildTerminalCrawlSummary({
      identity,
      batch,
      capturedAt: new Date("2026-07-12T23:00:00Z"),
      finishedAt: new Date("2026-07-12T23:30:00Z"),
      consecutiveFailuresByCompany: {}
    });
    writeFileSync(path, JSON.stringify(incomplete), "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "INVALID" });

    const exceptional = buildExceptionalCrawlSummary({
      identity,
      capturedAt: new Date("2026-07-12T23:00:00Z"),
      finishedAt: new Date("2026-07-12T23:30:00Z"),
      consecutiveFailuresByCompany: {}
    });
    writeFileSync(path, JSON.stringify(exceptional), "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "INVALID" });

    const missingCounter = JSON.parse(JSON.stringify(stale));
    missingCounter.finishedAt = "2026-07-12T23:30:00.000Z";
    delete missingCounter.counters.dueSourceCount;
    writeFileSync(path, JSON.stringify(missingCounter), "utf8");
    await expect(readCrawlSummaryFile(path, { now, maxAgeHours: 14 })).resolves.toEqual({ state: "INVALID" });
  });

  it("flushes and closes the same-directory temp file before atomic rename", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-crawl-summary-atomic-"));
    const path = resolve(root, "crawl-summary.json");
    const events: string[] = [];
    const handle = {
      writeFile: vi.fn(async () => events.push("write")),
      sync: vi.fn(async () => events.push("sync")),
      close: vi.fn(async () => events.push("close"))
    };
    const rename = vi.fn(async (from: string, to: string) => {
      events.push("rename");
      expect(resolve(from, "..")).toBe(resolve(to, ".."));
    });
    const summary = buildTerminalCrawlSummary({
      identity,
      batch,
      capturedAt: new Date("2026-07-12T08:00:00Z"),
      finishedAt: new Date("2026-07-12T09:05:00Z"),
      consecutiveFailuresByCompany: {}
    });

    await writeCrawlSummaryAtomic(path, summary, {
      mkdir: vi.fn(async () => undefined),
      open: vi.fn(async () => handle),
      rename,
      unlink: vi.fn(async () => undefined),
      randomId: () => "fixed"
    });

    expect(events).toEqual(["write", "sync", "close", "rename"]);
  });

  it("uses only the basename when creating a temp file for a POSIX absolute production path", () => {
    expect(crawlSummaryTemporaryPath("/app/outputs/crawl-summary.json", 42, "fixed", posix)).toBe(
      "/app/outputs/.crawl-summary.json.42.fixed.tmp"
    );
  });

  it("publishes terminal failures after identity is known and propagates writer failures", async () => {
    const published: unknown[] = [];
    const executionError = new Error("transport secret must not be serialized");

    await expect(
      runAndPublishCrawlSummary({
        identity,
        capturedAt: new Date("2026-07-12T08:00:00Z"),
        run: async () => {
          throw executionError;
        },
        loadConsecutiveFailuresByCompany: async () => ({ "company-a": 3 }),
        publish: async (summary) => {
          published.push(summary);
        },
        now: () => new Date("2026-07-12T08:01:00Z")
      })
    ).rejects.toBe(executionError);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      terminalStatus: "FAILED",
      batchId: null,
      counters: null,
      globalSuccessRate: null,
      sourceHealthStatus: "PERSISTED",
      consecutiveFailuresByCompany: { "company-a": 3 },
      failureCode: "CRAWL_EXECUTION_FAILED"
    });
    expect(JSON.stringify(published[0])).not.toContain("transport secret");

    await expect(
      runAndPublishCrawlSummary({
        identity,
        capturedAt: new Date("2026-07-12T08:00:00Z"),
        run: async () => ({ batch }),
        loadConsecutiveFailuresByCompany: async () => ({}),
        publish: async () => {
          throw new Error("disk full");
        },
        now: () => new Date("2026-07-12T08:01:00Z")
      })
    ).rejects.toThrow("disk full");
  });

  it("preserves a real terminal batch when persisted source-health loading fails", async () => {
    const published: unknown[] = [];
    const sourceHealthError = new Error("source health unavailable");

    await expect(
      runAndPublishCrawlSummary({
        identity,
        capturedAt: new Date("2026-07-12T08:00:00Z"),
        run: async () => ({ batch: { ...batch, status: "SUCCESS" as const } }),
        loadConsecutiveFailuresByCompany: async () => {
          throw sourceHealthError;
        },
        publish: async (summary) => {
          published.push(summary);
        },
        now: () => new Date("2026-07-12T08:01:00Z")
      })
    ).rejects.toBe(sourceHealthError);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      batchId: "batch-real",
      terminalStatus: "SUCCESS",
      counters: { ...batch, status: "SUCCESS" },
      globalSuccessRate: 0.5,
      sourceHealthStatus: "UNAVAILABLE",
      consecutiveFailuresByCompany: null,
      failureCode: null
    });
  });
});
