import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface ImageQualificationReceipt {
  schemaVersion: 1;
  decision: "PASSED";
  imageDigest: string;
  revision: string;
  buildIdentitySha256: string;
  securityReceiptSha256: string;
  restoreReceiptSha256: string;
  evaluatedAt: string;
  gates: readonly string[];
  contentSha256: string;
}

export async function readImageQualificationReceipt(path: string): Promise<ImageQualificationReceipt> {
  const value = await readContentHashedJson(path);
  if (value.schemaVersion !== 1 || value.decision !== "PASSED" || !/^sha256:[0-9a-f]{64}$/u.test(String(value.imageDigest)) ||
    !/^[0-9a-f]{40}$/u.test(String(value.revision)) || !validSha(value.buildIdentitySha256) ||
    !validSha(value.securityReceiptSha256) || !validSha(value.restoreReceiptSha256) || !validDate(value.evaluatedAt) || !Array.isArray(value.gates) ||
    value.gates.length === 0 || !value.gates.every((gate) => typeof gate === "string" && gate.trim())) {
    throw new Error("Image qualification receipt schema is invalid");
  }
  return value as unknown as ImageQualificationReceipt;
}

export async function readSecurityReceiptSummary(path: string): Promise<{
  decision: string; contentSha256: string; imageDigest: string; evaluatedAt: string
}> {
  const value = await readContentHashedJson(path);
  if (value.schemaVersion !== 1 || (value.decision !== "PASSED" && value.decision !== "BLOCKED") ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(value.imageDigest)) || !validDate(value.evaluatedAt)) {
    throw new Error("Production security receipt schema is invalid");
  }
  return { decision: value.decision, contentSha256: value.contentSha256 as string,
    imageDigest: value.imageDigest as string, evaluatedAt: value.evaluatedAt as string };
}

export async function readRestoreReceiptSummary(path: string): Promise<{
  decision: string; contentSha256: string; verifiedAt: string
}> {
  const value = await readContentHashedJson(path);
  if (value.schemaVersion !== 1 || (value.decision !== "PASSED" && value.decision !== "FAILED") ||
    !validDate(value.verifiedAt)) throw new Error("Restore qualification receipt schema is invalid");
  return { decision: value.decision, contentSha256: value.contentSha256 as string, verifiedAt: value.verifiedAt as string };
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
