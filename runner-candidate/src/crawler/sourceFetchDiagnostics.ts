import { createHash } from "node:crypto";
import { sourceExecutionFailureCode } from "./sourceFailureDiagnostics";
import type { SourceFetchResult } from "./runSourceCrawl";
import {isRetryableSourceTransportFailure} from "./sourceFetchFailure";

// Only fixed source-code reasons are printable; unknown upstream text stays private.
const reasons = new Set([
  "Official JSON response final URL does not match the request", "Official JSON response captured time is outside the crawl window",
  "Official JSON response is missing required evidence metadata", "Official JSON response metadata contains sensitive material",
  "Official JSON response is not valid JSON", "Official JSON response root must be an object",
  "Official JSON response has an invalid Content-Type", "Official JSON TRANSPORT_FAILURE",
  "Novo China response failed its exact nested location and request scope contract", "Novo response requires a $.data.jobs array",
  "NOVO_APPLICATION_STATUS_UNKNOWN", "Novo application status UNKNOWN", "Phenom entry TRANSPORT_FAILURE",
  "Phenom entry response metadata is invalid", "Phenom widget response metadata is invalid",
  "Phenom required widget configuration was not found", "Phenom widget endpoint is invalid",
  "Phenom entry response has an invalid Content-Type", "Phenom widget response has an invalid Content-Type",
  "Phenom widgets response is not valid JSON", "Phenom widgets response requires $.refineSearch.data.jobs array",
  "Phenom Merck formal response ui_selections does not equal the requested selected_fields",
  "Merck China quality policy requires the exact source and bootstrap", "Merck China official field validation failed",
  "Organon quality policy requires the exact source and bootstrap", "Organon official field validation failed",
  "ORGANON_NATIVE_DETAIL_UNKNOWN_PRESERVE_LAST_GOOD", "ORGANON_KEYWORD_COUNTRY_SCOPE_UNKNOWN_PRESERVE_LAST_GOOD",
  "Expected exactly one new detail tab", "Pfizer UI entry navigation failed", "Pfizer UI native detail navigation failed",
  "Official recruitment endpoint temporarily rate limited the request (HTTP 429)", "Official recruitment browser session failed before evidence capture",
  "SANOFI_COMPACT_DECISION_MISMATCH"
]);
const lossCodes = new Set(["MERCK_RAW_FIELDS_INVALID", "MERCK_POSTED_DATE_INVALID", "ORGANON_RAW_FIELDS_INVALID",
  "ORGANON_POSTED_DATE_INVALID", "MISSING_REQUIRED_FIELD", "DUPLICATE_OFFICIAL_ID", "OUT_OF_SCOPE", "UNSAFE_OFFICIAL_URL", "SENSITIVE_OUTPUT"]);
function reason(value: string) {
  if (value === "Isolated B-grade traversal process exceeded its output limit") return "B_GRADE_VALIDATOR_OUTPUT_LIMIT_EXCEEDED";
  if (reasons.has(value)) return value;
  const browserCode = /^((?:CSPC|JNJ|SANOFI_CN|LOCAL_CHROMIUM)_[A-Z_]{1,70})(?::|$)/.exec(value);
  if (browserCode) return browserCode[1];
  if (value.includes("__name is not defined")) return "BROWSER_SERIALIZED_CLOSURE_NAME_MISSING";
  if (value.includes("Execution context was destroyed, most likely because of a navigation")) return "BROWSER_NAVIGATION_DURING_DOM_READ";
  if (/strict mode violation/.test(value)) return "BROWSER_SELECTOR_AMBIGUOUS";
  if (/InvalidSelectorError|Unknown engine.*selector|Unexpected token.*selector|is not a valid selector/.test(value)) return "BROWSER_SELECTOR_INVALID";
  if (/(?:locator|waitFor|evaluate|evaluateAll|domSnapshot|getAXState|createBrowserTab|listTabs|getTab|frameLocator)\b[^\n]{0,30}is not a function/.test(value)) return "BROWSER_METHOD_UNAVAILABLE";
  const http = /^(?:Phenom entry page|Phenom widgets|Official JSON source) returned HTTP ([1-5][0-9]{2})$/.exec(value);
  if (http) return `OFFICIAL_HTTP_${http[1]}`;
  if (/Running as root without --no-sandbox|No usable sandbox|Failed to move to new namespace|unshare.*Operation not permitted/i.test(value)) return "BROWSER_SANDBOX_UNAVAILABLE";
  if (/Executable doesn't exist|executable doesn't exist|spawn .* ENOENT/.test(value)) return "BROWSER_EXECUTABLE_MISSING";
  if (/Host system is missing dependencies|error while loading shared libraries/.test(value)) return "BROWSER_RUNTIME_DEPENDENCY_MISSING";
  const network = /\bnet::(ERR_(?:CERT_AUTHORITY_INVALID|CERT_DATE_INVALID|CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|NAME_NOT_RESOLVED|TIMED_OUT|SSL_PROTOCOL_ERROR))\b/.exec(value);
  if (network) return network[1];
  if (/Timeout [0-9]+ms exceeded|Timed out waiting|selector deadline exceeded|locator\.waitFor\(visible\) timed out/.test(value)) return "BROWSER_WAIT_TIMEOUT";
  if (/Target page, context or browser has been closed/.test(value)) return "BROWSER_TARGET_CLOSED";
  return "UNRECOGNIZED_PRIVATE_REASON";
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export function sourceFetchDiagnostic(sourceId: string, failure: {result: Extract<SourceFetchResult, {ok: false}>} | {error: unknown}) {
  const common = {event: "SOURCE_FETCH_DIAGNOSTIC", sourceId: /^source-[a-z0-9-]{1,100}$/.test(sourceId) ? sourceId : "INVALID_SOURCE_ID"};
  if ("error" in failure) {
    const error = failure.error instanceof Error ? failure.error : undefined;
    const message = error?.message ?? "NON_ERROR_THROW";
    const context = error as (Error & {sourceFetchStage?: unknown;sourceJobId?:unknown;sourcePage?:unknown;privateCapture?:{file?:unknown;sha256?:unknown};privateCaptureUnavailable?:unknown}) | undefined;
    const stage = context?.sourceFetchStage;
    const jnj = sourceId === "source-johnson-innovative-medicine-social";
    const privateCaptureSource = jnj || sourceId === "source-cspc-social" || sourceId === "source-sanofi-china-social" || sourceId === "source-pfizer-china-social" || sourceId === "source-bayer-healthcare-social";
    const capture = context?.privateCapture;
    const locations = error?.stack?.replaceAll("\\", "/").split("\n").slice(1)
      .flatMap(line => line.match(/(?:runner-candidate|web-candidate)\/(?:src|scripts)\/[A-Za-z0-9_./-]+\.[cm]?[jt]sx?:[0-9]+:[0-9]+/g) ?? []).slice(0, 6) ?? [];
    return {...common, phase: "THROWN", exceptionType: ["Error", "TypeError", "SyntaxError", "ReferenceError", "TimeoutError", "AbortError", "AssertionError"].includes(error?.name ?? "") ? error!.name : "OTHER_ERROR",
      ...(typeof stage === "string" && ["CSPC_DOM_CAPTURE", "JNJ_LIST_NAVIGATION", "JNJ_RESULTS_READY", "JNJ_HEADING_READY", "JNJ_DETAIL_NAVIGATION", "JNJ_DETAIL_READY", "JNJ_APPLY_READY", "JNJ_DETAIL_READ", "JNJ_DOM_AUDIT", "SANOFI_PAGE_READ", "SANOFI_PAGE_NEXT", "SANOFI_AJINGA_ROUTE", "SANOFI_AJINGA_ENTRY", "SANOFI_AJINGA_INFO", "SANOFI_AJINGA_STATUS", "SANOFI_AJINGA_REPLAY", "SANOFI_AJINGA_PROJECTION", "SANOFI_AJINGA_TITLE_MATCH", "SANOFI_AJINGA_DESCRIPTION_MATCH", "PFIZER_ENTRY_NAVIGATION", "PFIZER_CARDS_READY", "PFIZER_COUNTRY_READY", "PFIZER_DETAIL_CREATE", "PFIZER_LIST_READ", "PFIZER_DETAIL_READ", "PFIZER_PAGE_ADVANCE"].includes(stage) ? {stage} : {}),
      ...(privateCaptureSource && typeof context?.sourcePage === "number" && Number.isSafeInteger(context.sourcePage) && context.sourcePage > 0 && context.sourcePage <= 10000 ? {page:context.sourcePage} : {}),
      ...(jnj && typeof context?.sourceJobId === "string" && /^r-\d{1,20}$/.test(context.sourceJobId) ? {sourceJobId:context.sourceJobId} : {}),
      ...(sourceId === "source-sanofi-china-social" && typeof context?.sourceJobId === "string" && /^R[0-9]{1,20}$/.test(context.sourceJobId) ? {sourceJobId:context.sourceJobId} : {}),
      ...(privateCaptureSource && typeof capture?.file === "string" && /^(?:bayer-detail|cspc-dom|jnj-audit|jnj-detail-r-\d{1,20}|jnj-list-\d{1,5}|sanofi-page-\d{1,5}|sanofi-ajinga-(?:R[0-9]{1,20}|invalid)|pfizer-(?:entry|traversal))-[0-9a-f-]{36}\.json$/.test(capture.file) &&
        typeof capture.sha256 === "string" && /^[0-9a-f]{64}$/.test(capture.sha256) ? {privateCapture:{file:capture.file,sha256:capture.sha256}} : {}),
      ...(privateCaptureSource && context?.privateCaptureUnavailable === true ? {privateCaptureUnavailable:true} : {}),
      executionCode: sourceExecutionFailureCode(failure.error), reason: reason(message), reasonSha256: sha(message), locations};
  }
  const {result} = failure, httpStatuses: Record<string, number> = {}, losses: Record<string, number> = {};
  for (const artifact of result.fetchEvidence?.artifacts ?? []) {
    if (Number.isInteger(artifact.httpStatus) && artifact.httpStatus! >= 100 && artifact.httpStatus! <= 599) {
      const status = String(artifact.httpStatus); httpStatuses[status] = (httpStatuses[status] ?? 0) + 1;
    }
  }
  for (const loss of result.fetchEvidence?.fetchLosses ?? []) {
    const key = typeof loss.details?.code === "string" && lossCodes.has(loss.details.code) ? loss.details.code : "OTHER_VALIDATION_LOSS";
    losses[key] = (losses[key] ?? 0) + 1;
  }
  return {...common, phase: "RETURNED_FAILURE", reason: reason(result.failureReason), reasonSha256: sha(result.failureReason),
    ...(isRetryableSourceTransportFailure(result.transportFailure)?{transportCode:result.transportFailure.code,
      ...(result.transportFailure.retryAfterMs===undefined?{}:{retryAfterMs:result.transportFailure.retryAfterMs})}:{}),
    httpStatuses, validationLosses: losses};
}
export function reportSourceFetchFailure(sourceId: string, failure: Parameters<typeof sourceFetchDiagnostic>[1]) {
  try { console.error(JSON.stringify(sourceFetchDiagnostic(sourceId, failure))); }
  catch { /* Diagnostics must never change the original fetch result or exception. */ }
}
