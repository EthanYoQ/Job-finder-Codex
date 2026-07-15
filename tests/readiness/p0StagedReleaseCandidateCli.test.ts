import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createPrismaStagedReleaseCandidateBootstrapDeps,
  listCurrentPrismaMigrations,
  runStagedReleaseCandidateCommand
} from "../../scripts/p0-staged-release-candidate";
import type {
  StagedReleaseCandidateBootstrapInput,
  StagedReleaseCandidateBootstrapReport
} from "../../src/readiness/stagedReleaseCandidateBootstrap";

const SHA = "a".repeat(64);

function args(): string[] {
  return [
    "prepare",
    "--id", "p0-rc-20260715-010",
    "--goal-id", "019f61fb-b783-7913-82ab-0a3531cdd7b4",
    "--version", "10",
    "--db-snapshot-sha256", SHA,
    "--schema-sha256", "b".repeat(64),
    "--migration-version", "20260714053000_repair_legacy_offline_count_two"
  ];
}

function report(): StagedReleaseCandidateBootstrapReport {
  return {
    schemaVersion: 1,
    operation: "prepare",
    releaseCandidateId: "p0-rc-20260715-010",
    goalId: "019f61fb-b783-7913-82ab-0a3531cdd7b4",
    version: 10,
    status: "BUILDING",
    commitSha: "c".repeat(40),
    dbSnapshotSha256: SHA,
    schemaSha256: "b".repeat(64),
    migrationVersion: "20260714053000_repair_legacy_offline_count_two",
    migrationCount: 20,
    rosterSha256: "d".repeat(64),
    sourcePlanSha256: "e".repeat(64),
    sourceConfigSha256: "f".repeat(64),
    adapterBundleSha256: "1".repeat(64),
    sourceTreeSha256: "2".repeat(64),
    runtimeTreeSha256: "3".repeat(64),
    oracleVersion: "staged-official-source-v1"
  };
}

describe("staged ReleaseCandidate prepare CLI", () => {
  it("accepts only the exact prepare option set and writes one JSON success document", async () => {
    const prepare = vi.fn(async (_input: StagedReleaseCandidateBootstrapInput) => report());
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runStagedReleaseCandidateCommand(args(), {
      prepare,
      writeStdout: (line) => stdout.push(line),
      writeStderr: (line) => stderr.push(line)
    });

    expect(result).toEqual({ exitCode: 0 });
    expect(prepare).toHaveBeenCalledWith({
      id: "p0-rc-20260715-010",
      goalId: "019f61fb-b783-7913-82ab-0a3531cdd7b4",
      version: 10,
      dbSnapshotSha256: SHA,
      schemaSha256: "b".repeat(64),
      migrationVersion: "20260714053000_repair_legacy_offline_count_two"
    });
    expect(stdout).toEqual([JSON.stringify({ ok: true, ...report() })]);
    expect(stderr).toEqual([]);
  });

  it.each([
    { invalidArgs: [] },
    { invalidArgs: ["status"] },
    { invalidArgs: args().slice(0, -2) },
    { invalidArgs: [...args(), "--unknown", "value"] },
    { invalidArgs: [...args(), "--id", "duplicate"] },
    { invalidArgs: args().map((value) => value === "--id" ? "toString" : value) },
    { invalidArgs: args().filter((value) => value !== "--goal-id") },
    { invalidArgs: ["prepare", "--id", "--goal-id", "goal"] }
  ])("rejects an incomplete, duplicate, or unknown argument vector", async ({ invalidArgs }) => {
    const prepare = vi.fn();
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runStagedReleaseCandidateCommand(invalidArgs, {
      prepare,
      writeStdout: (line) => stdout.push(line),
      writeStderr: (line) => stderr.push(line)
    });

    expect(result).toEqual({ exitCode: 2 });
    expect(prepare).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(JSON.parse(stderr[0]!)).toEqual({
      ok: false,
      code: "INVALID_PREPARE_ARGUMENTS",
      usage: "prepare --id <id> --goal-id <goal-id> --version <positive-integer> --db-snapshot-sha256 <sha256> --schema-sha256 <sha256> --migration-version <version>"
    });
  });

  it("returns only a stable non-sensitive JSON error when prepare fails", async () => {
    const secret = "postgresql://admin:super-secret@production/jobfinder";
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await runStagedReleaseCandidateCommand(args(), {
      prepare: async () => { throw new Error(secret); },
      writeStdout: (line) => stdout.push(line),
      writeStderr: (line) => stderr.push(line)
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([JSON.stringify({ ok: false, code: "STAGED_RELEASE_CANDIDATE_PREPARE_FAILED" })]);
    expect(stderr.join("\n")).not.toContain(secret);
  });

  it("uses a Serializable Prisma transaction and exact three-way conflict query", async () => {
    const raw = vi.fn(async (_query: unknown) => []);
    const findMany = vi.fn(async () => []);
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: data.id,
      goalId: data.goalId,
      version: data.version,
      status: data.status
    }));
    const transaction = {
      $queryRaw: raw,
      releaseCandidate: { findMany, create }
    };
    const $transaction = vi.fn(async (operation, options) => operation(transaction, options));
    const deps = createPrismaStagedReleaseCandidateBootstrapDeps({ $transaction } as never, process.cwd());

    await deps.runSerializable(async (tx) => {
      await tx.listAppliedMigrations();
      await tx.findConflictingReleaseCandidates({
        id: "rc-1",
        goalId: "goal-1",
        version: 1,
        stagedIdentity: {
          commitSha: "c".repeat(40),
          rosterHash: "1".repeat(64),
          sourcePlanHash: "2".repeat(64),
          sourceConfigHash: "3".repeat(64),
          adapterBundleHash: "4".repeat(64),
          sourceTreeHash: "5".repeat(64),
          runtimeTreeHash: "6".repeat(64),
          oracleVersion: "staged-official-source-v1"
        }
      });
    });

    expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 30_000
    });
    expect(raw).toHaveBeenCalledTimes(1);
    const migrationQuery = raw.mock.calls[0]![0] as { strings: readonly string[] };
    expect(migrationQuery.strings.join(" ")).toContain('"checksum" AS "checksum"');
    expect(findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { id: "rc-1" },
          { goalId: "goal-1", version: 1 },
          {
            commitSha: "c".repeat(40),
            rosterHash: "1".repeat(64),
            sourcePlanHash: "2".repeat(64),
            sourceConfigHash: "3".repeat(64),
            adapterBundleHash: "4".repeat(64),
            sourceTreeHash: "5".repeat(64),
            runtimeTreeHash: "6".repeat(64),
            oracleVersion: "staged-official-source-v1"
          }
        ]
      },
      select: { id: true, goalId: true, version: true },
      take: 1
    });
  });

  it("binds every local migration name to the SHA-256 of its migration.sql", () => {
    const migrationRoot = resolve(process.cwd(), "prisma", "migrations");
    const expectedNames = readdirSync(migrationRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const migrations = listCurrentPrismaMigrations(process.cwd());

    expect(migrations.map((migration) => migration.migrationName)).toEqual(expectedNames);
    for (const migration of migrations) {
      const migrationSql = readFileSync(resolve(migrationRoot, migration.migrationName, "migration.sql"));
      expect(migration.checksum).toBe(createHash("sha256").update(migrationSql).digest("hex"));
    }
  });

  it("exposes the guarded package script", () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["p0:staged-release-candidate"])
      .toBe("tsx scripts/p0-staged-release-candidate.ts");
  });
});
