import { describe, expect, it, vi } from "vitest";
import {
  executeIngestionCommands,
  type PrismaIngestionDb
} from "../../src/db/ingestionRepository";
import type { IngestionCommand } from "../../src/crawler/ingestion";

function fakeDb(): PrismaIngestionDb & {
  calls: { transactions: number; observations: unknown[]; jobs: unknown[] };
} {
  const calls = {
    transactions: 0,
    observations: [] as unknown[],
    jobs: [] as unknown[]
  };

  return {
    calls,
    $transaction: vi.fn(async (operation) => {
      calls.transactions += 1;
      const pending = { observations: [] as unknown[], jobs: [] as unknown[] };
      const result = await operation({
        crawlObservation: {
          create: vi.fn(async (args: unknown) => {
            pending.observations.push(args);
            return args;
          })
        },
        job: {
          upsert: vi.fn(async (args: unknown) => {
            pending.jobs.push(args);
            return args;
          })
        }
      });

      calls.observations.push(...pending.observations);
      calls.jobs.push(...pending.jobs);
      return result;
    })
  };
}

function failingDb(failure: { observation?: boolean; jobNumber?: number }): PrismaIngestionDb & {
  calls: { transactions: number; observations: unknown[]; jobs: unknown[] };
} {
  const calls = {
    transactions: 0,
    observations: [] as unknown[],
    jobs: [] as unknown[]
  };

  return {
    calls,
    $transaction: vi.fn(async (operation) => {
      calls.transactions += 1;
      const pending = { observations: [] as unknown[], jobs: [] as unknown[] };
      let jobNumber = 0;
      const result = await operation({
        crawlObservation: {
          create: vi.fn(async (args: unknown) => {
            if (failure.observation) {
              throw new Error("injected observation failure");
            }
            pending.observations.push(args);
            return args;
          })
        },
        job: {
          upsert: vi.fn(async (args: unknown) => {
            jobNumber += 1;
            if (failure.jobNumber === jobNumber) {
              throw new Error(`injected job failure ${jobNumber}`);
            }
            pending.jobs.push(args);
            return args;
          })
        }
      });

      calls.observations.push(...pending.observations);
      calls.jobs.push(...pending.jobs);
      return result;
    })
  };
}

const observationCommand: IngestionCommand = {
  type: "UPSERT_CRAWL_OBSERVATION",
  observation: {
    id: "obs-1",
    sourceId: "source-1",
    crawledAt: new Date("2026-07-08T00:00:00.000Z"),
    successful: true,
    stableRequiredFields: ["company", "title", "officialUrl", "location"],
    structuredJobCount: 1,
    expectedJobCount: 283,
    completenessStatus: "INCOMPLETE",
    completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
    completenessEvidenceUrl: "https://example.com/jobs",
    completenessBlockerReason: "Fetched 1 of official total 283",
    totalPages: 19,
    pageSize: 15,
    pagesVisited: 1
  }
};

const jobCommand: IngestionCommand = {
  type: "UPSERT_JOB",
  dedupeKey: "source-1:job-1",
  lifecycleStatus: "ACTIVE",
  visibleInFrontend: true,
  isNew: false,
  firstSeenAt: "2026-07-08T00:00:00.000Z",
  lastSeenAt: "2026-07-08T00:00:00.000Z",
  missingSuccessfulCrawlCount: 0,
  record: {
    companyId: "company-1",
    sourceId: "source-1",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialChineseCompanyName: "测试药企",
    officialTitle: "Regional Sales Manager",
    auxiliaryChineseTitle: "区域销售经理",
    officialUrl: "https://example.com/jobs/1",
    listUrl: "https://example.com/jobs",
    sourceJobId: "job-1",
    locationRaw: "北京/上海",
    cities: ["北京", "上海"],
    category: "销售",
    officialPublishedAt: "2026-07-07T00:00:00.000Z",
    isBaseline: true,
    evidence: {
      officialEntryUrl: "https://example.com/careers",
      officialChainEvidenceUrl: "https://example.com",
      capturedAt: "2026-07-08T00:00:00.000Z"
    }
  }
};

function jobCommandWithId(id: string): IngestionCommand {
  if (jobCommand.type !== "UPSERT_JOB") {
    throw new Error("Expected job command fixture");
  }

  return {
    ...jobCommand,
    dedupeKey: `source-1:${id}`,
    record: {
      ...jobCommand.record,
      sourceJobId: id,
      officialTitle: `Role ${id}`,
      officialUrl: `https://example.com/jobs/${id}`
    }
  };
}

describe("executeIngestionCommands", () => {
  it("rolls back every write when observation creation fails", async () => {
    const db = failingDb({ observation: true });

    await expect(
      executeIngestionCommands(
        [observationCommand, jobCommandWithId("job-1")],
        { batchId: "batch-1" },
        db
      )
    ).rejects.toThrow("injected observation failure");

    expect(db.calls.transactions).toBe(1);
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
  });

  it("rolls back the observation and partial job set when a middle job upsert fails", async () => {
    const db = failingDb({ jobNumber: 2 });

    await expect(
      executeIngestionCommands(
        [
          observationCommand,
          jobCommandWithId("job-1"),
          jobCommandWithId("job-2"),
          jobCommandWithId("job-3")
        ],
        { batchId: "batch-1" },
        db
      )
    ).rejects.toThrow("injected job failure 2");

    expect(db.calls.transactions).toBe(1);
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
  });

  it("rolls back all earlier writes when a later lifecycle job upsert fails", async () => {
    const db = failingDb({ jobNumber: 3 });

    await expect(
      executeIngestionCommands(
        [
          observationCommand,
          jobCommandWithId("job-1"),
          jobCommandWithId("job-2"),
          jobCommandWithId("job-3")
        ],
        { batchId: "batch-1" },
        db
      )
    ).rejects.toThrow("injected job failure 3");

    expect(db.calls.transactions).toBe(1);
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
  });

  it("commits one observation and every job exactly once in one transaction", async () => {
    const db = fakeDb();

    await executeIngestionCommands(
      [
        observationCommand,
        jobCommandWithId("job-1"),
        jobCommandWithId("job-2"),
        jobCommandWithId("job-3")
      ],
      { batchId: "batch-1" },
      db
    );

    expect(db.calls.transactions).toBe(1);
    expect(db.calls.observations).toHaveLength(1);
    expect(db.calls.jobs).toHaveLength(3);
    expect(
      db.calls.jobs.map(
        (args) =>
          (args as { where: { sourceId_dedupeKey: { dedupeKey: string } } }).where
            .sourceId_dedupeKey.dedupeKey
      )
    ).toEqual(["source-1:job-1", "source-1:job-2", "source-1:job-3"]);
  });

  it("creates crawl observations with batch context and mapped stable fields", async () => {
    const db = fakeDb();

    await executeIngestionCommands([observationCommand], { batchId: "batch-1" }, db);

    expect(db.calls.observations).toEqual([
      {
        data: {
          sourceId: "source-1",
          batchId: "batch-1",
          crawledAt: new Date("2026-07-08T00:00:00.000Z"),
          successful: true,
          structuredJobCount: 1,
          expectedJobCount: 283,
          completenessStatus: "INCOMPLETE",
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: "https://example.com/jobs",
          completenessBlockerReason: "Fetched 1 of official total 283",
          totalPages: 19,
          pageSize: 15,
          pagesVisited: 1,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: null
        }
      }
    ]);
  });

  it("upserts jobs with official links, all cities, visibility, and new-label state", async () => {
    const db = fakeDb();

    await executeIngestionCommands([jobCommand], { batchId: "batch-1" }, db);

    expect(db.calls.jobs).toHaveLength(1);
    expect(db.calls.jobs[0]).toMatchObject({
      where: { sourceId_dedupeKey: { sourceId: "source-1", dedupeKey: "source-1:job-1" } },
      create: {
        companyId: "company-1",
        sourceId: "source-1",
        dedupeKey: "source-1:job-1",
        officialTitle: "Regional Sales Manager",
        auxiliaryChineseTitle: "区域销售经理",
        officialUrl: "https://example.com/jobs/1",
        listUrl: "https://example.com/jobs",
        locationRaw: "北京/上海",
        city: "北京",
        cities: ["北京", "上海"],
        category: "SALES",
        lifecycleStatus: "ACTIVE",
        visibleInFrontend: true,
        isNew: false
      },
      update: {
        lastSeenAt: new Date("2026-07-08T00:00:00.000Z"),
        missingSuccessCount: 0,
        lifecycleStatus: "ACTIVE",
        visibleInFrontend: true,
        isNew: false
      }
    });
  });
});
