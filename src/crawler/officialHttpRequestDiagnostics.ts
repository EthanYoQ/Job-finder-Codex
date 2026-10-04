import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";

type RequestEvent = "REQUEST_START" | "HEADERS_RECEIVED" | "BODY_COMPLETE" | "REQUEST_FAILED" | "BODY_FAILED";
type FailureKind = "HTTP_TIMEOUT" | "SOURCE_ABORT" | "CALLER_ABORT" | "TRANSPORT_OR_BODY_ERROR";

// Diagnostic vocabulary only; this must not determine transport retry policy.
const SAFE_ERROR_NAMES = new Set([
  "Error", "TypeError", "RangeError", "SyntaxError", "AggregateError", "AbortError", "TimeoutError",
  "OfficialHttpTimeoutError", "OfficialSourceAttemptTimeoutError"
]);
const SAFE_ERROR_CODES = new Set([
  "EAI_AGAIN", "ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH",
  "ENOTFOUND", "ETIMEDOUT", "EPIPE", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_ABORTED", "UND_ERR_RESPONSE_STATUS_CODE",
  "UND_ERR_CONTENT_LENGTH_MISMATCH", "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH", "ABORT_ERR", "ERR_ABORTED",
  "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
  "ERR_TLS_DH_PARAM_SIZE", "ERR_TLS_HANDSHAKE_TIMEOUT", "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_REVOKED",
  "OFFICIAL_HTTP_TIMEOUT", "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT"
]);

function safeErrorProperty(error: unknown, key: "name" | "code" | "cause"): unknown {
  // Read data properties only: arbitrary accessors must not run during telemetry.
  try {
    let current = error;
    for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
      current = Object.getPrototypeOf(current);
    }
  } catch { /* Proxies and exotic errors must not affect the original failure. */ }
  return undefined;
}

function safeFailureDetails(error: unknown): { errorName?: string; errorCode?: string; causeCode?: string } {
  let name = safeErrorProperty(error, "name");
  // DOMException exposes name through a native accessor; invoke only that trusted
  // accessor, never an accessor supplied on the thrown object or its prototypes.
  if (name === undefined) {
    try { name = Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get?.call(error); }
    catch { /* Not a native DOMException. */ }
  }
  const code = safeErrorProperty(error, "code");
  let cause = safeErrorProperty(error, "cause");
  let causeCode: string | undefined;
  const seen = new Set<unknown>([error]);
  for (let depth = 0; depth < 4 && typeof cause === "object" && cause !== null && !seen.has(cause); depth += 1) {
    seen.add(cause);
    const candidate = safeErrorProperty(cause, "code");
    if (typeof candidate === "string" && SAFE_ERROR_CODES.has(candidate)) { causeCode = candidate; break; }
    cause = safeErrorProperty(cause, "cause");
  }
  return {
    ...(typeof name === "string" && SAFE_ERROR_NAMES.has(name) ? { errorName: name } : {}),
    ...(typeof code === "string" && SAFE_ERROR_CODES.has(code) ? { errorCode: code } : {}),
    ...(causeCode === undefined ? {} : { causeCode })
  };
}

/** Optional private transport telemetry. Never serialize headers, bodies, raw errors,
 * URL userinfo, paths, query names/values or fragments. Each marker is fsynced. */
export function officialHttpRequestDiagnostics(input: Parameters<typeof fetch>[0], timeoutMs: number) {
  const path = process.env.P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH;
  if (!path) return undefined;
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let url: { origin: string; endpointSha256: string; hasQuery: boolean } | undefined;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      url = { origin: parsed.origin,
        endpointSha256: createHash("sha256").update(parsed.origin + parsed.pathname).digest("hex"),
        hasQuery: Boolean(parsed.search) };
    }
  } catch { /* Invalid inputs still get a request marker without URL content. */ }
  const requestId = randomUUID(), started = performance.now();
  let headersAt: number | undefined;
  let unavailable = false;
  return (event: RequestEvent, details: { status?: number; failureKind?: FailureKind; error?: unknown } = {}) => {
    if (unavailable) return;
    const now = performance.now();
    if (event === "HEADERS_RECEIVED") headersAt = now;
    const record = { schemaVersion: 1, requestId, pid: process.pid, event,
      recordedAt: new Date().toISOString(), durationMs: Math.round(now - started), timeoutMs,
      ...(headersAt === undefined ? {} : { bodyDurationMs: Math.round(now - headersAt) }),
      ...(url ? { url } : {}),
      ...(details.status === undefined ? {} : { status: details.status }),
      ...(details.failureKind === undefined ? {} : { failureKind: details.failureKind }),
      ...(event === "REQUEST_FAILED" || event === "BODY_FAILED" ? safeFailureDetails(details.error) : {}) };
    try {
      const fd = openSync(path, "a", 0o600);
      try { writeSync(fd, JSON.stringify(record) + "\n"); fsyncSync(fd); }
      finally { closeSync(fd); }
    } catch {
      // Telemetry must not replace the transport/body result or its original error.
      unavailable = true;
      console.error("OFFICIAL_HTTP_DIAGNOSTIC_WRITE_FAILED");
    }
  };
}
