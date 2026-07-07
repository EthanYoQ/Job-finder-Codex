import { describe, expect, it } from "vitest";
import { toJobSnapshots, toSourceScheduleState } from "../../src/db/crawlStateRepository";

describe("crawl state repository mappers", () => {
  it("maps persisted active jobs into lifecycle snapshots", () => {
    const snapshots = toJobSnapshots([
      {
        dedupeKey: "source-1:job-1",
        companyId: "company-1",
        sourceId: "source-1",
        sourceJobId: "job-1",
        officialTitle: "Regional Sales Manager",
        auxiliaryChineseTitle: "区域销售经理",
        officialUrl: "https://example.com/jobs/1",
        listUrl: "https://example.com/jobs",
        locationRaw: "北京",
        city: "北京",
        cities: ["北京"],
        category: "SALES",
        officialPublishedAt: new Date("2026-07-07T00:00:00.000Z"),
        firstSeenAt: new Date("2026-07-08T00:00:00.000Z"),
        lastSeenAt: new Date("2026-07-08T12:00:00.000Z"),
        missingSuccessCount: 1,
        lifecycleStatus: "ACTIVE",
        source: {
          atsKind: "OFFICIAL_HTML",
          kind: "SOCIAL",
          status: "VERIFIED_SCRAPABLE",
          officialEntryUrl: "https://example.com/careers",
          officialChainEvidenceUrl: "https://example.com"
        },
        company: { officialChineseName: "测试药企" }
      }
    ]);

    expect(snapshots[0]).toMatchObject({
      dedupeKey: "source-1:job-1",
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 1,
      record: {
        category: "销售",
        cities: ["北京"],
        officialPublishedAt: "2026-07-07T00:00:00.000Z",
        evidence: {
          officialEntryUrl: "https://example.com/careers",
          officialChainEvidenceUrl: "https://example.com"
        }
      }
    });
  });

  it("computes source schedule state from latest observations", () => {
    const state = toSourceScheduleState("source-1", [
      { crawledAt: new Date("2026-07-08T12:00:00.000Z"), successful: false },
      { crawledAt: new Date("2026-07-08T00:00:00.000Z"), successful: false },
      { crawledAt: new Date("2026-07-07T12:00:00.000Z"), successful: true },
      { crawledAt: new Date("2026-07-07T00:00:00.000Z"), successful: false }
    ]);

    expect(state).toEqual({
      sourceId: "source-1",
      lastSuccessfulCrawlAt: new Date("2026-07-07T12:00:00.000Z"),
      consecutiveFailureCount: 2
    });
  });
});
