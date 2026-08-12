import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { toSourceScheduleState, type PersistedCrawlObservationRow } from "../db/crawlStateRepository";
import type { P0CrawlBatchResult } from "./runCrawlBatch";
import { validateRuntimeBatchIdentity, type CrawlBatchKind, type RuntimeBatchIdentity } from "./runtimeBatchIdentity";

export const CRAWL_SUMMARY_SCHEMA_VERSION = "p0-crawl-summary-v2" as const;
export const DEFAULT_CRAWL_SUMMARY_MAX_AGE_HOURS = 30;

type SummaryState = "MISSING" | "INVALID" | "STALE" | "VALID";
type TerminalStatus = P0CrawlBatchResult["status"];

export interface CrawlSummary {
  schemaVersion: typeof CRAWL_SUMMARY_SCHEMA_VERSION;
  releaseCandidateId: string;
  batchKind: CrawlBatchKind;
  batchId: string | null;
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  plannedSourceSetSha256: string;
  plannedSourceCount: number;
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
  | { state: "VALID" | "STALE"; summary: CrawlSummary; summarySha256: string };

export interface CrawlEvidenceIdentity {
  releaseCandidateId: string;
  batchKind: CrawlBatchKind;
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  plannedSourceSetSha256: string;
  plannedSourceCount: number;
}

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

export interface PersistedTerminalSourceResultRow {
  id: string;
  sourceId: string;
  finishedAt: Date;
  transportState: "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "SKIPPED";
  adapterState: "PENDING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "SKIPPED";
  completenessState: "PENDING" | "VERIFIED" | "NEEDS_MANUAL_COMPLETENESS_REVIEW" | "INCOMPLETE" | "FAILED";
  atomicCommitState: "PENDING" | "COMMITTED" | "ROLLED_BACK" | "NOT_ATTEMPTED" | "FAILED";
  failureCode: string | null;
}

export function collectConsecutiveSourceResultFailuresByCompany(
  sources: readonly { companyId: string; sourceId: string }[],
  rows: readonly PersistedTerminalSourceResultRow[]
): Record<string, number> {
  const rowsBySource = new Map<string, PersistedTerminalSourceResultRow[]>();
  for (const row of rows) {
    if (!sources.some((source) => source.sourceId === row.sourceId)) continue;
    const existing = rowsBySource.get(row.sourceId) ?? [];
    existing.push(row);
    rowsBySource.set(row.sourceId, existing);
  }

  const failures = new Map<string, number>();
  for (const source of sources) {
    const sourceRows = [...(rowsBySource.get(source.sourceId) ?? [])].sort((left, right) =>
      right.finishedAt.getTime() - left.finishedAt.getTime() || compareUtf8(right.id, left.id));
    let count = 0;
    for (const row of sourceRows) {
      if (row.failureCode === "SOURCE_NOT_DUE") continue;
      if (isSuccessfulTerminalSourceResult(row)) break;
      count += 1;
    }
    failures.set(source.companyId, Math.max(failures.get(source.companyId) ?? 0, count));
  }
  return Object.fromEntries([...failures].sort(([left], [right]) => compareUtf8(left, right)));
}

function isSuccessfulTerminalSourceResult(row: PersistedTerminalSourceResultRow): boolean {
  return row.transportState === "SUCCEEDED" && row.adapterState === "SUCCEEDED" &&
    row.completenessState === "VERIFIED" && row.atomicCommitState === "COMMITTED";
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

export async function readCrawlSummaryFile(
  path: string,
  options: {
    now: Date;
    maxAgeHours?: number;
    expectedIdentity: CrawlEvidenceIdentity;
    allowIncompleteScheduled?: boolean;
    expectedPausedScheduledFailure?: {
      batchId: string;
      summarySha256: string;
    };
  }
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
  if (!identitiesEqual(summary, options.expectedIdentity)) return { state: "INVALID" };
  const summarySha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  const safeScheduledIncomplete = options.allowIncompleteScheduled === true &&
    summary.batchKind === "SCHEDULED" && summary.terminalStatus === "INCOMPLETE" &&
    summary.counters !== null && summary.counters.atomicFailedSourceCount === 0;
  const safePausedScheduledFailure = options.expectedPausedScheduledFailure !== undefined &&
    summary.batchKind === "SCHEDULED" && summary.terminalStatus === "FAILED" &&
    summary.counters !== null && summary.batchId === options.expectedPausedScheduledFailure.batchId &&
    summarySha256 === options.expectedPausedScheduledFailure.summarySha256;
  if (summary.sourceHealthStatus !== "PERSISTED" ||
      (summary.terminalStatus !== "SUCCESS" && !safeScheduledIncomplete && !safePausedScheduledFailure) ||
      summary.counters === null) {
    return { state: "INVALID" };
  }
  const ageHours = (options.now.getTime() - new Date(summary.finishedAt).getTime()) / 3_600_000;
  if (ageHours < -5 / 60) return { state: "INVALID" };
  return ageHours >= maxAgeHours ? { state: "STALE", summary, summarySha256 } : { state: "VALID", summary, summarySha256 };
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
  openDirectory?(path: string): Promise<Pick<AtomicHandle, "sync" | "close">>;
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
  openDirectory: (path) => open(path, "r"),
  randomId: randomUUID
};

export async function writeCrawlSummaryAtomic(
  path: string,
  summary: CrawlSummary,
  ops: CrawlSummaryAtomicOps = realAtomicOps
): Promise<{ sha256: string }> {
  assertCrawlSummary(summary);
  const directory = dirname(resolve(path));
  const target = resolve(path);
  const temporary = crawlSummaryTemporaryPath(target, process.pid, ops.randomId());
  await ops.mkdir(directory, { recursive: true, mode: 0o700 });
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  let handle: AtomicHandle | undefined;
  try {
    handle = await ops.open(temporary, "wx", 0o600);
    await handle.writeFile(serialized, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await ops.rename(temporary, target);
    if (ops.openDirectory) {
      const directoryHandle = await ops.openDirectory(directory);
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
    return { sha256: createHash("sha256").update(serialized, "utf8").digest("hex") };
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
  onStage?: (stage: "EXECUTION" | "SOURCE_HEALTH" | "PUBLISH") => void;
}): Promise<T> {
  let result: T;
  try {
    input.onStage?.("EXECUTION");
    result = await input.run();
  } catch (error) {
    throw error;
  }
  let failures: Record<string, number>;
  try {
    input.onStage?.("SOURCE_HEALTH");
    failures = await input.loadConsecutiveFailuresByCompany();
  } catch (error) {
    input.onStage?.("PUBLISH");
    await input.publish(buildTerminalCrawlSummary({
      identity: input.identity,
      batch: result.batch,
      capturedAt: input.capturedAt,
      finishedAt: input.now?.() ?? new Date(),
      consecutiveFailuresByCompany: null
    }));
    input.onStage?.("SOURCE_HEALTH");
    throw error;
  }
  input.onStage?.("PUBLISH");
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
    batchKind: identity.batchKind,
    commitSha: identity.commitSha,
    rosterSha256: identity.rosterSha256,
    sourcePlanSha256: identity.sourcePlanSha256,
    sourceConfigSha256: identity.sourceConfigSha256,
    adapterBundleSha256: identity.adapterBundleSha256,
    plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
    plannedSourceCount: identity.expectedPlannedSourceCount
  };
}

export function crawlEvidenceIdentityFromRuntime(identity: RuntimeBatchIdentity): CrawlEvidenceIdentity {
  validateRuntimeBatchIdentity(identity);
  return summaryIdentity(identity);
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
  if (!isPlainObject(value)) throw new Error("Crawl summary failure map is invalid");
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([companyId, count]) => {
    if (!companyId.trim() || isSensitiveKey(companyId) || !Number.isSafeInteger(count) || count < 0) throw new Error("Crawl summary failure map is invalid");
    return [companyId, count];
    }));
}

function assertCrawlSummary(value: unknown): asserts value is CrawlSummary {
  if (!isPlainObject(value)) throw new Error("Crawl summary root is invalid");
  const summary = value as Partial<CrawlSummary>;
  if (!hasExactKeys(summary, SUMMARY_KEYS)) throw new Error("Crawl summary root keys are invalid");
  if (summary.schemaVersion !== CRAWL_SUMMARY_SCHEMA_VERSION ||
      typeof summary.releaseCandidateId !== "string" || !summary.releaseCandidateId.trim() ||
      !["FULL_RELEASE", "SCHEDULED", "MANUAL_SOURCE", "BASELINE"].includes(summary.batchKind ?? "") ||
      typeof summary.commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(summary.commitSha) ||
      ![summary.rosterSha256, summary.sourcePlanSha256, summary.sourceConfigSha256, summary.adapterBundleSha256, summary.plannedSourceSetSha256]
        .every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest)) ||
      !Number.isSafeInteger(summary.plannedSourceCount) || (summary.plannedSourceCount ?? 0) < 1 ||
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
        summary.failureCode !== null || summary.counters.plannedSourceCount !== summary.plannedSourceCount) {
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
  if (!isPlainObject(counters)) throw new Error("Crawl summary counters are incomplete");
  const expectedKeys = ["status", "batchId", ...COUNTER_KEYS].sort();
  if (JSON.stringify(Object.keys(counters).sort()) !== JSON.stringify(expectedKeys) ||
      typeof counters.batchId !== "string" || !counters.batchId.trim() ||
      !["SUCCESS", "INCOMPLETE", "FAILED"].includes(counters.status) || counters.plannedSourceCount < 1) {
    throw new Error("Crawl summary counters are incomplete");
  }
  for (const key of COUNTER_KEYS) {
    if (!Number.isSafeInteger(counters[key]) || counters[key] < 0 || counters[key] > counters.plannedSourceCount) {
      throw new Error(`Crawl summary counter ${key} is invalid`);
    }
  }
  if (counters.dueSourceCount + counters.skippedSourceCount !== counters.plannedSourceCount ||
      counters.transportSuccessfulSourceCount + counters.transportFailedSourceCount > counters.dueSourceCount ||
      counters.adapterSuccessfulSourceCount + counters.adapterFailedSourceCount > counters.transportSuccessfulSourceCount ||
      counters.completenessVerifiedSourceCount + counters.completenessIncompleteSourceCount > counters.adapterSuccessfulSourceCount ||
      counters.atomicCommittedSourceCount + counters.atomicFailedSourceCount > counters.dueSourceCount ||
      counters.successfulSourceCount + counters.failedSourceCount + counters.blockedSourceCount + counters.skippedSourceCount !== counters.plannedSourceCount) {
    throw new Error("Crawl summary counters do not form closed partitions");
  }
  if (counters.status === "SUCCESS" && (
    counters.dueSourceCount !== counters.plannedSourceCount ||
    counters.transportSuccessfulSourceCount !== counters.plannedSourceCount || counters.transportFailedSourceCount !== 0 ||
    counters.adapterSuccessfulSourceCount !== counters.plannedSourceCount || counters.adapterFailedSourceCount !== 0 ||
    counters.completenessVerifiedSourceCount !== counters.plannedSourceCount || counters.completenessIncompleteSourceCount !== 0 ||
    counters.atomicCommittedSourceCount !== counters.plannedSourceCount || counters.atomicFailedSourceCount !== 0 ||
    counters.successfulSourceCount !== counters.plannedSourceCount || counters.failedSourceCount !== 0 ||
    counters.blockedSourceCount !== 0 || counters.skippedSourceCount !== 0
  )) throw new Error("SUCCESS crawl summary counters are not exact");
}

const SUMMARY_KEYS = [
  "schemaVersion", "releaseCandidateId", "batchKind", "batchId", "commitSha", "rosterSha256", "sourcePlanSha256",
  "sourceConfigSha256", "adapterBundleSha256", "plannedSourceSetSha256", "plannedSourceCount", "capturedAt",
  "finishedAt", "terminalStatus", "counters", "globalSuccessRate", "sourceHealthStatus",
  "consecutiveFailuresByCompany", "failureCode"
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function isSensitiveKey(key: string): boolean {
  return /(?:password|passwd|pwd|secret|token|authorization|cookie|session|jwt|api[_-]?key)/iu.test(key);
}

function identitiesEqual(actual: CrawlEvidenceIdentity, expected: CrawlEvidenceIdentity): boolean {
  return (["releaseCandidateId", "batchKind", "commitSha", "rosterSha256", "sourcePlanSha256", "sourceConfigSha256",
    "adapterBundleSha256", "plannedSourceSetSha256", "plannedSourceCount"] as const)
    .every((key) => actual[key] === expected[key]);
}
