import { createHash } from "node:crypto";
import { portableSnapshotIdentities, type PortableSnapshotIdentity } from "./portableDisplayIdentity";
import type { PortablePublicSnapshot } from "./portablePublicSnapshotRepository";

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

// Child rows affect both their declared source and the result they are joined to.
export function portableSnapshotSourceVersionSql(sourceIds: readonly string[]): string {
  const quote=(value:string)=>"'"+value.replaceAll("'","''")+"'";
  const requested=sourceIds.map(quote).join(',');
  const tuple="t.tableoid::text || '/' || t.ctid::text || '/' || t.xmin::text";
  const parts=PORTABLE_SNAPSHOT_VERSION_TABLES.map(table=>{
    const batch=table==='CrawlBatch', direct=table==='Job'||table==='CrawlBatchSourceResult';
    const owner=batch?'JOIN "CrawlBatchSourceResult" r ON r."batchId"=t.id':direct?'':'LEFT JOIN "CrawlBatchSourceResult" r ON r.id=t."sourceResultId"';
    const sources=batch?'SELECT r."sourceId"':direct?'SELECT t."sourceId"':'SELECT t."sourceId" UNION SELECT r."sourceId"';
    return `SELECT DISTINCT owners."sourceId",${quote(table)}::text AS relation,${tuple} AS tuple FROM "${table}" t ${owner}
      CROSS JOIN LATERAL (${sources}) owners WHERE owners."sourceId" IN (${requested||'NULL'})`;
  });
  return `WITH physical AS (${parts.join(' UNION ALL ')}), grouped AS (
    SELECT "sourceId",relation,count(*)::text AS count,encode(sha256(convert_to(string_agg(tuple,',' ORDER BY tuple),'UTF8')),'hex') AS digest
    FROM physical GROUP BY "sourceId",relation), global_versions AS (${PORTABLE_SNAPSHOT_VERSION_SQL})
    SELECT (txid_snapshot_xmax(txid_current_snapshot()) / 4294967296)::text AS epoch,s."sourceId",r.relation,
      coalesce(g.count,'0') AS count,coalesce(g.digest,encode(sha256(convert_to('','UTF8')),'hex')) AS digest
    FROM unnest(ARRAY[${requested}]::text[]) s("sourceId") CROSS JOIN unnest(ARRAY[${PORTABLE_SNAPSHOT_VERSION_TABLES.map(quote).join(',')}]::text[]) r(relation)
    LEFT JOIN grouped g ON g."sourceId"=s."sourceId" AND g.relation=r.relation
    UNION ALL SELECT epoch,'@global'::text AS "sourceId",relation,count,digest FROM global_versions`;
}
export function portableSnapshotSourceVersions(rows: unknown, sourceIds: readonly string[]): Map<string,string> {
  const expected=[...sourceIds,'@global'];
  if(!Array.isArray(rows)||new Set(expected).size!==expected.length||rows.length!==expected.length*PORTABLE_SNAPSHOT_VERSION_TABLES.length||rows.some(row=>!expected.includes(row?.sourceId)))throw Error('INVALID_PORTABLE_SOURCE_VERSIONS');
  return new Map(expected.map(id=>[id,portableSnapshotVersion(rows.filter(row=>row.sourceId===id))]));
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
    for (const job of source.jobs) consider(Date.parse((job as typeof job & {lastConfirmedObservedAt?: string}).lastConfirmedObservedAt ?? job.lastSeenAt) + freshnessMaximumMs);
  }
  return until;
}

export interface CachedPortableSnapshot extends PortableSnapshotIdentity {
  snapshot: PortablePublicSnapshot;
}
export function portableDisplayVersion(snapshot: PortablePublicSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/** One owned, verified projection per reader, bounded independently of DB size. */
export class PortableSnapshotCache {
  private entry: { version: string; scope: string; from: number; until: number; snapshot: PortablePublicSnapshot; identity: PortableSnapshotIdentity; sourceVersions: Map<string,string> | undefined } | undefined;
  private buildSequence = 0;
  constructor(private readonly maximumBytes = 16 * 1024 * 1024) {}

  get(version: string, scope: string, now: number): PortablePublicSnapshot | undefined {
    return this.getRead(version, scope, now)?.snapshot;
  }

  getRead(version: string, scope: string, now: number): CachedPortableSnapshot | undefined {
    const entry = this.entry;
    if (!entry || entry.version !== version || entry.scope !== scope || now < entry.from || now >= entry.until) return undefined;
    return {snapshot: structuredClone(entry.snapshot), ...entry.identity};
  }

  /** An explicitly older display, never relabelled as a newly verified snapshot. */
  getPrevious(scope: string, now: number): PortablePublicSnapshot | undefined {
    return this.getPreviousRead(scope, now)?.snapshot;
  }

  getPreviousRead(scope: string, now: number): CachedPortableSnapshot | undefined {
    const entry = this.entry;
    if (!entry || entry.scope !== scope || now < entry.from) return undefined;
    return {snapshot: structuredClone(entry.snapshot), ...entry.identity};
  }

  getReusableSources(scope: string, now: number, versions: Map<string,string>): {sources: PortablePublicSnapshot['sources']; until: number} | undefined {
    const entry=this.entry;
    if(!entry?.sourceVersions||entry.scope!==scope||now<entry.from||now>=entry.until)return undefined;
    return {until:entry.until,sources:structuredClone(entry.snapshot.sources.filter(source=>
      versions.has(source.sourceId)&&entry.sourceVersions!.get(source.sourceId)===versions.get(source.sourceId)))};
  }

  hasSnapshot(): boolean {
    return this.entry !== undefined;
  }

  getVerifiedAt(): string | undefined {
    return this.entry?.snapshot.generatedAt;
  }

  /** A completed build may have exactly the same display and verification hash.
   * Only this sequence decides whether the owning reader needs a post-build check.
   */
  getBuildSequence(): number {
    return this.buildSequence;
  }

  /** Only for the owning reader's fixed criteria while its rebuild owns the DB. */
  getDuringRefresh(now: number): PortablePublicSnapshot | undefined {
    return this.getDuringRefreshRead(now)?.snapshot;
  }

  getDuringRefreshRead(now: number): CachedPortableSnapshot | undefined {
    const entry = this.entry;
    if (!entry || now < entry.from) return undefined;
    return {snapshot: structuredClone(entry.snapshot), ...entry.identity};
  }

  set(version: string, scope: string, until: number, snapshot: PortablePublicSnapshot): string {
    return this.setRead(version, scope, until, snapshot).version;
  }

  setRead(version: string, scope: string, until: number, snapshot: PortablePublicSnapshot, sourceVersions?: Map<string,string>): PortableSnapshotIdentity {
    const serialized = JSON.stringify(snapshot);
    const identity = portableSnapshotIdentities(snapshot, serialized);
    if (!Number.isSafeInteger(this.buildSequence + 1)) throw new Error("PORTABLE_SNAPSHOT_BUILD_SEQUENCE_EXHAUSTED");
    this.buildSequence++;
    if (Buffer.byteLength(serialized, "utf8") > this.maximumBytes) {
      this.entry = undefined;
      return identity;
    }
    const owned = structuredClone(snapshot);
    this.entry = {version, scope, from: Date.parse(snapshot.generatedAt), until, snapshot: owned, identity, sourceVersions:sourceVersions ? new Map(sourceVersions) : undefined};
    return {...identity};
  }
}
