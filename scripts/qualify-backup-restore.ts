import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { listCurrentPrismaMigrations } from "../src/db/prismaMigrationManifest";
import {
  qualifyBackupRestore,
  type RestoreQualificationDeps,
  type RestoreQualificationFacts
} from "../src/ops/restoreQualification";

const execFileAsync = promisify(execFile);

const deps: RestoreQualificationDeps = {
  async serverVersionNum(databaseUrl) {
    return withClient(databaseUrl, async (client) => (await client.query<{ server_version_num: string }>(
      "SHOW server_version_num"
    )).rows[0]!.server_version_num);
  },
  async createDatabase(adminDatabaseUrl, databaseName) {
    await withClient(adminDatabaseUrl, async (client) => { await client.query(`CREATE DATABASE "${databaseName}"`); });
  },
  async restoreArchive(targetDatabaseUrl, archivePath) {
    const connection = libpqEnvironment(targetDatabaseUrl);
    await execFileAsync("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner",
      "--no-privileges", `--dbname=${connection.database}`, archivePath], {
      env: { ...process.env, ...connection.env }, timeout: 10 * 60_000, windowsHide: true, maxBuffer: 1024 * 1024
    });
  },
  async inspectRestoredDatabase(targetDatabaseUrl) {
    return withClient(targetDatabaseUrl, async (client) => {
      const result = await client.query<Record<Exclude<keyof RestoreQualificationFacts, "migrations">, string>>(RESTORE_FACTS_SQL);
      const row = result.rows[0];
      if (!row) throw new Error("Restored database verification returned no facts");
      const migrations = (await client.query<{ migrationName: string; checksum: string }>(
        `SELECT migration_name AS "migrationName", checksum FROM "_prisma_migrations"
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name COLLATE "C", id`
      )).rows;
      return { ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])), migrations } as RestoreQualificationFacts;
    });
  },
  async dropDatabase(adminDatabaseUrl, databaseName) {
    await withClient(adminDatabaseUrl, async (client) => {
      await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  }
};

const RESTORE_FACTS_SQL = `
SELECT
  (SELECT count(*) FROM "CrawlBatch" WHERE kind = 'FULL_RELEASE' AND status = 'SUCCESS') AS "successfulFullReleaseBatchCount",
  (SELECT count(*) FROM "CrawlBatchSourceResult" WHERE "completenessCertificateSha256" IS NOT NULL
    AND "atomicCommitState" = 'COMMITTED' AND "completenessState" = 'VERIFIED') AS "certifiedSourceResultCount",
  (SELECT count(*) FROM "Job" WHERE "visibleInFrontend" = true AND "lifecycleStatus" = 'ACTIVE') AS "trustedVisibleJobCount",
  (SELECT count(DISTINCT r.id) FROM "CrawlBatchSourceResult" r
    JOIN "CrawlBatch" b ON b.id=r."batchId" AND b."releaseCandidateId"=r."releaseCandidateId"
    JOIN "RecruitmentSource" s ON s.id=r."sourceId"
    JOIN "LifecycleSetEvidenceMember" m ON m."sourceResultId"=r.id AND m."batchId"=r."batchId"
      AND m."releaseCandidateId"=r."releaseCandidateId" AND m."sourceId"=r."sourceId"
      AND m."setKind"='VISIBLE' AND m."lifecycleStatus"='ACTIVE'
    JOIN "Job" j ON j."sourceId"=m."sourceId" AND j."dedupeKey"=m."jobKey"
      AND j."companyId"=s."companyId" AND j."visibleInFrontend"=true AND j."lifecycleStatus"='ACTIVE'
    WHERE b.kind='FULL_RELEASE' AND b.status='SUCCESS' AND r."completenessCertificateSha256" IS NOT NULL
      AND r."atomicCommitState"='COMMITTED' AND r."completenessState"='VERIFIED') AS "qualifiedEvidenceChainCount",
  (SELECT count(*) FROM "CrawlObservation" o LEFT JOIN "RecruitmentSource" s ON s.id=o."sourceId"
    WHERE s.id IS NULL OR (o."batchId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CrawlBatch" b WHERE b.id=o."batchId"))) AS "orphanObservationCount",
  (SELECT count(*) FROM "CrawlBatchSourceResult" r LEFT JOIN "CrawlBatch" b ON b.id=r."batchId"
    LEFT JOIN "RecruitmentSource" s ON s.id=r."sourceId" WHERE b.id IS NULL OR s.id IS NULL) AS "orphanSourceResultCount",
  (SELECT count(*) FROM "Job" j LEFT JOIN "Company" c ON c.id=j."companyId"
    LEFT JOIN "RecruitmentSource" s ON s.id=j."sourceId" WHERE c.id IS NULL OR s.id IS NULL) AS "orphanJobCount"
  ,(SELECT count(*) FROM "Job" j JOIN "RecruitmentSource" s ON s.id=j."sourceId"
    WHERE s."companyId"<>j."companyId") AS "mismatchedJobSourceCompanyCount"
`;

function libpqEnvironment(databaseUrl: string): { database: string; env: NodeJS.ProcessEnv } {
  const value = new URL(databaseUrl);
  const database = decodeURIComponent(value.pathname.replace(/^\//u, ""));
  if (!/^postgres(?:ql)?:$/u.test(value.protocol) || !database || !value.hostname) {
    throw new Error("Restore target database URL is invalid");
  }
  const env: NodeJS.ProcessEnv = { PGHOST: value.hostname, PGDATABASE: database };
  if (value.port) env.PGPORT = value.port;
  if (value.username) env.PGUSER = decodeURIComponent(value.username);
  if (value.password) env.PGPASSWORD = decodeURIComponent(value.password);
  const sslmode = value.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return { database, env };
}

async function withClient<T>(databaseUrl: string, action: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try { return await action(client); }
  finally { await client.end(); }
}

async function main(): Promise<void> {
  const archivePath = process.argv[2] ?? process.env.BACKUP_FILE;
  const adminDatabaseUrl = process.env.RESTORE_ADMIN_DATABASE_URL;
  const receiptPath = process.env.RESTORE_RECEIPT_PATH ?? ".runtime/restore/restore-receipt.json";
  if (!archivePath || !adminDatabaseUrl) throw new Error("BACKUP_FILE and RESTORE_ADMIN_DATABASE_URL are required");
  const receipt = await qualifyBackupRestore({ archivePath, checksumPath: `${archivePath}.sha256`,
    metadataPath: `${archivePath}.metadata.json`, adminDatabaseUrl, receiptPath,
    expectedMigrations: listCurrentPrismaMigrations(process.cwd()), now: new Date() }, deps);
  console.log(JSON.stringify({ decision: receipt.decision, receiptPath, contentSha256: receipt.contentSha256 }));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Backup restore qualification failed");
    process.exitCode = 1;
  });
}
