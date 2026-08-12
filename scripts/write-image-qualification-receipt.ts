import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [output, imageDigest, revision, buildIdentityPath, securityReceiptPath, restoreReceiptPath] = process.argv.slice(2);
if (!output || !imageDigest || !revision || !buildIdentityPath || !securityReceiptPath || !restoreReceiptPath) {
  throw new Error("Usage: write-image-qualification-receipt <output> <digest> <revision> <build-identity> <security-receipt> <restore-receipt>");
}
const buildIdentityBytes = await readFile(buildIdentityPath), security = JSON.parse(await readFile(securityReceiptPath, "utf8")),
  restore = JSON.parse(await readFile(restoreReceiptPath, "utf8"));
if (security.decision !== "PASSED" || security.imageDigest !== imageDigest || restore.decision !== "PASSED") {
  throw new Error("Passing security and restore receipts are required");
}
const base = { schemaVersion: 1 as const, decision: "PASSED" as const, imageDigest, revision,
  buildIdentitySha256: sha(buildIdentityBytes), securityReceiptSha256: security.contentSha256,
  restoreReceiptSha256: restore.contentSha256,
  evaluatedAt: new Date().toISOString(), gates: ["CLEAN_BUILD", "NON_ROOT", "SIZE_BUDGET", "LIVEZ",
    "EMPTY_DB_BOOTSTRAP", "READYZ_FAIL_CLOSED", "REAL_PG16_RESTORE", "PRODUCTION_SECURITY"] };
const value = { ...base, contentSha256: sha(Buffer.from(JSON.stringify(base))) };
const absolute = resolve(output), temporary = `${absolute}.${process.pid}.tmp`;
await mkdir(dirname(absolute), { recursive: true });
await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, absolute);
function sha(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
