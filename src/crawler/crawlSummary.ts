import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { toSourceScheduleState, type PersistedCrawlObservationRow } from "../db/crawlStateRepository";
import type { P0CrawlBatchResult } from "./runCrawlBatch";
import { validateRuntimeBatchIdentity, type RuntimeBatchIdentity } from "./runtimeBatchIdentity";

export const CRAWL_SUMMARY_SCHEMA_VERSION = "p0-crawl-summary-v1" as const;
export const DEFAULT_CRAWL_SUMMARY_MAX_AGE_HOURS = 14;

type SummaryState = "MISSING" | "INVALID" | "STALE" | "VALID";
type TerminalStatus = P0CrawlBatchResult["status"];

export interface CrawlSummary {
  schemaVersion: typeof CRAWL_SUMMARY_SCHEMA_VERSION;
  releaseCandidateId: string;
  batchId: string | null;
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  capturedAt: string;
  finishedAt: string;
  terminalStatus: TerminalStatus;
  counters: P0CrawlBatchResult | null;
  globalSuccessRate: number | null;
  sourceHealthStatus: "PERSISTED" | "UNAVAILABLE";
  consecutiveFailuresByCompany: Record<string, number> | null;
  failureCode: "CRAWL_EXECUTION_FAILED" | null;
}

export type CrawlSummaryReadResult =
  | { state: Exclude<SummaryState, "VALID" | "STALE"> }
  | { state: "VALID" | "STALE"; summary: CrawlSummary };

export function buildTerminalCrawlSummary(input: {
  identity: RuntimeBatchIdentity;
  batch: P0CrawlBatchResult;
  capturedAt: Date;
  finishedAt: Date;
  consecutiveFailuresByCompany: Record<string, number> | null;
}): CrawlSummary {
  validateRuntimeBatchIdentity(input.identity);
  validateTimes(input.capturedAt, input.finishedAt);
  validateBatch(input.batch, input.identity);
  const persisted = input.consecutiveFailuresByCompany !== null;
  const failures = persisted ? canonicalFailureMap(input.consecutiveFailuresByCompany!) : null;
  const summary: CrawlSummary = {
    schemaVersion: CRAWL_SUMMARY_SCHEMA_VERSION,
    ...summaryIdentity(input.identity),
    batchId: input.batch.batchId,
    capturedAt: input.capturedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    terminalStatus: input.batch.status,
    counters: { ...input.batch },
    globalSuccessRate: input.batch.successfulSourceCount / input.batch.plannedSourceCount,
    sourceHealthStatus: persisted ? "PERSISTED" : "UNAVAILABLE",
    consecutiveFailuresByCompany: failures,
    failureCode: null
  };
  assertCrawlSummary(summary);
  return summary;
}

export function buildExceptionalCrawlSummary(input: {
  identity: RuntimeBatchIdentity;
  capturedAt: Date;
  finishedAt: Date;
  consecutiveFailuresByCompany: Record<string, number> | null;
}): CrawlSummary {
  validateRuntimeBatchIdentity(input.identity);
  validateTimes(input.capturedAt, input.finishedAt);
  const persisted = input.consecutiveFailuresByCompany !== null;
  const summary: CrawlSummary = {
    schemaVersion: CRAWL_SUMMARY_SCHEMA_VERSION,
    ...summaryIdentity(input.identity),
    batchId: null,
    capturedAt: input.capturedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    terminalStatus: "FAILED",
    counters: null,
    globalSuccessRate: null,
    sourceHealthStatus: persisted ? "PERSISTED" : "UNAVAILABLE",
    consecutiveFailuresByCompany: persisted
      ? canonicalFailureMap(input.consecutiveFailuresByCompany!)
      : null,
    failureCode: "CRAWL_EXECUTION_FAILED"
  };
  assertCrawlSummary(summary);
  return summary;
}

export async function collectConsecutiveFailuresByCompany(
  sources: readonly { companyId: string; sourceId: string }[],
  getRecentObservations: (sourceId: string) => Promise<readonly PersistedCrawlObservationRow[]>
): Promise<Record<string, number>> {
  const failures = new Map<string, number>();
  for (const source of sources) {
    const observations = await getRecentObservations(source.sourceId);
    const count = toSourceScheduleState(source.sourceId, observations).consecutiveFailureCount;
    failures.set(source.companyId, Math.max(failures.get(source.companyId) ?? 0, count));
  }
  return Object.fromEntries([...failures].sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right))));
}

export async function readCrawlSummaryFile(
  path: string,
  options: { now: Date; maxAgeHours?: number }
): Promise<CrawlSummaryReadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "MISSING" } : { state: "INVALID" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    assertCrawlSummary(parsed);
  } catch {
    return { state: "INVALID" };
  }
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_CRAWL_SUMMARY_MAX_AGE_HOURS;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0 || Number.isNaN(options.now.getTime())) {
    return { state: "INVALID" };
  }
  const summary = parsed as CrawlSummary;
  if (summary.sourceHealthStatus !== "PERSISTED" || summary.terminalStatus !== "SUCCESS" || summary.counters === null) {
    return { state: "INVALID" };
  }
  const ageHours = (options.now.getTime() - new Date(summary.finishedAt).getTime()) / 3_600_000;
  if (ageHours < -5 / 60) return { state: "INVALID" };
  return ageHours > maxAgeHours ? { state: "STALE", summary } : { state: "VALID", summary };
}

interface AtomicHandle {
  writeFile(data: string, options: { encoding: "utf8" }): Promise<unknown>;
  sync(): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface CrawlSummaryAtomicOps {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>;
  open(path: string, flags: "wx", mode: number): Promise<AtomicHandle>;
  rename(from: string, to: string): Promise<unknown>;
  unlink(path: string): Promise<unknown>;
  randomId(): string;
}

interface PathOps {
  resolve(path: string): string;
  resolve(path: string, child: string): string;
  dirname(path: string): string;
  basename(path: string): string;
}

export function crawlSummaryTemporaryPath(
  targetPath: string,
  pid: number,
  randomId: string,
  pathOps: PathOps = { resolve, dirname, basename }
): string {
  const target = pathOps.resolve(targetPath);
  return pathOps.resolve(
    pathOps.dirname(target),
    `.${pathOps.basename(target)}.${pid}.${randomId}.tmp`
  );
}

const realAtomicOps: CrawlSummaryAtomicOps = {
  mkdir,
  open: (path, flags, mode) => open(path, flags, mode),
  rename,
  unlink,
  randomId: randomUUID
};

export async function writeCrawlSummaryAtomic(
  path: string,
  summary: CrawlSummary,
  ops: CrawlSummaryAtomicOps = realAtomicOps
): Promise<void> {
  assertCrawlSummary(summary);
  const directory = dirname(resolve(path));
  const target = resolve(path);
  const temporary = crawlSummaryTemporaryPath(target, process.pid, ops.randomId());
  await ops.mkdir(directory, { recursive: true, mode: 0o700 });
  let handle: AtomicHandle | undefined;
  try {
    handle = await ops.open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await ops.rename(temporary, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await ops.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function runAndPublishCrawlSummary<T extends { batch: P0CrawlBatchResult }>(input: {
  identity: RuntimeBatchIdentity;
  capturedAt: Date;
  run(): Promise<T>;
  loadConsecutiveFailuresByCompany(): Promise<Record<string, number>>;
  publish(summary: CrawlSummary): Promise<void>;
  now?: () => Date;
}): Promise<T> {
  let result: T;
  try {
    result = await input.run();
  } catch (error) {
    let persistedFailures: Record<string, number> | null = null;
    try {
      persistedFailures = await input.loadConsecutiveFailuresByCompany();
    } catch {
      persistedFailures = null;
    }
    await input.publish(buildExceptionalCrawlSummary({
      identity: input.identity,
      capturedAt: input.capturedAt,
      finishedAt: input.now?.() ?? new Date(),
      consecutiveFailuresByCompany: persistedFailures
    }));
    throw error;
  }
  let failures: Record<string, number>;
  try {
    failures = await input.loadConsecutiveFailuresByCompany();
  } catch (error) {
    await input.publish(buildTerminalCrawlSummary({
      identity: input.identity,
      batch: result.batch,
      capturedAt: input.capturedAt,
      finishedAt: input.now?.() ?? new Date(),
      consecutiveFailuresByCompany: null
    }));
    throw error;
  }
  await input.publish(buildTerminalCrawlSummary({
    identity: input.identity,
    batch: result.batch,
    capturedAt: input.capturedAt,
    finishedAt: input.now?.() ?? new Date(),
    consecutiveFailuresByCompany: failures
  }));
  return result;
}

function summaryIdentity(identity: RuntimeBatchIdentity) {
  return {
    releaseCandidateId: identity.releaseCandidateId,
    commitSha: identity.commitSha,
    rosterSha256: identity.rosterSha256,
    sourcePlanSha256: identity.sourcePlanSha256,
    sourceConfigSha256: identity.sourceConfigSha256,
    adapterBundleSha256: identity.adapterBundleSha256
  };
}

function validateBatch(batch: P0CrawlBatchResult, identity: RuntimeBatchIdentity): void {
  if (!batch.batchId.trim() || batch.plannedSourceCount !== identity.expectedPlannedSourceCount || batch.plannedSourceCount < 1) {
    throw new Error("Crawl summary batch identity mismatch");
  }
  validateCounters(batch);
}

function validateTimes(capturedAt: Date, finishedAt: Date): void {
  if (Number.isNaN(capturedAt.getTime()) || Number.isNaN(finishedAt.getTime()) || finishedAt < capturedAt) {
    throw new Error("Crawl summary timestamps are invalid");
  }
}

function canonicalFailureMap(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([companyId, count]) => {
    if (!companyId.trim() || !Number.isSafeInteger(count) || count < 0) throw new Error("Crawl summary failure map is invalid");
    return [companyId, count];
    }));
}

function assertCrawlSummary(value: unknown): asserts value is CrawlSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Crawl summary root is invalid");
  const summary = value as Partial<CrawlSummary>;
  if (summary.schemaVersion !== CRAWL_SUMMARY_SCHEMA_VERSION ||
      typeof summary.releaseCandidateId !== "string" || !summary.releaseCandidateId.trim() ||
      typeof summary.commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(summary.commitSha) ||
      ![summary.rosterSha256, summary.sourcePlanSha256, summary.sourceConfigSha256, summary.adapterBundleSha256]
        .every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest)) ||
      typeof summary.capturedAt !== "string" || typeof summary.finishedAt !== "string" ||
      !["SUCCESS", "INCOMPLETE", "FAILED"].includes(summary.terminalStatus ?? "") ||
      !["PERSISTED", "UNAVAILABLE"].includes(summary.sourceHealthStatus ?? "")) {
    throw new Error("Crawl summary required fields are invalid");
  }
  validateTimes(new Date(summary.capturedAt), new Date(summary.finishedAt));
  if (summary.sourceHealthStatus === "PERSISTED") canonicalFailureMap(summary.consecutiveFailuresByCompany as Record<string, number>);
  else if (summary.consecutiveFailuresByCompany !== null) throw new Error("Unavailable source health must be null");
  if (summary.counters === undefined) throw new Error("Crawl summary counters are required");
  if (summary.counters === null) {
    if (summary.terminalStatus !== "FAILED" || summary.batchId !== null || summary.globalSuccessRate !== null ||
        summary.failureCode !== "CRAWL_EXECUTION_FAILED") throw new Error("Exceptional crawl summary is invalid");
  } else {
    validateCounters(summary.counters);
    if (typeof summary.batchId !== "string" || !summary.batchId.trim() || summary.counters.batchId !== summary.batchId ||
        summary.counters.status !== summary.terminalStatus || typeof summary.globalSuccessRate !== "number" ||
        summary.globalSuccessRate < 0 || summary.globalSuccessRate > 1 ||
        summary.globalSuccessRate !== summary.counters.successfulSourceCount / summary.counters.plannedSourceCount ||
        summary.failureCode !== null) {
      throw new Error("Terminal crawl summary is invalid");
    }
  }
}

const COUNTER_KEYS = [
  "plannedSourceCount", "dueSourceCount", "transportSuccessfulSourceCount", "transportFailedSourceCount",
  "adapterSuccessfulSourceCount", "adapterFailedSourceCount", "completenessVerifiedSourceCount",
  "completenessIncompleteSourceCount", "atomicCommittedSourceCount", "atomicFailedSourceCount",
  "successfulSourceCount", "failedSourceCount", "blockedSourceCount", "skippedSourceCount"
] as const;

function validateCounters(counters: P0CrawlBatchResult): void {
  const expectedKeys = ["status", "batchId", ...COUNTER_KEYS].sort();
  if (JSON.stringify(Object.keys(counters).sort()) !== JSON.stringify(expectedKeys) ||
      typeof counters.batchId !== "string" || !counters.batchId.trim() ||
      !["SUCCESS", "INCOMPLETE", "FAILED"].includes(counters.status) || counters.plannedSourceCount < 1) {
    throw new Error("Crawl summary counters are incomplete");
  }
  for (const key of COUNTER_KEYS) {
    if (!Number.isSafeInteger(counters[key]) || counters[key] < 0) {
      throw new Error(`Crawl summary counter ${key} is invalid`);
    }
  }
}
