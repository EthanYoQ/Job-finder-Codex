import { describe, expect, it, vi } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies } from "../../src/release/launchManifest";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { RunP0CrawlBatchDeps } from "../../src/crawler/runCrawlBatch";
import {
  deriveCurrentStagedScheduleExpectation,
  STAGED_SCHEDULE_ORACLE_VERSION
} from "../../src/crawler/stagedScheduleAuthority";
import { runCurrentStagedScheduledCrawl } from "../../src/crawler/stagedScheduledCrawl";

const launchCompanies = selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies);
const launchPlans = buildStagedSourceCrawlPlans(launchCompanies);

vi.mock("../../src/readiness/buildIdentity", () => ({
  resolveCurrentBuildIdentity: () => ({
    schemaVersion: 2,
    commitSha: "1".repeat(40),
    sourceTreeSha256: "2".repeat(64),
    runtimeTreeSha256: "3".repeat(64),
    contentSha256: "4".repeat(64)
  })
}));

const BUILD = {
  schemaVersion: 2 as const,
  commitSha: "1".repeat(40),
  sourceTreeSha256: "2".repeat(64),
  runtimeTreeSha256: "3".repeat(64),
  contentSha256: "4".repeat(64)
};

function matchingRow(overrides: Record<string, unknown> = {}) {
  const expected = deriveCurrentStagedScheduleExpectation(BUILD);
  return {
    id: "rc-staged-1",
    status: "BUILDING",
    commitSha: expected.commitSha,
    rosterHash: expected.rosterSha256,
    sourcePlanHash: expected.sourcePlanSha256,
    sourceConfigHash: expected.sourceConfigSha256,
    adapterBundleHash: expected.adapterBundleSha256,
    sourceTreeHash: expected.sourceTreeSha256,
    runtimeTreeHash: expected.runtimeTreeSha256,
    oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION,
    minimumStableCompanyCount: expected.minimumStableCompanyCount,
    ...overrides
  };
}

function matchingScheduledBatch(overrides: Record<string, unknown> = {}) {
  const expected = deriveCurrentStagedScheduleExpectation(BUILD);
  return {
    id: "batch-staged-1",
    releaseCandidateId: "rc-staged-1",
    commitSha: expected.commitSha,
    rosterSha256: expected.rosterSha256,
    sourcePlanSha256: expected.sourcePlanSha256,
    sourceConfigSha256: expected.sourceConfigSha256,
    adapterBundleSha256: expected.adapterBundleSha256,
    kind: "SCHEDULED",
    plannedSourceIds: expected.plannedSourceIds,
    plannedSourceSetSha256: expected.plannedSourceSetSha256,
    plannedSourceCount: expected.plannedSourceCount,
    ownerId: "staged-scheduler",
    status: "SUCCESS",
    finishedAt: new Date("2026-07-14T00:05:00.000Z"),
    ...overrides
  };
}

function failedMixedBatch(plannedSourceCount: number) {
  return {
    status: "FAILED" as const,
    batchId: "batch-1",
    plannedSourceCount,
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
}

describe("current staged scheduled crawl", () => {
  it.each([0, 1])("allows BUILDING initial qualification with %i prior exact scheduled batches", async (batchCount) => {
    const canonicalPlans = launchPlans;
    const syncPlannedSourcesToDb = vi.fn(async () => ({
      companyCount: 60,
      sourceCount: canonicalPlans.length,
      hiddenUnplannedVisibleJobCount: 0
    }));
    const runP0CrawlBatch = vi.fn(async (
      _plans: readonly SourceCrawlPlan[],
      deps: RunP0CrawlBatchDeps
    ) => failedMixedBatch(deps.identity.expectedPlannedSourceCount));

    await runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "BUILDING" })]) },
        crawlBatch: { findMany: vi.fn(async () => Array.from({ length: batchCount }, (_, index) =>
          matchingScheduledBatch({ id: `batch-staged-${index + 1}` }))) }
      } as never,
      fetch: vi.fn(),
      now: new Date("2026-07-14T00:00:00.000Z"),
      force: true,
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(syncPlannedSourcesToDb).toHaveBeenCalledTimes(1);
    expect(runP0CrawlBatch).toHaveBeenCalledTimes(1);
  });

  it("rejects a third BUILDING initial-qualification round before sync, batch creation, or fetch", async () => {
    const syncPlannedSourcesToDb = vi.fn();
    const runP0CrawlBatch = vi.fn();
    const fetch = vi.fn();
    const create = vi.fn();

    await expect(runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "BUILDING" })]) },
        crawlBatch: { findMany: vi.fn(async () => [
          matchingScheduledBatch({ id: "batch-staged-1" }),
          matchingScheduledBatch({ id: "batch-staged-2" })
        ]), create }
      } as never,
      fetch,
      now: new Date("2026-07-14T00:00:00.000Z"),
      force: true,
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(),
      runP0CrawlBatch
    })).rejects.toThrow(/INITIAL_QUALIFICATION_ROUND_LIMIT/i);

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(runP0CrawlBatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not count running or aborted identity-matching rows as completed qualification rounds", async () => {
    const canonicalPlans = launchPlans;
    const runP0CrawlBatch = vi.fn(async (
      _plans: readonly SourceCrawlPlan[],
      deps: RunP0CrawlBatchDeps
    ) => failedMixedBatch(deps.identity.expectedPlannedSourceCount));

    await runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "BUILDING" })]) },
        crawlBatch: { findMany: vi.fn(async () => [
          matchingScheduledBatch({ id: "batch-running", status: "RUNNING", finishedAt: null }),
          matchingScheduledBatch({ id: "batch-aborted", status: "ABORTED" })
        ]) }
      } as never,
      fetch: vi.fn(),
      now: new Date("2026-07-14T00:00:00.000Z"),
      force: true,
      syncPlannedSourcesToDb: vi.fn(async () => ({
        companyCount: 60,
        sourceCount: canonicalPlans.length,
        hiddenUnplannedVisibleJobCount: 0
      })),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(runP0CrawlBatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["terminal without finishedAt", { status: "SUCCESS", finishedAt: null }],
    ["active with finishedAt", { status: "RUNNING", finishedAt: new Date("2026-07-14T00:05:00.000Z") }]
  ])("fails closed for an inconsistent %s qualification row", async (_label, overrides) => {
    await expect(runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "BUILDING" })]) },
        crawlBatch: { findMany: vi.fn(async () => [matchingScheduledBatch(overrides)]) }
      } as never,
      fetch: vi.fn(),
      now: new Date("2026-07-14T00:00:00.000Z"),
      force: true,
      syncPlannedSourcesToDb: vi.fn(),
      createRuntimeDeps: vi.fn(),
      runP0CrawlBatch: vi.fn()
    })).rejects.toThrow(/TERMINAL_STATE_DRIFT/i);
  });

  it.each([
    ["releaseCandidateId", "rc-other"],
    ["commitSha", "9".repeat(40)],
    ["rosterSha256", "9".repeat(64)],
    ["sourcePlanSha256", "9".repeat(64)],
    ["sourceConfigSha256", "9".repeat(64)],
    ["adapterBundleSha256", "9".repeat(64)],
    ["kind", "FULL_RELEASE"],
    ["plannedSourceIds", ["source-drift"]],
    ["plannedSourceSetSha256", "9".repeat(64)],
    ["plannedSourceCount", 1],
    ["ownerId", "other-owner"]
  ])("fails closed when an existing same-RC scheduled batch drifts in %s", async (field, value) => {
    const syncPlannedSourcesToDb = vi.fn();
    const runP0CrawlBatch = vi.fn();
    const fetch = vi.fn();

    await expect(runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "BUILDING" })]) },
        crawlBatch: { findMany: vi.fn(async () => [matchingScheduledBatch({ [field]: value })]) }
      } as never,
      fetch,
      now: new Date("2026-07-14T00:00:00.000Z"),
      force: true,
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(),
      runP0CrawlBatch
    })).rejects.toThrow(/SCHEDULED_BATCH_IDENTITY_DRIFT/i);

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
    expect(runP0CrawlBatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects READY_FOR_QA before sync, batch creation, or fetch", async () => {
    const syncPlannedSourcesToDb = vi.fn();
    const runP0CrawlBatch = vi.fn();
    const fetch = vi.fn();
    const create = vi.fn();

    await expect(runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "READY_FOR_QA" })]) },
        crawlBatch: { findMany: vi.fn(), create }
      } as never,
      fetch,
      now: new Date("2026-07-14T00:00:00.000Z"),
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(),
      runP0CrawlBatch
    })).rejects.toThrow(/READY_FOR_QA.*cannot run|AWAITING_QA/i);

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(runP0CrawlBatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not apply the initial two-round limit after RELEASED", async () => {
    const canonicalPlans = launchPlans;
    const runP0CrawlBatch = vi.fn(async (
      _plans: readonly SourceCrawlPlan[],
      deps: RunP0CrawlBatchDeps
    ) => failedMixedBatch(deps.identity.expectedPlannedSourceCount));

    await runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "RELEASED" })]) },
        crawlBatch: { findMany: vi.fn(async () => Array.from({ length: 3 }, (_, index) =>
          matchingScheduledBatch({ id: `batch-staged-${index + 1}` }))) }
      } as never,
      fetch: vi.fn(),
      now: new Date("2026-07-14T00:00:00.000Z"),
      syncPlannedSourcesToDb: vi.fn(async () => ({
        companyCount: 60,
        sourceCount: canonicalPlans.length,
        hiddenUnplannedVisibleJobCount: 0
      })),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(runP0CrawlBatch).toHaveBeenCalledTimes(1);
  });

  it("still fails closed on historical scheduled-batch identity drift after release", async () => {
    const syncPlannedSourcesToDb = vi.fn();

    await expect(runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow({ status: "RELEASED" })]) },
        crawlBatch: { findMany: vi.fn(async () => [
          matchingScheduledBatch({ sourceConfigSha256: "9".repeat(64) })
        ]) }
      } as never,
      fetch: vi.fn(),
      now: new Date("2026-07-14T00:00:00.000Z"),
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(),
      runP0CrawlBatch: vi.fn()
    })).rejects.toThrow(/SCHEDULED_BATCH_IDENTITY_DRIFT/i);

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
  });

  it("rejects a production-registry mutation before RC read, sync, or fetch", async () => {
    const company = candidateCompanies.find((item) => item.officialWebsiteUrl)!;
    const originalWebsite = company.officialWebsiteUrl!;
    const findMany = vi.fn(async () => [matchingRow()]);
    const syncPlannedSourcesToDb = vi.fn(async () => {
      throw new Error("registry sync was reached");
    });
    const fetch = vi.fn();
    let mutated = false;

    const operation = async () => {
      try {
        company.officialWebsiteUrl = "https://attacker.invalid/company";
        mutated = true;
        return await runCurrentStagedScheduledCrawl({
          db: { releaseCandidate: { findMany } } as never,
          fetch,
          now: new Date("2026-07-14T00:00:00.000Z"),
          syncPlannedSourcesToDb,
          createRuntimeDeps: vi.fn(),
          runP0CrawlBatch: vi.fn()
        });
      } finally {
        if (mutated) company.officialWebsiteUrl = originalWebsite;
      }
    };

    await expect(operation()).rejects.toThrow(/read only|assign|frozen/i);
    expect(findMany).not.toHaveBeenCalled();
    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(company.officialWebsiteUrl).toBe(originalWebsite);
  });

  it.each([
    ["missing", () => []],
    ["duplicate", () => [matchingRow(), { ...matchingRow(), id: "rc-staged-2" }]],
    ["disallowed", () => [{ ...matchingRow(), status: "TRUST_FREEZE" }]],
    ["mismatch", () => [{ ...matchingRow(), sourcePlanHash: "9".repeat(64) }]]
  ])("leaves every mutation and fetch untouched when authority is %s", async (_label, rows) => {
    const syncPlannedSourcesToDb = vi.fn();
    const runP0CrawlBatch = vi.fn();
    const fetch = vi.fn();
    const create = vi.fn();

    await expect(runCurrentStagedScheduledCrawl({
      db: { releaseCandidate: { findMany: vi.fn(async () => rows() as never) }, crawlBatch: { create } } as never,
      fetch,
      now: new Date("2026-07-14T00:00:00.000Z"),
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(),
      runP0CrawlBatch
    })).rejects.toThrow();

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(runP0CrawlBatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("orders authority read before sync and batch with fixed SCHEDULED/no-filter/no-force authority", async () => {
    const calls: string[] = [];
    const canonicalPlans = launchPlans;
    const findMany = vi.fn(async () => {
      calls.push("authority");
      return [matchingRow()];
    });
    const findScheduledBatches = vi.fn(async () => {
      calls.push("round-guard");
      return [];
    });
    const syncPlannedSourcesToDb = vi.fn(async () => {
      calls.push("sync");
      return {
        companyCount: canonicalPlans.length,
        sourceCount: canonicalPlans.length,
        hiddenUnplannedVisibleJobCount: 0
      };
    });
    const runP0CrawlBatch = vi.fn(async (
      _plans: readonly SourceCrawlPlan[],
      deps: RunP0CrawlBatchDeps
    ) => {
      calls.push("batch");
      return failedMixedBatch(deps.identity.expectedPlannedSourceCount);
    });

    const result = await runCurrentStagedScheduledCrawl({
      db: { releaseCandidate: { findMany }, crawlBatch: { findMany: findScheduledBatches } } as never,
      fetch: vi.fn(),
      now: new Date("2026-07-14T00:00:00.000Z"),
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(calls).toEqual(["authority", "round-guard", "sync", "batch"]);
    expect(syncPlannedSourcesToDb).toHaveBeenCalledWith(
      expect.arrayContaining(canonicalPlans),
      expect.arrayContaining(launchCompanies),
      expect.anything()
    );
    const [plans, deps] = vi.mocked(runP0CrawlBatch).mock.calls[0]!;
    expect(plans.map((plan) => plan.source.id)).toEqual(canonicalPlans.map((plan) => plan.source.id).sort());
    expect(deps).toMatchObject({
      force: false,
      identity: {
        releaseCandidateId: "rc-staged-1",
        batchKind: "SCHEDULED",
        ownerId: "staged-scheduler",
        expectedPlannedSourceCount: canonicalPlans.length
      }
    });
    expect(result.batch).toEqual(failedMixedBatch(canonicalPlans.length));
    expect(result.batch.status).toBe("FAILED");
    expect(result.identity).toMatchObject({
      releaseCandidateId: "rc-staged-1",
      batchKind: "SCHEDULED",
      ownerId: "staged-scheduler"
    });
    expect(Object.isFrozen(result.identity)).toBe(true);
    expect(Object.isFrozen(result.identity.expectedPlannedSourceIds)).toBe(true);
  });

  it("allows an operator-forced run only through the same exact staged authority and full plan", async () => {
    const canonicalPlans = launchPlans;
    const runP0CrawlBatch = vi.fn(async (
      _plans: readonly SourceCrawlPlan[],
      deps: RunP0CrawlBatchDeps
    ) => failedMixedBatch(deps.identity.expectedPlannedSourceCount));

    await runCurrentStagedScheduledCrawl({
      db: {
        releaseCandidate: { findMany: vi.fn(async () => [matchingRow()]) },
        crawlBatch: { findMany: vi.fn(async () => []) }
      } as never,
      fetch: vi.fn(),
      now: new Date("2026-07-14T00:00:00.000Z"),
      force: true,
      syncPlannedSourcesToDb: vi.fn(async () => ({
        companyCount: 60,
        sourceCount: canonicalPlans.length,
        hiddenUnplannedVisibleJobCount: 0
      })),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    const [plans, deps] = vi.mocked(runP0CrawlBatch).mock.calls[0]!;
    expect(plans.map((plan) => plan.source.id)).toEqual(canonicalPlans.map((plan) => plan.source.id).sort());
    expect(deps).toMatchObject({
      force: true,
      identity: {
        releaseCandidateId: "rc-staged-1",
        batchKind: "SCHEDULED",
        expectedPlannedSourceCount: canonicalPlans.length
      }
    });
  });
});
