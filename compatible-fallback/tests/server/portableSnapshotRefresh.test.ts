import { Prisma } from "@prisma/client";
import { portableSnapshotIdentities } from "../../src/db/portableDisplayIdentity";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePublicApi, type PublicApiDeps } from "../../src/server/publicApi";
import { createMemoryRateLimitStore } from "../../src/server/rateLimit";
import { createPortableSnapshotReader, type PortableSnapshotReader } from "../../src/server/httpServer";
import { readPortablePublicSnapshot, type PortableSnapshotDb, type PortableSnapshotTransactionDb } from "../../src/db/portablePublicSnapshotRepository";
import { PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_TABLES } from "../../src/db/portableSnapshotCache";
import { accepted, failed, job, plan, NOW, FIRST, SECOND } from "../helpers/portablePublicSnapshotFixture";

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
  it("waits for every coalesced triggering response, then refreshes without further traffic", async () => {
    const f = fixture(), initial = await f.read.readWithStatus();
    const first = deferred(), second = deferred();
    f.change();
    const [one, two] = await Promise.all([f.read.readWithStatus(first.promise), f.read.readWithStatus(second.promise)]);
    expect(one).toEqual({...initial, snapshotRefresh: {...initial.snapshotRefresh, state: "UPDATING"}});
    expect(two).toEqual(one);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.tx.job.findMany).toHaveBeenCalledOnce();
    first.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.tx.job.findMany).toHaveBeenCalledOnce();
    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await finishRefresh(f.read);
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
  });

  it("does not let later responses indefinitely extend an already queued refresh", async () => {
    const f = fixture(); await f.read(); f.change();
    const triggering = deferred(), later = deferred();
    await f.read.readWithStatus(triggering.promise);
    await f.read.readWithStatus(later.promise);
    triggering.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await finishRefresh(f.read);
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
    later.resolve();
  });

  it("cancels a response-barrier refresh on shutdown", async () => {
    const f = fixture(); await f.read(); f.change();
    const response = deferred();
    await f.read.readWithStatus(response.promise);
    await f.read.close();
    response.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.tx.job.findMany).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

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
    const timing = vi.fn();
    const [measured, second] = await Promise.all([f.read.readWithStatus(undefined, timing), f.read()]);
    const first = measured.snapshot;
    expect(first).toEqual(old);
    expect(second).toEqual(old);
    expect(timing.mock.calls.map(([phase]) => phase)).toEqual(["backgroundClone"]);
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

  it("still checks commits after rebuilding exactly unchanged data and verification identities", async () => {
    const f = fixture(), initial = await f.read(); f.change();
    f.tx.job.findMany.mockImplementationOnce(async () => {
      f.change("c");
      f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "commit during identical rebuild"}]);
      // Same rows and frozen time produce exactly the old full snapshot hash.
      return [job()];
    });
    const first = (await f.read.readWithStatus()).snapshot;
    expect(first).toEqual(initial);
    await vi.advanceTimersByTimeAsync(0);
    await finishRefresh(f.read);
    expect(f.title(await f.read())).toBe("commit during identical rebuild");
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(3);
  });

  it("performs the post-build check for a status-only rebuild with a concurrent commit", async () => {
    const f = fixture(), initial = portableSnapshotIdentities(await f.read()); f.change();
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, failed()]);
    const builds: ReturnType<typeof portableSnapshotIdentities>[] = [];
    const setRead = PortableSnapshotCache.prototype.setRead;
    vi.spyOn(PortableSnapshotCache.prototype, "setRead").mockImplementation(function(this: PortableSnapshotCache, ...args) {
      const identity = setRead.apply(this, args); builds.push(identity); return identity;
    });
    f.tx.job.findMany.mockImplementationOnce(async () => {
      f.change("c");
      f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "commit during status-only rebuild"}]);
      return [job()];
    });
    await f.read.readWithStatus();
    await vi.advanceTimersByTimeAsync(0);
    await finishRefresh(f.read);
    expect(builds[0]!.displayDataVersion).toBe(initial.displayDataVersion);
    expect(builds[0]!.statusVersion).not.toBe(initial.statusVersion);
    expect(f.title(await f.read())).toBe("commit during status-only rebuild");
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(3);
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
    f.tx.job.findMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("secret-sentinel-postgresql://private", {code: "P2028", clientVersion: "private", meta: {password: "secret-sentinel"}}));
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
    expect(console.error).toHaveBeenCalledWith("PORTABLE_SNAPSHOT_REFRESH_FAILED", expect.objectContaining({failures: 7, lastVerifiedAt: old.generatedAt, error: {type: "PrismaClientKnownRequestError", code: "P2028"}}));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/secret-sentinel|postgresql|password|private/);
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

  it("binds old search/coverage metadata before a concurrent rebuild completes, with no new timestamp", async () => {
    const f = fixture(), initial = await f.read.readWithStatus();
    expect(initial.snapshotRefresh).toMatchObject({state: "CURRENT", version: expect.stringMatching(/^[a-f0-9]{64}$/)});
    const newer = accepted(SECOND, ["job-2"]);
    f.change();
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, newer.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(newer.members);
    f.tx.job.findMany.mockResolvedValue([job("job-2", SECOND)]);
    const delivered = deferred(), selected = deferred();
    let reads = 0;
    const read = Object.assign(f.read.bind(undefined), {readWithStatus: async () => {
      const result = await f.read.readWithStatus();
      if (++reads === 2) selected.resolve();
      await delivered.promise;
      return result;
    }});
    const deps: PublicApiDeps = {db: {} as PublicApiDeps["db"], checkDatabaseReadiness: async () => true,
      rateLimitStore: createMemoryRateLimitStore(), readPortableSnapshot: read};
    const request = {method: "GET", query: {city: "上海"}, headers: {"x-job-search-consent": "accepted"}, body: undefined, ip: "127.0.0.1"};
    const search = handlePublicApi({...request, path: "/api/search"}, deps);
    const coverage = handlePublicApi({...request, query: {}, path: "/api/coverage"}, deps);
    await selected.promise;
    await vi.advanceTimersByTimeAsync(0);
    await finishRefresh(f.read);
    expect(f.read.getRefreshStatus().state).toBe("CURRENT");
    delivered.resolve();
    const [oldSearch, oldCoverage] = await Promise.all([search, coverage]);
    expect(oldSearch).toMatchObject({status: 200, body: {lastUpdatedAt: initial.snapshot.lastUpdatedAt,
      companies: [{jobs: [{id: "job-1"}]}], snapshotRefresh: {...initial.snapshotRefresh, state: "UPDATING"}}});
    expect(oldCoverage).toMatchObject({status: 200, body: {snapshotRefresh: {...initial.snapshotRefresh, state: "UPDATING"}}});
    const current = await handlePublicApi({...request, path: "/api/search"}, deps);
    expect(current).toMatchObject({status: 200, body: {lastUpdatedAt: SECOND, companies: [{jobs: [{id: "job-2"}]}], snapshotRefresh: {state: "CURRENT"}}});
    expect((current.body as {snapshotRefresh: {version: string}}).snapshotRefresh.version).not.toBe(initial.snapshotRefresh.version);
  });

  it("reports a failed refresh with the retained display identity, then recovers without mutating that response", async () => {
    const f = fixture(), initial = await f.read.readWithStatus();
    f.change();
    f.tx.job.findMany.mockRejectedValueOnce(new Error("technical read failure"));
    expect((await f.read.readWithStatus()).snapshotRefresh).toEqual({...initial.snapshotRefresh, state: "UPDATING"});
    await vi.advanceTimersByTimeAsync(0);
    const failedRead = await f.read.readWithStatus();
    expect(failedRead).toEqual({...initial, snapshotRefresh: {...initial.snapshotRefresh, state: "FAILED"}});
    f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "after recovery"}]);
    await vi.advanceTimersByTimeAsync(1_000);
    await finishRefresh(f.read);
    const recovered = await f.read.readWithStatus();
    expect(recovered.snapshotRefresh.state).toBe("CURRENT");
    expect(recovered.snapshotRefresh.version).not.toBe(failedRead.snapshotRefresh.version);
    expect(failedRead).toEqual({...initial, snapshotRefresh: {...initial.snapshotRefresh, state: "FAILED"}});
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
