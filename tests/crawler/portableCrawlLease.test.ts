import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquirePortableCrawlLease, fencePortableCrawlPublication, heartbeatPortableCrawlLease,
  PORTABLE_CRAWL_HEARTBEAT_MS, PORTABLE_CRAWL_LEASE_MS, PORTABLE_CRAWL_LOCK_ID,
  releasePortableCrawlLease, withPortableCrawlLease,
  type PortableCrawlLease, type PortableLeaseDatabase, type PortableLeaseTransaction
} from "../../src/crawler/portableCrawlLease";

// SQL adapter seam only: real transaction/row-lock behavior needs PostgreSQL
// integration tests before operational deployment. No database is contacted.
function fixture() {
  let row: { holderId: string; at: number } | undefined;
  let now = 1_000_000;
  let fail: "acquire" | "heartbeat" | "release" | undefined;
  const events: Array<{ sql: string; values: unknown[] }> = [];
  const tx: PortableLeaseTransaction = {
    $queryRawUnsafe: async <T>(sql: string, ...values: unknown[]) => {
      events.push({ sql, values });
      expect(values[0]).toBe(PORTABLE_CRAWL_LOCK_ID);
      let result: unknown;
      if (sql.startsWith("INSERT")) {
        if (fail === "acquire") throw Error("database unavailable");
        if (!row || row.holderId === "" || row.at <= now - PORTABLE_CRAWL_LEASE_MS) {
          row = { holderId: values[1] as string, at: now }; result = [{ holderId: row.holderId }];
        } else result = [];
      } else if (sql.startsWith("SELECT")) {
        result = row ? [{ id: PORTABLE_CRAWL_LOCK_ID }] : [];
      } else if (sql.includes('"holderId" = \'\'')) {
        if (fail === "release") throw Error("release failed");
        if (row?.holderId === values[1]) { row = { holderId: "", at: now }; result = [{ holderId: "" }]; }
        else result = [];
      } else {
        if (fail === "heartbeat") throw Error("heartbeat failed");
        if (row && row.holderId === values[1] && row.at > now - PORTABLE_CRAWL_LEASE_MS) {
          row.at = now; result = [{ holderId: row.holderId }];
        } else result = [];
      }
      return result as T;
    }
  };
  const options: unknown[] = [];
  const db: PortableLeaseDatabase = { $transaction: async (work, option) => {
    options.push(option); return work(tx);
  } };
  return { db, tx, events, options, advance(ms: number) { now += ms; },
    breakQuery(value: typeof fail) { fail = value; }, row: () => row, remove() { row = undefined; } };
}

afterEach(() => vi.useRealTimers());
describe("portable database crawl lease", () => {
  it("uses the existing seed identity, database time and parameterized atomic acquisition", async () => {
    const f = fixture(); const lease = await acquirePortableCrawlLease(f.db);
    expect(lease.lockId).toBe("formal-crawl"); expect(lease.holderId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(Object.isFrozen(lease)).toBe(true);
    expect(f.events[0]!.sql).toContain('ON CONFLICT ("id") DO UPDATE');
    expect(f.events[0]!.sql).toContain("clock_timestamp()");
    expect(f.events[0]!.values).toEqual(["formal-crawl", lease.holderId, 300_000]);
    expect(f.options).toEqual([{ maxWait: 5_000, timeout: 10_000 }]);
    await expect(acquirePortableCrawlLease(f.db)).rejects.toThrow("CRAWL_LEASE_BUSY");
    expect(f.row()?.holderId).toBe(lease.holderId);
  });
  it("waits beyond the bounded publication transaction only for heartbeat, with fresh fenced time", async () => {
    const f=fixture();const lease=await acquirePortableCrawlLease(f.db);
    await heartbeatPortableCrawlLease(f.db,lease);
    expect(f.options.at(-1)).toEqual({maxWait:5000,timeout:150000});
    expect(f.events.slice(-2).map(e=>e.sql.trim().split(/\s/u)[0])).toEqual(["SELECT","UPDATE"]);
    expect(f.events.at(-2)!.sql).toContain("FOR UPDATE");
    expect(f.events.at(-1)!.sql).toContain("clock_timestamp()");
    await releasePortableCrawlLease(f.db,lease);
    expect(f.options.at(-1)).toEqual({maxWait:5000,timeout:10000});
    expect(150000).toBeLessThan(PORTABLE_CRAWL_LEASE_MS);
  });
  it("does not renew a heartbeat whose lease expires while its row lock waits", async () => {
    const f=fixture();const lease=await acquirePortableCrawlLease(f.db);
    const original=f.tx.$queryRawUnsafe;
    f.tx.$queryRawUnsafe=async <T>(sql:string,...values:unknown[])=>{
      if(sql.startsWith("SELECT"))f.advance(PORTABLE_CRAWL_LEASE_MS);
      return original<T>(sql,...values);
    };
    await expect(heartbeatPortableCrawlLease(f.db,lease)).rejects.toThrow("CRAWL_LEASE_LOST");
    expect(lease.signal.aborted).toBe(true);
  });
  it("keeps one heartbeat in flight when a publication-sized wait spans timer ticks", async()=>{
    vi.useFakeTimers();const f=fixture();const raw=f.db.$transaction.bind(f.db);
    let unblock!:()=>void;const blocked=new Promise<void>(resolve=>{unblock=resolve});let calls=0;
    f.db.$transaction=async(work,options)=>{if(options.timeout===150000&&calls++===0)await blocked;return raw(work,options);};
    await withPortableCrawlLease(f.db,async()=>{
      await vi.advanceTimersByTimeAsync(PORTABLE_CRAWL_HEARTBEAT_MS*2);expect(calls).toBe(1);
      unblock();await vi.advanceTimersByTimeAsync(0);
    });
    expect(f.row()?.holderId).toBe("");expect(vi.getTimerCount()).toBe(0);
  });
  it("heartbeats a live lease but never revives an expired holder", async () => {
    const f = fixture(); const lease = await acquirePortableCrawlLease(f.db);
    f.advance(PORTABLE_CRAWL_LEASE_MS - 1); await heartbeatPortableCrawlLease(f.db, lease);
    f.advance(PORTABLE_CRAWL_LEASE_MS); await expect(heartbeatPortableCrawlLease(f.db, lease)).rejects.toThrow("CRAWL_LEASE_LOST");
    expect(lease.signal.aborted).toBe(true);
    await expect(fencePortableCrawlPublication(f.tx, lease)).rejects.toThrow("CRAWL_LEASE_LOST");
  });
  it("fences a resumed holder after takeover and cannot release the new holder", async () => {
    const f = fixture(); const old = await acquirePortableCrawlLease(f.db);
    f.advance(PORTABLE_CRAWL_LEASE_MS); const current = await acquirePortableCrawlLease(f.db);
    expect(current.holderId).not.toBe(old.holderId);
    await expect(fencePortableCrawlPublication(f.tx, old)).rejects.toThrow("CRAWL_LEASE_LOST");
    await releasePortableCrawlLease(f.db, old);
    expect(f.row()?.holderId).toBe(current.holderId);
    await fencePortableCrawlPublication(f.tx, current);
  });
  it("locks the coordinator inside the supplied transaction before a fresh time check and Job write", async () => {
    const f = fixture(); const lease = await acquirePortableCrawlLease(f.db);
    const transactionCount = f.options.length;
    await fencePortableCrawlPublication(f.tx, lease);
    f.events.push({ sql: "JOB_WRITE", values: [] });
    expect(f.options).toHaveLength(transactionCount);
    expect(f.events.slice(-3).map(e => e.sql.trim().split(/\s/u)[0])).toEqual(["SELECT", "UPDATE", "JOB_WRITE"]);
    expect(f.events.at(-3)!.sql).toContain("FOR UPDATE");
    expect(f.events.at(-2)!.sql).toContain('"holderId" = $2');
    expect(f.events.at(-2)!.sql).toContain('"heartbeatAt" > clock_timestamp()');
  });
  it("fails a fence on missing rows or I/O failure", async () => {
    const missing = fixture(); const a = await acquirePortableCrawlLease(missing.db); missing.remove();
    await expect(fencePortableCrawlPublication(missing.tx, a)).rejects.toThrow("CRAWL_LEASE_LOST");
    const io = fixture(); const b = await acquirePortableCrawlLease(io.db); io.breakQuery("heartbeat");
    await expect(fencePortableCrawlPublication(io.tx, b)).rejects.toThrow("CRAWL_LEASE_LOST");
    expect(b.signal.aborted).toBe(true);
  });
  it("rejects caller-constructed or cloned lease handles", async () => {
    const f = fixture(); const lease = await acquirePortableCrawlLease(f.db);
    await expect(fencePortableCrawlPublication(f.tx, { ...lease })).rejects.toThrow("CRAWL_LEASE_NOT_OWNED");
    await expect(releasePortableCrawlLease(f.db, { ...lease })).rejects.toThrow("CRAWL_LEASE_NOT_OWNED");
  });
  it("releases idempotently without deleting the lock row, then allows a new run", async () => {
    const f = fixture(); const lease = await acquirePortableCrawlLease(f.db);
    await releasePortableCrawlLease(f.db, lease); const count = f.events.length;
    await releasePortableCrawlLease(f.db, lease); expect(f.events).toHaveLength(count);
    expect(f.row()?.holderId).toBe(""); expect(lease.signal.aborted).toBe(true);
    expect(f.events.every(e => !e.sql.includes("DELETE"))).toBe(true);
    await expect(acquirePortableCrawlLease(f.db)).resolves.toBeDefined();
  });
  it("returns no handle on an uncertain acquisition and never tries an unsafe release", async () => {
    const f = fixture(); f.breakQuery("acquire");
    await expect(acquirePortableCrawlLease(f.db)).rejects.toThrow("CRAWL_LEASE_IO_FAILED");
    expect(f.events).toHaveLength(1);
  });
  it("stops heartbeats and releases after success", async () => {
    vi.useFakeTimers(); const f = fixture(); let lease: PortableCrawlLease | undefined;
    expect(await withPortableCrawlLease(f.db, async value => {
      lease = value; f.advance(PORTABLE_CRAWL_HEARTBEAT_MS);
      await vi.advanceTimersByTimeAsync(PORTABLE_CRAWL_HEARTBEAT_MS); return 42;
    })).toBe(42);
    expect(lease!.signal.aborted).toBe(true); expect(f.row()?.holderId).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never reports success after background heartbeat failure", async () => {
    vi.useFakeTimers(); const f = fixture();
    await expect(withPortableCrawlLease(f.db, async lease => {
      f.breakQuery("heartbeat"); await vi.advanceTimersByTimeAsync(PORTABLE_CRAWL_HEARTBEAT_MS);
      expect(lease.signal.aborted).toBe(true); return 42;
    })).rejects.toThrow("CRAWL_LEASE_LOST");
    expect(f.row()?.holderId).toBe(""); expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves even an undefined thrown value and still releases", async () => {
    const f = fixture(); let caught = false;
    try { await withPortableCrawlLease(f.db, async () => { throw undefined; }); }
    catch (error) { caught = true; expect(error).toBeUndefined(); }
    expect(caught).toBe(true); expect(f.row()?.holderId).toBe("");
  });
  it("reports both work and release errors without retrying the release", async () => {
    const f = fixture();
    await expect(withPortableCrawlLease(f.db, async () => {
      f.breakQuery("release"); throw Error("work failed");
    })).rejects.toSatisfy((e: unknown) => e instanceof AggregateError && e.errors.length === 2);
    expect(f.events.filter(e => e.sql.startsWith("UPDATE") && e.sql.includes('"holderId" = \'\''))).toHaveLength(1);
  });
});
