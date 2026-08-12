import { describe, expect, it, vi } from "vitest";
import {
  createCurrentAuthorityManualSourceBatchExecutor,
  createManualSourceBatchExecutor
} from "../../src/crawler/manualSourceBatchExecutor";
import { hashCanonicalStringSet, type RuntimeBatchIdentity } from "../../src/crawler/runtimeBatchIdentity";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-roche", officialChineseName: "罗氏" },
  source: {
    id: "source-roche-social",
    companyId: "company-roche",
    kind: "SOCIAL",
    atsKind: "PHENOM",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://careers.roche.com/cn/zh/search-results",
    officialChainEvidenceUrl: "https://www.roche.com/careers"
  },
  json: { jobsPath: "jobs", fields: {}, defaultCategory: "其他" }
} as unknown as SourceCrawlPlan;

const baseIdentity: RuntimeBatchIdentity = {
  releaseCandidateId: "rc-1",
  commitSha: "a".repeat(40),
  rosterSha256: "b".repeat(64),
  sourcePlanSha256: "c".repeat(64),
  sourceConfigSha256: "d".repeat(64),
  adapterBundleSha256: "e".repeat(64),
  batchKind: "FULL_RELEASE",
  ownerId: "formal-crawler",
  expectedPlannedSourceIds: ["source-roche-social"],
  expectedPlannedSourceSetSha256: hashCanonicalStringSet(["source-roche-social"]),
  expectedPlannedSourceCount: 1
};

describe("manual source batch executor", () => {
  it("runs exactly one claimed source as forced MANUAL_SOURCE through production batch execution", async () => {
    const runP0CrawlBatch = vi.fn(async () => ({ batchId: "batch-1", status: "SUCCESS" as const }));
    const execute = createManualSourceBatchExecutor({
      plans: [plan],
      baseIdentity,
      db: {} as never,
      fetch: vi.fn() as never,
      runtimeDeps: {
        getPreviousJobs: vi.fn(async () => []),
        getRecentObservations: vi.fn(async () => []),
        isBaselineCompleted: vi.fn(async () => false)
      },
      now: () => new Date("2026-07-13T08:00:00.000Z"),
      runP0CrawlBatch: runP0CrawlBatch as never
    });

    await expect(execute({
      requestId: "request-1", sourceId: "source-roche-social", ownerId: "manual-worker-1"
    })).resolves.toEqual({ batchId: "batch-1", status: "SUCCESS" });

    expect(runP0CrawlBatch).toHaveBeenCalledWith([plan], expect.objectContaining({
      force: true,
      manualRequestFence: { requestId: "request-1", ownerId: "manual-worker-1" },
      identity: expect.objectContaining({
        batchKind: "MANUAL_SOURCE",
        ownerId: "manual-worker-1",
        expectedPlannedSourceIds: ["source-roche-social"],
        expectedPlannedSourceCount: 1,
        expectedPlannedSourceSetSha256: hashCanonicalStringSet(["source-roche-social"])
      })
    }));
  });

  it("fails closed before batch creation when the claimed source has no unique executable plan", async () => {
    const runP0CrawlBatch = vi.fn();
    const execute = createManualSourceBatchExecutor({
      plans: [plan, plan],
      baseIdentity,
      db: {} as never,
      fetch: vi.fn() as never,
      runtimeDeps: {
        getPreviousJobs: vi.fn(async () => []),
        getRecentObservations: vi.fn(async () => []),
        isBaselineCompleted: vi.fn(async () => false)
      },
      now: () => new Date(),
      runP0CrawlBatch: runP0CrawlBatch as never
    });

    await expect(execute({
      requestId: "request-1", sourceId: "source-roche-social", ownerId: "worker-1"
    })).rejects.toThrow("exactly one canonical source plan");
    expect(runP0CrawlBatch).not.toHaveBeenCalled();
  });

  it("re-resolves the release authority before every claimed source execution", async () => {
    const runP0CrawlBatch = vi.fn(async () => ({ batchId: "batch", status: "SUCCESS" as const }));
    const resolveAuthority = vi.fn()
      .mockResolvedValueOnce({ plans: [plan], baseIdentity })
      .mockRejectedValueOnce(new Error("release candidate invalidated"));
    const execute = createCurrentAuthorityManualSourceBatchExecutor({
      resolveAuthority,
      execution: {
        db: {} as never,
        fetch: vi.fn() as never,
        runtimeDeps: {
          getPreviousJobs: vi.fn(async () => []),
          getRecentObservations: vi.fn(async () => []),
          isBaselineCompleted: vi.fn(async () => false)
        },
        now: () => new Date(),
        runP0CrawlBatch: runP0CrawlBatch as never
      }
    });

    await expect(execute({ requestId: "one", sourceId: "source-roche-social", ownerId: "worker" }))
      .resolves.toMatchObject({ status: "SUCCESS" });
    await expect(execute({ requestId: "two", sourceId: "source-roche-social", ownerId: "worker" }))
      .rejects.toThrow("release candidate invalidated");
    expect(resolveAuthority).toHaveBeenCalledTimes(2);
    expect(runP0CrawlBatch).toHaveBeenCalledTimes(1);
  });
});
