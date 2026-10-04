import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortableSnapshotReader, type PortableSnapshotReader } from "../../src/server/httpServer";
import { readPortablePublicSnapshot, type PortableSnapshotDb, type PortableSnapshotTransactionDb } from "../../src/db/portablePublicSnapshotRepository";
import { PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_TABLES } from "../../src/db/portableSnapshotCache";
import { accepted, job, plan, NOW, FIRST, SECOND } from "../helpers/portablePublicSnapshotFixture";

const readers: PortableSnapshotReader[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {resolve = done;});
  return {promise, resolve};
}
async function finishRefresh(read: PortableSnapshotReader) {
  // A fill now yields to real I/O between source units. Fake timer advancement
  // alone must not stand in for completing those event-loop turns.
  for (let turn = 0; turn < 300 && read.getRefreshStatus().state === "UPDATING"; turn++) {
    await nextTurn();
    await vi.advanceTimersByTimeAsync(1);
  }
  expect(read.getRefreshStatus().state).toBe("CURRENT");
}

function fixture() {
  const evidence = accepted();
  const versions = PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: "a".repeat(64)}));
  const tx = {
    $queryRawUnsafe: vi.fn(async () => structuredClone(versions)),
    crawlBatchSourceResult: {findMany: vi.fn(async () => [evidence.result])},
    lifecycleSetEvidenceMember: {findMany: vi.fn(async () => evidence.members)},
    job: {findMany: vi.fn(async () => [job()])}
  };
  const transaction = vi.fn(async (work: (tx: PortableSnapshotTransactionDb) => Promise<unknown>) => work(tx as PortableSnapshotTransactionDb));
  const db = {$transaction: transaction} as PortableSnapshotDb;
  const read = createPortableSnapshotReader(db);
  readers.push(read);
  const change = (digest = "b") => {versions[0]!.digest = digest.repeat(64);};
  const title = (snapshot: Awaited<ReturnType<typeof read>>) => snapshot.sources.find(source => source.sourceId === plan.source.id)!.jobs[0]?.title;
  return {tx, transaction, db, read, change, title};
}

beforeEach(() => {
  vi.useFakeTimers({toFake: ["Date", "setTimeout", "clearTimeout"]});
  vi.setSystemTime(NOW);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  await Promise.all(readers.splice(0).map(read => read.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("verified display background refresh", () => {
  it("returns the previous timestamped display immediately, coalesces the fill, and publishes a new committed batch", async () => {
    const f = fixture(), old = await f.read();
    const newer = accepted(SECOND, ["job-2"]);
    f.change();
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, newer.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(newer.members);
    const gate = deferred();
    f.tx.job.findMany.mockImplementationOnce(async () => {await gate.promise; return [job("job-2", SECOND)];});
    vi.setSystemTime(new Date(NOW.getTime() + 1_000));
    expect(await f.read()).toEqual(old);
    expect(f.tx.job.findMany).toHaveBeenCalledOnce();
    expect(f.read.getRefreshStatus().state).toBe("UPDATING");
    await vi.advanceTimersByTimeAsync(0);
    const transactionsWhileBlocked = f.transaction.mock.calls.length;
    const [first, second] = await Promise.all([f.read(), f.read()]);
    expect(first).toEqual(old);
    expect(second).toEqual(old);
    expect(f.transaction).toHaveBeenCalledTimes(transactionsWhileBlocked);
    first.sources[0]!.reasons.push("LAST_GOOD_STALE");
    expect(second).toEqual(old);
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
    gate.resolve();
    await finishRefresh(f.read);
    const current = await f.read();
    expect(current.sources.find(source => source.sourceId === plan.source.id)).toMatchObject({lastAcceptedAt: SECOND, jobs: [{id: "job-2"}]});
    expect(current.generatedAt).toBe(new Date(NOW.getTime() + 1_000).toISOString());
    expect(current.lastUpdatedAt).toBe(SECOND);
    expect(f.read.getRefreshStatus()).toMatchObject({state: "CURRENT", failures: 0, lastVerifiedAt: current.generatedAt});
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
  });

  it("detects a commit during the fill and performs another real version check and rebuild without new traffic", async () => {
    const f = fixture(); await f.read(); f.change();
    f.tx.job.findMany.mockImplementationOnce(async () => {
      f.change("c");
      f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "latest committed value"}]);
      return [{...job(), humanCorrectedTitle: "intermediate verified value"}];
    });
    await f.read();
    await vi.advanceTimersByTimeAsync(1);
    await finishRefresh(f.read);
    expect(f.title(await f.read())).toBe("latest committed value");
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(3);
    expect(console.info).toHaveBeenCalledWith("PORTABLE_SNAPSHOT_REFRESH_COMPLETED", expect.any(Object));
  });

  it("replaces an older publishing result with a fully rebuilt integrity HOLD", async () => {
    const f = fixture(), old = await f.read(); f.change();
    f.tx.job.findMany.mockResolvedValue([]);
    expect(await f.read()).toEqual(old);
    await vi.advanceTimersByTimeAsync(0);
    await finishRefresh(f.read);
    const next = await f.read();
    expect(next.sources.find(source => source.sourceId === plan.source.id)).toMatchObject({state: "HOLD", reasons: ["PROJECTION_INTEGRITY_HOLD"]});
    expect(next.totalJobs).toBe(0);
    expect(f.read.getRefreshStatus().state).toBe("CURRENT");
  });

  it("retains the verified display after technical failure and retries with capped backoff until success without traffic", async () => {
    const f = fixture(), old = await f.read(); f.change();
    f.tx.job.findMany.mockRejectedValue(new Error("technical read failure"));
    expect(await f.read()).toEqual(old);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.read.getRefreshStatus()).toMatchObject({state: "FAILED", failures: 1, nextRetryAt: new Date(NOW.getTime() + 1_000).toISOString()});
    const transactionsDuringBackoff = f.transaction.mock.calls.length;
    expect(await f.read()).toEqual(old);
    expect(f.transaction).toHaveBeenCalledTimes(transactionsDuringBackoff + 1);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    for (const delay of [2_000, 4_000, 8_000, 16_000, 30_000]) await vi.advanceTimersByTimeAsync(delay);
    expect(f.read.getRefreshStatus()).toMatchObject({state: "FAILED", failures: 7});
    expect(Date.parse(f.read.getRefreshStatus().nextRetryAt!) - Date.now()).toBe(30_000);
    expect(console.error).toHaveBeenCalledWith("PORTABLE_SNAPSHOT_REFRESH_FAILED", expect.objectContaining({failures: 7, lastVerifiedAt: old.generatedAt}));
    f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "retry recovered"}]);
    await vi.advanceTimersByTimeAsync(30_000);
    await finishRefresh(f.read);
    expect(f.title(await f.read())).toBe("retry recovered");
    expect(f.read.getRefreshStatus()).toMatchObject({state: "CURRENT", failures: 0, nextRetryAt: null});
  });

  it("keeps foreground version-query failures fail-closed even while the previous display exists", async () => {
    const f = fixture(); await f.read();
    f.tx.$queryRawUnsafe.mockRejectedValueOnce(new Error("version unavailable"));
    await expect(f.read()).rejects.toThrow("version unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rebuilds a time-boundary change without rewriting the previous snapshot time", async () => {
    const f = fixture(), boundary = Date.parse(FIRST) + 30 * 60 * 60_000;
    vi.setSystemTime(new Date(boundary - 1));
    const old = await f.read();
    vi.setSystemTime(new Date(boundary));
    expect(await f.read()).toEqual(old);
    await vi.advanceTimersByTimeAsync(0);
    await finishRefresh(f.read);
    const next = await f.read();
    expect(next.sources.find(source => source.sourceId === plan.source.id)).toMatchObject({state: "PUBLISHING", freshness: "STALE", staleJobCount: 1});
    expect(next.generatedAt).toBe(new Date(boundary).toISOString());
  });

  it("never reuses a previous display for a changed selection policy or separate database reader", async () => {
    const f = fixture(), cache = new PortableSnapshotCache(), refresh = vi.fn();
    await readPortablePublicSnapshot(f.db, {currentTime: NOW}, [plan], cache);
    await readPortablePublicSnapshot(f.db, {currentTime: NOW, freshnessMaximumMs: 60_000}, [plan], cache, refresh);
    expect(refresh).not.toHaveBeenCalled();
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
    const other = fixture();
    other.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "different database"}]);
    expect(other.title(await other.read())).toBe("different database");
    expect(f.title(await f.read())).toBe("销售职位");
  });

  it("cancels pending retries on shutdown and refuses new reads", async () => {
    const f = fixture(); await f.read(); f.change();
    f.tx.job.findMany.mockRejectedValue(new Error("technical read failure"));
    await f.read(); await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await f.read.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
    await expect(f.read()).rejects.toThrow("PORTABLE_SNAPSHOT_READER_CLOSED");
  });
});
