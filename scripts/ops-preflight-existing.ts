import { pathToFileURL } from "node:url";
import { preflightExistingDatabase } from "../src/db/existingDatabasePreflight";
import { listCurrentPrismaMigrations } from "../src/db/prismaMigrationManifest";

export async function runExistingDatabasePreflight(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const report = await preflightExistingDatabase({
    databaseUrl: env.DATABASE_URL ?? "", expectedMigrations: listCurrentPrismaMigrations(process.cwd())
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExistingDatabasePreflight().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Existing-database preflight failed"}\n`);
    process.exitCode = 1;
  });
}
