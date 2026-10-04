import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { preflightExistingDatabase } from "../src/db/existingDatabasePreflight";
import { listCurrentPrismaMigrations } from "../src/db/prismaMigrationManifest";
import { bootstrapExistingDeployment, resolveDeploymentBootstrapConfig } from "../src/ops/deploymentBootstrap";

export async function runExistingDeploymentBootstrap(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = resolveDeploymentBootstrapConfig(env);
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  try {
    const report = await bootstrapExistingDeployment(config, {
      preflight: () => preflightExistingDatabase({
        databaseUrl: config.databaseUrl, expectedMigrations: listCurrentPrismaMigrations(process.cwd())
      }),
      transaction: (operation) => prisma.$transaction((transaction) => operation(transaction))
    });
    process.stdout.write(`${JSON.stringify({ ok: true, mode: "existing-database-only", ...report })}\n`);
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExistingDeploymentBootstrap().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Existing-database bootstrap failed"}\n`);
    process.exitCode = 1;
  });
}
