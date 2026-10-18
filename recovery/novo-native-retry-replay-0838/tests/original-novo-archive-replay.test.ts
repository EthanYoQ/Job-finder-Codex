// @vitest-environment node
// Synthetic control-flow and admission proof tests only. No retained web fixture
// is read or substituted, and no live acquisition or database operation occurs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { candidateCompanies } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/data/companyRegistry";
import { getPlanBySourceId, buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/sourcePlan";
import { runSourceCrawl, createSourceFetchAttemptTracker } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/runSourceCrawl";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch, buildAtomicRuntimeCommit, verifyAtomicRuntimeCommitForPersistence } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/runtimeAtomicEvidence";
import { NOVO_CHINA_ENDPOINT, replayNovoChinaRows } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/novoChinaQuality";
import { safeOfficialJsonEvidenceUrl } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/officialJsonEvidence";
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation, OfficialHttpTimeoutError } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/officialHttpRuntimeLimits";
import type { SourceFetchArtifactDraft } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/sourceFetchEvidence";

const START = Date.parse("2026-10-08T04:00:00.000Z");
const BUDGET = 20 * 60_000;
import { ENTRY, detail, apply, final, listing, pages } from "/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source/tests/helpers/novoC60SyntheticFixture";
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


import { restoreOriginalNovo } from "../after/support/offline-checkers/original-novo-archive-replay.mts";
const V="/workspace/scratch/5e9614251709/novo-invite-retry-candidate-20261018T0835Z/tools/dot-auto-controller/vendor/c60-source";
async function restored(input:any,mutate?:(archived:any[],bodies:Map<string,string>)=>void){
 const archived=JSON.parse(JSON.stringify(input.archive.artifacts));
 const bodies=new Map<string,string>(await Promise.all(archived.map(async(a:any)=>[a.path,await readFile(join(input.archive.workspaceRoot,a.path),'utf8')])) as any);
 mutate?.(archived,bodies);
 const requests:any[]=[];
 const replay=await restoreOriginalNovo(V,input.plan,archived,bodies,input.result.observation.crawledAt.toISOString(),requests);
 const native=await runSourceCrawl(input.plan,{fetch:async()=>replay,isBaseline:true});
 expect(native.status).toBe('SUCCESS');expect(native.truth.completenessVerified).toBe(true);
 return {replay,native,requests};
}
describe('External Novo archive replay, reused original synthetic native harness',()=>{
 it.each(['happy','gateway','timeout'] as const)('restores %s bytes through original fetch, quality, admission and atomic gate',async mode=>{
  const input=await admissionInput(await capture(mode==='happy'?{}:{[apply(1)]:[mode==='gateway'?502:'timeout']},mode==='gateway'?{gatewayFinalUrl:'https://careers.novonordisk.com/job-invite/346001/?locale=en_GB'}:{}));
  const {replay,native,requests}=await restored(input);
  expect(replay.fetchEvidence).toEqual(input.result.fetchEvidence);expect(native.jobs).toEqual(input.result.jobs);
  expect(requests).toHaveLength(mode==='happy'?8:9);
  const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe('ACCEPTED');
  const commit=buildAtomicRuntimeCommit({...input,batchId:input.binding.batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,
   artifacts:input.archive.artifacts,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
  await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
 });
 it.each(['missing-failure','missing-start','missing-success','order','duplicate','body','headers','deadline','late-success','second-502','wrong-invite'])("rejects archived %s",async mode=>{
  const input=await admissionInput(await capture({[apply(1)]:[502]},{gatewayFinalUrl:'https://careers.novonordisk.com/job-invite/346001/?locale=en_GB'}));
  await expect(restored(input,(a,b)=>{
   const i=a.findIndex(x=>x.logicalKey.endsWith('-http-error-1'));
   if(mode==='missing-failure')a.splice(i,1);
   else if(mode==='missing-start')a.splice(i+1,1);
   else if(mode==='missing-success')a.splice(i+2,1);
   else if(mode==='order')[a[i],a[i+1]]=[a[i+1],a[i]];
   else if(mode==='duplicate')a.splice(i,0,a[i]);
   else if(mode==='body')b.set(a[i].path,'<html>Changed bytes</html>');
   else if(mode==='wrong-invite')a[i].finalUrl=a[i].finalUrl.replace('/346001/','/346002/');
   else if(mode==='late-success')a[i+2].capturedAt=new Date(START+60000).toISOString();
   else if(mode==='second-502')a[i+2].httpStatus=502;
   else {const start=JSON.parse(b.get(a[i+1].path)!);if(mode==='headers')start.requestHeadersSha256='0'.repeat(64);
    else start.sourceDeadlineAt=new Date(START+BUDGET+1).toISOString();b.set(a[i+1].path,JSON.stringify(start));}
  })).rejects.toThrow();
 });
});
