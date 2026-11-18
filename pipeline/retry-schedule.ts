import { z } from "zod";
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
export const roundIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const retrySourceSchema = z.object({
  sourceId: z.string().regex(/^source-[a-z0-9-]{1,100}$/),
  retryAt: timestamp,
  sourceConfigHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  lastActualRequestAt: timestamp.optional(),
  actualRequestCount: z.number().int().nonnegative().safe().optional()
}).strict();
export const retrySourcesSchema = z.array(retrySourceSchema).max(36).refine(
  rows => new Set(rows.map(row => row.sourceId)).size === rows.length,
  "DUPLICATE_RETRY_SOURCE"
);
export const retryReceiptFields = {
  roundId: roundIdSchema.optional(),
  manualIntervention: z.boolean().optional(),
  retrySources: retrySourcesSchema.optional(),
  nextRetryAt: timestamp.optional()
};
export type RetrySource = z.infer<typeof retrySourceSchema>;
export type RetryOutcome = {sourceId: string; retryAt?: number; lastActualRequestAt?: number; actualRequestCount?: number;
  observedActualHttp?: boolean; locallyDeferred?: boolean};
export const sourceRetryBackoffMs = 40 * 60_000;

/** A manual collection disqualifies only its own daily slot, including later automatic waves. */
export function roundManualIntervention(slot: string | null, roundId: string | undefined, previous: unknown,
  snapshotsDirectory = "/data/job-finder/snapshots"): boolean {
  if (slot === null) return false;
  if (roundId === undefined) return true;
  if (!previous || typeof previous !== "object" || !("slot" in previous) || previous.slot !== slot) return false;
  const receipt = previous as Record<string,unknown>;
  if (receipt.manualIntervention === true) return true;
  // A genuine legacy receipt has no dispatch identity. Do not infer provenance from placeholder objects.
  return receipt.roundId === undefined && receipt.status === "SNAPSHOT_SAVED" &&
    typeof receipt.sha256 === "string" && /^[a-f0-9]{64}$/.test(receipt.sha256) &&
    typeof receipt.snapshotFile === "string" && isAbsolute(receipt.snapshotFile) &&
    resolve(receipt.snapshotFile) === resolve(snapshotsDirectory,`public-${receipt.sha256}.json`) &&
    Array.isArray(receipt.capturedSources);
}

/** Legacy receipts have no schedule. Future deadlines survive a daily slot change. */
export function readRetrySources(receipt: unknown, sourceConfigHashes: ReadonlyMap<string, string>): RetrySource[] {
  if (!receipt || typeof receipt !== "object" || !("retrySources" in receipt)) return [];
  return retrySourcesSchema.parse(receipt.retrySources).filter(row =>
    sourceConfigHashes.has(row.sourceId) &&
    (row.sourceConfigHash === undefined || row.sourceConfigHash === sourceConfigHashes.get(row.sourceId)));
}

export function mergeRetrySources(...groups: readonly RetrySource[][]): RetrySource[] {
  const merged = new Map<string,RetrySource>();
  for (const rows of groups) for (const row of rows) {
    const old = merged.get(row.sourceId);
    const lastActualRequestAt = Math.max(old?.lastActualRequestAt ?? 0,row.lastActualRequestAt ?? 0);
    merged.set(row.sourceId,{...old,...row,retryAt:Math.max(old?.retryAt??0,row.retryAt),
      ...(lastActualRequestAt ? {lastActualRequestAt} : {})});
  }
  return retrySourcesSchema.parse([...merged.values()]);
}

export function readRetryCheckpoint(file: string, sourceConfigHashes: ReadonlyMap<string,string>): RetrySource[] {
  try { return readRetrySources(JSON.parse(readFileSync(file,"utf8")),sourceConfigHashes); }
  catch(error) { if((error as NodeJS.ErrnoException).code==="ENOENT")return []; throw error; }
}

/** One write per observed source acquisition, before the surrounding wave can finish. */
export function saveRetryCheckpoint(file: string, retrySources: readonly RetrySource[]): void {
  const bytes=JSON.stringify({retrySources:retrySourcesSchema.parse(retrySources)})+"\n";
  const temporary=file+"."+randomUUID()+".tmp";
  try {
    const fd=openSync(temporary,"wx",0o600);
    try {writeFileSync(fd,bytes);fsyncSync(fd);} finally {closeSync(fd);}
    renameSync(temporary,file);
    if(process.platform!=="win32") {
      const directory=openSync(dirname(file),"r");
      try {fsyncSync(directory);} finally {closeSync(directory);}
    }
  } finally {rmSync(temporary,{force:true});}
}

export function selectDueSourceIds(sourceIds: readonly string[], completeSourceIds: ReadonlySet<string>,
  previous: readonly RetrySource[], now: number): string[] {
  const bySource = new Map(previous.map(row => [row.sourceId, row]));
  return sourceIds.filter(sourceId => !completeSourceIds.has(sourceId) && (bySource.get(sourceId)?.retryAt ?? 0) <= now)
    .sort((left, right) => (bySource.get(left)?.lastActualRequestAt ?? 0) - (bySource.get(right)?.lastActualRequestAt ?? 0));
}

export function buildRetrySchedule(input: {
  sourceConfigHashes: ReadonlyMap<string, string>;
  completeSourceIds: ReadonlySet<string>;
  previous: readonly RetrySource[];
  attemptedSourceIds: ReadonlySet<string>;
  outcomes: readonly RetryOutcome[];
  now: number;
}): {retrySources: RetrySource[]; nextRetryAt?: number} {
  const previous = new Map(input.previous.map(row => [row.sourceId, row]));
  const outcomes = new Map(input.outcomes.map(row => [row.sourceId, row]));
  const retrySources = [...input.sourceConfigHashes].filter(([id]) => !input.completeSourceIds.has(id)).map(([sourceId, sourceConfigHash]) => {
    const old = previous.get(sourceId), outcome = outcomes.get(sourceId);
    const attempted = input.attemptedSourceIds.has(sourceId);
    const locallyDeferred = outcome?.locallyDeferred && !outcome.observedActualHttp;
    const retryAt = attempted
      ? Math.max(old?.retryAt ?? 0, outcome?.retryAt ?? 0, locallyDeferred ? input.now : input.now + sourceRetryBackoffMs)
      : old?.retryAt ?? input.now;
    const lastActualRequestAt = outcome?.lastActualRequestAt ?? old?.lastActualRequestAt;
    const actualRequestCount = outcome?.actualRequestCount === undefined ? old?.actualRequestCount
      : (old?.actualRequestCount ?? 0) + outcome.actualRequestCount;
    return {sourceId, sourceConfigHash, retryAt,
      ...(lastActualRequestAt === undefined ? {} : {lastActualRequestAt}),
      ...(actualRequestCount === undefined ? {} : {actualRequestCount})};
  });
  retrySourcesSchema.parse(retrySources);
  return {retrySources, ...(retrySources.length ? {nextRetryAt: Math.min(...retrySources.map(row => row.retryAt))} : {})};
}
