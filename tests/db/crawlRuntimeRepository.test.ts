import { describe, expect, it, vi } from "vitest";
import { createPrismaCrawlRuntimeDeps } from "../../src/db/crawlRuntimeRepository";
import type {
  PersistedCrawlObservationRow,
  PersistedJobRow
} from "../../src/db/crawlStateRepository";

const fakeJobRows: PersistedJobRow[] = [
  {
    dedupeKey: "source-test-social:job-1",
    companyId: "company-test",
    sourceId: "source-test-social",
    sourceJobId: "job-1",
    officialTitle: "医学信息沟通专员",
    auxiliaryChineseTitle: null,
    officialUrl: "https://example.com/jobs/job-1",
    listUrl: null,
    locationRaw: "北京",
    city: "北京",
    cities: ["北京"],
    category: "SALES",
    officialPublishedAt: null,
    firstSeenAt: new Date("2026-07-07T08:00:00.000Z"),
    lastSeenAt: new Date("2026-07-08T08:00:00.000Z"),
    missingSuccessCount: 0,
    lifecycleStatus: "ACTIVE",
    source: {
      atsKind: "MOKA",
      kind: "SOCIAL",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
      officialChainEvidenceUrl: "https://example.com/careers"
    },
    company: {
      officialChineseName: "测试药企"
    }
  }
];

const fakeCrawlObservations: PersistedCrawlObservationRow[] = [
  {
    crawledAt: new Date("2026-07-08T20:00:00.000Z"),
    successful: false
  },
  {
    crawledAt: new Date("2026-07-08T08:00:00.000Z"),
    successful: true
  }
];

function fakeDb() {
  return {
    job: {
      findMany: vi.fn(async () => fakeJobRows)
    },
    crawlObservation: {
      findMany: vi.fn(async () => fakeCrawlObservations),
      findFirst: vi.fn(async () => ({ id: "crawl-1" }))
    }
  };
}

describe("createPrismaCrawlRuntimeDeps", () => {
  it("reads previous jobs, recent observations, and baseline status for a source", async () => {
    const db = fakeDb();
    const deps = createPrismaCrawlRuntimeDeps(db);

    const previousJobs = await deps.getPreviousJobs("source-test-social");
    const observations = await deps.getRecentObservations("source-test-social");
    const baselineCompleted = await deps.isBaselineCompleted("source-test-social");

    expect(db.job.findMany).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social" },
      include: {
        source: {
          select: {
            atsKind: true,
            kind: true,
            status: true,
            officialEntryUrl: true,
            officialChainEvidenceUrl: true
          }
        },
        company: {
          select: {
            officialChineseName: true
          }
        }
      },
      orderBy: { lastSeenAt: "desc" }
    });
    expect(previousJobs[0]?.record.officialChineseCompanyName).toBe("测试药企");
    expect(previousJobs[0]?.record.category).toBe("销售");
    expect(db.crawlObservation.findMany).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social", batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
      select: { crawledAt: true, successful: true },
      orderBy: { crawledAt: "desc" },
      take: 10
    });
    expect(observations).toEqual([
      {
        crawledAt: new Date("2026-07-08T20:00:00.000Z"),
        successful: false
      },
      {
        crawledAt: new Date("2026-07-08T08:00:00.000Z"),
        successful: true
      }
    ]);
    expect(db.crawlObservation.findFirst).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social", successful: true,
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
      select: { id: true },
      orderBy: { crawledAt: "asc" }
    });
    expect(baselineCompleted).toBe(true);
  });

  it("keeps MANUAL_SOURCE preview history out of later FULL_RELEASE schedule and baseline inputs", async () => {
    const db = fakeDb();
    const deps = createPrismaCrawlRuntimeDeps(db);
    await deps.getRecentObservations("source-test-social");
    await deps.isBaselineCompleted("source-test-social");

    expect(db.crawlObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ batch: { is: { kind: { not: "MANUAL_SOURCE" } } } })
    }));
    expect(db.crawlObservation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ batch: { is: { kind: { not: "MANUAL_SOURCE" } } } })
    }));
  });
});
