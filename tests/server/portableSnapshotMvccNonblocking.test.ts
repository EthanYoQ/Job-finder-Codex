import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortableSnapshotReader, MAX_PORTABLE_RESPONSE_BARRIERS, type PortableSnapshotReader } from "../../src/server/httpServer";
import type { PortableSnapshotDb, PortableSnapshotTransactionDb } from "../../src/db/portablePublicSnapshotRepository";
import { PORTABLE_MVCC_TOKEN_SQL } from "../../src/db/portableSnapshotVersionMemo";
import { PORTABLE_SNAPSHOT_VERSION_TABLES } from "../../src/db/portableSnapshotCache";
import { SNAPSHOT_CHECK_MAX_AGE_MS } from "../../src/server/snapshotRefreshCheck";
import { accepted, job, plan, NOW, SECOND } from "../helpers/portablePublicSnapshotFixture";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve}; }
const readers: PortableSnapshotReader[] = [];
function fixture() {
  let evidence = accepted(), jobs = [job()], digest = "a";
  let queryGate: ReturnType<typeof deferred> | undefined, jobGate: ReturnType<typeof deferred> | undefined;
  let queryError: Error | undefined, active = 0;
  const stats = {transactions: 0, queries: 0, builds: 0, maximumActive: 0};
  const db = {$transaction: async (work: (tx: PortableSnapshotTransactionDb) => Promise<unknown>) => {
    // Capture before the query gate so unchanged older transactions reproduce
    // real RepeatableRead rather than reading mutable fixtures after release.
    const own = structuredClone({evidence, jobs, digest});
    const blockedQuery = queryGate, blockedJob = jobGate, error = queryError;
    queryGate = undefined; jobGate = undefined; queryError = undefined;
    stats.transactions++; stats.maximumActive = Math.max(stats.maximumActive, ++active);
    try { return await work({
      $queryRawUnsafe: async (sql: string) => {
        if (sql !== PORTABLE_MVCC_TOKEN_SQL) return PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: own.digest.repeat(64)}));
        stats.queries++; await blockedQuery?.promise; if (error) throw error;
        return [{snapshot: own.digest === "a" ? "100:100:" : "101:101:", own_xid:null, server_started:"2026-10-01 00:00:00+00", server_address:"127.0.0.1", server_port:"5432", backend_pid:"42", backend_started:"2026-10-01 01:00:00+00", recovery:false, database_name:"postgres", database_oid:"5", role_name:"postgres", search_path:'"$user", public', isolation:"repeatable read", bypass_rls:true}];},
      crawlBatchSourceResult: {findMany: async () => {stats.builds++; return [own.evidence.result];}},
      lifecycleSetEvidenceMember: {findMany: async () => own.evidence.members},
      job: {findMany: async () => {await blockedJob?.promise; return own.jobs;}}
    } as PortableSnapshotTransactionDb); } finally {active--;}
  }} as PortableSnapshotDb;
  const read = createPortableSnapshotReader(db, {reuseIdenticalMvccSnapshot: true}); readers.push(read);
  return {read, stats,
    holdQuery() {queryGate = deferred(); return queryGate;},
    holdJobs() {jobGate = deferred(); return jobGate;},
    failQuery() {queryError = new Error("version unavailable");},
    commit() {evidence = accepted(SECOND, ["job-2"]); jobs = [job("job-2", SECOND)]; digest = "b";}
  };
}
async function finish(read: PortableSnapshotReader) {
  for (let n = 0; n < 300 && read.getRefreshStatus().state === "UPDATING"; n++) {
    await nextTurn(); await vi.advanceTimersByTimeAsync(1);
  }
  expect(read.getRefreshStatus().state).toBe("CURRENT");
}
beforeEach(() => {
  vi.useFakeTimers({toFake: ["Date", "setTimeout", "clearTimeout"]}); vi.setSystemTime(NOW);
  vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {await Promise.all(readers.splice(0).map(read => read.close())); vi.restoreAllMocks(); vi.useRealTimers();});

describe("MVCC optimized nonblocking verified HTTP display", () => {
  it("fully verifies startup before either strict or HTTP reads resolve, sharing one transaction", async () => {
    const f = fixture(), gate = f.holdJobs(); let settled = false;
    const strict = f.read().then(value => {settled = true; return value;});
    const http = f.read.readWithStatus();
    await nextTurn(); expect(settled).toBe(false); expect(f.stats.transactions).toBe(1);
    gate.resolve(); const [snapshot, display] = await Promise.all([strict, http]);
    expect(snapshot.totalJobs).toBe(1); expect(display.snapshot).toEqual(snapshot);
    expect(display.snapshotRefresh.state).toBe("CURRENT"); expect(display.snapshotRefresh.check).toBeUndefined();
  });

  it("does not invent a startup display when initial version verification fails", async () => {
    const f = fixture(); f.failQuery();
    await expect(f.read.readWithStatus(undefined, "old-process-check")).rejects.toThrow("INVALID_PORTABLE_SNAPSHOT_CHECK");
    expect(f.stats.transactions).toBe(0);
    await expect(f.read()).rejects.toThrow("version unavailable");
    expect(f.stats.builds).toBe(0); expect(vi.getTimerCount()).toBe(0);
    expect((await f.read()).totalJobs).toBe(1);
  });

  it("returns owned last-good immediately and starts no query before response finish", async () => {
    const f = fixture(), initial = await f.read(), response = deferred(), query = f.holdQuery();
    const result = await f.read.readWithStatus(response.promise);
    expect(result.snapshot).toEqual(initial); expect(result.snapshotRefresh).toMatchObject({state: "UPDATING", check: expect.any(String)});
    await vi.advanceTimersByTimeAsync(1000); expect(f.stats.transactions).toBe(1);
    response.resolve(); await vi.advanceTimersByTimeAsync(0); expect(f.stats.queries).toBe(2);
    const following = await f.read.readWithStatus(undefined, result.snapshotRefresh.check);
    expect(following.snapshot).toEqual(initial); expect(following.snapshotRefresh.state).toBe("UPDATING");
    result.snapshot.sources[0]!.reasons.push("LAST_GOOD_STALE"); expect(following.snapshot).toEqual(initial);
    query.resolve(); await finish(f.read); expect(f.stats.maximumActive).toBe(1);
  });

  it("bounds a synchronous response group and does not let overflow extend its barrier", async () => {
    const f = fixture(); await f.read();
    const responses = Array.from({length: MAX_PORTABLE_RESPONSE_BARRIERS + 4}, deferred);
    await Promise.all(responses.map(response => f.read.readWithStatus(response.promise)));
    await vi.advanceTimersByTimeAsync(0); expect(f.stats.transactions).toBe(1);
    responses.slice(0, MAX_PORTABLE_RESPONSE_BARRIERS).forEach(response => response.resolve());
    await vi.advanceTimersByTimeAsync(0); await finish(f.read);
    expect(f.stats.transactions).toBe(2);
    responses.slice(MAX_PORTABLE_RESPONSE_BARRIERS).forEach(response => response.resolve());
  });

  it("terminates an unchanged correlated followup without a new check or new timestamp", async () => {
    const f = fixture(); await f.read(); const initial = await f.read.readWithStatus();
    await vi.advanceTimersByTimeAsync(0); await finish(f.read);
    const count = f.stats.transactions;
    for (let n = 0; n < 5; n++) {
      const current = await f.read.readWithStatus(undefined, initial.snapshotRefresh.check);
      expect(current.snapshot).toEqual(initial.snapshot);
      expect(current.snapshotRefresh).toEqual({...initial.snapshotRefresh, state: "CURRENT"});
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.stats.transactions).toBe(count); expect(f.stats.builds).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("checks again for the first request after a commit even if an older transaction reports unchanged", async () => {
    const f = fixture(); await f.read(); const query = f.holdQuery();
    await f.read.readWithStatus(); await vi.advanceTimersByTimeAsync(0);
    expect(f.stats.transactions).toBe(2); f.commit();
    const firstAfterCommit = await f.read.readWithStatus();
    query.resolve(); await finish(f.read);
    const latest = await f.read.readWithStatus(undefined, firstAfterCommit.snapshotRefresh.check);
    expect(latest.snapshotRefresh.state).toBe("CURRENT");
    expect(latest.snapshot.sources.find(source => source.sourceId === plan.source.id)?.jobs).toMatchObject([{id: "job-2"}]);
    expect(latest.snapshotRefresh.version).not.toBe(firstAfterCommit.snapshotRefresh.version);
    expect(f.stats).toMatchObject({transactions: 4, builds: 2, maximumActive: 1});
  });

  it("does not reopen a completed followup while unrelated requests are updating", async () => {
    const f = fixture(); await f.read(); const initial = await f.read.readWithStatus();
    await vi.advanceTimersByTimeAsync(0); await finish(f.read);
    const query = f.holdQuery(); await f.read.readWithStatus(); await vi.advanceTimersByTimeAsync(0);
    expect(f.read.getRefreshStatus().state).toBe("UPDATING");
    expect((await f.read.readWithStatus(undefined, initial.snapshotRefresh.check)).snapshotRefresh.state).toBe("CURRENT");
    query.resolve(); await finish(f.read);
  });

  it("coalesces later original requests into one successor and never overlaps strict DB work", async () => {
    const f = fixture(); await f.read(); const gate = f.holdQuery();
    const strict = f.read(); await nextTurn();
    const first = await f.read.readWithStatus(); await vi.advanceTimersByTimeAsync(0);
    const followers = await Promise.all(Array.from({length: 40}, () => f.read.readWithStatus()));
    expect(f.stats.transactions).toBe(2); gate.resolve(); await strict; await finish(f.read);
    expect(f.stats.maximumActive).toBe(1); expect(f.stats.transactions).toBe(4);
    expect((await f.read.readWithStatus(undefined, first.snapshotRefresh.check)).snapshotRefresh.state).toBe("CURRENT");
    expect((await f.read.readWithStatus(undefined, followers.at(-1)!.snapshotRefresh.check)).snapshotRefresh.state).toBe("CURRENT");
  });

  it("does not start queued worker or strict DB work after close while a prior strict read finishes", async () => {
    const f = fixture(); await f.read(); const gate = f.holdQuery();
    const strict = f.read(); await nextTurn();
    await f.read.readWithStatus(); await vi.advanceTimersByTimeAsync(0);
    const waitingStrict = f.read();
    const outcome = Promise.allSettled([waitingStrict]);
    const closing = f.read.close(); gate.resolve(); await strict; await closing;
    expect(await outcome).toMatchObject([{status: "rejected", reason: new Error("PORTABLE_SNAPSHOT_READER_CLOSED")}]);
    expect(f.stats.transactions).toBe(2); expect(vi.getTimerCount()).toBe(0);
  });

  it("retains original content and times with FAILED when the background version check fails", async () => {
    const f = fixture(); await f.read(); f.failQuery(); const initial = await f.read.readWithStatus();
    await vi.advanceTimersByTimeAsync(0);
    const failed = await f.read.readWithStatus(undefined, initial.snapshotRefresh.check);
    expect(failed).toEqual({...initial, snapshotRefresh: {...initial.snapshotRefresh, state: "FAILED"}});
    expect(f.read.getRefreshStatus()).toMatchObject({state: "FAILED", failures: 1});
    f.failQuery(); await expect(f.read()).rejects.toThrow("version unavailable");
  });

  it.each(["forged", "expired", "other-process", "oversized"])("terminates %s checks without false CURRENT or new background work", async kind => {
    const f = fixture(); await f.read(); const initial = await f.read.readWithStatus();
    await vi.advanceTimersByTimeAsync(0); await finish(f.read);
    let check = initial.snapshotRefresh.check!;
    if (kind === "forged") check = check.slice(0, -1) + (check.endsWith("a") ? "b" : "a");
    if (kind === "expired") vi.setSystemTime(Date.now() + SNAPSHOT_CHECK_MAX_AGE_MS);
    if (kind === "other-process") {
      const other = fixture(); await other.read(); check = (await other.read.readWithStatus()).snapshotRefresh.check!;
      await vi.advanceTimersByTimeAsync(0); await finish(other.read);
    }
    if (kind === "oversized") check = "a".repeat(2000);
    const before = f.stats.transactions;
    for (let n = 0; n < 3; n++) {
      const rejected = await f.read.readWithStatus(undefined, check);
      expect(rejected.snapshot).toEqual(initial.snapshot);
      expect(rejected.snapshotRefresh).toEqual({state: "FAILED", version: initial.snapshotRefresh.version});
    }
    await vi.advanceTimersByTimeAsync(1000); expect(f.stats.transactions).toBe(before); expect(vi.getTimerCount()).toBe(0);
  });
});
