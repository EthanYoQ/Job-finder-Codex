import { createHash } from "node:crypto";
import type { PortablePublicSnapshot } from "./portablePublicSnapshotRepository";
import { PortableSnapshotVersionMemo } from "./portableSnapshotVersionMemo";

/** Every table read directly or through portableSourceResultSelect relations. */
export const PORTABLE_SNAPSHOT_VERSION_TABLES = [
  "CrawlBatchSourceResult", "CrawlBatch", "CrawlObservation", "LifecycleSetEvidenceMember", "Job",
  "TransportAttemptEvidence", "EvidenceArtifact", "PaginationEvidence", "LossLedgerEntry"
] as const;

// Read only tuple headers, not certificates, HTML, job descriptions or JSON payloads.
// xmin changes on UPDATE; removed/added tuples change the ordered set on DELETE/INSERT.
// tableoid and ctid distinguish physical versions, including table rewrites. The epoch
// prevents 32-bit transaction-ID wraparound from reusing a version within this process.
export const PORTABLE_SNAPSHOT_VERSION_SQL = `SELECT
  (txid_snapshot_xmax(txid_current_snapshot()) / 4294967296)::text AS epoch,
  versions.* FROM (${PORTABLE_SNAPSHOT_VERSION_TABLES.map(table => `
    SELECT '${table}'::text AS relation, count(*)::text AS count,
      encode(sha256(convert_to(coalesce(string_agg(
        t.tableoid::text || '/' || t.ctid::text || '/' || t.xmin::text,
        ',' ORDER BY t.tableoid, t.ctid), ''), 'UTF8')), 'hex') AS digest
    FROM "${table}" t`).join(" UNION ALL ")}
  ) versions`;

export function portableSnapshotVersion(rows: unknown): string {
  if (!Array.isArray(rows) || rows.length !== PORTABLE_SNAPSHOT_VERSION_TABLES.length) {
    throw new Error("INVALID_PORTABLE_SNAPSHOT_VERSION");
  }
  const versions = new Map<string, string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || !PORTABLE_SNAPSHOT_VERSION_TABLES.includes(row.relation) ||
        versions.has(row.relation) || typeof row.epoch !== "string" || !/^\d+$/.test(row.epoch) ||
        typeof row.count !== "string" || !/^\d+$/.test(row.count) ||
        typeof row.digest !== "string" || !/^[a-f0-9]{64}$/.test(row.digest)) {
      throw new Error("INVALID_PORTABLE_SNAPSHOT_VERSION");
    }
    versions.set(row.relation, `${row.epoch}:${row.count}:${row.digest}`);
  }
  return PORTABLE_SNAPSHOT_VERSION_TABLES.map(table => `${table}:${versions.get(table)}`).join("|");
}

/** Cache only inside a time interval in which every time comparison is unchanged.
 * This includes future receipt/capture timestamps, B validation expiry, and the
 * exact projected source/job freshness boundary. Inspect nested evidence as well
 * as rows: a held future-dated receipt must be retried when its time arrives.
 * Historical capture/start/publication times do not acquire a freshness limit.
 */
export function portableSnapshotValidUntil(value: unknown, now: number, freshnessMaximumMs: number,
  snapshot: Pick<PortablePublicSnapshot, "sources">): number {
  let until = Infinity;
  const consider = (boundary: number): void => {
    if (boundary > now && boundary < until) until = boundary;
  };
  const visit = (item: unknown): void => {
    // Raw evidence can use any Date.parse-compatible spelling. Be conservative:
    // irrelevant date-like content can shorten reuse but must never extend it.
    const timestamp = item instanceof Date ? item.getTime() :
      typeof item === "string" || typeof item === "number" ? Date.parse(String(item)) : NaN;
    if (Number.isFinite(timestamp)) {
      consider(timestamp);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  // Only these projected values are compared with the freshness age in the
  // selector/projector. Keep absolute future checks for every historical row.
  for (const source of snapshot.sources) {
    if (source.lastSuccessAt !== null) consider(Date.parse(source.lastSuccessAt) + freshnessMaximumMs);
    for (const job of source.jobs) consider(Date.parse(job.lastSeenAt) + freshnessMaximumMs);
  }
  return until;
}

export interface CachedPortableSnapshot {
  snapshot: PortablePublicSnapshot;
  /** Content identity includes the original verification time, not response time. */
  version: string;
}
export function portableDisplayVersion(snapshot: PortablePublicSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/** One owned, verified projection per reader, bounded independently of DB size. */
export class PortableSnapshotCache {
  private entry: { version: string; scope: string; from: number; until: number; snapshot: PortablePublicSnapshot; displayVersion: string } | undefined;
  private readonly versionMemo: PortableSnapshotVersionMemo | undefined;
  constructor(private readonly maximumBytes = 16 * 1024 * 1024, options: {reuseIdenticalMvccSnapshot?: boolean} = {}) {
    this.versionMemo = options.reuseIdenticalMvccSnapshot ? new PortableSnapshotVersionMemo() : undefined;
  }

  /** Always invoked from the same read transaction as a possible projection fill. */
  async readDatabaseVersion(query: (sql: string) => PromiseLike<unknown>): Promise<string> {
    return this.versionMemo ? this.versionMemo.read(query, PORTABLE_SNAPSHOT_VERSION_SQL, portableSnapshotVersion) :
      portableSnapshotVersion(await query(PORTABLE_SNAPSHOT_VERSION_SQL));
  }

  get(version: string, scope: string, now: number): PortablePublicSnapshot | undefined {
    return this.getRead(version, scope, now)?.snapshot;
  }

  getRead(version: string, scope: string, now: number): CachedPortableSnapshot | undefined {
    const entry = this.entry;
    if (!entry || entry.version !== version || entry.scope !== scope || now < entry.from || now >= entry.until) return undefined;
    return {snapshot: structuredClone(entry.snapshot), version: entry.displayVersion};
  }

  /** An explicitly older display, never relabelled as a newly verified snapshot. */
  getPrevious(scope: string, now: number): PortablePublicSnapshot | undefined {
    return this.getPreviousRead(scope, now)?.snapshot;
  }

  getPreviousRead(scope: string, now: number): CachedPortableSnapshot | undefined {
    const entry = this.entry;
    if (!entry || entry.scope !== scope || now < entry.from) return undefined;
    return {snapshot: structuredClone(entry.snapshot), version: entry.displayVersion};
  }

  hasSnapshot(): boolean {
    return this.entry !== undefined;
  }

  getVerifiedAt(): string | undefined {
    return this.entry?.snapshot.generatedAt;
  }

  getDisplayVersion(): string | undefined {
    return this.entry?.displayVersion;
  }

  /** Last verified display for the owning reader's fixed criteria. The caller
   * must bind its refresh status; this access never verifies current DB state. */
  getDuringRefresh(now: number): PortablePublicSnapshot | undefined {
    return this.getDuringRefreshRead(now)?.snapshot;
  }

  getDuringRefreshRead(now: number): CachedPortableSnapshot | undefined {
    const entry = this.entry;
    if (!entry || now < entry.from) return undefined;
    return {snapshot: structuredClone(entry.snapshot), version: entry.displayVersion};
  }

  set(version: string, scope: string, until: number, snapshot: PortablePublicSnapshot): string {
    // Serialize only once per completed build for both the size bound and identity.
    const serialized = JSON.stringify(snapshot);
    const displayVersion = createHash("sha256").update(serialized).digest("hex");
    if (Buffer.byteLength(serialized, "utf8") > this.maximumBytes) {
      this.entry = undefined;
      return displayVersion;
    }
    const owned = structuredClone(snapshot);
    this.entry = {version, scope, from: Date.parse(snapshot.generatedAt), until, snapshot: owned, displayVersion};
    return displayVersion;
  }
}
