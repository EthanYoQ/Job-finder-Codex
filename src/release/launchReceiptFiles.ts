import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { listCurrentPrismaMigrations } from "../db/prismaMigrationManifest";
import { readPassedRestoreQualificationReceipt } from "../ops/restoreQualification";
import { readProductionSecurityReceipt } from "../security/productionSecurityGate";

export const REQUIRED_IMAGE_QUALIFICATION_GATES = Object.freeze(["CLEAN_BUILD", "NON_ROOT", "SIZE_BUDGET", "LIVEZ",
  "EMPTY_DB_BOOTSTRAP", "READYZ_FAIL_CLOSED", "REAL_PG16_RESTORE", "PRODUCTION_SECURITY"] as const);

export interface ImageQualificationReceipt {
  schemaVersion: 1;
  decision: "PASSED";
  imageDigest: string;
  revision: string;
  buildIdentitySha256: string;
  buildIdentityContentSha256: string;
  securityReceiptSha256: string;
  restoreReceiptSha256: string;
  evaluatedAt: string;
  gates: readonly string[];
  contentSha256: string;
}

export async function readImageQualificationReceipt(path: string): Promise<ImageQualificationReceipt> {
  const value = await readContentHashedJson(path);
  if (!exactKeys(value, ["schemaVersion", "decision", "imageDigest", "revision", "buildIdentitySha256",
    "buildIdentityContentSha256", "securityReceiptSha256", "restoreReceiptSha256", "evaluatedAt", "gates", "contentSha256"]) ||
    value.schemaVersion !== 1 || value.decision !== "PASSED" || !/^sha256:[0-9a-f]{64}$/u.test(String(value.imageDigest)) ||
    !/^[0-9a-f]{40}$/u.test(String(value.revision)) || !validSha(value.buildIdentitySha256) ||
    !validSha(value.buildIdentityContentSha256) ||
    !validSha(value.securityReceiptSha256) || !validSha(value.restoreReceiptSha256) || !validDate(value.evaluatedAt) || !Array.isArray(value.gates) ||
    JSON.stringify(value.gates) !== JSON.stringify(REQUIRED_IMAGE_QUALIFICATION_GATES)) {
    throw new Error("Image qualification receipt schema is invalid");
  }
  return value as unknown as ImageQualificationReceipt;
}

export async function readSecurityReceiptSummary(path: string): Promise<{
  decision: string; contentSha256: string; imageDigest: string; evaluatedAt: string
}> {
  const value = await readProductionSecurityReceipt(path);
  return { decision: value.decision, contentSha256: value.contentSha256,
    imageDigest: value.imageDigest, evaluatedAt: value.evaluatedAt };
}

export async function readRestoreReceiptSummary(path: string): Promise<{
  decision: string; contentSha256: string; verifiedAt: string; archiveSha256: string
}> {
  const value = await readPassedRestoreQualificationReceipt(path, listCurrentPrismaMigrations(process.cwd()));
  return { decision: value.decision, contentSha256: value.contentSha256, verifiedAt: value.verifiedAt,
    archiveSha256: value.archiveSha256 };
}

async function readContentHashedJson(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(value) || !validSha(value.contentSha256)) throw new Error("Receipt is malformed");
  const { contentSha256, ...base } = value;
  if (sha(JSON.stringify(base)) !== contentSha256) throw new Error("Receipt content hash mismatch");
  return value;
}

const validSha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const validDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
