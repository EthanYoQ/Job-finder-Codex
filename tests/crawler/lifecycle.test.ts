import { describe, expect, it } from "vitest";
import {
  applyCrawlObservation,
  type JobSnapshot,
  type LifecycleDecision
} from "../../src/crawler/lifecycle";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";

const FIRST_SEEN_AT = "2026-07-08T00:00:00.000Z";
const OBSERVED_AT = "2026-07-09T00:00:00.000Z";

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
      capturedAt: OBSERVED_AT
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
    firstSeenAt: FIRST_SEEN_AT,
    lastSeenAt: FIRST_SEEN_AT,
    ...overrides
  };
}

function decisionFor(
  decisions: LifecycleDecision[],
  record: NormalizedJobRecord
): LifecycleDecision {
  const dedupeKey = buildJobDedupeKey(record);
  const decision = decisions.find((candidate) => candidate.dedupeKey === dedupeKey);

  expect(decision).toBeDefined();
  return decision as LifecycleDecision;
}

describe("crawl lifecycle reducer", () => {
  it("stores baseline jobs without marking them new", () => {
    const baselineJob = makeJob({ isBaseline: true });

    const decisions = applyCrawlObservation([], [baselineJob], {
      crawlSucceeded: true,
      observedAt: OBSERVED_AT
    });

    expect(decisions).toHaveLength(1);
    expect(decisionFor(decisions, baselineJob)).toMatchObject({
      dedupeKey: buildJobDedupeKey(baselineJob),
      record: baselineJob,
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 0,
      isNew: false,
      firstSeenAt: OBSERVED_AT,
      lastSeenAt: OBSERVED_AT
    });
  });

  it("marks a post-baseline newly appearing job as new", () => {
    const existingJob = makeJob({ sourceJobId: "existing", isBaseline: true });
    const newJob = makeJob({ sourceJobId: "new", isBaseline: false });
    const previousJobs = [makeSnapshot(existingJob)];

    const decisions = applyCrawlObservation(previousJobs, [existingJob, newJob], {
      crawlSucceeded: true,
      observedAt: OBSERVED_AT
    });

    expect(decisionFor(decisions, newJob)).toMatchObject({
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 0,
      isNew: true,
      firstSeenAt: OBSERVED_AT,
      lastSeenAt: OBSERVED_AT
    });
  });

  it("keeps a job active after one successful miss", () => {
    const job = makeJob();
    const previousJobs = [makeSnapshot(job)];

    const decisions = applyCrawlObservation(previousJobs, [], {
      crawlSucceeded: true,
      observedAt: OBSERVED_AT
    });

    expect(decisionFor(decisions, job)).toMatchObject({
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 1,
      isNew: false,
      firstSeenAt: FIRST_SEEN_AT,
      lastSeenAt: FIRST_SEEN_AT
    });
  });

  it("marks a job as suspected offline after two successful misses", () => {
    const job = makeJob();
    const previousJobs = [makeSnapshot(job, { missingSuccessfulCrawlCount: 1 })];

    const decisions = applyCrawlObservation(previousJobs, [], {
      crawlSucceeded: true,
      observedAt: OBSERVED_AT
    });

    expect(decisionFor(decisions, job)).toMatchObject({
      lifecycleStatus: "SUSPECTED_OFFLINE",
      missingSuccessfulCrawlCount: 2,
      isNew: false
    });
  });

  it("marks a job as offline after three successful misses", () => {
    const job = makeJob();
    const previousJobs = [
      makeSnapshot(job, {
        lifecycleStatus: "SUSPECTED_OFFLINE",
        missingSuccessfulCrawlCount: 2
      })
    ];

    const decisions = applyCrawlObservation(previousJobs, [], {
      crawlSucceeded: true,
      observedAt: OBSERVED_AT
    });

    expect(decisionFor(decisions, job)).toMatchObject({
      lifecycleStatus: "OFFLINE",
      missingSuccessfulCrawlCount: 3,
      isNew: false
    });
  });

  it("does not increment missing count after failed crawls", () => {
    const job = makeJob();
    const previousJobs = [makeSnapshot(job, { missingSuccessfulCrawlCount: 1 })];

    const decisions = applyCrawlObservation(previousJobs, [], {
      crawlSucceeded: false,
      observedAt: OBSERVED_AT
    });

    expect(decisionFor(decisions, job)).toMatchObject({
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 1,
      isNew: false,
      firstSeenAt: FIRST_SEEN_AT,
      lastSeenAt: FIRST_SEEN_AT
    });
  });

  it("recovers reappearing jobs as active and resets missing count", () => {
    const job = makeJob();
    const previousJobs = [
      makeSnapshot(job, {
        lifecycleStatus: "OFFLINE",
        missingSuccessfulCrawlCount: 3
      })
    ];
    const reappearingJob = makeJob({ sourceJobId: job.sourceJobId, officialTitle: "Updated title" });

    const decisions = applyCrawlObservation(previousJobs, [reappearingJob], {
      crawlSucceeded: true,
      observedAt: OBSERVED_AT
    });

    expect(decisionFor(decisions, reappearingJob)).toMatchObject({
      record: reappearingJob,
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 0,
      isNew: false,
      firstSeenAt: FIRST_SEEN_AT,
      lastSeenAt: OBSERVED_AT
    });
  });
});
