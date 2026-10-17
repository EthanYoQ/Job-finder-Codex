import { createHash } from "node:crypto";
import { z } from "zod";
import { officialRequestHeadersSha256, type SettledOfficialHttpTimeoutEvidence } from "./officialHttpRuntimeLimits";
import type { SourceFetchArtifactDraft } from "./sourceFetchEvidence";

export const NOVO_NATIVE_HEADERS = Object.freeze({ Accept: "text/html", "User-Agent": "job-search-crawler/0.1" });
const hash = (url: string) => createHash("sha256").update(url).digest("hex");
const iso = z.string().datetime();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const receiptSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("NO_RESPONSE_REQUEST_ERROR"), code: z.literal("OFFICIAL_HTTP_TIMEOUT"),
  requestedUrlSha256: digest, requestHeadersSha256: digest, method: z.literal("GET"),
  requestStartedAt: iso, timeoutAt: iso, settledAt: iso, timeoutMs: z.literal(45_000),
  responseReceived: z.literal(false), settlement: z.literal("FETCH_REJECTED"), cause: z.literal("REQUEST_TIMER"),
  sourceDeadlineAt: iso
}).strict();
const retrySchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal("REQUEST_RETRY_START"), method: z.literal("GET"), attempt: z.literal(2),
  requestedUrlSha256: digest, requestHeadersSha256: digest, startedAt: iso, sourceDeadlineAt: iso
}).strict();
export type NovoTimeoutRetryStart = z.infer<typeof retrySchema>;

export function parseNovoTimeoutReceipt(value: unknown, requestedUrl: string): SettledOfficialHttpTimeoutEvidence {
  const receipt = receiptSchema.parse(value);
  if (receipt.requestedUrlSha256 !== hash(requestedUrl) ||
      receipt.requestHeadersSha256 !== officialRequestHeadersSha256(NOVO_NATIVE_HEADERS) ||
      Date.parse(receipt.timeoutAt) < Date.parse(receipt.requestStartedAt) + 45_000 ||
      Date.parse(receipt.settledAt) < Date.parse(receipt.timeoutAt) ||
      Date.parse(receipt.settledAt) >= Date.parse(receipt.sourceDeadlineAt)) throw Error("Invalid Novo no-response receipt");
  return receipt;
}
const nativeKey = (key: string) => /^(?:novo-detail|novo-application)-[1-9][0-9]{5}\.en_GB$/u.test(key);
export function novoNativeTimeoutArtifact(value: unknown, requestedUrl: string, logicalKey: string, attempt: 1 | 2): SourceFetchArtifactDraft {
  const receipt = parseNovoTimeoutReceipt(value, requestedUrl);
  if (!nativeKey(logicalKey) || (attempt !== 1 && attempt !== 2)) throw Error("Invalid Novo timeout slot");
  const key = `${logicalKey}-request-error-${attempt}`;
  return { id: key, logicalKey: key, kind: "COMMAND_OUTPUT", bodyRepresentation: "EXACT",
    capturedAt: receipt.settledAt, extractorLocator: `novo-native-no-response-v1|page:${logicalKey}|attempt:${attempt}`,
    body: JSON.stringify(receipt) };
}
export function novoNativeTimeoutRetryArtifact(value: unknown, receipt: SettledOfficialHttpTimeoutEvidence,
  requestedUrl: string, logicalKey: string): SourceFetchArtifactDraft {
  const retry = retrySchema.parse(value);
  if (!nativeKey(logicalKey) || retry.requestedUrlSha256 !== hash(requestedUrl) ||
      retry.requestHeadersSha256 !== receipt.requestHeadersSha256 || retry.sourceDeadlineAt !== receipt.sourceDeadlineAt ||
      Date.parse(retry.startedAt) < Date.parse(receipt.settledAt) + 10_000 ||
      Date.parse(retry.startedAt) + 45_000 >= Date.parse(retry.sourceDeadlineAt)) throw Error("Invalid Novo timeout retry start");
  const key = `${logicalKey}-request-retry-1`;
  return { id: key, logicalKey: key, kind: "COMMAND_OUTPUT", bodyRepresentation: "EXACT", capturedAt: retry.startedAt,
    extractorLocator: `novo-native-timeout-retry-v1|page:${logicalKey}|attempt:2`, body: JSON.stringify(retry) };
}
