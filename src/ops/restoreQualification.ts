import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface RestoreQualificationFacts {
  migrationCount: number;
  successfulFullReleaseBatchCount: number;
  certifiedSourceResultCount: number;
  trustedVisibleJobCount: number;
  orphanObservationCount: number;
  orphanSourceResultCount: number;
  orphanJobCount: number;
}

export interface RestoreQualificationReceipt {
  schemaVersion: 1;
  decision: "PASSED";
  verifiedAt: string;
  archiveSha256: string;
  backupMetadataSha256: string;
  sourceServerVersionNum: string;
  targetServerVersionNum: string;
  verification: RestoreQualificationFacts;
  contentSha256: string;
}

export async function readRestoreQualificationEvidence(path: string): Promise<{
  latestRestoreAt?: string; latestRestoreSucceeded?: boolean
}> {
  try {
    const value = JSON.parse((await readFile(path)).toString("utf8")) as unknown;
    if (!isRecord(value) || value.schemaVersion !== 1 || value.decision !== "PASSED" ||
      typeof value.verifiedAt !== "string" || !Number.isFinite(new Date(value.verifiedAt).getTime()) ||
      typeof value.contentSha256 !== "string") return { latestRestoreSucceeded: false };
    const { contentSha256, ...base } = value;
    if (contentSha256 !== sha256(Buffer.from(JSON.stringify(base)))) {
      return { latestRestoreAt: value.verifiedAt, latestRestoreSucceeded: false };
    }
    return { latestRestoreAt: value.verifiedAt, latestRestoreSucceeded: true };
  } catch { return {}; }
}

export interface RestoreQualificationDeps {
  serverVersionNum(databaseUrl: string): Promise<string>;
  createDatabase(adminDatabaseUrl: string, databaseName: string): Promise<void>;
  restoreArchive(targetDatabaseUrl: string, archivePath: string): Promise<void>;
  inspectRestoredDatabase(targetDatabaseUrl: string): Promise<RestoreQualificationFacts>;
  dropDatabase(adminDatabaseUrl: string, databaseName: string): Promise<void>;
}

export async function qualifyBackupRestore(input: {
  archivePath: string;
  checksumPath: string;
  metadataPath: string;
  adminDatabaseUrl: string;
  receiptPath: string;
  now: Date;
}, deps: RestoreQualificationDeps): Promise<RestoreQualificationReceipt> {
  const [archiveBytes, checksumBytes, metadataBytes] = await Promise.all([
    readFile(input.archivePath), readFile(input.checksumPath), readFile(input.metadataPath)
  ]);
  const archiveSha256 = sha256(archiveBytes);
  const checksumLine = checksumBytes.toString("utf8");
  if (checksumLine !== `${archiveSha256}  ${input.archivePath.replaceAll("\\", "/").split("/").at(-1)}\n`) {
    throw new Error("Backup checksum commit marker mismatch");
  }
  const metadata = parseBackupMetadata(metadataBytes);
  if (metadata.archiveSha256 !== archiveSha256) throw new Error("Backup metadata archive hash mismatch");
  if (!/^16\d{4}$/u.test(metadata.database.serverVersionNum)) {
    throw new Error("Backup source server is not PostgreSQL 16");
  }
  const adminServerVersionNum = await deps.serverVersionNum(input.adminDatabaseUrl);
  if (!/^16\d{4}$/u.test(adminServerVersionNum)) throw new Error("Restore target server is not PostgreSQL 16");
  const databaseName = `jobfinder_restore_${randomBytes(8).toString("hex")}`;
  const targetDatabaseUrl = replaceDatabaseName(input.adminDatabaseUrl, databaseName);
  let created = false;
  try {
    await deps.createDatabase(input.adminDatabaseUrl, databaseName);
    created = true;
    await deps.restoreArchive(targetDatabaseUrl, input.archivePath);
    const facts = await deps.inspectRestoredDatabase(targetDatabaseUrl);
    assertRestoreFacts(facts);
    const base = {
      schemaVersion: 1 as const,
      decision: "PASSED" as const,
      verifiedAt: input.now.toISOString(),
      archiveSha256,
      backupMetadataSha256: sha256(metadataBytes),
      sourceServerVersionNum: metadata.database.serverVersionNum,
      targetServerVersionNum: adminServerVersionNum,
      verification: facts
    };
    const receipt = { ...base, contentSha256: sha256(Buffer.from(JSON.stringify(base))) };
    await writeJsonAtomically(input.receiptPath, receipt);
    return receipt;
  } finally {
    if (created) await deps.dropDatabase(input.adminDatabaseUrl, databaseName);
  }
}

function assertRestoreFacts(facts: RestoreQualificationFacts): void {
  for (const [name, value] of Object.entries(facts)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Restore fact is invalid: ${name}`);
  }
  if (facts.migrationCount === 0 || facts.successfulFullReleaseBatchCount === 0 ||
    facts.certifiedSourceResultCount === 0 || facts.trustedVisibleJobCount === 0) {
    throw new Error("Restored database lacks migrations, formal batch, certificate, or trusted visible job evidence");
  }
  if (facts.orphanObservationCount !== 0 || facts.orphanSourceResultCount !== 0 || facts.orphanJobCount !== 0) {
    throw new Error("Restored database has broken critical relationships");
  }
}

function parseBackupMetadata(bytes: Buffer): {
  schemaVersion: 1; archiveSha256: string; database: { serverVersionNum: string }
} {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error("Backup metadata is not valid JSON"); }
  if (!isRecord(value) || value.schemaVersion !== 1 || !/^[0-9a-f]{64}$/u.test(String(value.archiveSha256)) ||
    !isRecord(value.database) || typeof value.database.serverVersionNum !== "string") {
    throw new Error("Backup metadata schema is invalid");
  }
  return value as never;
}

function replaceDatabaseName(databaseUrl: string, databaseName: string): string {
  const parsed = new URL(databaseUrl);
  if (!/^postgres(?:ql)?:$/u.test(parsed.protocol) || !/^[a-z0-9_]+$/u.test(databaseName)) {
    throw new Error("Restore admin database URL or generated database name is invalid");
  }
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const absolute = resolve(path), temporary = `${absolute}.${process.pid}.tmp`;
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, absolute);
}

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
