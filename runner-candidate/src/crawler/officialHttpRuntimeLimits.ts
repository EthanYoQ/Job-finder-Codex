import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { officialHttpRequestDiagnostics } from "./officialHttpRequestDiagnostics";
import { assertOfficialHttpProxyRuntime } from "./officialHttpProxyRuntime";

export const DEFAULT_OFFICIAL_HTTP_TIMEOUT_MS = 45_000;
export const DEFAULT_SOURCE_ATTEMPT_TIMEOUT_MS = 5 * 60 * 1_000;
export const DEFAULT_SCHEDULED_ATTEMPT_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
export const SCHEDULED_ATTEMPT_MONITOR_GRACE_MS = 15 * 60 * 1_000;
export const DEFAULT_OFFICIAL_BROWSER_TIMEOUT_MS = 60_000;
export const DEFAULT_HCM_CLOUD_BROWSER_SETTLE_MS = 3_000;

type RuntimeEnv = Readonly<Record<string, string | undefined>>;
type SourceAttemptContext = { signal: AbortSignal; deadlineAtMs?: number };
const sourceAttemptContext = new AsyncLocalStorage<SourceAttemptContext>();

export class OfficialSourceAttemptTimeoutError extends Error {
  readonly code = "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT";

  constructor(timeoutMs: number) {
    super(`Official source attempt exceeded ${timeoutMs} milliseconds`);
    this.name = "OfficialSourceAttemptTimeoutError";
  }
}

export class OfficialHttpTimeoutError extends Error {
  readonly code = "OFFICIAL_HTTP_TIMEOUT";

  constructor() {
    super("Official HTTP request timed out");
    this.name = "OfficialHttpTimeoutError";
  }
}

export function officialHttpTimeoutMs(env: RuntimeEnv = process.env): number {
  return boundedEnvironmentInteger(
    env.P0_SOURCE_HTTP_TIMEOUT_MS,
    DEFAULT_OFFICIAL_HTTP_TIMEOUT_MS,
    5_000,
    120_000
  );
}

export function scheduledAttemptTimeoutMs(env: RuntimeEnv = process.env): number {
  return boundedEnvironmentInteger(
    env.P0_SCHEDULED_ATTEMPT_TIMEOUT_MS,
    DEFAULT_SCHEDULED_ATTEMPT_TIMEOUT_MS,
    60 * 60 * 1_000,
    24 * 60 * 60 * 1_000
  );
}

export function scheduledAttemptMaxRunningAgeHours(env: RuntimeEnv = process.env): number {
  return (scheduledAttemptTimeoutMs(env) + SCHEDULED_ATTEMPT_MONITOR_GRACE_MS) / (60 * 60 * 1_000);
}

export function sourceAttemptTimeoutMs(env: RuntimeEnv = process.env): number {
  return boundedEnvironmentInteger(
    env.P0_SOURCE_ATTEMPT_TIMEOUT_MS,
    DEFAULT_SOURCE_ATTEMPT_TIMEOUT_MS,
    30_000,
    30 * 60 * 1_000
  );
}

export function officialBrowserTimeoutMs(env: RuntimeEnv = process.env): number {
  return boundedEnvironmentInteger(
    env.P0_BROWSER_TIMEOUT_MS,
    DEFAULT_OFFICIAL_BROWSER_TIMEOUT_MS,
    5_000,
    120_000
  );
}

export function hcmCloudBrowserSettleMs(env: RuntimeEnv = process.env): number {
  return boundedEnvironmentInteger(
    env.P0_HCM_CLOUD_BROWSER_SETTLE_MS,
    DEFAULT_HCM_CLOUD_BROWSER_SETTLE_MS,
    500,
    30_000
  );
}

export function currentOfficialSourceAttemptSignal(): AbortSignal | undefined {
  return sourceAttemptContext.getStore()?.signal;
}

export function currentOfficialSourceAttemptRemainingMs(): number | undefined {
  const context = sourceAttemptContext.getStore();
  if (context?.deadlineAtMs === undefined) return undefined;
  return context.signal.aborted ? 0 : Math.max(0, context.deadlineAtMs - Date.now());
}

export function createAbortableClose(
  signal: AbortSignal | undefined,
  closeOperation: () => Promise<void>
): { close: () => Promise<void>; dispose: () => void } {
  let closePromise: Promise<void> | undefined;
  const close = () => closePromise ??= closeOperation();
  const abortListener = () => { void close().catch(() => undefined); };
  const dispose = () => signal?.removeEventListener("abort", abortListener);
  if (signal?.aborted) abortListener();
  else signal?.addEventListener("abort", abortListener, { once: true });
  return { close, dispose };
}

export function isOfficialSourceAttemptTimeout(error: unknown): error is OfficialSourceAttemptTimeoutError {
  return error instanceof OfficialSourceAttemptTimeoutError ||
    (typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT");
}

export function isOfficialHttpTimeout(error: unknown): error is OfficialHttpTimeoutError {
  return error instanceof OfficialHttpTimeoutError ||
    (typeof error === "object" && error !== null && "code" in error &&
      (error as { code?: unknown }).code === "OFFICIAL_HTTP_TIMEOUT");
}

export async function runWithOfficialSourceAttemptTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs = sourceAttemptTimeoutMs()
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30 * 60 * 1_000) {
    throw new Error("Official source attempt timeout must be an integer from 1 through 1800000 milliseconds");
  }
  const controller = new AbortController();
  const current = sourceAttemptContext.getStore();
  const combined = combineAbortSignals(current ? [current.signal, controller.signal] : [controller.signal]);
  const deadlineAtMs = Math.min(Date.now() + timeoutMs, current?.deadlineAtMs ?? Infinity);
  const timeoutError = new OfficialSourceAttemptTimeoutError(timeoutMs);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  return sourceAttemptContext.run({ signal: combined.signal, deadlineAtMs }, async () => {
    let abortListener: (() => void) | undefined;
    try {
      combined.signal.throwIfAborted();
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(combined.signal.reason);
        combined.signal.addEventListener("abort", abortListener, { once: true });
      });
      return await Promise.race([operation(), aborted]);
    } finally {
      clearTimeout(timer);
      if (abortListener) combined.signal.removeEventListener("abort", abortListener);
      combined.dispose();
    }
  });
}

/** Adds an outer ownership cancellation without replacing the source deadline. */
export async function runWithOfficialSourceCancellation<T>(
  signal: AbortSignal, operation: () => Promise<T>
): Promise<T> {
  const current = sourceAttemptContext.getStore();
  const combined = combineAbortSignals(current ? [current.signal, signal] : [signal]);
  try {
    combined.signal.throwIfAborted();
    return await sourceAttemptContext.run({ ...current, signal: combined.signal }, operation);
  } finally { combined.dispose(); }
}

export type SettledOfficialHttpTimeoutEvidence = Readonly<{
  schemaVersion: 1; kind: "NO_RESPONSE_REQUEST_ERROR"; code: "OFFICIAL_HTTP_TIMEOUT";
  requestedUrlSha256: string; requestHeadersSha256: string; method: "GET";
  requestStartedAt: string; timeoutAt: string; settledAt: string; timeoutMs: 45000;
  responseReceived: false; settlement: "FETCH_REJECTED"; cause: "REQUEST_TIMER";
  sourceDeadlineAt: string;
}>;
// Only this transport can attest timer ownership and fetch-promise settlement.
// This is not a claim that an OS socket or process terminated.
const settledTimeouts = new WeakMap<object, SettledOfficialHttpTimeoutEvidence>();
export function settledOfficialHttpTimeoutEvidence(error: unknown): SettledOfficialHttpTimeoutEvidence | undefined {
  // Identity in this private map is the proof. Do not inspect untrusted errors'
  // properties or prototypes, including proxies that can throw during instanceof.
  return typeof error === "object" && error !== null ? settledTimeouts.get(error) : undefined;
}
export function officialRequestHeadersSha256(headers: HeadersInit | undefined): string {
  return createHash("sha256").update(JSON.stringify([...new Headers(headers).entries()])).digest("hex");
}
export function currentOfficialSourceAttemptDeadlineAtMs(): number | undefined {
  return sourceAttemptContext.getStore()?.deadlineAtMs;
}
type OfficialHttpDependencies = { fetchImpl?: typeof fetch; timeoutMs?: number; retainSettledRequestTimeout?: boolean };

export function fetchWithOfficialTimeout<T>(
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  deps: OfficialHttpDependencies & { consumeResponse: (response: Response) => Promise<T> }
): Promise<T>;
export function fetchWithOfficialTimeout(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  deps?: OfficialHttpDependencies
): Promise<Response>;
/** A consumer keeps the deadline and source cancellation alive through body reads.
 * Without a consumer this retains the existing headers-only Response contract. */
export async function fetchWithOfficialTimeout<T>(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  deps: OfficialHttpDependencies & { consumeResponse?: (response: Response) => Promise<T> } = {}
): Promise<Response | T> {
  const timeoutMs = deps.timeoutMs ?? officialHttpTimeoutMs();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("Official HTTP timeout must be an integer from 1 through 120000 milliseconds");
  }
  // Fail before diagnostics or HTTP when native fetch cannot honor the requested proxy.
  if (!deps.fetchImpl) assertOfficialHttpProxyRuntime();
  // BI signing material must not reach telemetry, even as a whole-URL digest.
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const diagnosticInput = requestUrl.startsWith("https://coapi.51job.com/job_list.php?")
    ? "https://coapi.51job.com/job_list.php" : input;
  const diagnostic = officialHttpRequestDiagnostics(diagnosticInput, timeoutMs);
  const requestStartedAtMs = Date.now();
  const deadline = AbortSignal.timeout(timeoutMs);
  let timeoutAtMs: number | undefined;
  const recordTimeout = () => { timeoutAtMs = Date.now(); };
  deadline.addEventListener("abort", recordTimeout, { once: true });
  const sourceSignal = currentOfficialSourceAttemptSignal();
  const signals = [init.signal, sourceSignal, deadline].filter((signal): signal is AbortSignal => signal != null);
  const combined = combineAbortSignals(signals);
  const sourceDeadlineAtMs = currentOfficialSourceAttemptDeadlineAtMs();
  const retainSettledTimeout = deps.retainSettledRequestTimeout === true && timeoutMs === 45_000 &&
    typeof input === "string" && (init.method ?? "GET") === "GET" && init.body === undefined &&
    sourceSignal !== undefined && sourceDeadlineAtMs !== undefined;
  let requestHeadersDigest: string | undefined;
  type Settlement = { rejected: boolean; error?: unknown; atMs: number };
  let settlement: Promise<Settlement> | undefined;
  let headersReceived = false;
  let abortListener: (() => void) | undefined;
  try {
    combined.signal.throwIfAborted();
    requestHeadersDigest = retainSettledTimeout ? officialRequestHeadersSha256(init.headers) : undefined;
    diagnostic?.("REQUEST_START");
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(combined.signal.reason);
      combined.signal.addEventListener("abort", abortListener, { once: true });
    });
    const pending = (deps.fetchImpl ?? fetch)(input, { ...init, signal: combined.signal });
    // Install both handlers immediately: a late rejection must never escape.
    settlement = pending.then(() => ({ rejected: false, atMs: Date.now() }),
      error => ({ rejected: true, error, atMs: Date.now() }));
    const response = await Promise.race([pending, aborted]);
    headersReceived = true;
    diagnostic?.("HEADERS_RECEIVED", { status: response.status });
    if (!deps.consumeResponse) return response;
    combined.signal.throwIfAborted();
    const result = await Promise.race([deps.consumeResponse(response), aborted]);
    combined.signal.throwIfAborted();
    diagnostic?.("BODY_COMPLETE");
    return result;
  } catch (error) {
    const callerAborted = init.signal?.aborted === true;
    const sourceAttemptAborted = sourceSignal?.aborted === true;
    const timedOut = deadline.aborted && !callerAborted && !sourceAttemptAborted;
    diagnostic?.(headersReceived ? "BODY_FAILED" : "REQUEST_FAILED", {
      error,
      failureKind: timedOut ? "HTTP_TIMEOUT" : sourceAttemptAborted ? "SOURCE_ABORT" :
        callerAborted ? "CALLER_ABORT" : "TRANSPORT_OR_BODY_ERROR"
    });
    if (timedOut) {
      const failure = new OfficialHttpTimeoutError();
      if (retainSettledTimeout && !headersReceived && combined.signal.reason === deadline.reason && settlement) {
        // The HTTP timer alone cannot prove settlement. Wait only within the
        // existing caller/source cancellation scope and its original deadline.
        const cancellation = combineAbortSignals([sourceSignal!, ...(init.signal ? [init.signal] : [])]);
        let cancelListener: (() => void) | undefined;
        try {
          cancellation.signal.throwIfAborted();
          const cancelled = new Promise<never>((_resolve, reject) => {
            cancelListener = () => reject(cancellation.signal.reason);
            cancellation.signal.addEventListener("abort", cancelListener, { once: true });
          });
          const settled = await Promise.race([settlement, cancelled]);
          cancellation.signal.throwIfAborted();
          if (settled.rejected && settled.error === deadline.reason && timeoutAtMs !== undefined &&
              timeoutAtMs >= requestStartedAtMs + timeoutMs && settled.atMs >= timeoutAtMs &&
              Date.now() < sourceDeadlineAtMs! && settled.atMs < sourceDeadlineAtMs!) {
            settledTimeouts.set(failure, Object.freeze({ schemaVersion: 1, kind: "NO_RESPONSE_REQUEST_ERROR",
              code: "OFFICIAL_HTTP_TIMEOUT", requestedUrlSha256: createHash("sha256").update(input as string).digest("hex"),
              requestHeadersSha256: requestHeadersDigest!, method: "GET",
              requestStartedAt: new Date(requestStartedAtMs).toISOString(), timeoutAt: new Date(timeoutAtMs).toISOString(),
              settledAt: new Date(settled.atMs).toISOString(), timeoutMs: 45_000, responseReceived: false,
              settlement: "FETCH_REJECTED", cause: "REQUEST_TIMER", sourceDeadlineAt: new Date(sourceDeadlineAtMs!).toISOString() }));
          }
        } finally {
          if (cancelListener) cancellation.signal.removeEventListener("abort", cancelListener);
          cancellation.dispose();
        }
      }
      throw failure;
    }
    throw error;
  } finally {
    if (abortListener) combined.signal.removeEventListener("abort", abortListener);
    deadline.removeEventListener("abort", recordTimeout);
    combined.dispose();
  }
}

function combineAbortSignals(signals: readonly AbortSignal[]): {
  signal: AbortSignal;
  dispose: () => void;
} {
  if (signals.length === 0) {
    throw new Error("At least one abort signal is required");
  }
  if (signals.length === 1) {
    return { signal: signals[0]!, dispose: () => undefined };
  }

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const dispose = () => {
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.clear();
  };
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
    dispose();
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}

function boundedEnvironmentInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (raw === undefined || !/^[1-9]\d*$/u.test(raw)) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
