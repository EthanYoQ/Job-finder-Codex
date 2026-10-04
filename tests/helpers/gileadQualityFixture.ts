/** Test/export helper: all transport bytes and runtime identities are synthetic, never live evidence. */
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { GILEAD_ENDPOINT, GILEAD_SYNTHETIC_FIXTURE_KIND, syntheticGileadBody } from "./gileadYello";

export async function captureSyntheticGileadQuality(workspaceRoot: string, body = syntheticGileadBody()) {
  const plan = structuredClone(buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-gilead-china-social")!);
  const originalFetch = globalThis.fetch;
  const requests: Array<{url: string; method: string}> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    requests.push({url, method});
    if (url !== GILEAD_ENDPOINT || method !== "GET" || requests.length > 1) throw Error("SYNTHETIC_GILEAD_UNEXPECTED_REQUEST");
    const response = new Response(body, {status: 200, headers: {"content-type": "application/json"}});
    Object.defineProperty(response, "url", {value: url});
    return response;
  };
  const startedAt = new Date();
  let result;
  try { result = await runSourceCrawl(plan, {fetch: createOwnedSourceQualityFetch(), isBaseline: false}); }
  finally { globalThis.fetch = originalFetch; }
  if (!result.fetchEvidence) throw Error("SYNTHETIC_GILEAD_MISSING_EVIDENCE");
  const binding = {releaseCandidateId: "synthetic-gilead-replay", batchId: "synthetic-gilead-batch", sourceResultId: `synthetic-gilead-batch--${plan.source.id}`,
    sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: "a".repeat(64)};
  const evidenceSubdirectory = "synthetic-evidence";
  const archived = await archiveSourceEvidence({workspaceRoot, ...binding, sourceId: plan.source.id, evidenceSubdirectory,
    captureTool: result.fetchEvidence.captureTool, artifacts: bindRuntimeEvidenceArtifactIds({...binding, sourceId: plan.source.id, artifacts: result.fetchEvidence.artifacts})});
  return {classification: GILEAD_SYNTHETIC_FIXTURE_KIND, plan, result, binding, startedAt, requests,
    archive: {workspaceRoot, evidenceSubdirectory, artifacts: archived.artifacts}};
}

export async function buildSyntheticGileadAtomicFixture(input: Awaited<ReturnType<typeof captureSyntheticGileadQuality>>) {
  const identity = {releaseCandidateId: input.binding.releaseCandidateId, commitSha: "a".repeat(40), rosterSha256: "a".repeat(64),
    sourcePlanSha256: "a".repeat(64), sourceConfigSha256: "a".repeat(64), adapterBundleSha256: "a".repeat(64), batchKind: "SCHEDULED" as const,
    ownerId: "synthetic-gilead-fixture", expectedPlannedSourceIds: [input.plan.source.id], expectedPlannedSourceSetSha256: "a".repeat(64), expectedPlannedSourceCount: 1};
  const pending = buildPendingRuntimeBatch(input.binding.batchId, [input.plan], identity, input.startedAt).sources[0]!;
  input.binding.adapterVersion = pending.adapterVersion;
  const admission = await issueSourceQualityAdmission(input);
  if (admission.status !== "ACCEPTED") throw Error(`SYNTHETIC_GILEAD_ADMISSION_REJECTED:${admission.codes.join(",")}`);
  const commit = buildAtomicRuntimeCommit({plan: input.plan, pending, identity, batchId: input.binding.batchId, result: input.result,
    previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: input.archive.artifacts,
    sourceAdmissionPolicy: "PLAN_BOUND_SOURCE_QUALITY_V1", sourceQualityAdmission: admission, firstAcceptedCurrentPolicyReceipt: null});
  return {identity, pending, admission, commit};
}
