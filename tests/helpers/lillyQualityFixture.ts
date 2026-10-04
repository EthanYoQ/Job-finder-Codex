/** Test/export helper: all transport bytes and runtime identities are synthetic, never live evidence. */
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { LILLY_SYNTHETIC_FIXTURE_KIND, captureSyntheticLilly, syntheticLillyNativeDetailBody, syntheticLillyRow } from "./lillyPhenom";

export function syntheticLillyCohort() {
  return Array.from({length: 88}, (_, index) => {
    const row = syntheticLillyRow(index, {postedDate: index < 84 ? "2026-09-29T00:00:00.000+0000" : "2025-11-12T00:00:00.000+0000"});
    if (index < 69) row.applyUrl = String(row.applyUrl).replace("China-Shang-Hai-", "China-Bei-Jing-");
    return row;
  });
}
export async function captureSyntheticLillyQuality(workspaceRoot: string, rows?: Record<string, unknown>[]) {
  const cohort = rows ?? syntheticLillyCohort();
  // The default cohort deliberately includes 69 native details without a reviewed city.
  // A list/apply-URL contradiction alone no longer overrides the native detail locality.
  const detailBodies = rows ? undefined : Object.fromEntries(cohort.map((row, index) => [String(row.applyUrl),
    syntheticLillyNativeDetailBody(row, {jobLocation: {address: {addressCountry: "China", addressLocality: index < 69 ? "China" : "Shang Hai"}}})]));
  const {plan, result, startedAt, requests} = await captureSyntheticLilly(cohort, {owned: true, detailBodies});
  if (!result.fetchEvidence) throw Error("SYNTHETIC_LILLY_MISSING_EVIDENCE");
  const binding = {releaseCandidateId: "synthetic-lilly-replay", batchId: "synthetic-lilly-batch", sourceResultId: `synthetic-lilly-batch--${plan.source.id}`,
    sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: "a".repeat(64)};
  const evidenceSubdirectory = "synthetic-evidence";
  const archived = await archiveSourceEvidence({workspaceRoot, ...binding, sourceId: plan.source.id, evidenceSubdirectory,
    captureTool: result.fetchEvidence.captureTool, artifacts: bindRuntimeEvidenceArtifactIds({...binding, sourceId: plan.source.id, artifacts: result.fetchEvidence.artifacts})});
  return {classification: LILLY_SYNTHETIC_FIXTURE_KIND, plan, result, binding, startedAt, requests,
    archive: {workspaceRoot, evidenceSubdirectory, artifacts: archived.artifacts}};
}

export async function buildSyntheticLillyAtomicFixture(input: Awaited<ReturnType<typeof captureSyntheticLillyQuality>>) {
  const identity = {releaseCandidateId: input.binding.releaseCandidateId, commitSha: "a".repeat(40), rosterSha256: "a".repeat(64),
    sourcePlanSha256: "a".repeat(64), sourceConfigSha256: "a".repeat(64), adapterBundleSha256: "a".repeat(64), batchKind: "SCHEDULED" as const,
    ownerId: "synthetic-lilly-fixture", expectedPlannedSourceIds: [input.plan.source.id], expectedPlannedSourceSetSha256: "a".repeat(64), expectedPlannedSourceCount: 1};
  const pending = buildPendingRuntimeBatch(input.binding.batchId, [input.plan], identity, input.startedAt).sources[0]!;
  input.binding.adapterVersion = pending.adapterVersion;
  const admission = await issueSourceQualityAdmission(input);
  if (admission.status !== "ACCEPTED") throw Error(`SYNTHETIC_LILLY_ADMISSION_REJECTED:${admission.codes.join(",")}`);
  const commit = buildAtomicRuntimeCommit({plan: input.plan, pending, identity, batchId: input.binding.batchId, result: input.result,
    previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: input.archive.artifacts,
    sourceAdmissionPolicy: "PLAN_BOUND_SOURCE_QUALITY_V1", sourceQualityAdmission: admission, firstAcceptedCurrentPolicyReceipt: null});
  return {identity, pending, admission, commit};
}
