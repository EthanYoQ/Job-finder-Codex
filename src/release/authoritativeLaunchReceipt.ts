import { createHash } from "node:crypto";
import { verifyAGradeCompletenessCertificateReceipt } from "../crawler/completenessCertificate";
import { verifyBGradeTraversalCertificateReceipt } from "../crawler/traversalCertificate";
import {
  P0_LAUNCH_MANIFEST,
  launchManifestIdentity,
  validateLaunchManifest,
  type LaunchManifest
} from "./launchManifest";

export interface LaunchCertificateEvidence {
  sourceResultId: string;
  companyId: string;
  sourceId: string;
  category: "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
  grade: "A" | "B" | "C";
  sourceConfigSha256: string;
  canonicalJobSetSha256: string;
  certificate: unknown | null;
  certificateSha256: string | null;
}

export interface LaunchBatchEvidence {
  id: string;
  releaseCandidateId: string;
  commitSha: string;
  rosterSha256: string;
  sourcePlanSha256: string;
  sourceConfigSha256: string;
  adapterBundleSha256: string;
  status: string;
  finishedAt: string;
  certificates: readonly LaunchCertificateEvidence[];
}

export interface AuthoritativeLaunchEvidence {
  evaluatedAt: Date;
  manifest: LaunchManifest;
  source: { commitSha: string; sourceTreeSha256: string; runtimeTreeSha256: string; buildIdentityContentSha256: string };
  image: { digest: string; revision: string; qualificationSha256: string; buildIdentityContentSha256: string;
    securityReceiptSha256: string; restoreReceiptSha256: string };
  database: { snapshotSha256: string; schemaSha256: string; migrationVersion: string;
    migrationManifestSha256: string; bootstrapReady: boolean };
  security: { decision: string; contentSha256: string; imageDigest: string; evaluatedAt: string };
  restore: { decision: string; contentSha256: string; verifiedAt: string; archiveSha256: string };
  formalQualification: {
    roundOneBatchId: string;
    roundTwoBatchId: string;
    roundOneStateReceiptSha256: string;
    roundOneAuditSha256: string;
    roundOneEvidenceArchiveSha256: string;
    roundOneDatabaseArchiveSha256: string;
    roundTwoAuditSha256: string;
    roundTwoEvidenceArchiveSha256: string;
  };
  releaseIdentity: {
    releaseCandidateId: string;
    commitSha: string;
    rosterSha256: string;
    sourcePlanSha256: string;
    sourceConfigSha256: string;
    adapterBundleSha256: string;
  };
  batches: readonly LaunchBatchEvidence[];
  operationalGates: readonly { name: string; passed: boolean; evidenceSha256: string; reason: string }[];
}

export interface AuthoritativeLaunchReceipt {
  schemaVersion: 2;
  decision: "READY" | "NOT_READY";
  evaluatedAt: string;
  identity: {
    commitSha: string; sourceTreeSha256: string; runtimeTreeSha256: string;
    imageDigest: string; imageQualificationSha256: string;
    manifestSha256: string; companySetSha256: string; sourceIdentitySha256: string;
    sourceConfigSha256: string; adapterBundleSha256: string;
    databaseSnapshotSha256: string; schemaSha256: string; migrationVersion: string;
    securityReceiptSha256: string; restoreReceiptSha256: string;
    roundOneStateReceiptSha256: string; roundOneAuditSha256: string;
    roundOneEvidenceArchiveSha256: string; roundOneDatabaseArchiveSha256: string;
    roundTwoAuditSha256: string; roundTwoEvidenceArchiveSha256: string;
  };
  gates: readonly { name: string; passed: boolean; reasons: readonly string[] }[];
  batches: readonly { id: string; finishedAt: string; certificateCount: number; foreignSuccessCount: number }[];
  contentSha256: string;
}

const HOUR = 3_600_000;

export function evaluateAuthoritativeLaunchReadiness(
  evidence: AuthoritativeLaunchEvidence
): { receipt: AuthoritativeLaunchReceipt; exitCode: 0 | 1 } {
  const manifestIdentity = launchManifestIdentity(evidence.manifest);
  const manifestReasons = validateLaunchManifest(evidence.manifest, P0_LAUNCH_MANIFEST.companies.map(({ companyId }) => companyId));
  if (manifestIdentity.manifestSha256 !== launchManifestIdentity(P0_LAUNCH_MANIFEST).manifestSha256) {
    manifestReasons.push("FROZEN_MANIFEST_MISMATCH");
  }
  const identityReasons = validateIdentities(evidence, manifestIdentity);
  const securityReasons = validateExternalReceipt(evidence.security, evidence.evaluatedAt, 24 * HOUR, "PASSED");
  if (evidence.security.imageDigest !== evidence.image.digest) securityReasons.push("SECURITY_IMAGE_DIGEST_MISMATCH");
  if (evidence.image.securityReceiptSha256 !== evidence.security.contentSha256) securityReasons.push("IMAGE_SECURITY_RECEIPT_MISMATCH");
  const restoreReasons = validateExternalReceipt(evidence.restore, evidence.evaluatedAt, 8 * 24 * HOUR, "PASSED");
  if (evidence.image.restoreReceiptSha256 !== evidence.restore.contentSha256) restoreReasons.push("IMAGE_RESTORE_RECEIPT_MISMATCH");
  if (evidence.database.snapshotSha256 !== evidence.restore.archiveSha256) restoreReasons.push("DATABASE_SNAPSHOT_RESTORE_MISMATCH");
  const batchReasons = validateBatches(evidence);
  const formalQualificationReasons = validateFormalQualificationEvidence(evidence);
  const operationReasons = evidence.operationalGates.flatMap((gate) =>
    gate.passed && validSha(gate.evidenceSha256) && gate.reason.trim() ? [] : [`${gate.name}: ${gate.reason || "missing evidence"}`]
  );
  if (evidence.operationalGates.length === 0) operationReasons.push("NO_OPERATIONAL_GATES");
  const gates = [
    gate("FROZEN_MANIFEST", manifestReasons), gate("RELEASE_IDENTITY", identityReasons),
    gate("PRODUCTION_SECURITY", securityReasons), gate("BACKUP_RESTORE", restoreReasons),
    gate("TWO_ROUND_50_COMPANY_CERTIFICATES", batchReasons),
    gate("FORMAL_QUALIFICATION_EVIDENCE", formalQualificationReasons),
    gate("DEPLOYMENT_AND_OPERATIONS", operationReasons)
  ];
  const decision = gates.every(({ passed }) => passed) ? "READY" as const : "NOT_READY" as const;
  const base = {
    schemaVersion: 2 as const,
    decision,
    evaluatedAt: evidence.evaluatedAt.toISOString(),
    identity: {
      commitSha: evidence.source.commitSha,
      sourceTreeSha256: evidence.source.sourceTreeSha256,
      runtimeTreeSha256: evidence.source.runtimeTreeSha256,
      imageDigest: evidence.image.digest,
      imageQualificationSha256: evidence.image.qualificationSha256,
      ...manifestIdentity,
      sourceConfigSha256: evidence.releaseIdentity.sourceConfigSha256,
      adapterBundleSha256: evidence.releaseIdentity.adapterBundleSha256,
      databaseSnapshotSha256: evidence.database.snapshotSha256,
      schemaSha256: evidence.database.schemaSha256,
      migrationVersion: evidence.database.migrationVersion,
      securityReceiptSha256: evidence.security.contentSha256,
      restoreReceiptSha256: evidence.restore.contentSha256,
      roundOneStateReceiptSha256: evidence.formalQualification.roundOneStateReceiptSha256,
      roundOneAuditSha256: evidence.formalQualification.roundOneAuditSha256,
      roundOneEvidenceArchiveSha256: evidence.formalQualification.roundOneEvidenceArchiveSha256,
      roundOneDatabaseArchiveSha256: evidence.formalQualification.roundOneDatabaseArchiveSha256,
      roundTwoAuditSha256: evidence.formalQualification.roundTwoAuditSha256,
      roundTwoEvidenceArchiveSha256: evidence.formalQualification.roundTwoEvidenceArchiveSha256
    },
    gates,
    batches: evidence.batches.map((batch) => ({
      id: batch.id, finishedAt: batch.finishedAt, certificateCount: batch.certificates.length,
      foreignSuccessCount: batch.certificates.filter(({ category, grade }) =>
        category === "FOREIGN_PHARMA" && (grade === "A" || grade === "B")).length
    }))
  };
  const receipt = { ...base, contentSha256: sha(JSON.stringify(base)) };
  return { receipt, exitCode: decision === "READY" ? 0 : 1 };
}

function validateFormalQualificationEvidence(evidence: AuthoritativeLaunchEvidence): string[] {
  const formal = evidence.formalQualification;
  const reasons: string[] = [];
  for (const value of [formal.roundOneStateReceiptSha256, formal.roundOneAuditSha256,
    formal.roundOneEvidenceArchiveSha256, formal.roundOneDatabaseArchiveSha256,
    formal.roundTwoAuditSha256, formal.roundTwoEvidenceArchiveSha256]) {
    if (!validSha(value)) reasons.push("FORMAL_EVIDENCE_SHA256_INVALID");
  }
  if (evidence.batches.length === 2) {
    const ordered = [...evidence.batches].sort((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt));
    if (formal.roundOneBatchId !== ordered[0]?.id || formal.roundTwoBatchId !== ordered[1]?.id) {
      reasons.push("FORMAL_BATCH_BINDING_MISMATCH");
    }
  } else {
    reasons.push("FORMAL_BATCH_BINDING_MISMATCH");
  }
  return [...new Set(reasons)];
}

function validateIdentities(evidence: AuthoritativeLaunchEvidence, manifestIdentity: ReturnType<typeof launchManifestIdentity>): string[] {
  const reasons: string[] = [];
  const identity = evidence.releaseIdentity;
  if (!/^[0-9a-f]{40}$/u.test(evidence.source.commitSha) || evidence.image.revision !== evidence.source.commitSha ||
    identity.commitSha !== evidence.source.commitSha) reasons.push("SOURCE_IMAGE_RELEASE_REVISION_MISMATCH");
  for (const value of [evidence.source.sourceTreeSha256, evidence.source.runtimeTreeSha256,
    evidence.source.buildIdentityContentSha256, evidence.image.buildIdentityContentSha256,
    evidence.image.qualificationSha256, evidence.database.snapshotSha256, evidence.database.schemaSha256,
    evidence.database.migrationManifestSha256, identity.sourceConfigSha256,
    identity.adapterBundleSha256]) if (!validSha(value)) reasons.push("IDENTITY_SHA256_INVALID");
  if (evidence.image.buildIdentityContentSha256 !== evidence.source.buildIdentityContentSha256) {
    reasons.push("IMAGE_BUILD_IDENTITY_MISMATCH");
  }
  if (evidence.database.schemaSha256 !== evidence.database.migrationManifestSha256) {
    reasons.push("DATABASE_SCHEMA_MANIFEST_MISMATCH");
  }
  if (identity.rosterSha256 !== manifestIdentity.companySetSha256 || identity.sourcePlanSha256 !== manifestIdentity.sourceIdentitySha256) {
    reasons.push("RELEASE_MANIFEST_IDENTITY_MISMATCH");
  }
  if (!identity.releaseCandidateId.trim() || !evidence.database.migrationVersion.trim() || !evidence.database.bootstrapReady) {
    reasons.push("RELEASE_OR_DATABASE_IDENTITY_MISSING");
  }
  return [...new Set(reasons)];
}

function validateExternalReceipt(value: { decision: string; contentSha256: string; evaluatedAt?: string; verifiedAt?: string },
  now: Date, maximumAge: number, passDecision: string): string[] {
  const time = Date.parse(value.evaluatedAt ?? value.verifiedAt ?? "");
  const reasons: string[] = [];
  if (value.decision !== passDecision) reasons.push("RECEIPT_NOT_PASSING");
  if (!validSha(value.contentSha256)) reasons.push("RECEIPT_HASH_INVALID");
  if (!Number.isFinite(time) || time > now.getTime() || now.getTime() - time > maximumAge) reasons.push("RECEIPT_STALE");
  return reasons;
}

function validateBatches(evidence: AuthoritativeLaunchEvidence): string[] {
  const reasons: string[] = [];
  if (evidence.batches.length !== 2) return ["EXACTLY_TWO_BATCHES_REQUIRED"];
  const batches = [...evidence.batches].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
  const times = batches.map(({ finishedAt }) => Date.parse(finishedAt));
  if (times.some((time) => !Number.isFinite(time) || time > evidence.evaluatedAt.getTime() ||
    evidence.evaluatedAt.getTime() - time > 72 * HOUR)) reasons.push("BATCH_OUTSIDE_72_HOUR_WINDOW");
  if (times[1]! - times[0]! < 12 * HOUR) reasons.push("BATCH_INTERVAL_BELOW_12_HOURS");
  const manifestByCompany = new Map(evidence.manifest.companies.map((company) => [company.companyId, company]));
  for (const batch of batches) {
    const identity = evidence.releaseIdentity;
    if (batch.status !== "SUCCESS" || batch.releaseCandidateId !== identity.releaseCandidateId ||
      batch.commitSha !== identity.commitSha || batch.rosterSha256 !== identity.rosterSha256 ||
      batch.sourcePlanSha256 !== identity.sourcePlanSha256 || batch.sourceConfigSha256 !== identity.sourceConfigSha256 ||
      batch.adapterBundleSha256 !== identity.adapterBundleSha256) reasons.push(`BATCH_IDENTITY_OR_STATUS_INVALID:${batch.id}`);
    if (batch.certificates.length !== 50 || new Set(batch.certificates.map(({ companyId }) => companyId)).size !== 50) {
      reasons.push(`CERTIFICATE_DENOMINATOR_NOT_50:${batch.id}`); continue;
    }
    for (const certificate of batch.certificates) {
      const company = manifestByCompany.get(certificate.companyId);
      if (!company || company.source.sourceId !== certificate.sourceId || company.category !== certificate.category ||
        !validateCertificate(certificate, batch, evidence.evaluatedAt)) {
        reasons.push(`CERTIFICATE_INVALID:${batch.id}:${certificate.companyId}`);
      }
    }
    const foreignSuccess = batch.certificates.filter(({ category, grade }) =>
      category === "FOREIGN_PHARMA" && (grade === "A" || grade === "B")).length;
    if (foreignSuccess !== 30) reasons.push(`FOREIGN_SUCCESS_NOT_30:${batch.id}`);
  }
  return reasons;
}

function validateCertificate(certificate: LaunchCertificateEvidence, batch: LaunchBatchEvidence, now: Date): boolean {
  if (!["A", "B"].includes(certificate.grade) || !validSha(certificate.certificateSha256) ||
    !validSha(certificate.sourceConfigSha256) || !validSha(certificate.canonicalJobSetSha256) ||
    !isRecord(certificate.certificate)) return false;
  try {
    const expected = {
      releaseCandidateId: batch.releaseCandidateId,
      batchId: batch.id,
      sourceResultId: certificate.sourceResultId,
      sourceId: certificate.sourceId,
      companyId: certificate.companyId,
      sourceConfigSha256: certificate.sourceConfigSha256,
      canonicalJobSetSha256: certificate.canonicalJobSetSha256
    };
    if (certificate.grade === "A") {
      verifyAGradeCompletenessCertificateReceipt({
        certificate: certificate.certificate,
        certificateSha256: certificate.certificateSha256,
        expected
      });
    } else {
      verifyBGradeTraversalCertificateReceipt({
        certificate: certificate.certificate,
        certificateSha256: certificate.certificateSha256,
        expected,
        now
      });
    }
    return true;
  } catch {
    return false;
  }
}

const gate = (name: string, reasons: readonly string[]) => ({ name, passed: reasons.length === 0, reasons });
const validSha = (value: string | null | undefined): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const certificateSha256 = (value: unknown): string => sha(canonicalJson(value));
export function buildUnavailableLaunchReceipt(evaluatedAt: Date, reason: string): AuthoritativeLaunchReceipt {
  const zero = "0".repeat(64);
  const base = {
    schemaVersion: 2 as const,
    decision: "NOT_READY" as const,
    evaluatedAt: evaluatedAt.toISOString(),
    identity: {
      commitSha: "0".repeat(40), sourceTreeSha256: zero, runtimeTreeSha256: zero,
      imageDigest: `sha256:${zero}`, imageQualificationSha256: zero,
      manifestSha256: zero, companySetSha256: zero, sourceIdentitySha256: zero,
      sourceConfigSha256: zero, adapterBundleSha256: zero,
      databaseSnapshotSha256: zero, schemaSha256: zero, migrationVersion: "UNAVAILABLE",
      securityReceiptSha256: zero, restoreReceiptSha256: zero,
      roundOneStateReceiptSha256: zero, roundOneAuditSha256: zero,
      roundOneEvidenceArchiveSha256: zero, roundOneDatabaseArchiveSha256: zero,
      roundTwoAuditSha256: zero, roundTwoEvidenceArchiveSha256: zero
    },
    gates: [{ name: "QUALIFICATION_EXECUTION", passed: false, reasons: [reason] }],
    batches: []
  };
  return { ...base, contentSha256: sha(JSON.stringify(base)) };
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.entries(value).sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
