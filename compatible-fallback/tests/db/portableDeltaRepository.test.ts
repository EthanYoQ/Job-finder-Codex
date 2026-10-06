import { describe, expect, it, vi } from "vitest";
import { readPortablePublicSnapshotWithStatus, type PortableSnapshotDb, type PortableSnapshotTransactionDb, type PortableJobRow, type PortableLifecycleMemberRow, type PortableSourceResultRow } from "../../src/db/portablePublicSnapshotRepository";
import { PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_TABLES } from "../../src/db/portableSnapshotCache";
import { wrapDeltaFixture } from "../helpers/portableDeltaFixture";
import { accepted, job, plan, NOW, FIRST, SECOND } from "../helpers/portablePublicSnapshotFixture";
function fixture(results: PortableSourceResultRow[], members: PortableLifecycleMemberRow[], jobs: PortableJobRow[]) {
  const tx = {
    $queryRawUnsafe: vi.fn(async () => PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: "a".repeat(64)}))),
    crawlBatchSourceResult: {findMany: vi.fn(async () => structuredClone(results))},
    lifecycleSetEvidenceMember: {findMany: vi.fn(async (query: {where: {sourceResultId: {in: string[]}}}) => structuredClone(members.filter(row => query.where.sourceResultId.in.includes(row.sourceResultId))))},
    job: {findMany: vi.fn(async () => structuredClone(jobs))}
  };
  const transaction = vi.fn(async (run: (tx: PortableSnapshotTransactionDb) => unknown) => run(tx as unknown as PortableSnapshotTransactionDb));
  return {tx, transaction, db: {$transaction: transaction} as PortableSnapshotDb};
}
const read = (db: PortableSnapshotDb, cache?: PortableSnapshotCache) => readPortablePublicSnapshotWithStatus(db, {currentTime: NOW}, [plan], cache);
describe("delta repository uses the same verified database snapshot", () => {
  it("does not filter a committed delta CURRENT by the unchanged mutable Job lastSeenAt", async () => {
    const first = accepted(), rows = [job()], next = wrapDeltaFixture(accepted(SECOND), rows);
    const f = fixture([first.result, next.result], [...first.members, ...next.members], rows);
    const result = await read(f.db);
    expect(result.snapshot).toMatchObject({totalJobs: 1, lastUpdatedAt: SECOND});
    expect(f.tx.job.findMany).toHaveBeenCalledWith(expect.objectContaining({where: {OR: [{companyId: plan.company.id, sourceId: plan.source.id,
      lifecycleStatus: "ACTIVE", visibleInFrontend: true, dedupeKey: {in: [rows[0]!.dedupeKey]}}]}}));
    expect(result.snapshotRefresh).toMatchObject({state: "CURRENT", displayDataVersion: expect.stringMatching(/^[a-f0-9]{64}$/), statusVersion: expect.stringMatching(/^[a-f0-9]{64}$/), verifiedAt: NOW.toISOString()});
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000});
  });
  it("fetches and verifies GRACE last-present CURRENT members in that same transaction", async () => {
    const first = accepted(), rows = [job("job-1", FIRST, 1), job("job-2", FIRST)], next = wrapDeltaFixture(accepted(SECOND, ["job-2"], ["job-1"]), rows, first);
    const f = fixture([first.result, next.result], [...first.members, ...next.members], rows);
    expect((await read(f.db)).snapshot).toMatchObject({totalJobs: 2});
    expect(f.tx.lifecycleSetEvidenceMember.findMany).toHaveBeenCalledWith(expect.objectContaining({where: {sourceResultId: {in: [next.result.id, first.result.id]}}}));
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValueOnce(next.members);
    expect((await read(f.db)).snapshot.sources[0]).toMatchObject({state: "HOLD", visibleJobCount: null});
  });
  it("keeps display data identity on a genuinely reobserved unchanged job while status and legacy identity change", async () => {
    const first = accepted(), rows = [job()], f = fixture([first.result], first.members, rows), cache = new PortableSnapshotCache();
    const before = await read(f.db, cache), next = wrapDeltaFixture(accepted(SECOND), rows);
    f.tx.$queryRawUnsafe.mockResolvedValue(PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: "b".repeat(64)})));
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([first.result, next.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(next.members);
    const after = await read(f.db, cache);
    expect(after.snapshotRefresh.displayDataVersion).toBe(before.snapshotRefresh.displayDataVersion);
    expect(after.snapshotRefresh.statusVersion).not.toBe(before.snapshotRefresh.statusVersion);
    expect(after.snapshotRefresh.version).not.toBe(before.snapshotRefresh.version);
    expect(after.snapshotRefresh.verifiedAt).toBe(before.snapshotRefresh.verifiedAt);
    expect(after.snapshot.sources[0]!.jobs[0]).toMatchObject({lastSeenAt: SECOND, lastConfirmedObservedAt: SECOND});
    expect(rows[0]!.lastSeenAt.toISOString()).toBe(FIRST);
    const hit = await read(f.db, cache);
    expect(hit.snapshotRefresh).toEqual(after.snapshotRefresh);
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });
});
