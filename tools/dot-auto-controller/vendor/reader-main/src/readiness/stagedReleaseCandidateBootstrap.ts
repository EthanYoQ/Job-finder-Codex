import type { BuildIdentityArtifact } from "./buildIdentity";
import {
  STAGED_SCHEDULE_ORACLE_VERSION,
  type StagedScheduleExpectation
} from "../crawler/stagedScheduleAuthority";

const PREPARE_INPUT_KEYS = [
  "dbSnapshotSha256",
  "goalId",
  "id",
  "migrationVersion",
  "schemaSha256",
  "version"
] as const;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MIGRATION_NAME = /^[0-9]{14}_[a-z0-9][a-z0-9_]*$/u;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export interface StagedReleaseCandidateBootstrapInput {
  id: string;
  goalId: string;
  version: number;
  dbSnapshotSha256: string;
  schemaSha256: string;
  migrationVersion: string;
}

export interface AppliedMigrationRow {
  migrationName: string;
  checksum: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}

export interface LocalMigrationArtifact {
  migrationName: string;
  checksum: string;
}

export interface StagedReleaseIdentityConflictKey {
  id: string;
  goalId: string;
  version: number;
  stagedIdentity: {
    commitSha: string;
    rosterHash: string;
    sourcePlanHash: string;
    sourceConfigHash: string;
    adapterBundleHash: string;
    sourceTreeHash: string;
    runtimeTreeHash: string;
    oracleVersion: typeof STAGED_SCHEDULE_ORACLE_VERSION;
    minimumStableCompanyCount: number;
  };
}

export interface StagedReleaseCandidateConflictRow {
  id: string;
  goalId: string;
  version: number;
}

export interface StagedReleaseCandidateCreateData {
  id: string;
  goalId: string;
  version: number;
  commitSha: string;
  dbSnapshotHash: string;
  schemaHash: string;
  migrationVersion: string;
  rosterHash: string;
  sourcePlanHash: string;
  sourceConfigHash: string;
  adapterBundleHash: string;
  sourceTreeHash: string;
  runtimeTreeHash: string;
  oracleVersion: typeof STAGED_SCHEDULE_ORACLE_VERSION;
  minimumStableCompanyCount: number;
  status: "BUILDING";
}

export interface PreparedReleaseCandidateRow {
  id: string;
  goalId: string;
  version: number;
  status: string;
  minimumStableCompanyCount: number;
}

export interface StagedReleaseCandidateBootstrapTransaction {
  listAppliedMigrations(): Promise<readonly AppliedMigrationRow[]>;
  findConflictingReleaseCandidates(
    key: StagedReleaseIdentityConflictKey
  ): Promise<readonly StagedReleaseCandidateConflictRow[]>;
  createReleaseCandidate(data: StagedReleaseCandidateCreateData): Promise<PreparedReleaseCandidateRow>;
}

export interface StagedReleaseCandidateBootstrapDeps {
  resolveBuildIdentity(): BuildIdentityArtifact;
  deriveScheduleExpectation(buildIdentity: BuildIdentityArtifact): StagedScheduleExpectation;
  listCurrentMigrations(): readonly LocalMigrationArtifact[];
  runSerializable<T>(
    operation: (transaction: StagedReleaseCandidateBootstrapTransaction) => Promise<T>
  ): Promise<T>;
}

export interface StagedReleaseCandidateBootstrapReport {
  schemaVersion: 1;
  operation: "prepare";
  releaseCandidateId: string;
  goalId: string;
  version: number;
  status: "BUILDING";
  commitSha: string;
  dbSnapshotSha256: string;
  schemaSha256: string;
  migrationVersion: string;
  migrationCount: number;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  sourceTreeSha256: string;
  runtimeTreeSha256: string;
  oracleVersion: typeof STAGED_SCHEDULE_ORACLE_VERSION;
  minimumStableCompanyCount: number;
}

export async function prepareStagedReleaseCandidate(
  input: StagedReleaseCandidateBootstrapInput,
  deps: StagedReleaseCandidateBootstrapDeps
): Promise<StagedReleaseCandidateBootstrapReport> {
  validatePrepareInput(input);
  const buildIdentity = deps.resolveBuildIdentity();
  const expectation = deps.deriveScheduleExpectation(buildIdentity);
  validateExpectationBinding(buildIdentity, expectation);
  const expectedMigrations = validateLocalMigrations(deps.listCurrentMigrations());
  if (input.migrationVersion !== expectedMigrations.at(-1)?.migrationName) {
    throw new Error("Prepare migration version is not the current Prisma migration version");
  }

  const stagedIdentity: StagedReleaseIdentityConflictKey["stagedIdentity"] = {
    commitSha: expectation.commitSha,
    rosterHash: expectation.rosterSha256,
    sourcePlanHash: expectation.sourcePlanSha256,
    sourceConfigHash: expectation.sourceConfigSha256,
    adapterBundleHash: expectation.adapterBundleSha256,
    sourceTreeHash: expectation.sourceTreeSha256,
    runtimeTreeHash: expectation.runtimeTreeSha256,
    oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION,
    minimumStableCompanyCount: expectation.minimumStableCompanyCount
  };
  const createData: StagedReleaseCandidateCreateData = {
    id: input.id,
    goalId: input.goalId,
    version: input.version,
    commitSha: stagedIdentity.commitSha,
    dbSnapshotHash: input.dbSnapshotSha256,
    schemaHash: input.schemaSha256,
    migrationVersion: input.migrationVersion,
    rosterHash: stagedIdentity.rosterHash,
    sourcePlanHash: stagedIdentity.sourcePlanHash,
    sourceConfigHash: stagedIdentity.sourceConfigHash,
    adapterBundleHash: stagedIdentity.adapterBundleHash,
    sourceTreeHash: stagedIdentity.sourceTreeHash,
    runtimeTreeHash: stagedIdentity.runtimeTreeHash,
    oracleVersion: stagedIdentity.oracleVersion,
    minimumStableCompanyCount: stagedIdentity.minimumStableCompanyCount,
    status: "BUILDING"
  };

  return deps.runSerializable(async (transaction) => {
    const appliedMigrations = await transaction.listAppliedMigrations();
    validateDatabaseMigrationHistory(appliedMigrations, expectedMigrations);

    const conflicts = await transaction.findConflictingReleaseCandidates({
      id: input.id,
      goalId: input.goalId,
      version: input.version,
      stagedIdentity
    });
    if (!Array.isArray(conflicts)) {
      throw new Error("Release candidate conflict audit returned an invalid result");
    }
    if (conflicts.length !== 0) {
      throw new Error("Release candidate id, goal-version, or staged identity conflict");
    }

    const created = await transaction.createReleaseCandidate(createData);
    if (
      created.id !== input.id ||
      created.goalId !== input.goalId ||
      created.version !== input.version ||
      created.status !== "BUILDING" ||
      created.minimumStableCompanyCount !== stagedIdentity.minimumStableCompanyCount
    ) {
      throw new Error("Created row does not match the requested BUILDING release candidate");
    }

    return Object.freeze({
      schemaVersion: 1 as const,
      operation: "prepare" as const,
      releaseCandidateId: input.id,
      goalId: input.goalId,
      version: input.version,
      status: "BUILDING" as const,
      commitSha: expectation.commitSha,
      dbSnapshotSha256: input.dbSnapshotSha256,
      schemaSha256: input.schemaSha256,
      migrationVersion: input.migrationVersion,
      migrationCount: expectedMigrations.length,
      rosterSha256: expectation.rosterSha256,
      sourcePlanSha256: expectation.sourcePlanSha256,
      sourceConfigSha256: expectation.sourceConfigSha256,
      adapterBundleSha256: expectation.adapterBundleSha256,
      sourceTreeSha256: expectation.sourceTreeSha256,
      runtimeTreeSha256: expectation.runtimeTreeSha256,
      oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION,
      minimumStableCompanyCount: expectation.minimumStableCompanyCount
    });
  });
}

function validatePrepareInput(input: StagedReleaseCandidateBootstrapInput): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Prepare input is invalid");
  }
  const actualKeys = Object.keys(input).sort(compareUtf8);
  if (JSON.stringify(actualKeys) !== JSON.stringify([...PREPARE_INPUT_KEYS])) {
    throw new Error("Prepare input must contain only the exact required fields");
  }
  if (typeof input.id !== "string" || !SAFE_IDENTIFIER.test(input.id)) {
    throw new Error("Prepare release candidate id is invalid");
  }
  if (typeof input.goalId !== "string" || !SAFE_IDENTIFIER.test(input.goalId)) {
    throw new Error("Prepare goal id is invalid");
  }
  if (
    !Number.isSafeInteger(input.version) ||
    input.version < 1 ||
    input.version > MAX_POSTGRES_INTEGER
  ) {
    throw new Error("Prepare version is invalid");
  }
  requireSha256(input.dbSnapshotSha256, "database snapshot");
  requireSha256(input.schemaSha256, "schema");
  if (typeof input.migrationVersion !== "string" || !MIGRATION_NAME.test(input.migrationVersion)) {
    throw new Error("Prepare migration version is invalid");
  }
}

function validateExpectationBinding(
  buildIdentity: BuildIdentityArtifact,
  expectation: StagedScheduleExpectation
): void {
  if (
    !COMMIT_SHA.test(buildIdentity.commitSha) ||
    !SHA256.test(buildIdentity.sourceTreeSha256) ||
    !SHA256.test(buildIdentity.runtimeTreeSha256) ||
    expectation.commitSha !== buildIdentity.commitSha ||
    expectation.sourceTreeSha256 !== buildIdentity.sourceTreeSha256 ||
    expectation.runtimeTreeSha256 !== buildIdentity.runtimeTreeSha256
  ) {
    throw new Error("Staged schedule expectation is not bound to the current build identity");
  }
  requireSha256(expectation.rosterSha256, "staged roster");
  requireSha256(expectation.sourcePlanSha256, "staged source plan");
  requireSha256(expectation.sourceConfigSha256, "staged source config");
  requireSha256(expectation.adapterBundleSha256, "staged adapter bundle");
  if (!Number.isSafeInteger(expectation.minimumStableCompanyCount) ||
      expectation.minimumStableCompanyCount < 1 || expectation.minimumStableCompanyCount > 60) {
    throw new Error("Staged schedule expectation minimum stable company count is invalid");
  }
}

function validateLocalMigrations(artifacts: readonly LocalMigrationArtifact[]): LocalMigrationArtifact[] {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("Current Prisma migration directory is empty or invalid");
  }
  const sorted = [...artifacts]
    .sort((left, right) => compareUtf8(left.migrationName, right.migrationName));
  if (
    new Set(sorted.map((artifact) => artifact.migrationName)).size !== sorted.length ||
    sorted.some((artifact) =>
      !MIGRATION_NAME.test(artifact.migrationName) || !SHA256.test(artifact.checksum)
    )
  ) {
    throw new Error("Current Prisma migration directory is invalid");
  }
  return sorted;
}

function validateDatabaseMigrationHistory(
  rows: readonly AppliedMigrationRow[],
  expectedMigrations: readonly LocalMigrationArtifact[]
): void {
  if (!Array.isArray(rows) || rows.length !== expectedMigrations.length) {
    throw new Error("Database migration history does not exactly match the current Prisma migration directory");
  }
  const ordered = [...rows].sort((left, right) => compareUtf8(left.migrationName, right.migrationName));
  if (
    new Set(ordered.map((row) => row.migrationName)).size !== ordered.length ||
    ordered.some((row) =>
      !MIGRATION_NAME.test(row.migrationName) ||
      !SHA256.test(row.checksum) ||
      !(row.finishedAt instanceof Date) ||
      !Number.isFinite(row.finishedAt.getTime()) ||
      row.rolledBackAt !== null
    ) ||
    ordered.some((row, index) =>
      row.migrationName !== expectedMigrations[index]?.migrationName ||
      row.checksum !== expectedMigrations[index]?.checksum
    )
  ) {
    throw new Error("Database migration history is incomplete, unfinished, rolled back, duplicated, or drifted");
  }
}

function requireSha256(value: string, label: string): void {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`Prepare ${label} SHA-256 is invalid`);
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
