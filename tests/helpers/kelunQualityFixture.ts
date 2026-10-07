/** Test/export helper: all transport bytes and runtime identities are synthetic, never live evidence. */
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { KELUN_ENTRY } from "../../src/crawler/kelunMainlandScope";

export const KELUN_SYNTHETIC_FIXTURE_KIND = "PURE_SYNTHETIC_NOT_PRODUCTION_EVIDENCE";
export const syntheticKelunRow = (id: string, location: string, visible = location) => `<tr><td><a href="/job_show/${id}">合成职位 ${id}</a></td><td></td><td></td><td></td><td title="${location}">${visible}</td></tr>`;
export const syntheticKelunPage = (rows: string[], totalPages = 1) => `<div class="page">${Array.from({length: totalPages}, (_, i) => `<a href="/social?r=&p=1%5E2&c=&d=&k=&PageIndex=${i+1}">${i+1}</a>`).join("")}</div><table class="jobsTable">${rows.join("")}</table>`;

export async function captureSyntheticKelunQuality(workspaceRoot: string, bodies = [syntheticKelunPage([syntheticKelunRow("990002001", "上海市")])]) {
  const plan = structuredClone(buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-kelun-social")!);
  const originalFetch = globalThis.fetch;
  const requests: Array<{url: string; method: string}> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    requests.push({url, method});
    const coordinate = new URL(url);
    const page = Number(coordinate.searchParams.get("PageIndex") ?? "1");
    if (coordinate.origin !== new URL(KELUN_ENTRY).origin || coordinate.pathname !== "/social" || coordinate.searchParams.get("p") !== "1^2" || method !== "GET" || !bodies[page - 1] || requests.length > bodies.length) throw Error("SYNTHETIC_KELUN_UNEXPECTED_REQUEST");
    const response = new Response(bodies[page - 1], {status: 200, headers: {"content-type": "text/html"}});
    Object.defineProperty(response, "url", {value: url});
    return response;
  };
  const startedAt = new Date();
  let result;
  try { result = await runSourceCrawl(plan, {fetch: createOwnedSourceQualityFetch(), isBaseline: false}); }
  finally { globalThis.fetch = originalFetch; }
  if (!result.fetchEvidence) throw Error("SYNTHETIC_KELUN_MISSING_EVIDENCE");
  const binding = {releaseCandidateId: "synthetic-kelun-replay", batchId: "synthetic-kelun-batch", sourceResultId: `synthetic-kelun-batch--${plan.source.id}`,
    sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: "a".repeat(64)};
  const evidenceSubdirectory = "synthetic-evidence";
  const archived = await archiveSourceEvidence({workspaceRoot, ...binding, sourceId: plan.source.id, evidenceSubdirectory,
    captureTool: result.fetchEvidence.captureTool, artifacts: bindRuntimeEvidenceArtifactIds({...binding, sourceId: plan.source.id, artifacts: result.fetchEvidence.artifacts})});
  return {classification: KELUN_SYNTHETIC_FIXTURE_KIND, plan, result, binding, startedAt, requests,
    archive: {workspaceRoot, evidenceSubdirectory, artifacts: archived.artifacts}};
}

export async function buildSyntheticKelunAtomicFixture(input: Awaited<ReturnType<typeof captureSyntheticKelunQuality>>) {
  const identity = {releaseCandidateId: input.binding.releaseCandidateId, commitSha: "a".repeat(40), rosterSha256: "a".repeat(64),
    sourcePlanSha256: "a".repeat(64), sourceConfigSha256: "a".repeat(64), adapterBundleSha256: "a".repeat(64), batchKind: "SCHEDULED" as const,
    ownerId: "synthetic-kelun-fixture", expectedPlannedSourceIds: [input.plan.source.id], expectedPlannedSourceSetSha256: "a".repeat(64), expectedPlannedSourceCount: 1};
  const pending = buildPendingRuntimeBatch(input.binding.batchId, [input.plan], identity, input.startedAt).sources[0]!;
  input.binding.adapterVersion = pending.adapterVersion;
  const admission = await issueSourceQualityAdmission(input);
  if (admission.status !== "ACCEPTED") throw Error(`SYNTHETIC_KELUN_ADMISSION_REJECTED:${admission.codes.join(",")}`);
  const commit = buildAtomicRuntimeCommit({plan: input.plan, pending, identity, batchId: input.binding.batchId, result: input.result,
    previousJobs: [], baselineCompletedBeforeCrawl: true, artifacts: input.archive.artifacts,
    sourceAdmissionPolicy: "PLAN_BOUND_SOURCE_QUALITY_V1", sourceQualityAdmission: admission, firstAcceptedCurrentPolicyReceipt: null});
  return {identity, pending, admission, commit};
}
