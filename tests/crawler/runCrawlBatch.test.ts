import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runP0CrawlBatch } from "../../src/crawler/runCrawlBatch";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { buildSourceCrawlPlans, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import type { JobSnapshot } from "../../src/crawler/lifecycle";
import { candidateCompanies } from "../../src/data/companyRegistry";

const NOW = new Date("2026-07-08T01:00:00.000Z");
const CAPTURED_AT = "2026-07-08T01:05:00.000Z";
const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/crawler/fixtures"
);
const plans = buildSourceCrawlPlans(candidateCompanies);

function readFixture(path: string): string {
  return readFileSync(resolve(fixtureDirectory, path), "utf8");
}

function readJsonFixture(path: string): unknown {
  return JSON.parse(readFixture(path));
}

function planFor(sourceId: string): SourceCrawlPlan {
  const plan = getPlanBySourceId(plans, sourceId);

  if (!plan) {
    throw new Error(`Missing source crawl plan for ${sourceId}`);
  }

  return plan;
}

function makeJob(overrides: Partial<NormalizedJobRecord> = {}): NormalizedJobRecord {
  const sourceJobId = overrides.sourceJobId ?? "existing-job";

  return {
    companyId: "company-test",
    sourceId: "source-novartis-social",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_HTML",
    officialChineseCompanyName: "Test Pharma",
    officialTitle: `Medical role ${sourceJobId}`,
    officialUrl: `https://example.com/jobs/${sourceJobId}`,
    sourceJobId,
    locationRaw: "Shanghai",
    cities: ["Shanghai"],
    category: "医学事务",
    isBaseline: false,
    evidence: {
      officialEntryUrl: "https://example.com/jobs",
      officialChainEvidenceUrl: "https://example.com/careers",
      capturedAt: CAPTURED_AT
    },
    ...overrides
  };
}

function makeSnapshot(
  record: NormalizedJobRecord,
  overrides: Partial<JobSnapshot> = {}
): JobSnapshot {
  return {
    dedupeKey: buildJobDedupeKey(record),
    record,
    lifecycleStatus: "ACTIVE",
    missingSuccessfulCrawlCount: 0,
    firstSeenAt: "2026-07-07T00:00:00.000Z",
    lastSeenAt: "2026-07-07T12:00:00.000Z",
    ...overrides
  };
}

function fakeDb() {
  const calls = {
    batchesCreated: [] as unknown[],
    batchesUpdated: [] as unknown[],
    observations: [] as unknown[],
    jobs: [] as unknown[]
  };

  return {
    calls,
    crawlBatch: {
      create: vi.fn((args: unknown) => {
        calls.batchesCreated.push(args);
        return Promise.resolve({ id: "batch-1" });
      }),
      update: vi.fn((args: unknown) => {
        calls.batchesUpdated.push(args);
        return Promise.resolve(args);
      })
    },
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

describe("runP0CrawlBatch", () => {
  it("skips a source when the current schedule window is not due", async () => {
    const plan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const fetch = vi.fn(async () => ({
      ok: true as const,
      capturedAt: CAPTURED_AT,
      payload: readJsonFixture("astrazeneca-official-json.json")
    }));

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [
        {
          crawledAt: new Date("2026-07-08T00:15:00.000Z"),
          successful: true
        }
      ],
      isBaselineCompleted: async () => true
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
    expect(result).toEqual({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 0,
      successfulSourceCount: 0,
      failedSourceCount: 0,
      skippedSourceCount: 1
    });
    expect(db.calls.batchesCreated).toEqual([
      {
        data: {
          startedAt: NOW,
          status: "SUCCESS"
        }
      }
    ]);
    expect(db.calls.batchesUpdated).toEqual([
      {
        where: { id: "batch-1" },
        data: {
          finishedAt: NOW,
          status: "SUCCESS"
        }
      }
    ]);
  });

  it("runs due sources through fetch, lifecycle, and ingestion upserts", async () => {
    const plan = planFor("source-novartis-social");
    const db = fakeDb();
    const previousJob = makeJob({
      sourceId: plan.source.id,
      atsKind: plan.source.atsKind,
      officialChineseCompanyName: plan.company.officialChineseName,
      sourceJobId: "old-job",
      officialUrl: "https://www.novartis.com/careers/jobs/old-job"
    });
    const fetch = vi.fn(async (receivedPlan: SourceCrawlPlan) => {
      expect(receivedPlan).toBe(plan);
      return {
        ok: true as const,
        capturedAt: CAPTURED_AT,
        html: readFixture("novartis-table.html")
      };
    });

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      getPreviousJobs: async (sourceId: string) =>
        sourceId === plan.source.id ? [makeSnapshot(previousJob)] : [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      successfulSourceCount: 1,
      failedSourceCount: 0,
      skippedSourceCount: 0
    });
    expect(db.calls.observations).toEqual([
      {
        data: {
          sourceId: plan.source.id,
          batchId: "batch-1",
          crawledAt: new Date(CAPTURED_AT),
          successful: true,
          structuredJobCount: 1,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: undefined
        }
      }
    ]);
    expect(db.calls.jobs).toHaveLength(2);
    expect(db.calls.jobs).toContainEqual(
      expect.objectContaining({
        where: {
          sourceId_dedupeKey: {
            sourceId: plan.source.id,
            dedupeKey: `${plan.source.id}:NOV-CN-001`
          }
        },
        create: expect.objectContaining({
          lifecycleStatus: "ACTIVE",
          visibleInFrontend: true,
          isNew: true,
          missingSuccessCount: 0
        }),
        update: expect.objectContaining({
          lifecycleStatus: "ACTIVE",
          visibleInFrontend: true,
          isNew: true,
          missingSuccessCount: 0
        })
      })
    );
    expect(db.calls.jobs).toContainEqual(
      expect.objectContaining({
        where: {
          sourceId_dedupeKey: {
            sourceId: plan.source.id,
            dedupeKey: buildJobDedupeKey(previousJob)
          }
        },
        create: expect.objectContaining({
          lifecycleStatus: "ACTIVE",
          visibleInFrontend: true,
          isNew: false,
          missingSuccessCount: 1
        }),
        update: expect.objectContaining({
          lifecycleStatus: "ACTIVE",
          visibleInFrontend: true,
          isNew: false,
          missingSuccessCount: 1
        })
      })
    );
    expect(db.calls.batchesUpdated).toEqual([
      {
        where: { id: "batch-1" },
        data: {
          finishedAt: NOW,
          status: "SUCCESS"
        }
      }
    ]);
  });

  it("records failed observations without upserting lifecycle job changes", async () => {
    const plan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const previousJob = makeJob({
      sourceId: plan.source.id,
      atsKind: plan.source.atsKind,
      officialChineseCompanyName: plan.company.officialChineseName,
      sourceJobId: "previous-job",
      officialUrl: "https://careers.example.com/jobs/previous-job"
    });
    const fetchFailure = "temporary upstream 503";
    const fetch = vi.fn(async () => ({
      ok: false as const,
      capturedAt: CAPTURED_AT,
      failureReason: fetchFailure
    }));

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      getPreviousJobs: async () => [makeSnapshot(previousJob)],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      successfulSourceCount: 0,
      failedSourceCount: 1,
      skippedSourceCount: 0
    });
    expect(db.calls.observations).toEqual([
      {
        data: {
          sourceId: plan.source.id,
          batchId: "batch-1",
          crawledAt: new Date(CAPTURED_AT),
          successful: false,
          structuredJobCount: 0,
          stableRequiredFields: [],
          failureReason: fetchFailure
        }
      }
    ]);
    expect(db.calls.jobs).toEqual([]);
    expect(db.calls.batchesUpdated).toEqual([
      {
        where: { id: "batch-1" },
        data: {
          finishedAt: NOW,
          status: "FAILED"
        }
      }
    ]);
  });

  it("finalizes the batch as failed when a due source throws during fetch and rethrows the error", async () => {
    const plan = planFor("source-astrazeneca-social");
    const db = fakeDb();
    const fetchError = new Error("network timeout");
    const fetch = vi.fn(async () => {
      throw fetchError;
    });

    await expect(
      runP0CrawlBatch([plan], {
        db,
        fetch,
        now: NOW,
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => true
      })
    ).rejects.toThrow(fetchError);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.calls.observations).toEqual([]);
    expect(db.calls.jobs).toEqual([]);
    expect(db.calls.batchesUpdated).toEqual([
      {
        where: { id: "batch-1" },
        data: {
          finishedAt: NOW,
          status: "FAILED"
        }
      }
    ]);
  });
});
