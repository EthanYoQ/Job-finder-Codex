import { createHash } from "node:crypto";
import { candidateCompanies, type CandidateCompany } from "../data/companyRegistry";
import { P0_LAUNCH_MANIFEST, launchManifestIdentity, selectLaunchCompanies,
  validateLaunchBatchIdentity, validateLaunchManifest } from "../release/launchManifest";
import { resolveCurrentBuildIdentity, type BuildIdentityArtifact } from "../readiness/buildIdentity";
import {
  activeSourcePlanSha256,
  buildStagedSourceCrawlPlans,
  sourcePlanConfigSha256,
  validateExecutablePlanChannelBinding,
  type SourceCrawlPlan
} from "./sourcePlan";
import {
  canonicalizePlannedSourceIds,
  hashCanonicalStringSet,
  type RuntimeBatchIdentity
} from "./runtimeBatchIdentity";

export const STAGED_SCHEDULE_ORACLE_VERSION = "staged-official-source-v1" as const;

const STAGED_SCHEDULE_ALLOWED_STATUSES = ["BUILDING", "READY_FOR_QA", "RELEASED"] as const;
const STAGED_SCHEDULE_OWNER_ID = "staged-scheduler" as const;
const STAGED_ADAPTER_BUNDLE_SCHEMA_VERSION = "staged-adapter-bundle-v1" as const;

export interface StagedScheduleExpectation {
  companies: readonly CandidateCompany[];
  plans: readonly SourceCrawlPlan[];
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  sourceTreeSha256: string;
  runtimeTreeSha256: string;
  minimumStableCompanyCount: number;
  plannedSourceIds: string[];
  plannedSourceSetSha256: string;
  plannedSourceCount: number;
}

export interface CurrentStagedScheduleAuthority {
  companies: readonly CandidateCompany[];
  plans: readonly SourceCrawlPlan[];
  identity: RuntimeBatchIdentity;
}

interface StagedReleaseCandidateRow {
  id: string;
  status: string;
  commitSha: string;
  rosterHash: string;
  sourcePlanHash: string;
  sourceConfigHash: string;
  adapterBundleHash: string;
  sourceTreeHash: string;
  runtimeTreeHash: string;
  oracleVersion: string;
  minimumStableCompanyCount: number;
}

interface StagedReleaseCandidateFindManyArgs {
  where: {
    commitSha: string;
    rosterHash: string;
    sourcePlanHash: string;
    sourceConfigHash: string;
    adapterBundleHash: string;
    sourceTreeHash: string;
    runtimeTreeHash: string;
    oracleVersion: typeof STAGED_SCHEDULE_ORACLE_VERSION;
    minimumStableCompanyCount: number;
    status: { in: readonly (typeof STAGED_SCHEDULE_ALLOWED_STATUSES)[number][] };
  };
  select: Record<keyof StagedReleaseCandidateRow, true>;
  take: 2;
}

interface StagedScheduledBatchRow {
  id: string;
  releaseCandidateId: string | null;
  commitSha: string | null;
  rosterSha256: string | null;
  sourcePlanSha256: string | null;
  sourceConfigSha256: string | null;
  adapterBundleSha256: string | null;
  kind: string | null;
  plannedSourceIds: unknown;
  plannedSourceSetSha256: string | null;
  plannedSourceCount: number | null;
  ownerId: string | null;
  status: string;
  finishedAt: Date | null;
}

interface StagedScheduledBatchFindManyArgs {
  where: {
    releaseCandidateId: string;
    kind: "SCHEDULED";
  };
  select: Record<keyof StagedScheduledBatchRow, true>;
  orderBy: { id: "asc" };
}

export interface StagedScheduleAuthorityDb {
  releaseCandidate: {
    findMany(args: StagedReleaseCandidateFindManyArgs): Promise<readonly StagedReleaseCandidateRow[]>;
  };
}

export interface StagedScheduledCrawlAuthorityDb extends StagedScheduleAuthorityDb {
  crawlBatch: {
    findMany(args: StagedScheduledBatchFindManyArgs): Promise<readonly StagedScheduledBatchRow[]>;
  };
}

export interface StagedQualificationRoundDb {
  crawlBatch: StagedScheduledCrawlAuthorityDb["crawlBatch"];
}

export function deriveCurrentStagedScheduleExpectation(
  buildIdentity: BuildIdentityArtifact
): StagedScheduleExpectation {
  const launchCompanies = selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies);
  return __testOnlyDeriveStagedScheduleExpectation(
    buildIdentity,
    launchCompanies,
    buildStagedSourceCrawlPlans(launchCompanies)
  );
}

/** @internal Pure fixture seam; never used as a runnable crawl authority. */
export function __testOnlyDeriveStagedScheduleExpectation(
  buildIdentity: BuildIdentityArtifact,
  companies: readonly CandidateCompany[],
  plans: readonly SourceCrawlPlan[]
): StagedScheduleExpectation {
  validateBuildIdentity(buildIdentity);
  const manifestErrors = validateLaunchManifest(P0_LAUNCH_MANIFEST, candidateCompanies.map(({ id }) => id));
  if (manifestErrors.length > 0) throw new Error(`Launch Manifest is invalid: ${manifestErrors.join(",")}`);
  assertCanonicalLaunchCompanies(companies);

  const canonicalPlans = canonicalizePlans(buildStagedSourceCrawlPlans(
    selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies)
  ));
  const orderedPlans = canonicalizePlans(plans);
  if (
    orderedPlans.length !== canonicalPlans.length ||
    activeSourcePlanSha256(orderedPlans) !== activeSourcePlanSha256(canonicalPlans)
  ) {
    throw new Error("Staged source plans do not exactly match canonical staged authority");
  }
  for (const plan of orderedPlans) {
    if (plan.executionAuthority !== "STAGED") {
      throw new Error(`Staged source plan lacks STAGED authority: ${plan.source.id}`);
    }
    validateExecutablePlanChannelBinding(plan);
  }

  const plannedSourceIds = canonicalizePlannedSourceIds(orderedPlans.map((plan) => plan.source.id));
  const manifestIdentity = launchManifestIdentity(P0_LAUNCH_MANIFEST);
  const launchErrors = validateLaunchBatchIdentity(P0_LAUNCH_MANIFEST, {
    batchKind: "SCHEDULED",
    rosterSha256: manifestIdentity.companySetSha256,
    sourcePlanSha256: manifestIdentity.sourceIdentitySha256,
    expectedPlannedSourceIds: plannedSourceIds,
    expectedPlannedSourceCount: plannedSourceIds.length
  }, orderedPlans);
  if (launchErrors.length > 0) throw new Error(`Launch runtime identity is invalid: ${launchErrors.join(",")}`);
  return {
    companies: canonicalizeCompanies(companies),
    plans: orderedPlans,
    commitSha: buildIdentity.commitSha,
    rosterSha256: manifestIdentity.companySetSha256,
    sourcePlanSha256: manifestIdentity.sourceIdentitySha256,
    sourceConfigSha256: deriveStagedSourceConfigSha256(orderedPlans),
    adapterBundleSha256: deriveStagedAdapterBundleSha256(buildIdentity.runtimeTreeSha256, orderedPlans),
    sourceTreeSha256: buildIdentity.sourceTreeSha256,
    runtimeTreeSha256: buildIdentity.runtimeTreeSha256,
    minimumStableCompanyCount: P0_LAUNCH_MANIFEST.companies.length,
    plannedSourceIds,
    plannedSourceSetSha256: hashCanonicalStringSet(plannedSourceIds),
    plannedSourceCount: plannedSourceIds.length
  };
}

export function deriveStagedSourceConfigSha256(plans: readonly SourceCrawlPlan[]): string {
  const entries = plans.map((plan) => [plan.source.id, sourcePlanConfigSha256(plan)] as const)
    .sort(([left], [right]) => compareUtf8(left, right));
  if (entries.some(([sourceId]) => !sourceId.trim()) || new Set(entries.map(([sourceId]) => sourceId)).size !== entries.length) {
    throw new Error("Staged source config map requires unique nonblank source ids");
  }
  return sha256(JSON.stringify(Object.fromEntries(entries)));
}

export function deriveStagedAdapterBundleSha256(
  runtimeTreeSha256: string,
  plans: readonly SourceCrawlPlan[]
): string {
  requireSha256(runtimeTreeSha256, "runtime tree");
  const adapterIds = [...new Set(plans.map((plan) => plan.adapterId))].sort(compareUtf8);
  if (adapterIds.some((adapterId) => !adapterId.trim())) {
    throw new Error("Staged adapter ids must be nonblank");
  }
  return sha256(JSON.stringify({
    schemaVersion: STAGED_ADAPTER_BUNDLE_SCHEMA_VERSION,
    runtimeTreeSha256,
    adapterIds
  }));
}

export async function resolveCurrentStagedScheduleAuthority(
  db: StagedScheduleAuthorityDb
): Promise<CurrentStagedScheduleAuthority> {
  return (await resolveCurrentStagedScheduleAuthorityWithStatus(db)).authority;
}

export async function resolveCurrentBuildingStagedScheduleAuthority(
  db: StagedScheduleAuthorityDb
): Promise<CurrentStagedScheduleAuthority> {
  const resolved = await resolveCurrentStagedScheduleAuthorityWithStatus(db);
  if (resolved.status !== "BUILDING") {
    throw new Error(`Formal qualification requires a BUILDING release candidate: ${resolved.authority.identity.releaseCandidateId}`);
  }
  return resolved.authority;
}

export async function resolveCurrentStagedScheduledCrawlAuthority(
  db: StagedScheduledCrawlAuthorityDb
): Promise<CurrentStagedScheduleAuthority> {
  const resolved = await resolveCurrentStagedScheduleAuthorityWithStatus(db);
  if (resolved.status === "READY_FOR_QA") {
    throw new Error(`STAGED_READY_FOR_QA_CANNOT_RUN_AWAITING_QA:${resolved.authority.identity.releaseCandidateId}`);
  }
  const identity = resolved.authority.identity;
  const batches = await loadScheduledBatches(db, identity);
  const completedRoundCount = countCompletedQualificationRows(batches, identity);
  if (resolved.status === "BUILDING" && completedRoundCount >= 2) {
    throw new Error(
      `STAGED_INITIAL_QUALIFICATION_ROUND_LIMIT_REACHED:${identity.releaseCandidateId}:${completedRoundCount}`
    );
  }
  return resolved.authority;
}

export async function countCompletedStagedQualificationRounds(
  db: StagedQualificationRoundDb,
  identity: RuntimeBatchIdentity
): Promise<number> {
  const batches = await loadScheduledBatches(db, identity);
  return countCompletedQualificationRows(batches, identity);
}

async function loadScheduledBatches(
  db: StagedQualificationRoundDb,
  identity: RuntimeBatchIdentity
): Promise<readonly StagedScheduledBatchRow[]> {
  return db.crawlBatch.findMany({
    where: {
      releaseCandidateId: identity.releaseCandidateId,
      kind: "SCHEDULED"
    },
    select: {
      id: true,
      releaseCandidateId: true,
      commitSha: true,
      rosterSha256: true,
      sourcePlanSha256: true,
      sourceConfigSha256: true,
      adapterBundleSha256: true,
      kind: true,
      plannedSourceIds: true,
      plannedSourceSetSha256: true,
      plannedSourceCount: true,
      ownerId: true,
      status: true,
      finishedAt: true
    },
    orderBy: { id: "asc" }
  });
}

function countCompletedQualificationRows(
  batches: readonly StagedScheduledBatchRow[],
  identity: RuntimeBatchIdentity
): number {
  let completedRoundCount = 0;
  for (const batch of batches) {
    assertExistingScheduledBatchIdentity(batch, identity);
    const hasFinishedAt = batch.finishedAt instanceof Date && Number.isFinite(batch.finishedAt.getTime());
    if (["SUCCESS", "INCOMPLETE", "FAILED"].includes(batch.status)) {
      if (!hasFinishedAt) {
        throw new Error(`STAGED_SCHEDULED_BATCH_TERMINAL_STATE_DRIFT:${batch.id}`);
      }
      completedRoundCount += 1;
      continue;
    }
    if (batch.status === "ABORTED") {
      if (!hasFinishedAt) {
        throw new Error(`STAGED_SCHEDULED_BATCH_TERMINAL_STATE_DRIFT:${batch.id}`);
      }
      continue;
    }
    if (batch.status === "RUNNING") {
      if (batch.finishedAt !== null) {
        throw new Error(`STAGED_SCHEDULED_BATCH_TERMINAL_STATE_DRIFT:${batch.id}`);
      }
      continue;
    }
    throw new Error(`STAGED_SCHEDULED_BATCH_TERMINAL_STATE_DRIFT:${batch.id}`);
  }
  return completedRoundCount;
}

async function resolveCurrentStagedScheduleAuthorityWithStatus(
  db: StagedScheduleAuthorityDb
): Promise<{
  authority: CurrentStagedScheduleAuthority;
  status: (typeof STAGED_SCHEDULE_ALLOWED_STATUSES)[number];
}> {
  const expectation = deriveCurrentStagedScheduleExpectation(resolveCurrentBuildIdentity());
  const rows = await db.releaseCandidate.findMany({
    where: {
      commitSha: expectation.commitSha,
      rosterHash: expectation.rosterSha256,
      sourcePlanHash: expectation.sourcePlanSha256,
      sourceConfigHash: expectation.sourceConfigSha256,
      adapterBundleHash: expectation.adapterBundleSha256,
      sourceTreeHash: expectation.sourceTreeSha256,
      runtimeTreeHash: expectation.runtimeTreeSha256,
      oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION,
      minimumStableCompanyCount: expectation.minimumStableCompanyCount,
      status: { in: [...STAGED_SCHEDULE_ALLOWED_STATUSES] }
    },
    select: {
      id: true,
      status: true,
      commitSha: true,
      rosterHash: true,
      sourcePlanHash: true,
      sourceConfigHash: true,
      adapterBundleHash: true,
      sourceTreeHash: true,
      runtimeTreeHash: true,
      oracleVersion: true,
      minimumStableCompanyCount: true
    },
    take: 2
  });
  if (rows.length !== 1) {
    throw new Error(`Staged schedule authority requires exactly one matching release candidate; found ${rows.length}`);
  }

  const row = rows[0]!;
  if (!row.id.trim()) throw new Error("Staged schedule release candidate id must be nonblank");
  if (!(STAGED_SCHEDULE_ALLOWED_STATUSES as readonly string[]).includes(row.status)) {
    throw new Error(`Staged schedule release candidate status is not allowed: ${row.status}`);
  }
  assertReleaseCandidateField("commitSha", row.commitSha, expectation.commitSha);
  assertReleaseCandidateField("rosterHash", row.rosterHash, expectation.rosterSha256);
  assertReleaseCandidateField("sourcePlanHash", row.sourcePlanHash, expectation.sourcePlanSha256);
  assertReleaseCandidateField("sourceConfigHash", row.sourceConfigHash, expectation.sourceConfigSha256);
  assertReleaseCandidateField("adapterBundleHash", row.adapterBundleHash, expectation.adapterBundleSha256);
  assertReleaseCandidateField("sourceTreeHash", row.sourceTreeHash, expectation.sourceTreeSha256);
  assertReleaseCandidateField("runtimeTreeHash", row.runtimeTreeHash, expectation.runtimeTreeSha256);
  assertReleaseCandidateField("oracleVersion", row.oracleVersion, STAGED_SCHEDULE_ORACLE_VERSION);
  if (row.minimumStableCompanyCount !== expectation.minimumStableCompanyCount) {
    throw new Error(
      `Staged release candidate minimumStableCompanyCount mismatch: expected ${expectation.minimumStableCompanyCount}`
    );
  }

  const authority: CurrentStagedScheduleAuthority = deepFrozenCopy({
    companies: expectation.companies,
    plans: expectation.plans,
    identity: {
      releaseCandidateId: row.id,
      commitSha: expectation.commitSha,
      rosterSha256: expectation.rosterSha256,
      sourcePlanSha256: expectation.sourcePlanSha256,
      sourceConfigSha256: expectation.sourceConfigSha256,
      adapterBundleSha256: expectation.adapterBundleSha256,
      batchKind: "SCHEDULED",
      ownerId: STAGED_SCHEDULE_OWNER_ID,
      expectedPlannedSourceIds: expectation.plannedSourceIds,
      expectedPlannedSourceSetSha256: expectation.plannedSourceSetSha256,
      expectedPlannedSourceCount: expectation.plannedSourceCount
    }
  });
  return {
    authority,
    status: row.status as (typeof STAGED_SCHEDULE_ALLOWED_STATUSES)[number]
  };
}

function assertExistingScheduledBatchIdentity(
  batch: StagedScheduledBatchRow,
  identity: RuntimeBatchIdentity
): void {
  const plannedSourceIds = Array.isArray(batch.plannedSourceIds) &&
    batch.plannedSourceIds.every((sourceId): sourceId is string => typeof sourceId === "string")
    ? batch.plannedSourceIds
    : null;
  if (
    !batch.id.trim() ||
    batch.releaseCandidateId !== identity.releaseCandidateId ||
    batch.commitSha !== identity.commitSha ||
    batch.rosterSha256 !== identity.rosterSha256 ||
    batch.sourcePlanSha256 !== identity.sourcePlanSha256 ||
    batch.sourceConfigSha256 !== identity.sourceConfigSha256 ||
    batch.adapterBundleSha256 !== identity.adapterBundleSha256 ||
    batch.kind !== identity.batchKind ||
    batch.ownerId !== identity.ownerId ||
    batch.plannedSourceSetSha256 !== identity.expectedPlannedSourceSetSha256 ||
    batch.plannedSourceCount !== identity.expectedPlannedSourceCount ||
    plannedSourceIds === null ||
    JSON.stringify(plannedSourceIds) !== JSON.stringify(identity.expectedPlannedSourceIds)
  ) {
    throw new Error(`STAGED_SCHEDULED_BATCH_IDENTITY_DRIFT:${batch.id || "blank-id"}`);
  }
}

function assertCanonicalLaunchCompanies(companies: readonly CandidateCompany[]): void {
  const expected = selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies);
  if (stableJson(canonicalizeCompanies(companies)) !== stableJson(canonicalizeCompanies(expected))) {
    throw new Error("Staged schedule company roster does not match frozen launch Manifest");
  }
}

function canonicalizeCompanies(companies: readonly CandidateCompany[]): CandidateCompany[] {
  return [...companies].sort((left, right) => compareUtf8(left.id, right.id));
}

function canonicalizePlans(plans: readonly SourceCrawlPlan[]): SourceCrawlPlan[] {
  return [...plans].sort((left, right) => compareUtf8(left.source.id, right.source.id));
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => [key, canonicalJsonValue(item)]));
  }
  return value;
}

function validateBuildIdentity(buildIdentity: BuildIdentityArtifact): void {
  if (!/^[0-9a-f]{40}$/.test(buildIdentity.commitSha)) throw new Error("Staged build commit SHA is invalid");
  requireSha256(buildIdentity.sourceTreeSha256, "source tree");
  requireSha256(buildIdentity.runtimeTreeSha256, "runtime tree");
}

function requireSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`Staged ${label} SHA-256 is invalid`);
}

function assertReleaseCandidateField(field: string, actual: string, expected: string): void {
  if (actual !== expected) throw new Error(`Staged schedule release candidate ${field} mismatch`);
}

function deepFrozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
