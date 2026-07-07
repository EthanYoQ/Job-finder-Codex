import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public";

const command = process.platform === "win32" ? "cmd.exe" : "npm";
const args =
  process.platform === "win32"
    ? ["/d", "/c", "npm exec -- prisma validate --schema prisma/schema.prisma"]
    : ["exec", "--", "prisma", "validate", "--schema", "prisma/schema.prisma"];

const result = spawnSync(command, args, {
  cwd: projectRoot,
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl
  },
  stdio: "inherit"
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
