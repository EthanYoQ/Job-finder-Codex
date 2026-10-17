// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { officialHttpRequestDiagnostics } from "../../src/crawler/officialHttpRequestDiagnostics";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentOfficialSourceAttemptDeadlineAtMs,
  currentOfficialSourceAttemptRemainingMs,
  fetchWithOfficialTimeout,
  OfficialHttpTimeoutError,
  officialRequestHeadersSha256,
  OfficialSourceAttemptTimeoutError,
  runWithOfficialSourceAttemptTimeout,
  runWithOfficialSourceCancellation,
  settledOfficialHttpTimeoutEvidence
} from "../../src/crawler/officialHttpRuntimeLimits";

const REQUEST_TIMEOUT_MS = 45_000;
const SOURCE_TIMEOUT_MS = 20 * 60 * 1_000;
const START_AT = Date.parse("2026-10-07T21:30:00.000Z");
// Deliberately retain case, explicit port, dot segment, escaped query and fragment.
// Evidence must bind the full input string, not a normalized URL or endpoint hash.
const REQUEST_URL = "https://Jobs.Example.test:443/search/../jobs?token=fixture-secret&lang=zh%2Fcn#snapshot";
const isoAfter = (milliseconds: number) => new Date(START_AT + milliseconds).toISOString();

type Outcome<T> =
  | { state: "pending" }
  | { state: "fulfilled"; value: T }
  | { state: "rejected"; error: unknown };

function observe<T>(promise: Promise<T>) {
  let outcome: Outcome<T> = { state: "pending" };
  // Attach both handlers before advancing time, including to expected failures.
  const result = promise.then(
    value => { outcome = { state: "fulfilled", value }; return outcome; },
    error => { outcome = { state: "rejected", error }; return outcome; }
  );
  return { result, outcome: () => outcome };
}

async function rejected<T>(watched: ReturnType<typeof observe<T>>): Promise<unknown> {
  const outcome = await watched.result;
  expect(outcome.state).toBe("rejected");
  if (outcome.state !== "rejected") throw new Error("Expected a rejected fixture request");
  return outcome.error;
}

function controlledFetch() {
  let requestSignal: AbortSignal | undefined;
  let resolveFetch: ((response: Response) => void) | undefined;
  let rejectFetch: ((error: unknown) => void) | undefined;
  const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve, reject) => {
      resolveFetch = resolve;
      rejectFetch = reject;
    });
  });
  return {
    fetchImpl,
    signal: () => {
      if (!requestSignal) throw new Error("The fixture fetch did not receive an abort signal");
      return requestSignal;
    },
    resolve: (response: Response) => {
      if (!resolveFetch) throw new Error("The fixture fetch has not started");
      resolveFetch(response);
    },
    reject: (error: unknown) => {
      if (!rejectFetch) throw new Error("The fixture fetch has not started");
      rejectFetch(error);
    }
  };
}

function retainedRequest(fetchImpl: typeof fetch, init: RequestInit = {}) {
  return fetchWithOfficialTimeout(REQUEST_URL, init, {
    fetchImpl,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retainSettledRequestTimeout: true
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_AT);
  vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", "");
  // Native AbortSignal.timeout uses Node's real clock. Keep every deadline in
  // these tests on the same synthetic clock, without making a network request.
  vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Synthetic request deadline", "TimeoutError")), milliseconds);
    return controller.signal;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("settled official HTTP request timeout evidence (offline)", () => {
  it("leaves the default path bounded by 45 seconds even if fetch ignores abort", async () => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => fetchWithOfficialTimeout(REQUEST_URL, {}, {
      fetchImpl: pending.fetchImpl, timeoutMs: REQUEST_TIMEOUT_MS
    }), SOURCE_TIMEOUT_MS));

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(watched.outcome().state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    const error = await rejected(watched);
    expect(error).toBeInstanceOf(OfficialHttpTimeoutError);
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
    expect(pending.signal().aborted).toBe(true);
    expect(pending.fetchImpl).toHaveBeenCalledOnce();
    // A later transport settlement cannot retroactively authenticate the error.
    pending.reject(pending.signal().reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
  });

  it("does not return evidence at the timer and waits for matching fetch rejection", async () => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(
      () => retainedRequest(pending.fetchImpl), SOURCE_TIMEOUT_MS));

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(pending.signal().aborted).toBe(true);
    expect(watched.outcome().state).toBe("pending");
    expect(settledOfficialHttpTimeoutEvidence(pending.signal().reason)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(watched.outcome().state).toBe("pending");
    pending.reject(pending.signal().reason);

    const error = await rejected(watched);
    expect(error).toBeInstanceOf(OfficialHttpTimeoutError);
    expect(settledOfficialHttpTimeoutEvidence(error)).toEqual({
      schemaVersion: 1,
      kind: "NO_RESPONSE_REQUEST_ERROR",
      code: "OFFICIAL_HTTP_TIMEOUT",
      requestedUrlSha256: createHash("sha256").update(REQUEST_URL).digest("hex"),
      requestHeadersSha256: createHash("sha256").update("[]").digest("hex"),
      method: "GET",
      requestStartedAt: isoAfter(0),
      timeoutAt: isoAfter(REQUEST_TIMEOUT_MS),
      settledAt: isoAfter(REQUEST_TIMEOUT_MS + 5_000),
      timeoutMs: REQUEST_TIMEOUT_MS,
      responseReceived: false,
      settlement: "FETCH_REJECTED",
      cause: "REQUEST_TIMER",
      sourceDeadlineAt: isoAfter(SOURCE_TIMEOUT_MS)
    });
    expect(JSON.stringify(settledOfficialHttpTimeoutEvidence(error))).not.toContain("fixture-secret");
    expect(pending.fetchImpl).toHaveBeenCalledOnce();
  });

  it("can retain a synchronous abort-driven rejection without a second fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }));
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(fetchImpl), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const receipt = settledOfficialHttpTimeoutEvidence(await rejected(watched));
    expect(receipt).toMatchObject({ timeoutAt: isoAfter(REQUEST_TIMEOUT_MS), settledAt: isoAfter(REQUEST_TIMEOUT_MS),
      sourceDeadlineAt: isoAfter(SOURCE_TIMEOUT_MS), responseReceived: false, cause: "REQUEST_TIMER" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps an abort-ignoring fetch pending only until the original 20-minute source deadline", async () => {
    const pending = controlledFetch();
    let requestOutcome: ReturnType<typeof observe<Response>> | undefined;
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => {
      expect(currentOfficialSourceAttemptRemainingMs()).toBe(SOURCE_TIMEOUT_MS);
      const request = retainedRequest(pending.fetchImpl);
      requestOutcome = observe(request);
      return request;
    }, SOURCE_TIMEOUT_MS));

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(watched.outcome().state).toBe("pending");
    expect(requestOutcome!.outcome().state).toBe("pending");
    await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS - REQUEST_TIMEOUT_MS - 1);
    expect(watched.outcome().state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    const error = await rejected(watched);
    expect(error).toBeInstanceOf(OfficialSourceAttemptTimeoutError);
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
    expect(settledOfficialHttpTimeoutEvidence(await rejected(requestOutcome!))).toBeUndefined();
    expect(pending.fetchImpl).toHaveBeenCalledOnce();
    // Release the fixture after cancellation. No second operation may start.
    pending.reject(pending.signal().reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses the earlier nested source deadline instead of extending the original budget", async () => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => runWithOfficialSourceAttemptTimeout(
      () => retainedRequest(pending.fetchImpl), SOURCE_TIMEOUT_MS), 90_000));
    await vi.advanceTimersByTimeAsync(50_000);
    pending.reject(pending.signal().reason);
    expect(settledOfficialHttpTimeoutEvidence(await rejected(watched))).toMatchObject({
      timeoutAt: isoAfter(REQUEST_TIMEOUT_MS), settledAt: isoAfter(50_000), sourceDeadlineAt: isoAfter(90_000)
    });
  });

  it("does not issue a fetch for an already-aborted caller", async () => {
    const pending = controlledFetch(), caller = new AbortController();
    const reason = new Error("caller already cancelled");
    caller.abort(reason);
    const watched = observe(runWithOfficialSourceAttemptTimeout(
      () => retainedRequest(pending.fetchImpl, { signal: caller.signal }), SOURCE_TIMEOUT_MS));
    expect(await rejected(watched)).toBe(reason);
    expect(settledOfficialHttpTimeoutEvidence(reason)).toBeUndefined();
    expect(pending.fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["caller", "source"] as const)("lets %s cancellation end settlement without waiting for fetch", async owner => {
    const pending = controlledFetch(), cancellation = new AbortController();
    const reason = new Error(`${owner} cancelled during transport settlement`);
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => owner === "source"
      ? runWithOfficialSourceCancellation(cancellation.signal, () => retainedRequest(pending.fetchImpl))
      : retainedRequest(pending.fetchImpl, { signal: cancellation.signal }), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 5_000);
    expect(watched.outcome().state).toBe("pending");
    cancellation.abort(reason);
    expect(await rejected(watched)).toBe(reason);
    expect(settledOfficialHttpTimeoutEvidence(reason)).toBeUndefined();
    pending.reject(pending.signal().reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not accept a Response that arrives after the request timer", async () => {
    const pending = controlledFetch();
    const consumeResponse = vi.fn(async (response: Response) => response.text());
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => fetchWithOfficialTimeout(REQUEST_URL, {}, {
      fetchImpl: pending.fetchImpl, timeoutMs: REQUEST_TIMEOUT_MS, retainSettledRequestTimeout: true, consumeResponse
    }), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 2_000);
    expect(watched.outcome().state).toBe("pending");
    pending.resolve(new Response("late response", { status: 200 }));
    const error = await rejected(watched);
    expect(error).toBeInstanceOf(OfficialHttpTimeoutError);
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
    expect(consumeResponse).not.toHaveBeenCalled();
    expect(pending.fetchImpl).toHaveBeenCalledOnce();
  });

  it("cannot create request-settlement evidence from a response body timeout", async () => {
    const consumeResponse = vi.fn((_response: Response) => new Promise<string>(() => undefined));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("headers have arrived"));
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => fetchWithOfficialTimeout(REQUEST_URL, {}, {
      fetchImpl, timeoutMs: REQUEST_TIMEOUT_MS, retainSettledRequestTimeout: true, consumeResponse
    }), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(0);
    expect(consumeResponse).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const error = await rejected(watched);
    expect(error).toBeInstanceOf(OfficialHttpTimeoutError);
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("preserves an ordinary transport rejection before the request deadline", async () => {
    const pending = controlledFetch(), error = new TypeError("synthetic network failure");
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(pending.fetchImpl), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(1_000);
    pending.reject(error);
    expect(await rejected(watched)).toBe(error);
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
    expect(pending.signal().aborted).toBe(false);
  });

  it.each([
    ["network error", () => new TypeError("fetch failed for another reason")],
    ["different TimeoutError object", () => new DOMException("Synthetic request deadline", "TimeoutError")],
    ["ordinary HTTP timeout error", () => new OfficialHttpTimeoutError()],
    ["code-only timeout object", () => ({ code: "OFFICIAL_HTTP_TIMEOUT" })]
  ] as const)("does not authenticate a %s merely because the request timer has fired", async (_name, makeError) => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(pending.fetchImpl), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    const error = makeError();
    expect(error).not.toBe(pending.signal().reason);
    pending.reject(error);
    expect(settledOfficialHttpTimeoutEvidence(await rejected(watched))).toBeUndefined();
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
    expect(pending.fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not authenticate a request when source cancellation wins at the same timer boundary", async () => {
    const pending = controlledFetch(), owner = new AbortController();
    const sourceReason = new Error("source cancellation at request deadline");
    // Register first so the source wins even though both timers share a timestamp.
    setTimeout(() => owner.abort(sourceReason), REQUEST_TIMEOUT_MS);
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => runWithOfficialSourceCancellation(owner.signal,
      () => retainedRequest(pending.fetchImpl)), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(await rejected(watched)).toBe(sourceReason);
    expect(pending.signal().reason).toBe(sourceReason);
    pending.reject(sourceReason);
    await vi.advanceTimersByTimeAsync(0);
    expect(settledOfficialHttpTimeoutEvidence(sourceReason)).toBeUndefined();
  });

  it("cannot authenticate a matching rejection that occurs after the source deadline", async () => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(pending.fetchImpl), 50_000));
    await vi.advanceTimersByTimeAsync(50_000);
    const error = await rejected(watched);
    expect(error).toBeInstanceOf(OfficialSourceAttemptTimeoutError);
    pending.reject(pending.signal().reason);
    await vi.advanceTimersByTimeAsync(1);
    expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
  });

  it("does not retain evidence at the source deadline even before its abort callback runs", async () => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(pending.fetchImpl), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    // Only the wall clock moves. The source's synthetic timer is still pending.
    vi.setSystemTime(START_AT + SOURCE_TIMEOUT_MS);
    pending.reject(pending.signal().reason);
    expect(settledOfficialHttpTimeoutEvidence(await rejected(watched))).toBeUndefined();
  });

  it("keeps the original Response result for successful opted-in GET requests", async () => {
    const response = new Response("original response", { status: 200, headers: { "x-fixture": "value" } });
    const fetchImpl = vi.fn<typeof fetch>(async () => response);
    await expect(runWithOfficialSourceAttemptTimeout(() => retainedRequest(fetchImpl), SOURCE_TIMEOUT_MS))
      .resolves.toBe(response);
    expect(response.headers.get("x-fixture")).toBe("value");
    expect(await response.text()).toBe("original response");
    expect(settledOfficialHttpTimeoutEvidence(response)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["HEAD", { method: "HEAD" }, REQUEST_TIMEOUT_MS],
    ["POST", { method: "POST" }, REQUEST_TIMEOUT_MS],
    ["GET with a body", { method: "GET", body: "fixture body" }, REQUEST_TIMEOUT_MS],
    ["GET with an empty body", { method: "GET", body: "" }, REQUEST_TIMEOUT_MS],
    ["different request timeout", { method: "GET" }, 30_000]
  ] satisfies [string, RequestInit, number][])("does not retain evidence for opt-in %s", async (_name, init, timeoutMs) => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => fetchWithOfficialTimeout(REQUEST_URL, init, {
      fetchImpl: pending.fetchImpl, timeoutMs, retainSettledRequestTimeout: true
    }), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(timeoutMs);
    expect(watched.outcome().state).toBe("rejected");
    if (pending.fetchImpl.mock.calls.length > 0) pending.reject(pending.signal().reason);
    expect(settledOfficialHttpTimeoutEvidence(await rejected(watched))).toBeUndefined();
  });

  it.each(["no source context", "cancellation-only source context"] as const)(
    "does not enter unbounded settlement waiting with %s", async context => {
      const pending = controlledFetch(), cancellation = new AbortController();
      const watched = observe(context === "no source context"
        ? retainedRequest(pending.fetchImpl)
        : runWithOfficialSourceCancellation(cancellation.signal, () => retainedRequest(pending.fetchImpl)));
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      expect(watched.outcome().state).toBe("rejected");
      const error = await rejected(watched);
      expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
      if (pending.fetchImpl.mock.calls.length > 0) pending.reject(pending.signal().reason);
    }
  );

  it("does not retain evidence for URL or Request inputs outside the narrow string-GET path", async () => {
    for (const input of [
      new URL(REQUEST_URL),
      new Request(REQUEST_URL),
      new Request(REQUEST_URL, { method: "POST", body: "fixture body" })
    ]) {
      const pending = controlledFetch();
      const watched = observe(runWithOfficialSourceAttemptTimeout(() => fetchWithOfficialTimeout(input, {}, {
        fetchImpl: pending.fetchImpl, timeoutMs: REQUEST_TIMEOUT_MS, retainSettledRequestTimeout: true
      }), SOURCE_TIMEOUT_MS));
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      expect(watched.outcome().state).toBe("rejected");
      expect(settledOfficialHttpTimeoutEvidence(await rejected(watched))).toBeUndefined();
      pending.reject(pending.signal().reason);
    }
  });

  it("records the timer callback's actual timestamp when the timer is delayed", async () => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(pending.fetchImpl), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    // Model clock advancement while the callback cannot run, then allow it to fire.
    vi.setSystemTime(START_AT + 60_000);
    await vi.advanceTimersByTimeAsync(1);
    expect(watched.outcome().state).toBe("pending");
    pending.reject(pending.signal().reason);
    expect(settledOfficialHttpTimeoutEvidence(await rejected(watched))).toMatchObject({
      requestStartedAt: isoAfter(0), timeoutAt: isoAfter(60_001), settledAt: isoAfter(60_001),
      sourceDeadlineAt: isoAfter(SOURCE_TIMEOUT_MS)
    });
  });

  it("binds evidence to the request-start header snapshot rather than later caller mutations", async () => {
    const pending = controlledFetch();
    const headers = new Headers({ "X-Fixture-Token": "original-private-value", Accept: "application/json" });
    const initialHeaderEntries = [...headers.entries()];
    const expectedHash = createHash("sha256").update(JSON.stringify(initialHeaderEntries)).digest("hex");
    const watched = observe(runWithOfficialSourceAttemptTimeout(
      () => retainedRequest(pending.fetchImpl, { method: "GET", headers }), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(10_000);
    headers.set("X-Fixture-Token", "changed-private-value");
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 10_000);
    pending.reject(pending.signal().reason);
    const receipt = settledOfficialHttpTimeoutEvidence(await rejected(watched));
    expect(receipt).toMatchObject({ requestHeadersSha256: expectedHash });
    expect(JSON.stringify(receipt)).not.toMatch(/original-private-value|changed-private-value/u);
  });

  it("keeps deadline access scoped and uses canonical header hashing without exposing values", async () => {
    expect(currentOfficialSourceAttemptDeadlineAtMs()).toBeUndefined();
    await runWithOfficialSourceAttemptTimeout(async () => {
      expect(currentOfficialSourceAttemptDeadlineAtMs()).toBe(START_AT + SOURCE_TIMEOUT_MS);
      await runWithOfficialSourceCancellation(new AbortController().signal, async () => {
        expect(currentOfficialSourceAttemptDeadlineAtMs()).toBe(START_AT + SOURCE_TIMEOUT_MS);
      });
    }, SOURCE_TIMEOUT_MS);
    expect(currentOfficialSourceAttemptDeadlineAtMs()).toBeUndefined();
    expect(officialRequestHeadersSha256({ Accept: "application/json", "X-Fixture-Token": "secret-value" }))
      .toBe(officialRequestHeadersSha256([["x-fixture-token", "secret-value"], ["accept", "application/json"]]));
    expect(officialRequestHeadersSha256(undefined)).toBe(createHash("sha256").update("[]").digest("hex"));
  });

  it("rejects malformed proxy evidence without inspecting hostile traps", () => {
    const trap = vi.fn(() => { throw new Error("hostile error accessor"); });
    const proxy = new Proxy({}, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(settledOfficialHttpTimeoutEvidence(proxy)).toBeUndefined();
    expect(settledOfficialHttpTimeoutEvidence(revoked.proxy)).toBeUndefined();
    expect(trap).not.toHaveBeenCalled();
  });

  it("records only URL hashes and public origin for synthetic credential-bearing diagnostics", () => {
    const directory = mkdtempSync(join(tmpdir(), "official-settled-redaction-"));
    const path = join(directory, "requests.jsonl");
    vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", path);
    const input = "https://fixture-user:fixture-password@Jobs.Example.test/private-path?token=fixture-query#fixture-fragment";
    try {
      officialHttpRequestDiagnostics(input, REQUEST_TIMEOUT_MS)!("REQUEST_START");
      const raw = readFileSync(path, "utf8"), record = JSON.parse(raw);
      expect(record.url).toEqual({
        origin: "https://jobs.example.test",
        endpointSha256: createHash("sha256").update("https://jobs.example.test/private-path").digest("hex"),
        requestUrlSha256: createHash("sha256").update(input).digest("hex"), hasQuery: true
      });
      expect(raw).not.toMatch(/fixture-user|fixture-password|private-path|fixture-query|fixture-fragment|token=/u);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("preserves already-aborted caller precedence even when opt-in headers are invalid", async () => {
    const pending = controlledFetch(), caller = new AbortController();
    const reason = new Error("caller already cancelled");
    caller.abort(reason);
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(pending.fetchImpl, {
      signal: caller.signal, headers: { "invalid header name": "fixture-value" }
    }), SOURCE_TIMEOUT_MS));
    expect(await rejected(watched)).toBe(reason);
    expect(pending.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects forged, copied and wrapped timeout errors as settlement evidence", async () => {
    const pending = controlledFetch();
    const watched = observe(runWithOfficialSourceAttemptTimeout(() => retainedRequest(pending.fetchImpl), SOURCE_TIMEOUT_MS));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    pending.reject(pending.signal().reason);
    const original = await rejected(watched);
    const receipt = settledOfficialHttpTimeoutEvidence(original);
    expect(receipt).toBeDefined();
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(() => Object.assign(receipt!, { settlement: "FORGED" })).toThrow(TypeError);
    for (const error of [
      new OfficialHttpTimeoutError(),
      { code: "OFFICIAL_HTTP_TIMEOUT" },
      { ...Object(original) },
      Object.assign(new OfficialHttpTimeoutError(), { evidence: receipt }),
      Object.create(Object(original)),
      new Error("wrapped timeout", { cause: original }),
      null, undefined, "OFFICIAL_HTTP_TIMEOUT", 45_000
    ]) expect(settledOfficialHttpTimeoutEvidence(error)).toBeUndefined();
    expect(settledOfficialHttpTimeoutEvidence(original)).toEqual(receipt);
  });
});
