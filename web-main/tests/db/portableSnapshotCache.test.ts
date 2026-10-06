import { portableSnapshotIdentities } from "../../src/db/portableDisplayIdentity";
import { describe, expect, it, vi } from "vitest";
import { readPortablePublicSnapshot, type PortableSnapshotDb, type PortableSnapshotTransactionDb } from "../../src/db/portablePublicSnapshotRepository";
import { PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_TABLES, PORTABLE_SNAPSHOT_VERSION_SQL,
  portableDisplayVersion, portableSnapshotVersion, portableSnapshotValidUntil } from "../../src/db/portableSnapshotCache";
import { accepted, failed, job, plan, NOW, FIRST, SECOND } from "../helpers/portablePublicSnapshotFixture";

function versions() {
  return PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: "a".repeat(64)}));
}
function fixture(cache = new PortableSnapshotCache()) {
  const evidence = accepted();
  const versionRows = versions();
  const events: string[] = [];
  const tx = {
    $queryRawUnsafe: vi.fn(async () => {events.push("VERSION"); return structuredClone(versionRows);}),
    crawlBatchSourceResult: {findMany: vi.fn(async () => {events.push("RESULTS"); return [evidence.result];})},
    lifecycleSetEvidenceMember: {findMany: vi.fn(async () => evidence.members)},
    job: {findMany: vi.fn(async () => [job()])}
  };
  const transaction = vi.fn(async (work: (db: PortableSnapshotTransactionDb) => Promise<unknown>) => {
    events.push("BEGIN"); const value = await work(tx as PortableSnapshotTransactionDb); events.push("END"); return value;
  });
  const db = {$transaction: transaction} as PortableSnapshotDb;
  const read = (now = NOW) => readPortablePublicSnapshot(db, {currentTime: now}, [plan], cache);
  const change = (relation: string) => {versionRows.find(row => row.relation === relation)!.digest = "b".repeat(64);};
  return {cache, tx, db, transaction, events, read, versionRows, change};
}

describe("database-versioned portable projection", () => {
  it("checks every request in RepeatableRead while reusing only the unchanged projection", async () => {
    const f = fixture();
    const first = await f.read();
    const next = new Date(NOW.getTime() + 1_000);
    const second = await f.read(next);
    expect(second).toEqual(first);
    expect(f.events).toEqual(["BEGIN", "VERSION", "RESULTS", "END", "BEGIN", "VERSION", "END"]);
    expect(f.tx.$queryRawUnsafe).toHaveBeenCalledWith(PORTABLE_SNAPSHOT_VERSION_SQL);
    expect(f.transaction).toHaveBeenLastCalledWith(expect.any(Function), {isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 10_000});
    second.sources[0]!.jobs[0]!.title = "caller mutation";
    expect((await f.read()).sources[0]!.jobs[0]!.title).toBe("销售职位");
    expect(f.tx.job.findMany).toHaveBeenCalledOnce();
  });

  it.each(PORTABLE_SNAPSHOT_VERSION_TABLES)("invalidates immediately when %s changes", async relation => {
    const f = fixture(); await f.read(); f.change(relation);
    await f.read();
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });

  it("shows a newly committed batch, applies human corrections and holds missing mutable jobs", async () => {
    const f = fixture(); await f.read();
    const newer = accepted(SECOND, ["job-2"]);
    f.change("CrawlBatchSourceResult");
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, newer.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(newer.members);
    f.tx.job.findMany.mockResolvedValue([job("job-2", SECOND)]);
    expect((await f.read()).sources[0]).toMatchObject({lastAcceptedAt: SECOND, visibilityFloor: FIRST, jobs: [{id: "job-2"}]});
    f.change("Job");
    f.tx.job.findMany.mockResolvedValue([{...job("job-2", SECOND), humanCorrectedTitle: "已更正标题"}]);
    expect((await f.read()).sources[0]!.jobs[0]!.title).toBe("已更正标题");
    f.versionRows.find(row => row.relation === "Job")!.count = "0";
    f.tx.job.findMany.mockResolvedValue([]);
    expect((await f.read()).sources[0]).toMatchObject({state: "HOLD", visibleJobCount: null, reasons: ["PROJECTION_INTEGRITY_HOLD"]});
  });

  it("keeps a content identity with its selected display even for same-time mutable corrections", async () => {
    const f = fixture(), initial = await f.read();
    const old = f.cache.getDuringRefreshRead(NOW.getTime())!;
    expect(old).toEqual({snapshot: initial, ...portableSnapshotIdentities(initial)});
    f.change("Job");
    f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "same-time correction"}]);
    const next = await f.read();
    expect(next.generatedAt).toBe(initial.generatedAt);
    const current = f.cache.getDuringRefreshRead(NOW.getTime())!;
    expect(current.version).not.toBe(old.version);
    old.snapshot.sources[0]!.jobs[0]!.title = "caller mutation";
    expect(f.cache.getDuringRefreshRead(NOW.getTime())).toEqual(current);
    expect(current.version).toBe(portableDisplayVersion(current.snapshot));
  });

  it("rechecks failed/latest-attempt health without replacing accepted jobs", async () => {
    const f = fixture(); await f.read(); f.change("CrawlBatchSourceResult");
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, failed()]);
    expect((await f.read()).sources[0]).toMatchObject({state: "PUBLISHING", health: "DEGRADED", visibleJobCount: 1, reasons: ["LATEST_ATTEMPT_FAILED"]});
  });

  it("fails closed on a version read error or incomplete dependency result", async () => {
    const f = fixture(); await f.read();
    f.tx.$queryRawUnsafe.mockRejectedValueOnce(new Error("database offline"));
    await expect(f.read()).rejects.toThrow("database offline");
    f.tx.$queryRawUnsafe.mockResolvedValueOnce(f.versionRows.slice(1));
    await expect(f.read()).rejects.toThrow("INVALID_PORTABLE_SNAPSHOT_VERSION");
    expect((await f.read()).totalJobs).toBe(1);
  });

  it("does not serve the old success after a changed-version rebuild fails", async () => {
    const f = fixture(); await f.read(); f.change("Job");
    f.tx.job.findMany.mockRejectedValueOnce(new Error("job read failed"));
    await expect(f.read()).rejects.toThrow("job read failed");
    f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "recovered read"}]);
    expect((await f.read()).sources[0]!.jobs[0]!.title).toBe("recovered read");
    expect(f.tx.job.findMany).toHaveBeenCalledTimes(3);
  });

  it("retains the version from the same snapshot if a commit occurs during a fill", async () => {
    const f = fixture();
    f.tx.job.findMany.mockImplementationOnce(async () => {f.change("Job"); return [job()];});
    await f.read();
    f.tx.job.findMany.mockResolvedValue([{...job(), humanCorrectedTitle: "new commit"}]);
    expect((await f.read()).sources[0]!.jobs[0]!.title).toBe("new commit");
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });

  it("recomputes at 30 hours while preserving accepted old jobs", async () => {
    const f = fixture();
    const boundary = Date.parse(FIRST) + 30 * 60 * 60_000;
    expect((await f.read(new Date(boundary - 1))).sources[0]).toMatchObject({freshness: "FRESH", staleJobCount: 0});
    expect((await f.read(new Date(boundary))).sources[0]).toMatchObject({state: "PUBLISHING", freshness: "STALE", staleJobCount: 1, visibleJobCount: 1});
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });

  it("ignores an unselected historical receipt's 30-hour boundary but keeps the selected source boundary", async () => {
    const f = fixture(), newer = accepted(SECOND, ["job-2"]);
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, newer.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(newer.members);
    f.tx.job.findMany.mockResolvedValue([job("job-2", SECOND)]);
    const historicalBoundary = Date.parse(FIRST) + 30 * 60 * 60_000;
    const before = await f.read(new Date(historicalBoundary - 1));
    expect(before.sources[0]).toMatchObject({selectedSourceResultId: newer.result.id, freshness: "FRESH", staleJobCount: 0});
    expect(await f.read(new Date(historicalBoundary))).toEqual(before);
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledOnce();
    const currentBoundary = Date.parse(SECOND) + 30 * 60 * 60_000;
    expect((await f.read(new Date(currentBoundary))).sources[0]).toMatchObject({state: "PUBLISHING", freshness: "STALE", staleJobCount: 1, visibleJobCount: 1});
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });

  it("keeps a projected grace job's earlier freshness boundary while its source remains fresh", async () => {
    const f = fixture(), newer = accepted(SECOND, ["job-2"], ["job-1"]);
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, newer.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(newer.members);
    f.tx.job.findMany.mockResolvedValue([job("job-1", FIRST, 1), job("job-2", SECOND)]);
    const boundary = Date.parse(FIRST) + 30 * 60 * 60_000;
    expect((await f.read(new Date(boundary - 1))).sources[0]).toMatchObject({state: "PUBLISHING", freshness: "FRESH", staleJobCount: 0, visibleJobCount: 2});
    expect((await f.read(new Date(boundary))).sources[0]).toMatchObject({state: "PUBLISHING", freshness: "FRESH", staleJobCount: 1, visibleJobCount: 2});
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });

  it("still rechecks a held future receipt when its absolute timestamp arrives", async () => {
    const f = fixture(), future = accepted(SECOND, ["job-2"]);
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result, future.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(future.members);
    f.tx.job.findMany.mockResolvedValue([job("job-2", SECOND)]);
    expect((await f.read(new Date(Date.parse(SECOND) - 1))).sources[0]).toMatchObject({state: "HOLD", selectedSourceResultId: accepted().result.id});
    expect((await f.read(new Date(SECOND))).sources[0]).toMatchObject({state: "PUBLISHING", selectedSourceResultId: future.result.id, visibleJobCount: 1});
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });

  it("retries a future-dated integrity hold at the exact time boundary and on clock rollback", async () => {
    const f = fixture();
    expect((await f.read(new Date(Date.parse(FIRST) - 1))).sources[0]!.state).toBe("HOLD");
    expect((await f.read(new Date(FIRST))).sources[0]!.state).toBe("PUBLISHING");
    expect((await f.read(new Date(Date.parse(FIRST) - 1))).sources[0]!.state).toBe("HOLD");
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(3);
  });

  it("does not reuse oversized entries or a projection under a different freshness policy", async () => {
    const tiny = fixture(new PortableSnapshotCache(1));
    await tiny.read(); await tiny.read();
    expect(tiny.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
    const f = fixture(); await f.read();
    await readPortablePublicSnapshot(f.db, {currentTime: NOW, freshnessMaximumMs: 60_000}, [plan], f.cache);
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("version and time boundaries", () => {
  it("includes epoch and every tuple-set count/hash, regardless of SQL row order", () => {
    const rows = versions(), original = portableSnapshotVersion(rows);
    expect(portableSnapshotVersion([...rows].reverse())).toBe(original);
    rows[0]!.epoch = "1";
    expect(portableSnapshotVersion(rows)).not.toBe(original);
    expect(() => portableSnapshotVersion([...rows.slice(1), rows[1]])).toThrow("INVALID_PORTABLE_SNAPSHOT_VERSION");
  });
  it("expires before nested B-grade validation expiry or a future evidence timestamp", () => {
    const now = NOW.getTime(), expiry = now + 60_000;
    expect(portableSnapshotValidUntil({certificate: {independentValidation: {expiresAt: new Date(expiry).toISOString()}}}, now, 30 * 60 * 60_000, {sources: []})).toBe(expiry);
    expect(portableSnapshotValidUntil({certificate: {pages: [{rawRows: [{rawPayload: {capturedAt: new Date(now + 1).toISOString()}}]}]}}, now, 30 * 60 * 60_000, {sources: []})).toBe(now + 1);
    expect(portableSnapshotValidUntil({capturedAt: new Date(expiry).toUTCString()}, now, 30 * 60 * 60_000, {sources: []})).toBe(expiry);
  });
});
