import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_OFFICIAL_HTTP_TIMEOUT_MS = 45_000;
export const DEFAULT_SOURCE_ATTEMPT_TIMEOUT_MS = 5 * 60 * 1_000;
export const DEFAULT_SCHEDULED_ATTEMPT_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
export const SCHEDULED_ATTEMPT_MONITOR_GRACE_MS = 15 * 60 * 1_000;
export const DEFAULT_OFFICIAL_BROWSER_TIMEOUT_MS = 60_000;
export const DEFAULT_HCM_CLOUD_BROWSER_SETTLE_MS = 3_000;

type RuntimeEnv = Readonly<Record<string, string | undefined>>;
const sourceAttemptSignal = new AsyncLocalStorage<AbortSignal>();

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
  return sourceAttemptSignal.getStore();
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
  const timeoutError = new OfficialSourceAttemptTimeoutError(timeoutMs);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  return sourceAttemptSignal.run(controller.signal, async () => {
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(timeoutError), { once: true });
    });
    try {
      return await Promise.race([operation(), aborted]);
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Adds an outer ownership cancellation without replacing the source deadline. */
export async function runWithOfficialSourceCancellation<T>(
  signal: AbortSignal, operation: () => Promise<T>
): Promise<T> {
  const current = sourceAttemptSignal.getStore();
  const combined = combineAbortSignals(current ? [current, signal] : [signal]);
  try {
    combined.signal.throwIfAborted();
    return await sourceAttemptSignal.run(combined.signal, operation);
  } finally { combined.dispose(); }
}

export async function fetchWithOfficialTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<Response> {
  const timeoutMs = deps.timeoutMs ?? officialHttpTimeoutMs();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error("Official HTTP timeout must be an integer from 1 through 120000 milliseconds");
  }
  const deadline = AbortSignal.timeout(timeoutMs);
  const sourceSignal = sourceAttemptSignal.getStore();
  const signals = [init.signal, sourceSignal, deadline].filter((signal): signal is AbortSignal => signal !== undefined);
  const combined = combineAbortSignals(signals);
  try {
    return await (deps.fetchImpl ?? fetch)(input, { ...init, signal: combined.signal });
  } catch (error) {
    const callerAborted = init.signal?.aborted === true;
    const sourceAttemptAborted = sourceSignal?.aborted === true;
    if (deadline.aborted && !callerAborted && !sourceAttemptAborted) {
      throw new OfficialHttpTimeoutError();
    }
    throw error;
  } finally {
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
