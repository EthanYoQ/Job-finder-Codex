import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { resolveCurrentBuildIdentity } from "../src/readiness/buildIdentity";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import { P0_LAUNCH_MANIFEST } from "../src/release/launchManifest";
import { buildUnavailableLaunchReceipt, evaluateAuthoritativeLaunchReadiness,
  type LaunchCertificateEvidence } from "../src/release/authoritativeLaunchReceipt";
import { readImageQualificationReceipt, readRestoreReceiptSummary, readSecurityReceiptSummary } from "../src/release/launchReceiptFiles";
import { listCurrentPrismaMigrations, prismaMigrationManifestSha256 } from "../src/db/prismaMigrationManifest";
import { parseFixedCohortCompletenessAuditReport } from "../src/release/fixedCohortCompletenessAudit";
import { readFormalQualificationRoundOneReceipt } from "../src/release/formalQualificationState";

const prisma = new PrismaClient();
const receiptPath = required("LAUNCH_RECEIPT_PATH");
await writeReceipt(receiptPath, buildUnavailableLaunchReceipt(new Date(), "QUALIFICATION_IN_PROGRESS"));
try {
  const evaluatedAt = new Date(), build = resolveCurrentBuildIdentity();
  const migrations = listCurrentPrismaMigrations(process.cwd());
  const [image, security, restore] = await Promise.all([
    readImageQualificationReceipt(required("IMAGE_QUALIFICATION_RECEIPT_PATH")),
    readSecurityReceiptSummary(required("PRODUCTION_SECURITY_RECEIPT_PATH")),
    readRestoreReceiptSummary(required("RESTORE_RECEIPT_PATH"))
  ]);
  const formalQualification = await readFormalQualificationEvidence(evaluatedAt, image.imageDigest);
  const snapshot = await prisma.$transaction(async (transaction) => {
    const authority = await resolveCurrentStagedScheduleAuthority(transaction as never);
    const batches = await transaction.crawlBatch.findMany({
      where: { releaseCandidateId: authority.identity.releaseCandidateId, kind: "SCHEDULED", status: "SUCCESS",
        finishedAt: { not: null } }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: 10,
      include: { sourceResults: { orderBy: { sourceId: "asc" }, include: { observations: true } } }
    });
    const migrationRows = await transaction.$queryRaw<Array<{ migrationName: string; checksum: string;
      finishedAt: Date | null; rolledBackAt: Date | null }>>(Prisma.sql`
      SELECT migration_name AS "migrationName", checksum, finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
      FROM public."_prisma_migrations" ORDER BY migration_name COLLATE "C", id COLLATE "C"
    `);
    const adminRows = await transaction.$queryRaw<Array<{ initialized: boolean }>>(Prisma.sql`
      SELECT EXISTS (SELECT 1 FROM "AdminUser" WHERE email = ${required("ADMIN_EMAIL").toLowerCase()}
        AND "passwordHash" = ${required("ADMIN_PASSWORD_HASH")} AND "disabledAt" IS NULL AND role = 'ADMIN') AS initialized
    `);
    return { authority, batches: selectQualificationPair(batches, evaluatedAt),
      bootstrapReady: migrationHistoryMatches(migrationRows, migrations) && adminRows[0]?.initialized === true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 });
  const { authority, batches } = snapshot;
  const manifestBySource = new Map(P0_LAUNCH_MANIFEST.companies.map((company) => [company.source.sourceId, company]));
  const evidenceBatches = batches.slice(0, 2).map((batch) => ({
    id: batch.id, releaseCandidateId: batch.releaseCandidateId!, commitSha: batch.commitSha!, rosterSha256: batch.rosterSha256!,
    sourcePlanSha256: batch.sourcePlanSha256!, sourceConfigSha256: batch.sourceConfigSha256!,
    adapterBundleSha256: batch.adapterBundleSha256!, status: batch.status,
    finishedAt: batch.finishedAt?.toISOString() ?? "", certificates: batch.sourceResults.map((source): LaunchCertificateEvidence => {
      const company = manifestBySource.get(source.sourceId);
      if (source.observations.length !== 1 || source.observations[0]!.sourceResultId !== source.id ||
          !source.observations[0]!.canonicalRawSha256) throw new Error("Launch certificate raw observation binding is incomplete");
      return { sourceResultId: source.id, companyId: company?.companyId ?? "", sourceId: source.sourceId,
        category: company?.category ?? "DOMESTIC_PHARMA", grade: certificateGrade(source.completenessCertificate),
        sourceConfigSha256: source.sourceConfigHash, canonicalJobSetSha256: source.canonicalOutputSetSha256 ?? "",
        canonicalRawEvidenceIdSetSha256: source.observations[0]!.canonicalRawSha256,
        certificate: source.completenessCertificate, certificateSha256: source.completenessCertificateSha256 };
    })
  }));
  const result = evaluateAuthoritativeLaunchReadiness({ evaluatedAt, manifest: P0_LAUNCH_MANIFEST,
    source: { commitSha: build.commitSha, sourceTreeSha256: build.sourceTreeSha256,
      runtimeTreeSha256: build.runtimeTreeSha256, buildIdentityContentSha256: build.contentSha256 },
    image: { digest: image.imageDigest, revision: image.revision, qualificationSha256: image.contentSha256,
      buildIdentityContentSha256: image.buildIdentityContentSha256,
      securityReceiptSha256: image.securityReceiptSha256, restoreReceiptSha256: image.restoreReceiptSha256 },
    database: { snapshotSha256: restore.archiveSha256, schemaSha256: prismaMigrationManifestSha256(migrations),
      migrationVersion: migrations.at(-1)?.migrationName ?? "", migrationManifestSha256: prismaMigrationManifestSha256(migrations),
      bootstrapReady: snapshot.bootstrapReady }, security, restore, formalQualification,
    releaseIdentity: { releaseCandidateId: authority.identity.releaseCandidateId, commitSha: authority.identity.commitSha,
      rosterSha256: authority.identity.rosterSha256, sourcePlanSha256: authority.identity.sourcePlanSha256,
      sourceConfigSha256: authority.identity.sourceConfigSha256, adapterBundleSha256: authority.identity.adapterBundleSha256 },
    batches: evidenceBatches, operationalGates: image.gates.map((name) => ({ name, passed: true,
      evidenceSha256: image.contentSha256, reason: `qualified by exact-image gate ${name}` })) });
  await writeReceipt(receiptPath, result.receipt);
  console.log(JSON.stringify({ decision: result.receipt.decision, contentSha256: result.receipt.contentSha256 }));
  process.exitCode = result.exitCode;
} catch (error) {
  try { await writeReceipt(receiptPath, buildUnavailableLaunchReceipt(new Date(), "QUALIFICATION_EXECUTION_FAILED")); } catch { /* stale READY was invalidated before work began */ }
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED]") : "Launch qualification failed");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }

function certificateGrade(value: unknown): "A" | "B" | "C" {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const grade = (value as Record<string, unknown>).grade;
    if (grade === "A" || grade === "B") return grade;
  }
  return "C";
}

async function readFormalQualificationEvidence(now: Date, imageDigest: string) {
  const [stateEvidence, roundOneAuditEvidence, roundOneArchiveEvidence, roundOneDatabaseEvidence,
    roundTwoAuditEvidence, roundTwoArchiveEvidence] = await Promise.all([
    readEvidence(required("FORMAL_ROUND_ONE_STATE_RECEIPT_PATH")),
    readEvidence(required("FORMAL_ROUND_ONE_AUDIT_PATH")),
    readEvidence(required("FORMAL_ROUND_ONE_EVIDENCE_ARCHIVE_PATH")),
    readEvidence(required("FORMAL_ROUND_ONE_DATABASE_ARCHIVE_PATH")),
    readEvidence(required("FORMAL_ROUND_TWO_AUDIT_PATH")),
    readEvidence(required("FORMAL_ROUND_TWO_EVIDENCE_ARCHIVE_PATH"))
  ]);
  const state = readFormalQualificationRoundOneReceipt(stateEvidence.bytes, now);
  const roundOneAudit = parseFixedCohortCompletenessAuditReport(roundOneAuditEvidence.bytes);
  const roundTwoAudit = parseFixedCohortCompletenessAuditReport(roundTwoAuditEvidence.bytes);
  if (state.decision !== "ROUND_ONE_QUALIFIED" || state.imageDigest !== imageDigest ||
      state.auditSha256 !== roundOneAuditEvidence.sha256 || state.auditContentSha256 !== roundOneAudit.contentSha256 ||
      state.evidenceArchiveSha256 !== roundOneArchiveEvidence.sha256 ||
      state.databaseArchiveSha256 !== roundOneDatabaseEvidence.sha256 ||
      roundOneAudit.decision !== "AUDIT_COMPLETE" || roundTwoAudit.decision !== "AUDIT_COMPLETE" ||
      roundOneAudit.companies.some(({ blockers }) => blockers.length > 0) ||
      roundTwoAudit.companies.some(({ blockers }) => blockers.length > 0)) {
    throw new Error("Formal qualification evidence is inconsistent");
  }
  return {
    roundOneBatchId: roundOneAudit.batchId,
    roundTwoBatchId: roundTwoAudit.batchId,
    roundOneStateReceiptSha256: stateEvidence.sha256,
    roundOneAuditSha256: roundOneAuditEvidence.sha256,
    roundOneEvidenceArchiveSha256: roundOneArchiveEvidence.sha256,
    roundOneDatabaseArchiveSha256: roundOneDatabaseEvidence.sha256,
    roundTwoAuditSha256: roundTwoAuditEvidence.sha256,
    roundTwoEvidenceArchiveSha256: roundTwoArchiveEvidence.sha256
  };
}

async function readEvidence(path: string): Promise<{ bytes: Buffer; sha256: string }> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size <= 0) {
    throw new Error("Formal qualification evidence file is invalid");
  }
  const bytes = await readFile(path);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function selectQualificationPair<T extends { finishedAt: Date | null }>(batches: readonly T[], now: Date): T[] {
  for (let newer = 0; newer < batches.length; newer += 1) {
    for (let older = newer + 1; older < batches.length; older += 1) {
      const newTime = batches[newer]!.finishedAt?.getTime(), oldTime = batches[older]!.finishedAt?.getTime();
      if (newTime !== undefined && oldTime !== undefined && now.getTime() - oldTime <= 72 * 3_600_000 &&
          newTime - oldTime >= 12 * 3_600_000) return [batches[newer]!, batches[older]!];
    }
  }
  return batches.slice(0, 2);
}
function migrationHistoryMatches(rows: readonly { migrationName: string; checksum: string; finishedAt: Date | null;
  rolledBackAt: Date | null }[], expected: readonly { migrationName: string; checksum: string }[]): boolean {
  if (rows.some((row) => row.finishedAt === null && row.rolledBackAt === null)) return false;
  const successful = rows.filter((row) => row.finishedAt !== null && row.rolledBackAt === null);
  return successful.length === expected.length && expected.every((migration, index) =>
    migration.migrationName === successful[index]?.migrationName && migration.checksum === successful[index]?.checksum);
}
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
async function writeReceipt(path: string, value: unknown): Promise<void> {
  const absolute = resolve(path), temporary = `${absolute}.${process.pid}.tmp`;
  await mkdir(dirname(absolute), { recursive: true }); await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, absolute);
}
