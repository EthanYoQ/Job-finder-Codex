import { describe, expect, it, vi } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { RunP0CrawlBatchDeps } from "../../src/crawler/runCrawlBatch";
import {
  deriveCurrentStagedScheduleExpectation,
  STAGED_SCHEDULE_ORACLE_VERSION
} from "../../src/crawler/stagedScheduleAuthority";
import { runCurrentStagedScheduledCrawl } from "../../src/crawler/stagedScheduledCrawl";

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

function matchingRow() {
  const expected = deriveCurrentStagedScheduleExpectation(BUILD);
  return {
    id: "rc-staged-1",
    status: "READY_FOR_QA",
    commitSha: expected.commitSha,
    rosterHash: expected.rosterSha256,
    sourcePlanHash: expected.sourcePlanSha256,
    sourceConfigHash: expected.sourceConfigSha256,
    adapterBundleHash: expected.adapterBundleSha256,
    sourceTreeHash: expected.sourceTreeSha256,
    runtimeTreeHash: expected.runtimeTreeSha256,
    oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION
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
    const canonicalPlans = buildStagedSourceCrawlPlans(candidateCompanies);
    const findMany = vi.fn(async () => {
      calls.push("authority");
      return [matchingRow()];
    });
    const syncPlannedSourcesToDb = vi.fn(async () => {
      calls.push("sync");
      return { companyCount: 60, sourceCount: canonicalPlans.length, hiddenUnplannedVisibleJobCount: 0 };
    });
    const runP0CrawlBatch = vi.fn(async (
      _plans: readonly SourceCrawlPlan[],
      deps: RunP0CrawlBatchDeps
    ) => {
      calls.push("batch");
      return failedMixedBatch(deps.identity.expectedPlannedSourceCount);
    });

    const result = await runCurrentStagedScheduledCrawl({
      db: { releaseCandidate: { findMany } } as never,
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

    expect(calls).toEqual(["authority", "sync", "batch"]);
    expect(syncPlannedSourcesToDb).toHaveBeenCalledWith(
      expect.arrayContaining(canonicalPlans),
      expect.arrayContaining(candidateCompanies),
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
});
