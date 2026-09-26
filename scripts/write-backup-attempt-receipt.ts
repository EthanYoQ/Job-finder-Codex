import { publishBackupAttemptReceipt } from "../src/ops/backupAttemptReceipt";

const [path, decision, attemptedAt, completedAt, archiveName, archiveSha256] = process.argv.slice(2);
if (!path || !attemptedAt || !["RUNNING", "FAILED", "SUCCEEDED"].includes(decision ?? "")) {
  throw new Error("Usage: write-backup-attempt-receipt <path> <RUNNING|FAILED|SUCCEEDED> <attemptedAt> [completedAt archiveName archiveSha256]");
}
await publishBackupAttemptReceipt(path, {
  decision: decision as "RUNNING" | "FAILED" | "SUCCEEDED",
  attemptedAt,
  ...(completedAt ? { completedAt } : {}),
  ...(archiveName ? { archiveName } : {}),
  ...(archiveSha256 ? { archiveSha256 } : {})
});
