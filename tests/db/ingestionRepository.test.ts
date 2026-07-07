import { describe, expect, it, vi } from "vitest";
import {
  executeIngestionCommands,
  type PrismaIngestionDb
} from "../../src/db/ingestionRepository";
import type { IngestionCommand } from "../../src/crawler/ingestion";

function fakeDb(): PrismaIngestionDb & {
  calls: { observations: unknown[]; jobs: unknown[] };
} {
  const calls = { observations: [] as unknown[], jobs: [] as unknown[] };

  return {
    calls,
    crawlObservation: {
      create: vi.fn((args: unknown) => {
        calls.observations.push(args);
        return Promise.resolve(args);
      })
    },
    job: {
      upsert: vi.fn((args: unknown) => {
        calls.jobs.push(args);
        return Promise.resolve(args);
      })
    }
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
    structuredJobCount: 1
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

describe("executeIngestionCommands", () => {
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
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: undefined
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
