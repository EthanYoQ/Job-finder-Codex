import { readLatestCrawlAttempt } from "./crawlAttemptEvidence";
import { readCrawlSummaryFile, type CrawlEvidenceIdentity } from "./crawlSummary";
import {
  crawlEvidenceIdentityFromInitialQualificationPause,
  readInitialQualificationPauseEvidence,
  type InitialQualificationPauseEvidence
} from "./initialQualificationPauseEvidence";

export type InitialQualificationPauseBundleResult =
  | { state: "MISSING" | "INVALID" | "STALE_FOR_ACTIVE_IDENTITY" }
  | {
    state: "PAUSED";
    evidence: InitialQualificationPauseEvidence;
    identity: CrawlEvidenceIdentity;
  };

export async function readInitialQualificationPauseBundle(input: {
  pausePath: string;
  summaryPath: string;
  attemptDir: string;
  now: Date;
  activeIdentity?: CrawlEvidenceIdentity;
  loadCandidateStatus(evidence: InitialQualificationPauseEvidence): Promise<string>;
}): Promise<InitialQualificationPauseBundleResult> {
  const marker = await readInitialQualificationPauseEvidence(input.pausePath);
  if (marker.state !== "VALID") return { state: marker.state };
  const identity = crawlEvidenceIdentityFromInitialQualificationPause(marker.evidence);
  const activeMatches = input.activeIdentity !== undefined && identitiesEqual(input.activeIdentity, identity);
  if (input.activeIdentity && !activeMatches) return { state: "STALE_FOR_ACTIVE_IDENTITY" };

  const summary = await readCrawlSummaryFile(input.summaryPath, {
    now: input.now,
    expectedIdentity: identity,
    allowIncompleteScheduled: true
  });
  if (summary.state !== "VALID" && summary.state !== "STALE") return { state: "INVALID" };
  if (
    summary.summary.batchId !== marker.evidence.batchId ||
    summary.summarySha256 !== marker.evidence.canonicalSummarySha256
  ) return { state: "INVALID" };

  const attempt = await readLatestCrawlAttempt(input.attemptDir, {
    now: input.now,
    expectedIdentity: identity,
    expectedCanonicalSummary: {
      batchId: marker.evidence.batchId,
      summarySha256: marker.evidence.canonicalSummarySha256
    }
  });
  if (attempt.state !== "PAUSED") return { state: "INVALID" };
  const pause = attempt.initialQualificationPause;
  if (
    attempt.attemptId !== marker.evidence.attemptId ||
    attempt.canonicalSummaryBinding.batchId !== marker.evidence.batchId ||
    attempt.canonicalSummaryBinding.summarySha256 !== marker.evidence.canonicalSummarySha256 ||
    pause.reasonCode !== marker.evidence.reasonCode ||
    pause.notificationKey !== marker.evidence.notificationKey ||
    pause.completedRoundCount !== marker.evidence.completedRoundCount ||
    pause.stableCompanyCount !== marker.evidence.stableCompanyCount ||
    pause.minimumStableCompanyCount !== marker.evidence.minimumStableCompanyCount
  ) return { state: "INVALID" };

  if (input.activeIdentity) return { state: "STALE_FOR_ACTIVE_IDENTITY" };
  try {
    if (await input.loadCandidateStatus(marker.evidence) !== "INVALIDATED") return { state: "INVALID" };
  } catch {
    return { state: "INVALID" };
  }
  return { state: "PAUSED", evidence: marker.evidence, identity };
}

function identitiesEqual(left: CrawlEvidenceIdentity, right: CrawlEvidenceIdentity): boolean {
  return left.releaseCandidateId === right.releaseCandidateId && left.batchKind === right.batchKind &&
    left.commitSha === right.commitSha && left.rosterSha256 === right.rosterSha256 &&
    left.sourcePlanSha256 === right.sourcePlanSha256 &&
    left.sourceConfigSha256 === right.sourceConfigSha256 &&
    left.adapterBundleSha256 === right.adapterBundleSha256 &&
    left.plannedSourceSetSha256 === right.plannedSourceSetSha256 &&
    left.plannedSourceCount === right.plannedSourceCount;
}
