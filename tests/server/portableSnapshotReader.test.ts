import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortableSnapshotReader } from "../../src/server/httpServer";
import { handlePublicApi, type PublicApiDeps } from "../../src/server/publicApi";
import { createMemoryRateLimitStore } from "../../src/server/rateLimit";
import type { PortableSnapshotDb, PortableSnapshotTransactionDb } from "../../src/db/portablePublicSnapshotRepository";
import { accepted, job, plan, NOW } from "../helpers/portablePublicSnapshotFixture";
import { PORTABLE_SNAPSHOT_VERSION_TABLES } from "../../src/db/portableSnapshotCache";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const readers: ReturnType<typeof createPortableSnapshotReader>[] = [];
function fixture() {
  const evidence = accepted();
  const tx = {
    crawlBatchSourceResult: { findMany: vi.fn(async () => [evidence.result]) },
    lifecycleSetEvidenceMember: { findMany: vi.fn(async () => evidence.members) },
    job: { findMany: vi.fn(async () => [job()]) }
  };
  const transaction = vi.fn(async (work: (db: PortableSnapshotTransactionDb) => Promise<unknown>) => work(tx));
  const db = { $transaction: transaction } as PortableSnapshotDb;
  const read = createPortableSnapshotReader(db); readers.push(read);
  return { tx, transaction, read };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(async () => {await Promise.all(readers.splice(0).map(read => read.close())); vi.useRealTimers();});

describe("portable snapshot reader", () => {
  it("serves simultaneous filtered search and coverage before the shared version check after warmup", async () => {
    const f = fixture();
    const query = vi.fn(async () => PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: "a".repeat(64)})));
    Object.assign(f.tx, {$queryRawUnsafe: query});
    await f.read();
    const gate = deferred();
    query.mockImplementationOnce(async () => {await gate.promise; return PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: "a".repeat(64)}));});
    const deps: PublicApiDeps = {db: {} as PublicApiDeps["db"], checkDatabaseReadiness: async () => true,
      rateLimitStore: createMemoryRateLimitStore(), readPortableSnapshot: f.read};
    const request = {method: "GET", query: {city: "上海", keyword: "不存在的职位"},
      headers: {"x-job-search-consent": "accepted"}, body: undefined, ip: "127.0.0.1"};
    const search = handlePublicApi({...request, path: "/api/search"}, deps);
    const coverage = handlePublicApi({...request, query: {}, path: "/api/coverage"}, deps);
    gate.resolve();
    const [searchResult, coverageResult] = await Promise.all([search, coverage]);
    expect(searchResult).toMatchObject({status: 200, body: {totalJobs: 0, coverageSummary: {publishingCompanyCount: 1}}});
    expect(coverageResult).toMatchObject({status: 200, body: {coverageSummary: {publishingCompanyCount: 1}}});
    expect(query).toHaveBeenCalledOnce();
    for (let turn = 0; turn < 100 && query.mock.calls.length < 2; turn++) await nextTurn();
    expect(query).toHaveBeenCalledTimes(2);
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(f.tx.job.findMany).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent search and coverage into one unchanged three-query repeatable-read snapshot", async () => {
    const f = fixture();
    const gate = deferred();
    f.transaction.mockImplementationOnce(async work => { await gate.promise; return work(f.tx); });
    const deps: PublicApiDeps = {
      db: {} as PublicApiDeps["db"],
      checkDatabaseReadiness: async () => true,
      rateLimitStore: createMemoryRateLimitStore(),
      readPortableSnapshot: f.read
    };
    const readWithStatus = vi.spyOn(f.read, "readWithStatus");
    const request = { method: "GET", query: { city: "上海" }, headers: { "x-job-search-consent": "accepted" }, body: undefined, ip: "127.0.0.1" };
    const search = handlePublicApi({ ...request, path: "/api/search" }, deps);
    const coverage = handlePublicApi({ ...request, path: "/api/coverage" }, deps);
    expect(readWithStatus).toHaveBeenCalledTimes(2);
    expect(f.transaction).toHaveBeenCalledTimes(1);
    gate.resolve();
    const [searchResponse, coverageResponse] = await Promise.all([search, coverage]);
    expect(searchResponse).toMatchObject({ status: 200, body: { totalJobs: 1, companies: [{ id: plan.company.id, jobs: [{ id: "job-1" }] }] } });
    expect(coverageResponse).toMatchObject({ status: 200, body: {
      companies: expect.arrayContaining([expect.objectContaining({ id: plan.company.id, state: "PUBLISHING", health: "HEALTHY" })]),
      coverageSummary: { publishingCompanyCount: 1 }
    } });
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 10_000 });
    for (const model of Object.values(f.tx)) expect(model.findMany).toHaveBeenCalledTimes(1);
  });

  it("gives overlapping callers independent nested snapshot objects", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([f.read(), f.read()]);
    const original = structuredClone(second);
    expect(first).toEqual(second);
    first.companies.find(company => company.id === plan.company.id)!.jobs[0]!.title = "request-local title";
    first.companies.find(company => company.id === plan.company.id)!.publishingSourceIds.length = 0;
    first.sources.find(source => source.sourceId === plan.source.id)!.reasons.push("LAST_GOOD_STALE");
    first.coverage.publishingSourceCount = 0;
    expect(second).toEqual(original);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });

  it("reads fresh rows and time for every serial call after success", async () => {
    const f = fixture();
    const first = await f.read();
    vi.setSystemTime(new Date(NOW.getTime() + 1_000));
    f.tx.job.findMany.mockResolvedValueOnce([{ ...job(), officialTitle: "更新后的职位" }]);
    const second = await f.read();
    expect(f.transaction).toHaveBeenCalledTimes(2);
    expect(first.generatedAt).toBe(NOW.toISOString());
    expect(second.generatedAt).toBe(new Date(NOW.getTime() + 1_000).toISOString());
    expect(second.companies.find(company => company.id === plan.company.id)!.jobs[0]!.title).toBe("更新后的职位");
    expect(first.companies.find(company => company.id === plan.company.id)!.jobs[0]!.title).toBe("销售职位");
  });

  it("rejects all concurrent callers without a stale success fallback and retries after failure", async () => {
    const f = fixture();
    expect((await f.read()).totalJobs).toBe(1);
    const gate = deferred();
    const error = new Error("snapshot transaction failed");
    f.transaction.mockImplementationOnce(async work => { await gate.promise; return work(f.tx); });
    const failures = Promise.allSettled([f.read(), f.read()]);
    expect(f.transaction).toHaveBeenCalledTimes(2);
    gate.reject(error);
    expect(await failures).toEqual([{ status: "rejected", reason: error }, { status: "rejected", reason: error }]);
    expect((await f.read()).totalJobs).toBe(1);
    expect(f.transaction).toHaveBeenCalledTimes(3);
  });

  it("keeps distinct database dependencies isolated", async () => {
    const first = fixture();
    const second = fixture();
    second.tx.job.findMany.mockResolvedValueOnce([{ ...job(), officialTitle: "另一个数据库的职位" }]);
    const snapshots = await Promise.all([first.read(), second.read()]);
    expect(first.transaction).toHaveBeenCalledTimes(1);
    expect(second.transaction).toHaveBeenCalledTimes(1);
    expect(snapshots.map(snapshot => snapshot.companies.find(company => company.id === plan.company.id)!.jobs[0]!.title))
      .toEqual(["销售职位", "另一个数据库的职位"]);
  });
});
