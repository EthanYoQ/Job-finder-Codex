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
const successBatch: P0CrawlBatchResult = {
  ...batch,
  status: "SUCCESS",
  completenessVerifiedSourceCount: 2,
  completenessIncompleteSourceCount: 0,
  successfulSourceCount: 2,
  blockedSourceCount: 0
};
const expectedIdentity = {
  releaseCandidateId: identity.releaseCandidateId,
  commitSha: identity.commitSha,
  rosterSha256: identity.rosterSha256,
  sourcePlanSha256: identity.sourcePlanSha256,
  sourceConfigSha256: identity.sourceConfigSha256,
  adapterBundleSha256: identity.adapterBundleSha256,
  plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
  plannedSourceCount: identity.expectedPlannedSourceCount
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
      plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
      plannedSourceCount: 2,
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
    const options = { now, maxAgeHours: 14, expectedIdentity };
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "MISSING" });

    writeFileSync(path, "{bad", "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "INVALID" });

    writeFileSync(path, JSON.stringify({ schemaVersion: "future-v9" }), "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "INVALID" });

    writeFileSync(path, JSON.stringify({ schemaVersion: CRAWL_SUMMARY_SCHEMA_VERSION }), "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "INVALID" });

    const stale = buildTerminalCrawlSummary({
      identity,
      batch: successBatch,
      capturedAt: new Date("2026-07-12T07:00:00Z"),
      finishedAt: new Date("2026-07-12T08:00:00Z"),
      consecutiveFailuresByCompany: { "company-a": 0 }
    });
    writeFileSync(path, JSON.stringify(stale), "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toMatchObject({ state: "STALE" });

    const unavailable = buildTerminalCrawlSummary({
      identity,
      batch,
      capturedAt: new Date("2026-07-12T23:00:00Z"),
      finishedAt: new Date("2026-07-12T23:30:00Z"),
      consecutiveFailuresByCompany: null
    });
    writeFileSync(path, JSON.stringify(unavailable), "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "INVALID" });

    const incomplete = buildTerminalCrawlSummary({
      identity,
      batch,
      capturedAt: new Date("2026-07-12T23:00:00Z"),
      finishedAt: new Date("2026-07-12T23:30:00Z"),
      consecutiveFailuresByCompany: {}
    });
    writeFileSync(path, JSON.stringify(incomplete), "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "INVALID" });

    const exceptional = buildExceptionalCrawlSummary({
      identity,
      capturedAt: new Date("2026-07-12T23:00:00Z"),
      finishedAt: new Date("2026-07-12T23:30:00Z"),
      consecutiveFailuresByCompany: {}
    });
    writeFileSync(path, JSON.stringify(exceptional), "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "INVALID" });

    const missingCounter = JSON.parse(JSON.stringify(stale));
    missingCounter.finishedAt = "2026-07-12T23:30:00.000Z";
    delete missingCounter.counters.dueSourceCount;
    writeFileSync(path, JSON.stringify(missingCounter), "utf8");
    await expect(readCrawlSummaryFile(path, options)).resolves.toEqual({ state: "INVALID" });
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

  it("rejects immutable identity drift, non-plain maps, sensitive keys, extra roots, and impossible counters", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "job-finder-crawl-summary-strict-"));
    const path = resolve(root, "crawl-summary.json");
    const now = new Date("2026-07-12T10:00:00Z");
    const valid = buildTerminalCrawlSummary({
      identity,
      batch: successBatch,
      capturedAt: new Date("2026-07-12T08:00:00Z"),
      finishedAt: new Date("2026-07-12T09:00:00Z"),
      consecutiveFailuresByCompany: { "company-a": 0 }
    });

    for (const field of Object.keys(expectedIdentity) as Array<keyof typeof expectedIdentity>) {
      const changed = { ...expectedIdentity };
      if (field === "plannedSourceCount") changed.plannedSourceCount += 1;
      else if (field === "commitSha") changed.commitSha = "f".repeat(40);
      else changed[field] = "f".repeat(64) as never;
      writeFileSync(path, JSON.stringify(valid), "utf8");
      await expect(readCrawlSummaryFile(path, { now, expectedIdentity: changed })).resolves.toEqual({ state: "INVALID" });
    }

    for (const value of [
      { ...valid, unsupported: true },
      { ...valid, consecutiveFailuresByCompany: [] },
      { ...valid, consecutiveFailuresByCompany: null },
      { ...valid, consecutiveFailuresByCompany: { password: 0 } },
      { ...valid, counters: { ...valid.counters!, dueSourceCount: 3 } },
      { ...valid, counters: { ...valid.counters!, transportSuccessfulSourceCount: 1 } },
      { ...valid, counters: { ...valid.counters!, failedSourceCount: 1 } }
    ]) {
      writeFileSync(path, JSON.stringify(value), "utf8");
      await expect(readCrawlSummaryFile(path, { now, expectedIdentity })).resolves.toEqual({ state: "INVALID" });
    }

    const inherited = Object.create({ inheritedCompany: 2 }) as Record<string, number>;
    inherited["company-a"] = 0;
    expect(() => buildTerminalCrawlSummary({
      identity,
      batch: successBatch,
      capturedAt: new Date("2026-07-12T08:00:00Z"),
      finishedAt: new Date("2026-07-12T09:00:00Z"),
      consecutiveFailuresByCompany: inherited
    })).toThrow(/failure map/i);
  });

  it("preserves a real FAILED terminal outcome when intermediate evidence counters are necessarily sparse", () => {
    const failed = { ...batch, status: "FAILED" as const, transportSuccessfulSourceCount: 0,
      adapterSuccessfulSourceCount: 0, completenessVerifiedSourceCount: 0,
      completenessIncompleteSourceCount: 0, atomicCommittedSourceCount: 0,
      atomicFailedSourceCount: 1, successfulSourceCount: 0, failedSourceCount: 1 };
    expect(() => buildTerminalCrawlSummary({ identity, batch: failed,
      capturedAt: new Date("2026-07-12T08:00:00Z"), finishedAt: new Date("2026-07-12T09:00:00Z"),
      consecutiveFailuresByCompany: {} })).not.toThrow();
  });

  it("uses only the basename when creating a temp file for a POSIX absolute production path", () => {
    expect(crawlSummaryTemporaryPath("/app/outputs/crawl-summary.json", 42, "fixed", posix)).toBe(
      "/app/outputs/.crawl-summary.json.42.fixed.tmp"
    );
  });

  it("does not overwrite canonical truth for execution failures and propagates writer failures", async () => {
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
    expect(published).toHaveLength(0);

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
    const stages: string[] = [];
    const sourceHealthError = new Error("source health unavailable");

    await expect(
      runAndPublishCrawlSummary({
        identity,
        capturedAt: new Date("2026-07-12T08:00:00Z"),
        run: async () => ({ batch: successBatch }),
        loadConsecutiveFailuresByCompany: async () => {
          throw sourceHealthError;
        },
        publish: async (summary) => {
          published.push(summary);
        },
        onStage: stage => stages.push(stage),
        now: () => new Date("2026-07-12T08:01:00Z")
      })
    ).rejects.toBe(sourceHealthError);

    expect(published).toHaveLength(1);
    expect(stages).toEqual(["EXECUTION", "SOURCE_HEALTH", "PUBLISH", "SOURCE_HEALTH"]);
    expect(published[0]).toMatchObject({
      batchId: "batch-real",
      terminalStatus: "SUCCESS",
      counters: successBatch,
      globalSuccessRate: 1,
      sourceHealthStatus: "UNAVAILABLE",
      consecutiveFailuresByCompany: null,
      failureCode: null
    });
  });
});
