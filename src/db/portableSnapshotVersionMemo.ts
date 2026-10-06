/** An optional, process-local hint. A changed/unsupported token never substitutes
 * for the original tuple fingerprint. No TTL, counts or last-update heuristic.
 * The caller must run both queries in the same repeatable-read transaction. */
export const PORTABLE_MVCC_TOKEN_SQL = `SELECT
  pg_current_snapshot()::text AS snapshot,
  pg_current_xact_id_if_assigned()::text AS own_xid,
  pg_postmaster_start_time()::text AS server_started,
  inet_server_addr()::text AS server_address,
  inet_server_port()::text AS server_port,
  pg_backend_pid()::text AS backend_pid,
  (SELECT backend_start::text FROM pg_stat_activity WHERE pid = pg_backend_pid()) AS backend_started,
  pg_is_in_recovery() AS recovery,
  current_database()::text AS database_name,
  (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
  current_user::text AS role_name,
  current_setting('search_path') AS search_path,
  current_setting('transaction_isolation') AS isolation,
  coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) AS bypass_rls`;

/** Only the primary, XID-less, fixed-role reader can take this optimization.
 * A request-specific RLS context is deliberately outside the fast path. */
export function portableMvccToken(rows: unknown): string | undefined {
  if (!Array.isArray(rows) || rows.length !== 1) return undefined;
  const row = rows[0];
  if (!row || typeof row !== "object" || row.own_xid !== null || row.recovery !== false || row.bypass_rls !== true ||
      row.isolation !== "repeatable read" || typeof row.snapshot !== "string" ||
      !/^\d+:\d+:(?:\d+(?:,\d+)*)?$/.test(row.snapshot) ||
      [row.server_started, row.backend_started, row.backend_pid, row.database_name, row.database_oid, row.role_name, row.search_path]
        .some(value => typeof value !== "string" || value.length === 0) ||
      [row.server_address, row.server_port].some(value => value !== null && typeof value !== "string")) return undefined;
  const [xmin, xmax, xip] = row.snapshot.split(":") as [string, string, string];
  const low = BigInt(xmin), high = BigInt(xmax);
  if (low > high) return undefined;
  const active = xip ? xip.split(",").map(BigInt) : [];
  if (active.some((xid, index) => xid < low || xid >= high || index > 0 && xid <= active[index - 1]!)) return undefined;
  return JSON.stringify([row.server_started, row.server_address, row.server_port, row.backend_pid, row.backend_started,
    row.database_name, row.database_oid, row.role_name, row.search_path, row.snapshot]);
}

export class PortableSnapshotVersionMemo {
  private entry: {token: string; version: string} | undefined;

  async read(query: (sql: string) => PromiseLike<unknown>, fingerprintSql: string,
    parseVersion: (rows: unknown) => string): Promise<string> {
    // Errors still fail closed. A SQL error cannot safely be caught and followed
    // by another statement inside PostgreSQL's now-aborted transaction.
    const token = portableMvccToken(await query(PORTABLE_MVCC_TOKEN_SQL));
    if (token !== undefined && this.entry?.token === token) return this.entry.version;
    const version = parseVersion(await query(fingerprintSql));
    this.entry = token === undefined ? undefined : {token, version};
    return version;
  }
}
