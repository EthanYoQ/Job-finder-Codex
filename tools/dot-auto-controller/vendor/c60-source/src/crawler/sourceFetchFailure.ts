import {
  isOfficialHttpTimeout,
  isOfficialSourceAttemptTimeout
} from "./officialHttpRuntimeLimits";

type DecimalDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type RetryableSourceTransportFailureCode =
  | "OFFICIAL_HTTP_TIMEOUT"
  | "OFFICIAL_NETWORK_ERROR"
  | "OFFICIAL_BROWSER_SESSION_ERROR"
  | "OFFICIAL_PAGINATION_SNAPSHOT_DRIFT"
  | "OFFICIAL_HTTP_429"
  | `OFFICIAL_HTTP_5${DecimalDigit}${DecimalDigit}`;

export type SourceTransportFailureStage =
  | "ENTRY"
  | "FACET_GLOBAL"
  | "FACET_COUNTRY"
  | "PAGE";

export interface SourceTransportFailure {
  code: RetryableSourceTransportFailureCode;
  retryable: true;
  stage?: SourceTransportFailureStage;
  /** A server minimum; the router never extends the configured backoff to fit it. */
  retryAfterMs?: number;
}

export type OfficialRetryAfter = { value: string; delayMs: number } | { invalid: true };

/** Keep only an unambiguous bounded header, never arbitrary upstream text. */
export function parseOfficialRetryAfter(value: string | null, observedAtMs: number): OfficialRetryAfter | undefined {
  if (value === null) return undefined;
  if (value.length > 64 || !Number.isFinite(observedAtMs)) return { invalid: true };
  const normalized = value.replace(/^[ \t]+|[ \t]+$/gu, "");
  if (/^[0-9]{1,10}$/u.test(normalized)) {
    return { value: normalized, delayMs: Number(normalized) * 1_000 };
  }
  // Accept canonical IMF-fixdate only; obsolete, duplicate or ambiguous dates fail closed.
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/u.test(normalized)) return { invalid: true };
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== normalized) return { invalid: true };
  return { value: normalized, delayMs: Math.max(0, timestamp - observedAtMs) };
}

const RETRYABLE_FAILURE_CODE =
  /^(?:OFFICIAL_HTTP_TIMEOUT|OFFICIAL_NETWORK_ERROR|OFFICIAL_BROWSER_SESSION_ERROR|OFFICIAL_PAGINATION_SNAPSHOT_DRIFT|OFFICIAL_HTTP_429|OFFICIAL_HTTP_5\d\d)$/u;
const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET"
]);

export function isRetryableSourceTransportFailureCode(
  value: unknown
): value is RetryableSourceTransportFailureCode {
  return typeof value === "string" && RETRYABLE_FAILURE_CODE.test(value);
}

export function isRetryableSourceTransportFailure(
  failure: unknown
): failure is SourceTransportFailure {
  if (typeof failure !== "object" || failure === null || !("code" in failure) ||
    !("retryable" in failure) || failure.retryable !== true) return false;
  return isRetryableSourceTransportFailureCode(failure.code) &&
    (!("retryAfterMs" in failure) ||
      (typeof failure.retryAfterMs === "number" && Number.isSafeInteger(failure.retryAfterMs) && failure.retryAfterMs >= 0));
}

export function retryableHttpTransportFailure(status: number, retryAfter?: OfficialRetryAfter): SourceTransportFailure | undefined {
  if (retryAfter && ("invalid" in retryAfter || !Number.isSafeInteger(retryAfter.delayMs) || retryAfter.delayMs < 0)) return undefined;
  return status === 429 || status >= 500 && status <= 599
    ? { code: `OFFICIAL_HTTP_${status}` as RetryableSourceTransportFailureCode, retryable: true,
        ...(retryAfter && "delayMs" in retryAfter ? { retryAfterMs: retryAfter.delayMs } : {}) }
    : undefined;
}

export function retryableTransportFailureFromError(error: unknown): SourceTransportFailure | undefined {
  if (isOfficialSourceAttemptTimeout(error)) return undefined;
  if (isOfficialHttpTimeout(error)) return { code: "OFFICIAL_HTTP_TIMEOUT", retryable: true };
  return RETRYABLE_NETWORK_ERROR_CODES.has(nestedErrorCode(error) ?? "")
    ? { code: "OFFICIAL_NETWORK_ERROR", retryable: true }
    : undefined;
}

export function safeSourceTransportFailureReason(failure: SourceTransportFailure): string {
  if (!isRetryableSourceTransportFailure(failure)) return "Source transport failed";
  switch (failure.code) {
    case "OFFICIAL_HTTP_TIMEOUT":
      return "Official recruitment request timed out";
    case "OFFICIAL_NETWORK_ERROR":
      return "Official recruitment network request failed";
    case "OFFICIAL_BROWSER_SESSION_ERROR":
      return "Official recruitment browser session failed before evidence capture";
    case "OFFICIAL_PAGINATION_SNAPSHOT_DRIFT":
      return "Official recruitment pagination changed during traversal";
    case "OFFICIAL_HTTP_429":
      return "Official recruitment endpoint temporarily rate limited the request (HTTP 429)";
    default:
      return `Official recruitment endpoint was temporarily unavailable (${failure.code.replace("OFFICIAL_HTTP_", "HTTP ")})`;
  }
}

function nestedErrorCode(error: unknown): string | undefined {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0;
    depth < 5 && typeof current === "object" && current !== null && !seen.has(current);
    depth += 1) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }
  return undefined;
}
