import { Client, type ClientConfig } from "pg";
import { prismaMigrationManifestSha256, type PrismaMigrationArtifact } from "./prismaMigrationManifest";

// Existing-database-only recovery: exact source bytes for all 36 already-applied migrations.
// Changing this pin requires a separate review; this candidate never applies pending SQL.
export const EXISTING_DATABASE_MIGRATION_MANIFEST_SHA256 = "7c4f0d64fe40c63a9ce3837b71f3bfb0454e70f8f4763d4fe3e2f73e7d909e51";
const EXISTING_DATABASE_MIGRATION_COUNT = 36;
// Separately reviewed additive portable policy; this remains read-only and does
// not authorize migration, initialization, or any unknown extra history.
export const PORTABLE_EXISTING_DATABASE_MIGRATION_MANIFEST_SHA256 = "e8fe3d551610925cfba8fc17b21eaa60eb2fd937061b188ceb1657c1324828db";
export const PORTABLE_LOSS_POSITION_MIGRATION_MANIFEST_SHA256 = "aefdc6c8c6b1dcf506dbda2673aeed1b9eb47068e760a6b3dd66e245793144da";
export const PORTABLE_ZERO_BASED_LOSS_PAGE_MIGRATION_MANIFEST_SHA256 = "1ed8337df77374882330faf922cbc21d52e591a8450895f45571192800c9d907";

export const ASTELLAS_PDF_CITY_MIGRATION_MANIFEST_SHA256 = "9f6c5433d48b59695c72a17a151ad2054b3efae4c516da09828991dfc829ccf5";

export const ABBVIE_ROW_POLICY_MIGRATION_MANIFEST_SHA256 = "96c25f30adc4c75bd4368cad20fa25a6640c8230afab2f1e95f33d0de50ce6d7";

export const VERIFIED_DATE_SOURCE_MIGRATION_MANIFEST_SHA256 = "894a2130d74cac25aeb3b5824c6f933ed036f2b5be2fd087f3c696611ad58b16";

export const BMS_MAINLAND_GEOGRAPHY_MIGRATION_MANIFEST_SHA256 = "9ec71820dc8c2f250ae90d350d78d8182884144ac0f0f3c0b74610b0734ffafc";

export const CITY_PENDING_SOURCE_MIGRATION_MANIFEST_SHA256 = "ec4a786ec4ed31c96e1b04d769681b1d2e2d48a6c5a0fd402e3531e9418985f5";

export const GILEAD_NOVO_SOURCE_MIGRATION_MANIFEST_SHA256 = "4b18c0130c4bb65c31b8ee5ae3f4b4ff4ff7c5fc29f4cb742f3b417ec79a6247";

export const NOVO_NATIVE_APPLICATION_MIGRATION_MANIFEST_SHA256 = "544325a1ebaf7ebd770370bb1fdebcfc2a5d940791b75aafc9fc8556d334c6dd";

export const ORGANON_SOURCE_POLICY_MIGRATION_MANIFEST_SHA256 = "4f7b7185c751fb7964dddfbe40596443b552ab6e658df1527e3a9201ea1ed953";

interface PreflightClient {
  on(event: "error", listener: (error: unknown) => void): unknown;
  destroy(): void;
  connect(): Promise<void>;
  query(queryText: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}
interface ExistingDatabasePreflightOptions {
  databaseUrl: string;
  expectedMigrations: readonly PrismaMigrationArtifact[];
  timeoutMs?: number;
  createClient?: (config: ClientConfig) => PreflightClient;
}
/** Owns the pinned pg 8.16.3 client, including its transport's last-resort teardown. */
export function createPgPreflightClient(config: ClientConfig): PreflightClient {
  const client = new Client(config);
  return {
    on: (event, listener) => client.on(event, listener),
    connect: () => client.connect(),
    query: (queryText) => client.query(queryText),
    end: () => client.end(),
    // pg's public end() can wait indefinitely for an idle peer to close. Keep the
    // version-specific transport access here, not in the preflight orchestration.
    destroy: () => (client as unknown as { connection: { stream: { destroy(): void } } }).connection.stream.destroy()
  };
}

export interface ExistingDatabasePreflightReport {
  mode: "existing-database-only";
  migrationCount: number;
  migrationManifestSha256: string;
}

export class ExistingDatabasePreflightError extends Error {
  constructor(reason: string) {
    super(`Existing-database-only preflight refused: ${reason}. No migration or initialization was attempted; a separately reviewed fresh-database route is required.`);
  }
}

export function assertExistingDatabaseMigrationManifest(expected: readonly PrismaMigrationArtifact[]): void {
  const actual=prismaMigrationManifestSha256(expected);
  const recovered=expected.length===EXISTING_DATABASE_MIGRATION_COUNT&&actual===EXISTING_DATABASE_MIGRATION_MANIFEST_SHA256;
  const portable=expected.length===37&&actual===PORTABLE_EXISTING_DATABASE_MIGRATION_MANIFEST_SHA256;
  const pageLocalLosses=expected.length===38&&actual===PORTABLE_LOSS_POSITION_MIGRATION_MANIFEST_SHA256;
  const zeroBasedLossPages=expected.length===39&&actual===PORTABLE_ZERO_BASED_LOSS_PAGE_MIGRATION_MANIFEST_SHA256;
  const astellasPdfCities=expected.length===40&&actual===ASTELLAS_PDF_CITY_MIGRATION_MANIFEST_SHA256;
  const abbvieRows=expected.length===41&&actual===ABBVIE_ROW_POLICY_MIGRATION_MANIFEST_SHA256;
  const verifiedDateSources=expected.length===42&&actual===VERIFIED_DATE_SOURCE_MIGRATION_MANIFEST_SHA256;
  const bmsMainlandGeography=expected.length===43&&actual===BMS_MAINLAND_GEOGRAPHY_MIGRATION_MANIFEST_SHA256;
  const cityPendingSources=expected.length===44&&actual===CITY_PENDING_SOURCE_MIGRATION_MANIFEST_SHA256;
  const gileadNovoSources=expected.length===45&&actual===GILEAD_NOVO_SOURCE_MIGRATION_MANIFEST_SHA256;
  const novoNativeApplication=expected.length===46&&actual===NOVO_NATIVE_APPLICATION_MIGRATION_MANIFEST_SHA256;
  const organonSourcePolicy=expected.length===47&&actual===ORGANON_SOURCE_POLICY_MIGRATION_MANIFEST_SHA256;
  if (!recovered&&!portable&&!pageLocalLosses&&!zeroBasedLossPages&&!astellasPdfCities&&!abbvieRows&&!verifiedDateSources&&!bmsMainlandGeography&&!cityPendingSources&&!gileadNovoSources&&!novoNativeApplication&&!organonSourcePolicy) {
    throw new ExistingDatabasePreflightError("local artifacts differ from the reviewed existing-database histories");
  }
}

export function assertExistingDatabaseMigrationHistory(
  rows: readonly Record<string, unknown>[],
  expected: readonly PrismaMigrationArtifact[]
): void {
  assertExistingDatabaseMigrationManifest(expected);
  const remaining = new Map(expected.map((migration) => [migration.migrationName, migration.checksum]));
  if (rows.length !== expected.length || rows.some((row) => {
    if (typeof row.migration_name !== "string" || row.finished_at == null || row.rolled_back_at !== null ||
        remaining.get(row.migration_name) !== row.checksum) return true;
    return !remaining.delete(row.migration_name);
  }) || remaining.size !== 0) {
    throw new ExistingDatabasePreflightError("complete successful migration history does not exactly match the pinned artifacts");
  }
}

export async function preflightExistingDatabase(
  options: ExistingDatabasePreflightOptions
): Promise<ExistingDatabasePreflightReport> {
  assertExistingDatabaseMigrationManifest(options.expectedMigrations);
  let url: URL;
  try { url = new URL(options.databaseUrl); } catch {
    throw new ExistingDatabasePreflightError("database connection configuration is invalid");
  }
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname ||
      url.searchParams.getAll("schema").some((schema) => schema !== "public") || url.searchParams.has("options")) {
    throw new ExistingDatabasePreflightError("database connection must target the public schema without overriding read-only options");
  }
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.min(Math.max(Math.floor(options.timeoutMs!), 1), 10_000) : 2_500;
  const deadlineAt = Date.now() + timeoutMs;
  let client: PreflightClient | undefined;
  let active = true;
  let failure: unknown;
  let failed = false;
  const requireActive = () => {
    if (!active || Date.now() >= deadlineAt) throw new ExistingDatabasePreflightError("read-only history check exceeded its deadline");
  };
  try {
    const config: ClientConfig = {
      connectionString: options.databaseUrl,
      application_name: "job-finder-existing-database-preflight",
      connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs,
      options: "-c default_transaction_read_only=on"
    };
    client = options.createClient?.(config) ?? createPgPreflightClient(config);
    let rejectClientError!: (reason: Error) => void;
    const clientError = new Promise<never>((_resolve, reject) => { rejectClientError = reject; });
    // This one-shot client is never reused. Retain the listener after end/timeout
    // so a late socket error cannot become an uncaught event containing secrets.
    client.on("error", () => {
      active = false;
      failed = true;
      failure = new ExistingDatabasePreflightError("database connection emitted an error");
      rejectClientError(failure as Error);
    });
    await beforeDeadline(Promise.race([clientError, (async () => {
      await client!.connect();
      requireActive();
      await client!.query("BEGIN READ ONLY");
      requireActive();
      const result = await client!.query(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name COLLATE "C", id COLLATE "C"'
      );
      requireActive();
      assertExistingDatabaseMigrationHistory(result.rows, options.expectedMigrations);
      await client!.query("ROLLBACK");
    })()]), deadlineAt);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    active = false;
    if (client) {
      try { await beforeDeadline(Promise.resolve().then(() => client!.end()), deadlineAt); }
      catch (error) {
        failed = true;
        failure ??= error;
        try { client.destroy(); } catch { /* Failure remains sanitized; late events remain handled. */ }
      }
    }
  }
  if (failed) {
    // Never expose database URLs, credentials, or driver diagnostics.
    throw failure instanceof ExistingDatabasePreflightError ? failure :
      new ExistingDatabasePreflightError("read-only migration history or connection cleanup was unavailable");
  }
  return { mode: "existing-database-only", migrationCount: options.expectedMigrations.length,
    migrationManifestSha256: prismaMigrationManifestSha256(options.expectedMigrations) };
}

async function beforeDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ExistingDatabasePreflightError("read-only history check exceeded its deadline")),
        Math.max(0, deadlineAt - Date.now()));
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Historical recovery SQL is evidence, never a fresh-database migration path. */
export function assertMigrationReplaySupported(migrationNames: readonly string[]): void {
  if (migrationNames.some((name) => name === "20260927110000_crawl_coordinator_table_lock" ||
      name === "20260927120000_p0_launch_cohort_41_companies")) {
    throw new ExistingDatabasePreflightError("this migration tree contains already-applied historical SQL that must not be replayed");
  }
}
