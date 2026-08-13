import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readImageQualificationReceipt } from "../src/release/launchReceiptFiles";

const [output, repository, manifestDigest, configDigest, revision, qualificationPath] = process.argv.slice(2);
if (!output || !repository || !manifestDigest || !configDigest || !revision || !qualificationPath) {
  throw new Error("Usage: write-deployment-image-receipt <output> <repository> <manifest-digest> <config-digest> <revision> <qualification-receipt>");
}
const qualificationBytes = await readFile(qualificationPath);
const qualification = await readImageQualificationReceipt(qualificationPath);
const qualificationContentSha256 = qualification.contentSha256;
if (repository !== "ghcr.io/ethanyoq/job-finder-rc022-cloud-acceptance" ||
    !/^sha256:[0-9a-f]{64}$/u.test(manifestDigest) || qualification.imageDigest !== configDigest ||
    qualification.revision !== revision || qualification.decision !== "PASSED") {
  throw new Error("Published image does not match the qualified config image");
}
const base = {
  schemaVersion: 1 as const,
  decision: "PASSED" as const,
  image: `${repository}@${manifestDigest}`,
  repository,
  manifestDigest,
  configDigest,
  revision,
  qualificationReceiptSha256: sha(qualificationBytes),
  qualificationContentSha256,
  publishedAt: new Date().toISOString()
};
const receipt = { ...base, contentSha256: sha(Buffer.from(JSON.stringify(base))) };
const absolute = resolve(output), temporary = `${absolute}.${process.pid}.tmp`;
await mkdir(dirname(absolute), { recursive: true });
await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, absolute);

function sha(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
