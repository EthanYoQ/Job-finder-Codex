import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { createSourceFetchRouter } from "../../src/crawler/sourceFetchRouter";
import { createSourceFetchAttemptTracker, runSourceCrawl, type SourceFetchResult } from "../../src/crawler/runSourceCrawl";
import { OfficialHttpTimeoutError, OfficialSourceAttemptTimeoutError, runWithOfficialSourceAttemptTimeout } from "../../src/crawler/officialHttpRuntimeLimits";
import { parseOfficialRetryAfter } from "../../src/crawler/sourceFetchFailure";

afterEach(() => vi.restoreAllMocks());

// Retained public bytes with a synthetic clock and transport, never a live capture.
const capturedAt = "2026-10-02T01:44:06.473Z";
const endpoint = "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
const body = readFileSync("tests/fixtures/novo-nordisk/retained-china-list-20261002.json", "utf8");
const html: Record<string, { body: string; finalUrl: string; contentType: string }> = JSON.parse(
  gunzipSync(readFileSync("tests/fixtures/novo-nordisk/retained-native-applications-20261002.json.gz")).toString()
);
const detailUrl = Object.keys(html).find(url => url.endsWith("job-ad.345540.en_GB.html"))!;
const applicationUrl = Object.keys(html).find(url => url.includes("career_job_req_id=345540&"))!;

async function routedCapture(failApplication: (attempt: number) => Partial<OfficialJsonHttpResponse> | undefined,
  wait: (milliseconds:number)=>Promise<void> = async()=>undefined) {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novo-nordisk-china-social")!;
  const attemptTracker = createSourceFetchAttemptTracker(), delays: number[] = [], attempts: SourceFetchResult[] = [];
  let listRequests = 0, applicationRequests = 0;
  const capture = createOfficialJsonSourceFetch({ allowBrowserFallback: false, now: () => new Date(capturedAt), http: async request => {
    expect(request.method).toBe("GET");
    if (request.url === endpoint) {
      listRequests++;
      return { status: 200, finalUrl: endpoint, contentType: "application/json;charset=utf-8", capturedAt, body };
    }
    const retained = html[request.url];
    if (!retained) throw Error(`Unexpected retained URL ${request.url}`);
    const override = request.url === applicationUrl ? failApplication(++applicationRequests) : undefined;
    return { status: 200, capturedAt, ...retained, ...override };
  } });
  const wrongRoute = async (): Promise<SourceFetchResult> => { throw Error("Unexpected Novo route"); };
  const fetch = createSourceFetchRouter({
    moka: wrongRoute, fallback: wrongRoute,
    officialJson: async request => { const result = await capture(request); attempts.push(result); return result; },
    delay: async milliseconds => { delays.push(milliseconds); await wait(milliseconds); }
  });
  const result = await runSourceCrawl(plan, { fetch, isBaseline: true, attemptTracker });
  return { plan, result, attempts, attemptTracker, delays, listRequests, applicationRequests };
}

describe("Novo native application transport retry classification", () => {
  it("retries a real HTTP timeout once under the unchanged source policy and retains the completed failure artifacts", async () => {
    const actual = await routedCapture(attempt => { if (attempt === 1) throw new OfficialHttpTimeoutError(); });
    expect(actual.plan.transientRetryPolicy).toEqual({ maxRetries: 1, backoffMs: 10_000 });
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_HTTP_TIMEOUT"] });
    expect(actual.delays).toEqual([10_000]);
    expect(actual.listRequests).toBe(2);
    expect(actual.applicationRequests).toBe(2);
    const first = actual.attempts[0]!;
    expect(first).toMatchObject({ ok: false, transportFailure: { code: "OFFICIAL_HTTP_TIMEOUT", retryable: true } });
    expect(first.fetchEvidence!.artifacts).toHaveLength(27);
    expect(first.fetchEvidence!.artifacts[0]!.body).toBe(body);
    expect(first.fetchEvidence!.artifacts.at(-1)).toMatchObject({
      logicalKey: "novo-detail-345540.en_GB", body: html[detailUrl]!.body, capturedAt
    });
    expect(actual.result).toMatchObject({ status: "SUCCESS", truth: { completenessVerified: true },
      fetchEvidence: { fetchCounts: { rawCount: 27, validCount: 20, validationDiscardCount: 7 } } });
    expect(actual.result.jobs.some(job => job.officialUrl === detailUrl)).toBe(false);
  });

  it("stops after the configured single retry when the request still times out", async () => {
    const actual = await routedCapture(() => { throw new OfficialHttpTimeoutError(); });
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_HTTP_TIMEOUT"] });
    expect(actual.delays).toEqual([10_000]);
    expect(actual.attempts).toHaveLength(2);
    expect(actual.result).toMatchObject({ status: "FAILED", transportFailure: { code: "OFFICIAL_HTTP_TIMEOUT", retryable: true } });
    expect(actual.result.jobs).toEqual([]);
    expect(actual.result.fetchEvidence!.artifacts).toHaveLength(27);
  });

  const networkCodes = ["EAI_AGAIN", "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH",
    "ENOTFOUND", "ETIMEDOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"];
  it.each(networkCodes.flatMap(code => [[code, false], [code, true]] as const))(
    "uses the complete existing network allowlist for %s (nested cause: %s) without increasing the retry cap", async (code, nested) => {
      const actual = await routedCapture(() => {
        const failure = Object.assign(new Error("private transport diagnostic"), { code });
        throw nested ? new TypeError("fetch failed", { cause: new Error("private cause", { cause: failure }) }) : failure;
      });
      expect(actual.plan.transientRetryPolicy).toEqual({ maxRetries: 1, backoffMs: 10_000 });
      expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_NETWORK_ERROR"] });
      expect(actual.delays).toEqual([10_000]);
      expect(actual.listRequests).toBe(2); expect(actual.applicationRequests).toBe(2);
      expect(actual.result).toMatchObject({ status: "FAILED", transportFailure: { code: "OFFICIAL_NETWORK_ERROR", retryable: true } });
      expect(actual.result.jobs).toEqual([]);
      expect(actual.attempts.every(attempt => attempt.fetchEvidence?.artifacts.length === 27)).toBe(true);
    });

  it("does not begin the configured backoff when the remaining source budget is shorter", async () => {
    const actual = await runWithOfficialSourceAttemptTimeout(() =>
      routedCapture(() => { throw new OfficialHttpTimeoutError(); }, async () => { throw Error("must not wait"); }), 5_000);
    expect(actual.listRequests).toBe(1); expect(actual.applicationRequests).toBe(1);
    expect(actual.attemptTracker.retryCount).toBe(0);
    expect(actual.result.status).toBe("FAILED");
  });

  it.each([429, 500, 502, 503, 504, 599])("retries native HTTP %s once at source level with the existing backoff", async status => {
    const errorBody = "<html><h1>502 Bad Gateway</h1><p>[Errno 111] Connection refused</p></html>";
    const actual = await routedCapture(attempt => attempt === 1 ? { status, body: errorBody } : undefined);
    expect(actual.plan.transientRetryPolicy).toEqual({ maxRetries: 1, backoffMs: 10_000 });
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: [`OFFICIAL_HTTP_${status}`] });
    expect(actual.delays).toEqual([10_000]);
    expect(actual.listRequests).toBe(2); expect(actual.applicationRequests).toBe(2);
    expect(actual.attempts[0]!.fetchEvidence!.artifacts).toHaveLength(28);
    expect(actual.attempts[0]!.fetchEvidence!.artifacts.at(-1)).toMatchObject({
      logicalKey: "novo-application-345540.en_GB", httpStatus: status, body: errorBody, capturedAt
    });
    expect(actual.result.status).toBe("SUCCESS");
  });

  it.each([429, 503])("honors a bounded Retry-After on HTTP %s without increasing the source retry count", async status => {
    const actual = await routedCapture(() => ({ status, body: "Temporarily unavailable",
      retryAfter: parseOfficialRetryAfter("10", Date.parse(capturedAt)) }));
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: [`OFFICIAL_HTTP_${status}`] });
    expect(actual.delays).toEqual([10_000]);
    expect(actual.result).toMatchObject({ status: "FAILED", transportFailure: { code: `OFFICIAL_HTTP_${status}`, retryAfterMs: 10_000 } });
    expect(actual.result.jobs).toEqual([]);
  });

  it("keeps ordinary HTTP 502 retryable when the body merely mentions TLS", async () => {
    const actual = await routedCapture(() => ({ status: 502,
      body: "<html>502 Bad Gateway. TLS enabled upstream; connection refused.</html>" }));
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_HTTP_502"] });
    expect(actual.delays).toEqual([10_000]);
    expect(actual.result).toMatchObject({ status: "FAILED", transportFailure: { code: "OFFICIAL_HTTP_502" } });
  });

  it.each([429, 503])("refuses HTTP %s when Retry-After exceeds the original allowed wait", async status => {
    const actual = await routedCapture(() => ({ status, body: "Temporarily unavailable",
      retryAfter: parseOfficialRetryAfter("11", Date.parse(capturedAt)) }));
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
    expect(actual.delays).toEqual([]); expect(actual.result.status).toBe("FAILED");
    expect(actual.result.transportFailure).toMatchObject({ retryAfterMs: 11_000 });
    expect(actual.result.jobs).toEqual([]);
  });

  it.each(["list", "application"])("retains a real default-client Retry-After header on the %s and refuses a longer wait", async stage => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      calls++;
      const url = String(input), retained = html[url];
      const isFailure = url === (stage === "list" ? endpoint : applicationUrl);
      const response = new Response(isFailure ? "Bad Gateway" : url === endpoint ? body : retained!.body,
        { status: isFailure ? 503 : 200, headers: {
          "Content-Type": url === endpoint ? "application/json" : retained!.contentType,
          ...(isFailure ? { "Retry-After": "11" } : {})
        } });
      Object.defineProperty(response, "url", { value: url === endpoint ? endpoint : retained!.finalUrl });
      return response;
    });
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-novo-nordisk-china-social")!;
    const attemptTracker = createSourceFetchAttemptTracker();
    const capture = createOfficialJsonSourceFetch({ allowBrowserFallback: false, now: () => new Date(capturedAt) });
    const wrongRoute = async (): Promise<SourceFetchResult> => { throw Error("wrong route"); };
    const router = createSourceFetchRouter({ moka: wrongRoute, fallback: wrongRoute, officialJson: capture,
      delay: async () => { throw Error("must not wait"); } });
    const result = await router(plan, attemptTracker);
    expect(result).toMatchObject({ ok: false, transportFailure: { code: "OFFICIAL_HTTP_503", retryAfterMs: 11_000 } });
    expect(calls).toBe(stage === "list" ? 1 : 28); expect(attemptTracker.retryCount).toBe(0);
  });

  it("does not convert an unknown application page into success after a permitted network retry", async () => {
    const actual = await routedCapture(attempt => {
      if (attempt === 1) throw new TypeError("fetch failed", { cause: { code: "UND_ERR_SOCKET" } });
      return { body: "<html>Application status unresolved</html>" };
    });
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_NETWORK_ERROR"] });
    expect(actual.delays).toEqual([10_000]);
    expect(actual.result.status).toBe("FAILED");
    expect(actual.result.transportFailure).toBeUndefined();
    expect(actual.result.jobs).toEqual([]);
    expect(actual.result.fetchEvidence!.fetchLosses).toEqual([]);
  });

  const nonRetryable: Array<[string, () => Partial<OfficialJsonHttpResponse> | undefined]> = [
    ["unknown content", () => ({ body: "<html>Unresolved job status</html>" })],
    ["CAPTCHA content", () => ({ body: "<html><h1>CAPTCHA</h1><p>Verify you are human</p></html>" })],
    ["login page", () => ({ body: "<html>Sign in</html>", finalUrl: "https://careers.novonordisk.com/login/" })],
    ["HTTP 403", () => ({ status: 403, body: "<html>Forbidden</html>" })],
    ["HTTP 401", () => ({ status: 401, body: "<html>Unauthorized</html>" })],
    ["HTTP 503 CAPTCHA", () => ({ status: 503, body: "<html>Verify you are human</html>" })],
    ["HTTP 502 certificate failure", () => ({ status: 502, body: "<html>SSL certificate verify failed</html>" })],
    ["HTTP 503 expired certificate code", () => ({ status: 503, body: "<html>CERT_HAS_EXPIRED</html>" })],
    ["HTTP 525 SSL handshake failed", () => ({ status: 525, body: "<html>SSL handshake failed</html>" })],
    ["HTTP 502 TLS handshake failure", () => ({ status: 502, body: "<html>TLS handshake failure</html>" })],
    ["HTTP 502 SSL protocol code", () => ({ status: 502, body: "<html>ERR_SSL_PROTOCOL_ERROR</html>" })],
    ["HTTP 503 TLS protocol error", () => ({ status: 503, body: "<html>TLS protocol error</html>" })],
    ["HTTP 502 access blocked", () => ({ status: 502, body: "<html>Access denied</html>" })],
    ["HTTP 503 forbidden", () => ({ status: 503, body: "<html>Forbidden</html>" })],
    ["HTTP 429 login", () => ({ status: 429, body: "<html>Sign in</html>" })],
    ["HTTP 503 unexpected origin", () => ({ status: 503, body: "Unavailable", finalUrl: "https://unexpected.example/error" })],
    ["HTTP 503 login redirect", () => ({ status: 503, body: "Unavailable", finalUrl: "https://careers.novonordisk.com/login/" })],
    ["HTTP 502 ambiguous job content", () => ({ status: 502, body: '<div class="jobDisplay"><div class="job">Unknown identity</div></div>' })],
    ["HTTP 429 invalid Retry-After", () => ({ status: 429, body: "Unavailable", retryAfter: parseOfficialRetryAfter("bad", Date.parse(capturedAt)) })],
    ["HTTP 503 overlong Retry-After", () => ({ status: 503, body: "Unavailable", retryAfter: parseOfficialRetryAfter("1".repeat(65), Date.parse(capturedAt)) })],
    ["generic timeout text", () => { throw Error("timeout"); }],
    ["unclassified network failure", () => { throw new TypeError("fetch failed"); }],
    ["TLS certificate failure", () => { throw new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } }); }],
    ["TLS hostname failure", () => { throw new TypeError("fetch failed", { cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }); }],
    ["TLS failure containing a network cause", () => { throw Object.assign(new Error("certificate failure"), { code: "CERT_HAS_EXPIRED", cause: { code: "ECONNRESET" } }); }],
    ["unknown explicit code containing a network cause", () => { throw Object.assign(new Error("unclassified"), { code: "UNKNOWN", cause: { code: "ECONNRESET" } }); }],
    ["source deadline", () => { throw new OfficialSourceAttemptTimeoutError(1_200_000); }],
    ["caller abort", () => { throw new DOMException("Aborted", "AbortError"); }],
    ["coded caller abort with network cause", () => { throw Object.assign(new Error("Aborted"), { name: "AbortError", code: "ABORT_ERR", cause: { code: "ECONNRESET" } }); }]
  ];
  it.each(nonRetryable)("keeps %s failed without transport retry or closed-job inference", async (_label, fail) => {
    const actual = await routedCapture(fail);
    expect(actual.attemptTracker).toEqual({ fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
    expect(actual.delays).toEqual([]);
    expect(actual.result.status).toBe("FAILED");
    expect(actual.result.transportFailure).toBeUndefined();
    expect(actual.result.jobs).toEqual([]);
    expect(actual.result.fetchEvidence!.fetchLosses).toEqual([]);
  });
});
