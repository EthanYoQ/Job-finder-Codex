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
      observation: { disposition: "TRUSTED_COMPLETE", atomicCommitEligible: true },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: false
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

  it("stores first-ever non-baseline crawl jobs without marking them new before baseline completion", () => {
    const job = makeJob({ isBaseline: false });

    const decisions = applyCrawlObservation([], [job], {
      observation: { disposition: "TRUSTED_COMPLETE", atomicCommitEligible: true },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: false
    });

    expect(decisionFor(decisions, job)).toMatchObject({
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
      observation: { disposition: "TRUSTED_COMPLETE", atomicCommitEligible: true },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: true
    });

    expect(decisionFor(decisions, newJob)).toMatchObject({
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 0,
      isNew: true,
      firstSeenAt: OBSERVED_AT,
      lastSeenAt: OBSERVED_AT
    });
  });

  it("marks jobs missing from a verified complete crawl offline immediately", () => {
    const job = makeJob();
    const previousJobs = [makeSnapshot(job)];

    const decisions = applyCrawlObservation(previousJobs, [], {
      observation: { disposition: "TRUSTED_COMPLETE", atomicCommitEligible: true },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: true
    });

    expect(decisionFor(decisions, job)).toMatchObject({
      lifecycleStatus: "OFFLINE",
      missingSuccessfulCrawlCount: 1,
      isNew: false,
      firstSeenAt: FIRST_SEEN_AT,
      lastSeenAt: FIRST_SEEN_AT
    });
  });

  it("does not increment missing count after failed crawls", () => {
    const job = makeJob();
    const previousJobs = [makeSnapshot(job, { missingSuccessfulCrawlCount: 1 })];

    const decisions = applyCrawlObservation(previousJobs, [], {
      observation: { disposition: "CRAWL_FAILED", atomicCommitEligible: false },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: true
    });

    expect(decisionFor(decisions, job)).toMatchObject({
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 1,
      isNew: false,
      firstSeenAt: FIRST_SEEN_AT,
      lastSeenAt: FIRST_SEEN_AT
    });
  });

  it("does not increment missing count after structurally successful but incomplete crawls", () => {
    const job = makeJob();
    const previousJobs = [makeSnapshot(job, { missingSuccessfulCrawlCount: 1 })];

    const decisions = applyCrawlObservation(previousJobs, [], {
      observation: { disposition: "INCOMPLETE", atomicCommitEligible: false },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: true
    });

    expect(decisionFor(decisions, job)).toMatchObject({
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 1,
      isNew: false,
      firstSeenAt: FIRST_SEEN_AT,
      lastSeenAt: FIRST_SEEN_AT
    });
  });

  it("refreshes only observed jobs for a trusted partial crawl and preserves unobserved jobs", () => {
    const observed = makeJob({ sourceJobId: "observed" });
    const missing = makeJob({ sourceJobId: "missing" });
    const refreshed = makeJob({ sourceJobId: "observed", officialTitle: "Updated official title" });
    const decisions = applyCrawlObservation([
      makeSnapshot(observed),
      makeSnapshot(missing, { missingSuccessfulCrawlCount: 1 })
    ], [refreshed], {
      observation: { disposition: "TRUSTED_PARTIAL", atomicCommitEligible: true },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: true
    });

    expect(decisionFor(decisions, refreshed)).toMatchObject({
      record: refreshed,
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 0,
      firstSeenAt: FIRST_SEEN_AT,
      lastSeenAt: OBSERVED_AT
    });
    expect(decisionFor(decisions, missing)).toEqual({
      ...makeSnapshot(missing, { missingSuccessfulCrawlCount: 1 }),
      isNew: false
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
      observation: { disposition: "TRUSTED_COMPLETE", atomicCommitEligible: true },
      observedAt: OBSERVED_AT,
      baselineCompletedBeforeCrawl: true
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

  it.each([
    [0, "ACTIVE", 1, "OFFLINE"], [1, "ACTIVE", 2, "OFFLINE"],
    [2, "SUSPECTED_OFFLINE", 3, "OFFLINE"], [1, "OFFLINE", 2, "OFFLINE"],
    [2, "OFFLINE", 3, "OFFLINE"], [3, "OFFLINE", 4, "OFFLINE"]
  ] as const)("hides a trusted complete miss immediately from prior count %s", (priorCount, priorStatus, nextCount, nextStatus) => {
    const job=makeJob(); const decisions=applyCrawlObservation([makeSnapshot(job,{missingSuccessfulCrawlCount:priorCount,lifecycleStatus:priorStatus})],[],{
      observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true});
    expect(decisionFor(decisions,job)).toMatchObject({missingSuccessfulCrawlCount:nextCount,lifecycleStatus:nextStatus,lastSeenAt:FIRST_SEEN_AT});
  });

  it.each([[1,"ACTIVE"],[2,"SUSPECTED_OFFLINE"],[1,"OFFLINE"],[2,"OFFLINE"],[3,"OFFLINE"]] as const)(
    "resets reappearance from count %s %s", (count,status) => {
      const job=makeJob(); const updated=makeJob({officialTitle:"Updated"}); const decisions=applyCrawlObservation([
        makeSnapshot(job,{missingSuccessfulCrawlCount:count,lifecycleStatus:status})],[updated],{
        observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true});
      expect(decisionFor(decisions,updated)).toMatchObject({lifecycleStatus:"ACTIVE",missingSuccessfulCrawlCount:0,firstSeenAt:FIRST_SEEN_AT,lastSeenAt:OBSERVED_AT});
    });

  it.each(["CRAWL_FAILED","INCOMPLETE","BLOCKED","SKIPPED","UNAUDITED","NON_ATOMIC"] as const)(
    "leaves lifecycle byte-for-byte unchanged for %s", (disposition) => {
      const job=makeJob(); const previous=makeSnapshot(job,{missingSuccessfulCrawlCount:1,lifecycleStatus:"ACTIVE"});
      const [decision]=applyCrawlObservation([previous],[makeJob({sourceJobId:"new"})],{
        observation:{disposition,atomicCommitEligible:false},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true});
      expect(decision).toEqual({...previous,isNew:false});
    });

  it.each([["ACTIVE",2],["SUSPECTED_OFFLINE",1],["OFFLINE",0],["ACTIVE",-1]] as const)(
    "fails closed for invalid prior %s/count %s", (lifecycleStatus,count) => {
      const job=makeJob(); expect(()=>applyCrawlObservation([makeSnapshot(job,{lifecycleStatus,missingSuccessfulCrawlCount:count})],[],{
        observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true})).toThrow("INVALID_PRIOR_LIFECYCLE_SNAPSHOT");
    });

  it("deduplicates current records and orders output deterministically by UTF-8 key", () => {
    const a=makeJob({sourceJobId:"a",officialTitle:"Z"}); const aReplacement=makeJob({sourceJobId:"a",officialTitle:"A"});
    const b=makeJob({sourceJobId:"b"}); const options={observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true} as const,observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true};
    const forward=applyCrawlObservation([], [b,a,aReplacement],options); const reverse=applyCrawlObservation([], [aReplacement,a,b],options);
    expect(forward).toEqual(reverse); expect(forward).toHaveLength(2);
    expect(forward.map(item=>item.dedupeKey)).toEqual([...forward.map(item=>item.dedupeKey)].sort((x,y)=>Buffer.from(x).compare(Buffer.from(y))));
  });

  it("rejects duplicate prior snapshots", () => {
    const job=makeJob(); const snapshot=makeSnapshot(job); expect(()=>applyCrawlObservation([snapshot,snapshot],[],{
      observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true})).toThrow();
  });

  it("does not let the legacy runtime boolean contract advance a miss before atomic binding", () => {
    const job=makeJob(); const previous=makeSnapshot(job); const [decision]=applyCrawlObservation([previous],[],{
      crawlSucceeded:true,completenessVerified:true,observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true});
    expect(decision).toEqual({...previous,isNew:false});
  });

  it.each(["not-a-time","2026-06-31T00:00:00.000Z","2026-01-01T24:00:00.000Z","2026-01-01T00:00:00+08:00","2026-1-01T00:00:00.000Z","2026-01-01T00:00:00.1Z"])(
    "rejects invalid current-only observedAt %s", (observedAt) => {
      expect(()=>applyCrawlObservation([], [makeJob()], {observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt,baselineCompletedBeforeCrawl:true})).toThrow("INVALID_LIFECYCLE_TIMESTAMP");
    });

  it("rejects previous firstSeenAt after lastSeenAt", () => {
    const job=makeJob(); expect(()=>applyCrawlObservation([makeSnapshot(job,{firstSeenAt:OBSERVED_AT,lastSeenAt:FIRST_SEEN_AT})],[],{
      observation:{disposition:"CRAWL_FAILED",atomicCommitEligible:false},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true})).toThrow("INVALID_PRIOR_LIFECYCLE_SNAPSHOT");
  });
  it("accepts exact UTC whole-second precision", () => {
    expect(()=>applyCrawlObservation([], [makeJob()], {observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:"2026-07-09T00:00:00Z",baselineCompletedBeforeCrawl:true})).not.toThrow();
  });

  it("rejects an invalid prior calendar timestamp before lifecycle reduction", () => {
    const job=makeJob(); expect(()=>applyCrawlObservation([makeSnapshot(job,{firstSeenAt:"2026-02-30T00:00:00.000Z"})],[],{
      observation:{disposition:"INCOMPLETE",atomicCommitEligible:false},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true})).toThrow("INVALID_LIFECYCLE_TIMESTAMP");
  });

  it.each(["TRUSTED_COMPLETE","CRAWL_FAILED"] as const)("rejects observedAt before lastSeenAt for %s", (disposition) => {
    const job=makeJob(); const observation=disposition==="TRUSTED_COMPLETE"?{disposition,atomicCommitEligible:true as const}:{disposition,atomicCommitEligible:false as const};
    expect(()=>applyCrawlObservation([makeSnapshot(job,{lastSeenAt:OBSERVED_AT})],[job],{observation,observedAt:FIRST_SEEN_AT,baselineCompletedBeforeCrawl:true})).toThrow("OBSERVATION_TIMESTAMP_PRECEDES_LAST_SEEN");
  });

  it("accepts observedAt exactly equal to every prior lastSeenAt", () => {
    const job=makeJob(); expect(()=>applyCrawlObservation([makeSnapshot(job,{lastSeenAt:OBSERVED_AT})],[job],{
      observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true})).not.toThrow();
  });

  it("rejects a mixed previous set when observedAt precedes any one lastSeenAt", () => {
    const early=makeJob({sourceJobId:"early"}),late=makeJob({sourceJobId:"late"});
    expect(()=>applyCrawlObservation([makeSnapshot(early),makeSnapshot(late,{lastSeenAt:"2026-07-10T00:00:00.000Z"})],[early,late],{
      observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true})).toThrow("OBSERVATION_TIMESTAMP_PRECEDES_LAST_SEEN");
  });

  it("rejects duplicate prior rows even when their timestamps conflict", () => {
    const job=makeJob(); const first=makeSnapshot(job),second=makeSnapshot(job,{lastSeenAt:OBSERVED_AT});
    expect(()=>applyCrawlObservation([first,second],[],{observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true},observedAt:OBSERVED_AT,baselineCompletedBeforeCrawl:true})).toThrow("INVALID_PRIOR_LIFECYCLE_SNAPSHOT");
  });
});
