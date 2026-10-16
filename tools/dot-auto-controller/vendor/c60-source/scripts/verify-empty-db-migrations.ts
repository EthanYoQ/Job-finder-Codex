import { executeEmptyDatabaseMigrationVerificationCli, formatEmptyDatabaseMigrationVerificationFailure } from "../src/db/emptyDatabaseMigrationVerificationCli";

try {
  const report = await executeEmptyDatabaseMigrationVerificationCli();
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  process.stderr.write(`${formatEmptyDatabaseMigrationVerificationFailure(error)}\n`);
  process.exitCode = 1;
}
