import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY =
  "ghcr.io/ethanyoq/job-finder-rc022-cloud-acceptance" as const;

export interface ProductionDeploymentImageReceipt {
  schemaVersion: 1;
  decision: "PASSED";
  image: string;
  repository: typeof PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY;
  manifestDigest: string;
  configDigest: string;
  revision: string;
  qualificationReceiptSha256: string;
  qualificationContentSha256: string;
  publishedAt: string;
  contentSha256: string;
}

export function validateProductionDeploymentImage(value: string | undefined): string {
  if (value === undefined || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error("JOB_FINDER_IMAGE_DIGEST must be exactly 64 lowercase hexadecimal characters");
  }
  return `${PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY}@sha256:${value}`;
}

export async function readProductionDeploymentImageReceipt(
  path: string,
  expectedDigest: string | undefined
): Promise<ProductionDeploymentImageReceipt> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "decision", "image", "repository",
    "manifestDigest", "configDigest", "revision", "qualificationReceiptSha256",
    "qualificationContentSha256", "publishedAt", "contentSha256"])) {
    throw new Error("Deployment image receipt schema is invalid");
  }
  const manifestDigest = `sha256:${expectedDigest ?? ""}`;
  const { contentSha256, ...base } = value;
  if (value.schemaVersion !== 1 || value.decision !== "PASSED" ||
      value.repository !== PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY ||
      value.manifestDigest !== manifestDigest ||
      value.image !== `${PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY}@${manifestDigest}` ||
      !isDigest(value.configDigest) || !/^[0-9a-f]{40}$/u.test(String(value.revision)) ||
      !isSha(value.qualificationReceiptSha256) || !isSha(value.qualificationContentSha256) ||
      !isCanonicalInstant(value.publishedAt) || !isSha(contentSha256) ||
      sha(JSON.stringify(base)) !== contentSha256) {
    throw new Error("Deployment image receipt does not authorize JOB_FINDER_IMAGE_DIGEST");
  }
  return value as unknown as ProductionDeploymentImageReceipt;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const receiptPath = process.env.DEPLOYMENT_IMAGE_RECEIPT_PATH;
    if (!receiptPath) throw new Error("DEPLOYMENT_IMAGE_RECEIPT_PATH is required");
    const receipt = await readProductionDeploymentImageReceipt(receiptPath, process.env.JOB_FINDER_IMAGE_DIGEST);
    console.log(receipt.image);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Deployment image receipt is invalid");
    process.exitCode = 1;
  }
}

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const isSha = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const isDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCanonicalInstant = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && new Date(value).toISOString() === value;
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
