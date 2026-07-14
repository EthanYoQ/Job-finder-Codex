import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import type { CrawlBatchKind } from "./runtimeBatchIdentity";

export const CRAWL_ATTEMPT_SCHEMA_VERSION = "p0-crawl-attempt-v2" as const;
export const DEFAULT_CRAWL_ATTEMPT_MAX_RUNNING_AGE_HOURS = 2;

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

export type CrawlAttemptFailureCode =
  | "PRE_IDENTITY_FAILED"
  | "ADVISORY_LOCK_FAILED"
  | "FILE_LOCK_FAILED"
  | "PREFLIGHT_FAILED"
  | "CHILD_PROCESS_FAILED"
  | "CRAWL_EXECUTION_FAILED"
  | "SOURCE_HEALTH_FAILED"
  | "CANONICAL_SUMMARY_WRITE_FAILED"
  | "CLEANUP_FAILED"
  | "SCHEDULER_CHILD_FAILED";

export interface CrawlAttemptEvent {
  schemaVersion: typeof CRAWL_ATTEMPT_SCHEMA_VERSION;
  attemptId: string;
  state: "RUNNING" | "SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  identity: CrawlEvidenceIdentity | null;
  authority: {
    advisoryLockAcquired: boolean;
    fileLockAcquired: boolean;
  };
  canonicalSummaryBinding: {
    batchId: string;
    summarySha256: string;
  } | null;
  failureCode: CrawlAttemptFailureCode | null;
}

export type CrawlAttemptReadResult = {
  state: "MISSING" | "INVALID" | "RUNNING" | "STALE" | "FAILED" | "SUCCESS";
};

const ROOT_KEYS = [
  "attemptId", "authority", "canonicalSummaryBinding", "failureCode", "finishedAt",
  "identity", "schemaVersion", "startedAt", "state"
].sort();
const IDENTITY_KEYS = [
  "adapterBundleSha256", "batchKind", "commitSha", "plannedSourceCount", "plannedSourceSetSha256",
  "releaseCandidateId", "rosterSha256", "sourceConfigSha256", "sourcePlanSha256"
].sort();
const AUTHORITY_KEYS = ["advisoryLockAcquired", "fileLockAcquired"].sort();
const BINDING_KEYS = ["batchId", "summarySha256"].sort();
const FAILURE_CODES = new Set<CrawlAttemptFailureCode>([
  "PRE_IDENTITY_FAILED", "ADVISORY_LOCK_FAILED", "FILE_LOCK_FAILED", "PREFLIGHT_FAILED",
  "CHILD_PROCESS_FAILED", "CRAWL_EXECUTION_FAILED", "SOURCE_HEALTH_FAILED",
  "CANONICAL_SUMMARY_WRITE_FAILED", "CLEANUP_FAILED", "SCHEDULER_CHILD_FAILED"
]);

export function buildCrawlAttemptEvent(input: {
  attemptId: string;
  state: CrawlAttemptEvent["state"];
  startedAt: Date | string;
  finishedAt: Date | string | null;
  identity: CrawlEvidenceIdentity | null;
  authority: CrawlAttemptEvent["authority"];
  canonicalSummaryBinding: CrawlAttemptEvent["canonicalSummaryBinding"];
  failureCode: CrawlAttemptFailureCode | null;
}): CrawlAttemptEvent {
  const event: CrawlAttemptEvent = {
    schemaVersion: CRAWL_ATTEMPT_SCHEMA_VERSION,
    attemptId: input.attemptId,
    state: input.state,
    startedAt: toIsoInstant(input.startedAt),
    finishedAt: input.finishedAt === null ? null : toIsoInstant(input.finishedAt),
    identity: input.identity === null ? null : { ...input.identity },
    authority: { ...input.authority },
    canonicalSummaryBinding: input.canonicalSummaryBinding === null
      ? null
      : { ...input.canonicalSummaryBinding },
    failureCode: input.failureCode
  };
  assertCrawlAttemptEvent(event);
  return event;
}

export async function writeCrawlAttemptEvent(directory: string, event: CrawlAttemptEvent): Promise<void> {
  assertCrawlAttemptEvent(event);
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = resolve(root, eventFileName(event));
  const temporary = resolve(root, `.${eventFileName(event)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(event, null, 2)}\n`, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    // A hard link publishes the fully synced inode atomically and refuses to replace
    // an existing immutable journal entry.
    await link(temporary, target);
    await unlink(temporary);
    if (process.platform !== "win32") {
      const directoryHandle = await open(root, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readLatestCrawlAttempt(directory: string, options: {
  now: Date;
  expectedIdentity: CrawlEvidenceIdentity;
  expectedCanonicalSummary?: { batchId: string; summarySha256: string };
  maxRunningAgeHours?: number;
}): Promise<CrawlAttemptReadResult> {
  if (Number.isNaN(options.now.getTime()) || !isIdentity(options.expectedIdentity)) return { state: "INVALID" };
  const maxAge = options.maxRunningAgeHours ?? DEFAULT_CRAWL_ATTEMPT_MAX_RUNNING_AGE_HOURS;
  if (!Number.isFinite(maxAge) || maxAge <= 0) return { state: "INVALID" };
  let names: string[];
  try {
    names = await readdir(resolve(directory));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "MISSING" } : { state: "INVALID" };
  }
  if (names.length === 0) return { state: "MISSING" };
  const events: CrawlAttemptEvent[] = [];
  try {
    for (const name of names.sort(compareUtf8)) {
      if (!name.endsWith(".json")) throw new Error("Unexpected crawl attempt directory entry");
      const entryPath = resolve(directory, name);
      const metadata = await lstat(entryPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Crawl attempt entry is not a regular file");
      const handle = await open(entryPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let raw: string;
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Crawl attempt entry changed type");
        raw = await handle.readFile({ encoding: "utf8" });
      } finally {
        await handle.close();
      }
      const parsed: unknown = JSON.parse(raw);
      assertCrawlAttemptEvent(parsed);
      const event = parsed as CrawlAttemptEvent;
      if (name !== eventFileName(event)) throw new Error("Crawl attempt filename does not bind its content");
      events.push(event);
    }
  } catch {
    return { state: "INVALID" };
  }

  const startsByAttempt = new Map<string, Set<string>>();
  for (const event of events) {
    const starts = startsByAttempt.get(event.attemptId) ?? new Set<string>();
    starts.add(event.startedAt);
    startsByAttempt.set(event.attemptId, starts);
  }
  if ([...startsByAttempt.values()].some((starts) => starts.size !== 1)) return { state: "INVALID" };
  const maximumStartedAt = [...startsByAttempt.values()]
    .map((starts) => [...starts][0]!)
    .sort()
    .at(-1)!;
  const latestAttemptIds = [...startsByAttempt.entries()]
    .filter(([, starts]) => starts.has(maximumStartedAt))
    .map(([attemptId]) => attemptId);
  if (latestAttemptIds.length !== 1) return { state: "INVALID" };
  const latestId = latestAttemptIds[0]!;
  const latest = events.filter((event) => event.attemptId === latestId);
  if (latest.filter((event) => event.state === "RUNNING").length > 1 ||
      latest.filter((event) => event.state !== "RUNNING").length > 1) return { state: "INVALID" };
  const terminal = latest.find((event) => event.state !== "RUNNING");
  const event = terminal ?? latest.find((candidate) => candidate.state === "RUNNING");
  if (!event) return { state: "INVALID" };
  if (event.identity !== null && !identitiesEqual(event.identity, options.expectedIdentity)) return { state: "INVALID" };
  if (event.state === "FAILED") return { state: "FAILED" };
  if (event.state === "SUCCESS") {
    if (!event.authority.advisoryLockAcquired || !event.authority.fileLockAcquired || event.identity === null ||
        options.expectedCanonicalSummary === undefined ||
        !bindingsEqual(event.canonicalSummaryBinding, options.expectedCanonicalSummary)) return { state: "INVALID" };
    return { state: "SUCCESS" };
  }
  const ageHours = (options.now.getTime() - new Date(event.startedAt).getTime()) / 3_600_000;
  if (ageHours < -5 / 60) return { state: "INVALID" };
  return { state: ageHours > maxAge ? "STALE" : "RUNNING" };
}

export async function readLatestCrawlAttemptStartedAt(directory: string): Promise<Date | undefined> {
  let names: string[];
  try {
    names = await readdir(resolve(directory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let latestTimestamp: number | undefined;
  for (const name of names) {
    const match = /^(\d+)__[A-Za-z0-9._-]{1,128}__(?:RUNNING|SUCCESS|FAILED)\.json$/u.exec(name);
    if (!match) throw new Error("Unexpected crawl attempt directory entry");
    const timestamp = Number(match[1]);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || Number.isNaN(new Date(timestamp).getTime())) {
      throw new Error("Crawl attempt filename timestamp is invalid");
    }
    latestTimestamp = latestTimestamp === undefined ? timestamp : Math.max(latestTimestamp, timestamp);
  }
  return latestTimestamp === undefined ? undefined : new Date(latestTimestamp);
}

function eventFileName(event: CrawlAttemptEvent): string {
  return `${Date.parse(event.startedAt)}__${event.attemptId}__${event.state}.json`;
}

function assertCrawlAttemptEvent(value: unknown): asserts value is CrawlAttemptEvent {
  if (!isPlainObject(value) || !sameKeys(value, ROOT_KEYS)) throw new Error("Crawl attempt root is invalid");
  const event = value as unknown as CrawlAttemptEvent;
  if (event.schemaVersion !== CRAWL_ATTEMPT_SCHEMA_VERSION || !/^[A-Za-z0-9._-]{1,128}$/u.test(event.attemptId) ||
      !["RUNNING", "SUCCESS", "FAILED"].includes(event.state) || !isIsoInstant(event.startedAt) ||
      (event.finishedAt !== null && !isIsoInstant(event.finishedAt)) ||
      !isPlainObject(event.authority) || !sameKeys(event.authority, AUTHORITY_KEYS) ||
      typeof event.authority.advisoryLockAcquired !== "boolean" || typeof event.authority.fileLockAcquired !== "boolean" ||
      (event.identity !== null && !isIdentity(event.identity)) ||
      (event.canonicalSummaryBinding !== null && !isBinding(event.canonicalSummaryBinding))) {
    throw new Error("Crawl attempt fields are invalid");
  }
  if (event.finishedAt !== null && Date.parse(event.finishedAt) < Date.parse(event.startedAt)) throw new Error("Crawl attempt time is invalid");
  if (event.state === "RUNNING") {
    if (event.finishedAt !== null || event.canonicalSummaryBinding !== null || event.failureCode !== null) throw new Error("RUNNING attempt is invalid");
  } else if (event.state === "SUCCESS") {
    if (event.finishedAt === null || event.identity === null || !event.authority.advisoryLockAcquired ||
        !event.authority.fileLockAcquired || event.canonicalSummaryBinding === null || event.failureCode !== null) throw new Error("SUCCESS attempt is invalid");
  } else if (event.finishedAt === null || event.canonicalSummaryBinding !== null ||
      event.failureCode === null || !FAILURE_CODES.has(event.failureCode)) {
    throw new Error("FAILED attempt is invalid");
  }
}

function isIdentity(value: unknown): value is CrawlEvidenceIdentity {
  if (!isPlainObject(value) || !sameKeys(value, IDENTITY_KEYS)) return false;
  const identity = value as unknown as CrawlEvidenceIdentity;
  return typeof identity.releaseCandidateId === "string" && identity.releaseCandidateId.trim().length > 0 &&
    ["FULL_RELEASE", "SCHEDULED", "MANUAL_SOURCE", "BASELINE"].includes(identity.batchKind) &&
    /^[0-9a-f]{40}$/u.test(identity.commitSha) &&
    [identity.rosterSha256, identity.sourcePlanSha256, identity.sourceConfigSha256,
      identity.adapterBundleSha256, identity.plannedSourceSetSha256].every((digest) => /^[0-9a-f]{64}$/u.test(digest)) &&
    Number.isSafeInteger(identity.plannedSourceCount) && identity.plannedSourceCount > 0;
}

function isBinding(value: unknown): value is NonNullable<CrawlAttemptEvent["canonicalSummaryBinding"]> {
  if (!isPlainObject(value) || !sameKeys(value, BINDING_KEYS)) return false;
  const binding = value as { batchId: unknown; summarySha256: unknown };
  return typeof binding.batchId === "string" && binding.batchId.trim().length > 0 &&
    typeof binding.summarySha256 === "string" && /^[0-9a-f]{64}$/u.test(binding.summarySha256);
}

function identitiesEqual(left: CrawlEvidenceIdentity, right: CrawlEvidenceIdentity): boolean {
  return IDENTITY_KEYS.every((key) => left[key as keyof CrawlEvidenceIdentity] === right[key as keyof CrawlEvidenceIdentity]);
}

function bindingsEqual(left: CrawlAttemptEvent["canonicalSummaryBinding"], right: { batchId: string; summarySha256: string }): boolean {
  return left !== null && left.batchId === right.batchId && left.summarySha256 === right.summarySha256;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function isIsoInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function toIsoInstant(value: Date | string): string {
  const parsed = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(parsed.getTime())) throw new Error("Crawl attempt timestamp is invalid");
  return parsed.toISOString();
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
