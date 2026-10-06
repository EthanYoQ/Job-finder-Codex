import { Client, type ClientConfig } from "pg";
import {
  listCurrentPrismaMigrations,
  type PrismaMigrationArtifact
} from "../db/prismaMigrationManifest";

interface ReadinessClient {
  connect(): Promise<void>;
  query(queryText: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export type DeploymentMigrationExpectation = PrismaMigrationArtifact;

export interface DeploymentReadinessOptions {
  databaseUrl: string;
  expectedMigrations: readonly DeploymentMigrationExpectation[];
  adminEmail: string;
  adminPasswordHash: string;
  timeoutMs?: number;
  createClient?: (config: ClientConfig) => ReadinessClient;
}

export function readDeploymentMigrationManifest(projectRoot: string): DeploymentMigrationExpectation[] {
  return listCurrentPrismaMigrations(projectRoot);
}

export async function checkDeploymentReadiness(options: DeploymentReadinessOptions): Promise<boolean> {
  if (!options.databaseUrl || !options.adminEmail || !options.adminPasswordHash || options.expectedMigrations.length === 0) {
    return false;
  }
  const timeoutMs = Math.min(Math.max(Math.floor(options.timeoutMs ?? 2_500), 1), 10_000);
  const deadlineAt = Date.now() + timeoutMs;
  let client: ReadinessClient | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let ready = false;
  try {
    const config: ClientConfig = {
      connectionString: options.databaseUrl,
      application_name: "job-finder-deployment-readiness",
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      options: "-c default_transaction_read_only=on"
    };
    client = options.createClient?.(config) ?? new Client(config) as ReadinessClient;
    const operation = (async () => {
      await client!.connect();
      const migrations = await client!.query(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name COLLATE "C", id COLLATE "C"'
      );
      if (!matchesMigrationManifest(migrations.rows, options.expectedMigrations)) return false;
      const admin = await client!.query(
        'SELECT EXISTS (SELECT 1 FROM "AdminUser" WHERE email = $1 AND "passwordHash" = $2 AND "disabledAt" IS NULL AND role = \'ADMIN\') AS initialized',
        [options.adminEmail.toLowerCase(), options.adminPasswordHash]
      );
      return admin.rows[0]?.initialized === true;
    })().catch(() => false);
    ready = await Promise.race([
      operation,
      new Promise<boolean>((resolvePromise) => {
        timeout = setTimeout(() => resolvePromise(false), timeoutMs);
      })
    ]);
  } catch {
    ready = false;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (client) {
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      const cleanup = Promise.resolve().then(() => client!.end()).then(() => true, () => false);
      if (remainingMs === 0) {
        void cleanup;
        ready = false;
      } else {
        let cleanupTimeout: NodeJS.Timeout | undefined;
        const cleaned = await Promise.race([
          cleanup,
          new Promise<boolean>((resolvePromise) => {
            cleanupTimeout = setTimeout(() => resolvePromise(false), remainingMs);
          })
        ]);
        if (cleanupTimeout) clearTimeout(cleanupTimeout);
        if (!cleaned) ready = false;
      }
    }
  }
  return ready;
}

export function createCachedDeploymentReadiness(
  options: DeploymentReadinessOptions,
  successTtlMs = 1_500,
  failureTtlMs = 250
): () => Promise<boolean> {
  let cached: { value: boolean; expiresAt: number } | undefined;
  let inFlight: Promise<boolean> | undefined;
  return () => {
    const now = Date.now();
    if (cached && now < cached.expiresAt) return Promise.resolve(cached.value);
    if (inFlight) return inFlight;
    inFlight = checkDeploymentReadiness(options).then((value) => {
      cached = { value, expiresAt: Date.now() + (value ? successTtlMs : failureTtlMs) };
      return value;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
}

function matchesMigrationManifest(
  rows: readonly Record<string, unknown>[],
  expected: readonly DeploymentMigrationExpectation[]
): boolean {
  if (rows.some((row) => row.finished_at == null && row.rolled_back_at == null)) return false;
  const successful = rows.filter((row) => row.finished_at != null && row.rolled_back_at == null);
  if (successful.length !== expected.length) return false;
  return expected.every((migration, index) => successful[index]?.migration_name === migration.migrationName &&
    successful[index]?.checksum === migration.checksum);
}
