import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

interface BackupAttemptBase {
  schemaVersion: 1;
  decision: "RUNNING" | "FAILED" | "SUCCEEDED";
  attemptedAt: string;
}

export type BackupAttemptReceipt =
  | (BackupAttemptBase & { decision: "RUNNING"; contentSha256: string })
  | (BackupAttemptBase & { decision: "FAILED"; completedAt: string; contentSha256: string })
  | (BackupAttemptBase & {
      decision: "SUCCEEDED";
      completedAt: string;
      archiveName: string;
      archiveSha256: string;
      contentSha256: string;
    });

export async function publishBackupAttemptReceipt(
  path: string,
  input: { decision: BackupAttemptReceipt["decision"]; attemptedAt: string; completedAt?: string;
    archiveName?: string; archiveSha256?: string }
): Promise<BackupAttemptReceipt> {
  const base = input.decision === "RUNNING"
    ? { schemaVersion: 1 as const, decision: input.decision, attemptedAt: input.attemptedAt }
    : input.decision === "FAILED"
      ? { schemaVersion: 1 as const, decision: input.decision, attemptedAt: input.attemptedAt,
          completedAt: requiredDate(input.completedAt) }
      : { schemaVersion: 1 as const, decision: input.decision, attemptedAt: input.attemptedAt,
          completedAt: requiredDate(input.completedAt), archiveName: requiredArchiveName(input.archiveName),
          archiveSha256: requiredSha(input.archiveSha256) };
  const receipt = { ...base, contentSha256: sha(JSON.stringify(base)) } as BackupAttemptReceipt;
  const absolute = resolve(path);
  const temporary = `${absolute}.${process.pid}.tmp`;
  await mkdir(dirname(absolute), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, absolute);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return receipt;
}

export async function readBackupAttemptEvidence(path: string): Promise<{
  latestBackupAt?: string; latestBackupSucceeded?: boolean; archiveName?: string; archiveSha256?: string
}> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isReceipt(value)) return { latestBackupSucceeded: false };
    const { contentSha256, ...base } = value;
    if (contentSha256 !== sha(JSON.stringify(base))) {
      return { latestBackupAt: receiptTime(value), latestBackupSucceeded: false };
    }
    if (value.decision !== "SUCCEEDED") {
      return { latestBackupAt: receiptTime(value), latestBackupSucceeded: false };
    }
    const receiptDir = dirname(resolve(path));
    const archivePath = resolve(receiptDir, value.archiveName);
    if (dirname(archivePath) !== receiptDir || basename(archivePath) !== value.archiveName) {
      return { latestBackupAt: value.completedAt, latestBackupSucceeded: false };
    }
    const pathStat = await lstat(archivePath);
    if (!pathStat.isFile()) return { latestBackupAt: value.completedAt, latestBackupSucceeded: false };
    const handle = await open(archivePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
        return { latestBackupAt: value.completedAt, latestBackupSucceeded: false };
      }
      const digest = createHash("sha256");
      for await (const chunk of handle.createReadStream()) digest.update(chunk);
      return { latestBackupAt: value.completedAt, latestBackupSucceeded: digest.digest("hex") === value.archiveSha256,
        archiveName: value.archiveName, archiveSha256: value.archiveSha256 };
    } finally { await handle.close(); }
  } catch { return {}; }
}

function isReceipt(value: unknown): value is BackupAttemptReceipt {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validDate(value.attemptedAt) || !validSha(value.contentSha256)) return false;
  if (value.decision === "RUNNING") return exactKeys(value, ["schemaVersion", "decision", "attemptedAt", "contentSha256"]);
  if (value.decision === "FAILED") return exactKeys(value,
    ["schemaVersion", "decision", "attemptedAt", "completedAt", "contentSha256"]) && validDate(value.completedAt);
  if (value.decision !== "SUCCEEDED" || !exactKeys(value,
    ["schemaVersion", "decision", "attemptedAt", "completedAt", "archiveName", "archiveSha256", "contentSha256"]) ||
    !validDate(value.completedAt) || !validSha(value.archiveSha256)) return false;
  try { return requiredArchiveName(value.archiveName) === value.archiveName; } catch { return false; }
}

function receiptTime(value: BackupAttemptReceipt): string { return value.decision === "RUNNING" ? value.attemptedAt : value.completedAt; }
function requiredDate(value: unknown): string { if (!validDate(value)) throw new Error("Backup attempt completion date is invalid"); return value; }
function requiredSha(value: unknown): string { if (!validSha(value)) throw new Error("Backup archive digest is invalid"); return value; }
function requiredArchiveName(value: unknown): string {
  if (typeof value !== "string" || basename(value) !== value || !/^jobfinder-[A-Za-z0-9-]+\.dump$/u.test(value)) {
    throw new Error("Backup archive name is invalid");
  }
  return value;
}
function validDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validSha(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
