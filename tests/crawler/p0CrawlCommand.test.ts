import { describe, expect, it, vi } from "vitest";
import type { CandidateCompany } from "../../src/data/companyRegistry";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import {
  formatP0CrawlResult,
  parseP0CrawlArgs,
  runP0CrawlCommand,
  selectP0CrawlPlans
} from "../../src/crawler/p0CrawlCommand";

const plan = {
  adapterId: "official-json",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
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
  }
} satisfies SourceCrawlPlan;

const company = {
  id: "company-test",
  officialChineseName: "测试药企",
  officialWebsiteUrl: "https://example.com",
  pinyinName: "ceshi",
  inclusionReason: "测试",
  sources: []
} satisfies CandidateCompany;

describe("P0 crawl command", () => {
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
      company: {
        upsert: vi.fn()
      },
      recruitmentSource: {
        upsert: vi.fn()
      },
      job: {
        findMany: vi.fn(),
        upsert: vi.fn()
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
      db,
      fetch: vi.fn(),
      now: () => new Date("2026-07-08T08:00:00.000Z"),
      syncPlannedSourcesToDb: vi.fn(async () => {
        calls.push("sync");
        return { companyCount: 1, sourceCount: 1 };
      }),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch: vi.fn(async () => {
        calls.push("batch");
        return {
          batchId: "batch-1",
          plannedSourceCount: 1,
          dueSourceCount: 1,
          successfulSourceCount: 1,
          failedSourceCount: 0,
          skippedSourceCount: 0
        };
      })
    });

    expect(calls).toEqual(["sync", "batch"]);
    expect(result).toEqual({
      syncedCompanyCount: 1,
      syncedSourceCount: 1,
      batch: {
        batchId: "batch-1",
        plannedSourceCount: 1,
        dueSourceCount: 1,
        successfulSourceCount: 1,
        failedSourceCount: 0,
        skippedSourceCount: 0
      }
    });
    expect(formatP0CrawlResult(result)).toContain("Successful sources: 1");
  });

  it("parses force and passes it into the batch runner", async () => {
    expect(parseP0CrawlArgs(["--source-id", "source-test-social", "--force"])).toEqual({
      help: false,
      sourceIds: ["source-test-social"],
      force: true
    });

    const runP0CrawlBatch = vi.fn(async () => ({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      successfulSourceCount: 1,
      failedSourceCount: 0,
      skippedSourceCount: 0
    }));

    await runP0CrawlCommand({
      plans: [plan],
      companies: [company],
      options: { help: false, sourceIds: [], force: true },
      db: {
        company: { upsert: vi.fn() },
        recruitmentSource: { upsert: vi.fn() },
        job: { findMany: vi.fn(), upsert: vi.fn() },
        crawlObservation: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        crawlBatch: { create: vi.fn(), update: vi.fn() }
      },
      fetch: vi.fn(),
      now: () => new Date("2026-07-08T08:00:00.000Z"),
      syncPlannedSourcesToDb: vi.fn(async () => ({ companyCount: 1, sourceCount: 1 })),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(runP0CrawlBatch).toHaveBeenCalledWith([plan], expect.objectContaining({ force: true }));
  });
});
