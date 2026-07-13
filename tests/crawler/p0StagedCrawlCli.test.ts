import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCurrentStagedScheduledCrawl } from "../../src/crawler/stagedScheduledCrawl";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import type { CrawlAttemptEvent } from "../../src/crawler/crawlAttemptEvidence";
import type { CrawlSummary } from "../../src/crawler/crawlSummary";
import {
  runStagedCrawlOperation,
  type StagedCrawlRuntime
} from "../../src/crawler/stagedCrawlCli";

vi.mock("../../src/readiness/buildIdentity", () => ({
  resolveCurrentBuildIdentity: () => ({
    schemaVersion: 2,
    commitSha: "1".repeat(40),
    sourceTreeSha256: "2".repeat(64),
    runtimeTreeSha256: "3".repeat(64),
    contentSha256: "4".repeat(64)
  })
}));

const IDENTITY = Object.freeze({
  releaseCandidateId: "rc-staged-cli",
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

function batch(status: "SUCCESS" | "FAILED" = "SUCCESS") {
  const successful = status === "SUCCESS" ? 2 : 1;
  const failed = status === "SUCCESS" ? 0 : 1;
  return {
    status,
    batchId: `batch-${status.toLowerCase()}`,
    plannedSourceCount: 2,
    dueSourceCount: 2,
    transportSuccessfulSourceCount: successful,
    transportFailedSourceCount: failed,
    adapterSuccessfulSourceCount: successful,
    adapterFailedSourceCount: 0,
    completenessVerifiedSourceCount: successful,
    completenessIncompleteSourceCount: 0,
    atomicCommittedSourceCount: successful,
    atomicFailedSourceCount: failed,
    successfulSourceCount: successful,
    failedSourceCount: failed,
    blockedSourceCount: 0,
    skippedSourceCount: 0
  } as const;
}

function commandResult(status: "SUCCESS" | "FAILED" = "SUCCESS") {
  return {
    syncedCompanyCount: 60,
    syncedSourceCount: 2,
    hiddenUnplannedVisibleJobCount: 0,
    batch: batch(status),
    identity: IDENTITY
  };
}

function harness(runtime: StagedCrawlRuntime) {
  const events: CrawlAttemptEvent[] = [];
  const summaries: Array<{ path: string; summary: CrawlSummary }> = [];
  const advisoryRelease = vi.fn(async () => undefined);
  const fileClose = vi.fn(async () => undefined);
  const fileUnlink = vi.fn(async () => undefined);
  const deps = {
    acquireAdvisoryLock: vi.fn(async () => ({ release: advisoryRelease })),
    acquireFileLock: vi.fn(async () => ({ close: fileClose })),
    unlinkFileLock: fileUnlink,
    assertBrowserReady: vi.fn(async () => undefined),
    createRuntime: vi.fn(async () => runtime),
    writeAttemptEvent: vi.fn(async (_directory: string, event: CrawlAttemptEvent) => {
      events.push(event);
    }),
    writeSummary: vi.fn(async (path: string, summary: CrawlSummary) => {
      summaries.push({ path, summary });
      return { sha256: "a".repeat(64) };
    }),
    now: vi.fn(() => new Date("2026-07-14T00:05:00.000Z"))
  };
  return { deps, events, summaries, advisoryRelease, fileClose, fileUnlink };
}

function operationInput(deps: ReturnType<typeof harness>["deps"]) {
  return {
    attemptId: "attempt-staged",
    startedAt: new Date("2026-07-14T00:00:00.000Z"),
    capturedAt: new Date("2026-07-14T00:00:00.000Z"),
    attemptDir: "C:/tmp/staged-crawl-attempts",
    summaryPath: "C:/tmp/staged-crawl-summary.json",
    schedulerOwnsAttempt: false,
    deps
  };
}

describe("staged crawl operational CLI", () => {
  it.each(["--help", "--force", "--source-id", "--release-candidate-id", "unexpected"]) (
    "rejects %s before loading runtime or database modules",
    (argument) => {
      const result = spawnSync(
        process.execPath,
        [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/p0-staged-crawl.ts", argument],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            STAGED_CRAWL_ATTEMPT_DIR: resolve(mkdtempSync(resolve(tmpdir(), "p0-staged-cli-")), "attempts")
          }
        }
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(2);
      expect(output).toContain("accepts no arguments");
      expect(output).not.toMatch(/Prisma|DATABASE_URL|advisory lock|crawl attempt/iu);
    },
    15_000
  );

  it.each(["SUCCESS", "FAILED"] as const)(
    "publishes a staged summary and one truthful terminal event for %s",
    async (status) => {
      const runtime: StagedCrawlRuntime = {
        run: vi.fn(async () => commandResult(status)),
        loadConsecutiveFailuresByCompany: vi.fn(async () => ({ "company-a": status === "SUCCESS" ? 0 : 1 })),
        disconnect: vi.fn(async () => undefined)
      };
      const fixture = harness(runtime);

      const result = await runStagedCrawlOperation(operationInput(fixture.deps));

      expect(result.exitCode).toBe(status === "SUCCESS" ? 0 : 1);
      expect(result.commandResult.batch).toEqual(batch(status));
      expect(fixture.summaries).toHaveLength(1);
      expect(fixture.summaries[0]).toMatchObject({
        path: "C:/tmp/staged-crawl-summary.json",
        summary: {
          terminalStatus: status,
          batchId: `batch-${status.toLowerCase()}`,
          counters: { successfulSourceCount: status === "SUCCESS" ? 2 : 1, failedSourceCount: status === "SUCCESS" ? 0 : 1 }
        }
      });
      expect(fixture.events.map((event) => event.state)).toEqual([
        "RUNNING",
        status === "SUCCESS" ? "SUCCESS" : "FAILED"
      ]);
      expect(fixture.events[1]).toMatchObject({
        identity: {
          releaseCandidateId: IDENTITY.releaseCandidateId,
          plannedSourceCount: 2
        },
        failureCode: status === "SUCCESS" ? null : "CRAWL_EXECUTION_FAILED"
      });
      if (status === "SUCCESS") {
        expect(fixture.events[1]).toMatchObject({
          canonicalSummaryBinding: { batchId: "batch-success", summarySha256: "a".repeat(64) }
        });
      }
      expect(runtime.disconnect).toHaveBeenCalledOnce();
      expect(fixture.fileClose).toHaveBeenCalledOnce();
      expect(fixture.fileUnlink).toHaveBeenCalledOnce();
      expect(fixture.advisoryRelease).toHaveBeenCalledOnce();
    }
  );

  it("records authority failure and leaves registry, batch, and fetch seams untouched", async () => {
    const sync = vi.fn();
    const runBatch = vi.fn();
    const fetch = vi.fn();
    const runtime: StagedCrawlRuntime = {
      run: () => runCurrentStagedScheduledCrawl({
        db: { releaseCandidate: { findMany: vi.fn(async () => []) } } as never,
        fetch,
        now: new Date("2026-07-14T00:00:00.000Z"),
        syncPlannedSourcesToDb: sync,
        createRuntimeDeps: vi.fn(),
        runP0CrawlBatch: runBatch
      }),
      loadConsecutiveFailuresByCompany: vi.fn(),
      disconnect: vi.fn(async () => undefined)
    };
    const fixture = harness(runtime);

    await expect(runStagedCrawlOperation(operationInput(fixture.deps))).rejects.toThrow(/exactly one matching release candidate/i);

    expect(sync).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(fixture.summaries).toHaveLength(0);
    expect(fixture.events.map((event) => event.state)).toEqual(["RUNNING", "FAILED"]);
  });

  it("attempts every acquired cleanup when individual cleanup operations fail", async () => {
    const runtime: StagedCrawlRuntime = {
      run: vi.fn(async () => commandResult()),
      loadConsecutiveFailuresByCompany: vi.fn(async () => ({})),
      disconnect: vi.fn(async () => { throw new Error("disconnect failed"); })
    };
    const fixture = harness(runtime);
    fixture.fileClose.mockRejectedValueOnce(new Error("close failed"));
    fixture.advisoryRelease.mockRejectedValueOnce(new Error("release failed"));

    await expect(runStagedCrawlOperation(operationInput(fixture.deps))).rejects.toThrow(/cleanup/i);

    expect(runtime.disconnect).toHaveBeenCalledOnce();
    expect(fixture.fileClose).toHaveBeenCalledOnce();
    expect(fixture.fileUnlink).toHaveBeenCalledOnce();
    expect(fixture.advisoryRelease).toHaveBeenCalledOnce();
    expect(fixture.events.at(-1)).toMatchObject({ state: "FAILED", failureCode: "CLEANUP_FAILED" });
  });

  it("wires only the staged wrapper and preserves strict entry bytes", () => {
    const script = readFileSync("scripts/p0-staged-crawl.ts", "utf8");
    const operational = readFileSync("src/crawler/stagedCrawlCli.ts", "utf8");
    const scheduler = readFileSync("scripts/p0-scheduler.ts", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const compose = readFileSync("ops/docker-compose.yml", "utf8");

    expect(`${script}\n${operational}`).toContain("runCurrentStagedScheduledCrawl");
    expect(`${script}\n${operational}`).not.toMatch(/buildDiscoverySourcePlanCandidates|buildSourceCrawlPlans|buildStagedSourceCrawlPlans/u);
    expect(`${script}\n${operational}`).not.toMatch(/--force|--source-id|--release-candidate-id|--commit-sha|--batch-kind/u);
    expect(scheduler).toContain('"p0:staged-crawl"');
    expect(scheduler).toContain("staged-crawl-attempts");
    expect(scheduler).toMatch(/nextP0CrawlWindow/);
    expect(scheduler).toMatch(/no immediate retry/i);
    expect(scheduler).toContain("60_000");
    expect(packageJson.scripts["p0:staged-crawl"]).toBe("tsx scripts/p0-staged-crawl.ts");
    expect(packageJson.scripts["p0:crawl"]).toBe("tsx scripts/p0-crawl.ts");
    expect(packageJson.scripts["p0:formal-crawl-once"]).toBe("tsx scripts/p0-formal-crawl-once.ts");
    expect(compose.match(/^  scheduler:/gmu)).toHaveLength(1);
    expect(compose).toMatch(/scheduler:[\s\S]*command:\s*\["npm",\s*"run",\s*"p0:scheduler"\]/u);

    for (const path of ["scripts/p0-crawl.ts", "scripts/p0-formal-crawl-once.ts"]) {
      const head = execFileSync("git", ["show", `HEAD:${path}`]);
      expect(readFileSync(path)).toEqual(head);
    }
  });
});
