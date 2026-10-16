import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createBrowserRuntimeQualificationReceipt } from "../src/security/browserRuntimeQualification";

const [rawPath, imageDigest, githubReleasePath, output] = process.argv.slice(2);
if (!rawPath || !imageDigest || !githubReleasePath || !output) {
  throw new Error("Usage: bind-browser-runtime-report <raw> <image-digest> <github-release-json> <output>");
}
const value = createBrowserRuntimeQualificationReceipt(
  await readFile(rawPath), await readFile(githubReleasePath), imageDigest
);
const absolute = resolve(output), temporary = `${absolute}.${process.pid}.tmp`;
await mkdir(dirname(absolute), { recursive: true });
await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, absolute);
