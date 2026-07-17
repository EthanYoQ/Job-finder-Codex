import {
  isOfficialHttpTimeout,
  isOfficialSourceAttemptTimeout
} from "./officialHttpRuntimeLimits";

export type RetryableSourceTransportFailureCode =
  | "OFFICIAL_HTTP_TIMEOUT"
  | "OFFICIAL_HTTP_429"
  | "OFFICIAL_HTTP_502"
  | "OFFICIAL_HTTP_503"
  | "OFFICIAL_HTTP_504";

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

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const RETRYABLE_FAILURE_CODES = new Set<RetryableSourceTransportFailureCode>([
  "OFFICIAL_HTTP_TIMEOUT",
  "OFFICIAL_HTTP_429",
  "OFFICIAL_HTTP_502",
  "OFFICIAL_HTTP_503",
  "OFFICIAL_HTTP_504"
]);

export function isRetryableSourceTransportFailure(
  failure: unknown
): failure is SourceTransportFailure {
  if (typeof failure !== "object" || failure === null || !("code" in failure) ||
    !("retryable" in failure) || failure.retryable !== true) return false;
  return RETRYABLE_FAILURE_CODES.has(
    (failure as { code: RetryableSourceTransportFailureCode }).code
  );
}

export function retryableHttpTransportFailure(status: number): SourceTransportFailure | undefined {
  return RETRYABLE_HTTP_STATUSES.has(status)
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
    case "OFFICIAL_HTTP_502":
    case "OFFICIAL_HTTP_503":
    case "OFFICIAL_HTTP_504":
      return `Official recruitment endpoint was temporarily unavailable (${failure.code.replace("OFFICIAL_HTTP_", "HTTP ")})`;
  }
}
