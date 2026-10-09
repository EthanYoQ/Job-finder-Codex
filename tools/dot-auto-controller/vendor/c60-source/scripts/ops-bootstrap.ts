import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { assertMigrationReplaySupported } from "../src/db/existingDatabasePreflight";
import { listCurrentPrismaMigrations } from "../src/db/prismaMigrationManifest";
import { bootstrapDeployment, resolveDeploymentBootstrapConfig } from "../src/ops/deploymentBootstrap";

interface MigrationProcessFailure {
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string | Buffer | null;
  error?: Error;
}

function sanitizeMigrationDiagnostic(value: string, databaseUrl: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]")
    .replace(/(postgres(?:ql)?:\/\/)[^\s'"]+/giu, "$1[REDACTED_URI]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 2_000);
}

export function formatMigrationProcessFailure(
  result: MigrationProcessFailure,
  databaseUrl: string
): string {
  const errorCode = result.error && "code" in result.error
    ? String((result.error as NodeJS.ErrnoException).code ?? "unknown")
    : "none";
  const stderr = sanitizeMigrationDiagnostic(
    typeof result.stderr === "string" ? result.stderr : result.stderr?.toString("utf8") ?? "",
    databaseUrl
  );
  const detail = stderr === "" ? "no stderr" : stderr;
  return `Database migration failed (status=${result.status ?? "null"}, signal=${result.signal ?? "none"}, error=${errorCode}): ${detail}`;
}

export function runDeploymentMigrations(
  databaseUrl: string,
  projectRoot = process.cwd(),
  spawnCommand: (executable: string, args: string[], options: {
    cwd: string; env: NodeJS.ProcessEnv; encoding: "utf8"; shell: false;
    windowsHide: true; timeout: number; maxBuffer: number;
  }) => MigrationProcessFailure = spawnSync
): void {
  assertMigrationReplaySupported(listCurrentPrismaMigrations(projectRoot).map((entry) => entry.migrationName));
  const result = spawnCommand(process.execPath, [
    resolve(projectRoot, "node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", "prisma/schema.prisma"
  ], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8", shell: false, windowsHide: true,
    timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024
  });
  if (result.status !== 0 || result.error) throw new Error(formatMigrationProcessFailure(result, databaseUrl));
}

export async function runDeploymentBootstrap(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = resolveDeploymentBootstrapConfig(env);
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  try {
    const report = await bootstrapDeployment(config, {
      migrate: async () => { runDeploymentMigrations(config.databaseUrl); },
      transaction: (operation) => prisma.$transaction((transaction) => operation(transaction))
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDeploymentBootstrap().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Deployment bootstrap failed"}\n`);
    process.exitCode = 1;
  });
}
