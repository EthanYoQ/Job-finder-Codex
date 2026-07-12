import { executeEmptyDatabaseMigrationVerificationCli } from "../src/db/emptyDatabaseMigrationVerificationCli";

try {
  const report = await executeEmptyDatabaseMigrationVerificationCli();
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch {
  process.stderr.write("Empty database migration verification failed.\n");
  process.exitCode = 1;
}
