import { Client, type ClientConfig, type QueryResult } from "pg";

export const DEFAULT_POSTGRES_READINESS_TIMEOUT_MS = 2_500;

interface PostgresReadinessClient {
  connect(): Promise<void>;
  query(queryText: string): Promise<QueryResult<{ readiness: number }>>;
  end(): Promise<void>;
}

export interface PostgresReadinessOptions {
  timeoutMs?: number;
  createClient?: (config: ClientConfig) => PostgresReadinessClient;
}

export interface CachedPostgresReadinessOptions extends PostgresReadinessOptions {
  successTtlMs?: number;
  failureTtlMs?: number;
  now?: () => number;
}

export async function checkPostgresReadiness(
  databaseUrl: string | undefined,
  options: PostgresReadinessOptions = {}
): Promise<boolean> {
  if (!databaseUrl) return false;

  const timeoutMs = normalizePostgresReadinessTimeout(options.timeoutMs);
  const deadlineAt = Date.now() + timeoutMs;
  let client: PostgresReadinessClient | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let result = false;

  try {
    const config: ClientConfig = {
      connectionString: databaseUrl,
      application_name: "job-finder-readiness",
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      options: "-c default_transaction_read_only=on"
    };
    client = options.createClient?.(config) ?? new Client(config);

    const operation = (async () => {
      await client!.connect();
      const result = await client!.query("SELECT 1 AS readiness");
      return result.rowCount === 1 && result.rows[0]?.readiness === 1;
    })();
    const deadline = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    });

    result = await Promise.race([operation, deadline]);
  } catch {
    result = false;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (client) {
      let cleanup: Promise<boolean>;
      try {
        cleanup = Promise.resolve(client.end()).then(
          () => true,
          () => false
        );
      } catch {
        cleanup = Promise.resolve(false);
      }
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      let cleanupSucceeded = false;
      if (remainingMs > 0) {
        let cleanupTimeout: NodeJS.Timeout | undefined;
        cleanupSucceeded = await Promise.race([
          cleanup,
          new Promise<boolean>((resolve) => {
            cleanupTimeout = setTimeout(() => resolve(false), remainingMs);
          })
        ]);
        if (cleanupTimeout) clearTimeout(cleanupTimeout);
      } else {
        void cleanup;
      }
      if (!cleanupSucceeded) result = false;
    }
  }
  return result;
}

export function createCachedPostgresReadiness(
  databaseUrl: string | undefined,
  options: CachedPostgresReadinessOptions = {}
): () => Promise<boolean> {
  const now = options.now ?? Date.now;
  const successTtlMs = normalizeTtl(options.successTtlMs, 1_500);
  const failureTtlMs = normalizeTtl(options.failureTtlMs, 250);
  let cached: { value: boolean; expiresAt: number } | undefined;
  let inFlight: Promise<boolean> | undefined;

  return () => {
    const currentTime = now();
    if (cached && currentTime < cached.expiresAt) return Promise.resolve(cached.value);
    if (inFlight) return inFlight;

    inFlight = checkPostgresReadiness(databaseUrl, options)
      .then((value) => {
        cached = {
          value,
          expiresAt: now() + (value ? successTtlMs : failureTtlMs)
        };
        return value;
      })
      .catch(() => false)
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };
}

export function normalizePostgresReadinessTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return DEFAULT_POSTGRES_READINESS_TIMEOUT_MS;
  }
  return Math.min(Math.floor(value), 10_000);
}

function normalizeTtl(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return fallback;
  return Math.min(Math.floor(value), 10_000);
}
