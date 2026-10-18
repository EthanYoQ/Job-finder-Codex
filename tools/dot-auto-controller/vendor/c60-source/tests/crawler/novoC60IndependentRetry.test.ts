// @vitest-environment node
// Synthetic control-flow and admission proof tests only. No retained web fixture
// is read or substituted, and no live acquisition or database operation occurs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { getPlanBySourceId, buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { runSourceCrawl, createSourceFetchAttemptTracker } from "../../src/crawler/runSourceCrawl";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch, buildAtomicRuntimeCommit, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { NOVO_CHINA_ENDPOINT, replayNovoChinaRows } from "../../src/crawler/novoChinaQuality";
import { safeOfficialJsonEvidenceUrl } from "../../src/crawler/officialJsonEvidence";
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation, OfficialHttpTimeoutError } from "../../src/crawler/officialHttpRuntimeLimits";
import type { SourceFetchArtifactDraft } from "../../src/crawler/sourceFetchEvidence";

const START = Date.parse("2026-10-08T04:00:00.000Z");
const BUDGET = 20 * 60_000;
import { ENTRY, detail, apply, final, listing, pages } from "../helpers/novoC60SyntheticFixture";
type Outcome = number | "timeout" | "bare-timeout" | "network" | "unknown" | "captcha" | "tls" | "late-posting" | "body-timeout" | "insufficient";
type Script = Record<string, Outcome[]>;
const directories: string[] = [];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const bodyJson = (a: SourceFetchArtifactDraft) => JSON.parse(String(a.body));

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(START);
  vi.stubEnv("P0_SOURCE_HTTP_TIMEOUT_MS", "45000"); vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", "");
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException("Synthetic request deadline", "TimeoutError")), ms); return controller.signal;
  });
});
afterEach(async () => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true })));
});

async function capture(script: Script = {}, options: { retryAfter?: string; budgetMs?: number; cancelBackoff?: boolean; gatewayBeforeRedirect?: boolean; gatewayFinalUrl?: string } = {}) {
  const calls: string[] = [], counts = new Map<string, number>(), controller = new AbortController();
  const clock = vi.spyOn(globalThis, "setTimeout");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== "string" || !pages.has(input)) throw Error("Unexpected synthetic URL");
    expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined();
    calls.push(input); const count = (counts.get(input) ?? 0) + 1; counts.set(input, count);
    const action = script[input]?.[count - 1]; const page = pages.get(input)!;
    if (action === "bare-timeout") throw new OfficialHttpTimeoutError();
    if (action === "network") throw Object.assign(Error("Synthetic network error"), { code: "ECONNRESET" });
    if (action === "timeout") return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
    const status = typeof action === "number" ? action : action === "captcha" || action === "tls" ? 502 : 200;
    const body = action === "insufficient" ? page.body.replace(
      "Develop synthetic laboratory procedures and maintain documented quality controls for research teams.","*") : action === "unknown" ? "<html>Unknown application state</html>" : action === "captcha" ? "<html>Verify you are human</html>" :
      action === "tls" ? "<html>SSL certificate verify failed</html>" : status !== 200 ? "<html>Bad Gateway</html>" : page.body;
    const response = new Response(body, { status, headers: { "content-type": page.contentType,
      ...(options.retryAfter && status !== 200 ? { "retry-after": options.retryAfter } : {}) } });
    Object.defineProperty(response, "url", { value: action === "late-posting" ? "https://careers.novonordisk.com/job/Changed/999999/" :
      typeof action === "number" && options.gatewayFinalUrl ? options.gatewayFinalUrl :
      typeof action === "number" && options.gatewayBeforeRedirect ? input : page.finalUrl });
    if (action === "body-timeout") Object.defineProperty(response, "text", { value: () => new Promise<string>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true })) });
    if (options.cancelBackoff && typeof action === "number") setTimeout(() => controller.abort(Error("Synthetic owner cancellation")), 1000);
    return response;
  }));
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novo-nordisk-china-social")!;
  const tracker = createSourceFetchAttemptTracker();
  const operation = runWithOfficialSourceCancellation(controller.signal, () => runWithOfficialSourceAttemptTimeout(() => runSourceCrawl(plan, {
    fetch: createOwnedSourceQualityFetch(), isBaseline: true, attemptTracker: tracker
  }), options.budgetMs ?? BUDGET));
  const settled = operation.then(result => ({ result }), error => ({ error }));
  await vi.runAllTimersAsync();
  const outcome = await settled;
  const delays = clock.mock.calls.filter(c => c[1] === 10000).length;
  return { ...outcome, calls, counts, tracker, plan, delays };
}
type Capture = Awaited<ReturnType<typeof capture>>;
function successful(input: Capture,expected=2) {
  if (!("result" in input)) throw input.error;
  expect(input.result).toMatchObject({ status: "SUCCESS", truth: { completenessVerified: true } });
  expect(input.result.jobs).toHaveLength(expected);
  expect(input.result.fetchEvidence!.fetchCounts).toMatchObject({ rawCount: 3, validCount: expected, validationDiscardCount: 3-expected });
  expect(input.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1);
  expect(input.tracker).toEqual({ fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
  expect(replayNovoChinaRows(input.plan, input.result.fetchEvidence!, input.result.jobs, input.result.observation.crawledAt.toISOString())).toBe(true);
  return input.result;
}
async function admissionInput(input: Capture,expected=2) {
  const result = successful(input,expected), workspaceRoot = await mkdtemp(join(tmpdir(), "novo-c60-synthetic-")); directories.push(workspaceRoot);
  const identity = { releaseCandidateId: "novo-c60-synthetic", commitSha: "a".repeat(40), rosterSha256: "a".repeat(64), sourcePlanSha256: "a".repeat(64),
    sourceConfigSha256: "a".repeat(64), adapterBundleSha256: "a".repeat(64), batchKind: "SCHEDULED" as const, ownerId: "synthetic-owner",
    expectedPlannedSourceIds: [input.plan.source.id], expectedPlannedSourceSetSha256: "a".repeat(64), expectedPlannedSourceCount: 1 };
  const pending = buildPendingRuntimeBatch("novo-c60-synthetic-batch", [input.plan], identity, new Date(START)).sources[0]!;
  const binding = { releaseCandidateId: identity.releaseCandidateId, batchId: "novo-c60-synthetic-batch", sourceResultId: pending.id,
    sourceConfigSha256: sourcePlanConfigSha256(input.plan), adapterVersion: pending.adapterVersion };
  const evidenceSubdirectory = "quality/runtime-evidence";
  const archived = await archiveSourceEvidence({ workspaceRoot, ...binding, sourceId: input.plan.source.id, evidenceSubdirectory,
    captureTool: result.fetchEvidence!.captureTool, artifacts: bindRuntimeEvidenceArtifactIds({ ...binding, sourceId: input.plan.source.id, artifacts: result.fetchEvidence!.artifacts }) });
  return { plan: input.plan, result, binding, identity, pending, archive: { workspaceRoot, evidenceSubdirectory, artifacts: archived.artifacts } };
}

describe("independent C60 Novo retry candidate, synthetic offline", () => {
  it("preserves the complete happy-path proof and explicit closure", async () => { const input = await capture(); successful(input); expect(input.calls).toHaveLength(8); expect(input.delays).toBe(0); });
  it.each([502, 503, 504])("retries one native gateway %s with complete failed bytes and no list replay", async status => {
    const input = await capture({ [apply(2)]: [status] }); const result = successful(input);
    expect(input.counts.get(apply(2))).toBe(2); expect(input.delays).toBe(1); expect(input.calls).toHaveLength(9);
    const failure = result.fetchEvidence!.artifacts.find(a => a.logicalKey.endsWith("-http-error-1"))!;
    expect(failure).toMatchObject({ httpStatus: status, body: "<html>Bad Gateway</html>", bodyRepresentation: "EXACT" });
  });
  it.each([502, 503, 504])("retries a pre-redirect application HTTP %s and admits its safely persisted URL binding", async status => {
    const captured = await capture({ [apply(2)]: [status] }, { gatewayBeforeRedirect: true });
    const result = successful(captured);
    expect(captured.counts.get(apply(2))).toBe(2); expect(captured.delays).toBe(1); expect(captured.calls).toHaveLength(9);
    const failure = result.fetchEvidence!.artifacts.find(a => a.logicalKey.endsWith("-http-error-1"))!;
    expect(failure.finalUrl).toBe(safeOfficialJsonEvidenceUrl(apply(2)));
    expect(failure.finalUrl).not.toBe(apply(2)); expect(failure.requestedUrl).toBe(failure.finalUrl);
    const input = await admissionInput(captured);
    expect((await issueSourceQualityAdmission(input)).status).toBe("ACCEPTED");
  });
  it.each(["wrong-final-hash", "wrong-requested-hash", "raw-query", "foreign-origin", "posting-query", "changed-posting", "posting-fragment"])("rejects pre-redirect persisted URL tampering: %s", async mode => {
    const input = await capture({ [apply(2)]: [502] }, { gatewayBeforeRedirect: true });
    const result = successful(input), evidence = structuredClone(result.fetchEvidence!);
    const failure = evidence.artifacts.find(a => a.logicalKey.endsWith("-http-error-1"))!;
    if (mode === "wrong-final-hash") failure.finalUrl = safeOfficialJsonEvidenceUrl(apply(1));
    if (mode === "wrong-requested-hash") failure.requestedUrl = safeOfficialJsonEvidenceUrl(apply(1));
    if (mode === "raw-query") failure.finalUrl = apply(2);
    if (mode === "foreign-origin") failure.finalUrl = "https://unrelated.example/job/role/346002/";
    if (mode === "posting-query") failure.finalUrl = final(2) + "?company=changed";
    if (mode === "changed-posting") failure.finalUrl = final(1);
    if (mode === "posting-fragment") failure.finalUrl = final(2) + "#changed";
    expect(replayNovoChinaRows(input.plan, evidence, result.jobs, result.observation.crawledAt.toISOString())).toBe(false);
  });
  it.each(["https://unrelated.example/job/role/346002/", "https://careers.novonordisk.com/job/role/346002/?company=changed", "https://careers.novonordisk.com/login/"])("does not retry gateway redirected outside the existing official posting contract: %s", async gatewayFinalUrl => {
    const input = await capture({ [apply(2)]: [502] }, { gatewayFinalUrl });
    if (!("result" in input)) throw input.error;
    expect(input.result.status).toBe("FAILED"); expect(input.counts.get(apply(2))).toBe(1);
    expect(input.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1); expect(input.delays).toBe(0);
  });
  it("retries each distinct native slot at most once without repeating prior slots", async () => {
    const input = await capture({ [detail(1)]: [502], [apply(2)]: [503] }); successful(input);
    expect(input.counts.get(detail(1))).toBe(2); expect(input.counts.get(apply(2))).toBe(2); expect(input.delays).toBe(2); expect(input.calls).toHaveLength(10);
  });
  it("accepts an owned settled no-response timeout without inventing HTTP body/status", async () => {
    const input = await capture({ [apply(2)]: ["timeout"] }); const result = successful(input);
    const failure = result.fetchEvidence!.artifacts.find(a => a.logicalKey.endsWith("-request-error-1"))!;
    expect(failure.kind).toBe("COMMAND_OUTPUT"); expect(failure.httpStatus).toBeUndefined(); expect(failure.requestedUrl).toBeUndefined();
    expect(bodyJson(failure)).toMatchObject({ responseReceived: false, settlement: "FETCH_REJECTED", timeoutMs: 45000 });
    expect(input.counts.get(apply(2))).toBe(2); expect(input.delays).toBe(1);
  });
  it.each([[502, 502], ["timeout", "timeout"], [502, "timeout"], ["timeout", 502]] as Outcome[][])("does not add a third request or source replay after %j", async (...actions) => {
    const input = await capture({ [apply(1)]: actions });
    if (!("result" in input)) throw input.error;
    expect(input.result.status).toBe("FAILED"); expect(input.result.jobs).toEqual([]); expect(input.result.fetchEvidence!.fetchLosses).toEqual([]);
    expect(input.counts.get(apply(1))).toBe(2); expect(input.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1); expect(input.tracker.retryCount).toBe(0);
  });
  it.each([429, 500, 599, "bare-timeout", "network", "unknown", "captcha", "tls", "body-timeout"] as Outcome[])("fails closed without native/source retry for %s", async action => {
    const input = await capture({ [apply(1)]: [action] }); if (!("result" in input)) throw input.error;
    expect(input.result.status).toBe("FAILED"); expect(input.result.jobs).toEqual([]); expect(input.result.fetchEvidence!.fetchLosses).toEqual([]);
    expect(input.counts.get(apply(1))).toBe(1); expect(input.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1); expect(input.delays).toBe(0);
  });
  it("rejects a changed resolved posting on native retry", async () => {
    const input = await capture({ [apply(1)]: [502, "late-posting"] }); if (!("result" in input)) throw input.error;
    expect(input.result.status).toBe("FAILED"); expect(input.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1);
  });
  it.each(["11", "invalid"])("does not extend backoff for Retry-After %s", async retryAfter => {
    const input = await capture({ [apply(1)]: [503] }, { retryAfter }); if (!("result" in input)) throw input.error;
    expect(input.result.status).toBe("FAILED"); expect(input.counts.get(apply(1))).toBe(1); expect(input.delays).toBe(0);
  });
  it("retains a valid bounded Retry-After proof", async () => {
    const input = await capture({ [apply(1)]: [503] }, { retryAfter: "10" }); const result = successful(input);
    const start = result.fetchEvidence!.artifacts.find(a => a.logicalKey.endsWith("-http-retry-1"))!; expect(bodyJson(start).retryAfter).toBe("10");
  });
  it("does not start a retry without budget for the full 10s backoff and 45s request", async () => {
    const input = await capture({ [apply(1)]: [502] }, { budgetMs: 55000 }); if (!("result" in input)) throw input.error;
    expect(input.result.status).toBe("FAILED"); expect(input.counts.get(apply(1))).toBe(1); expect(input.delays).toBe(0);
  });
  it("cancels during backoff without a later HTTP request", async () => {
    const input = await capture({ [apply(1)]: [502] }, { cancelBackoff: true });
    expect(input.counts.get(apply(1))).toBe(1); expect(input.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1);
    if ("result" in input) expect(input.result.status).toBe("FAILED"); else expect(String(input.error)).toContain("cancellation");
  });
  it.each(["missing-failure", "missing-start", "extra-prefix", "body", "requested-hash", "headers", "backoff", "deadline", "status", "retry-after", "receipt-extra"])("rejects tampered gateway evidence: %s", async mode => {
    const input = await capture({ [apply(1)]: [502] }); const result = successful(input), evidence = structuredClone(result.fetchEvidence!);
    const failureIndex = evidence.artifacts.findIndex(a => a.logicalKey.endsWith("-http-error-1")), startIndex = failureIndex + 1;
    if (mode === "missing-failure") evidence.artifacts.splice(failureIndex, 1);
    else if (mode === "missing-start") evidence.artifacts.splice(startIndex, 1);
    else if (mode === "extra-prefix") evidence.artifacts.splice(failureIndex, 0, evidence.artifacts[failureIndex]!);
    else if (mode === "body") evidence.artifacts[failureIndex]!.body = "forged";
    else {
      const receipt = bodyJson(evidence.artifacts[startIndex]!);
      if (mode === "requested-hash") receipt.requestedUrlSha256 = "0".repeat(64);
      if (mode === "headers") receipt.requestHeadersSha256 = "0".repeat(64);
      if (mode === "backoff") receipt.startedAt = new Date(START + 9999).toISOString();
      if (mode === "deadline") receipt.sourceDeadlineAt = new Date(START + BUDGET + 1).toISOString();
      if (mode === "status") receipt.failedStatus = 503;
      if (mode === "retry-after") receipt.retryAfter = "11";
      if (mode === "receipt-extra") receipt.extra = true;
      evidence.artifacts[startIndex]!.body = JSON.stringify(receipt);
    }
    expect(replayNovoChinaRows(input.plan, evidence, result.jobs, result.observation.crawledAt.toISOString())).toBe(false);
  });
  it.each(["missing-receipt", "missing-start", "requested-hash", "settlement", "response", "backoff", "deadline", "late-success", "double-prefix"])("rejects tampered timeout evidence: %s", async mode => {
    const input = await capture({ [apply(1)]: ["timeout"] }); const result = successful(input), evidence = structuredClone(result.fetchEvidence!);
    const index = evidence.artifacts.findIndex(a => a.logicalKey.endsWith("-request-error-1"));
    if (mode === "missing-receipt") evidence.artifacts.splice(index, 1);
    else if (mode === "missing-start") evidence.artifacts.splice(index + 1, 1);
    else if (mode === "double-prefix") evidence.artifacts.splice(index, 0, evidence.artifacts[index]!);
    else if (mode === "late-success") evidence.artifacts[index + 2]!.capturedAt = new Date(START + 100001).toISOString();
    else {
      const target = mode === "backoff" ? index + 1 : index;
      const receipt = bodyJson(evidence.artifacts[target]!);
      if (mode === "requested-hash") receipt.requestedUrlSha256 = "0".repeat(64);
      if (mode === "settlement") receipt.settlement = "ASSUMED";
      if (mode === "response") receipt.responseReceived = true;
      if (mode === "backoff") receipt.startedAt = new Date(START + 54999).toISOString();
      if (mode === "deadline") receipt.sourceDeadlineAt = new Date(START + BUDGET + 1).toISOString();
      evidence.artifacts[target]!.body = JSON.stringify(receipt);
    }
    expect(replayNovoChinaRows(input.plan, evidence, result.jobs, result.observation.crawledAt.toISOString())).toBe(false);
  });
  it.each([502, "timeout"] as Outcome[])("replays archived synthetic bytes through owned admission and atomic verification for %s", async failure => {
    const input = await admissionInput(await capture({ [apply(1)]: [failure] }));
    const admission = await issueSourceQualityAdmission(input); expect(admission.status).toBe("ACCEPTED");
    const commit = buildAtomicRuntimeCommit({ ...input, batchId: input.binding.batchId, previousJobs: [], baselineCompletedBeforeCrawl: true,
      artifacts: input.archive.artifacts, sourceAdmissionPolicy: "PLAN_BOUND_SOURCE_QUALITY_V1", sourceQualityAdmission: admission, firstAcceptedCurrentPolicyReceipt: null });
    await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
  });
  it("admits a complete list with unpublished insufficient detail through the unchanged atomic protocol", async()=>{
    const input=await admissionInput(await capture({[detail(2)]:["insufficient"]}),1);
    const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("ACCEPTED");
    const commit=buildAtomicRuntimeCommit({...input,batchId:input.binding.batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,
      artifacts:input.archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
    expect(()=>verifySourceQualityAtomicCommit({plan:input.plan,commit})).not.toThrow();
    await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
    expect(commit.commands.filter(command=>command.type==="UPSERT_JOB")).toHaveLength(1);
    expect(commit.lossLedger.map(loss=>(loss.details as {code:string}).code)).toEqual(["NOVO_DETAIL_INSUFFICIENT","OFFICIAL_APPLICATION_CLOSED"]);
  });
  it("rejects a changed archived retry receipt", async () => {
    const input = await admissionInput(await capture({ [apply(1)]: [502] }));
    const artifact = input.archive.artifacts.find(a => a.logicalKey.endsWith("-http-retry-1"))!;
    const path = join(input.archive.workspaceRoot, artifact.path), bytes = await readFile(path); expect(sha(bytes)).toBe(artifact.sha256);
    await writeFile(path, bytes.toString().replace('"attempt":2', '"attempt":3'));
    expect(await issueSourceQualityAdmission(input)).toMatchObject({ status: "REJECTED", codes: ["ARCHIVE_VERIFICATION_FAILED"] });
  });
});
