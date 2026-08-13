import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { resolveCurrentBuildingStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";
import { parseFixedCohortCompletenessAuditReport } from "../src/release/fixedCohortCompletenessAudit";
import {
  assertFormalQualificationSecondRoundMayStart,
  createFormalQualificationRoundOneReceipt,
  parseFormalQualificationRoundOneReceipt,
  type FormalQualificationRoundOneReceipt
} from "../src/release/formalQualificationState";
import { readImageQualificationReceipt } from "../src/release/launchReceiptFiles";

type Command = "capture" | "verify-files" | "verify-restored";
const PATH_OPTIONS = ["--archive", "--audit", "--current-image-qualification", "--evidence-archive", "--receipt"] as const;
const ROUND_ONE_IMAGE_OPTION = "--round-one-image-qualification" as const;
const ROUND_ONE_RUN_OPTION = "--round-one-run-id" as const;

interface CommandOptions {
  command: Command;
  archivePath: string;
  auditPath: string;
  currentImageQualificationPath: string;
  evidenceArchivePath: string;
  receiptPath: string;
  roundOneImageQualificationPath: string | null;
  roundOneRunId: string | null;
}

interface BatchSnapshot {
  releaseCandidateId: string;
  batchId: string;
  batchStatus: "SUCCESS" | "INCOMPLETE" | "FAILED";
  batchFinishedAt: Date;
}

export async function runFormalQualificationStateCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  now = new Date()
): Promise<number> {
  const options = parseOptions(args);
  const archive = await fileEvidence(options.archivePath);
  const evidenceArchive = await fileEvidence(options.evidenceArchivePath);
  const auditBytes = await readRegularFile(options.auditPath);
  const audit = parseFixedCohortCompletenessAuditReport(auditBytes);
  const auditSha256 = sha(auditBytes);
  const repository = requiredEnv(env, "GITHUB_REPOSITORY");
  const sourceRevision = requiredEnv(env, "GITHUB_SHA");
  const currentImage = await readImageQualificationReceipt(options.currentImageQualificationPath);
  if (currentImage.revision !== sourceRevision) throw new Error("Current image qualification revision mismatch");

  if (options.command === "capture") {
    const workflowRunId = requiredEnv(env, "GITHUB_RUN_ID");
    const snapshot = await loadCurrentBatchSnapshot(audit.releaseCandidateId, audit.batchId);
    const receipt = createFormalQualificationRoundOneReceipt({
      repository, workflowRunId, sourceRevision,
      imageDigest: currentImage.imageDigest,
      buildIdentityContentSha256: currentImage.buildIdentityContentSha256,
      releaseCandidateId: snapshot.releaseCandidateId, batchId: snapshot.batchId,
      batchStatus: snapshot.batchStatus, batchFinishedAt: snapshot.batchFinishedAt,
      databaseArchiveSha256: archive.sha256, databaseArchiveBytes: archive.bytes,
      auditSha256, auditContentSha256: audit.contentSha256,
      evidenceArchiveSha256: evidenceArchive.sha256, evidenceArchiveBytes: evidenceArchive.bytes,
      imageQualificationContentSha256: currentImage.contentSha256,
      auditDecision: audit.decision, companyCount: audit.companyCount,
      foreignCompanyCount: audit.foreignCompanyCount,
      blockerCount: audit.companies.filter(({ blockers }) => blockers.length > 0).length,
      capturedAt: now
    });
    await writeAtomic(options.receiptPath, receipt);
    writeResult(receipt);
    return 0;
  }

  const roundOneRunId = options.roundOneRunId!;
  const roundOneImage = await readImageQualificationReceipt(options.roundOneImageQualificationPath!);
  const receiptBytes = await readRegularFile(options.receiptPath);
  const receipt = parseFormalQualificationRoundOneReceipt(receiptBytes, {
    repository, workflowRunId: roundOneRunId, sourceRevision,
    imageDigest: roundOneImage.imageDigest,
    buildIdentityContentSha256: roundOneImage.buildIdentityContentSha256,
    databaseArchiveSha256: archive.sha256, databaseArchiveBytes: archive.bytes,
    auditSha256, auditContentSha256: audit.contentSha256,
    evidenceArchiveSha256: evidenceArchive.sha256, evidenceArchiveBytes: evidenceArchive.bytes,
    imageQualificationContentSha256: roundOneImage.contentSha256,
    now
  });
  if (roundOneImage.revision !== sourceRevision ||
      currentImage.imageDigest !== receipt.imageDigest ||
      currentImage.buildIdentityContentSha256 !== receipt.buildIdentityContentSha256 ||
      audit.releaseCandidateId !== receipt.releaseCandidateId || audit.batchId !== receipt.batchId ||
      audit.companyCount !== receipt.companyCount || audit.foreignCompanyCount !== receipt.foreignCompanyCount ||
      audit.companies.filter(({ blockers }) => blockers.length > 0).length !== receipt.blockerCount ||
      audit.decision !== receipt.auditDecision) {
    throw new Error("Formal qualification round-one evidence is inconsistent");
  }
  assertFormalQualificationSecondRoundMayStart(receipt, now);
  if (options.command === "verify-restored") await verifyRestoredDatabase(receipt);
  writeResult(receipt);
  return 0;
}

function parseOptions(args: readonly string[]): CommandOptions {
  const command = args[0];
  if (command !== "capture" && command !== "verify-files" && command !== "verify-restored") {
    throw new Error("Expected capture, verify-files, or verify-restored");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!name || !value || values.has(name) || value.startsWith("--")) throw new Error("Invalid qualification state arguments");
    values.set(name, value);
  }
  const expected = command === "capture" ? [...PATH_OPTIONS] : [...PATH_OPTIONS, ROUND_ONE_IMAGE_OPTION, ROUND_ONE_RUN_OPTION];
  if (args.length !== 1 + expected.length * 2 || values.size !== expected.length ||
      [...values.keys()].some((name) => !expected.includes(name as never))) {
    throw new Error("Invalid qualification state arguments");
  }
  return {
    command,
    archivePath: values.get("--archive")!, auditPath: values.get("--audit")!,
    currentImageQualificationPath: values.get("--current-image-qualification")!,
    evidenceArchivePath: values.get("--evidence-archive")!,
    receiptPath: values.get("--receipt")!,
    roundOneImageQualificationPath: values.get(ROUND_ONE_IMAGE_OPTION) ?? null,
    roundOneRunId: values.get(ROUND_ONE_RUN_OPTION) ?? null
  };
}

async function loadCurrentBatchSnapshot(releaseCandidateId: string, batchId: string): Promise<BatchSnapshot> {
  const prisma = new PrismaClient();
  try {
    return await prisma.$transaction(async (transaction) => {
      const authority = await resolveCurrentBuildingStagedScheduleAuthority(transaction as never);
      if (authority.identity.releaseCandidateId !== releaseCandidateId) {
        throw new Error("Fixed cohort audit release candidate does not match current authority");
      }
      const identity = authority.identity;
      const batch = await transaction.crawlBatch.findFirstOrThrow({
        where: { id: batchId, releaseCandidateId, kind: "SCHEDULED", status: { in: ["SUCCESS", "INCOMPLETE", "FAILED"] },
          finishedAt: { not: null }, commitSha: identity.commitSha, rosterSha256: identity.rosterSha256,
          sourcePlanSha256: identity.sourcePlanSha256, sourceConfigSha256: identity.sourceConfigSha256,
          adapterBundleSha256: identity.adapterBundleSha256,
          plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
          plannedSourceCount: identity.expectedPlannedSourceCount },
        select: { id: true, releaseCandidateId: true, status: true, finishedAt: true }
      });
      if (!batch.releaseCandidateId || !batch.finishedAt ||
          !["SUCCESS", "INCOMPLETE", "FAILED"].includes(batch.status)) throw new Error("Formal batch is not terminal");
      return { releaseCandidateId: batch.releaseCandidateId, batchId: batch.id,
        batchStatus: batch.status as BatchSnapshot["batchStatus"], batchFinishedAt: batch.finishedAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 });
  } finally { await prisma.$disconnect().catch(() => undefined); }
}

async function verifyRestoredDatabase(receipt: FormalQualificationRoundOneReceipt): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (transaction) => {
      const authority = await resolveCurrentBuildingStagedScheduleAuthority(transaction as never);
      if (authority.identity.releaseCandidateId !== receipt.releaseCandidateId) {
        throw new Error("Restored formal qualification authority is invalid");
      }
      const batches = await transaction.crawlBatch.findMany({
        where: { releaseCandidateId: receipt.releaseCandidateId, kind: "SCHEDULED" },
        select: { id: true, status: true, finishedAt: true }, orderBy: [{ finishedAt: "asc" }, { id: "asc" }]
      });
      if (batches.length !== 1 || batches[0]?.id !== receipt.batchId || batches[0].status !== "SUCCESS" ||
          batches[0].finishedAt?.toISOString() !== receipt.batchFinishedAt) {
        throw new Error("Restored formal qualification database does not contain the exact first round");
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 30_000 });
  } finally { await prisma.$disconnect().catch(() => undefined); }
}

async function fileEvidence(path: string): Promise<{ sha256: string; bytes: number }> {
  const absolute = resolve(path), stats = await lstat(absolute);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size <= 0) {
    throw new Error("Formal qualification evidence file is invalid");
  }
  const hash = createHash("sha256");
  await new Promise<void>((accept, reject) => {
    const stream = createReadStream(absolute);
    stream.on("data", (chunk) => hash.update(chunk)); stream.on("end", accept); stream.on("error", reject);
  });
  return { sha256: hash.digest("hex"), bytes: stats.size };
}

async function readRegularFile(path: string): Promise<Buffer> {
  await fileEvidence(path);
  return readFile(resolve(path));
}

async function writeAtomic(path: string, value: unknown): Promise<void> {
  const absolute = resolve(path), temporary = `${absolute}.${process.pid}.tmp`;
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, absolute);
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value;
}
function writeResult(receipt: FormalQualificationRoundOneReceipt): void {
  console.log(JSON.stringify({ decision: receipt.decision, releaseCandidateId: receipt.releaseCandidateId,
    batchId: receipt.batchId, batchFinishedAt: receipt.batchFinishedAt, contentSha256: receipt.contentSha256 }));
}
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

async function main(): Promise<void> {
  try { process.exitCode = await runFormalQualificationStateCommand(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED]") :
      "Formal qualification state command failed");
    process.exitCode = 1;
  }
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
