import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readPublicSnapshot, savePublicSnapshot } from "./public-snapshot-file.mjs";
import type { PortablePublicSnapshot } from "../db/portablePublicSnapshotRepository";
import { SOURCE_QUALITY_POLICY_ID } from "../crawler/sourceQualityAdmission";
import { PORTABLE_COVERAGE_POLICY_ID } from "../release/portableCoveragePolicy";
import { JOB_CATEGORIES } from "../domain/search";
import { candidateCompanies } from "../data/companyRegistry";

const time = z.string().refine(value => Number.isFinite(Date.parse(value)));
const count = z.number().int().nonnegative();
const health = z.enum(["HEALTHY", "DEGRADED", "UNVERIFIED", "NOT_APPLICABLE"]);
const job = z.object({
  id: z.string(), title: z.string(), officialTitle: z.string(), officialPublishedAt: time.nullable(),
  city: z.string(), cities: z.array(z.string()), locationRaw: z.string(), category: z.enum(JOB_CATEGORIES),
  isNew: z.boolean(), officialUrl: z.string().url().refine(value => /^https?:\/\//.test(value)),
  companyId: z.string(), sourceId: z.string(), sourceResultId: z.string(), lastSeenAt: time,
  lastConfirmedObservedAt: time.optional(), inGrace: z.boolean(), cityPending: z.boolean().optional()
}).strict();
const snapshotSchema = z.object({
  schemaVersion: z.literal("portable-public-snapshot-v1"), policyId: z.literal(SOURCE_QUALITY_POLICY_ID),
  coveragePolicyId: z.literal(PORTABLE_COVERAGE_POLICY_ID), generatedAt: time, lastUpdatedAt: time.nullable(), totalJobs: count,
  companies: z.array(z.object({
    id: z.string(), companyName: z.string(), pinyin: z.string(), category: z.enum(["FOREIGN_PHARMA", "DOMESTIC_PHARMA"]),
    sourceIds: z.array(z.string()), publishingSourceIds: z.array(z.string()), required: z.boolean(),
    exclusionReason: z.literal("USER_AUTHORIZED_EXCLUSION").nullable(), health,
    coverage: z.enum(["COMPLETE", "PARTIAL", "UNVERIFIED", "EXCLUDED"]), jobs: z.array(job)
  }).strict()),
  sources: z.array(z.object({
    companyId: z.string(), sourceId: z.string(), currentConfigSha256: z.string(), policyId: z.string().nullable(),
    state: z.enum(["PUBLISHING", "HOLD", "EXCLUDED"]), health, freshness: z.enum(["FRESH", "STALE", "UNKNOWN"]),
    reasons: z.array(z.string()), visibilityFloor: time.nullable(), selectedSourceResultId: z.string().nullable(),
    lastAttemptAt: time.nullable(), lastAcceptedAt: time.nullable(), lastSuccessAt: time.nullable(),
    lastAcceptedJobCount: count.nullable(), visibleJobCount: count.nullable(), staleJobCount: count, jobs: z.array(job),
    sourceScopeSummary: z.object({portalJobCount: count, verifiedChinaJobCount: count, unknownCountryJobCount: count}).optional()
  }).strict()),
  coverage: z.object({companyCount: count, requiredCompanyCount: count, excludedCompanyCount: count,
    requiredSourceCount: count, excludedSourceCount: count, expectedSourceCount: count, sourceCount: count,
    unplannedSourceCount: count, publishingSourceCount: count, unsupportedSourceCount: count, heldSourceCount: count})
}).strict();

/** Validate the exported projection for consumption; this does not issue publication receipts. */
export function validateSavedSnapshot(value: unknown): PortablePublicSnapshot {
  snapshotSchema.parse(value);
  const snapshot = value as PortablePublicSnapshot;
  if (snapshot.companies.some(company => !candidateCompanies.some(known => known.id === company.id))) {
    throw new Error("PUBLIC_SNAPSHOT_UNKNOWN_COMPANY");
  }
  return snapshot;
}

export async function createSavedSnapshotReader(file: string) {
  const signature = async () => {
    const info = await stat(file);
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  };
  let seen = await signature();
  let current = validateSavedSnapshot(await readPublicSnapshot(file));
  let pending: Promise<PortablePublicSnapshot> | undefined;
  const read = () => pending ??= (async () => {
    try {
      const next = await signature();
      if (next === seen) return current;
      try { current = validateSavedSnapshot(await readPublicSnapshot(file)); }
      catch (error) {
        // Do not repeatedly parse an unchanged invalid file. Retry transient I/O on the next request.
        if (error instanceof SyntaxError || error instanceof z.ZodError ||
          (error instanceof Error && error.message.startsWith("PUBLIC_SNAPSHOT_"))) seen = next;
        throw error;
      }
      seen = next;
    }
    catch { console.error("SAVED_PUBLIC_SNAPSHOT_RELOAD_FAILED_KEEPING_PREVIOUS"); }
    return current;
  })().finally(() => { pending = undefined; });
  return read;
}

/** The hash must arrive through the trusted transfer channel with the verified export. */
export async function installSavedSnapshot(candidate: string, destination: string, expectedSha256: string) {
  const bytes = await readFile(candidate);
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    throw new Error("PUBLIC_SNAPSHOT_TRANSFER_HASH_MISMATCH");
  }
  const snapshot = validateSavedSnapshot(JSON.parse(bytes.toString("utf8")));
  await savePublicSnapshot(destination, snapshot);
  return {status: "SAVED_PUBLIC_SNAPSHOT_INSTALLED", generatedAt: snapshot.generatedAt, lastUpdatedAt: snapshot.lastUpdatedAt};
}
