// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { sanofiChineseHttp, SANOFI_CN_ENTRY } from "../../src/crawler/sanofiChineseNative";
import { runWithOfficialSourceAttemptTimeout, runWithOfficialSourceCancellation } from "../../src/crawler/officialHttpRuntimeLimits";

const directories: string[] = [];
const originalArgv = process.argv, originalExitCode = process.exitCode;
afterEach(async () => {
  process.argv = originalArgv; process.exitCode = originalExitCode;
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "sanofi-http-capture-test-")); directories.push(path); return path;
}
async function diagnostics() {
  const path = join(await directory(), "requests.jsonl");
  vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", path);
  vi.stubEnv("P0_SOURCE_HTTP_TIMEOUT_MS", undefined);
  return () => readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
}
const url = "https://jobs.sanofi.cn/test/3036/101";
const request = { url, method: "GET" as const, headers: { Accept: "text/html" } };
function response(body: string | ReadableStream<Uint8Array>, target = url, status = 200, contentType = "text/html;charset=utf-8") {
  const value = new Response(body, { status, headers: { "content-type": contentType } });
  Object.defineProperty(value, "url", { value: target }); return value;
}
function pendingBody() {
  let signal: AbortSignal, stream: ReadableStreamDefaultController<Uint8Array>;
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    signal = init!.signal!;
    return response(new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    } }));
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { signal: () => signal, fetchImpl, finish: (body: string) => { stream.enqueue(Buffer.from(body)); stream.close(); } };
}
function shortTestDeadline() {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  return vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(20));
}

describe("Sanofi HTTP body lifetime and original capture (no network)", () => {
  it("keeps the real body and response metadata and timestamps body completion", async () => {
    const log = await diagnostics(), pending = pendingBody(), before = Date.now();
    const operation = sanofiChineseHttp(request);
    await vi.waitFor(() => expect(log().at(-1)?.event).toBe("HEADERS_RECEIVED"));
    const body = ' \r\n中文岗位😀<p>原文 &amp; ���</p>\n';
    const completedAfter = Date.now(); pending.finish(body);
    const captured = await operation;
    expect(captured).toEqual({ body, status: 200, finalUrl: url, contentType: "text/html;charset=utf-8", capturedAt: expect.any(String) });
    expect(Date.parse(captured.capturedAt!)).toBeGreaterThanOrEqual(completedAfter);
    expect(Date.parse(captured.capturedAt!)).toBeLessThanOrEqual(Date.now());
    expect(completedAfter).toBeGreaterThanOrEqual(before);
    expect(log().map(row => row.event)).toEqual(["REQUEST_START", "HEADERS_RECEIVED", "BODY_COMPLETE"]);
    expect(log().every(row => row.timeoutMs === 45_000)).toBe(true);
    expect(pending.signal().aborted).toBe(false);
    expect(pending.fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ method: "GET", headers: request.headers, redirect: "follow" }));
  });

  it("honors explicit no-redirect authority requests without retrying a redirect failure", async () => {
    const reason = new TypeError("unexpected redirect"), fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(reason);
    vi.stubGlobal("fetch", fetchImpl);
    await expect(sanofiChineseHttp({...request,redirect:"error"})).rejects.toBe(reason);
    expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({redirect:"error"}));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds slow headers without inventing a received response", async () => {
    const log = await diagnostics(), timeout = shortTestDeadline(); let signal: AbortSignal;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_input, init) => { signal = init!.signal!; return new Promise(() => {}); }));
    await expect(sanofiChineseHttp(request)).rejects.toMatchObject({ code: "OFFICIAL_HTTP_TIMEOUT" });
    expect(timeout).toHaveBeenCalledWith(45_000); expect(signal!.aborted).toBe(true);
    expect(log().map(row => row.event)).toEqual(["REQUEST_START", "REQUEST_FAILED"]);
    expect(log().at(-1)).toMatchObject({ failureKind: "HTTP_TIMEOUT" });
  });

  it("bounds a stalled body under the unchanged HTTP deadline", async () => {
    const log = await diagnostics(), timeout = shortTestDeadline(), pending = pendingBody();
    await expect(sanofiChineseHttp(request)).rejects.toMatchObject({ code: "OFFICIAL_HTTP_TIMEOUT" });
    expect(timeout).toHaveBeenCalledWith(45_000); expect(pending.signal().aborted).toBe(true);
    expect(log().map(row => row.event)).toEqual(["REQUEST_START", "HEADERS_RECEIVED", "BODY_FAILED"]);
    expect(log().at(-1)).toMatchObject({ failureKind: "HTTP_TIMEOUT" });
  });

  it("retains source cancellation after headers and preserves its reason", async () => {
    const log = await diagnostics(), pending = pendingBody(), source = new AbortController(), reason = new Error("source cancelled");
    const operation = runWithOfficialSourceCancellation(source.signal, () => sanofiChineseHttp(request));
    const rejected = expect(operation).rejects.toBe(reason);
    await vi.waitFor(() => expect(log().at(-1)?.event).toBe("HEADERS_RECEIVED"));
    source.abort(reason); await rejected;
    expect(pending.signal().aborted).toBe(true);
    expect(log().at(-1)).toMatchObject({ event: "BODY_FAILED", failureKind: "SOURCE_ABORT" });
  });

  it("retains the source attempt deadline through body reads", async () => {
    const log = await diagnostics(), pending = pendingBody();
    await expect(runWithOfficialSourceAttemptTimeout(() => sanofiChineseHttp(request), 20))
      .rejects.toMatchObject({ code: "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT" });
    await vi.waitFor(() => expect(log().at(-1)).toMatchObject({ event: "BODY_FAILED", failureKind: "SOURCE_ABORT" }));
    expect(pending.signal().aborted).toBe(true);
  });

  it("does not retry a 403 response or a detail certificate error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response("denied", url, 403)); vi.stubGlobal("fetch", fetchImpl);
    await expect(sanofiChineseHttp(request)).resolves.toMatchObject({ status: 403, body: "denied" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const reason = new TypeError("certificate failure", { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } });
    fetchImpl.mockRejectedValueOnce(reason);
    await expect(sanofiChineseHttp(request)).rejects.toBe(reason); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("archives every complete main response unchanged before a native parser failure", async () => {
    const base = await directory(), root = join(base, "new-main"), nativeUrl = "https://careersite.tupu360.com/sanofi/position/detail?exid=R9000001";
    const entry = '<section id="search-results" data-ajax-url="/search-results" data-total-pages="1" data-total-job-results="1" data-records-per-page="15" data-active-facet-id="0"></section><div id="search-filters"></div>';
    const rows = `<section id="search-results" data-total-job-results="1" data-total-pages="1" data-current-page="1" data-records-per-page="15"><ul id="search-results-list"><li><button class="js-save-job-btn" data-job-id="101"></button><a data-job-id="101" href="${url}"><h2>中文岗位</h2><span class="job-location">中国</span></a></li></ul><a class="next disabled">下一页</a></section>`;
    const ajax = JSON.stringify({ results: rows, filters: '<section id="search-filters"><input class="filter-checkbox"></section>', hasJobs: true, hasContent: false });
    const detail = `<meta name="job-ats-req-id" content="R9000001"><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", identifier: { value: "R9000001" }, title: "中文岗位", url, hiringOrganization: { name: "General Medicines" }, description: "中文职责", jobLocation: [{ address: { addressCountry: "China" } }] })}</script><main id="content"><div class="job-description section7-title"><h1>中文岗位</h1><a data-job-id="101" data-selector-name="job-apply-link" href="${nativeUrl}">立即申请</a></div><div class="job-description section7-details" data-job-id="101"><div class="ats-description">中文职责</div><a data-job-id="101" data-selector-name="job-apply-link" href="${nativeUrl}">立即申请</a></div></main>`;
    const invalidNative = " \r\n<html>真实返回正文，但缺少岗位字段 ���😀</html>\n";
    const served: Array<{ url: string; body: string; contentType: string }> = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async input => {
      const target = String(input), path = new URL(target).pathname;
      const body = target === SANOFI_CN_ENTRY ? entry : path === "/search-results" ? ajax : target === url ? detail : target === nativeUrl ? invalidNative : undefined;
      if (body === undefined) throw Error("UNEXPECTED_TEST_URL");
      const contentType = path === "/search-results" ? "application/json" : "text/html;charset=utf-8";
      // Each prior response must be on disk before parsing can request the next one.
      if (served.length) expect(await readdir(root)).toContain(`response-${String(served.length - 1).padStart(4, "0")}.json`);
      served.push({ url: target, body, contentType }); return response(body, target, 200, contentType);
    }));
    process.argv = [process.execPath, "capture-sanofi-cn-b-source.ts", "main", root];
    vi.spyOn(console, "log").mockImplementation(() => {});
    await import("../../scripts/capture-sanofi-cn-b-source");
    expect(served).toHaveLength(4); expect(process.exitCode).toBe(1);
    const names = (await readdir(root)).filter(name => /^response-\d{4}\.json$/u.test(name)).sort();
    expect(names).toHaveLength(4);
    for (const [index, name] of names.entries()) {
      const original = served[index]!, archived = JSON.parse(await readFile(join(root, name), "utf8"));
      expect(archived.request).toEqual({ url: original.url, method: "GET" });
      expect(archived.response).toEqual({ status: 200, body: original.body, finalUrl: original.url, contentType: original.contentType, capturedAt: expect.any(String) });
      expect(Date.parse(archived.requestedAt)).toBeLessThanOrEqual(Date.parse(archived.response.capturedAt));
      expect(archived.bodySha256).toBe(createHash("sha256").update(original.body).digest("hex"));
      expect((await stat(join(root, name))).mode & 0o777).toBe(0o600);
    }
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    const fetched = deserialize(await readFile(join(root, "sourceFetchResult.v8")));
    expect(fetched).toMatchObject({ ok: false, failureReason: "SANOFI_CN_NATIVE_CHAIN_INVALID" });
    expect(fetched.fetchEvidence.artifacts.at(-1).body).toBe(invalidNative);
  });
});
