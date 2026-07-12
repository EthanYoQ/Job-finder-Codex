import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { CandidateCompany } from "../../src/data/companyRegistry";
import { expectedChannelSetHash, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import {
  formatP0CrawlResult,
  parseP0CrawlArgs,
  p0CrawlBatchExitCode,
  runP0CrawlCommand,
  selectP0CrawlPlans
} from "../../src/crawler/p0CrawlCommand";
import type { PrismaIngestionTransactionClient } from "../../src/db/ingestionRepository";

const IDENTITY = {
  releaseCandidateId: "p0-rc-20260710-001",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  rosterSha256: "a".repeat(64),
  sourcePlanSha256: "b".repeat(64),
  sourceConfigSha256: "c".repeat(64),
  adapterBundleSha256: "d".repeat(64),
  batchKind: "SCHEDULED" as const,
  ownerId: "phase1-task4-test",
  expectedPlannedSourceIds: ["source-test-social"],
  expectedPlannedSourceSetSha256: createHash("sha256")
    .update(JSON.stringify(["source-test-social"]), "utf8")
    .digest("hex"),
  expectedPlannedSourceCount: 1
};

function fakeTransaction() {
  return async <T>(
    operation: (transaction: PrismaIngestionTransactionClient) => Promise<T>
  ): Promise<T> =>
    operation({
      crawlObservation: { create: vi.fn() },
      job: { upsert: vi.fn() }
    });
}

const planChannels = [{ channelId: "source:source-test-social:default", kind: "SOCIAL" as const }];
const plan = {
  adapterId: "official-json",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    surfaceId: "surface-test-social",
    officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  },
  expectedChannels: planChannels,
  expectedChannelSetHash: expectedChannelSetHash(planChannels)
} satisfies SourceCrawlPlan;

const company = {
  id: "company-test",
  officialChineseName: "测试药企",
  officialWebsiteUrl: "https://example.com",
  pinyinName: "ceshi",
  category: "FOREIGN_PHARMA",
      targetStatus: "ACTIVE",
  sources: []
} satisfies CandidateCompany;

const otherPlan = {
  ...plan,
  company: { id: "company-other", officialChineseName: "另一家药企" },
  source: {
    ...plan.source,
    id: "source-other-social",
    companyId: "company-other"
  },
  expectedChannels: [{ channelId: "source:source-other-social:default", kind: "SOCIAL" as const }],
  expectedChannelSetHash: expectedChannelSetHash([{ channelId: "source:source-other-social:default", kind: "SOCIAL" as const }])
} satisfies SourceCrawlPlan;

const otherCompany = {
  ...company,
  id: "company-other",
  officialChineseName: "另一家药企",
  pinyinName: "lingyijia"
} satisfies CandidateCompany;

describe("P0 crawl command", () => {
  it("ignores caller-injected membership deps and fails closed without startup authority", async () => {
    const syncPlannedSourcesToDb = vi.fn();
    await expect(runP0CrawlCommand({ plans: [plan], companies: [company],
      options: { help: false, sourceIds: [] }, identity: { ...IDENTITY, batchKind: "FULL_RELEASE" },
      authoritativeReleaseMembership: {} as never, db: {} as never, fetch: vi.fn(),
      now: new Date("2026-07-10T00:00:00Z"), syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(), runP0CrawlBatch: vi.fn() } as never))
      .rejects.toThrow("startup membership authority");
    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
  });
  it("rejects missing runtime identity before registry sync", async () => {
    const syncPlannedSourcesToDb = vi.fn();

    await expect(
      runP0CrawlCommand({
        plans: [plan],
        companies: [company],
        options: { help: false, sourceIds: [] },
        db: {} as never,
        fetch: vi.fn(),
        now: () => new Date("2026-07-08T08:00:00.000Z"),
        syncPlannedSourcesToDb,
        createRuntimeDeps: vi.fn(),
        runP0CrawlBatch: vi.fn()
      } as never)
    ).rejects.toThrow("runtime identity");

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
  });

  it("rejects partial FULL_RELEASE selection before registry sync", async () => {
    const syncPlannedSourcesToDb = vi.fn();

    await expect(
      runP0CrawlCommand({
        plans: [plan, otherPlan],
        companies: [company, otherCompany],
        options: { help: false, sourceIds: [plan.source.id] },
        identity: { ...IDENTITY, batchKind: "FULL_RELEASE" },
        db: {} as never,
        fetch: vi.fn(),
        now: () => new Date("2026-07-08T08:00:00.000Z"),
        syncPlannedSourcesToDb,
        createRuntimeDeps: vi.fn(),
        runP0CrawlBatch: vi.fn()
      } as never)
    ).rejects.toThrow("FULL_RELEASE");

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
  });

  it("rejects prefiltered FULL_RELEASE plans against the separate authoritative set before sync", async () => {
    const expectedIds = [plan.source.id, otherPlan.source.id].sort();
    const syncPlannedSourcesToDb = vi.fn();

    await expect(
      runP0CrawlCommand({
        plans: [plan],
        companies: [company],
        options: { help: false, sourceIds: [] },
        identity: {
          ...IDENTITY,
          batchKind: "FULL_RELEASE",
          expectedPlannedSourceIds: expectedIds,
          expectedPlannedSourceSetSha256: createHash("sha256")
            .update(JSON.stringify(expectedIds), "utf8")
            .digest("hex"),
          expectedPlannedSourceCount: 2
        },
        db: {} as never,
        fetch: vi.fn(),
        now: () => new Date("2026-07-08T08:00:00.000Z"),
        syncPlannedSourcesToDb,
        createRuntimeDeps: vi.fn(),
        runP0CrawlBatch: vi.fn()
      })
    ).rejects.toThrow("planned source");

    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
  });

  it.each([
    ["unbound", ({ expectedChannels: _channels, expectedChannelSetHash: _hash, ...rest }: SourceCrawlPlan) => rest],
    ["hash mismatch", (value: SourceCrawlPlan) => ({ ...value, expectedChannelSetHash: "0".repeat(64) })],
    ["noncanonical", (value: SourceCrawlPlan) => ({ ...value, expectedChannels: [
      { channelId: "z", kind: "SOCIAL" as const }, { channelId: "a", kind: "SOCIAL" as const }
    ], expectedChannelSetHash: expectedChannelSetHash([
      { channelId: "z", kind: "SOCIAL" as const }, { channelId: "a", kind: "SOCIAL" as const }
    ]) })],
    ["missing", (value: SourceCrawlPlan) => ({ ...value, expectedChannels: [] })],
    ["extra", (value: SourceCrawlPlan) => ({ ...value, expectedChannels: [...value.expectedChannels!, { channelId: "extra", kind: "SOCIAL" as const }] })],
    ["replacement", (value: SourceCrawlPlan) => ({ ...value, expectedChannels: [{ channelId: "replacement", kind: "SOCIAL" as const }] })],
    ["duplicate", (value: SourceCrawlPlan) => ({ ...value, expectedChannels: [value.expectedChannels![0]!, value.expectedChannels![0]!] })],
    ["adapter mismatch", (value: SourceCrawlPlan) => ({ ...value, adapterId: "html-table", table: { rowSelector: "x", fields: { officialTitle: { value: "x" }, officialUrl: { value: "https://example.com" }, locationRaw: { value: "x" } } } })]
  ])("rejects %s channel plan before every side effect", async (_label, mutate) => {
    const unsafe = mutate(plan) as SourceCrawlPlan;
    const syncPlannedSourcesToDb = vi.fn();
    const runP0CrawlBatch = vi.fn();
    const fetch = vi.fn();
    const db = { crawlBatch: { create: vi.fn() } };
    await expect(runP0CrawlCommand({
      plans: [unsafe], companies: [company], options: { help: false, sourceIds: [] },
      identity: IDENTITY, db: db as never, fetch, now: new Date("2026-07-10T00:00:00Z"),
      syncPlannedSourcesToDb, createRuntimeDeps: vi.fn(), runP0CrawlBatch
    })).rejects.toThrow();
    expect(syncPlannedSourcesToDb).not.toHaveBeenCalled();
    expect(db.crawlBatch.create).not.toHaveBeenCalled();
    expect(runP0CrawlBatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses help and source filters", () => {
    expect(parseP0CrawlArgs(["--help"])).toEqual({ help: true, sourceIds: [] });
    expect(parseP0CrawlArgs(["--source-id", "source-test-social"])).toEqual({
      help: false,
      sourceIds: ["source-test-social"],
      force: false
    });
    expect(parseP0CrawlArgs(["--source-id", "source-test-social", "--force"])).toEqual({
      help: false,
      sourceIds: ["source-test-social"],
      force: true
    });
    expect(() => parseP0CrawlArgs(["--source-id"])).toThrow("--source-id requires a value");
  });

  it("selects requested plans and rejects unknown source ids", () => {
    expect(selectP0CrawlPlans([plan], { help: false, sourceIds: [] })).toEqual([plan]);
    expect(selectP0CrawlPlans([plan], { help: false, sourceIds: ["source-test-social"] })).toEqual([plan]);
    expect(() =>
      selectP0CrawlPlans([plan], { help: false, sourceIds: ["missing-source"] })
    ).toThrow("Unknown source id: missing-source");
  });

  it("syncs planned sources before running the batch", async () => {
    const calls: string[] = [];
    const db = {
      $transaction: fakeTransaction(),
      company: {
        findMany: vi.fn(),
        upsert: vi.fn()
      },
      recruitmentSource: {
        findMany: vi.fn(),
        upsert: vi.fn()
      },
      job: {
        findMany: vi.fn(),
        upsert: vi.fn(),
        updateMany: vi.fn()
      },
      crawlObservation: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn()
      },
      crawlBatch: {
        create: vi.fn(),
        update: vi.fn()
      }
    };
    const result = await runP0CrawlCommand({
      plans: [plan],
      companies: [company],
      options: { help: false, sourceIds: [] },
      identity: IDENTITY,
      db,
      fetch: vi.fn(),
      now: () => new Date("2026-07-08T08:00:00.000Z"),
      syncPlannedSourcesToDb: vi.fn(async () => {
        calls.push("sync");
        return { companyCount: 1, sourceCount: 1, hiddenUnplannedVisibleJobCount: 3 };
      }),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch: vi.fn(async () => {
        calls.push("batch");
        return {
          status: "SUCCESS" as const,
          batchId: "batch-1",
          plannedSourceCount: 1,
          dueSourceCount: 1,
          transportSuccessfulSourceCount: 1,
          transportFailedSourceCount: 0,
          adapterSuccessfulSourceCount: 1,
          adapterFailedSourceCount: 0,
          completenessVerifiedSourceCount: 1,
          completenessIncompleteSourceCount: 0,
          atomicCommittedSourceCount: 1,
          atomicFailedSourceCount: 0,
          successfulSourceCount: 1,
          failedSourceCount: 0,
          blockedSourceCount: 0,
          skippedSourceCount: 0
        };
      })
    });

    expect(calls).toEqual(["sync", "batch"]);
    expect(result).toMatchObject({
      syncedCompanyCount: 1,
      syncedSourceCount: 1,
      hiddenUnplannedVisibleJobCount: 3,
      batch: {
        batchId: "batch-1",
        plannedSourceCount: 1,
        dueSourceCount: 1,
        adapterSuccessfulSourceCount: 1,
        successfulSourceCount: 1,
        failedSourceCount: 0,
        skippedSourceCount: 0
      }
    });
    expect(formatP0CrawlResult(result)).toContain("Strict successful sources: 1");
    expect(formatP0CrawlResult(result)).toContain("Completeness verified sources: 1");
    expect(formatP0CrawlResult(result)).toContain("Hidden unplanned visible jobs: 3");
  });

  it("does not hide legacy unplanned jobs when the batch fails", async () => {
    const updateMany = vi.fn();
    await expect(runP0CrawlCommand({
      plans: [plan], companies: [company], options: { help: false, sourceIds: [] }, identity: IDENTITY,
      db: { job: { updateMany } } as never, fetch: vi.fn(), now: new Date("2026-07-10T00:00:00Z"),
      syncPlannedSourcesToDb: vi.fn(async () => ({ companyCount: 1, sourceCount: 1,
        hiddenUnplannedVisibleJobCount: 0 })),
      createRuntimeDeps: vi.fn(() => ({ getPreviousJobs: async () => [],
        getRecentObservations: async () => [], isBaselineCompleted: async () => false })),
      runP0CrawlBatch: vi.fn(async () => { throw new Error("batch failed"); })
    })).rejects.toThrow("batch failed");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("parses force and passes it into the batch runner", async () => {
    expect(parseP0CrawlArgs(["--source-id", "source-test-social", "--force"])).toEqual({
      help: false,
      sourceIds: ["source-test-social"],
      force: true
    });

    const runP0CrawlBatch = vi.fn(async () => ({
      status: "SUCCESS" as const,
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      transportSuccessfulSourceCount: 1,
      transportFailedSourceCount: 0,
      adapterSuccessfulSourceCount: 1,
      adapterFailedSourceCount: 0,
      completenessVerifiedSourceCount: 1,
      completenessIncompleteSourceCount: 0,
      atomicCommittedSourceCount: 1,
      atomicFailedSourceCount: 0,
      successfulSourceCount: 1,
      failedSourceCount: 0,
      blockedSourceCount: 0,
      skippedSourceCount: 0
    }));

    await runP0CrawlCommand({
      plans: [plan],
      companies: [company],
      options: { help: false, sourceIds: [], force: true },
      identity: IDENTITY,
      db: {
        $transaction: fakeTransaction(),
        company: { findMany: vi.fn(), upsert: vi.fn() },
        recruitmentSource: { findMany: vi.fn(), upsert: vi.fn() },
        job: { findMany: vi.fn() },
        crawlObservation: { findMany: vi.fn(), findFirst: vi.fn() },
        crawlBatch: { create: vi.fn(), update: vi.fn() }
      },
      fetch: vi.fn(),
      now: () => new Date("2026-07-08T08:00:00.000Z"),
      syncPlannedSourcesToDb: vi.fn(async () => ({
        companyCount: 1,
        sourceCount: 1,
        hiddenUnplannedVisibleJobCount: 0
      })),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(runP0CrawlBatch).toHaveBeenCalledWith([plan], expect.objectContaining({ force: true }));
  });

  it("syncs all planned sources even when running a selected source", async () => {
    const syncPlannedSourcesToDb = vi.fn(async () => ({
      companyCount: 2,
      sourceCount: 2,
      hiddenUnplannedVisibleJobCount: 0
    }));
    const runP0CrawlBatch = vi.fn(async () => ({
      status: "SUCCESS" as const,
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      transportSuccessfulSourceCount: 1,
      transportFailedSourceCount: 0,
      adapterSuccessfulSourceCount: 1,
      adapterFailedSourceCount: 0,
      completenessVerifiedSourceCount: 1,
      completenessIncompleteSourceCount: 0,
      atomicCommittedSourceCount: 1,
      atomicFailedSourceCount: 0,
      successfulSourceCount: 1,
      failedSourceCount: 0,
      blockedSourceCount: 0,
      skippedSourceCount: 0
    }));

    const result = await runP0CrawlCommand({
      plans: [plan, otherPlan],
      companies: [company, otherCompany],
      options: { help: false, sourceIds: ["source-test-social"], force: true },
      identity: { ...IDENTITY, batchKind: "MANUAL_SOURCE" },
      db: {
        $transaction: fakeTransaction(),
        company: { findMany: vi.fn(), upsert: vi.fn() },
        recruitmentSource: { findMany: vi.fn(), upsert: vi.fn() },
        job: { findMany: vi.fn() },
        crawlObservation: { findMany: vi.fn(), findFirst: vi.fn() },
        crawlBatch: { create: vi.fn(), update: vi.fn() }
      },
      fetch: vi.fn(),
      now: () => new Date("2026-07-08T08:00:00.000Z"),
      syncPlannedSourcesToDb,
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(syncPlannedSourcesToDb).toHaveBeenCalledWith(
      [plan, otherPlan],
      [company, otherCompany],
      expect.anything()
    );
    expect(runP0CrawlBatch).toHaveBeenCalledWith([plan], expect.objectContaining({ force: true }));
    expect(result.syncedSourceCount).toBe(2);
  });
});

describe("P0 crawl CLI exit code", () => {
  const completeBatch = {
    status: "SUCCESS" as const,
    batchId: "batch-1",
    plannedSourceCount: 1,
    dueSourceCount: 1,
    transportSuccessfulSourceCount: 1,
    transportFailedSourceCount: 0,
    adapterSuccessfulSourceCount: 1,
    adapterFailedSourceCount: 0,
    completenessVerifiedSourceCount: 1,
    completenessIncompleteSourceCount: 0,
    atomicCommittedSourceCount: 1,
    atomicFailedSourceCount: 0,
    successfulSourceCount: 1,
    failedSourceCount: 0,
    blockedSourceCount: 0,
    skippedSourceCount: 0
  };

  it.each([
    {
      name: "strict SUCCESS",
      batch: completeBatch,
      expected: 0
    },
    {
      name: "blocked completeness-incomplete batch with no failed sources",
      batch: {
        ...completeBatch,
        status: "INCOMPLETE" as const,
        completenessVerifiedSourceCount: 0,
        completenessIncompleteSourceCount: 1,
        successfulSourceCount: 0,
        blockedSourceCount: 1
      },
      expected: 1
    },
    {
      name: "skipped incomplete batch with no failed sources",
      batch: {
        ...completeBatch,
        status: "INCOMPLETE" as const,
        dueSourceCount: 0,
        transportSuccessfulSourceCount: 0,
        adapterSuccessfulSourceCount: 0,
        completenessVerifiedSourceCount: 0,
        atomicCommittedSourceCount: 0,
        successfulSourceCount: 0,
        skippedSourceCount: 1
      },
      expected: 1
    },
    {
      name: "atomically failed batch",
      batch: {
        ...completeBatch,
        status: "FAILED" as const,
        atomicCommittedSourceCount: 0,
        atomicFailedSourceCount: 1,
        successfulSourceCount: 0,
        failedSourceCount: 1
      },
      expected: 1
    }
  ])("returns $expected for $name", ({ batch, expected }) => {
    expect(p0CrawlBatchExitCode(batch)).toBe(expected);
  });
});
