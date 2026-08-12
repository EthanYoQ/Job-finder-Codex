import { readRestoreQualificationEvidence } from "../src/ops/restoreQualification";

const path = process.argv[2] ?? process.env.RESTORE_RECEIPT_PATH;
if (!path) throw new Error("RESTORE_RECEIPT_PATH is required");
const evidence = await readRestoreQualificationEvidence(path);
const verifiedAt = Date.parse(evidence.latestRestoreAt ?? "");
if (evidence.latestRestoreSucceeded !== true || !Number.isFinite(verifiedAt) ||
  Date.now() - verifiedAt > 8 * 24 * 60 * 60_000) process.exitCode = 1;
