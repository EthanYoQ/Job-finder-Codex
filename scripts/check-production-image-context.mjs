import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_MAX_CONTEXT_BYTES = 25 * 1024 * 1024;
const BUILD_INPUTS = [
  ".dockerignore",
  "Dockerfile",
  "index.html",
  "ops",
  "package-lock.json",
  "package.json",
  "prisma",
  "scripts",
  "src",
  "tsconfig.json",
  "vite.config.ts"
];

const configuredLimit = Number(
  process.env.PRODUCTION_IMAGE_MAX_CONTEXT_BYTES ?? DEFAULT_MAX_CONTEXT_BYTES
);
if (!Number.isSafeInteger(configuredLimit) || configuredLimit < 1) {
  throw new Error("PRODUCTION_IMAGE_MAX_CONTEXT_BYTES must be a positive safe integer");
}

const root = process.cwd();
let totalBytes = 0;
let fileCount = 0;

for (const input of BUILD_INPUTS) {
  await measure(resolve(root, input));
}

const result = {
  ok: totalBytes <= configuredLimit,
  fileCount,
  totalBytes,
  maxBytes: configuredLimit
};
console.log(JSON.stringify(result));
if (!result.ok) process.exitCode = 1;

async function measure(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Production image context must not contain symlinks: ${path}`);
  }
  if (stat.isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      await measure(resolve(path, entry.name));
    }
    return;
  }
  if (stat.isFile()) {
    totalBytes += stat.size;
    fileCount += 1;
  }
}
