import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { CrawlEvidenceIdentity } from "./crawlSummary";
import { validateRuntimeBatchIdentity, type RuntimeBatchIdentity } from "./runtimeBatchIdentity";

export const INITIAL_QUALIFICATION_PAUSE_SCHEMA_VERSION =
  "p0-initial-qualification-pause-v2" as const;
export const INITIAL_QUALIFICATION_PAUSE_REASON =
  "INITIAL_QUALIFICATION_BELOW_MINIMUM_AFTER_TWO_COMPLETED_ROUNDS" as const;

export interface InitialQualificationPauseEvidence {
  schemaVersion: typeof INITIAL_QUALIFICATION_PAUSE_SCHEMA_VERSION;
  state: "PAUSED_BELOW_MINIMUM";
  reasonCode: typeof INITIAL_QUALIFICATION_PAUSE_REASON;
  notificationKey: string;
  attemptId: string;
  releaseCandidateId: string;
  batchKind: "SCHEDULED";
  batchId: string;
  canonicalSummarySha256: string;
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  plannedSourceSetSha256: string;
  plannedSourceCount: number;
  completedRoundCount: 2;
  stableCompanyCount: number;
  minimumStableCompanyCount: number;
  recordedAt: string;
}

export type InitialQualificationPauseReadResult =
  | { state: "MISSING" | "INVALID" }
  | { state: "VALID"; evidence: InitialQualificationPauseEvidence };

const EVIDENCE_KEYS = [
  "adapterBundleSha256", "attemptId", "batchId", "batchKind", "canonicalSummarySha256", "commitSha", "completedRoundCount",
  "minimumStableCompanyCount", "notificationKey", "plannedSourceCount", "plannedSourceSetSha256",
  "reasonCode", "recordedAt", "releaseCandidateId", "rosterSha256", "schemaVersion",
  "sourceConfigSha256", "sourcePlanSha256", "stableCompanyCount", "state"
].sort();

export function buildInitialQualificationPauseEvidence(input: {
  attemptId: string;
  identity: RuntimeBatchIdentity;
  batchId: string;
  canonicalSummarySha256: string;
  completedRoundCount: 2;
  stableCompanyCount: number;
  minimumStableCompanyCount: number;
  recordedAt: Date;
}): InitialQualificationPauseEvidence {
  validateRuntimeBatchIdentity(input.identity);
  if (input.identity.batchKind !== "SCHEDULED" || input.identity.ownerId !== "staged-scheduler") {
    throw new Error("Initial qualification pause identity is invalid");
  }
  const evidence: InitialQualificationPauseEvidence = {
    schemaVersion: INITIAL_QUALIFICATION_PAUSE_SCHEMA_VERSION,
    state: "PAUSED_BELOW_MINIMUM",
    reasonCode: INITIAL_QUALIFICATION_PAUSE_REASON,
    notificationKey: "",
    attemptId: input.attemptId,
    releaseCandidateId: input.identity.releaseCandidateId,
    batchKind: "SCHEDULED",
    batchId: input.batchId,
    canonicalSummarySha256: input.canonicalSummarySha256,
    commitSha: input.identity.commitSha,
    rosterSha256: input.identity.rosterSha256,
    sourcePlanSha256: input.identity.sourcePlanSha256,
    sourceConfigSha256: input.identity.sourceConfigSha256,
    adapterBundleSha256: input.identity.adapterBundleSha256,
    plannedSourceSetSha256: input.identity.expectedPlannedSourceSetSha256,
    plannedSourceCount: input.identity.expectedPlannedSourceCount,
    completedRoundCount: input.completedRoundCount,
    stableCompanyCount: input.stableCompanyCount,
    minimumStableCompanyCount: input.minimumStableCompanyCount,
    recordedAt: toIsoInstant(input.recordedAt)
  };
  evidence.notificationKey = deriveNotificationKey(evidence);
  assertInitialQualificationPauseEvidence(evidence);
  return Object.freeze(evidence);
}

export async function writeInitialQualificationPauseEvidence(
  path: string,
  evidence: InitialQualificationPauseEvidence
): Promise<void> {
  assertInitialQualificationPauseEvidence(evidence);
  const target = resolve(path);
  const directory = dirname(target);
  const temporary = resolve(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    if (process.platform !== "win32") {
      const directoryHandle = await open(directory, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readInitialQualificationPauseEvidence(
  path: string,
  options: { expectedIdentity?: CrawlEvidenceIdentity } = {}
): Promise<InitialQualificationPauseReadResult> {
  const target = resolve(path);
  try {
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 16 * 1024) return { state: "INVALID" };
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const handle = await open(target, constants.O_RDONLY | noFollow);
    let raw: string;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) return { state: "INVALID" };
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
    const parsed: unknown = JSON.parse(raw);
    assertInitialQualificationPauseEvidence(parsed);
    const evidence = parsed as InitialQualificationPauseEvidence;
    if (options.expectedIdentity && !matchesIdentity(evidence, options.expectedIdentity)) return { state: "INVALID" };
    return { state: "VALID", evidence };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { state: "MISSING" } : { state: "INVALID" };
  }
}

export function crawlEvidenceIdentityFromInitialQualificationPause(
  evidence: InitialQualificationPauseEvidence
): CrawlEvidenceIdentity {
  assertInitialQualificationPauseEvidence(evidence);
  return Object.freeze({
    releaseCandidateId: evidence.releaseCandidateId,
    batchKind: evidence.batchKind,
    commitSha: evidence.commitSha,
    rosterSha256: evidence.rosterSha256,
    sourcePlanSha256: evidence.sourcePlanSha256,
    sourceConfigSha256: evidence.sourceConfigSha256,
    adapterBundleSha256: evidence.adapterBundleSha256,
    plannedSourceSetSha256: evidence.plannedSourceSetSha256,
    plannedSourceCount: evidence.plannedSourceCount
  });
}

function assertInitialQualificationPauseEvidence(value: unknown): asserts value is InitialQualificationPauseEvidence {
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(EVIDENCE_KEYS)) {
    throw new Error("Initial qualification pause evidence root is invalid");
  }
  const evidence = value as unknown as InitialQualificationPauseEvidence;
  if (
    evidence.schemaVersion !== INITIAL_QUALIFICATION_PAUSE_SCHEMA_VERSION ||
    evidence.state !== "PAUSED_BELOW_MINIMUM" ||
    evidence.reasonCode !== INITIAL_QUALIFICATION_PAUSE_REASON ||
    !/^[A-Za-z0-9._-]{1,128}$/u.test(evidence.attemptId) ||
    !evidence.releaseCandidateId.trim() || evidence.releaseCandidateId.length > 256 ||
    evidence.batchKind !== "SCHEDULED" || !evidence.batchId.trim() || evidence.batchId.length > 256 ||
    !/^[0-9a-f]{40}$/u.test(evidence.commitSha) ||
    ![evidence.rosterSha256, evidence.sourcePlanSha256, evidence.sourceConfigSha256,
      evidence.adapterBundleSha256, evidence.plannedSourceSetSha256, evidence.canonicalSummarySha256,
      evidence.notificationKey]
      .every((digest) => /^[0-9a-f]{64}$/u.test(digest)) ||
    !Number.isSafeInteger(evidence.plannedSourceCount) || evidence.plannedSourceCount < 1 ||
    evidence.completedRoundCount !== 2 ||
    !Number.isSafeInteger(evidence.stableCompanyCount) || evidence.stableCompanyCount < 0 ||
    !Number.isSafeInteger(evidence.minimumStableCompanyCount) || evidence.minimumStableCompanyCount < 1 ||
    evidence.stableCompanyCount >= evidence.minimumStableCompanyCount ||
    !isIsoInstant(evidence.recordedAt) ||
    evidence.notificationKey !== deriveNotificationKey(evidence)
  ) throw new Error("Initial qualification pause evidence fields are invalid");
}

function deriveNotificationKey(evidence: Omit<InitialQualificationPauseEvidence, "notificationKey">): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    state: evidence.state,
    reasonCode: evidence.reasonCode,
    releaseCandidateId: evidence.releaseCandidateId,
    batchId: evidence.batchId,
    attemptId: evidence.attemptId,
    canonicalSummarySha256: evidence.canonicalSummarySha256,
    completedRoundCount: evidence.completedRoundCount,
    stableCompanyCount: evidence.stableCompanyCount,
    minimumStableCompanyCount: evidence.minimumStableCompanyCount
  }), "utf8").digest("hex");
}

function matchesIdentity(evidence: InitialQualificationPauseEvidence, expected: CrawlEvidenceIdentity): boolean {
  return evidence.releaseCandidateId === expected.releaseCandidateId && evidence.batchKind === expected.batchKind &&
    evidence.commitSha === expected.commitSha && evidence.rosterSha256 === expected.rosterSha256 &&
    evidence.sourcePlanSha256 === expected.sourcePlanSha256 &&
    evidence.sourceConfigSha256 === expected.sourceConfigSha256 &&
    evidence.adapterBundleSha256 === expected.adapterBundleSha256 &&
    evidence.plannedSourceSetSha256 === expected.plannedSourceSetSha256 &&
    evidence.plannedSourceCount === expected.plannedSourceCount;
}

function isIsoInstant(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function toIsoInstant(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("Initial qualification pause timestamp is invalid");
  return value.toISOString();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
