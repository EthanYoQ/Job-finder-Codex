import { describe, expect, it, vi } from "vitest";
import {
  prepareStagedReleaseCandidate,
  type AppliedMigrationRow,
  type LocalMigrationArtifact,
  type StagedReleaseCandidateBootstrapDeps,
  type StagedReleaseCandidateBootstrapInput,
  type StagedReleaseCandidateBootstrapTransaction
} from "../../src/readiness/stagedReleaseCandidateBootstrap";
import type { BuildIdentityArtifact } from "../../src/readiness/buildIdentity";
import type { StagedScheduleExpectation } from "../../src/crawler/stagedScheduleAuthority";

const COMMIT = "a".repeat(40);
const SOURCE_TREE = "1".repeat(64);
const RUNTIME_TREE = "2".repeat(64);
const DB_SNAPSHOT = "3".repeat(64);
const SCHEMA = "4".repeat(64);
const ROSTER = "5".repeat(64);
const SOURCE_PLAN = "6".repeat(64);
const SOURCE_CONFIG = "7".repeat(64);
const ADAPTER_BUNDLE = "8".repeat(64);
const MIGRATIONS = [
  "20260710000000_baseline",
  "20260714053000_repair_legacy_offline_count_two"
] as const;
const MIGRATION_CHECKSUMS = ["c".repeat(64), "d".repeat(64)] as const;

const BUILD_IDENTITY: BuildIdentityArtifact = {
  schemaVersion: 2,
  commitSha: COMMIT,
  sourceTreeSha256: SOURCE_TREE,
  runtimeTreeSha256: RUNTIME_TREE,
  contentSha256: "9".repeat(64)
};

const EXPECTATION: StagedScheduleExpectation = {
  companies: [],
  plans: [],
  commitSha: COMMIT,
  rosterSha256: ROSTER,
  sourcePlanSha256: SOURCE_PLAN,
  sourceConfigSha256: SOURCE_CONFIG,
  adapterBundleSha256: ADAPTER_BUNDLE,
  sourceTreeSha256: SOURCE_TREE,
  runtimeTreeSha256: RUNTIME_TREE,
  plannedSourceIds: ["source-1"],
  plannedSourceSetSha256: "b".repeat(64),
  plannedSourceCount: 1
};

function input(): StagedReleaseCandidateBootstrapInput {
  return {
    id: "p0-rc-20260715-010",
    goalId: "019f61fb-b783-7913-82ab-0a3531cdd7b4",
    version: 10,
    dbSnapshotSha256: DB_SNAPSHOT,
    schemaSha256: SCHEMA,
    migrationVersion: MIGRATIONS.at(-1)!
  };
}

function appliedMigrations(names: readonly string[] = MIGRATIONS): AppliedMigrationRow[] {
  return names.map((migrationName, index) => ({
    migrationName,
    checksum: MIGRATION_CHECKSUMS[index] ?? "e".repeat(64),
    finishedAt: new Date("2026-07-15T00:00:00.000Z"),
    rolledBackAt: null
  }));
}

function localMigrations(): LocalMigrationArtifact[] {
  return MIGRATIONS.map((migrationName, index) => ({
    migrationName,
    checksum: MIGRATION_CHECKSUMS[index]!
  }));
}

function fixture(overrides: Partial<StagedReleaseCandidateBootstrapTransaction> = {}) {
  const events: string[] = [];
  const create = vi.fn(async (data) => {
    events.push("create");
    return { id: data.id, goalId: data.goalId, version: data.version, status: data.status };
  });
  const transaction: StagedReleaseCandidateBootstrapTransaction = {
    listAppliedMigrations: vi.fn(async () => {
      events.push("migration-history");
      return appliedMigrations();
    }),
    findConflictingReleaseCandidates: vi.fn(async () => {
      events.push("conflicts");
      return [];
    }),
    createReleaseCandidate: create,
    ...overrides
  };
  const deps: StagedReleaseCandidateBootstrapDeps = {
    resolveBuildIdentity: vi.fn(() => {
      events.push("resolve-build");
      return BUILD_IDENTITY;
    }),
    deriveScheduleExpectation: vi.fn((buildIdentity) => {
      events.push("derive-schedule");
      expect(buildIdentity).toBe(BUILD_IDENTITY);
      return EXPECTATION;
    }),
    listCurrentMigrations: vi.fn(() => {
      events.push("local-migrations");
      return localMigrations();
    }),
    runSerializable: vi.fn(async (operation) => {
      events.push("serializable");
      return operation(transaction);
    })
  };
  return { deps, transaction, create, events };
}

describe("staged ReleaseCandidate bootstrap", () => {
  it("derives the exact staged identity and creates BUILDING only after migration and conflict checks", async () => {
    const { deps, create, events } = fixture();

    const result = await prepareStagedReleaseCandidate(input(), deps);

    expect(events).toEqual([
      "resolve-build",
      "derive-schedule",
      "local-migrations",
      "serializable",
      "migration-history",
      "conflicts",
      "create"
    ]);
    expect(deps.runSerializable).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      id: "p0-rc-20260715-010",
      goalId: "019f61fb-b783-7913-82ab-0a3531cdd7b4",
      version: 10,
      commitSha: COMMIT,
      dbSnapshotHash: DB_SNAPSHOT,
      schemaHash: SCHEMA,
      migrationVersion: MIGRATIONS.at(-1),
      rosterHash: ROSTER,
      sourcePlanHash: SOURCE_PLAN,
      sourceConfigHash: SOURCE_CONFIG,
      adapterBundleHash: ADAPTER_BUNDLE,
      sourceTreeHash: SOURCE_TREE,
      runtimeTreeHash: RUNTIME_TREE,
      oracleVersion: "staged-official-source-v1",
      status: "BUILDING"
    });
    expect(result).toEqual({
      schemaVersion: 1,
      operation: "prepare",
      releaseCandidateId: "p0-rc-20260715-010",
      goalId: "019f61fb-b783-7913-82ab-0a3531cdd7b4",
      version: 10,
      status: "BUILDING",
      commitSha: COMMIT,
      dbSnapshotSha256: DB_SNAPSHOT,
      schemaSha256: SCHEMA,
      migrationVersion: MIGRATIONS.at(-1),
      migrationCount: 2,
      rosterSha256: ROSTER,
      sourcePlanSha256: SOURCE_PLAN,
      sourceConfigSha256: SOURCE_CONFIG,
      adapterBundleSha256: ADAPTER_BUNDLE,
      sourceTreeSha256: SOURCE_TREE,
      runtimeTreeSha256: RUNTIME_TREE,
      oracleVersion: "staged-official-source-v1"
    });
  });

  it.each([
    ["missing", appliedMigrations([MIGRATIONS[0]])],
    ["extra", appliedMigrations([...MIGRATIONS, "20260715000000_unreviewed"])],
    ["unfinished", [{ ...appliedMigrations()[0]!, finishedAt: null }, appliedMigrations()[1]!]],
    ["rolled back", [{ ...appliedMigrations()[0]!, rolledBackAt: new Date("2026-07-15T01:00:00Z") }, appliedMigrations()[1]!]],
    ["checksum drift", [{ ...appliedMigrations()[0]!, checksum: "f".repeat(64) }, appliedMigrations()[1]!]],
    ["duplicate", [...appliedMigrations(), appliedMigrations()[0]!]]
  ])("fails closed for %s database migration history before conflict checks", async (_label, rows) => {
    const transaction: Partial<StagedReleaseCandidateBootstrapTransaction> = {
      listAppliedMigrations: vi.fn(async () => rows)
    };
    const { deps, create } = fixture(transaction);

    await expect(prepareStagedReleaseCandidate(input(), deps)).rejects.toThrow(/migration history/i);

    expect(create).not.toHaveBeenCalled();
  });

  it("rejects id, goal-version, or staged-identity conflicts instead of treating a repeat as success", async () => {
    const stored: Array<{ id: string; goalId: string; version: number }> = [];
    const findConflictingReleaseCandidates = vi.fn(async () => stored);
    const createReleaseCandidate = vi.fn(async (data) => {
      stored.push({ id: data.id, goalId: data.goalId, version: data.version });
      return { id: data.id, goalId: data.goalId, version: data.version, status: data.status };
    });
    const { deps } = fixture({ findConflictingReleaseCandidates, createReleaseCandidate });

    await expect(prepareStagedReleaseCandidate(input(), deps)).resolves.toMatchObject({ status: "BUILDING" });
    await expect(prepareStagedReleaseCandidate(input(), deps)).rejects.toThrow(/conflict/i);

    expect(findConflictingReleaseCandidates).toHaveBeenCalledTimes(2);
    expect(createReleaseCandidate).toHaveBeenCalledTimes(1);
  });

  it("passes all three conflict predicates into the serializable transaction", async () => {
    const findConflictingReleaseCandidates = vi.fn(async () => [{
      id: "other-id",
      goalId: "other-goal",
      version: 99
    }]);
    const { deps, create } = fixture({ findConflictingReleaseCandidates });

    await expect(prepareStagedReleaseCandidate(input(), deps)).rejects.toThrow(/conflict/i);

    expect(findConflictingReleaseCandidates).toHaveBeenCalledWith({
      id: input().id,
      goalId: input().goalId,
      version: input().version,
      stagedIdentity: {
        commitSha: COMMIT,
        rosterHash: ROSTER,
        sourcePlanHash: SOURCE_PLAN,
        sourceConfigHash: SOURCE_CONFIG,
        adapterBundleHash: ADAPTER_BUNDLE,
        sourceTreeHash: SOURCE_TREE,
        runtimeTreeHash: RUNTIME_TREE,
        oracleVersion: "staged-official-source-v1"
      }
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ["blank id", { ...input(), id: " " }],
    ["non-string id", { ...input(), id: 1 as unknown as string }],
    ["unsafe goal id", { ...input(), goalId: "goal secret" }],
    ["zero version", { ...input(), version: 0 }],
    ["fractional version", { ...input(), version: 1.5 }],
    ["uppercase snapshot digest", { ...input(), dbSnapshotSha256: "A".repeat(64) }],
    ["short schema digest", { ...input(), schemaSha256: "4".repeat(63) }],
    ["non-current migration version", { ...input(), migrationVersion: MIGRATIONS[0] }]
  ])("rejects invalid prepare input: %s", async (_label, invalidInput) => {
    const { deps } = fixture();

    await expect(prepareStagedReleaseCandidate(invalidInput, deps)).rejects.toThrow();

    if (_label !== "non-current migration version") {
      expect(deps.resolveBuildIdentity).not.toHaveBeenCalled();
      expect(deps.runSerializable).not.toHaveBeenCalled();
    }
  });

  it("rejects a derived expectation that is not bound to the resolved build", async () => {
    const { deps } = fixture();
    deps.deriveScheduleExpectation = vi.fn(() => ({
      ...EXPECTATION,
      runtimeTreeSha256: "f".repeat(64)
    }));

    await expect(prepareStagedReleaseCandidate(input(), deps)).rejects.toThrow(/build identity/i);

    expect(deps.runSerializable).not.toHaveBeenCalled();
  });

  it("rejects a create response that does not echo the requested immutable key and BUILDING status", async () => {
    const { deps } = fixture({
      createReleaseCandidate: vi.fn(async () => ({
        id: "wrong-id",
        goalId: input().goalId,
        version: input().version,
        status: "BUILDING"
      }))
    });

    await expect(prepareStagedReleaseCandidate(input(), deps)).rejects.toThrow(/created row/i);
  });
});
