import { createHash } from "node:crypto";
import { hasUniqueJsonObjectKeys } from "../crawler/strictJsonObjectKeys";

export interface ReleaseCandidatePromotionRow {
  id: string;
  goalId: string;
  version: number;
  commitSha: string;
  dbSnapshotHash: string;
  schemaHash: string;
  migrationVersion: string;
  rosterHash: string;
  sourcePlanHash: string;
  sourceConfigHash: string;
  adapterBundleHash: string;
  sourceTreeHash: string;
  runtimeTreeHash: string;
  oracleVersion: string;
  minimumStableCompanyCount: number;
  status: string;
  releaseQaEvidenceSha256: string | null;
  finalizedAt: Date | null;
}

export interface IndependentReleaseQaEvidence {
  schemaVersion: "p0-independent-release-qa-v1";
  decision: "PASS";
  releaseCandidateId: string;
  goalId: string;
  version: number;
  commitSha: string;
  dbSnapshotHash: string;
  schemaHash: string;
  migrationVersion: string;
  rosterHash: string;
  sourcePlanHash: string;
  sourceConfigHash: string;
  adapterBundleHash: string;
  sourceTreeHash: string;
  runtimeTreeHash: string;
  oracleVersion: string;
  minimumStableCompanyCount: number;
  stableCompanyCount: number;
  stableCompanyIds: string[];
  reviewedAt: string;
  reviewerId: string;
  reviewMode: "INDEPENDENT_READ_ONLY_QA";
  readOnlyReview: true;
  implementationParticipated: false;
}

export interface StagedReleasePromotionGateReport {
  canRelease: boolean;
  readiness: {
    canRelease: boolean;
    releaseCandidateStatus: string;
    stableCompanyCount: number;
    stableCompanyIds: string[];
    minimumStableCompanyCount: number;
    issues: readonly unknown[];
  };
  dataQuality: {
    canRelease: boolean;
    issues: readonly unknown[];
  };
}

export interface StagedReleasePromotionDeps {
  now(): Date;
  loadCandidate(releaseCandidateId: string): Promise<ReleaseCandidatePromotionRow | null>;
  loadGateReport(): Promise<StagedReleasePromotionGateReport>;
  updateReleased(input: {
    releaseCandidate: ReleaseCandidatePromotionRow;
    releaseQaEvidenceSha256: string;
    finalizedAt: Date;
  }): Promise<number>;
}

export interface StagedReleasePromotionResult {
  releaseCandidateId: string;
  status: "RELEASED";
  releaseQaEvidenceSha256: string;
}

const QA_EVIDENCE_KEYS = [
  "schemaVersion", "decision", "releaseCandidateId", "goalId", "version", "commitSha",
  "dbSnapshotHash", "schemaHash", "migrationVersion", "rosterHash", "sourcePlanHash",
  "sourceConfigHash", "adapterBundleHash", "sourceTreeHash", "runtimeTreeHash", "oracleVersion",
  "minimumStableCompanyCount", "stableCompanyCount", "stableCompanyIds", "reviewedAt", "reviewerId",
  "reviewMode", "readOnlyReview", "implementationParticipated"
] as const;

export async function promoteStagedReleaseCandidate(
  input: { releaseCandidateId: string; qaEvidenceText: string },
  deps: StagedReleasePromotionDeps
): Promise<StagedReleasePromotionResult> {
  if (!input.releaseCandidateId.trim() || input.releaseCandidateId !== input.releaseCandidateId.trim()) {
    throw new Error("STAGED_RELEASE_PROMOTION_CANDIDATE_ID_INVALID");
  }
  const now = deps.now();
  if (!Number.isFinite(now.getTime())) throw new Error("STAGED_RELEASE_PROMOTION_TIME_INVALID");
  const releaseCandidate = await deps.loadCandidate(input.releaseCandidateId);
  if (!releaseCandidate || releaseCandidate.id !== input.releaseCandidateId) {
    throw new Error("STAGED_RELEASE_PROMOTION_CANDIDATE_NOT_FOUND");
  }
  if (releaseCandidate.status !== "READY_FOR_QA" ||
      releaseCandidate.releaseQaEvidenceSha256 !== null || releaseCandidate.finalizedAt !== null) {
    throw new Error("STAGED_RELEASE_PROMOTION_CANDIDATE_NOT_READY");
  }

  const qaEvidence = parseIndependentQaEvidence(input.qaEvidenceText);
  assertQaIdentity(qaEvidence, releaseCandidate);
  assertIndependentReview(qaEvidence, now);

  const gate = await deps.loadGateReport();
  if (!gate.canRelease || !gate.readiness.canRelease || !gate.dataQuality.canRelease ||
      gate.readiness.issues.length !== 0 || gate.dataQuality.issues.length !== 0 ||
      gate.readiness.releaseCandidateStatus !== "READY_FOR_QA" ||
      gate.readiness.minimumStableCompanyCount !== releaseCandidate.minimumStableCompanyCount ||
      gate.readiness.stableCompanyCount < releaseCandidate.minimumStableCompanyCount) {
    throw new Error("STAGED_RELEASE_PROMOTION_GATE_FAILED");
  }
  const gateStableCompanyIds = canonicalIds(gate.readiness.stableCompanyIds);
  if (gateStableCompanyIds.length !== gate.readiness.stableCompanyCount ||
      !exactCanonicalIds(gateStableCompanyIds, qaEvidence.stableCompanyIds)) {
    throw new Error("STAGED_RELEASE_QA_STABLE_COMPANY_DRIFT");
  }

  const releaseQaEvidenceSha256 = sha256(input.qaEvidenceText);
  const updateCount = await deps.updateReleased({
    releaseCandidate,
    releaseQaEvidenceSha256,
    finalizedAt: now
  });
  if (updateCount !== 1) throw new Error(`STAGED_RELEASE_PROMOTION_UPDATE_COUNT:${updateCount}`);
  return { releaseCandidateId: releaseCandidate.id, status: "RELEASED", releaseQaEvidenceSha256 };
}

function parseIndependentQaEvidence(text: string): IndependentReleaseQaEvidence {
  if (!text || Buffer.byteLength(text, "utf8") > 256_000 || !hasUniqueJsonObjectKeys(text)) {
    throw new Error("STAGED_RELEASE_QA_EVIDENCE_INVALID");
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("STAGED_RELEASE_QA_EVIDENCE_INVALID"); }
  if (!isRecord(value) || JSON.stringify(Object.keys(value).sort(compareUtf8)) !==
      JSON.stringify([...QA_EVIDENCE_KEYS].sort(compareUtf8))) {
    throw new Error("STAGED_RELEASE_QA_EVIDENCE_INVALID");
  }
  return value as unknown as IndependentReleaseQaEvidence;
}

function assertQaIdentity(
  evidence: IndependentReleaseQaEvidence,
  candidate: ReleaseCandidatePromotionRow
): void {
  const exactFields = [
    ["releaseCandidateId", evidence.releaseCandidateId, candidate.id],
    ["goalId", evidence.goalId, candidate.goalId],
    ["commitSha", evidence.commitSha, candidate.commitSha],
    ["dbSnapshotHash", evidence.dbSnapshotHash, candidate.dbSnapshotHash],
    ["schemaHash", evidence.schemaHash, candidate.schemaHash],
    ["migrationVersion", evidence.migrationVersion, candidate.migrationVersion],
    ["rosterHash", evidence.rosterHash, candidate.rosterHash],
    ["sourcePlanHash", evidence.sourcePlanHash, candidate.sourcePlanHash],
    ["sourceConfigHash", evidence.sourceConfigHash, candidate.sourceConfigHash],
    ["adapterBundleHash", evidence.adapterBundleHash, candidate.adapterBundleHash],
    ["sourceTreeHash", evidence.sourceTreeHash, candidate.sourceTreeHash],
    ["runtimeTreeHash", evidence.runtimeTreeHash, candidate.runtimeTreeHash],
    ["oracleVersion", evidence.oracleVersion, candidate.oracleVersion]
  ] as const;
  for (const [field, actual, expected] of exactFields) {
    if (typeof actual !== "string" || actual !== expected) {
      throw new Error(`STAGED_RELEASE_QA_IDENTITY_DRIFT:${field}`);
    }
  }
  if (evidence.version !== candidate.version ||
      evidence.minimumStableCompanyCount !== candidate.minimumStableCompanyCount) {
    throw new Error("STAGED_RELEASE_QA_IDENTITY_DRIFT:numeric");
  }
}

function assertIndependentReview(evidence: IndependentReleaseQaEvidence, now: Date): void {
  if (evidence.schemaVersion !== "p0-independent-release-qa-v1" || evidence.decision !== "PASS" ||
      evidence.reviewMode !== "INDEPENDENT_READ_ONLY_QA" || evidence.readOnlyReview !== true ||
      evidence.implementationParticipated !== false ||
      typeof evidence.reviewerId !== "string" || typeof evidence.reviewedAt !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{2,99}$/u.test(evidence.reviewerId)) {
    throw new Error("STAGED_RELEASE_QA_INDEPENDENCE_INVALID");
  }
  const reviewedAt = Date.parse(evidence.reviewedAt);
  const reviewAgeMs = now.getTime() - reviewedAt;
  if (!Number.isFinite(reviewedAt) || reviewAgeMs < -5 * 60_000 || reviewAgeMs > 24 * 60 * 60_000) {
    throw new Error("STAGED_RELEASE_QA_REVIEW_TIME_INVALID");
  }
  const stableCompanyIds = canonicalIds(evidence.stableCompanyIds);
  if (stableCompanyIds.length !== evidence.stableCompanyCount ||
      evidence.stableCompanyCount < evidence.minimumStableCompanyCount ||
      !exactCanonicalIds(stableCompanyIds, evidence.stableCompanyIds)) {
    throw new Error("STAGED_RELEASE_QA_STABLE_COMPANY_SET_INVALID");
  }
}

function canonicalIds(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.some((value) =>
    typeof value !== "string" || !/^company-[a-z0-9-]+$/u.test(value))) {
    throw new Error("STAGED_RELEASE_QA_STABLE_COMPANY_SET_INVALID");
  }
  return [...new Set(values)].sort(compareUtf8);
}

function exactCanonicalIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
