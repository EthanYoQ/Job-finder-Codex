import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_MAX_CONTEXT_BYTES = 25 * 1024 * 1024;
const BUILD_INPUTS = [
  ".docker-build-provenance.bundle",
  ".dockerignore",
  "Dockerfile",
  "index.html",
  "ops",
  "package-lock.json",
  "package.json",
  "prisma",
  "scripts",
  "src",
  "testExecutionContract.ts",
  "tsconfig.json",
  "vite.config.ts"
];
const MAX_PROVENANCE_BUNDLE_BYTES = 20 * 1024 * 1024;

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
  const inputBytes = await measure(resolve(root, input));
  if (input === ".docker-build-provenance.bundle" && inputBytes > MAX_PROVENANCE_BUNDLE_BYTES) {
    throw new Error("Docker provenance bundle exceeds its 20 MiB guard");
  }
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
    let directoryBytes = 0;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      directoryBytes += await measure(resolve(path, entry.name));
    }
    return directoryBytes;
  }
  if (stat.isFile()) {
    totalBytes += stat.size;
    fileCount += 1;
    return stat.size;
  }
  return 0;
}
