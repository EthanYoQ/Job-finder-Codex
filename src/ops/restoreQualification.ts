import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PrismaMigrationArtifact } from "../db/prismaMigrationManifest";

export interface RestoreQualificationFacts {
  migrations: readonly PrismaMigrationArtifact[];
  successfulFullReleaseBatchCount: number;
  certifiedSourceResultCount: number;
  trustedVisibleJobCount: number;
  qualifiedEvidenceChainCount: number;
  orphanObservationCount: number;
  orphanSourceResultCount: number;
  orphanJobCount: number;
  mismatchedJobSourceCompanyCount: number;
}

interface RestoreReceiptBase {
  schemaVersion: 1;
  decision: "PASSED" | "FAILED";
  verifiedAt: string;
  archiveSha256: string | null;
  backupMetadataSha256: string | null;
  sourceServerVersionNum: string | null;
  targetServerVersionNum: string | null;
}

interface RunningRestoreQualificationReceipt {
  schemaVersion: 1;
  decision: "RUNNING";
  startedAt: string;
  contentSha256: string;
}

export interface PassedRestoreQualificationReceipt extends RestoreReceiptBase {
  decision: "PASSED";
  archiveSha256: string;
  backupMetadataSha256: string;
  sourceServerVersionNum: string;
  targetServerVersionNum: string;
  verification: RestoreQualificationFacts;
  contentSha256: string;
}

export interface FailedRestoreQualificationReceipt extends RestoreReceiptBase {
  decision: "FAILED";
  failureCode: "VALIDATION_FAILED" | "CREATE_FAILED" | "RESTORE_FAILED" | "INSPECTION_FAILED" | "CLEANUP_FAILED";
  contentSha256: string;
}

export type RestoreQualificationReceipt = RunningRestoreQualificationReceipt | PassedRestoreQualificationReceipt | FailedRestoreQualificationReceipt;

export async function readRestoreQualificationEvidence(path: string): Promise<{
  latestRestoreAt?: string; latestRestoreSucceeded?: boolean
}> {
  try {
    const value = JSON.parse((await readFile(path)).toString("utf8")) as unknown;
    if (!isRestoreReceipt(value)) return { latestRestoreSucceeded: false };
    const { contentSha256, ...base } = value;
    if (contentSha256 !== sha256(Buffer.from(JSON.stringify(base)))) {
      return { latestRestoreAt: "verifiedAt" in value ? value.verifiedAt : value.startedAt, latestRestoreSucceeded: false };
    }
    return { latestRestoreAt: "verifiedAt" in value ? value.verifiedAt : value.startedAt,
      latestRestoreSucceeded: value.decision === "PASSED" };
  } catch { return {}; }
}

export interface RestoreQualificationDeps {
  serverVersionNum(databaseUrl: string): Promise<string>;
  createDatabase(adminDatabaseUrl: string, databaseName: string): Promise<void>;
  restoreArchive(targetDatabaseUrl: string, archivePath: string): Promise<void>;
  inspectRestoredDatabase(targetDatabaseUrl: string): Promise<RestoreQualificationFacts>;
  dropDatabase(adminDatabaseUrl: string, databaseName: string): Promise<void>;
  publishReceipt?(path: string, value: RestoreQualificationReceipt): Promise<void>;
  invalidateReceipt?(path: string): Promise<void>;
}

export async function qualifyBackupRestore(input: {
  archivePath: string;
  checksumPath: string;
  metadataPath: string;
  adminDatabaseUrl: string;
  receiptPath: string;
  expectedMigrations: readonly PrismaMigrationArtifact[];
  now: Date;
}, deps: RestoreQualificationDeps): Promise<PassedRestoreQualificationReceipt> {
  await invalidate(deps, input.receiptPath);
  const runningBase = { schemaVersion: 1 as const, decision: "RUNNING" as const, startedAt: input.now.toISOString() };
  await publish(deps, input.receiptPath, { ...runningBase, contentSha256: sha256(Buffer.from(JSON.stringify(runningBase))) });
  let stage: FailedRestoreQualificationReceipt["failureCode"] = "VALIDATION_FAILED";
  let archiveSha256: string | null = null;
  let backupMetadataSha256: string | null = null;
  let sourceServerVersionNum: string | null = null;
  let targetServerVersionNum: string | null = null;
  const databaseName = `jobfinder_restore_${randomBytes(8).toString("hex")}`;
  let createAttempted = false;
  let candidate: Omit<PassedRestoreQualificationReceipt, "contentSha256"> | undefined;
  let failure: unknown;
  try {
    const [archiveBytes, checksumBytes, metadataBytes] = await Promise.all([
      readFile(input.archivePath), readFile(input.checksumPath), readFile(input.metadataPath)
    ]);
    archiveSha256 = sha256(archiveBytes);
    const checksumLine = checksumBytes.toString("utf8");
    if (checksumLine !== `${archiveSha256}  ${input.archivePath.replaceAll("\\", "/").split("/").at(-1)}\n`) {
      throw new Error("Backup checksum commit marker mismatch");
    }
    const metadata = parseBackupMetadata(metadataBytes);
    backupMetadataSha256 = sha256(metadataBytes);
    sourceServerVersionNum = metadata.database.serverVersionNum;
    if (metadata.archiveSha256 !== archiveSha256) throw new Error("Backup metadata archive hash mismatch");
    if (!/^16\d{4}$/u.test(sourceServerVersionNum)) throw new Error("Backup source server is not PostgreSQL 16");
    targetServerVersionNum = await deps.serverVersionNum(input.adminDatabaseUrl);
    if (!/^16\d{4}$/u.test(targetServerVersionNum)) throw new Error("Restore target server is not PostgreSQL 16");
    stage = "CREATE_FAILED";
    createAttempted = true;
    await deps.createDatabase(input.adminDatabaseUrl, databaseName);
    const targetDatabaseUrl = replaceDatabaseName(input.adminDatabaseUrl, databaseName);
    stage = "RESTORE_FAILED";
    await deps.restoreArchive(targetDatabaseUrl, input.archivePath);
    stage = "INSPECTION_FAILED";
    const facts = await deps.inspectRestoredDatabase(targetDatabaseUrl);
    assertRestoreFacts(facts, input.expectedMigrations);
    candidate = {
      schemaVersion: 1, decision: "PASSED", verifiedAt: input.now.toISOString(), archiveSha256,
      backupMetadataSha256, sourceServerVersionNum, targetServerVersionNum, verification: facts
    };
  } catch (error) {
    failure = error;
  }

  if (createAttempted) {
    try {
      await deps.dropDatabase(input.adminDatabaseUrl, databaseName);
    } catch (cleanupError) {
      stage = "CLEANUP_FAILED";
      failure = failure === undefined ? cleanupError : new AggregateError([failure, cleanupError], "Restore qualification and cleanup failed");
    }
  }

  if (failure !== undefined || candidate === undefined) {
    const failedBase: Omit<FailedRestoreQualificationReceipt, "contentSha256"> = {
      schemaVersion: 1, decision: "FAILED", verifiedAt: input.now.toISOString(), archiveSha256,
      backupMetadataSha256, sourceServerVersionNum, targetServerVersionNum, failureCode: stage
    };
    await publish(deps, input.receiptPath, { ...failedBase, contentSha256: sha256(Buffer.from(JSON.stringify(failedBase))) });
    throw failure ?? new Error("Backup restore qualification failed");
  }
  const receipt = { ...candidate, contentSha256: sha256(Buffer.from(JSON.stringify(candidate))) };
  await publish(deps, input.receiptPath, receipt);
  return receipt;
}

function assertRestoreFacts(facts: RestoreQualificationFacts, expectedMigrations: readonly PrismaMigrationArtifact[]): void {
  for (const [name, value] of Object.entries(facts).filter(([key]) => key !== "migrations")) {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Restore fact is invalid: ${name}`);
  }
  const canonical = (values: readonly PrismaMigrationArtifact[]) => JSON.stringify([...values].sort((a, b) =>
    Buffer.from(a.migrationName, "utf8").compare(Buffer.from(b.migrationName, "utf8"))));
  if (canonical(facts.migrations) !== canonical(expectedMigrations)) throw new Error("Restored database migration manifest mismatch");
  if (facts.successfulFullReleaseBatchCount === 0 || facts.certifiedSourceResultCount === 0 ||
    facts.trustedVisibleJobCount === 0 || facts.qualifiedEvidenceChainCount === 0) {
    throw new Error("Restored database lacks a qualified formal batch evidence chain");
  }
  if (facts.orphanObservationCount !== 0 || facts.orphanSourceResultCount !== 0 || facts.orphanJobCount !== 0 ||
    facts.mismatchedJobSourceCompanyCount !== 0) throw new Error("Restored database has broken critical relationships");
}

function parseBackupMetadata(bytes: Buffer): { schemaVersion: 1; archiveSha256: string; database: { serverVersionNum: string } } {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error("Backup metadata is not valid JSON"); }
  if (!isRecord(value) || value.schemaVersion !== 1 || !/^[0-9a-f]{64}$/u.test(String(value.archiveSha256)) ||
    !isRecord(value.database) || typeof value.database.serverVersionNum !== "string") throw new Error("Backup metadata schema is invalid");
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

async function publish(deps: RestoreQualificationDeps, path: string, value: RestoreQualificationReceipt): Promise<void> {
  if (deps.publishReceipt) return deps.publishReceipt(path, value);
  const absolute = resolve(path), temporary = `${absolute}.${process.pid}.tmp`;
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, absolute);
}

async function invalidate(deps: RestoreQualificationDeps, path: string): Promise<void> {
  if (deps.invalidateReceipt) return deps.invalidateReceipt(path);
  try { await unlink(resolve(path)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

function isRestoreReceipt(value: unknown): value is RestoreQualificationReceipt {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.contentSha256 !== "string") return false;
  if (value.decision === "RUNNING") return exactKeys(value, ["schemaVersion", "decision", "startedAt", "contentSha256"]) && validDate(value.startedAt);
  const baseKeys = ["schemaVersion", "decision", "verifiedAt", "archiveSha256", "backupMetadataSha256",
    "sourceServerVersionNum", "targetServerVersionNum", "contentSha256"];
  if (value.decision === "FAILED") return exactKeys(value, [...baseKeys, "failureCode"]) && validDate(value.verifiedAt) &&
    ["VALIDATION_FAILED", "CREATE_FAILED", "RESTORE_FAILED", "INSPECTION_FAILED", "CLEANUP_FAILED"].includes(String(value.failureCode)) &&
    nullableSha(value.archiveSha256) && nullableSha(value.backupMetadataSha256) &&
    nullableString(value.sourceServerVersionNum) && nullableString(value.targetServerVersionNum);
  if (value.decision !== "PASSED" || !exactKeys(value, [...baseKeys, "verification"]) || !validDate(value.verifiedAt) ||
    !validSha(value.archiveSha256) || !validSha(value.backupMetadataSha256) ||
    !isPg16(value.sourceServerVersionNum) || !isPg16(value.targetServerVersionNum) || !isRecord(value.verification)) return false;
  const facts = value.verification;
  const factKeys = ["migrations", "successfulFullReleaseBatchCount", "certifiedSourceResultCount", "trustedVisibleJobCount",
    "qualifiedEvidenceChainCount", "orphanObservationCount", "orphanSourceResultCount", "orphanJobCount", "mismatchedJobSourceCompanyCount"];
  return exactKeys(facts, factKeys) && Array.isArray(facts.migrations) && facts.migrations.every((row) => isRecord(row) &&
    exactKeys(row, ["migrationName", "checksum"]) && typeof row.migrationName === "string" && validSha(row.checksum)) &&
    factKeys.slice(1).every((key) => Number.isSafeInteger(facts[key]) && (facts[key] as number) >= 0);
}

const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const validSha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const nullableSha = (value: unknown): boolean => value === null || validSha(value);
const nullableString = (value: unknown): boolean => value === null || typeof value === "string";
const isPg16 = (value: unknown): value is string => typeof value === "string" && /^16\d{4}$/u.test(value);
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
