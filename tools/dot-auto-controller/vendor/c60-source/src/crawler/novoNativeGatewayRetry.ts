import { createHash } from "node:crypto";
import { load as loadHtml } from "cheerio";
import { z } from "zod";
import type { OfficialJsonHttpResponse } from "./officialJsonSourceFetch";
import { officialJsonNetworkArtifact, safeOfficialJsonEvidenceUrl } from "./officialJsonEvidence";
import { officialRequestHeadersSha256, currentOfficialSourceAttemptSignal } from "./officialHttpRuntimeLimits";
import { parseOfficialRetryAfter } from "./sourceFetchFailure";
import type { SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { NOVO_NATIVE_HEADERS } from "./novoNativeTimeout";

export const NOVO_NATIVE_RETRY = Object.freeze({ maxRetries: 1, backoffMs: 10_000, requestMs: 45_000, sourceMs: 20 * 60_000 });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const nativeKey = (value: string) => /^(?:novo-detail|novo-application)-[1-9][0-9]{5}\.en_GB$/u.test(value);
const iso = z.string().datetime();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const startSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("NOVO_NATIVE_GATEWAY_RETRY_START"),
  method: z.literal("GET"), attempt: z.literal(2), requestedUrlSha256: digest,
  requestHeadersSha256: digest, failedBodySha256: digest,
  failedStatus: z.union([z.literal(502), z.literal(503), z.literal(504)]),
  failedCapturedAt: iso, retryAfter: z.string().max(64).nullable(),
  startedAt: iso, sourceDeadlineAt: iso
}).strict();
export type NovoNativeGatewayRetryStart = z.infer<typeof startSchema>;

/** A strict subset of the existing C60 transport classifier. No challenges,
 * network errors, ambiguous content, or changed destination are retried here. */
export function novoNativeGatewayRetryAllowed(response: OfficialJsonHttpResponse, requestedUrl: string,
  allowApplicationRedirect: boolean): boolean {
  if (![502, 503, 504].includes(response.status)) return false;
  if (response.retryAfter && ("invalid" in response.retryAfter || response.retryAfter.delayMs < 0 ||
      !Number.isSafeInteger(response.retryAfter.delayMs) || response.retryAfter.delayMs > NOVO_NATIVE_RETRY.backoffMs)) return false;
  try {
    const final = new URL(response.finalUrl!);
    if (final.href !== requestedUrl && (!allowApplicationRedirect || final.origin !== "https://careers.novonordisk.com" ||
        final.username || final.password || final.search || final.hash || !/^\/job\/[^/]+\/[0-9]+\/$/u.test(final.pathname))) return false;
  } catch { return false; }
  const $ = loadHtml(response.body);
  if ($(".jobDisplay, #careerjobdisplay, input[type=password], [id*=captcha], [class*=captcha]").length) return false;
  $("script, style").remove();
  if (/\bERR_SSL_PROTOCOL_ERROR\b|\b(?:SSL|TLS)\s+(?:handshake|protocol)\s+(?:failed|failure|error)\b/iu.test($.text())) return false;
  return !/captcha|verify\s+(?:that\s+)?you\s+are\s+human|access\s+(?:denied|blocked)|forbidden|request\s+blocked|sign\s*in|log\s*in|authentication\s+required|CERT_[A-Z_]+|ERR_TLS_[A-Z_]+|UNABLE_TO_VERIFY_LEAF_SIGNATURE|(?:SSL|TLS)\s+certificate|certificate\s+(?:(?:verify|verification|validation)\s+failed|(?:has\s+)?expired|is\s+(?:invalid|not\s+trusted))|self[- ]signed\s+certificate|unable\s+to\s+verify\s+(?:the\s+)?(?:first\s+)?certificate|验证码|人机验证|登录|拒绝访问|证书错误/iu.test($.text());
}

export function novoNativeGatewayFailureArtifact(response: OfficialJsonHttpResponse, requestedUrl: string,
  logicalKey: string): SourceFetchArtifactDraft {
  if (!nativeKey(logicalKey)) throw Error("Invalid Novo native retry slot");
  const key = `${logicalKey}-http-error-1`;
  return officialJsonNetworkArtifact({ id: key, logicalKey: key, kind: "OFFICIAL_COMPANY_PAGE", requestedUrl,
    response, extractorLocator: key, bodyRepresentation: "EXACT" });
}

/** Restore only the already-bound request for local validation, never for a new
 * request or persisted output. Other final URLs must be canonical official
 * posting URLs with no query, credentials or fragment. */
export function novoNativeGatewayReplayFinalUrl(persistedFinalUrl: string | undefined,
  requestedUrl: string, allowApplicationRedirect: boolean): string {
  if (persistedFinalUrl === safeOfficialJsonEvidenceUrl(requestedUrl)) return requestedUrl;
  if (persistedFinalUrl !== undefined && allowApplicationRedirect) {
    const final = new URL(persistedFinalUrl);
    if (final.href === persistedFinalUrl && final.origin === "https://careers.novonordisk.com" &&
        !final.username && !final.password && !final.search && !final.hash &&
        /^\/job\/[^/]+\/[0-9]+\/$/u.test(final.pathname)) return persistedFinalUrl;
  }
  throw Error("Invalid Novo persisted gateway final URL binding");
}

export function novoNativeGatewayRetryArtifact(value: unknown, failed: SourceFetchArtifactDraft,
  requestedUrl: string, logicalKey: string, allowApplicationRedirect: boolean): SourceFetchArtifactDraft {
  const start = startSchema.parse(value);
  const body = typeof failed.body === "string" ? failed.body : Buffer.from(failed.body).toString("utf8");
  const retryAfter = parseOfficialRetryAfter(start.retryAfter, Date.parse(failed.capturedAt));
  const response: OfficialJsonHttpResponse = { status: failed.httpStatus!, body,
    finalUrl: novoNativeGatewayReplayFinalUrl(failed.finalUrl, requestedUrl, allowApplicationRedirect),
    contentType: failed.contentType!, capturedAt: failed.capturedAt, ...(retryAfter ? { retryAfter } : {}) };
  if (!nativeKey(logicalKey) || failed.logicalKey !== `${logicalKey}-http-error-1` ||
      failed.extractorLocator !== failed.logicalKey || failed.kind !== "OFFICIAL_COMPANY_PAGE" ||
      failed.requestedUrl !== safeOfficialJsonEvidenceUrl(requestedUrl) ||
      failed.bodyRepresentation !== "EXACT" || failed.rawBodySha256 !== undefined || failed.redactionDescriptors !== undefined ||
      !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu.test(failed.contentType ?? "") ||
      !novoNativeGatewayRetryAllowed(response, requestedUrl, allowApplicationRedirect) ||
      start.requestedUrlSha256 !== hash(requestedUrl) || start.requestHeadersSha256 !== officialRequestHeadersSha256(NOVO_NATIVE_HEADERS) ||
      start.failedBodySha256 !== hash(body) || start.failedStatus !== failed.httpStatus || start.failedCapturedAt !== failed.capturedAt ||
      Date.parse(start.startedAt) < Date.parse(failed.capturedAt) + NOVO_NATIVE_RETRY.backoffMs ||
      Date.parse(start.startedAt) + NOVO_NATIVE_RETRY.requestMs >= Date.parse(start.sourceDeadlineAt)) {
    throw Error("Invalid Novo native gateway retry proof");
  }
  const key = `${logicalKey}-http-retry-1`;
  return { id: key, logicalKey: key, kind: "COMMAND_OUTPUT", bodyRepresentation: "EXACT", capturedAt: start.startedAt,
    extractorLocator: `novo-native-gateway-retry-v1|page:${logicalKey}|attempt:2`, body: JSON.stringify(start) };
}

export function novoNativeGatewayRetryStart(failed: SourceFetchArtifactDraft, response: OfficialJsonHttpResponse,
  requestedUrl: string, startedAt: string, sourceDeadlineAt: string): NovoNativeGatewayRetryStart {
  return startSchema.parse({ schemaVersion: 1, kind: "NOVO_NATIVE_GATEWAY_RETRY_START", method: "GET", attempt: 2,
    requestedUrlSha256: hash(requestedUrl), requestHeadersSha256: officialRequestHeadersSha256(NOVO_NATIVE_HEADERS),
    failedBodySha256: hash(typeof failed.body === "string" ? failed.body : Buffer.from(failed.body).toString("utf8")),
    failedStatus: failed.httpStatus, failedCapturedAt: failed.capturedAt,
    retryAfter: response.retryAfter && "value" in response.retryAfter ? response.retryAfter.value : null,
    startedAt, sourceDeadlineAt });
}

export async function delayNovoNativeRetry(milliseconds: number): Promise<void> {
  const signal = currentOfficialSourceAttemptSignal();
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
