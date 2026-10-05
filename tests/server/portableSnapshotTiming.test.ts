// @vitest-environment node
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPortableSnapshotReader, createServer, type PortableSnapshotReader } from "../../src/server/httpServer";
import type { PortableSnapshotDb, PortableSnapshotTransactionDb, SnapshotReadTiming } from "../../src/db/portablePublicSnapshotRepository";
import { PORTABLE_SNAPSHOT_VERSION_TABLES } from "../../src/db/portableSnapshotCache";
import { SNAPSHOT_CHECK_MAX_AGE_MS } from "../../src/server/snapshotRefreshCheck";
import { createMemoryRateLimitStore } from "../../src/server/rateLimit";
import { accepted, job, NOW, SECOND } from "../helpers/portablePublicSnapshotFixture";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve}; }
const readers: PortableSnapshotReader[] = [];
function fixture() {
  let evidence = accepted(), jobs = [job()], digest = "a";
  let blocked: ReturnType<typeof deferred> | undefined;
  let nextError: Error | undefined;
  const query = vi.fn();
  const db = {$transaction: async (work: (tx: PortableSnapshotTransactionDb) => Promise<unknown>) => {
    const own = structuredClone({evidence, jobs, digest}), gate = blocked, error = nextError;
    blocked = undefined; nextError = undefined;
    return work({
      $queryRawUnsafe: async () => {
        query(); await gate?.promise; if (error) throw error;
        return PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation => ({relation, epoch: "0", count: "1", digest: own.digest.repeat(64)}));
      },
      crawlBatchSourceResult: {findMany: async () => [own.evidence.result]},
      lifecycleSetEvidenceMember: {findMany: async () => own.evidence.members},
      job: {findMany: async () => own.jobs}
    } as PortableSnapshotTransactionDb);
  }} as PortableSnapshotDb;
  const read = createPortableSnapshotReader(db); readers.push(read);
  const readDisplay = read.readWithStatus;
  const records: ReturnType<typeof vi.fn<SnapshotReadTiming>>[] = [];
  const display = vi.spyOn(read, "readWithStatus").mockImplementation((finished, check, record) => {
    const owned = vi.fn(record); records.push(owned);
    return readDisplay(finished, check, owned);
  });
  const server = createServer({db: {} as never, readPortableSnapshot: read,
    checkDatabaseReadiness: async () => true, rateLimitStore: createMemoryRateLimitStore()});
  return {read, query, server, display, records,
    holdQuery() {blocked = deferred(); return blocked;},
    failQuery() {nextError = new Error("version unavailable");},
    commit() {evidence = accepted(SECOND, ["job-2"]); jobs = [job("job-2", SECOND)]; digest = "b";}
  };
}

/** Exercise native HTTP headers and finish, without a listener or network. */
async function get(server: ReturnType<typeof createServer>, path: string, check?: string, consent = true) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({read() {}, write(chunk, _encoding, callback) {chunks.push(Buffer.from(chunk)); callback();}});
  const incoming = new IncomingMessage(socket as Socket);
  incoming.method = "GET"; incoming.url = path;
  incoming.headers = {host: "127.0.0.1", "accept-encoding": "gzip",
    ...(consent ? {"x-job-search-consent": "accepted"} : {}),
    ...(check === undefined ? {} : {"x-job-snapshot-check": check})};
  const response = new ServerResponse(incoming);
  response.assignSocket(socket as Socket);
  const finished = new Promise<void>(resolve => response.once("finish", resolve));
  server.emit("request", incoming, response);
  await finished;
  const wire = Buffer.concat(chunks), payload = wire.subarray(wire.indexOf("\r\n\r\n") + 4);
  const body = JSON.parse((response.getHeader("content-encoding") === "gzip" ? gunzipSync(payload) : payload).toString());
  const timing = String(response.getHeader("server-timing") ?? "");
  const stages = Object.fromEntries(timing.split(", ").filter(Boolean).map(stage => {
    const [name, duration] = stage.split(";dur="); return [name!, Number(duration)];
  }));
  socket.destroy();
  return {response, body, timing, stages};
}
async function finish(read: PortableSnapshotReader) {
  for (let n = 0; n < 300 && read.getRefreshStatus().state === "UPDATING"; n++) {
    await nextTurn(); await vi.advanceTimersByTimeAsync(1);
  }
  expect(read.getRefreshStatus().state).toBe("CURRENT");
}
function expectCachedStages(result: Awaited<ReturnType<typeof get>>, phase: "cacheClone" | "backgroundClone") {
  expect(Object.keys(result.stages)).toEqual(["app", phase, "read", "project", "JSON", "gzip"]);
  for (const duration of Object.values(result.stages)) {
    expect(Number.isFinite(duration)).toBe(true); expect(duration).toBeGreaterThanOrEqual(0);
  }
}
beforeEach(() => {
  vi.useFakeTimers({toFake: ["Date", "setTimeout", "clearTimeout"]}); vi.setSystemTime(NOW);
  vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {await Promise.all(readers.splice(0).map(read => read.close())); vi.restoreAllMocks(); vi.useRealTimers();});

describe("nonblocking request-owned HTTP timing", () => {
  it.each(["/api/search?city=%E4%B8%8A%E6%B5%B7", "/api/coverage"])("keeps %s UPDATING/CURRENT and version-switch timings owned by each response", async path => {
    const f = fixture(), initial = await f.read(); f.commit();
    vi.setSystemTime(new Date(NOW.getTime() + 1_000));
    const gate = f.holdQuery();
    const original = await get(f.server, path);
    expect(original.body.snapshotRefresh).toMatchObject({state: "UPDATING", check: expect.any(String)});
    const selectedOriginal = await f.display.mock.results[0]!.value;
    expect(selectedOriginal.snapshot.generatedAt).toBe(initial.generatedAt);
    expect(selectedOriginal.snapshot.lastUpdatedAt).toBe(initial.lastUpdatedAt);
    if (path.startsWith("/api/search")) expect(original.body.lastUpdatedAt).toBe(initial.lastUpdatedAt);
    expectCachedStages(original, "cacheClone");
    const originalCalls = structuredClone(f.records[0]!.mock.calls);
    expect(f.query).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.query).toHaveBeenCalledTimes(2);
    const updating = await get(f.server, path, original.body.snapshotRefresh.check);
    expect(updating.body).toEqual(original.body);
    expectCachedStages(updating, "backgroundClone");
    const updatingCalls = structuredClone(f.records[1]!.mock.calls);
    gate.resolve(); await finish(f.read);
    const verifiedQueryCount = f.query.mock.calls.length;
    const current = await get(f.server, path, original.body.snapshotRefresh.check);
    expect(current.body.snapshotRefresh.state).toBe("CURRENT");
    expect(current.body.snapshotRefresh.version).not.toBe(original.body.snapshotRefresh.version);
    const selectedCurrent = await f.display.mock.results.at(-1)!.value;
    expect(selectedCurrent.snapshot.generatedAt).toBe(new Date(NOW.getTime() + 1_000).toISOString());
    expect(selectedCurrent.snapshot.lastUpdatedAt).toBe(SECOND);
    if (path.startsWith("/api/search")) {
      expect(current.body.lastUpdatedAt).toBe(SECOND);
      expect(current.body.companies[0].jobs[0].id).toBe("job-2");
    }
    expectCachedStages(current, "cacheClone");
    expect(f.query).toHaveBeenCalledTimes(verifiedQueryCount);
    // Background version/build/post-build work must not append SQL to sent headers.
    expect(original.response.getHeader("server-timing")).toBe(original.timing);
    expect(updating.response.getHeader("server-timing")).toBe(updating.timing);
    expect(f.records[0]!.mock.calls).toEqual(originalCalls);
    expect(f.records[1]!.mock.calls).toEqual(updatingCalls);
  });

  it("keeps real SQL-failure/recovery responses and prior callbacks isolated from background work", async () => {
    const f = fixture(); await f.read(); f.failQuery();
    const original = await get(f.server, "/api/search?city=%E4%B8%8A%E6%B5%B7");
    const originalCalls = structuredClone(f.records[0]!.mock.calls);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.read.getRefreshStatus()).toMatchObject({state: "FAILED", failures: 1});
    const failed = await get(f.server, "/api/search?city=%E4%B8%8A%E6%B5%B7", original.body.snapshotRefresh.check);
    expect(failed.body).toEqual({...original.body, snapshotRefresh: {...original.body.snapshotRefresh, state: "FAILED"}});
    expectCachedStages(failed, "cacheClone");
    const failedCalls = structuredClone(f.records[1]!.mock.calls);
    await vi.advanceTimersByTimeAsync(1_000); await finish(f.read);
    const recovered = await get(f.server, "/api/search?city=%E4%B8%8A%E6%B5%B7", original.body.snapshotRefresh.check);
    expect(recovered.body).toEqual({...original.body, snapshotRefresh: {...original.body.snapshotRefresh, state: "CURRENT"}});
    expectCachedStages(recovered, "cacheClone");
    expect(f.query).toHaveBeenCalledTimes(3);
    expect(f.records[0]!.mock.calls).toEqual(originalCalls);
    expect(f.records[1]!.mock.calls).toEqual(failedCalls);
    expect(original.response.getHeader("server-timing")).toBe(original.timing);
    expect(failed.response.getHeader("server-timing")).toBe(failed.timing);
  });

  it.each(["forged", "expired"])("keeps %s check responses FAILED with their own clone timing and no DB work", async kind => {
    const f = fixture(); await f.read(); const original = await get(f.server, "/api/coverage");
    await vi.advanceTimersByTimeAsync(0); await finish(f.read);
    let check = original.body.snapshotRefresh.check;
    if (kind === "expired") vi.setSystemTime(Date.now() + SNAPSHOT_CHECK_MAX_AGE_MS);
    else check = "invalid-check";
    const count = f.query.mock.calls.length;
    const invalid = await get(f.server, "/api/coverage", check);
    expect(invalid.body.snapshotRefresh).toEqual({state: "FAILED", version: original.body.snapshotRefresh.version});
    const selectedOriginal = await f.display.mock.results[0]!.value;
    const selectedInvalid = await f.display.mock.results.at(-1)!.value;
    expect(selectedInvalid.snapshot).toEqual(selectedOriginal.snapshot);
    expect(invalid.body.companies).toEqual(original.body.companies);
    expectCachedStages(invalid, "cacheClone");
    expect(f.query).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps cold HTTP requests pending for real verification and attributes SQL only to its owner", async () => {
    const f = fixture(), gate = f.holdQuery(); let resolved = 0;
    const owner = get(f.server, "/api/search?city=%E4%B8%8A%E6%B5%B7").then(value => {resolved++; return value;});
    const joiner = get(f.server, "/api/coverage").then(value => {resolved++; return value;});
    await nextTurn(); expect(resolved).toBe(0); expect(f.query).toHaveBeenCalledOnce();
    gate.resolve(); const [first, second] = await Promise.all([owner, joiner]);
    expect(first.body.totalJobs).toBe(1); expect(first.body.snapshotRefresh.state).toBe("CURRENT");
    expect(second.body.snapshotRefresh).toEqual(first.body.snapshotRefresh);
    expect(Object.keys(first.stages)).toEqual(["app", "planPrep", "txAcquire", "versionSQL", "tx", "rebuild", "clone", "read", "project", "JSON", "gzip"]);
    expect(Object.keys(second.stages)).toEqual(["app", "sharedWait", "clone", "read", "project", "JSON", "gzip"]);
    expect(f.query).toHaveBeenCalledOnce();
  });

  it("never invokes the display reader before consent or for private/admin routes", async () => {
    const f = fixture(), display = vi.spyOn(f.read, "readWithStatus");
    const denied = await get(f.server, "/api/coverage", undefined, false);
    expect(denied.response.statusCode).toBe(403);
    for (const path of ["/api/feedback", "/admin/api/dashboard"]) {
      const result = await get(f.server, path, "invalid-check");
      expect(result.response.getHeader("server-timing")).toBeUndefined();
      expect(result.response.getHeader("content-encoding")).toBeUndefined();
    }
    expect(display).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled();
  });
});
