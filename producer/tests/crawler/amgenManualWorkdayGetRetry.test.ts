import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { AMGEN_MANUAL_WORKDAY_GET_RETRY, createAmgenManualWorkdaySourceFetch, validateStrictAmgenManualWorkdayEvidence } from "../../src/crawler/amgenManualWorkdaySourceFetch";
import { OfficialHttpTimeoutError, OfficialSourceAttemptTimeoutError, runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from "../../src/crawler/officialHttpRuntimeLimits";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { amgenManualWorkdayFixture, AMGEN_LOOKUP_ENDPOINT } from "../helpers/amgenManualWorkdayFixture";
import { AMGEN_TIME } from "../helpers/amgenNativeFixture";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(AMGEN_TIME)); });
afterEach(() => { vi.useRealTimers(); });
const plan = () => buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
const failureBody = '<html>upstream "gateway"\nfailed without any job body</html>';
type Http = NonNullable<Parameters<typeof createAmgenManualWorkdaySourceFetch>[0]>["http"];
type Response = Awaited<ReturnType<NonNullable<Http>>>;
function harness(statuses: number[] = [502, 200], total = 13) {
  const fixture = amgenManualWorkdayFixture(total), target = fixture.rows.at(-1)!.apiUrl;
  const delay = vi.fn(async (ms: number) => { vi.setSystemTime(Date.now() + ms); });
  const http = vi.fn(async (request: Parameters<NonNullable<Http>>[0]): Promise<Response> => {
    const response = { ...await fixture.http(request), capturedAt: new Date().toISOString() };
    if (request.url !== target) return response;
    const status = statuses.shift() ?? 502;
    return status === 200 ? response : { ...response, status, contentType: "text/html", body: failureBody };
  });
  return { fixture, target, delay, http, run: () => runSourceCrawl(plan(), { fetch: createAmgenManualWorkdaySourceFetch({ http, delay }) }) };
}
const diagnostics = (result: Awaited<ReturnType<ReturnType<typeof harness>["run"]>>) => result.fetchEvidence!.artifacts.filter(a => a.kind === "COMMAND_OUTPUT");

it.each([502, 503, 504])("recovers one detail GET HTTP %i with both originals and unchanged complete denominator", async status => {
  const h = harness([status, 200]), result = await h.run();
  expect(result.status).toBe("SUCCESS");
  expect(result.jobs).toHaveLength(13);
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(2);
  expect(h.delay.mock.calls).toEqual([[10_000]]);
  const failed = diagnostics(result); expect(failed).toHaveLength(1);
  expect(JSON.parse(String(failed[0]!.body))).toMatchObject({ status, finalUrl: h.target, body: failureBody, capturedAt: AMGEN_TIME });
  const success = result.fetchEvidence!.artifacts.find(a => a.requestedUrl === h.target)!;
  expect(success.httpStatus).toBe(200);
  expect(JSON.parse(String(success.body)).jobPostingInfo).toEqual(h.fixture.rows.at(-1)!.info);
  expect(Date.parse(success.capturedAt) - Date.parse(failed[0]!.capturedAt)).toBe(10_000);
  expect(result.fetchEvidence!.declaredCompleteness).toMatchObject({ kind: "OFFICIAL_TOTAL_COUNT", value: 13 });
  expect(result.fetchEvidence!.fetchCounts).toEqual({ rawCount: 13, parsedCount: 13, validCount: 13, parseDiscardCount: 0, validationDiscardCount: 0 });
  expect(result.fetchEvidence!.fetchLosses).toEqual([]);
  expect(h.fixture.requests.filter(r => r.url === AMGEN_LOOKUP_ENDPOINT)).toHaveLength(1);
  expect(validateStrictAmgenManualWorkdayEvidence(plan(), result.fetchEvidence!, result.jobs)).toBe(true);
  const p = plan(), evidence = result.fetchEvidence!, declaration = evidence.artifacts.find(a => a.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey)!;
  const decision = issueAGradeOfficialTotalCertificate({ plan: p, transportSuccess: true, adapterSuccess: true, evidence,
    paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs: result.jobs,
    officialArtifactSha256: createHash("sha256").update(declaration.body).digest("hex"),
    binding: { releaseCandidateId: "synthetic-amgen-retry", batchId: "synthetic-amgen-retry-batch", sourceResultId: "synthetic-amgen-retry-result", sourceConfigSha256: sourcePlanConfigSha256(p) } });
  expect(decision.status).toBe("CERTIFIED");
  if (decision.status === "CERTIFIED") expect(decision.certificate.counts).toMatchObject({ officialTotal: 13, validCount: 13, finalUniqueJobCount: 13 });
});

it("retains both failed originals and returns zero jobs after a persistent 502", async () => {
  const h = harness([502, 502]), result = await h.run();
  expect(result.status).toBe("FAILED"); expect(result.jobs).toHaveLength(0);
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(2);
  expect(h.delay).toHaveBeenCalledTimes(1);
  expect(diagnostics(result).map(a => JSON.parse(String(a.body)).body)).toEqual([failureBody, failureBody]);
  expect(result.fetchEvidence!.pages).toEqual([]);
  expect(result.fetchEvidence!.declaredCompleteness).toBeUndefined();
  expect(result.fetchEvidence!.fetchCounts.validCount).toBe(0);
});

it.each([400, 401, 403, 404, 408, 429, 500, 501])("does not retry HTTP %i", async status => {
  const h = harness([status, 200]), result = await h.run();
  expect(result.status).toBe("FAILED"); expect(h.delay).not.toHaveBeenCalled();
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
  expect(JSON.parse(String(diagnostics(result)[0]!.body)).status).toBe(status);
});

it.each(["list", "lookup", "identity"])("does not retry a 502 at the %s stage", async stage => {
  const h = harness([200], 13), base = h.http.getMockImplementation()!;
  h.http.mockImplementation(async req => {
    const response = await base(req);
    const fail = stage === "lookup" ? req.url === AMGEN_LOOKUP_ENDPOINT : stage === "identity" ? req.url === h.fixture.rows[0]!.url : req.method === "POST" && req.url !== AMGEN_LOOKUP_ENDPOINT;
    return fail ? { ...response, status: 502, body: failureBody } : response;
  });
  const result = await h.run(); expect(result.status).toBe("FAILED"); expect(h.delay).not.toHaveBeenCalled();
  expect(diagnostics(result)).toHaveLength(1);
});

it.each([new OfficialHttpTimeoutError(), new OfficialSourceAttemptTimeoutError(60_000), Object.assign(new Error("network"), { code: "ECONNRESET" })])("does not retry a thrown timeout or transport error", async error => {
  const h = harness([200]), base = h.http.getMockImplementation()!;
  h.http.mockImplementation(async req => { if (req.url === h.target) throw error; return base(req); });
  const result = await h.run(); expect(result.status).toBe("FAILED"); expect(h.delay).not.toHaveBeenCalled();
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
  expect(result.fetchEvidence!.artifacts.length).toBeGreaterThan(0);
});

it.each([{ value: "11", delayMs: 11_000 }, { invalid: true } as const])("honors a Retry-After outside the fixed policy: %j", async retryAfter => {
  const h = harness(), base = h.http.getMockImplementation()!;
  h.http.mockImplementation(async req => ({ ...await base(req), ...(req.url === h.target ? { retryAfter } : {}) }));
  const result = await h.run(); expect(result.status).toBe("FAILED"); expect(h.delay).not.toHaveBeenCalled();
  expect(JSON.parse(String(diagnostics(result)[0]!.body)).retryAfter).toEqual(retryAfter);
});

it("uses the fixed delay when Retry-After fits, and fails on a redirected response", async () => {
  const h = harness(), base = h.http.getMockImplementation()!;
  h.http.mockImplementation(async req => ({ ...await base(req), ...(req.url === h.target ? { retryAfter: { value: "5", delayMs: 5_000 } } : {}) }));
  expect((await h.run()).status).toBe("SUCCESS"); expect(h.delay).toHaveBeenCalledWith(10_000);
  const redirected = harness(), next = redirected.http.getMockImplementation()!;
  redirected.http.mockImplementation(async req => ({ ...await next(req), ...(req.url === redirected.target ? { finalUrl: req.url + "?changed=1" } : {}) }));
  expect((await redirected.run()).status).toBe("FAILED"); expect(redirected.delay).not.toHaveBeenCalled();
});

it("never starts a retry delay when the original source budget cannot fit it", async () => {
  const h = harness(), result = await runWithOfficialSourceAttemptTimeout(h.run, 10_000);
  expect(result.status).toBe("FAILED"); expect(h.delay).not.toHaveBeenCalled();
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
});

it("does not dispatch a GET if the original source deadline expires during backoff", async () => {
  const h = harness(); h.delay.mockImplementation(async () => { vi.setSystemTime(Date.now() + 20_000); });
  const result = await runWithOfficialSourceAttemptTimeout(h.run, 20_000);
  expect(result.status).toBe("FAILED"); expect(h.delay).toHaveBeenCalledOnce();
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
});

it("does not dispatch a GET after cancellation during backoff", async () => {
  const h = harness(), controller = new AbortController();
  h.delay.mockImplementation(async () => { controller.abort(new Error("stop")); });
  const result = await runWithOfficialSourceCancellation(controller.signal, h.run);
  expect(result.status).toBe("FAILED"); expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
});

it("does not extend the original ten-minute evidence capture window", async () => {
  const h = harness(); h.delay.mockImplementation(async () => { vi.setSystemTime(Date.now() + 600_000); });
  const result = await h.run(); expect(result.status).toBe("FAILED");
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
});

it("keeps the one-retry bound across different details", async () => {
  const h = harness([502, 200], 2), base = h.http.getMockImplementation()!, first = h.fixture.rows[0]!.apiUrl; let firstCalls = 0;
  h.http.mockImplementation(async req => {
    const response = await base(req);
    return req.url === first && ++firstCalls === 1 ? { ...response, status: 502, body: failureBody } : response;
  });
  const result = await h.run(); expect(result.status).toBe("FAILED"); expect(h.delay).toHaveBeenCalledTimes(1);
  expect(h.http.mock.calls.filter(([r]) => r.url === first)).toHaveLength(2);
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
  expect(diagnostics(result)).toHaveLength(2);
});

it("fails closed on changed successful response quality after retry", async () => {
  const h = harness(); h.fixture.rows.at(-1)!.info.canApply = false;
  const result = await h.run(); expect(result.status).toBe("FAILED"); expect(result.jobs).toHaveLength(0);
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(2);
  expect(diagnostics(result)).toHaveLength(1);
});

it("rejects deletion, mutation, relabeling or insufficient spacing of failed-attempt evidence", async () => {
  const h = harness(), result = await h.run(); expect(result.status).toBe("SUCCESS");
  type Evidence = NonNullable<typeof result.fetchEvidence>;
  const failed = (e: Evidence) => e.artifacts.find(a => a.kind === "COMMAND_OUTPUT")!;
  const mutations: Array<(e: Evidence) => void> = [
    e => { e.artifacts.splice(e.artifacts.indexOf(failed(e)), 1); },
    e => { failed(e).body = String(failed(e).body).replace("502", "404"); },
    e => { failed(e).body = String(failed(e).body).replace("gateway", "changed"); },
    e => { failed(e).extractorLocator += "changed"; },
    e => { failed(e).capturedAt = new Date(Date.parse(AMGEN_TIME) + 1).toISOString(); },
    e => { failed(e).bodyRepresentation = "REDACTED"; },
    e => { failed(e).logicalKey += "changed"; }
  ];
  for (const mutate of mutations) { const e = structuredClone(result.fetchEvidence!); mutate(e); expect(validateStrictAmgenManualWorkdayEvidence(plan(), e, result.jobs)).toBe(false); }
  expect(AMGEN_MANUAL_WORKDAY_GET_RETRY.maxRetries).toBe(1);
});

it("retains a late final HTTP 200 but cannot return success after the source deadline", async () => {
  const h = harness([200]), base = h.http.getMockImplementation()!;
  h.http.mockImplementation(async req => { const response = await base(req); if (req.url === h.target) vi.setSystemTime(Date.now() + 20_000); return response; });
  const result = await runWithOfficialSourceAttemptTimeout(h.run, 20_000);
  expect(result.status).toBe("FAILED"); expect(result.jobs).toHaveLength(0);
  expect(result.fetchEvidence!.artifacts.find(a => a.requestedUrl === h.target)?.httpStatus).toBe(200);
});

it("cancels the production delay timer without a second GET or timer leak", async () => {
  const h = harness(), controller = new AbortController();
  const pending = runWithOfficialSourceCancellation(controller.signal, () => runSourceCrawl(plan(), { fetch: createAmgenManualWorkdaySourceFetch({ http: h.http }) }));
  await vi.advanceTimersByTimeAsync(0);
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);
  controller.abort(new Error("cancel during production delay"));
  const result = await pending; expect(result.status).toBe("FAILED");
  expect(h.http.mock.calls.filter(([r]) => r.url === h.target)).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
