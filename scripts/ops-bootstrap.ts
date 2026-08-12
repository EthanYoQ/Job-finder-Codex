import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { bootstrapDeployment, resolveDeploymentBootstrapConfig } from "../src/ops/deploymentBootstrap";

export async function runDeploymentBootstrap(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = resolveDeploymentBootstrapConfig(env);
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  try {
    const report = await bootstrapDeployment(config, {
      migrate: async () => {
        const result = spawnSync(process.execPath, [
          resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", "prisma/schema.prisma"
        ], { env: { ...process.env, DATABASE_URL: config.databaseUrl }, stdio: "inherit", shell: false });
        if (result.status !== 0) throw new Error("Database migration failed");
      },
      db: prisma,
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
