import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  PlannedBatchWithSourcesInput,
  PlannedPendingSourceInput
} from "../db/ingestionRepository";
import type { RuntimeBatchIdentity } from "./runtimeBatchIdentity";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import type { SourceCrawlResult } from "./runSourceCrawl";
import { applyCrawlObservation, type JobSnapshot } from "./lifecycle";
import { buildIngestionCommands } from "./ingestion";
import { buildJobDedupeKey } from "./normalizedJob";
import { assertAdapterReconciliation } from "./adapters/reconciliation";
import {
  canonicalPageTraceSha256,
  canonicalStringSetSha256,
  type PersistentSourceFetchEvidence
} from "./sourceFetchEvidence";
import type { ArchivedEvidenceArtifact } from "./artifactArchive";
import type { AtomicSourceEvidenceCommit } from "../db/ingestionRepository";
import type { StartupTrustedSourceSurfaceOracle } from "./sourceSurfaceOracleAuthority";
import { assertExactIndependentCompletenessEvidence, sourceOracleProjection } from "./independentSourceSurfaceOracle";

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const attestationKey=randomBytes(32);
const runtimeCommitAttestations=new WeakMap<AtomicSourceEvidenceCommit,Buffer>();

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

function attestationSignature(commit:AtomicSourceEvidenceCommit):Buffer {
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

export function buildAtomicRuntimeCommit(input: {
  plan: SourceCrawlPlan;
  pending: PlannedPendingSourceInput;
  identity: RuntimeBatchIdentity;
  batchId: string;
  result: SourceCrawlResult;
  previousJobs: readonly JobSnapshot[];
  baselineCompletedBeforeCrawl: boolean;
  artifacts: readonly ArchivedEvidenceArtifact[];
  oracle?: AuditedSourceSurfaceOracle;
  trustedOracle?: StartupTrustedSourceSurfaceOracle;
}): AtomicSourceEvidenceCommit {
  const { plan, pending, identity, batchId, result } = input;
  if (!result.truth.transportSuccess || !result.truth.adapterSuccess || !result.fetchEvidence) {
    throw new Error("atomic runtime commit requires successful transport, adapter and strict fetch evidence");
  }
  const ledger = assertAdapterReconciliation(result);
  const evidence = result.fetchEvidence;
  const tuple = { releaseCandidateId: identity.releaseCandidateId, batchId,
    sourceId: plan.source.id, sourceResultId: pending.id };
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
    stagedBindingMatchesPending && result.truth.completenessVerified ? pending.officialChannelIds :
      evidence.pages.flatMap((page) => page.channelId ?? []);
  const expectedSurface = expectedSurfaceIds.length > 0 ? canonicalStringSetSha256(expectedSurfaceIds) : null;
  const visitedSurface = expectedSurface !== null ? canonicalStringSetSha256(visitedSurfaces) : null;
  const expectedChannel = expectedChannelIds.length > 0 ? canonicalStringSetSha256(expectedChannelIds) : null;
  const visitedChannel = expectedChannel !== null ? canonicalStringSetSha256(visitedChannels) : null;
  const sourceBindingVerified = input.trustedOracle ? true : oracleAudited
    ? canonicalStringSetSha256(oracleAudited.officialSurfaceIds) === canonicalStringSetSha256(visitedSurfaces) &&
      canonicalStringSetSha256(oracleAudited.officialChannelIds) === canonicalStringSetSha256(visitedChannels)
    : stagedBindingMatchesPending;
  const completenessVerified = result.truth.completenessVerified && sourceBindingVerified;
  const finishedAt = result.observation.crawledAt;
  // These decisions are transaction candidates only. They become true only if the enclosing atomic commit succeeds.
  const manualPreview = identity.batchKind === "MANUAL_SOURCE";
  const currentKeySet=new Set(currentKeys);
  const reducedLifecycle = sourceBindingVerified && !manualPreview ? applyCrawlObservation(
    input.previousJobs,
    result.jobs,
    {
      observation: completenessVerified
        ? { disposition: "TRUSTED_COMPLETE", atomicCommitEligible: true }
        : { disposition: "TRUSTED_PARTIAL", atomicCommitEligible: true },
      observedAt: finishedAt.toISOString(),
      baselineCompletedBeforeCrawl: input.baselineCompletedBeforeCrawl
    }
  ) : [];
  const lifecycle = completenessVerified
    ? reducedLifecycle
    : reducedLifecycle.filter(({ dedupeKey }) => currentKeySet.has(dedupeKey));
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
  const commit: AtomicSourceEvidenceCommit = {
    sourceResult: { id: pending.id, releaseCandidateId: identity.releaseCandidateId, batchId,
      sourceId: plan.source.id, transportState: "SUCCEEDED", adapterState: "SUCCEEDED",
      completenessState: completenessVerified
        ? "VERIFIED"
        : result.observation.completenessStatus === "NEEDS_MANUAL_COMPLETENESS_REVIEW"
          ? "NEEDS_MANUAL_COMPLETENESS_REVIEW"
          : "INCOMPLETE",
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
      ...(completenessVerified ? {} : {
        blockerCode: oracleAudited || stagedBindingMatchesPending
          ? "COMPLETENESS_NOT_VERIFIED"
          : "SOURCE_SURFACE_ORACLE_MISSING",
        blockerReason: oracleAudited || stagedBindingMatchesPending
          ? result.observation.completenessBlockerReason ?? "Strict completeness gate was not satisfied"
          : "Audited source-surface oracle is missing"
      }) },
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
      const artifactIds = attempt.fetchEvidence?.artifacts.map((draft) => {
        const archived = input.artifacts.find((item) => item.logicalKey === draft.logicalKey);
        if (!archived) throw new Error(`missing archived prior-attempt artifact ${draft.logicalKey}`);
        return archived.id;
      }) ?? [];
      return { ...tuple, id: `${pending.id}--attempt-${sequence}`, sequence,
        transport: attempt.transport, outcome: attempt.outcome, code: attempt.code,
        capturedAt: new Date(attempt.capturedAt), artifactIds,
        evidenceCommitmentSha256: canonicalStringSetSha256(artifactIds.map((id) =>
          input.artifacts.find((artifact) => artifact.id === id)!.sha256)),
        pageTraceSha256: attempt.fetchEvidence
          ? canonicalPageTraceSha256(attempt.fetchEvidence.pages) : sha256(canonicalJson(null)),
        lossLedgerSha256: sha256(canonicalJson(attempt.fetchEvidence?.fetchLosses ?? [])),
        paginationEvaluationSha256: sha256(canonicalJson(attempt.paginationEvaluation ?? null)),
        details: { code: attempt.code } };
    }),
    commands: buildIngestionCommands(result, lifecycle)
  };
  runtimeCommitAttestations.set(commit,attestationSignature(commit));
  return commit;
}

function requiredSha(value: string | undefined, label: string): string {
  if (!value || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} is required`);
  return value;
}
