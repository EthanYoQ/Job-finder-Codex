import { createHash } from "node:crypto";
import { FORMAL_QUALIFICATION_MAXIMUM_WINDOW_MS, FORMAL_QUALIFICATION_MINIMUM_SEPARATION_MS } from "./formalQualificationTiming";

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const RECEIPT_KEYS = [
  "auditContentSha256", "auditDecision", "auditSha256", "batchFinishedAt", "batchId", "batchStatus",
  "blockerCount", "buildIdentityContentSha256", "capturedAt", "companyCount", "contentSha256",
  "databaseArchiveBytes", "databaseArchiveSha256", "decision", "foreignCompanyCount",
  "evidenceArchiveBytes", "evidenceArchiveSha256",
  "imageDigest", "imageQualificationContentSha256", "releaseCandidateId", "repository", "schemaVersion", "sourceRevision",
  "workflowRunId"
] as const;
const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1_000;

export interface FormalQualificationRoundOneReceipt {
  schemaVersion: 1;
  decision: "ROUND_ONE_QUALIFIED" | "ROUND_ONE_DIAGNOSTIC";
  repository: string;
  workflowRunId: string;
  sourceRevision: string;
  imageDigest: string;
  buildIdentityContentSha256: string;
  releaseCandidateId: string;
  batchId: string;
  batchStatus: "SUCCESS" | "INCOMPLETE" | "FAILED";
  batchFinishedAt: string;
  databaseArchiveSha256: string;
  databaseArchiveBytes: number;
  auditSha256: string;
  auditContentSha256: string;
  evidenceArchiveSha256: string;
  evidenceArchiveBytes: number;
  imageQualificationContentSha256: string;
  auditDecision: "AUDIT_COMPLETE" | "AUDIT_INVALID";
  companyCount: number;
  foreignCompanyCount: number;
  blockerCount: number;
  capturedAt: string;
  contentSha256: string;
}

export interface FormalQualificationRoundOneInput {
  repository: string;
  workflowRunId: string;
  sourceRevision: string;
  imageDigest: string;
  buildIdentityContentSha256: string;
  releaseCandidateId: string;
  batchId: string;
  batchStatus: FormalQualificationRoundOneReceipt["batchStatus"];
  batchFinishedAt: Date;
  databaseArchiveSha256: string;
  databaseArchiveBytes: number;
  auditSha256: string;
  auditContentSha256: string;
  evidenceArchiveSha256: string;
  evidenceArchiveBytes: number;
  imageQualificationContentSha256: string;
  auditDecision: FormalQualificationRoundOneReceipt["auditDecision"];
  companyCount: number;
  foreignCompanyCount: number;
  blockerCount: number;
  capturedAt: Date;
}

export interface FormalQualificationRoundOneExpectedEvidence {
  repository: string;
  workflowRunId: string;
  sourceRevision: string;
  imageDigest: string;
  buildIdentityContentSha256: string;
  databaseArchiveSha256: string;
  databaseArchiveBytes: number;
  auditSha256: string;
  auditContentSha256: string;
  evidenceArchiveSha256: string;
  evidenceArchiveBytes: number;
  imageQualificationContentSha256: string;
  now: Date;
}

export function createFormalQualificationRoundOneReceipt(
  input: FormalQualificationRoundOneInput
): FormalQualificationRoundOneReceipt {
  validateInput(input);
  const qualified = isRoundOneQualified(input);
  const base = {
    schemaVersion: 1 as const,
    decision: qualified ? "ROUND_ONE_QUALIFIED" as const : "ROUND_ONE_DIAGNOSTIC" as const,
    repository: input.repository,
    workflowRunId: input.workflowRunId,
    sourceRevision: input.sourceRevision,
    imageDigest: input.imageDigest,
    buildIdentityContentSha256: input.buildIdentityContentSha256,
    releaseCandidateId: input.releaseCandidateId,
    batchId: input.batchId,
    batchStatus: input.batchStatus,
    batchFinishedAt: input.batchFinishedAt.toISOString(),
    databaseArchiveSha256: input.databaseArchiveSha256,
    databaseArchiveBytes: input.databaseArchiveBytes,
    auditSha256: input.auditSha256,
    auditContentSha256: input.auditContentSha256,
    evidenceArchiveSha256: input.evidenceArchiveSha256,
    evidenceArchiveBytes: input.evidenceArchiveBytes,
    imageQualificationContentSha256: input.imageQualificationContentSha256,
    auditDecision: input.auditDecision,
    companyCount: input.companyCount,
    foreignCompanyCount: input.foreignCompanyCount,
    blockerCount: input.blockerCount,
    capturedAt: input.capturedAt.toISOString()
  };
  return Object.freeze({ ...base, contentSha256: sha(JSON.stringify(base)) });
}

export function parseFormalQualificationRoundOneReceipt(
  bytes: Buffer,
  expected: FormalQualificationRoundOneExpectedEvidence
): FormalQualificationRoundOneReceipt {
  if (!Number.isFinite(expected.now.getTime())) throw new Error("Formal qualification evaluation time is invalid");
  const receipt = readFormalQualificationRoundOneReceipt(bytes, expected.now);
  if (receipt.repository !== expected.repository || receipt.workflowRunId !== expected.workflowRunId ||
      receipt.sourceRevision !== expected.sourceRevision ||
      receipt.imageDigest !== expected.imageDigest ||
      receipt.buildIdentityContentSha256 !== expected.buildIdentityContentSha256 ||
      receipt.databaseArchiveSha256 !== expected.databaseArchiveSha256 ||
      receipt.databaseArchiveBytes !== expected.databaseArchiveBytes || receipt.auditSha256 !== expected.auditSha256 ||
      receipt.auditContentSha256 !== expected.auditContentSha256 ||
      receipt.evidenceArchiveSha256 !== expected.evidenceArchiveSha256 ||
      receipt.evidenceArchiveBytes !== expected.evidenceArchiveBytes ||
      receipt.imageQualificationContentSha256 !== expected.imageQualificationContentSha256) {
    throw new Error("Formal qualification receipt evidence identity is invalid");
  }
  return receipt;
}

export function readFormalQualificationRoundOneReceipt(
  bytes: Buffer,
  now = new Date()
): FormalQualificationRoundOneReceipt {
  if (!Number.isFinite(now.getTime())) throw new Error("Formal qualification evaluation time is invalid");
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Formal qualification receipt schema is invalid");
  }
  if (!isRecord(value) || !exactKeys(value, RECEIPT_KEYS) || value.schemaVersion !== 1 ||
      !isSha(value.contentSha256)) {
    throw new Error("Formal qualification receipt schema is invalid");
  }
  const { contentSha256, ...base } = value;
  if (sha(JSON.stringify(base)) !== contentSha256) throw new Error("Formal qualification receipt hash mismatch");
  const receipt = value as unknown as FormalQualificationRoundOneReceipt;
  validateReceipt(receipt);
  const capturedAt = Date.parse(receipt.capturedAt);
  if (capturedAt > now.getTime() + MAX_FUTURE_DRIFT_MS) {
    throw new Error("Formal qualification receipt time is invalid");
  }
  return receipt;
}

export function assertFormalQualificationSecondRoundMayStart(
  receipt: FormalQualificationRoundOneReceipt,
  now: Date
): FormalQualificationRoundOneReceipt {
  if (!Number.isFinite(now.getTime())) throw new Error("Formal qualification evaluation time is invalid");
  if (receipt.decision !== "ROUND_ONE_QUALIFIED") {
    throw new Error("The first formal qualification round is not qualified");
  }
  const elapsed = now.getTime() - Date.parse(receipt.batchFinishedAt);
  if (elapsed < FORMAL_QUALIFICATION_MINIMUM_SEPARATION_MS || elapsed > FORMAL_QUALIFICATION_MAXIMUM_WINDOW_MS) {
    throw new Error("The second formal qualification round must start within the 6 through 72 hour window");
  }
  return receipt;
}

function validateInput(input: FormalQualificationRoundOneInput): void {
  if (!Number.isFinite(input.batchFinishedAt.getTime()) || !Number.isFinite(input.capturedAt.getTime())) {
    throw new Error("Formal qualification receipt time is invalid");
  }
  validateReceipt({
    ...input,
    schemaVersion: 1,
    decision: isRoundOneQualified(input) ? "ROUND_ONE_QUALIFIED" : "ROUND_ONE_DIAGNOSTIC",
    batchFinishedAt: input.batchFinishedAt.toISOString(),
    capturedAt: input.capturedAt.toISOString(),
    contentSha256: "0".repeat(64)
  });
}

function validateReceipt(receipt: FormalQualificationRoundOneReceipt): void {
  const batchFinishedAt = Date.parse(receipt.batchFinishedAt), capturedAt = Date.parse(receipt.capturedAt);
  const shouldQualify = isRoundOneQualified(receipt);
  if (!REPOSITORY.test(receipt.repository) || !/^[1-9][0-9]*$/u.test(receipt.workflowRunId) ||
      !COMMIT_SHA.test(receipt.sourceRevision) || !isSha(receipt.buildIdentityContentSha256) ||
      !/^sha256:[0-9a-f]{64}$/u.test(receipt.imageDigest) ||
      !SAFE_ID.test(receipt.releaseCandidateId) || !SAFE_ID.test(receipt.batchId) ||
      !["SUCCESS", "INCOMPLETE", "FAILED"].includes(receipt.batchStatus) ||
      !isCanonicalInstant(receipt.batchFinishedAt) || !isSha(receipt.databaseArchiveSha256) ||
      !Number.isSafeInteger(receipt.databaseArchiveBytes) || receipt.databaseArchiveBytes <= 0 ||
      !isSha(receipt.auditSha256) || !isSha(receipt.auditContentSha256) ||
      !isSha(receipt.evidenceArchiveSha256) || !Number.isSafeInteger(receipt.evidenceArchiveBytes) ||
      receipt.evidenceArchiveBytes <= 0 ||
      !isSha(receipt.imageQualificationContentSha256) ||
      !["AUDIT_COMPLETE", "AUDIT_INVALID"].includes(receipt.auditDecision) ||
      !Number.isSafeInteger(receipt.companyCount) || receipt.companyCount < 0 ||
      !Number.isSafeInteger(receipt.foreignCompanyCount) || receipt.foreignCompanyCount < 0 ||
      receipt.foreignCompanyCount > receipt.companyCount || !Number.isSafeInteger(receipt.blockerCount) ||
      receipt.blockerCount < 0 || receipt.blockerCount > receipt.companyCount || !isCanonicalInstant(receipt.capturedAt) ||
      capturedAt < batchFinishedAt || !isSha(receipt.contentSha256) ||
      (shouldQualify ? receipt.decision !== "ROUND_ONE_QUALIFIED" : receipt.decision !== "ROUND_ONE_DIAGNOSTIC")) {
    throw new Error("Formal qualification receipt schema is invalid");
  }
}

function isRoundOneQualified(value: Pick<FormalQualificationRoundOneReceipt,
  "batchStatus" | "auditDecision" | "companyCount" | "foreignCompanyCount" | "blockerCount">): boolean {
  return value.batchStatus === "SUCCESS" && value.auditDecision === "AUDIT_COMPLETE" &&
    value.companyCount === 41 && value.foreignCompanyCount === 30 && value.blockerCount === 0;
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
