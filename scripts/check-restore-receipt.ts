import { readRestoreQualificationEvidence } from "../src/ops/restoreQualification";
import { listCurrentPrismaMigrations } from "../src/db/prismaMigrationManifest";

const path = process.argv[2] ?? process.env.RESTORE_RECEIPT_PATH;
if (!path) throw new Error("RESTORE_RECEIPT_PATH is required");
const evidence = await readRestoreQualificationEvidence(path, listCurrentPrismaMigrations(process.cwd()));
const verifiedAt = Date.parse(evidence.latestRestoreAt ?? "");
if (evidence.latestRestoreSucceeded !== true || !Number.isFinite(verifiedAt) ||
  verifiedAt > Date.now() + 5 * 60_000 || Date.now() - verifiedAt > 8 * 24 * 60 * 60_000) process.exitCode = 1;
