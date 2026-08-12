import {
  isOfficialHttpTimeout,
  isOfficialSourceAttemptTimeout
} from "./officialHttpRuntimeLimits";

type DecimalDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type RetryableSourceTransportFailureCode =
  | "OFFICIAL_HTTP_TIMEOUT"
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
}

const RETRYABLE_FAILURE_CODE = /^(?:OFFICIAL_HTTP_TIMEOUT|OFFICIAL_HTTP_429|OFFICIAL_HTTP_5\d\d)$/u;

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
  return isRetryableSourceTransportFailureCode(failure.code);
}

export function retryableHttpTransportFailure(status: number): SourceTransportFailure | undefined {
  return status === 429 || status >= 500 && status <= 599
    ? { code: `OFFICIAL_HTTP_${status}` as RetryableSourceTransportFailureCode, retryable: true }
    : undefined;
}

export function retryableTransportFailureFromError(error: unknown): SourceTransportFailure | undefined {
  if (isOfficialSourceAttemptTimeout(error)) return undefined;
  return isOfficialHttpTimeout(error)
    ? { code: "OFFICIAL_HTTP_TIMEOUT", retryable: true }
    : undefined;
}

export function safeSourceTransportFailureReason(failure: SourceTransportFailure): string {
  if (!isRetryableSourceTransportFailure(failure)) return "Source transport failed";
  switch (failure.code) {
    case "OFFICIAL_HTTP_TIMEOUT":
      return "Official recruitment request timed out";
    case "OFFICIAL_HTTP_429":
      return "Official recruitment endpoint temporarily rate limited the request (HTTP 429)";
    default:
      return `Official recruitment endpoint was temporarily unavailable (${failure.code.replace("OFFICIAL_HTTP_", "HTTP ")})`;
  }
}
