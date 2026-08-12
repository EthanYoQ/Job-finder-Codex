import { Client, type ClientConfig, type QueryResult } from "pg";

interface ReadinessClient {
  connect(): Promise<void>;
  query(queryText: string, values?: readonly unknown[]): Promise<QueryResult<Record<string, unknown>>>;
  end(): Promise<void>;
}

export interface DeploymentReadinessOptions {
  databaseUrl: string | undefined;
  expectedMigrationNames: readonly string[];
  adminEmail: string | undefined;
  adminPasswordHash?: string;
  timeoutMs?: number;
  createClient?: (config: ClientConfig) => ReadinessClient;
}

export async function checkDeploymentReadiness(options: DeploymentReadinessOptions): Promise<boolean> {
  if (!options.databaseUrl || !options.adminEmail || options.expectedMigrationNames.length === 0) return false;
  const timeoutMs = Math.min(Math.max(Math.floor(options.timeoutMs ?? 2_500), 1), 10_000);
  let client: ReadinessClient | undefined;
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
    await client.connect();
    const migrations = await client.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'
    );
    const actual = migrations.rows.map((row) => row.migration_name).filter((name): name is string => typeof name === "string");
    const expected = [...options.expectedMigrationNames].sort(compareUtf8);
    if (JSON.stringify(actual.sort(compareUtf8)) !== JSON.stringify(expected)) return false;
    const admin = await client.query(
      `SELECT EXISTS (SELECT 1 FROM "AdminUser" WHERE email = $1 AND "disabledAt" IS NULL AND role = 'ADMIN'${
        options.adminPasswordHash ? ' AND "passwordHash" = $2' : ""
      }) AS initialized`,
      options.adminPasswordHash
        ? [options.adminEmail.toLowerCase(), options.adminPasswordHash]
        : [options.adminEmail.toLowerCase()]
    );
    return admin.rows[0]?.initialized === true;
  } catch {
    return false;
  } finally {
    try { await client?.end(); } catch { /* readiness remains fail-closed */ }
  }
}

const compareUtf8 = (left: string, right: string): number => Buffer.from(left).compare(Buffer.from(right));
