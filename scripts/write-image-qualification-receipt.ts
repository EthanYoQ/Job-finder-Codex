import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { listCurrentPrismaMigrations } from "../src/db/prismaMigrationManifest";
import { readPassedRestoreQualificationReceipt } from "../src/ops/restoreQualification";
import { REQUIRED_IMAGE_QUALIFICATION_GATES } from "../src/release/launchReceiptFiles";
import { readProductionSecurityReceipt } from "../src/security/productionSecurityGate";

const [output, imageDigest, revision, buildIdentityPath, securityReceiptPath, restoreReceiptPath] = process.argv.slice(2);
if (!output || !imageDigest || !revision || !buildIdentityPath || !securityReceiptPath || !restoreReceiptPath) {
  throw new Error("Usage: write-image-qualification-receipt <output> <digest> <revision> <build-identity> <security-receipt> <restore-receipt>");
}
const buildIdentityBytes = await readFile(buildIdentityPath), buildIdentity = JSON.parse(buildIdentityBytes.toString("utf8")) as Record<string, unknown>;
const [security, restore] = await Promise.all([
  readProductionSecurityReceipt(securityReceiptPath),
  readPassedRestoreQualificationReceipt(restoreReceiptPath, listCurrentPrismaMigrations(process.cwd()))
]);
const { contentSha256: buildContentSha256, ...buildBase } = buildIdentity;
if (security.decision !== "PASSED" || security.imageDigest !== imageDigest || restore.decision !== "PASSED" ||
    buildIdentity.schemaVersion !== 2 || buildIdentity.commitSha !== revision ||
    typeof buildContentSha256 !== "string" || buildContentSha256 !== sha(Buffer.from(JSON.stringify(buildBase)))) {
  throw new Error("Passing security and restore receipts are required");
}
const base = { schemaVersion: 1 as const, decision: "PASSED" as const, imageDigest, revision,
  buildIdentitySha256: sha(buildIdentityBytes), buildIdentityContentSha256: buildContentSha256,
  securityReceiptSha256: security.contentSha256,
  restoreReceiptSha256: restore.contentSha256,
  evaluatedAt: new Date().toISOString(), gates: REQUIRED_IMAGE_QUALIFICATION_GATES };
const value = { ...base, contentSha256: sha(Buffer.from(JSON.stringify(base))) };
const absolute = resolve(output), temporary = `${absolute}.${process.pid}.tmp`;
await mkdir(dirname(absolute), { recursive: true });
await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, absolute);
function sha(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
