import { createHash } from "node:crypto";
import { z } from "zod";

export const JOB_PROJECTION_DELTA_SCHEMA = "job-projection-delta-receipt-v1" as const;
export const JOB_PROJECTION_DELTA_RECEIPT_SCHEMA = JOB_PROJECTION_DELTA_SCHEMA;
export const JOB_PERSISTED_PROJECTION_SCHEMA = "job-persisted-projection-v1" as const;
// Complete source-owned UPDATE mapping, plus immutable ownership. These are
// actual persisted values. Human/AI/category/title overlays remain live and are
// deliberately not overwritten or invalidated by source publication.
export const JOB_PROJECTION_FIELDS = [
  "companyId", "sourceId", "dedupeKey", "sourceJobId", "officialTitle", "officialUrl",
  "listUrl", "locationRaw", "city", "cities", "officialPublishedAt",
  "missingSuccessCount", "lifecycleStatus", "visibleInFrontend", "isNew"
] as const;
export const JOB_SOURCE_UPDATE_FIELDS = JOB_PROJECTION_FIELDS.filter(
  key => !(["companyId", "sourceId", "dedupeKey"] as readonly string[]).includes(key)
);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.string().datetime().refine(value => new Date(value).toISOString() === value, "Canonical UTC milliseconds required");
const nonblank = z.string().min(1);
export const jobPersistedProjectionSchema = z.object({
  companyId: nonblank, sourceId: nonblank, dedupeKey: nonblank,
  sourceJobId: nonblank.nullable(), officialTitle: nonblank, officialUrl: nonblank,
  listUrl: nonblank.nullable(), locationRaw: nonblank, city: nonblank,
  cities: z.array(nonblank).min(1), officialPublishedAt: timestamp.nullable(),
  missingSuccessCount: z.number().int().nonnegative(),
  lifecycleStatus: z.enum(["ACTIVE", "SUSPECTED_OFFLINE", "OFFLINE"]),
  visibleInFrontend: z.boolean(), isNew: z.boolean()
}).strict();
export type JobPersistedProjection = z.infer<typeof jobPersistedProjectionSchema>;
export function canonicalProjectionJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalProjectionJson).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return `{${Object.entries(value).sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalProjectionJson(item)}`).join(",")}}`;
  }
  throw Error("JOB_PROJECTION_NON_JSON_VALUE");
}
export function hashProjectionJson(value: unknown): string {
  return createHash("sha256").update(canonicalProjectionJson(value), "utf8").digest("hex");
}
function canonicalProjectionTimestamp(value:unknown):string {
  if(value instanceof Date && Number.isFinite(value.getTime()))return value.toISOString();
  if(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value)){
    const date=new Date(value.endsWith("Z")||/[+-]\d\d:\d\d$/.test(value)?value:value+"Z");
    if(Number.isFinite(date.getTime()))return date.toISOString();
  }
  throw Error("JOB_PROJECTION_INVALID_TIMESTAMP");
}
export function persistedJobProjection(row: Record<string, unknown>): JobPersistedProjection {
  const values = Object.fromEntries(JOB_PROJECTION_FIELDS.map(key => [key,
    key === "officialPublishedAt" && row[key] !== null ? canonicalProjectionTimestamp(row[key]) : row[key]
  ]));
  return jobPersistedProjectionSchema.parse(values);
}
export function hashJobPersistedProjection(row: Record<string, unknown>): string {
  return hashProjectionJson({schemaVersion: JOB_PERSISTED_PROJECTION_SCHEMA, projection: persistedJobProjection(row)});
}
export const jobProjectionBindingSchema = z.object({
  releaseCandidateId: nonblank, batchId: nonblank, sourceId: nonblank, sourceResultId: nonblank
}).strict();
export const jobProjectionMemberSchema = jobProjectionBindingSchema.extend({
  setKind: z.enum(["CURRENT", "GRACE", "VISIBLE"]), jobKey: nonblank,
  jobKeySha256: sha, lifecycleStatus: z.literal("ACTIVE"), missingCount: z.union([z.literal(0), z.literal(1)]),
  jobProjectionSha256: sha, lastConfirmedObservedAt: timestamp,
  lifecycleLastSeenAt: timestamp, lastPresentResultId: nonblank
}).strict();
export type JobProjectionMember = z.infer<typeof jobProjectionMemberSchema>;
export const jobProjectionDeltaReceiptSchema = z.object({
  schemaVersion: z.literal(JOB_PROJECTION_DELTA_SCHEMA),
  projectionSchemaVersion: z.literal(JOB_PERSISTED_PROJECTION_SCHEMA),
  binding: jobProjectionBindingSchema,
  verifiedAt: timestamp, observedAt: timestamp,
  legacyCertificate: z.record(z.unknown()), legacyCertificateSha256: sha,
  detailEvidenceState: z.literal("UNKNOWN"),
  members: z.array(jobProjectionMemberSchema), manifestSha256: sha
}).strict();
export type JobProjectionDeltaReceipt = z.infer<typeof jobProjectionDeltaReceiptSchema>;
export function isJobProjectionDeltaReceipt(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as {schemaVersion?: unknown}).schemaVersion === JOB_PROJECTION_DELTA_SCHEMA);
}
export function sortJobProjectionMembers(members: readonly JobProjectionMember[]): JobProjectionMember[] {
  return [...members].sort((a,b) => Buffer.from(canonicalProjectionJson(a)).compare(Buffer.from(canonicalProjectionJson(b))));
}
export function parseJobProjectionDeltaReceipt(value: unknown, expectedSha256?: string): JobProjectionDeltaReceipt {
  const receipt = jobProjectionDeltaReceiptSchema.parse(value);
  if (expectedSha256 !== undefined && hashProjectionJson(receipt) !== expectedSha256) throw Error("JOB_DELTA_RECEIPT_HASH_MISMATCH");
  if (Date.parse(receipt.observedAt) > Date.parse(receipt.verifiedAt)) throw Error("JOB_DELTA_TIME_ORDER");
  if (receipt.legacyCertificate.schemaVersion === JOB_PROJECTION_DELTA_SCHEMA) throw Error("JOB_DELTA_NESTED_RECEIPT");
  const sorted = sortJobProjectionMembers(receipt.members);
  const canonicalMembers = canonicalProjectionJson(sorted);
  if (canonicalMembers !== canonicalProjectionJson(receipt.members) || createHash("sha256").update(canonicalMembers, "utf8").digest("hex") !== receipt.manifestSha256) throw Error("JOB_DELTA_MANIFEST_HASH_MISMATCH");
  const unique = new Set<string>();
  for (const m of receipt.members) {
    for (const key of ["releaseCandidateId", "batchId", "sourceId", "sourceResultId"] as const) {
      if (m[key] !== receipt.binding[key]) throw Error("JOB_DELTA_MEMBER_TUPLE_MISMATCH");
    }
    const key = JSON.stringify([m.jobKey, m.setKind]);
    if (unique.has(key)) throw Error("JOB_DELTA_DUPLICATE_MEMBER"); unique.add(key);
    if (createHash("sha256").update(m.jobKey).digest("hex") !== m.jobKeySha256) throw Error("JOB_DELTA_MEMBER_KEY_HASH");
    if (Date.parse(m.lastConfirmedObservedAt) > Date.parse(m.lifecycleLastSeenAt) || Date.parse(m.lifecycleLastSeenAt) > Date.parse(receipt.verifiedAt)) throw Error("JOB_DELTA_MEMBER_TIME_ORDER");
    if (m.missingCount === 0 && (m.setKind === "GRACE" || m.lastPresentResultId !== receipt.binding.sourceResultId || m.lastConfirmedObservedAt !== receipt.observedAt || m.lifecycleLastSeenAt !== receipt.verifiedAt)) throw Error("JOB_DELTA_CURRENT_OBSERVATION_MISMATCH");
    if (m.missingCount === 1 && (m.setKind === "CURRENT" || m.lastPresentResultId === receipt.binding.sourceResultId || Date.parse(m.lifecycleLastSeenAt) >= Date.parse(receipt.verifiedAt))) throw Error("JOB_DELTA_GRACE_OBSERVATION_MISMATCH");
  }
  for (const m of receipt.members.filter(m => m.setKind !== "VISIBLE")) {
    const visible = receipt.members.find(other => other.jobKey === m.jobKey && other.setKind === "VISIBLE");
    if (!visible || canonicalProjectionJson({...visible, setKind:m.setKind}) !== canonicalProjectionJson(m)) throw Error("JOB_DELTA_MEMBER_PAIR_MISMATCH");
  }
  if (receipt.members.filter(m=>m.setKind === "VISIBLE").length * 2 !== receipt.members.length) throw Error("JOB_DELTA_MEMBER_PAIR_MISMATCH");
  return receipt;
}
export function hashDeltaManifest(members: readonly JobProjectionMember[]): string {
  return hashProjectionJson(sortJobProjectionMembers(members));
}
export function verifyJobProjectionDeltaReceipt(value: unknown, sha256: string,
  expectedBinding: z.infer<typeof jobProjectionBindingSchema>): JobProjectionDeltaReceipt {
  const receipt = parseJobProjectionDeltaReceipt(value, sha256);
  if (canonicalProjectionJson(receipt.binding) !== canonicalProjectionJson(jobProjectionBindingSchema.parse(expectedBinding))) throw Error("JOB_DELTA_RECEIPT_TUPLE_MISMATCH");
  return receipt;
}
