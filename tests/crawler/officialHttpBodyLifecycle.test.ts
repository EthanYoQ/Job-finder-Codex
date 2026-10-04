// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchWithOfficialTimeout, runWithOfficialSourceAttemptTimeout,
  runWithOfficialSourceCancellation } from "../../src/crawler/officialHttpRuntimeLimits";

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function diagnostics() {
  const directory = mkdtempSync(join(tmpdir(), "official-http-body-test-")); directories.push(directory);
  const path = join(directory, "requests.jsonl");
  vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", path);
  return { path, read: () => readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line)) };
}
const consumeResponse = async (response: Response) => ({ response, body: await response.text() });
function pendingBody() {
  let signal: AbortSignal, stream: ReadableStreamDefaultController<Uint8Array>;
  const fetchImpl: typeof fetch = async (_input, init) => {
    signal = init!.signal!;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      stream = controller;
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    } }));
  };
  return { fetchImpl, signal: () => signal, finish: (text: string) => {
    stream.enqueue(Buffer.from(text)); stream.close();
  } };
}

describe("official HTTP response body lifetime (no network)", () => {
  it("preserves the Response, exact text, status, headers and URL until the body completes", async () => {
    const log = diagnostics(), pending = pendingBody();
    const operation = fetchWithOfficialTimeout("https://jobs.example.test/a", {}, {
      fetchImpl: pending.fetchImpl, timeoutMs: 1000, consumeResponse });
    await vi.waitFor(() => expect(log.read().map(row => row.event)).toEqual(["REQUEST_START", "HEADERS_RECEIVED"]));
    pending.finish(' { "岗位": "上海😀", "escaped": "\\n" }\r\n');
    const result = await operation;
    expect(result.body).toBe(' { "岗位": "上海😀", "escaped": "\\n" }\r\n');
    expect(result.response.status).toBe(200);
    expect(result.response.bodyUsed).toBe(true);
    expect(log.read().map(row => row.event)).toEqual(["REQUEST_START", "HEADERS_RECEIVED", "BODY_COMPLETE"]);
    expect(log.read().at(-1)).toMatchObject({ bodyDurationMs: expect.any(Number), durationMs: expect.any(Number) });
    expect(pending.signal().aborted).toBe(false);
  });

  it("bounds slow headers and emits no body or fabricated status marker", async () => {
    const log = diagnostics(); let signal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => { signal = init!.signal!; return new Promise(() => {}); };
    await expect(fetchWithOfficialTimeout("https://jobs.example.test/a", {}, { fetchImpl, timeoutMs: 20, consumeResponse }))
      .rejects.toMatchObject({ code: "OFFICIAL_HTTP_TIMEOUT" });
    expect(signal!.aborted).toBe(true);
    expect(log.read().map(row => row.event)).toEqual(["REQUEST_START", "REQUEST_FAILED"]);
    expect(log.read().at(-1)).toMatchObject({ failureKind: "HTTP_TIMEOUT", errorName: "TimeoutError" });
    expect(log.read().every(row => row.status === undefined)).toBe(true);
  });

  it("bounds a stalled body after headers and aborts the underlying fetch signal", async () => {
    const log = diagnostics(), pending = pendingBody();
    await expect(fetchWithOfficialTimeout("https://jobs.example.test/a", {}, {
      fetchImpl: pending.fetchImpl, timeoutMs: 20, consumeResponse }))
      .rejects.toMatchObject({ code: "OFFICIAL_HTTP_TIMEOUT" });
    expect(pending.signal().aborted).toBe(true);
    expect(log.read().map(row => row.event)).toEqual(["REQUEST_START", "HEADERS_RECEIVED", "BODY_FAILED"]);
    expect(log.read().at(-1)).toMatchObject({ failureKind: "HTTP_TIMEOUT", errorName: "TimeoutError" });
  });

  it("keeps source cancellation (the runner's SIGTERM path) linked after headers", async () => {
    const log = diagnostics(), pending = pendingBody(), source = new AbortController();
    const reason = new Error("source cancelled");
    const operation = runWithOfficialSourceCancellation(source.signal, () => fetchWithOfficialTimeout(
      "https://jobs.example.test/a", {}, { fetchImpl: pending.fetchImpl, timeoutMs: 1000, consumeResponse }));
    const rejection = expect(operation).rejects.toBe(reason);
    await vi.waitFor(() => expect(log.read().at(-1)?.event).toBe("HEADERS_RECEIVED"));
    source.abort(reason);
    await rejection;
    expect(pending.signal().aborted).toBe(true);
    expect(log.read().at(-1)).toMatchObject({ event: "BODY_FAILED", failureKind: "SOURCE_ABORT", errorName: "Error" });
  });

  it("keeps the source attempt deadline linked after headers", async () => {
    const log = diagnostics(), pending = pendingBody();
    await expect(runWithOfficialSourceAttemptTimeout(() => fetchWithOfficialTimeout("https://jobs.example.test/a", {}, {
      fetchImpl: pending.fetchImpl, timeoutMs: 1000, consumeResponse }), 20))
      .rejects.toMatchObject({ code: "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT" });
    await vi.waitFor(() => expect(log.read().at(-1)).toMatchObject({ event: "BODY_FAILED", failureKind: "SOURCE_ABORT",
      errorName: "OfficialSourceAttemptTimeoutError", errorCode: "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT" }));
    expect(pending.signal().aborted).toBe(true);
  });

  it("preserves caller cancellation and removes caller listeners after completion", async () => {
    const log = diagnostics(), pending = pendingBody(), caller = new AbortController();
    const remove = vi.spyOn(caller.signal, "removeEventListener"), reason = new Error("caller cancelled");
    const operation = fetchWithOfficialTimeout("https://jobs.example.test/a", { signal: caller.signal }, {
      fetchImpl: pending.fetchImpl, timeoutMs: 1000, consumeResponse });
    const rejection = expect(operation).rejects.toBe(reason);
    await vi.waitFor(() => expect(log.read().at(-1)?.event).toBe("HEADERS_RECEIVED"));
    caller.abort(reason); await rejection;
    expect(remove).toHaveBeenCalled();
    expect(log.read().at(-1)).toMatchObject({ event: "BODY_FAILED", failureKind: "CALLER_ABORT", errorName: "Error" });
  });

  it("preserves native body failures and never logs credential, token, body or exception content", async () => {
    const log = diagnostics();
    const secret = "NEVER_PERSIST_SECRET";
    const reason = new Error(secret);
    const fetchImpl: typeof fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(reason); } }), {
      status: 503, headers: { "set-cookie": secret, "authorization": secret }
    });
    await expect(fetchWithOfficialTimeout(`https://${secret}:${secret}@jobs.example.test/${secret}?token=${secret}#${secret}`, {
      headers: { Cookie: secret, Authorization: secret }, method: "POST", body: secret
    }, { fetchImpl, timeoutMs: 1000, consumeResponse })).rejects.toBe(reason);
    const raw = readFileSync(log.path, "utf8");
    expect(raw).not.toContain(secret);
    expect(log.read()[1]).toMatchObject({ status: 503 });
    expect(log.read().at(-1)).toMatchObject({ event: "BODY_FAILED", failureKind: "TRANSPORT_OR_BODY_ERROR",
      url: { origin: "https://jobs.example.test", hasQuery: true, endpointSha256: expect.stringMatching(/^[0-9a-f]{64}$/u) } });
  });

  it("retains headers-only callers' original Response contract", async () => {
    const response = new Response("unchanged", { status: 403, headers: { "x-example": "value" } });
    const result = await fetchWithOfficialTimeout("https://jobs.example.test", {}, { fetchImpl: async () => response });
    expect(result).toBe(response);
    expect(result.headers.get("x-example")).toBe("value");
    expect(await result.text()).toBe("unchanged");
  });

  it("retains the legacy direct deadline for a headers-only caller without a source signal", async () => {
    const pending = pendingBody();
    const response = await fetchWithOfficialTimeout("https://jobs.example.test", {}, {
      fetchImpl: pending.fetchImpl, timeoutMs: 20 });
    await expect(response.text()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(pending.signal().aborted).toBe(true);
  });

  it("preserves results and original failures when diagnostic storage is unavailable", async () => {
    const log = diagnostics(), error = new Error("original body failure");
    vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", join(log.path, "missing-directory", "NEVER_LOG_PATH"));
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(fetchWithOfficialTimeout("https://jobs.example.test", {}, { timeoutMs: 1000,
      fetchImpl: async () => new Response("exact body"), consumeResponse })).resolves.toMatchObject({ body: "exact body" });
    await expect(fetchWithOfficialTimeout("https://jobs.example.test", {}, { timeoutMs: 1000,
      fetchImpl: async () => { throw error; }, consumeResponse })).rejects.toBe(error);
    expect(warning.mock.calls).toEqual([["OFFICIAL_HTTP_DIAGNOSTIC_WRITE_FAILED"], ["OFFICIAL_HTTP_DIAGNOSTIC_WRITE_FAILED"]]);
  });
});
