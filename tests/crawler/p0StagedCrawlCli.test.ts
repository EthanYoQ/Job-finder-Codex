import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCurrentStagedScheduledCrawl } from "../../src/crawler/stagedScheduledCrawl";
import { hashCanonicalStringSet } from "../../src/crawler/runtimeBatchIdentity";
import type { CrawlAttemptEvent } from "../../src/crawler/crawlAttemptEvidence";
import type { CrawlSummary } from "../../src/crawler/crawlSummary";
import type { InitialQualificationPauseEvidence } from "../../src/crawler/initialQualificationPauseEvidence";
import {
  parseStagedCrawlArgs,
  resolveStagedCrawlEvidencePaths,
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

function batch(status: "SUCCESS" | "INCOMPLETE" | "FAILED" = "SUCCESS") {
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
    atomicFailedSourceCount: status === "FAILED" ? 1 : 0,
    successfulSourceCount: successful,
    failedSourceCount: failed,
    blockedSourceCount: 0,
    skippedSourceCount: 0
  } as const;
}

function commandResult(status: "SUCCESS" | "INCOMPLETE" | "FAILED" = "SUCCESS") {
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
  const qualificationPauses: Array<{ path: string; evidence: InitialQualificationPauseEvidence }> = [];
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
    writeInitialQualificationPauseEvidence: vi.fn(async (
      path: string,
      evidence: InitialQualificationPauseEvidence
    ) => {
      qualificationPauses.push({ path, evidence });
    }),
    notifyInitialQualificationPause: vi.fn(),
    now: vi.fn(() => new Date("2026-07-14T00:05:00.000Z"))
  };
  return { deps, events, summaries, qualificationPauses, advisoryRelease, fileClose, fileUnlink };
}

function operationInput(deps: ReturnType<typeof harness>["deps"]) {
  return {
    attemptId: "attempt-staged",
    startedAt: new Date("2026-07-14T00:00:00.000Z"),
    capturedAt: new Date("2026-07-14T00:00:00.000Z"),
    attemptDir: "C:/tmp/staged-crawl-attempts",
    summaryPath: "C:/tmp/staged-crawl-summary.json",
    initialQualificationPausePath: "C:/tmp/staged-initial-qualification-pause.json",
    schedulerOwnsAttempt: false,
    deps
  };
}

describe("staged crawl operational CLI", () => {
  it("accepts only an optional full-plan operator force flag", () => {
    expect(parseStagedCrawlArgs([])).toEqual({ force: false });
    expect(parseStagedCrawlArgs(["--force"])).toEqual({ force: true });
    for (const invalid of ["--help", "--source-id", "--release-candidate-id", "unexpected"]) {
      expect(() => parseStagedCrawlArgs([invalid])).toThrow(/only --force/i);
    }
    expect(() => parseStagedCrawlArgs(["--force", "--force"])).toThrow(/only --force/i);
  });

  it("confines distinct staged evidence paths to the canonical outputs root", () => {
    const cwd = resolve("C:/repo");
    const outputsRoot = resolve(cwd, "outputs");
    const strictAttemptDir = resolve(cwd, "outputs", "crawl-attempts");
    const strictSummaryPath = resolve(cwd, "outputs", "crawl-summary.json");

    const invalid: Array<{ name: string; env: NodeJS.ProcessEnv }> = [
      {
        name: "absolute attempt path outside outputs",
        env: { STAGED_CRAWL_ATTEMPT_DIR: resolve(cwd, "outside", "attempts") }
      },
      {
        name: "absolute summary path outside outputs",
        env: { STAGED_CRAWL_SUMMARY_PATH: resolve(cwd, "outside", "summary.json") }
      },
      {
        name: "absolute qualification pause path outside outputs",
        env: { STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: resolve(cwd, "outside", "pause.json") }
      },
      {
        name: "outputs sibling-prefix path",
        env: { STAGED_CRAWL_ATTEMPT_DIR: resolve(cwd, "outputs-evil", "attempts") }
      },
      {
        name: "dot-dot traversal alias",
        env: { STAGED_CRAWL_SUMMARY_PATH: "outputs/nested/../staged-crawl-summary.json" }
      },
      {
        name: "strict attempt alias",
        env: { STAGED_CRAWL_ATTEMPT_DIR: strictAttemptDir }
      },
      {
        name: "strict summary alias",
        env: { STAGED_CRAWL_SUMMARY_PATH: strictSummaryPath }
      },
      {
        name: "same staged path",
        env: {
          STAGED_CRAWL_ATTEMPT_DIR: resolve(outputsRoot, "same"),
          STAGED_CRAWL_SUMMARY_PATH: resolve(outputsRoot, "same")
        }
      },
      {
        name: "pause path aliases summary",
        env: {
          STAGED_CRAWL_SUMMARY_PATH: resolve(outputsRoot, "same-pause.json"),
          STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: resolve(outputsRoot, "same-pause.json")
        }
      },
      {
        name: "summary nested inside attempt directory",
        env: {
          STAGED_CRAWL_ATTEMPT_DIR: resolve(outputsRoot, "staged"),
          STAGED_CRAWL_SUMMARY_PATH: resolve(outputsRoot, "staged", "summary.json")
        }
      },
      {
        name: "attempt directory nested inside summary path",
        env: {
          STAGED_CRAWL_ATTEMPT_DIR: resolve(outputsRoot, "staged", "attempts"),
          STAGED_CRAWL_SUMMARY_PATH: resolve(outputsRoot, "staged")
        }
      }
    ];

    for (const scenario of invalid) {
      expect(
        () => resolveStagedCrawlEvidencePaths(scenario.env, cwd),
        scenario.name
      ).toThrow(/canonical outputs root|canonical path|separate from strict evidence|overlap/i);
    }

    expect(resolveStagedCrawlEvidencePaths({}, cwd)).toEqual({
      attemptDir: resolve(cwd, "outputs", "staged-crawl-attempts"),
      summaryPath: resolve(cwd, "outputs", "staged-crawl-summary.json"),
      initialQualificationPausePath: resolve(cwd, "outputs", "staged-initial-qualification-pause.json")
    });
    expect(resolveStagedCrawlEvidencePaths({
      STAGED_CRAWL_ATTEMPT_DIR: resolve(outputsRoot, "scheduled", "attempts"),
      STAGED_CRAWL_SUMMARY_PATH: resolve(outputsRoot, "scheduled", "summary.json")
    }, cwd)).toEqual({
      attemptDir: resolve(outputsRoot, "scheduled", "attempts"),
      summaryPath: resolve(outputsRoot, "scheduled", "summary.json"),
      initialQualificationPausePath: resolve(outputsRoot, "staged-initial-qualification-pause.json")
    });
    expect(resolveStagedCrawlEvidencePaths({
      CRAWL_ATTEMPT_DIR: resolve(cwd, "legacy", "attempts"),
      CRAWL_SUMMARY_PATH: resolve(cwd, "legacy", "summary.json")
    }, cwd)).toEqual({
      attemptDir: resolve(outputsRoot, "staged-crawl-attempts"),
      summaryPath: resolve(outputsRoot, "staged-crawl-summary.json"),
      initialQualificationPausePath: resolve(outputsRoot, "staged-initial-qualification-pause.json")
    });
    expect(strictAttemptDir).not.toBe(resolve(cwd, "outputs", "staged-crawl-attempts"));
  });

  it.each(["--help", "--source-id", "--release-candidate-id", "unexpected"]) (
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
      expect(output).toContain("accepts only --force");
      expect(output).not.toMatch(/Prisma|DATABASE_URL|advisory lock|crawl attempt/iu);
    },
    15_000
  );

  it("rejects an unconfined production path before attempt files, locks, or database access", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "p0-staged-path-boundary-"));
    const rogueAttemptDir = resolve(tempDir, "rogue-attempts");
    const safeSummaryPath = resolve(process.cwd(), "outputs", "staged-boundary-summary.json");
    try {
      const result = spawnSync(
        process.execPath,
        [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/p0-staged-crawl.ts"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/invalid",
            P0_CRAWL_ATTEMPT_OWNER: "",
            STAGED_CRAWL_ATTEMPT_DIR: rogueAttemptDir,
            STAGED_CRAWL_SUMMARY_PATH: safeSummaryPath
          }
        }
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(1);
      expect(output).toMatch(/canonical outputs root/i);
      expect(output).not.toMatch(/Prisma|advisory lock|DATABASE_URL/iu);
      expect(existsSync(rogueAttemptDir)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 15_000);

  it.each(["SUCCESS", "INCOMPLETE", "FAILED"] as const)(
    "publishes a staged summary and one truthful terminal event for %s",
    async (status) => {
      const runtime: StagedCrawlRuntime = {
        run: vi.fn(async () => commandResult(status)),
        loadConsecutiveFailuresByCompany: vi.fn(async () => ({ "company-a": status === "SUCCESS" ? 0 : 1 })),
        disconnect: vi.fn(async () => undefined)
      };
      const fixture = harness(runtime);

      const result = await runStagedCrawlOperation(operationInput(fixture.deps));

      const operationalSuccess = status === "SUCCESS";
      expect(result.exitCode).toBe(operationalSuccess ? 0 : 1);
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
        operationalSuccess ? "SUCCESS" : "FAILED"
      ]);
      expect(fixture.events[1]).toMatchObject({
        identity: {
          releaseCandidateId: IDENTITY.releaseCandidateId,
          plannedSourceCount: 2
        },
        failureCode: operationalSuccess ? null : "CRAWL_EXECUTION_FAILED"
      });
      if (operationalSuccess) {
        expect(fixture.events[1]).toMatchObject({
          canonicalSummaryBinding: { batchId: `batch-${status.toLowerCase()}`, summarySha256: "a".repeat(64) }
        });
      } else {
        expect(fixture.events[1]?.canonicalSummaryBinding).toBeNull();
      }
      expect(runtime.disconnect).toHaveBeenCalledOnce();
      expect(fixture.fileClose).toHaveBeenCalledOnce();
      expect(fixture.fileUnlink).toHaveBeenCalledOnce();
      expect(fixture.advisoryRelease).toHaveBeenCalledOnce();
    }
  );

  it("fails closed when an incomplete batch contains an atomic evidence failure", async () => {
    const unsafe = commandResult("INCOMPLETE");
    const runtime: StagedCrawlRuntime = {
      run: vi.fn(async () => ({
        ...unsafe,
        batch: {
          ...unsafe.batch,
          atomicCommittedSourceCount: 0,
          atomicFailedSourceCount: 1
        }
      })),
      loadConsecutiveFailuresByCompany: vi.fn(async () => ({ "company-a": 1 })),
      disconnect: vi.fn(async () => undefined)
    };
    const fixture = harness(runtime);

    const result = await runStagedCrawlOperation(operationInput(fixture.deps));

    expect(result.exitCode).toBe(1);
    expect(fixture.events.at(-1)).toMatchObject({
      state: "FAILED",
      canonicalSummaryBinding: null,
      failureCode: "CRAWL_EXECUTION_FAILED"
    });
  });

  it("emits the below-minimum notification exactly once after the persisted pause decision", async () => {
    const decision = {
      state: "PAUSED_BELOW_MINIMUM" as const,
      completedRoundCount: 2 as const,
      stableCompanyCount: 44,
      minimumStableCompanyCount: 45
    };
    const finalizeInitialQualification = vi.fn(async () => decision);
    const runtime: StagedCrawlRuntime = {
      run: vi.fn(async () => commandResult("SUCCESS")),
      loadConsecutiveFailuresByCompany: vi.fn(async () => ({})),
      finalizeInitialQualification,
      disconnect: vi.fn(async () => undefined)
    };
    const fixture = harness(runtime);

    const result = await runStagedCrawlOperation(operationInput(fixture.deps));

    expect(result.initialQualificationDecision).toEqual(decision);
    expect(result.exitCode).toBe(1);
    expect(finalizeInitialQualification).toHaveBeenCalledOnce();
    expect(fixture.deps.notifyInitialQualificationPause).toHaveBeenCalledOnce();
    expect(fixture.deps.notifyInitialQualificationPause).toHaveBeenCalledWith(
      expect.stringMatching(/PAUSED_BELOW_MINIMUM.*44\/45/i),
      decision
    );
    expect(fixture.qualificationPauses).toHaveLength(1);
    expect(fixture.qualificationPauses[0]).toMatchObject({
      path: "C:/tmp/staged-initial-qualification-pause.json",
      evidence: {
        state: "PAUSED_BELOW_MINIMUM",
        reasonCode: "INITIAL_QUALIFICATION_BELOW_MINIMUM_AFTER_TWO_COMPLETED_ROUNDS",
        releaseCandidateId: IDENTITY.releaseCandidateId,
        batchId: "batch-success",
        canonicalSummarySha256: "a".repeat(64),
        stableCompanyCount: 44,
        minimumStableCompanyCount: 45
      }
    });
    expect(fixture.events.map((event) => event.state)).toEqual(["RUNNING", "PAUSED"]);
    expect(fixture.events.at(-1)).toMatchObject({
      identity: { releaseCandidateId: IDENTITY.releaseCandidateId },
      canonicalSummaryBinding: { batchId: "batch-success", summarySha256: "a".repeat(64) },
      failureCode: null,
      initialQualificationPause: {
        reasonCode: "INITIAL_QUALIFICATION_BELOW_MINIMUM_AFTER_TWO_COMPLETED_ROUNDS",
        stableCompanyCount: 44,
        minimumStableCompanyCount: 45
      }
    });
  });

  it("persists and notifies the second-round pause even when the batch has atomic failures", async () => {
    const decision = {
      state: "PAUSED_BELOW_MINIMUM" as const,
      completedRoundCount: 2 as const,
      stableCompanyCount: 44,
      minimumStableCompanyCount: 45
    };
    const failed = commandResult("FAILED");
    const runtime: StagedCrawlRuntime = {
      run: vi.fn(async () => failed),
      loadConsecutiveFailuresByCompany: vi.fn(async () => ({ "company-a": 2 })),
      finalizeInitialQualification: vi.fn(async () => decision),
      disconnect: vi.fn(async () => undefined)
    };
    const fixture = harness(runtime);

    const result = await runStagedCrawlOperation(operationInput(fixture.deps));

    expect(result.exitCode).toBe(1);
    expect(result.commandResult.batch).toMatchObject({
      status: "FAILED",
      atomicFailedSourceCount: 1,
      failedSourceCount: 1
    });
    expect(fixture.summaries).toHaveLength(1);
    expect(fixture.summaries[0]?.summary).toMatchObject({
      terminalStatus: "FAILED",
      counters: {
        atomicFailedSourceCount: 1,
        failedSourceCount: 1
      }
    });
    expect(fixture.qualificationPauses).toHaveLength(1);
    expect(fixture.qualificationPauses[0]?.evidence).toMatchObject({
      state: "PAUSED_BELOW_MINIMUM",
      releaseCandidateId: IDENTITY.releaseCandidateId,
      batchId: "batch-failed",
      canonicalSummarySha256: "a".repeat(64),
      stableCompanyCount: 44,
      minimumStableCompanyCount: 45
    });
    expect(fixture.events.map((event) => event.state)).toEqual(["RUNNING", "PAUSED"]);
    expect(fixture.events.at(-1)).toMatchObject({
      canonicalSummaryBinding: { batchId: "batch-failed", summarySha256: "a".repeat(64) },
      failureCode: null,
      initialQualificationPause: {
        reasonCode: "INITIAL_QUALIFICATION_BELOW_MINIMUM_AFTER_TWO_COMPLETED_ROUNDS",
        stableCompanyCount: 44,
        minimumStableCompanyCount: 45
      }
    });
    expect(fixture.deps.notifyInitialQualificationPause).toHaveBeenCalledOnce();
    expect(fixture.deps.notifyInitialQualificationPause).toHaveBeenCalledWith(
      expect.stringMatching(/PAUSED_BELOW_MINIMUM.*44\/45/i),
      decision
    );
  });

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
    const pathResolver = readFileSync("src/crawler/stagedCrawlEvidencePaths.ts", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    const compose = readFileSync("ops/docker-compose.yml", "utf8");

    expect(`${script}\n${operational}`).toContain("runCurrentStagedScheduledCrawl");
    expect(operational).toContain("collectConsecutiveSourceResultFailuresByCompany");
    expect(operational).toContain("crawlBatchSourceResult.findMany");
    expect(`${script}\n${operational}`).not.toMatch(/buildDiscoverySourcePlanCandidates|buildSourceCrawlPlans|buildStagedSourceCrawlPlans/u);
    expect(`${script}\n${operational}`).not.toMatch(/--source-id|--release-candidate-id|--commit-sha|--batch-kind/u);
    expect(`${script}\n${operational}`).toContain('"--force"');
    expect(scheduler).toContain('"scripts/p0-staged-crawl.ts"');
    expect(scheduler).toContain("spawnSync(process.execPath,productionTsxProcessArgs");
    expect(scheduler).toContain("resolveStagedCrawlEvidencePaths");
    expect(scheduler.indexOf("resolveStagedCrawlEvidencePaths"))
      .toBeLessThan(scheduler.indexOf("for(;;)"));
    expect(`${scheduler}\n${pathResolver}`).toContain("staged-crawl-attempts");
    expect(`${scheduler}\n${pathResolver}`).toContain("staged-crawl-summary.json");
    expect(scheduler).toMatch(/nextP0SchedulerWindow/);
    expect(scheduler).toMatch(/readLatestCrawlAttemptStartedAt/);
    expect(scheduler).toContain("readInitialQualificationPauseBundle");
    expect(scheduler).toContain("loadProductionStagedMonitoringIdentity");
    expect(scheduler).toContain("loadProductionInitialQualificationPauseCandidateStatus");
    expect(scheduler).toMatch(/if\(qualificationPaused\)\{[\s\S]*await delay\(3_600_000\);[\s\S]*qualificationPaused=await loadQualificationPause\(\);[\s\S]*if\(qualificationPaused\)continue;/u);
    expect(scheduler).toMatch(/terminalState==="PAUSED"/u);
    expect(scheduler).toMatch(/no immediate retry/i);
    expect(scheduler).toContain("60_000");
    expect(packageJson.scripts["p0:staged-crawl"]).toBe("tsx scripts/p0-staged-crawl.ts");
    expect(packageJson.scripts["p0:crawl"]).toBe("tsx scripts/p0-crawl.ts");
    expect(packageJson.scripts["p0:formal-crawl-once"]).toBe("tsx scripts/p0-formal-crawl-once.ts");
    expect(compose.match(/^  scheduler:/gmu)).toHaveLength(1);
    expect(compose).toMatch(/scheduler:[\s\S]*command:\s*\["node",\s*"node_modules\/tsx\/dist\/cli\.mjs",\s*"scripts\/p0-scheduler\.ts"\]/u);
    expect(compose).toContain("STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: /app/outputs/staged-initial-qualification-pause.json");

    const formalOnce = readFileSync("scripts/p0-formal-crawl-once.ts", "utf8");
    expect(formalOnce).toContain('productionTsxProcessArgs("scripts/p0-crawl.ts",["--force"])');
    expect(formalOnce).toContain("spawnSync(process.execPath");
  });
});
