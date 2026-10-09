import { describe, expect, it } from "vitest";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { SOURCE_QUALITY_POLICY_ID } from "../../src/crawler/sourceQualityAdmission";
import { accepted, failed, unstartedAbort, ambiguousAbortMutations, job, plan, NOW, FIRST, SECOND, digest } from "../helpers/portablePublicSnapshotFixture";
const select = (rows: ReturnType<typeof accepted>["result"][], currentTime = NOW, plans = [plan]) => selectPortableSourceSnapshots(plans, rows, {currentTime});
const projection = (fixture = accepted(), rows = [job()]) => projectPortableSourceJobs(select([fixture.result])[0]!, fixture.members, rows, {currentTime: NOW});
describe("portable public snapshot source selection", () => {
  it("CSPC stays held without an accepted receipt after the bounded channel review", () => {
    const cspc = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-cspc-social")!;
    const f = accepted(FIRST, ["channel-job"], [], cspc);
    const before = structuredClone(f.result);
    const selection = select([], NOW, [cspc])[0]!;
    expect(selection).toMatchObject({state:"HOLD", health:"UNVERIFIED", selected:null, lastAcceptedJobCount:null,
      reasons:["CURRENT_CONFIG_HAS_NO_ACCEPTED_RECEIPT"]});
    expect(projectPortableSourceJobs(selection, f.members, [], {currentTime:NOW})).toMatchObject({jobs:[], visibleJobCount:null});
    expect(f.result).toEqual(before);
  });

  it("uses only exact current-policy committed receipts and keeps earliest floor independent of input ordering", () => {
    const first = accepted(), last = accepted(SECOND);
    const snapshot = select([last.result, first.result])[0]!;
    expect(snapshot).toMatchObject({sourceId: plan.source.id, policyId: SOURCE_QUALITY_POLICY_ID, state: "PUBLISHING", health: "HEALTHY", freshness: "FRESH", visibilityFloor: FIRST, lastAcceptedAt: SECOND, lastSuccessAt: SECOND, lastAcceptedJobCount: 1, selectedSourceResultId: last.result.id});
  });
  it("retains last-good across a newer failed zero attempt with truthful degraded status", () => {
    const first = accepted();
    const snapshot = select([failed(), first.result])[0]!;
    expect(snapshot).toMatchObject({state: "PUBLISHING", health: "DEGRADED", lastAcceptedJobCount: 1, lastAcceptedAt: FIRST, lastAttemptAt: SECOND, selectedSourceResultId: first.result.id});
    expect(snapshot.reasons).toContain("LATEST_ATTEMPT_FAILED");
  });
  it.each(["FAILED", "SKIPPED"] as const)("keeps last-good health and attempt time across a proven unstarted %s closure", transport => {
    const row = unstartedAbort(undefined, transport), before = structuredClone(row);
    expect(select([accepted().result, row])[0]).toMatchObject({state: "PUBLISHING", health: "HEALTHY", lastAttemptAt: FIRST, lastSuccessAt: FIRST, reasons: []});
    expect(select([row])[0]).toMatchObject({state: "HOLD", health: "UNVERIFIED", lastAttemptAt: null, lastSuccessAt: null});
    expect(row).toEqual(before);
  });
  it.each(ambiguousAbortMutations)("does not hide an ambiguous abort with %s", (_name, mutate) => {
    for (const transport of ["FAILED", "SKIPPED"] as const) {
      const row = unstartedAbort(undefined, transport); mutate(row);
      expect(select([accepted().result, row])[0]).toMatchObject({health: "DEGRADED", lastAttemptAt: SECOND, reasons: ["LATEST_ATTEMPT_FAILED"]});
    }
  });
  it("retains stale receipt metadata but closes publication at exactly 30 hours", () => {
    const snapshot = select([accepted().result], new Date("2026-10-02T06:00:00.000Z"))[0]!;
    expect(snapshot).toMatchObject({state: "HOLD", health: "DEGRADED", freshness: "STALE", lastAcceptedJobCount: 1, lastAcceptedAt: FIRST});
    expect(snapshot.reasons).toContain("LAST_GOOD_STALE");
  });
  it("does not apply manual diagnostic, legacy count, or unverified zero as accepted data", () => {
    const manual = accepted(); manual.result.batch.kind = "MANUAL_SOURCE";
    const legacy = accepted(); legacy.result.completenessCertificate = {grade: "A"};
    const snapshot = select([manual.result, legacy.result, failed()])[0]!;
    expect(snapshot).toMatchObject({state: "HOLD", lastAcceptedJobCount: null, selectedSourceResultId: null, visibilityFloor: null});
  });
  it("distinguishes accepted zero from no accepted observation", () => {
    expect(projection(accepted(FIRST, []), [])).toMatchObject({state: "PUBLISHING", lastAcceptedJobCount: 0, visibleJobCount: 0, jobs: []});
    expect(select([failed()])[0]).toMatchObject({state: "HOLD", lastAcceptedJobCount: null});
  });
  it("fails closed for unreviewed current policies/configuration changes", () => {
    const changed = structuredClone(plan); changed.source.officialEntryUrl += "?changed=1";
    expect(select([accepted().result], NOW, [changed])[0]).toMatchObject({state: "HOLD", policyId: null, lastAcceptedJobCount: null});
    const old = accepted(); old.result.sourceConfigHash = "b".repeat(64);
    expect(select([old.result])[0]).toMatchObject({state: "HOLD", lastAcceptedJobCount: null, reasons: ["CURRENT_CONFIG_HAS_NO_ACCEPTED_RECEIPT"]});
  });
  it.each(["hash", "ledger", "counts", "binding", "future", "observation", "policy"])("holds publication for a claimed committed receipt with %s drift", kind => {
    const fixture = accepted();
    if (kind === "hash") fixture.result.completenessCertificateSha256 = "f".repeat(64);
    if (kind === "ledger") fixture.result.adapterReconciliationSha256 = "f".repeat(64);
    if (kind === "counts") fixture.result.rawCount++;
    if (kind === "binding") fixture.result.batch.releaseCandidateId = "another-release";
    if (kind === "future") fixture.result = accepted("2026-10-02T00:00:00.000Z").result;
    if (kind === "observation") { fixture.receipt.observation.crawledAt = "2026-09-01T00:00:00.000Z"; fixture.result.completenessCertificateSha256 = digest(fixture.receipt); }
    if (kind === "policy") { (fixture.receipt as {policyId: string}).policyId = "UNKNOWN_POLICY"; fixture.result.completenessCertificateSha256 = digest(fixture.receipt); }
    expect(select([fixture.result])[0]).toMatchObject({state: "HOLD", health: "DEGRADED", reasons: ["RECEIPT_INTEGRITY_HOLD"]});
  });
  it("does not let global batch failure suppress a committed source or reset last success", () => {
    const fixture = accepted(); fixture.result.batch.status = "FAILED";
    expect(select([fixture.result])[0]).toMatchObject({state: "PUBLISHING", health: "HEALTHY"});
  });
});
describe("portable snapshot job projection", () => {
  it("ignores old-only active flags and binds exactly to selected lifecycle membership", () => {
    expect(projection(accepted(), [job(), job("legacy", "2026-09-01T00:00:00.000Z")])).toMatchObject({state: "PUBLISHING", visibleJobCount: 1, jobs: [{id: "job-1"}]});
  });
  it.each(["pre-floor", "post-ceiling", "missing", "company", "lifecycle", "member-hash", "set-hash", "extra-member", "duplicate"])("holds the whole source projection on %s drift without a false zero", kind => {
    const fixture = accepted(); let rows = [job()];
    if (kind === "pre-floor") rows[0]!.lastSeenAt = new Date("2026-09-01T00:00:00.000Z");
    if (kind === "post-ceiling") rows[0]!.lastSeenAt = new Date(SECOND);
    if (kind === "missing") rows = [];
    if (kind === "company") rows[0]!.companyId = "wrong-company";
    if (kind === "lifecycle") rows[0]!.missingSuccessCount = 1;
    if (kind === "member-hash") fixture.members[0]!.jobKeySha256 = "f".repeat(64);
    if (kind === "set-hash") fixture.result.canonicalVisibleJobSetSha256 = "f".repeat(64);
    if (kind === "extra-member") fixture.members.push({...fixture.members[0]!, jobKey: "legacy"});
    if (kind === "duplicate") rows.push(job());
    const snapshot = projection(fixture, rows);
    expect(snapshot).toMatchObject({state: "HOLD", health: "DEGRADED", visibleJobCount: null, jobs: [], lastAcceptedJobCount: 1});
    expect(snapshot.reasons).toContain("PROJECTION_INTEGRITY_HOLD");
  });
  it("preserves accepted grace but suppresses stale records with truthful status", () => {
    const first = accepted(); const last = accepted(SECOND, ["job-2"], ["job-1"]);
    const selected = select([first.result, last.result])[0]!;
    const projected = projectPortableSourceJobs(selected, last.members, [job("job-2", SECOND), job("job-1", FIRST, 1)], {currentTime: NOW});
    expect(projected).toMatchObject({state: "PUBLISHING", visibleJobCount: 2, lastAcceptedJobCount: 1});
    const stale = projectPortableSourceJobs(selected, last.members, [job("job-2", SECOND), job("job-1", FIRST, 1)], {currentTime: new Date("2026-10-02T07:00:00.000Z")});
    expect(stale).toMatchObject({state: "PUBLISHING", health: "DEGRADED", visibleJobCount: 1});
    expect(stale.reasons).toContain("STALE_JOB_ROWS_EXCLUDED");
  });
});

describe("portable snapshot preservation and authority boundaries", () => {
  it("does not restart freshness for in-flight retries or neutral not-due events", () => {
    const pending = failed(); pending.finishedAt = null; pending.transportState = "PENDING";
    expect(select([accepted().result, pending])[0]).toMatchObject({state: "PUBLISHING", health: "DEGRADED", lastSuccessAt: FIRST, reasons: ["LATEST_ATTEMPT_RUNNING"]});
    const skipped = failed(); skipped.failureCode = "SOURCE_NOT_DUE"; skipped.transportState = "SKIPPED"; skipped.expectedJobCount = null;
    expect(select([accepted().result, skipped])[0]).toMatchObject({state: "PUBLISHING", health: "HEALTHY", lastSuccessAt: FIRST, reasons: []});
  });
  it("ignores a valid receipt in an uncommitted, rolled-back or incomplete result", () => {
    const uncommitted = accepted(); uncommitted.result.atomicCommitState = "ROLLED_BACK";
    expect(select([uncommitted.result])[0]).toMatchObject({state: "HOLD", lastAcceptedJobCount: null});
    uncommitted.result.atomicCommitState = "COMMITTED"; uncommitted.result.completenessState = "INCOMPLETE";
    expect(select([uncommitted.result])[0]).toMatchObject({state: "HOLD", lastAcceptedJobCount: null});
  });
  it("does not reuse later data from a different config to advance accepted source time", () => {
    const changed = failed(); changed.sourceConfigHash = "f".repeat(64);
    expect(select([accepted().result, changed])[0]).toMatchObject({state: "PUBLISHING", health: "HEALTHY", lastAttemptAt: FIRST, visibilityFloor: FIRST});
  });
  it("does not let a later legacy committed writer silently replace portable data", () => {
    const legacy = accepted(SECOND); legacy.result.completenessCertificate = {grade: "A"};
    expect(select([accepted().result, legacy.result])[0]).toMatchObject({state: "HOLD", health: "DEGRADED", lastAcceptedJobCount: 1, reasons: ["RECEIPT_INTEGRITY_HOLD"]});
  });
  it("does not mutate receipt, plans, lifecycle or job inputs", () => {
    const f = accepted(); const rows = [job()];
    const before = structuredClone({f, rows, plan});
    projection(f, rows);
    expect({f, rows, plan}).toEqual(before);
  });
});


describe("source independence and conservative time", () => {
  it("does not let another source failure suppress a publishing source", () => {
    const qilu = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-qilu-social")!;
    const bad = accepted(FIRST, [], [], qilu).result;
    bad.atomicCommitState = "NOT_ATTEMPTED"; bad.completenessState = "FAILED"; bad.completenessCertificate = null;
    const sources = select([accepted().result, bad], NOW, [plan, qilu]);
    expect(sources.find(source => source.sourceId === plan.source.id)).toMatchObject({state: "PUBLISHING", lastAcceptedJobCount: 1});
    expect(sources.find(source => source.sourceId === qilu.source.id)).toMatchObject({state: "HOLD", lastAcceptedJobCount: null});
  });
  it("uses observed time for source freshness and issued time only for the visibility floor", () => {
    const f = accepted("2026-10-01T00:20:00.000Z");
    f.receipt.acquisition.startedAt = FIRST; f.receipt.acquisition.finishedAt = FIRST;
    f.receipt.observation.crawledAt = FIRST; f.result.startedAt = new Date(FIRST);
    f.result.completenessCertificateSha256 = digest(f.receipt);
    expect(select([f.result], new Date("2026-10-02T06:00:00.000Z"))[0]).toMatchObject({state: "HOLD", freshness: "STALE", lastSuccessAt: FIRST, visibilityFloor: "2026-10-01T00:20:00.000Z"});
  });
});
