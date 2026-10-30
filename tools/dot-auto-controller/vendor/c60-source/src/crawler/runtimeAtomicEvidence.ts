import { rocheQuarantinedSourceJobIds } from "./rocheChinaQuality";
import { isDeepStrictEqual } from "node:util";
import { isPfizerWorkdayTraversalPlan, pfizerQuarantinedOfficialIds, pfizerSourceJobId, PFIZER_ENTRY } from "./pfizerWorkdayTraversal";
import { hasNovartisPartitionEvidence, replayNovartisNativePartitions } from "./novartisNativePartitions";
import type {SanofiIndependentArchiveBinding} from "./traversalCertificate";
import { assertServierUnknownLifecyclePreserved } from "./servierMokaScope";
import { hasNovartisOfficialPresencePlan, replayNovartisOfficialPresence } from "./novartisOfficialPresence";
import { SOURCE_QUALITY_POLICY_ID, assertIssuedSourceQualityAdmission, getSourceQualityPolicy, verifySourceQualityAtomicCommit, verifyIssuedSourceQualityArchiveForPersistence, type SourceQualityAdmission } from "./sourceQualityAdmission";
import { buildSourceQualityJobCommands, type SourceQualityPublicationInput } from "./sourceQualityPublication";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  FailedSourceEvidenceCommit,
  PendingSourceTerminalInput,
  PlannedBatchWithSourcesInput,
  PlannedPendingSourceInput
} from "../db/ingestionRepository";
import type { RuntimeBatchIdentity } from "./runtimeBatchIdentity";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import type { SourceCrawlResult, SourceFetchAttemptTracker } from "./runSourceCrawl";
import {
  isSafeBGradeIndependentTraversalFailureReason,
  type BGradeIndependentTraversalFailureCode
} from "./independentTraversalDiagnostics";
import { applyCrawlObservation, type JobSnapshot } from "./lifecycle";
import { buildIngestionCommands } from "./ingestion";
import { buildJobDedupeKey } from "./normalizedJob";
import { assertAdapterReconciliation } from "./adapters/reconciliation";
import {
  canonicalPageTraceSha256,
  canonicalStringSetSha256,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft
} from "./sourceFetchEvidence";
import { assertVerifiedArchivedEvidenceMetadata, type ArchivedEvidenceArtifact } from "./artifactArchive";
import type { AtomicSourceEvidenceCommit } from "../db/ingestionRepository";
import type { StartupTrustedSourceSurfaceOracle } from "./sourceSurfaceOracleAuthority";
import { assertExactIndependentCompletenessEvidence, sourceOracleProjection } from "./independentSourceSurfaceOracle";
import {
  issueAGradeOfficialTotalCertificate,
  requiresAGradeOfficialTotalCertificate
} from "./completenessCertificate";
import {
  issueBGradeTraversalCertificate,
  requiresBGradeTraversalCertificate,
  type BGradeValidationTrigger,
  type BGradeIndependentTraversalValidation
} from "./traversalCertificate";
import {
  canonicalCompletenessAnomalyTriggerCodes,
  transitionTrustedCompletenessBaseline,
  type TrustedCompletenessBaseline
} from "./completenessAnomalyPolicy";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const attestationKey=randomBytes(32);
const runtimeAstellasAdmissions=new WeakMap<AtomicSourceEvidenceCommit,SourceQualityAdmission>();
const runtimeCommitAttestations=new WeakMap<AtomicSourceEvidenceCommit,Buffer>();
const failedRuntimeCommitAttestations=new WeakMap<FailedSourceEvidenceCommit,Buffer>();

function stagedPlanOfficialProjection(plan: SourceCrawlPlan): {
  officialEntryId: null;
  officialSurfaceIds: string[];
  officialChannelIds: string[];
} | undefined {
  if (plan.executionAuthority !== "STAGED" || plan.source.status !== "VERIFIED_SCRAPABLE" ||
      !plan.source.officialEntryUrl.trim() || !plan.source.officialChainEvidenceUrl.trim() ||
      !plan.source.surfaceId?.trim() || !plan.expectedChannels?.length) return undefined;
  return {
    officialEntryId: null,
    officialSurfaceIds: [plan.source.surfaceId],
    officialChannelIds: plan.expectedChannels.map(({ channelId }) => channelId)
  };
}

function archivedRedactionCommitment(artifact: ArchivedEvidenceArtifact): string {
  if (artifact.bodyRepresentation === "REDACTED") {
    if (!artifact.rawBodySha256 || !/^[0-9a-f]{64}$/.test(artifact.rawBodySha256) ||
        !Array.isArray(artifact.redactionDescriptors) || artifact.redactionDescriptors.length === 0) {
      throw new Error("redacted archived artifact requires raw hash and descriptors");
    }
    return artifact.rawBodySha256;
  }
  if (artifact.rawBodySha256 !== undefined || artifact.redactionDescriptors !== undefined) {
    throw new Error("non-redacted archived artifact cannot carry redaction provenance");
  }
  return artifact.sha256;
}

export function buildPendingRuntimeBatch(
  batchId: string,
  plans: readonly SourceCrawlPlan[],
  identity: RuntimeBatchIdentity,
  startedAt: Date,
  oracle?: AuditedSourceSurfaceOracle,
  trustedOracle?: StartupTrustedSourceSurfaceOracle,
  manualCrawlRequestId?: string
): PlannedBatchWithSourcesInput {
  if (identity.batchKind === "MANUAL_SOURCE" && !manualCrawlRequestId?.trim()) {
    throw new Error("MANUAL_SOURCE requires an exact manual crawl request binding");
  }
  if (identity.batchKind !== "MANUAL_SOURCE" && manualCrawlRequestId !== undefined) {
    throw new Error("Only MANUAL_SOURCE may bind a manual crawl request");
  }
  const sources: PlannedPendingSourceInput[] = plans.map((plan) => ({
    ...(() => {
      const oracleProjection = trustedOracle
        ? sourceOracleProjection(trustedOracle, plan.source.id)
        : oracle?.sources[plan.source.id];
      const projection = oracleProjection ??
        (identity.batchKind === "FULL_RELEASE" ? undefined : stagedPlanOfficialProjection(plan));
      return {
        officialEntryId: projection?.officialEntryId ?? null,
        officialSurfaceIds: [...(projection?.officialSurfaceIds ?? [])],
        officialChannelIds: [...(projection?.officialChannelIds ?? [])]
      };
    })(),
    id: `${batchId}--${plan.source.id}`,
    sourceId: plan.source.id,
    sourceConfigHash: sourcePlanConfigSha256(plan),
    adapterVersion: sha256(canonicalJson({
      adapterId: plan.adapterId,
      adapterBundleSha256: identity.adapterBundleSha256
    })),
    startedAt: new Date(startedAt)
  }));

  return {
    batch: {
      id: batchId,
      releaseCandidateId: identity.releaseCandidateId,
      commitSha: identity.commitSha,
      rosterSha256: identity.rosterSha256,
      sourcePlanSha256: identity.sourcePlanSha256,
      sourceConfigSha256: identity.sourceConfigSha256,
      adapterBundleSha256: identity.adapterBundleSha256,
      kind: identity.batchKind,
      ...(manualCrawlRequestId === undefined ? {} : { manualCrawlRequestId }),
      plannedSourceIds: [...identity.expectedPlannedSourceIds],
      plannedSourceSetSha256: identity.expectedPlannedSourceSetSha256,
      plannedSourceCount: identity.expectedPlannedSourceCount,
      ownerId: identity.ownerId,
      heartbeatAt: new Date(startedAt),
      startedAt: new Date(startedAt)
    },
    sources
  };
}

export function verifyAtomicRuntimeCommitAttestation(commit: AtomicSourceEvidenceCommit): void {
  const sealed=runtimeCommitAttestations.get(commit); if(!sealed)throw new Error("ATOMIC_RUNTIME_COMMIT_ATTESTATION_MISSING");
  const current=attestationSignature(commit);
  if(sealed.length!==current.length||!timingSafeEqual(sealed,current))throw new Error("ATOMIC_RUNTIME_COMMIT_ATTESTATION_INVALID");
}

/** Async replay is mandatory on the actual persistence route for Astellas. */
export async function verifyAtomicRuntimeCommitForPersistence(commit:AtomicSourceEvidenceCommit):Promise<void> {
  verifyAtomicRuntimeCommitAttestation(commit);
  if(commit.sourceResult.sourceId==="source-astellas-china-social"&&commit.publicationPolicy==="SOURCE_ATOMIC_LAST_GOOD_V1"&&commit.sourceResult.completenessState==="VERIFIED"){
    const admission=runtimeAstellasAdmissions.get(commit);
    if(!admission)throw Error("ASTELLAS_COMMIT_ARCHIVE_REPLAY_REQUIRED");
    await verifyIssuedSourceQualityArchiveForPersistence(admission);
    verifyAtomicRuntimeCommitAttestation(commit);
  }
}

export function verifyFailedRuntimeEvidenceCommitAttestation(commit: FailedSourceEvidenceCommit): void {
  const sealed = failedRuntimeCommitAttestations.get(commit);
  if (!sealed) throw new Error("FAILED_RUNTIME_EVIDENCE_COMMIT_ATTESTATION_MISSING");
  const current = attestationSignature(commit);
  if (sealed.length !== current.length || !timingSafeEqual(sealed, current)) {
    throw new Error("FAILED_RUNTIME_EVIDENCE_COMMIT_ATTESTATION_INVALID");
  }
}

function attestationSignature(commit: unknown):Buffer {
  return createHmac("sha256",attestationKey).update(canonicalJson(commit),"utf8").digest();
}

export interface AuditedSourceSurfaceOracle {
  auditId: string;
  sources: Readonly<Record<string, {
    officialEntryId: string;
    officialSurfaceIds: readonly string[];
    officialChannelIds: readonly string[];
    artifactLogicalKeyToSurfaceId: Readonly<Record<string, string>>;
    artifactLogicalKeyToChannelId: Readonly<Record<string, string>>;
  }>>;
}

export function hasCompleteAuditedSourceCoverage(sourceId: string,
  evidence: PersistentSourceFetchEvidence,
  oracle: AuditedSourceSurfaceOracle | undefined): boolean {
  const audited = oracle?.sources[sourceId];
  if (!audited) return false;
  const visitedSurfaces = evidence.artifacts.flatMap((artifact) =>
    audited.artifactLogicalKeyToSurfaceId[artifact.logicalKey] ?? []);
  const visitedChannels = evidence.artifacts.flatMap((artifact) =>
    audited.artifactLogicalKeyToChannelId[artifact.logicalKey] ?? []);
  return canonicalStringSetSha256(audited.officialSurfaceIds) === canonicalStringSetSha256(visitedSurfaces) &&
    canonicalStringSetSha256(audited.officialChannelIds) === canonicalStringSetSha256(visitedChannels);
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function bindRuntimeEvidenceArtifactIds(input: {
  releaseCandidateId: string;
  batchId: string;
  sourceId: string;
  sourceResultId: string;
  artifacts: readonly SourceFetchArtifactDraft[];
}): SourceFetchArtifactDraft[] {
  return input.artifacts.map((artifact) => ({
    ...artifact,
    id: sha256(canonicalJson([
      "runtime-evidence-artifact-v1",
      input.releaseCandidateId,
      input.batchId,
      input.sourceId,
      input.sourceResultId,
      artifact.logicalKey
    ]))
  }));
}

export function buildFailedRuntimeEvidenceCommit(input: {
  pending: PlannedPendingSourceInput;
  identity: RuntimeBatchIdentity;
  batchId: string;
  evidenceSubdirectory: string;
  result: SourceCrawlResult;
  terminal: PendingSourceTerminalInput;
  artifacts: readonly ArchivedEvidenceArtifact[];
}): FailedSourceEvidenceCommit {
  const evidence = input.result.fetchEvidence;
  if (!evidence || input.result.truth.transportSuccess && input.result.truth.adapterSuccess) {
    throw new Error("failed runtime evidence commit requires failed source truth and strict fetch evidence");
  }
  if (input.terminal.id !== input.pending.id ||
      input.terminal.releaseCandidateId !== input.identity.releaseCandidateId ||
      input.terminal.batchId !== input.batchId || input.terminal.sourceId !== input.pending.sourceId) {
    throw new Error("failed runtime evidence terminal tuple mismatch");
  }
  const tuple = {
    releaseCandidateId: input.identity.releaseCandidateId,
    batchId: input.batchId,
    sourceId: input.pending.sourceId,
    sourceResultId: input.pending.id
  };
  const boundDrafts = bindRuntimeEvidenceArtifactIds({ ...tuple,
    artifacts: [
      ...evidence.artifacts,
      ...(input.result.priorTransportAttempts ?? []).flatMap((attempt) => attempt.fetchEvidence?.artifacts ?? [])
    ]
  });
  assertVerifiedArchivedEvidenceMetadata({ ...tuple,
    evidenceSubdirectory: input.evidenceSubdirectory, artifacts: [...input.artifacts] }, boundDrafts);
  if (input.artifacts.some((artifact) => artifact.captureToolName !== evidence.captureTool.name ||
      artifact.captureToolVersion !== evidence.captureTool.version)) {
    throw new Error("verified archive metadata is not bound to the fetch capture tool");
  }
  const artifacts = input.artifacts.map((archived) => ({
    ...tuple,
    id: archived.id,
    logicalKey: archived.logicalKey,
    ...(archived.channelId ? { channelId: archived.channelId } : {}),
    kind: archived.kind,
    ...(archived.requestedUrl ? { requestedUrl: archived.requestedUrl } : {}),
    ...(archived.finalUrl ? { finalUrl: archived.finalUrl } : {}),
    ...(archived.httpStatus ? { httpStatus: archived.httpStatus } : {}),
    ...(archived.contentType ? { contentType: archived.contentType } : {}),
    capturedAt: archived.capturedAt,
    sha256: archived.sha256,
    byteCount: archived.byteCount,
    path: archived.path,
    extractorLocator: archived.extractorLocator,
    captureToolName: archived.captureToolName,
    captureToolVersion: archived.captureToolVersion,
    redactionCommitmentSha256: archivedRedactionCommitment(archived)
  }));
  const pagination = evidence.pages.map((page) => ({
    ...tuple,
    artifactLogicalKey: page.artifactLogicalKey,
    sequence: page.sequence,
    ...(page.channelId ? { channelId: page.channelId } : {}),
    requestedCursor: page.requestedCursor ?? null,
    returnedCursor: page.returnedCursor ?? null,
    requestedOffset: page.requestedOffset ?? null,
    returnedOffset: page.returnedOffset ?? null,
    requestedPage: page.requestedPage ?? null,
    returnedPage: page.returnedPage ?? null,
    requestedPageSize: page.requestedPageSize ?? null,
    returnedPageSize: page.returnedPageSize ?? null,
    responseFingerprintSha256: requiredSha(page.responseFingerprintSha256, "page response fingerprint"),
    rawJobIdSetSha256: canonicalStringSetSha256(page.rawJobIds),
    validJobIdSetSha256: canonicalStringSetSha256(page.validJobIds),
    declaredTotal: page.declaredTotal ?? null,
    declaredCount: page.declaredCount ?? null,
    declaredPages: page.declaredPages ?? null,
    nextPageSignalBefore: page.nextPageSignalBefore ?? null,
    nextPageSignalAfter: page.nextPageSignalAfter ?? null,
    termination: page.termination,
    anomalyCodes: page.anomalyCodes,
    capturedAt: new Date(page.capturedAt)
  }));
  const commit: FailedSourceEvidenceCommit = {
    sourceResult: input.terminal,
    fetchCounts: { ...evidence.fetchCounts },
    expectedJobCount: evidence.declaredCompleteness?.kind === "OFFICIAL_TOTAL_COUNT"
      ? evidence.declaredCompleteness.value
      : null,
    expectedEvidenceKind: evidence.declaredCompleteness?.kind ?? null,
    artifacts,
    pagination,
    lossLedger: evidence.fetchLosses.map((loss) => ({
      ...tuple,
      stage: loss.stage,
      reason: loss.reason,
      rawLocator: loss.rawLocator,
      details: loss.details,
      ...(loss.recordedAt ? { recordedAt: new Date(loss.recordedAt) } : {})
    })),
    priorTransportAttempts: (input.result.priorTransportAttempts ?? []).map((attempt, sequence) => {
      const attemptEvidence = attempt.code === "HCM_BROWSER_SUCCEEDED" || attempt.code === "JNJ_BROWSER_SUCCEEDED"
        ? evidence
        : attempt.fetchEvidence;
      const artifactIds = attemptEvidence?.artifacts.map((draft) => {
        const archived = input.artifacts.find((item) => item.logicalKey === draft.logicalKey);
        if (!archived) throw new Error(`missing archived failed-attempt artifact ${draft.logicalKey}`);
        return archived.id;
      }) ?? [];
      return {
        ...tuple,
        id: `${input.pending.id}--attempt-${sequence}`,
        sequence,
        transport: attempt.transport,
        outcome: attempt.outcome,
        code: attempt.code,
        capturedAt: new Date(attempt.capturedAt),
        artifactIds,
        evidenceCommitmentSha256: canonicalStringSetSha256(artifactIds.map((id) =>
          input.artifacts.find((artifact) => artifact.id === id)!.sha256)),
        pageTraceSha256: attemptEvidence
          ? canonicalPageTraceSha256(attemptEvidence.pages)
          : sha256(canonicalJson(null)),
        lossLedgerSha256: sha256(canonicalJson(attemptEvidence?.fetchLosses ?? [])),
        paginationEvaluationSha256: sha256(canonicalJson(attempt.paginationEvaluation ?? null)),
        details: { code: attempt.code }
      };
    })
  };
  failedRuntimeCommitAttestations.set(commit, attestationSignature(commit));
  return commit;
}

export function buildAtomicRuntimeCommit(input: {
  plan: SourceCrawlPlan;
  pending: PlannedPendingSourceInput;
  identity: RuntimeBatchIdentity;
  batchId: string;
  result: SourceCrawlResult;
  previousJobs: readonly JobSnapshot[];
  baselineCompletedBeforeCrawl: boolean;
  artifacts: readonly ArchivedEvidenceArtifact[];
  publicationPolicy?: "SOURCE_ATOMIC_LAST_GOOD_V1";
  sourceAdmissionPolicy?: typeof SOURCE_QUALITY_POLICY_ID;
  sourceQualityAdmission?: SourceQualityAdmission;
  firstAcceptedCurrentPolicyReceipt?: SourceQualityPublicationInput["firstAcceptedCurrentPolicyReceipt"];
  attemptTracker?: Pick<SourceFetchAttemptTracker, "fetchAttemptCount" | "retryCount" | "retryReasonCodes">;
  oracle?: AuditedSourceSurfaceOracle;
  trustedOracle?: StartupTrustedSourceSurfaceOracle;
  independentTraversalValidation?: BGradeIndependentTraversalValidation;
  sanofiIndependentOriginal?: SanofiIndependentArchiveBinding;
  bayerIndependentOriginal?: SanofiIndependentArchiveBinding;
  independentTraversalValidationExecution?: "CURRENT_RUN" | "REUSED";
  independentTraversalValidationTrigger?: BGradeValidationTrigger;
  independentTraversalFailureCode?: BGradeIndependentTraversalFailureCode;
  independentTraversalFailureReason?: string;
  completedAt?: Date;
  trustedCompletenessBaseline?: TrustedCompletenessBaseline | null;
  completenessAnomalyTriggerCodes?: readonly string[];
}): AtomicSourceEvidenceCommit {
  const { plan, pending, identity, batchId, result } = input;
  if (!result.truth.transportSuccess || !result.truth.adapterSuccess || !result.fetchEvidence) {
    throw new Error("atomic runtime commit requires successful transport, adapter and strict fetch evidence");
  }
  const attemptTracker = input.attemptTracker ?? { fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] };
  if (input.independentTraversalFailureReason !== undefined &&
      (input.independentTraversalFailureCode === undefined ||
       !isSafeBGradeIndependentTraversalFailureReason(input.independentTraversalFailureReason))) {
    throw new Error("independent traversal failure reason must be closed and code-bound");
  }
  if (!Number.isSafeInteger(attemptTracker.fetchAttemptCount) || attemptTracker.fetchAttemptCount < 1 ||
      !Number.isSafeInteger(attemptTracker.retryCount) || attemptTracker.retryCount < 0 ||
      attemptTracker.retryCount >= attemptTracker.fetchAttemptCount ||
      attemptTracker.retryReasonCodes.length !== attemptTracker.retryCount) {
    throw new Error("successful atomic source result requires consistent fetch attempt counters");
  }
  const portableMode = input.sourceAdmissionPolicy === SOURCE_QUALITY_POLICY_ID;
  const lastGoodMode = portableMode || input.publicationPolicy === "SOURCE_ATOMIC_LAST_GOOD_V1";
  if (lastGoodMode && identity.batchKind !== "SCHEDULED") throw new Error("Source-atomic last-good publication requires a scheduled batch");
  const qualityRequired = portableMode;
  if (qualityRequired && input.firstAcceptedCurrentPolicyReceipt === undefined) throw new Error("Portable receipt baseline must be loaded explicitly");
  const qualityAdmission = qualityRequired ? input.sourceQualityAdmission : undefined;
  const qualityAccepted = qualityAdmission?.status === "ACCEPTED";
  if (qualityAccepted) assertIssuedSourceQualityAdmission(qualityAdmission, result, plan);
  if (input.sourceQualityAdmission && !qualityRequired) throw new Error("Unreviewed source cannot select portable admission");
  const ledger = assertAdapterReconciliation(result);
  const evidence = result.fetchEvidence;
  const finishedAt = qualityAccepted ? new Date(qualityAdmission.receipt.issuedAt) : input.completedAt ?? result.observation.crawledAt;
  if (!(finishedAt instanceof Date) || !Number.isFinite(finishedAt.getTime()) ||
      finishedAt.getTime() < result.observation.crawledAt.getTime()) {
    throw new Error("atomic runtime commit completedAt must not precede the crawl observation");
  }
  const tuple = { releaseCandidateId: identity.releaseCandidateId, batchId,
    sourceId: plan.source.id, sourceResultId: pending.id };
  const aGradeCertificateRequired = !qualityRequired && requiresAGradeOfficialTotalCertificate(plan);
  const bGradeCertificateRequired = !qualityRequired && requiresBGradeTraversalCertificate(plan);
  const certificateRequired = aGradeCertificateRequired || bGradeCertificateRequired;
  const declarationLogicalKey = evidence.declaredCompleteness?.artifactLogicalKey;
  const aGradeCertificateDecision = aGradeCertificateRequired && result.paginationEvaluation
    ? issueAGradeOfficialTotalCertificate({
        binding: {
          releaseCandidateId: identity.releaseCandidateId,
          batchId,
          sourceResultId: pending.id,
          sourceConfigSha256: pending.sourceConfigHash
        },
        plan,
        transportSuccess: result.truth.transportSuccess,
        adapterSuccess: result.truth.adapterSuccess,
        evidence,
        paginationEvaluation: result.paginationEvaluation,
        reconciliation: ledger,
        jobs: result.jobs,
        officialArtifactSha256: input.artifacts.find(
          (artifact) => artifact.logicalKey === declarationLogicalKey
        )?.sha256
      })
    : undefined;
  const bGradeCertificateDecision = bGradeCertificateRequired && result.paginationEvaluation &&
      input.independentTraversalValidation
    ? issueBGradeTraversalCertificate({
        ...(input.bayerIndependentOriginal?{bayerArchive:{artifacts:input.artifacts,independentOriginal:input.bayerIndependentOriginal}}:{}),
        ...(input.sanofiIndependentOriginal?{sanofiArchive:{artifacts:input.artifacts,independentOriginal:input.sanofiIndependentOriginal}}:{}),
        binding: {
          releaseCandidateId: identity.releaseCandidateId,
          batchId,
          sourceResultId: pending.id,
          sourceConfigSha256: pending.sourceConfigHash
        },
        plan,
        transportSuccess: result.truth.transportSuccess,
        adapterSuccess: result.truth.adapterSuccess,
        evidence,
        paginationEvaluation: result.paginationEvaluation,
        reconciliation: ledger,
        jobs: result.jobs,
        independentValidation: input.independentTraversalValidation,
        validationExecution: input.independentTraversalValidationExecution ?? "CURRENT_RUN",
        trigger: input.independentTraversalValidationTrigger ?? "INITIAL_QUALIFICATION",
        now: finishedAt
      })
    : undefined;
  const certificateDecision = aGradeCertificateDecision ?? bGradeCertificateDecision;
  const certificateCertified = certificateDecision?.status === "CERTIFIED";
  const baselineProof = qualityAccepted ? { kind: SOURCE_QUALITY_POLICY_ID, sha256: qualityAdmission.receiptSha256 }
    : certificateDecision?.status === "CERTIFIED" ? { kind: certificateDecision.certificate.grade, sha256: certificateDecision.certificateSha256 } : undefined;
  // A certified B-grade traversal is the completeness proof for filtered sources whose
  // official raw total intentionally differs from the in-scope output. Requiring the
  // pre-certificate truth bit here would attach a valid certificate to INCOMPLETE truth,
  // which the persistence verifier must reject.
  const sourceCompletenessVerified = qualityRequired ? qualityAccepted : certificateRequired
    ? certificateCertified
    : result.truth.completenessVerified;
  const currentKeys = result.jobs.map(buildJobDedupeKey);
  const outputHash = canonicalStringSetSha256(currentKeys);
  if (identity.batchKind === "FULL_RELEASE" && !input.trustedOracle) throw new Error("FULL_RELEASE independent source/surface oracle is required");
  if (input.trustedOracle) assertExactIndependentCompletenessEvidence(input.trustedOracle,
    plan.source.id, evidence, input.artifacts, identity);
  const projection = input.trustedOracle ? sourceOracleProjection(input.trustedOracle, plan.source.id) : undefined;
  const trustedMembers = input.trustedOracle?.artifact.members.filter((member) => member.sourceId === plan.source.id) ?? [];
  const oracleAudited = projection ? { ...projection,
    artifactLogicalKeyToSurfaceId: Object.fromEntries(trustedMembers.flatMap((member) => member.expectedArtifacts.map((a) => [a.logicalKey, member.surfaceId]))),
    artifactLogicalKeyToChannelId: Object.fromEntries(trustedMembers.flatMap((member) => member.expectedArtifacts.map((a) => [a.logicalKey, member.channelId])))
  } : input.oracle?.sources[plan.source.id];
  const stagedProjection = identity.batchKind === "FULL_RELEASE" ? undefined : stagedPlanOfficialProjection(plan);
  const stagedBindingMatchesPending = stagedProjection !== undefined &&
    canonicalStringSetSha256(stagedProjection.officialSurfaceIds) === canonicalStringSetSha256(pending.officialSurfaceIds) &&
    canonicalStringSetSha256(stagedProjection.officialChannelIds) === canonicalStringSetSha256(pending.officialChannelIds);
  const expectedSurfaceIds = oracleAudited?.officialSurfaceIds ??
    (stagedBindingMatchesPending ? pending.officialSurfaceIds : []);
  const expectedChannelIds = oracleAudited?.officialChannelIds ??
    (stagedBindingMatchesPending ? pending.officialChannelIds : []);
  const visitedSurfaces = oracleAudited ? evidence.artifacts.flatMap((artifact) =>
    oracleAudited.artifactLogicalKeyToSurfaceId[artifact.logicalKey] ?? []) :
    stagedBindingMatchesPending && evidence.artifacts.length > 0 ? pending.officialSurfaceIds : [];
  const visitedChannels = oracleAudited ? evidence.artifacts.flatMap((artifact) =>
    oracleAudited.artifactLogicalKeyToChannelId[artifact.logicalKey] ?? []) :
    stagedBindingMatchesPending && sourceCompletenessVerified ? pending.officialChannelIds :
      evidence.pages.flatMap((page) => page.channelId ?? []);
  const expectedSurface = expectedSurfaceIds.length > 0 ? canonicalStringSetSha256(expectedSurfaceIds) : null;
  const visitedSurface = expectedSurface !== null ? canonicalStringSetSha256(visitedSurfaces) : null;
  const expectedChannel = expectedChannelIds.length > 0 ? canonicalStringSetSha256(expectedChannelIds) : null;
  const visitedChannel = expectedChannel !== null ? canonicalStringSetSha256(visitedChannels) : null;
  const sourceBindingVerified = input.trustedOracle ? true : oracleAudited
    ? canonicalStringSetSha256(oracleAudited.officialSurfaceIds) === canonicalStringSetSha256(visitedSurfaces) &&
      canonicalStringSetSha256(oracleAudited.officialChannelIds) === canonicalStringSetSha256(visitedChannels)
    : stagedBindingMatchesPending;
  const completenessAnomalyTriggerCodes = input.completenessAnomalyTriggerCodes
    ? canonicalCompletenessAnomalyTriggerCodes(input.completenessAnomalyTriggerCodes)
    : [];
  const anomalyValidationSatisfied = completenessAnomalyTriggerCodes.length === 0 || (!portableMode && certificateCertified);
  const completenessVerified = sourceCompletenessVerified && sourceBindingVerified && anomalyValidationSatisfied;
  const baselineTransition = completenessVerified && baselineProof
    ? transitionTrustedCompletenessBaseline({
        previous: input.trustedCompletenessBaseline ?? null,
        verified: {
          sourceId: plan.source.id,
          sourceResultId: pending.id,
          sourceConfigSha256: pending.sourceConfigHash,
          certificateGrade: baselineProof.kind,
          certificateSha256: baselineProof.sha256,
          certifiedJobCount: ledger.dedupeOutputCount,
          verifiedAt: finishedAt.toISOString()
        }
      })
    : undefined;
  const incompleteBlocker = completenessVerified ? undefined : {
    blockerCode: completenessAnomalyTriggerCodes.length > 0
      ? "COMPLETENESS_ANOMALY_UNVERIFIED"
      : qualityRequired && !qualityAccepted
      ? "SOURCE_QUALITY_ADMISSION_REJECTED"
      : certificateRequired && !certificateCertified
      ? aGradeCertificateRequired
        ? "A_GRADE_CERTIFICATE_NOT_ISSUED"
        : input.independentTraversalFailureCode ?? "B_GRADE_CERTIFICATE_NOT_ISSUED"
      : oracleAudited || stagedBindingMatchesPending
      ? "COMPLETENESS_NOT_VERIFIED"
      : "SOURCE_SURFACE_ORACLE_MISSING",
    blockerReason: completenessAnomalyTriggerCodes.length > 0
      ? `Completeness anomaly requires successful independent validation: ${completenessAnomalyTriggerCodes.join(",")}`
      : qualityRequired && !qualityAccepted
      ? "The owned source acquisition did not satisfy the reviewed plan-bound quality policy"
      : certificateRequired && !certificateCertified
      ? input.independentTraversalFailureCode
        ? input.independentTraversalFailureReason ??
          "B-grade independent traversal failed at a closed diagnostic stage"
        : `${aGradeCertificateRequired ? "A-grade official-total" : "B-grade independent-traversal"} certificate was not issued: ${certificateDecision?.status === "REJECTED"
          ? certificateDecision.blockerCodes.join(",")
          : aGradeCertificateRequired ? "PAGINATION_NOT_VERIFIED" : "INDEPENDENT_VALIDATION_MISSING"}`
      : oracleAudited || stagedBindingMatchesPending
      ? result.observation.completenessBlockerReason ?? "Strict completeness gate was not satisfied"
      : "Audited source-surface oracle is missing"
  };
  // These decisions are transaction candidates only. They become true only if the enclosing atomic commit succeeds.
  const manualPreview = identity.batchKind === "MANUAL_SOURCE";
  if (completenessVerified && !manualPreview && hasNovartisOfficialPresencePlan(plan)) replayNovartisOfficialPresence(plan,evidence);
  if (completenessVerified && !manualPreview) assertServierUnknownLifecyclePreserved(plan, evidence, input.previousJobs.map(job => job.record));
  const unknownKeys=new Set<string>();
  if(completenessVerified&&!manualPreview){
    if(hasNovartisPartitionEvidence(evidence)){
      const urls=replayNovartisNativePartitions(plan,evidence).unknownUrls;
      for(const old of input.previousJobs)if(urls.has(old.record.officialUrl))unknownKeys.add(old.dedupeKey);
    }
    if(plan.source.id==="source-roche-china-social"){
      const ids=rocheQuarantinedSourceJobIds(evidence);
      for(const old of input.previousJobs)if(ids.has(old.record.sourceJobId??""))unknownKeys.add(old.dedupeKey);
    }
    if(isPfizerWorkdayTraversalPlan(plan)){
      for(const id of pfizerQuarantinedOfficialIds(evidence)){
        const matches=input.previousJobs.filter(old=>{
          if(!old.record.officialUrl.startsWith(PFIZER_ENTRY+"/job/"))return false;
          const path=old.record.officialUrl.slice(PFIZER_ENTRY.length);
          return new RegExp(`_${id}(?:-\\d+)?$`,"u").test(path)&&old.record.sourceId===plan.source.id&&old.record.sourceJobId===pfizerSourceJobId(path);
        });
        if(matches.length>1)throw Error("PFIZER_UNKNOWN_PRIOR_IDENTITY_AMBIGUOUS");
        for(const old of matches)unknownKeys.add(old.dedupeKey);
      }
    }
    if(currentKeys.some(key=>unknownKeys.has(key)))throw Error("UNKNOWN_JOB_CANNOT_BE_CURRENT");
  }
  const currentKeySet=new Set(currentKeys);
  const reducedLifecycle = !qualityRequired && sourceBindingVerified && !manualPreview ? applyCrawlObservation(
    input.previousJobs,
    result.jobs,
    {
      observation: completenessVerified
        ? { disposition: "TRUSTED_COMPLETE", atomicCommitEligible: true }
        : { disposition: "TRUSTED_PARTIAL", atomicCommitEligible: true },
      observedAt: finishedAt.toISOString(),
      baselineCompletedBeforeCrawl: input.baselineCompletedBeforeCrawl
    }
  ).map(decision=>{
    if(!unknownKeys.has(decision.dedupeKey))return decision;
    const old=input.previousJobs.find(job=>job.dedupeKey===decision.dedupeKey)!;
    return {...old,missingSuccessfulCrawlCount:old.lifecycleStatus==="ACTIVE"?1:old.missingSuccessfulCrawlCount,isNew:false};
  }) : [];
  const qualityCommands = qualityAccepted && completenessVerified ? buildSourceQualityJobCommands({
    plan, result, admission: qualityAdmission, previousJobs: input.previousJobs,
    firstAcceptedCurrentPolicyReceipt: input.firstAcceptedCurrentPolicyReceipt!,
    baselineCompletedBeforeCrawl: input.baselineCompletedBeforeCrawl
  }).jobCommands : undefined;
  const lifecycle = qualityCommands ?? (completenessVerified
    ? reducedLifecycle
    : lastGoodMode || completenessAnomalyTriggerCodes.length > 0
      ? []
      : reducedLifecycle.filter(({ dedupeKey }) => currentKeySet.has(dedupeKey)));
  // Only source-replayed UNKNOWN identities may retain old ACTIVE membership.
  for(const held of lifecycle.filter(x=>["source-novartis-social","source-pfizer-china-social","source-roche-china-social"].includes(plan.source.id)&&x.lifecycleStatus==="ACTIVE"&&x.missingSuccessfulCrawlCount===1)){
    const old=input.previousJobs.find(job=>job.dedupeKey===held.dedupeKey);
    if(!unknownKeys.has(held.dedupeKey)||!old||old.lifecycleStatus!=="ACTIVE"||held.lastSeenAt!==old.lastSeenAt||
      !isDeepStrictEqual(held.record,old.record))throw Error("UNKNOWN_GRACE_REQUIRES_PRIOR_ACTIVE_IDENTITY");
  }
  const graceKeys = lifecycle.filter((x) => !currentKeySet.has(x.dedupeKey) && x.lifecycleStatus === "ACTIVE" &&
    x.missingSuccessfulCrawlCount === 1).map((x) => x.dedupeKey);
  const visibleKeys = lifecycle.filter((x) => x.lifecycleStatus === "ACTIVE").map((x) => x.dedupeKey);
  const graceHash = canonicalStringSetSha256(graceKeys);
  const visibleHash = canonicalStringSetSha256(visibleKeys);
  const artifacts = input.artifacts.map((archived) => {
    return { ...tuple, id: archived.id, logicalKey: archived.logicalKey,
      ...(archived.channelId ? { channelId: archived.channelId } : {}), kind: archived.kind,
      ...(archived.requestedUrl ? { requestedUrl: archived.requestedUrl } : {}),
      ...(archived.finalUrl ? { finalUrl: archived.finalUrl } : {}),
      ...(archived.httpStatus ? { httpStatus: archived.httpStatus } : {}),
      ...(archived.contentType ? { contentType: archived.contentType } : {}),
      capturedAt: archived.capturedAt, sha256: archived.sha256, byteCount: archived.byteCount,
      path: archived.path, extractorLocator: archived.extractorLocator,
      captureToolName: archived.captureToolName, captureToolVersion: archived.captureToolVersion,
      redactionCommitmentSha256: archivedRedactionCommitment(archived) };
  });
  const lossLedger = [
    ...evidence.fetchLosses.map((loss) => ({ ...tuple, stage: loss.stage, reason: loss.reason,
      rawLocator: loss.rawLocator, details: loss.details,
      ...(loss.recordedAt ? { recordedAt: new Date(loss.recordedAt) } : {}) })),
    ...ledger.adapterLosses.map((loss) => ({ ...tuple, stage: "NORMALIZATION" as const,
      reason: loss.reason, rawLocator: `adapter:${loss.rawIndex}`,
      details: { code: loss.reason, recordIndex: loss.rawIndex } })),
    ...ledger.collisionGroups.flatMap((group) => group.candidateKeySha256.slice(1).map((candidate) => ({
      ...tuple, stage: "DEDUPE" as const, reason: group.dropReason,
      rawLocator: `collision:${group.dedupeKeySha256}`, details: { code: group.dropReason,
        collisionGroupKey: group.dedupeKeySha256 }, candidateKey: candidate, winnerKey: group.winnerKeySha256
    })))
  ];
  const officialLogicalKey = evidence.declaredCompleteness?.artifactLogicalKey ?? evidence.artifacts[0]!.logicalKey;
  const observationForCommit = committedObservation(
    result,
    evidence,
    completenessVerified,
    incompleteBlocker?.blockerReason
  );
  const completenessState = completenessVerified
    ? "VERIFIED"
    : observationForCommit.completenessStatus === "NEEDS_MANUAL_COMPLETENESS_REVIEW"
      ? "NEEDS_MANUAL_COMPLETENESS_REVIEW"
      : "INCOMPLETE";
  const commit: AtomicSourceEvidenceCommit = {
    ...(lastGoodMode ? { publicationPolicy: "SOURCE_ATOMIC_LAST_GOOD_V1" as const } : {}),
    sourceResult: { id: pending.id, releaseCandidateId: identity.releaseCandidateId, batchId,
      sourceId: plan.source.id, transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
      completenessState,
      atomicCommitState: "COMMITTED", sourceConfigHash: pending.sourceConfigHash,
      adapterVersion: pending.adapterVersion, officialEntryId: pending.officialEntryId,
      officialSurfaceIds: pending.officialSurfaceIds, officialChannelIds: pending.officialChannelIds,
      startedAt: pending.startedAt, finishedAt, rawCount: evidence.fetchCounts.rawCount,
      parsedCount: evidence.fetchCounts.parsedCount, validCount: evidence.fetchCounts.validCount,
      normalizedCount: ledger.validBeforeDedupeCount, dedupeInputCount: ledger.dedupeInputCount,
      dedupeOutputCount: ledger.dedupeOutputCount, parseDiscardCount: evidence.fetchCounts.parseDiscardCount,
      validationDiscardCount: evidence.fetchCounts.validationDiscardCount,
      normalizationDiscardCount: ledger.adapterLosses.length,
      dedupeDiscardCount: ledger.dedupeInputCount - ledger.dedupeOutputCount,
      collisionCount: ledger.collisionGroups.length, discardCount: evidence.fetchCounts.parseDiscardCount +
        evidence.fetchCounts.validationDiscardCount + ledger.adapterLosses.length +
        (ledger.dedupeInputCount - ledger.dedupeOutputCount),
      expectedJobCount: result.observation.expectedJobCount ?? null,
      expectedEvidenceKind: result.observation.completenessEvidenceKind ?? null,
      expectedSurfaceSha256: expectedSurface, visitedSurfaceSha256: visitedSurface,
      expectedChannelSha256: expectedChannel, visitedChannelSha256: visitedChannel,
      canonicalCurrentJobSetSha256: outputHash, canonicalGraceJobSetSha256: graceHash,
      canonicalVisibleJobSetSha256: visibleHash, canonicalOutputSetSha256: outputHash,
      adapterInputCount: ledger.rawInputCount, adapterOutputCount: ledger.dedupeOutputCount,
      adapterLossCount: ledger.adapterLosses.length + (ledger.dedupeInputCount-ledger.dedupeOutputCount),
      adapterCollisionGroupCount: ledger.collisionGroups.length,
      adapterReconciliationSha256: ledger.ledgerSha256, collisionLedgerSha256: sha256(canonicalJson(ledger.collisionGroups)),
      completenessCertificate: qualityAccepted && completenessVerified ? qualityAdmission.receipt : certificateCertified ? certificateDecision.certificate : null,
      completenessCertificateSha256: qualityAccepted && completenessVerified ? qualityAdmission.receiptSha256 : certificateCertified ? certificateDecision.certificateSha256 : null,
      ...(baselineTransition ? {
        baselinePreviousSourceResultId: baselineTransition.previousSourceResultId,
        baselinePreviousJobCount: baselineTransition.previousJobCount,
        baselineChangeReason: baselineTransition.changeReason
      } : {}),
      failureCategory: null, failureDiagnosticCode: null,
      fetchAttemptCount: attemptTracker.fetchAttemptCount, retryCount: attemptTracker.retryCount,
      retryReasonCodes: [...attemptTracker.retryReasonCodes],
      ...(incompleteBlocker ?? {}) },
    observationProvenance: { ...tuple, commitSha: identity.commitSha, rosterSha256: identity.rosterSha256,
      sourcePlanSha256: identity.sourcePlanSha256, sourceConfigSha256: pending.sourceConfigHash,
      adapterVersion: pending.adapterVersion, observedFrom: pending.startedAt, observedTo: finishedAt,
      transportSucceeded: true, adapterSucceeded: true, completenessVerified,
      atomicCommitSucceeded: true, canonicalRawSha256: canonicalStringSetSha256(evidence.pages.flatMap((x) => x.rawJobIds)),
      canonicalOutputSha256: outputHash, canonicalGraceSha256: graceHash, canonicalVisibleSha256: visibleHash,
      expectedSurfaceSha256: expectedSurface, visitedSurfaceSha256: visitedSurface,
      expectedChannelSha256: expectedChannel, visitedChannelSha256: visitedChannel,
      paginationTraceSha256: canonicalPageTraceSha256(evidence.pages),
      officialEvidenceArtifactLogicalKey: officialLogicalKey,
      artifactRedactionCommitmentSha256: canonicalStringSetSha256(artifacts.map((x) => x.redactionCommitmentSha256)) },
    artifacts,
    pagination: evidence.pages.map((page) => ({ ...tuple, artifactLogicalKey: page.artifactLogicalKey,
      sequence: page.sequence, ...(page.channelId ? { channelId: page.channelId } : {}),
      requestedCursor: page.requestedCursor ?? null, returnedCursor: page.returnedCursor ?? null,
      requestedOffset: page.requestedOffset ?? null, returnedOffset: page.returnedOffset ?? null,
      requestedPage: page.requestedPage ?? null, returnedPage: page.returnedPage ?? null,
      requestedPageSize: page.requestedPageSize ?? null, returnedPageSize: page.returnedPageSize ?? null,
      responseFingerprintSha256: requiredSha(page.responseFingerprintSha256, "page response fingerprint"),
      rawJobIdSetSha256: canonicalStringSetSha256(page.rawJobIds), validJobIdSetSha256: canonicalStringSetSha256(page.validJobIds),
      declaredTotal: page.declaredTotal ?? null, declaredCount: page.declaredCount ?? null,
      declaredPages: page.declaredPages ?? null, nextPageSignalBefore: page.nextPageSignalBefore ?? null,
      nextPageSignalAfter: page.nextPageSignalAfter ?? null, termination: page.termination,
      anomalyCodes: page.anomalyCodes, capturedAt: new Date(page.capturedAt) })),
    lossLedger,
    priorTransportAttempts: (result.priorTransportAttempts ?? []).map((attempt, sequence) => {
      const attemptEvidence = attempt.code === "HCM_BROWSER_SUCCEEDED" || attempt.code === "JNJ_BROWSER_SUCCEEDED"
        ? result.fetchEvidence
        : attempt.fetchEvidence;
      const artifactIds = attemptEvidence?.artifacts.map((draft) => {
        const archived = input.artifacts.find((item) => item.logicalKey === draft.logicalKey);
        if (!archived) throw new Error(`missing archived prior-attempt artifact ${draft.logicalKey}`);
        return archived.id;
      }) ?? [];
      return { ...tuple, id: `${pending.id}--attempt-${sequence}`, sequence,
        transport: attempt.transport, outcome: attempt.outcome, code: attempt.code,
        capturedAt: new Date(attempt.capturedAt), artifactIds,
        evidenceCommitmentSha256: canonicalStringSetSha256(artifactIds.map((id) =>
          input.artifacts.find((artifact) => artifact.id === id)!.sha256)),
        pageTraceSha256: attemptEvidence
          ? canonicalPageTraceSha256(attemptEvidence.pages) : sha256(canonicalJson(null)),
        lossLedgerSha256: sha256(canonicalJson(attemptEvidence?.fetchLosses ?? [])),
        paginationEvaluationSha256: sha256(canonicalJson(attempt.paginationEvaluation ?? null)),
        details: { code: attempt.code } };
    }),
    commands: buildIngestionCommands({ ...result, observation: observationForCommit }, lifecycle)
  };
  if (qualityAccepted && completenessVerified) verifySourceQualityAtomicCommit({ plan, commit });
  if (qualityAccepted && plan.source.id==="source-astellas-china-social") runtimeAstellasAdmissions.set(commit,qualityAdmission);
  runtimeCommitAttestations.set(commit,attestationSignature(commit));
  return commit;
}

function committedObservation(
  result: SourceCrawlResult,
  evidence: PersistentSourceFetchEvidence,
  completenessVerified: boolean,
  blockerReason: string | undefined
): SourceCrawlResult["observation"] {
  const observation = { ...result.observation, pagesVisited: evidence.pages.length };
  if (completenessVerified) {
    observation.completenessStatus = "VERIFIED";
    if (evidence.declaredCompleteness !== undefined) {
      observation.completenessEvidenceKind = evidence.declaredCompleteness.kind;
    }
    if (evidence.declaredCompleteness?.kind === "OFFICIAL_TOTAL_COUNT") {
      observation.expectedJobCount = evidence.declaredCompleteness.value;
    }
    delete observation.completenessBlockerReason;
  } else {
    if (observation.completenessStatus === "VERIFIED") {
      observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
    }
    observation.completenessBlockerReason = blockerReason ?? "Completeness was not verified";
  }
  return observation;
}

function requiredSha(value: string | undefined, label: string): string {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is required`);
  return value;
}
