import { hashCanonicalStringSet } from "../crawler/runtimeBatchIdentity";
import type { ReleaseMember } from "../crawler/authoritativeReleaseMembership";
import { reconcileLifecycleSets, type LifecycleSetEvidence } from "./lifecycleSetReconciliation";

type ShaMap = Readonly<Record<string, string>>;
export interface StrictReadinessExpectation {
  releaseCandidateId: string; commitSha: string; rosterSha256: string;
  sourcePlanSha256: string; sourceConfigSha256: string; adapterBundleSha256: string;
  sourceTreeSha256:string;runtimeTreeSha256:string;
  plannedSourceIds: readonly string[]; plannedSourceSetSha256: string;
  sourceConfigHashes: ShaMap; adapterVersions: ShaMap;
  releaseMembers: readonly ReleaseMember[];
  currentTime: Date; freshnessMaximum: number;
}
export interface StrictReadinessSourceResult {
  id: string; sourceId: string; atomicCommitState: string; transportState: string; adapterState: string;
  completenessState: string; sourceConfigHash: string; adapterVersion: string;
  canonicalOutputSetSha256: string | null; canonicalCurrentJobSetSha256: string | null;
  canonicalGraceJobSetSha256: string | null; canonicalVisibleJobSetSha256: string | null;
  officialEvidenceArtifactId: string | null; artifactRedactionCommitmentSha256: string | null;
  lifecycleSetEvidence?: LifecycleSetEvidence;
}
export interface StrictReadinessBatch {
  id: string; releaseCandidateId: string; commitSha: string; rosterSha256: string;
  sourcePlanSha256: string; sourceConfigSha256: string; adapterBundleSha256: string;
  kind: string; status: string; startedAt: Date; finishedAt: Date | null; plannedSourceIds: readonly string[];
  plannedSourceSetSha256: string; plannedSourceCount: number; aggregateJobSetSha256: string | null;
  sourceResults: readonly StrictReadinessSourceResult[];
}

export function selectStrictFullReleaseReadiness<T extends StrictReadinessBatch>(
  batches: readonly T[], expected: StrictReadinessExpectation
): readonly [T, T] {
  if (!(expected.currentTime instanceof Date) || !Number.isFinite(expected.currentTime.getTime()) ||
    !Number.isFinite(expected.freshnessMaximum) || expected.freshnessMaximum <= 0) {
    throw new Error("Readiness freshness expectation is invalid");
  }
  const identityMatches=(batch:T)=>batch.kind === "FULL_RELEASE" && batch.startedAt instanceof Date &&
    Number.isFinite(batch.startedAt.getTime()) && ["releaseCandidateId", "commitSha", "rosterSha256",
      "sourcePlanSha256", "sourceConfigSha256", "adapterBundleSha256"].every((field) =>
      batch[field as keyof T] === expected[field as keyof StrictReadinessExpectation]);
  const matching = batches.filter(identityMatches)
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
  const exact = matching.filter((batch)=>batch.status === "SUCCESS"&&batch.finishedAt instanceof Date)
    .sort((left,right)=>right.finishedAt!.getTime()-left.finishedAt!.getTime());
  if (exact.length < 2) throw new Error("Readiness requires at least two exact completed FULL_RELEASE batches");
  const selected = exact.slice(0, 2) as [T, T];
  const olderSelectedBoundary=selected[1].startedAt.getTime();
  if(matching.some(batch=>batch.startedAt.getTime()>olderSelectedBoundary&&
    (batch.status!=="SUCCESS"||!(batch.finishedAt instanceof Date)))){
    throw new Error("A newer failed, pending, or otherwise unreconciled FULL_RELEASE batch blocks readiness");
  }
  if (selected[0].id === selected[1].id || selected[0].finishedAt!.getTime() <= selected[1].finishedAt!.getTime()) {
    throw new Error("Readiness batches must be distinct and strictly ordered");
  }
  for (const batch of selected) validateBatch(batch, expected);
  return selected;
}

function validateBatch(batch: StrictReadinessBatch, expected: StrictReadinessExpectation): void {
  const age = expected.currentTime.getTime() - batch.finishedAt!.getTime();
  if (age < 0 || age >= expected.freshnessMaximum) {
    throw new Error(`Readiness batch ${batch.id} is not fresh`);
  }
  const planned = [...expected.plannedSourceIds].sort();
  if (batch.plannedSourceCount !== planned.length || batch.plannedSourceSetSha256 !== expected.plannedSourceSetSha256 ||
    expected.plannedSourceSetSha256 !== hashCanonicalStringSet(planned) ||
    JSON.stringify([...batch.plannedSourceIds].sort()) !== JSON.stringify(planned)) {
    throw new Error("Readiness planned source denominator mismatch");
  }
  if (batch.sourceResults.length !== planned.length || new Set(batch.sourceResults.map((x) => x.sourceId)).size !== planned.length) {
    throw new Error("Readiness source-result denominator mismatch");
  }
  for (const sourceId of planned) {
    const source = batch.sourceResults.find((row) => row.sourceId === sourceId);
    if (!source || source.atomicCommitState !== "COMMITTED" || source.transportState !== "SUCCEEDED" ||
      source.adapterState !== "SUCCEEDED" || source.completenessState !== "VERIFIED") {
      throw new Error(`Readiness source ${sourceId} is not strict committed verified truth`);
    }
    if (source.sourceConfigHash !== expected.sourceConfigHashes[sourceId] ||
      source.adapterVersion !== expected.adapterVersions[sourceId]) {
      throw new Error(`Readiness source ${sourceId} config or adapter mismatch`);
    }
    if (![source.canonicalOutputSetSha256, source.canonicalCurrentJobSetSha256,
      source.canonicalGraceJobSetSha256, source.canonicalVisibleJobSetSha256,
      source.artifactRedactionCommitmentSha256].every(validSha) || !source.officialEvidenceArtifactId?.trim()) {
      throw new Error(`Readiness source ${sourceId} is missing canonical hashes or evidence references`);
    }
    if(!source.lifecycleSetEvidence)throw new Error(`Readiness source ${sourceId} is missing persisted lifecycle set evidence`);
    if(source.lifecycleSetEvidence.releaseCandidateId!==batch.releaseCandidateId||source.lifecycleSetEvidence.batchId!==batch.id||
      source.lifecycleSetEvidence.sourceResultId!==source.id||source.lifecycleSetEvidence.sourceId!==source.sourceId)throw new Error(`Readiness source ${sourceId} lifecycle set tuple mismatch`);
    const sets=reconcileLifecycleSets(source.lifecycleSetEvidence);
    if(sets.currentSha256!==source.canonicalOutputSetSha256||sets.currentSha256!==source.canonicalCurrentJobSetSha256||sets.graceSha256!==source.canonicalGraceJobSetSha256||
      sets.visibleSha256!==source.canonicalVisibleJobSetSha256)throw new Error(`Readiness source ${sourceId} lifecycle set evidence hash mismatch`);
  }
  if (!validSha(batch.aggregateJobSetSha256)) throw new Error("Readiness aggregate job-set hash is missing");
}

const validSha = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
