import { wrapDeltaFixture as wrap } from "../helpers/portableDeltaFixture";
import { describe, expect, it } from "vitest";
import { accepted, digest, job, plan, NOW, FIRST, SECOND } from "../helpers/portablePublicSnapshotFixture";
import { projectPortableSourceJobs, selectPortableSourceSnapshots } from "../../src/domain/portablePublicSnapshot";
import { selectPortableSourceSnapshots as selectLegacyA775 } from "../fixtures/legacyA775PortablePublicSnapshot";
import { JOB_PROJECTION_DELTA_SCHEMA, JOB_PERSISTED_PROJECTION_SCHEMA, hashDeltaManifest, hashJobPersistedProjection, hashProjectionJson, sortJobProjectionMembers, type JobProjectionDeltaReceipt } from "../../src/domain/jobProjectionDeltaReceipt";
import type { PortableJobRow, PortableSourceResultRow, PortableLifecycleMemberRow } from "../../src/db/portablePublicSnapshotRepository";

function project(result: PortableSourceResultRow, members: PortableLifecycleMemberRow[], rows: PortableJobRow[], history: PortableSourceResultRow[] = [], historicalMembers: PortableLifecycleMemberRow[] = [], now = NOW) {
  const selected = selectPortableSourceSnapshots([plan], [...history, result], {currentTime: now})[0]!;
  return projectPortableSourceJobs(selected, members, rows, {currentTime: now}, historicalMembers);
}

describe("explicit delta publication reader", () => {
  it("retains the strict legacy CURRENT lastSeenAt gate", () => {
    const latest = accepted(SECOND);
    expect(project(latest.result, latest.members, [job()], [accepted().result])).toMatchObject({state: "HOLD", reasons: ["PROJECTION_INTEGRITY_HOLD"]});
  });
  it("accepts an unchanged Job only with this round's complete tuple and persisted-projection commitment", () => {
    const first = accepted(), rows = [job()], delta = wrap(accepted(SECOND), rows);
    expect(project(delta.result, delta.members, rows, [first.result])).toMatchObject({state: "PUBLISHING", freshness: "FRESH", visibleJobCount: 1,
      jobs: [{lastSeenAt: SECOND, lastConfirmedObservedAt: SECOND, title: "销售职位", sourceResultId: delta.result.id}]});
    expect(rows[0]!.lastSeenAt.toISOString()).toBe(FIRST);
  });
  it("old a775 fails closed on delta receipts even if every Job happens to carry the new finish time", () => {
    const delta = wrap(accepted(SECOND), [job("job-1", SECOND)]);
    expect(selectLegacyA775([plan], [accepted().result, delta.result], {currentTime: NOW})[0]).toMatchObject({state: "HOLD", reasons: ["RECEIPT_INTEGRITY_HOLD"]});
  });
  it("does not treat a new capture or legacy lastSeen as the real observed time", () => {
    const observed = "2026-10-01T10:59:00.000Z", rows = [job()], delta = wrap(accepted(SECOND), rows, undefined, observed);
    const before = project(delta.result, delta.members, rows, [accepted().result], [], new Date(Date.parse(observed) + 30 * 3600000 - 1));
    const after = project(delta.result, delta.members, rows, [accepted().result], [], new Date(Date.parse(observed) + 30 * 3600000));
    expect(before).toMatchObject({freshness: "FRESH", staleJobCount: 0});
    expect(after).toMatchObject({state: "PUBLISHING", freshness: "STALE", staleJobCount: 1, lastSuccessAt: observed,
      jobs: [{lastSeenAt: SECOND, lastConfirmedObservedAt: observed}]});
  });
  it.each([
    ["sourceJobId", "new-id"], ["listUrl", "https://example.org/list"], ["officialTitle", "changed"], ["officialUrl", "https://example.org/new"],
    ["locationRaw", "北京"], ["city", "北京"], ["cities", ["上海", "北京"]], ["officialPublishedAt", new Date(FIRST)],
    ["missingSuccessCount", 1], ["lifecycleStatus", "OFFLINE"], ["visibleInFrontend", false], ["isNew", true], ["companyId", "other"], ["sourceId", "other"]
  ])("holds mismatching actual persisted field %s", (field, value) => {
    const rows = [job()], delta = wrap(accepted(SECOND), rows);
    const changed = {...rows[0]!, [field as string]: value} as PortableJobRow;
    expect(project(delta.result, delta.members, [changed], [accepted().result])).toMatchObject({state: "HOLD", visibleJobCount: null});
  });
  it("retains live human/classification/title overlays without invalidating the source commitment", () => {
    const rows = [job()], delta = wrap(accepted(SECOND), rows);
    const overlaid = {...rows[0]!, category: "MARKETING" as const, auxiliaryChineseTitle: "辅助标题", humanCorrectedTitle: "人工标题", humanCorrectedCategory: "MEDICAL_AFFAIRS" as const};
    expect(project(delta.result, delta.members, [overlaid], [accepted().result])).toMatchObject({state: "PUBLISHING", jobs: [{title: "人工标题", category: "医学事务"}]});
  });
  it("keeps GRACE at its actual last present observation and validates the old complete CURRENT set", () => {
    const first = accepted(), current = accepted(SECOND, ["job-2"], ["job-1"]), rows = [job("job-1", FIRST, 1), job("job-2", FIRST)], delta = wrap(current, rows, first);
    const result = project(delta.result, delta.members, rows, [first.result], first.members, new Date(Date.parse(FIRST) + 30 * 3600000));
    expect(result).toMatchObject({state: "PUBLISHING", freshness: "FRESH", staleJobCount: 1, visibleJobCount: 2,
      jobs: [{id: "job-1", lastSeenAt: FIRST, lastConfirmedObservedAt: FIRST, inGrace: true}, {id: "job-2", lastSeenAt: SECOND, inGrace: false}]});
    expect(project(delta.result, delta.members, rows, [first.result], [])).toMatchObject({state: "HOLD"});
  });
  it("rejects a valid historical receipt whose CURRENT set never contained the claimed grace key", () => {
    const unrelated = accepted(FIRST, ["unrelated"]), rows = [job("job-1", FIRST, 1), job("job-2", FIRST)];
    const delta = wrap(accepted(SECOND, ["job-2"], ["job-1"]), rows, unrelated);
    expect(project(delta.result, delta.members, rows, [unrelated.result], unrelated.members)).toMatchObject({state: "HOLD"});
  });
  it.each(["wrapper-hash", "manifest-hash", "member-tuple", "fake-observed", "job-missing", "job-duplicate", "member-missing"])("fails closed on %s", kind => {
    const rows = [job()], delta = wrap(accepted(SECOND), rows);
    if (kind === "wrapper-hash") delta.result.completenessCertificateSha256 = "0".repeat(64);
    if (kind === "manifest-hash") {delta.receipt.manifestSha256 = "0".repeat(64); delta.result.completenessCertificateSha256 = hashProjectionJson(delta.receipt);}
    if (kind === "member-tuple") delta.members[0]!.sourceResultId = accepted().result.id;
    if (kind === "fake-observed") {
      delta.receipt.observedAt = FIRST;
      for (const member of delta.receipt.members) member.lastConfirmedObservedAt = FIRST;
      delta.receipt.members = sortJobProjectionMembers(delta.receipt.members);
      delta.receipt.manifestSha256 = hashDeltaManifest(delta.receipt.members);
      delta.result.completenessCertificateSha256 = hashProjectionJson(delta.receipt);
    }
    if (kind === "job-missing") rows.length = 0;
    if (kind === "job-duplicate") rows.push({...job(), id: "duplicate"});
    if (kind === "member-missing") delta.members.pop();
    expect(project(delta.result, delta.members, rows, [accepted().result])).toMatchObject({state: "HOLD", jobs: []});
  });
});
