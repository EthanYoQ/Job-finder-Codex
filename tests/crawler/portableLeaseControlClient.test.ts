import { afterEach, describe, expect, it, vi } from "vitest";
import { PORTABLE_CRAWL_HEARTBEAT_MS, PORTABLE_CRAWL_LEASE_MS, type PortableLeaseDatabase, type PortableLeaseTransaction } from "../../src/crawler/portableCrawlLease";
import { runPortableScheduledCrawl } from "../../src/crawler/portableScheduledCrawl";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies } from "../../src/release/launchManifest";

vi.mock("../../src/db/companyRegistrySync", () => ({ syncLaunchCohortSourcesToDb: vi.fn(async () => ({})) }));
const companies = selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies);
const authority = { companies, plans: buildStagedSourceCrawlPlans(companies), identity: { expectedPlannedSourceCount: 41 } } as any;
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

// Deterministic adapter model, not PostgreSQL verification. Each client has a
// single connection; both clients share the same coordinator row and row lock.
function fixture() {
  let holder = "", heartbeatAt = 0, rowOwner: symbol | undefined, unlocked = deferred();
  let failControlRenewal = false;
  const events: Array<{ client: string; sql: string; values: unknown[] }> = [];
  const jobWrites: string[] = [], terminalWrites: string[] = [];
  const pools = new Map<string, { busy: boolean; waitingOnRow: boolean; options: Array<{ maxWait: number; timeout: number }> }>();
  function client(name: string) {
    const pool = { busy: false, waitingOnRow: false, options: [] as Array<{ maxWait: number; timeout: number }> };
    pools.set(name, pool);
    const db = {
      crawlBatch: { update: async () => { throw Error("UNFENCED_TERMINAL_WRITE"); } },
      $transaction: async <T>(work: (tx: PortableLeaseTransaction & { job: { create(): Promise<void> }; crawlBatch: { update(): Promise<void> } }) => Promise<T>, options: { maxWait: number; timeout: number }) => {
        pool.options.push(options);
        if (pool.busy) {
          await new Promise(resolve => setTimeout(resolve, options.maxWait));
          throw Error("PRIMARY_POOL_ACQUISITION_TIMEOUT");
        }
        pool.busy = true;
        const owner = Symbol(name);
        try {
          return await work({
            $queryRawUnsafe: async <R>(sql: string, ...values: unknown[]) => {
              events.push({ client: name, sql, values });
              expect(values[0]).toBe("formal-crawl");
              let result: unknown;
              if (sql.startsWith("INSERT")) { holder = String(values[1]); heartbeatAt = Date.now(); result = [{ holderId: holder }]; }
              else if (sql.startsWith("SELECT")) {
                if (name === "control" && failControlRenewal) throw Error("CONTROL_IO_FAILED");
                if (rowOwner && rowOwner !== owner) { pool.waitingOnRow = true; await unlocked.promise; pool.waitingOnRow = false; }
                rowOwner = owner; result = [{ id: "formal-crawl" }];
              } else if (sql.includes('"holderId" = \'\'')) { if (holder === values[1]) holder = ""; result = [{ holderId: holder }]; }
              else if (holder === values[1] && heartbeatAt > Date.now() - PORTABLE_CRAWL_LEASE_MS) { heartbeatAt = Date.now(); result = [{ holderId: holder }]; }
              else result = [];
              return result as R;
            },
            job: { create: async () => { jobWrites.push(name); } },
            crawlBatch: { update: async () => { terminalWrites.push(name); } }
          });
        } finally {
          if (rowOwner === owner) { rowOwner = undefined; const previous = unlocked; unlocked = deferred(); previous.resolve(); }
          pool.busy = false;
        }
      }
    };
    return db;
  }
  return { db: client("primary"), leaseDb: client("control") as PortableLeaseDatabase, pools, events, jobWrites, terminalWrites,
    holder: () => holder, failRenewal() { failControlRenewal = true; } };
}
afterEach(() => vi.useRealTimers());

describe("portable scheduled control connection", () => {
  it("renews through the control pool while the primary pool is occupied and the shared row lock waits", async () => {
    vi.useFakeTimers(); const f = fixture(); const releasePublication = deferred(), publicationStarted = deferred();
    await runPortableScheduledCrawl({ db: f.db, leaseDb: f.leaseDb, workspaceRoot: "/tmp", resolveAuthority: async () => authority,
      runBatch: (async (_plans: unknown, deps: any) => {
        const publication = deps.db.$transaction(async (tx: any) => { await tx.job.create(); publicationStarted.resolve(); await releasePublication.promise; });
        await publicationStarted.promise;
        await vi.advanceTimersByTimeAsync(PORTABLE_CRAWL_HEARTBEAT_MS + 10_000);
        try {
          expect(f.pools.get("primary")!.busy).toBe(true);
          expect(f.pools.get("primary")!.options).toEqual([{ maxWait: 10000, timeout: 120000 }]);
          expect(f.pools.get("control")!.busy).toBe(true);
          expect(f.pools.get("control")!.waitingOnRow).toBe(true);
          expect(deps.portableLease.signal.aborted).toBe(false);
          expect(f.pools.get("control")!.options).toContainEqual({ maxWait: 5000, timeout: 150000 });
        } finally { releasePublication.resolve(); await publication; }
        await vi.advanceTimersByTimeAsync(0);
        expect(deps.portableLease.signal.aborted).toBe(false);
        await deps.db.crawlBatch.update({ status: "SUCCESS" });
        return { status: "SUCCESS" };
      }) as any });
    expect(f.jobWrites).toEqual(["primary"]);
    expect(f.terminalWrites).toEqual(["primary"]);
    expect(f.events.filter(e => e.sql.startsWith("INSERT") || e.sql.includes('"holderId" = \'\'')).map(e => e.client)).toEqual(["control", "control"]);
    expect(f.holder()).toBe(""); expect(vi.getTimerCount()).toBe(0);
  }, 3000);

  it("fails closed on control renewal failure before another Job or terminal write", async () => {
    vi.useFakeTimers(); const f = fixture();
    await expect(runPortableScheduledCrawl({ db: f.db, leaseDb: f.leaseDb, workspaceRoot: "/tmp", resolveAuthority: async () => authority,
      runBatch: (async (_plans: unknown, deps: any) => {
        f.failRenewal(); await vi.advanceTimersByTimeAsync(PORTABLE_CRAWL_HEARTBEAT_MS);
        expect(deps.portableLease.signal.aborted).toBe(true);
        await expect(deps.db.$transaction((tx: any) => tx.job.create())).rejects.toThrow("CRAWL_LEASE_LOST");
        await expect(deps.db.crawlBatch.update({ status: "SUCCESS" })).rejects.toThrow("CRAWL_LEASE_LOST");
        return { status: "SUCCESS" };
      }) as any })).rejects.toThrow("CRAWL_LEASE_LOST");
    expect(f.jobWrites).toEqual([]); expect(f.terminalWrites).toEqual([]);
    expect(f.holder()).toBe(""); expect(vi.getTimerCount()).toBe(0);
  }, 3000);
});
