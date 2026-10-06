import { randomUUID } from "node:crypto";

// Uses the existing 20260927110000 table. All live publishing writers must
// participate in this protocol; an old advisory/file-lock runner does not.
export const PORTABLE_CRAWL_LOCK_ID = "formal-crawl";
export const PORTABLE_CRAWL_LEASE_MS = 5 * 60 * 1_000;
export const PORTABLE_CRAWL_HEARTBEAT_MS = 60 * 1_000;
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
// A live publication can hold this same row for up to 120s. Wait beyond that
// bound, but below the 5min lease; DB time is rechecked after acquiring the row.
const HEARTBEAT_TX_OPTIONS = { maxWait: 5_000, timeout: 150_000 } as const;

export interface PortableLeaseTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}
export interface PortableLeaseDatabase {
  $transaction<T>(work: (tx: PortableLeaseTransaction) => Promise<T>,
    options: { maxWait: number; timeout: number }): Promise<T>;
}
export interface PortableCrawlLease {
  readonly lockId: typeof PORTABLE_CRAWL_LOCK_ID;
  readonly holderId: string;
  readonly signal: AbortSignal;
}
type LeaseState = { controller: AbortController; released: boolean };
const owned = new WeakMap<PortableCrawlLease, LeaseState>();

export class PortableCrawlLeaseError extends Error {
  constructor(readonly code: "CRAWL_LEASE_BUSY" | "CRAWL_LEASE_LOST" | "CRAWL_LEASE_IO_FAILED" |
    "CRAWL_LEASE_NOT_OWNED", options?: ErrorOptions) {
    super(code, options);
    this.name = "PortableCrawlLeaseError";
  }
}

function requireOwned(lease: PortableCrawlLease): LeaseState {
  const state = owned.get(lease);
  if (!state) throw new PortableCrawlLeaseError("CRAWL_LEASE_NOT_OWNED");
  if (state.released || state.controller.signal.aborted) throw new PortableCrawlLeaseError("CRAWL_LEASE_LOST");
  return state;
}
/** Read-only compiler seam; does not mint or import lease ownership. */
export function assertPortableCrawlLeaseOwned(lease: PortableCrawlLease): void {
  requireOwned(lease);
}

function lose(state: LeaseState, cause?: unknown): PortableCrawlLeaseError {
  const error = new PortableCrawlLeaseError("CRAWL_LEASE_LOST", cause === undefined ? undefined : { cause });
  state.controller.abort(error);
  return error;
}
function exactlyHolder(rows: unknown, holderId: string): boolean {
  return Array.isArray(rows) && rows.length === 1 && rows[0]?.holderId === holderId;
}

/** Database time, rather than worker time, decides lease expiry. Acquisition
 * cannot change a live holder. A missing seed row is inserted atomically. */
export async function acquirePortableCrawlLease(db: PortableLeaseDatabase): Promise<PortableCrawlLease> {
  const holderId = randomUUID();
  let rows: unknown;
  try {
    rows = await db.$transaction(tx => tx.$queryRawUnsafe(
      `INSERT INTO "CrawlCoordinatorLock" ("id", "holderId", "acquiredAt", "heartbeatAt", "metadata")
       VALUES ($1, $2, clock_timestamp(), clock_timestamp(), 'portable-quality-sync-v1')
       ON CONFLICT ("id") DO UPDATE SET "holderId" = EXCLUDED."holderId",
         "acquiredAt" = clock_timestamp(), "heartbeatAt" = clock_timestamp(),
         "metadata" = EXCLUDED."metadata"
       WHERE "CrawlCoordinatorLock"."holderId" = '' OR
         "CrawlCoordinatorLock"."heartbeatAt" <= clock_timestamp() - ($3 * interval '1 millisecond')
       RETURNING "holderId"`, PORTABLE_CRAWL_LOCK_ID, holderId, PORTABLE_CRAWL_LEASE_MS), TX_OPTIONS);
  } catch (cause) {
    // No handle is returned after an uncertain acquisition. Its bounded lease
    // may expire naturally; never release a row whose ownership is uncertain.
    throw new PortableCrawlLeaseError("CRAWL_LEASE_IO_FAILED", { cause });
  }
  if (!exactlyHolder(rows, holderId)) throw new PortableCrawlLeaseError("CRAWL_LEASE_BUSY");
  const controller = new AbortController();
  const lease = Object.freeze({ lockId: PORTABLE_CRAWL_LOCK_ID, holderId, signal: controller.signal });
  owned.set(lease, { controller, released: false });
  return lease;
}

/** Expired holders may not revive themselves. Failure aborts the local handle. */
export async function heartbeatPortableCrawlLease(db: PortableLeaseDatabase, lease: PortableCrawlLease): Promise<void> {
  const state = requireOwned(lease);
  try {
    await db.$transaction(tx => fencePortableCrawlPublication(tx, lease), HEARTBEAT_TX_OPTIONS);
    requireOwned(lease);
  } catch (cause) { throw lose(state, cause); }
}

/** Call inside the SAME interactive transaction, before any Job mutation. The
 * row lock is held until that transaction commits/rolls back. A second query
 * checks current database time after lock acquisition, avoiding a stale time
 * decision while SELECT FOR UPDATE was waiting. */
export async function fencePortableCrawlPublication(tx: PortableLeaseTransaction, lease: PortableCrawlLease): Promise<void> {
  const state = requireOwned(lease);
  try {
    const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "CrawlCoordinatorLock" WHERE "id" = $1 FOR UPDATE`, lease.lockId);
    if (locked.length !== 1 || locked[0]?.id !== lease.lockId) throw lose(state);
    requireOwned(lease);
    if (!exactlyHolder(await extend(tx, lease), lease.holderId)) throw lose(state);
    requireOwned(lease);
  } catch (cause) { throw lose(state, cause); }
}

function extend(tx: PortableLeaseTransaction, lease: PortableCrawlLease): Promise<unknown> {
  return tx.$queryRawUnsafe(
    `UPDATE "CrawlCoordinatorLock" SET "heartbeatAt" = clock_timestamp()
     WHERE "id" = $1 AND "holderId" = $2 AND
       "heartbeatAt" > clock_timestamp() - ($3 * interval '1 millisecond')
     RETURNING "holderId"`, lease.lockId, lease.holderId, PORTABLE_CRAWL_LEASE_MS);
}

/** Idempotent locally; the conditional update can never clear a newer holder.
 * Preserve the existing lock row instead of deleting state or audit history. */
export async function releasePortableCrawlLease(db: PortableLeaseDatabase, lease: PortableCrawlLease): Promise<void> {
  const state = owned.get(lease);
  if (!state) throw new PortableCrawlLeaseError("CRAWL_LEASE_NOT_OWNED");
  if (state.released) return;
  state.released = true;
  state.controller.abort(new PortableCrawlLeaseError("CRAWL_LEASE_LOST"));
  try {
    const rows = await db.$transaction(tx => tx.$queryRawUnsafe<Array<{ holderId: string }>>(
      `UPDATE "CrawlCoordinatorLock" SET "holderId" = '', "heartbeatAt" = clock_timestamp(),
         "metadata" = 'portable-quality-sync-v1:released'
       WHERE "id" = $1 AND "holderId" = $2 RETURNING "holderId"`, lease.lockId, lease.holderId), TX_OPTIONS);
    if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => row.holderId !== "")) {
      throw new Error("Invalid conditional release result");
    }
    // Zero rows is expected if a newer holder has already taken over.
  } catch (cause) { throw new PortableCrawlLeaseError("CRAWL_LEASE_IO_FAILED", { cause }); }
}

/** Scheduler seam. Work must propagate lease.signal to acquisition and fence
 * each publication transaction. Heartbeats never overlap each other. */
export async function withPortableCrawlLease<T>(
  db: PortableLeaseDatabase, work: (lease: PortableCrawlLease) => Promise<T>
): Promise<T> {
  const lease = await acquirePortableCrawlLease(db);
  let heartbeat: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (heartbeat || lease.signal.aborted) return;
    heartbeat = heartbeatPortableCrawlLease(db, lease)
      .catch(() => { /* handle is aborted; publication fencing fails closed */ })
      .finally(() => { heartbeat = undefined; });
  }, PORTABLE_CRAWL_HEARTBEAT_MS);
  timer.unref?.();
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try { result = await work(lease); requireOwned(lease); }
  catch (cause) { failure = cause; failed = true; }
  finally {
    clearInterval(timer);
    await heartbeat;
    if (!failed) {
      try { await heartbeatPortableCrawlLease(db, lease); }
      catch (cause) { failure = cause; failed = true; }
    }
    try { await releasePortableCrawlLease(db, lease); }
    catch (releaseError) {
      if (failed) throw new AggregateError([failure, releaseError], "Crawl failed and lease release failed");
      throw releaseError;
    }
  }
  if (failed) throw failure;
  return result as T;
}
