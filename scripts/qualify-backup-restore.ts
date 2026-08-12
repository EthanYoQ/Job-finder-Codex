import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
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
    await execFileAsync("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner",
      "--no-privileges", `--dbname=${targetDatabaseUrl}`, archivePath], {
      timeout: 10 * 60_000, windowsHide: true, maxBuffer: 1024 * 1024
    });
  },
  async inspectRestoredDatabase(targetDatabaseUrl) {
    return withClient(targetDatabaseUrl, async (client) => {
      const result = await client.query<Record<keyof RestoreQualificationFacts, string>>(RESTORE_FACTS_SQL);
      const row = result.rows[0];
      if (!row) throw new Error("Restored database verification returned no facts");
      return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) as unknown as RestoreQualificationFacts;
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
  (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "migrationCount",
  (SELECT count(*) FROM "CrawlBatch" WHERE kind = 'FULL_RELEASE' AND status = 'SUCCESS') AS "successfulFullReleaseBatchCount",
  (SELECT count(*) FROM "CrawlBatchSourceResult" WHERE "completenessCertificateSha256" IS NOT NULL
    AND "atomicCommitState" = 'COMMITTED' AND "completenessState" = 'VERIFIED') AS "certifiedSourceResultCount",
  (SELECT count(*) FROM "Job" WHERE "visibleInFrontend" = true AND "lifecycleStatus" = 'ACTIVE') AS "trustedVisibleJobCount",
  (SELECT count(*) FROM "CrawlObservation" o LEFT JOIN "RecruitmentSource" s ON s.id=o."sourceId"
    WHERE s.id IS NULL OR (o."batchId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CrawlBatch" b WHERE b.id=o."batchId"))) AS "orphanObservationCount",
  (SELECT count(*) FROM "CrawlBatchSourceResult" r LEFT JOIN "CrawlBatch" b ON b.id=r."batchId"
    LEFT JOIN "RecruitmentSource" s ON s.id=r."sourceId" WHERE b.id IS NULL OR s.id IS NULL) AS "orphanSourceResultCount",
  (SELECT count(*) FROM "Job" j LEFT JOIN "Company" c ON c.id=j."companyId"
    LEFT JOIN "RecruitmentSource" s ON s.id=j."sourceId" WHERE c.id IS NULL OR s.id IS NULL) AS "orphanJobCount"
`;

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
    metadataPath: `${archivePath}.metadata.json`, adminDatabaseUrl, receiptPath, now: new Date() }, deps);
  console.log(JSON.stringify({ decision: receipt.decision, receiptPath, contentSha256: receipt.contentSha256 }));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Backup restore qualification failed");
    process.exitCode = 1;
  });
}
