import { pathToFileURL } from "node:url";
import { runDeploymentMigrations } from "./ops-bootstrap";

export function runGuardedMigration(env: NodeJS.ProcessEnv = process.env): void {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("Database migration requires DATABASE_URL");
  runDeploymentMigrations(databaseUrl);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { runGuardedMigration(); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Database migration failed"}\n`);
    process.exitCode = 1;
  }
}
