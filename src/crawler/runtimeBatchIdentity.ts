import { createHash } from "node:crypto";

export const CRAWL_BATCH_KINDS = [
  "FULL_RELEASE",
  "SCHEDULED",
  "MANUAL_SOURCE",
  "BASELINE"
] as const;

export type CrawlBatchKind = (typeof CRAWL_BATCH_KINDS)[number];

export interface RuntimeBatchIdentity {
  releaseCandidateId: string;
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  batchKind: CrawlBatchKind;
  ownerId: string;
  expectedPlannedSourceIds: string[];
  expectedPlannedSourceSetSha256: string;
  expectedPlannedSourceCount: number;
}

const STRING_IDENTITY_FIELDS = [
  "releaseCandidateId",
  "commitSha",
  "rosterSha256",
  "sourcePlanSha256",
  "sourceConfigSha256",
  "adapterBundleSha256",
  "ownerId"
] as const;

export function validateRuntimeBatchIdentity(
  identity: RuntimeBatchIdentity | undefined
): asserts identity is RuntimeBatchIdentity {
  validateRuntimeBatchMetadata(identity);
  if (!Array.isArray(identity.expectedPlannedSourceIds)) {
    throw new Error("Runtime identity expected planned source ids are required");
  }

  const canonicalIds = canonicalizePlannedSourceIds(identity.expectedPlannedSourceIds);
  if (JSON.stringify(canonicalIds) !== JSON.stringify(identity.expectedPlannedSourceIds)) {
    throw new Error("Runtime identity expected planned source ids must be canonical");
  }
  if (identity.expectedPlannedSourceCount !== canonicalIds.length) {
    throw new Error("Runtime identity expected planned source count mismatch");
  }
  if (identity.expectedPlannedSourceSetSha256 !== hashCanonicalStringSet(canonicalIds)) {
    throw new Error("Runtime identity expected planned source hash mismatch");
  }
}

export function validateRuntimeBatchMetadata(
  identity: RuntimeBatchIdentity | undefined
): asserts identity is RuntimeBatchIdentity {
  if (!identity || typeof identity !== "object") {
    throw new Error("A runtime identity is required");
  }
  for (const field of STRING_IDENTITY_FIELDS) {
    if (typeof identity[field] !== "string" || identity[field].trim().length === 0) {
      throw new Error(`Runtime identity field ${field} must be nonblank`);
    }
  }
  if (!CRAWL_BATCH_KINDS.includes(identity.batchKind)) {
    throw new Error(`Runtime identity field batchKind is invalid: ${String(identity.batchKind)}`);
  }
}

export function validatePlannedSourceContract(
  identity: RuntimeBatchIdentity,
  actualSourceIds: readonly string[]
): string[] {
  validateRuntimeBatchIdentity(identity);
  const actualCanonicalIds = canonicalizePlannedSourceIds(actualSourceIds);
  const actualHash = hashCanonicalStringSet(actualCanonicalIds);
  if (
    actualCanonicalIds.length !== identity.expectedPlannedSourceCount ||
    actualHash !== identity.expectedPlannedSourceSetSha256 ||
    JSON.stringify(actualCanonicalIds) !== JSON.stringify(identity.expectedPlannedSourceIds)
  ) {
    throw new Error("Runtime planned source set does not match authoritative identity");
  }
  return actualCanonicalIds;
}

export function canonicalizePlannedSourceIds(sourceIds: readonly string[]): string[] {
  const seen = new Set<string>();

  for (const sourceId of sourceIds) {
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      throw new Error("Planned source ids must be nonblank");
    }
    if (seen.has(sourceId)) {
      throw new Error(`Duplicate planned source id: ${sourceId}`);
    }
    seen.add(sourceId);
  }

  return [...seen].sort(compareUtf8);
}

export function hashCanonicalStringSet(values: readonly string[]): string {
  return sha256(JSON.stringify([...new Set(values)].sort(compareUtf8)));
}

export function hashCanonicalJobKeySet(
  entries: readonly { sourceId: string; jobKey: string }[]
): string {
  const canonicalKeys = [
    ...new Set(entries.map(({ sourceId, jobKey }) => JSON.stringify([sourceId, jobKey])))
  ].sort(compareUtf8);
  return sha256(`[${canonicalKeys.join(",")}]`);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
