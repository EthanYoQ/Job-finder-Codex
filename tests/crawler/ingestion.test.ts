import { describe, expect, it } from "vitest";
import type { CrawlAdapterResult } from "../../src/crawler/adapters/types";
import { buildIngestionCommands } from "../../src/crawler/ingestion";
import type { LifecycleDecision } from "../../src/crawler/lifecycle";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import type { CrawlObservation } from "../../src/domain/company";

const CRAWLED_AT = "2026-07-08T00:00:00.000Z";
const FIRST_SEEN_AT = "2026-07-07T00:00:00.000Z";

function makeObservation(overrides: Partial<CrawlObservation> = {}): CrawlObservation {
  return {
    id: "source-test-social:official-json:2026-07-08T00:00:00.000Z",
    sourceId: "source-test-social",
    crawledAt: new Date(CRAWLED_AT),
    successful: true,
    stableRequiredFields: ["company", "title", "officialUrl", "location"],
    structuredJobCount: 1,
    ...overrides
  };
}

function makeJob(overrides: Partial<NormalizedJobRecord> = {}): NormalizedJobRecord {
  const sourceJobId = overrides.sourceJobId ?? "job-1";

  return {
    companyId: "company-test",
    sourceId: "source-test-social",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialChineseCompanyName: "Test Pharma",
    officialTitle: `Sales Representative ${sourceJobId}`,
    officialUrl: `https://example.com/jobs/${sourceJobId}`,
    sourceJobId,
    locationRaw: "Beijing",
    cities: ["Beijing"],
    category: "销售",
    isBaseline: false,
    evidence: {
      officialEntryUrl: "https://example.com/jobs",
      officialChainEvidenceUrl: "https://example.com/careers",
      capturedAt: CRAWLED_AT
    },
    ...overrides
  };
}

function makeDecision(
  record: NormalizedJobRecord,
  overrides: Partial<LifecycleDecision> = {}
): LifecycleDecision {
  return {
    dedupeKey: buildJobDedupeKey(record),
    record,
    lifecycleStatus: "ACTIVE",
    missingSuccessfulCrawlCount: 0,
    firstSeenAt: FIRST_SEEN_AT,
    lastSeenAt: CRAWLED_AT,
    isNew: false,
    ...overrides
  };
}

function makeSuccessResult(
  jobs: NormalizedJobRecord[],
  observation: CrawlObservation = makeObservation({ structuredJobCount: jobs.length })
): CrawlAdapterResult {
  return {
    status: "SUCCESS",
    jobs,
    observation
  };
}

describe("buildIngestionCommands", () => {
  it("produces a crawl observation insert and job upsert commands for successful crawls", () => {
    const job = makeJob();
    const observation = makeObservation();
    const decision = makeDecision(job, { isNew: true });

    const commands = buildIngestionCommands(makeSuccessResult([job], observation), [decision]);

    expect(commands).toEqual([
      {
        type: "UPSERT_CRAWL_OBSERVATION",
        observation
      },
      {
        type: "UPSERT_JOB",
        dedupeKey: buildJobDedupeKey(job),
        record: job,
        lifecycleStatus: "ACTIVE",
        visibleInFrontend: true,
        isNew: true,
        firstSeenAt: FIRST_SEEN_AT,
        lastSeenAt: CRAWLED_AT,
        missingSuccessfulCrawlCount: 0
      }
    ]);
  });

  it("hides suspected and offline lifecycle jobs from frontend eligibility", () => {
    const suspectedJob = makeJob({ sourceJobId: "suspected" });
    const offlineJob = makeJob({ sourceJobId: "offline" });
    const decisions = [
      makeDecision(suspectedJob, {
        lifecycleStatus: "SUSPECTED_OFFLINE",
        missingSuccessfulCrawlCount: 2
      }),
      makeDecision(offlineJob, {
        lifecycleStatus: "OFFLINE",
        missingSuccessfulCrawlCount: 3
      })
    ];

    const commands = buildIngestionCommands(makeSuccessResult([], makeObservation()), decisions);

    expect(commands).toEqual([
      {
        type: "UPSERT_CRAWL_OBSERVATION",
        observation: makeObservation()
      },
      {
        type: "UPSERT_JOB",
        dedupeKey: buildJobDedupeKey(suspectedJob),
        record: suspectedJob,
        lifecycleStatus: "SUSPECTED_OFFLINE",
        visibleInFrontend: false,
        isNew: false,
        firstSeenAt: FIRST_SEEN_AT,
        lastSeenAt: CRAWLED_AT,
        missingSuccessfulCrawlCount: 2
      },
      {
        type: "UPSERT_JOB",
        dedupeKey: buildJobDedupeKey(offlineJob),
        record: offlineJob,
        lifecycleStatus: "OFFLINE",
        visibleInFrontend: false,
        isNew: false,
        firstSeenAt: FIRST_SEEN_AT,
        lastSeenAt: CRAWLED_AT,
        missingSuccessfulCrawlCount: 3
      }
    ]);
  });

  it("produces only a crawl observation insert for failed crawls", () => {
    const previousJob = makeJob({ sourceJobId: "previous" });
    const observation = makeObservation({
      successful: false,
      stableRequiredFields: [],
      structuredJobCount: 0,
      failureReason: "temporary upstream 503"
    });
    const result: CrawlAdapterResult = {
      status: "FAILED",
      jobs: [],
      failureReason: "temporary upstream 503",
      observation
    };

    const commands = buildIngestionCommands(result, [makeDecision(previousJob)]);

    expect(commands).toEqual([
      {
        type: "UPSERT_CRAWL_OBSERVATION",
        observation
      }
    ]);
  });
});
