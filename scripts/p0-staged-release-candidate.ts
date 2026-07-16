import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  prepareStagedReleaseCandidate,
  type AppliedMigrationRow,
  type LocalMigrationArtifact,
  type StagedReleaseCandidateBootstrapDeps,
  type StagedReleaseCandidateBootstrapInput,
  type StagedReleaseCandidateBootstrapReport,
  type StagedReleaseCandidateBootstrapTransaction
} from "../src/readiness/stagedReleaseCandidateBootstrap";
import { resolveCurrentBuildIdentity } from "../src/readiness/buildIdentity";
import { deriveCurrentStagedScheduleExpectation } from "../src/crawler/stagedScheduleAuthority";

const USAGE = "prepare --id <id> --goal-id <goal-id> --version <positive-integer> --db-snapshot-sha256 <sha256> --schema-sha256 <sha256> --migration-version <version>";
const OPTION_FIELDS = {
  "--id": "id",
  "--goal-id": "goalId",
  "--version": "version",
  "--db-snapshot-sha256": "dbSnapshotSha256",
  "--schema-sha256": "schemaSha256",
  "--migration-version": "migrationVersion"
} as const;
const MIGRATION_NAME = /^[0-9]{14}_[a-z0-9][a-z0-9_]*$/u;

export interface StagedReleaseCandidateCommandDeps {
  prepare(input: StagedReleaseCandidateBootstrapInput): Promise<StagedReleaseCandidateBootstrapReport>;
  writeStdout(line: string): void;
  writeStderr(line: string): void;
}

export interface StagedReleaseCandidateCommandResult {
  exitCode: number;
}

export async function runStagedReleaseCandidateCommand(
  args: readonly string[],
  deps: StagedReleaseCandidateCommandDeps
): Promise<StagedReleaseCandidateCommandResult> {
  const input = parsePrepareArguments(args);
  if (input === null) {
    deps.writeStderr(JSON.stringify({ ok: false, code: "INVALID_PREPARE_ARGUMENTS", usage: USAGE }));
    return { exitCode: 2 };
  }
  try {
    const report = await deps.prepare(input);
    deps.writeStdout(JSON.stringify({ ok: true, ...report }));
    return { exitCode: 0 };
  } catch {
    deps.writeStderr(JSON.stringify({ ok: false, code: "STAGED_RELEASE_CANDIDATE_PREPARE_FAILED" }));
    return { exitCode: 1 };
  }
}

export function createPrismaStagedReleaseCandidateBootstrapDeps(
  prisma: PrismaClient,
  projectRoot: string
): StagedReleaseCandidateBootstrapDeps {
  return {
    resolveBuildIdentity: resolveCurrentBuildIdentity,
    deriveScheduleExpectation: deriveCurrentStagedScheduleExpectation,
    listCurrentMigrations: () => listCurrentPrismaMigrations(projectRoot),
    runSerializable: (operation) => prisma.$transaction(
      (transaction) => operation(prismaTransactionAdapter(transaction)),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000
      }
    )
  };
}

export function listCurrentPrismaMigrations(projectRoot: string): LocalMigrationArtifact[] {
  const migrationRoot = resolve(projectRoot, "prisma", "migrations");
  let entries;
  try {
    entries = readdirSync(migrationRoot, { withFileTypes: true });
  } catch {
    throw new Error("Current Prisma migration directory is unavailable");
  }
  const migrations: LocalMigrationArtifact[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!MIGRATION_NAME.test(entry.name)) {
        throw new Error("Current Prisma migration directory contains an invalid directory");
      }
      const migrationSql = resolve(migrationRoot, entry.name, "migration.sql");
      let isRegularFile = false;
      try {
        const stat = lstatSync(migrationSql);
        isRegularFile = stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
      } catch {
        isRegularFile = false;
      }
      if (!isRegularFile) {
        throw new Error("Current Prisma migration directory contains an invalid migration artifact");
      }
      migrations.push({
        migrationName: entry.name,
        checksum: createHash("sha256").update(readFileSync(migrationSql)).digest("hex")
      });
      continue;
    }
    if (!entry.isFile() || entry.name !== "migration_lock.toml") {
      throw new Error("Current Prisma migration directory contains an unexpected entry");
    }
  }
  return migrations.sort((left, right) => compareUtf8(left.migrationName, right.migrationName));
}

function prismaTransactionAdapter(
  transaction: Prisma.TransactionClient
): StagedReleaseCandidateBootstrapTransaction {
  return {
    listAppliedMigrations: () => transaction.$queryRaw<AppliedMigrationRow[]>(Prisma.sql`
      SELECT
        "migration_name" AS "migrationName",
        "checksum" AS "checksum",
        "finished_at" AS "finishedAt",
        "rolled_back_at" AS "rolledBackAt"
      FROM public."_prisma_migrations"
      ORDER BY "migration_name" COLLATE "C", "id" COLLATE "C"
    `),
    findConflictingReleaseCandidates: (key) => transaction.releaseCandidate.findMany({
      where: {
        OR: [
          { id: key.id },
          { goalId: key.goalId, version: key.version },
          { ...key.stagedIdentity }
        ]
      },
      select: { id: true, goalId: true, version: true },
      take: 1
    }),
    createReleaseCandidate: (data) => transaction.releaseCandidate.create({
      data,
      select: {
        id: true,
        goalId: true,
        version: true,
        status: true,
        minimumStableCompanyCount: true
      }
    })
  };
}

function parsePrepareArguments(args: readonly string[]): StagedReleaseCandidateBootstrapInput | null {
  if (args.length !== 13 || args[0] !== "prepare") return null;
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (
      option === undefined ||
      !Object.hasOwn(OPTION_FIELDS, option) ||
      value === undefined ||
      value.length === 0 ||
      value.startsWith("--") ||
      values.has(option)
    ) {
      return null;
    }
    values.set(option, value);
  }
  if (values.size !== Object.keys(OPTION_FIELDS).length) return null;
  const versionValue = values.get("--version");
  if (versionValue === undefined || !/^[1-9][0-9]*$/u.test(versionValue)) return null;
  const version = Number(versionValue);
  if (!Number.isSafeInteger(version) || version > 2_147_483_647) return null;
  return {
    id: values.get("--id")!,
    goalId: values.get("--goal-id")!,
    version,
    dbSnapshotSha256: values.get("--db-snapshot-sha256")!,
    schemaSha256: values.get("--schema-sha256")!,
    migrationVersion: values.get("--migration-version")!
  };
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const bootstrapDeps = createPrismaStagedReleaseCandidateBootstrapDeps(prisma, process.cwd());
    const result = await runStagedReleaseCandidateCommand(process.argv.slice(2), {
      prepare: (input) => prepareStagedReleaseCandidate(input, bootstrapDeps),
      writeStdout: console.log,
      writeStderr: console.error
    });
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error(JSON.stringify({ ok: false, code: "STAGED_RELEASE_CANDIDATE_PREPARE_FAILED" }));
    process.exitCode = 1;
  });
}
