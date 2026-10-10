import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import {
  deriveCanonicalPaginationEvidence,
  evaluatePaginationEvidence,
  type PaginationEvaluation
} from "./paginationEvidence";

export interface OfficialJsonEvidenceHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export interface OfficialJsonEvidenceState {
  artifact: SourceFetchArtifactDraft;
  page: SourceFetchPageTrace;
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
  rawCount: number;
  parsedCount: number;
  validCount: number;
  parseDiscardCount: number;
  validationDiscardCount: number;
}

export function assertOfficialJsonEvidenceResponse(
  response: OfficialJsonEvidenceHttpResponse,
  input: { requestedUrl: string; crawlStartedAtMs: number; observedNowMs: number }
): void {
  if (
    typeof response.finalUrl !== "string" || !response.finalUrl ||
    typeof response.contentType !== "string" || !response.contentType.trim() ||
    typeof response.capturedAt !== "string"
  ) {
    throw new Error("Official JSON response is missing required evidence metadata");
  }
  if (sensitiveOfficialJsonField({ contentType: response.contentType })) {
    throw new Error("Official JSON response metadata contains sensitive material");
  }
  const requested = parseUrl(input.requestedUrl, "Official JSON request URL is invalid");
  const final = parseUrl(response.finalUrl, "Official JSON response final URL is invalid");
  assertCredentialSafeUrl(requested);
  assertCredentialSafeUrl(final);
  if (requested.protocol !== "https:" || final.protocol !== "https:" || requested.href !== final.href) {
    throw new Error("Official JSON response final URL does not match the request");
  }
  const responseTime = strictInstant(response.capturedAt);
  if (responseTime < input.crawlStartedAtMs || responseTime > input.observedNowMs) {
    throw new Error("Official JSON response captured time is outside the crawl window");
  }
}

export function assertOfficialJsonMime(response: OfficialJsonEvidenceHttpResponse): void {
  const essence = response.contentType!.split(";", 1)[0]!.trim().toLowerCase();
  if (!(essence === "application/json" || /^application\/[a-z0-9.+-]+\+json$/.test(essence))) {
    throw new Error("Official JSON response has an invalid Content-Type");
  }
}

export function assertOfficialHtmlMime(response: OfficialJsonEvidenceHttpResponse): void {
  const essence = response.contentType!.split(";", 1)[0]!.trim().toLowerCase();
  if (!(essence === "text/html" || essence === "application/xhtml+xml")) {
    throw new Error("Official HTML response has an invalid Content-Type");
  }
}

export function officialJsonNetworkArtifact(input: {
  id: string;
  logicalKey: string;
  kind: "OFFICIAL_COMPANY_PAGE" | "ATS_API_RESPONSE" | "PAGINATION_PAGE";
  requestedUrl: string;
  response: OfficialJsonEvidenceHttpResponse;
  extractorLocator: string;
  bodyRepresentation?: "EXACT" | "REDACTED";
  rawBodySha256?: string;
  redactionDescriptors?: Array<{ kind: "CREDENTIAL_MATERIAL" | "UPSTREAM_ERROR_TEXT"; count: number }>;
}): SourceFetchArtifactDraft {
  return {
    id: input.id,
    logicalKey: input.logicalKey,
    kind: input.kind,
    requestedUrl: evidenceUrl(input.requestedUrl),
    finalUrl: evidenceUrl(input.response.finalUrl!),
    httpStatus: input.response.status,
    contentType: input.response.contentType!,
    capturedAt: input.response.capturedAt!,
    body: input.response.body,
    ...(input.bodyRepresentation ? { bodyRepresentation: input.bodyRepresentation } : {}),
    ...(input.rawBodySha256 ? { rawBodySha256: input.rawBodySha256 } : {}),
    ...(input.redactionDescriptors ? { redactionDescriptors: input.redactionDescriptors } : {}),
    extractorLocator: input.extractorLocator
  };
}

export function officialJsonArtifact(input: {
  requestedUrl: string;
  response: OfficialJsonEvidenceHttpResponse;
  extractorLocator: string;
}): SourceFetchArtifactDraft {
  return {
    id: "official-json-page-0000",
    logicalKey: "official-json-page-0000",
    kind: "ATS_API_RESPONSE",
    requestedUrl: evidenceUrl(input.requestedUrl),
    finalUrl: evidenceUrl(input.response.finalUrl!),
    httpStatus: input.response.status,
    contentType: input.response.contentType!,
    capturedAt: input.response.capturedAt!,
    body: input.response.body,
    extractorLocator: input.extractorLocator
  };
}

export function initialOfficialJsonEvidenceState(input: {
  artifact: SourceFetchArtifactDraft;
  declaredTotal?: number;
  termination: "ABORTED" | "FAILED";
}): OfficialJsonEvidenceState {
  return {
    artifact: input.artifact,
    page: {
      sequence: 0,
      artifactLogicalKey: input.artifact.logicalKey,
      requestedCursor: null,
      returnedCursor: null,
      requestedOffset: null,
      returnedOffset: null,
      requestedPage: null,
      returnedPage: null,
      rawJobIds: [],
      validJobIds: [],
      declaredTotal: input.declaredTotal ?? null,
      declaredCount: null,
      declaredPages: null,
      nextPageSignalBefore: null,
      nextPageSignalAfter: null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(String(input.artifact.body), "utf8")).sha256,
      termination: input.termination,
      anomalyCodes: [],
      capturedAt: input.artifact.capturedAt
    },
    fetchLosses: [],
    rawCount: 0,
    parsedCount: 0,
    validCount: 0,
    parseDiscardCount: 0,
    validationDiscardCount: 0
  };
}

export function finalizeOfficialJsonEvidence(input: {
  state: OfficialJsonEvidenceState;
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"];
}): { evidence: PersistentSourceFetchEvidence; evaluation: PaginationEvaluation } {
  const raw = buildEvidence(input);
  const evidence = deriveCanonicalPaginationEvidence({ evidence: raw, expectedChannelIds: [], filteredOutput: true });
  const evaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true });
  return { evidence, evaluation };
}

export function finalizeOfficialJsonFailureEvidence(
  state: OfficialJsonEvidenceState
): PersistentSourceFetchEvidence {
  return buildEvidence({ state });
}

export function finalizeOfficialJsonEvidenceBundle(input: {
  artifacts: SourceFetchArtifactDraft[];
  pages: SourceFetchPageTrace[];
  fetchCounts: PersistentSourceFetchEvidence["fetchCounts"];
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"];
  expectedChannelIds?: string[];
  allowMissingReturnedPage?: boolean;
  allowPositiveOfficialTotalCountAfterAdapterReconciliation?: boolean;
  allowIndependentlyVerifiedProfileBoundExclusions?: boolean;
  allowRawIdOverlapAcrossPages?: boolean;
}): { evidence: PersistentSourceFetchEvidence; evaluation: PaginationEvaluation } {
  if (input.pages.length === 0) throw new Error("successful Official JSON evidence requires at least one page");
  const raw = buildEvidenceBundle(input);
  const evidence = deriveCanonicalPaginationEvidence({
    evidence: raw,
    expectedChannelIds: input.expectedChannelIds ?? [],
    filteredOutput: true,
    ...(input.allowMissingReturnedPage === undefined ? {} : {
      allowMissingReturnedPage: input.allowMissingReturnedPage
    }),
    ...(input.allowPositiveOfficialTotalCountAfterAdapterReconciliation === undefined ? {} : {
      allowPositiveOfficialTotalCountAfterAdapterReconciliation:
        input.allowPositiveOfficialTotalCountAfterAdapterReconciliation
    }),
    ...(input.allowIndependentlyVerifiedProfileBoundExclusions === undefined ? {} : {
      allowIndependentlyVerifiedProfileBoundExclusions:
        input.allowIndependentlyVerifiedProfileBoundExclusions
    }),
    ...(input.allowRawIdOverlapAcrossPages === undefined ? {} : {
      allowRawIdOverlapAcrossPages: input.allowRawIdOverlapAcrossPages
    })
  });
  const evaluation = evaluatePaginationEvidence({
    evidence,
    expectedChannelIds: input.expectedChannelIds ?? [],
    filteredOutput: true,
    ...(input.allowMissingReturnedPage === undefined ? {} : {
      allowMissingReturnedPage: input.allowMissingReturnedPage
    }),
    ...(input.allowPositiveOfficialTotalCountAfterAdapterReconciliation === undefined ? {} : {
      allowPositiveOfficialTotalCountAfterAdapterReconciliation:
        input.allowPositiveOfficialTotalCountAfterAdapterReconciliation
    }),
    ...(input.allowIndependentlyVerifiedProfileBoundExclusions === undefined ? {} : {
      allowIndependentlyVerifiedProfileBoundExclusions:
        input.allowIndependentlyVerifiedProfileBoundExclusions
    }),
    ...(input.allowRawIdOverlapAcrossPages === undefined ? {} : {
      allowRawIdOverlapAcrossPages: input.allowRawIdOverlapAcrossPages
    })
  });
  return { evidence, evaluation };
}

export function finalizeOfficialJsonSupportingFailureEvidence(input: {
  artifacts: SourceFetchArtifactDraft[];
  code: string;
}): PersistentSourceFetchEvidence {
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "official-json-http", version: "1" },
    artifacts: input.artifacts,
    pages: [],
    supportingArtifactOnlyFailure: { code: input.code },
    fetchCounts: {
      rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
    },
    fetchLosses: []
  });
}

export function finalizeOfficialJsonFailureEvidenceBundle(input: {
  artifacts: SourceFetchArtifactDraft[];
  pages: SourceFetchPageTrace[];
  fetchCounts: PersistentSourceFetchEvidence["fetchCounts"];
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"];
}): PersistentSourceFetchEvidence {
  return buildEvidenceBundle(input);
}

function buildEvidence(input: {
  state: OfficialJsonEvidenceState;
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"];
}): PersistentSourceFetchEvidence {
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "official-json-http", version: "1" },
    artifacts: [input.state.artifact],
    pages: [input.state.page],
    ...(input.declaredCompleteness ? { declaredCompleteness: input.declaredCompleteness } : {}),
    fetchCounts: {
      rawCount: input.state.rawCount,
      parsedCount: input.state.parsedCount,
      validCount: input.state.validCount,
      parseDiscardCount: input.state.parseDiscardCount,
      validationDiscardCount: input.state.validationDiscardCount
    },
    fetchLosses: input.state.fetchLosses
  });
}

function buildEvidenceBundle(input: {
  artifacts: SourceFetchArtifactDraft[];
  pages: SourceFetchPageTrace[];
  fetchCounts: PersistentSourceFetchEvidence["fetchCounts"];
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"];
}): PersistentSourceFetchEvidence {
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "official-json-http", version: "1" },
    artifacts: input.artifacts,
    pages: input.pages,
    ...(input.declaredCompleteness ? { declaredCompleteness: input.declaredCompleteness } : {}),
    fetchCounts: input.fetchCounts,
    fetchLosses: input.fetchLosses
  });
}

export function officialJsonRawLocator(
  raw: unknown,
  recordIndex: number
): string {
  return `official-json-page-0000#record:${recordIndex}#sha256:${hashValue(raw)}`;
}

export function irreversibleOfficialJsonEvidenceId(value: unknown): string {
  return `sha256:${hashValue(value)}`;
}

export function persistentOfficialJsonJobId(value: string): string {
  return `official-json:sha256:${hashValue(value)}`;
}

export function safeOfficialJsonId(value: string): boolean {
  if (
    !/^[A-Za-z0-9._-]{1,128}$/.test(value) ||
    value === "." || value === ".." ||
    sensitiveOfficialJsonField({ id: value })
  ) return false;
  const probe = new URL(`https://official-json.invalid/root/${value}`);
  return probe.origin === "https://official-json.invalid" && probe.pathname === `/root/${value}`;
}

export function sensitiveOfficialJsonField(fields: Record<string, string>): string | undefined {
  for (const [field, raw] of Object.entries(fields)) {
    const value = decodeAndNormalize(raw);
    if (/\b(?:bearer|basic)(?:\s|%20|:|=)+[a-z0-9._~+\/-]{3,}/iu.test(value)) return field;
    if (/(?:^|[^a-z0-9])(?:api[._-]?key|client[._-]?secret|access[._-]?token|refresh[._-]?token|token|secret|password|passwd|pwd|credential|auth|authorization|cookie|session|jwt)\s*[:=]\s*\S+/iu.test(value)) return field;
  }
  return undefined;
}

export function explicitlyOutsideChina(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  return explicitlyForeignOrNonMainlandLocation(normalized) &&
    !/(?:中华人民共和国|中国大陆|中国|大陆|china|prc|people'?s republic of china|mainland china|上海|北京|广州|深圳|成都|杭州|南京|苏州|武汉|天津|重庆|西安|兰州)/iu.test(normalized);
}

export function explicitlyForeignOrNonMainlandLocation(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  const englishForeignToken = /\b(?:united states|usa|u\.s\.|boston|new york|singapore|japan|tokyo|india|germany|france|canada|australia|united kingdom|u\.k\.|london|south korea|republic of korea|malaysia|indonesia|thailand|viet\s*nam|vietnam|philippines|netherlands|belgium|switzerland|sweden|spain|italy|poland|mexico|brazil|argentina|austria|ireland|israel|türkiye|turkey|colombia|chile|peru|south africa|new zealand|united arab emirates|saudi arabia|russia|hong[\s-]+kong(?:\s+sar)?|macau|macao|taiwan|hk|hkg|sg|sgp|tw|twn|mo|mac)\b/u;
  if (englishForeignToken.test(normalized)) return true;
  const chineseBoundary = "(?:^|[,，/|;；\\r\\n>、(（)）\\-–—])\\s*";
  const chineseForeignToken = "(?:美国|纽约|波士顿|新加坡|日本|东京|印度|德国|法国|加拿大|澳大利亚|英国|伦敦|韩国|马来西亚|印度尼西亚|泰国|越南|菲律宾|荷兰|比利时|瑞士|瑞典|西班牙|意大利|波兰|墨西哥|巴西|阿根廷|奥地利|爱尔兰|以色列|土耳其|哥伦比亚|智利|秘鲁|南非|新西兰|阿联酋|沙特阿拉伯|俄罗斯|香港(?:特别行政区)?|澳门(?:特别行政区)?|台湾)";
  return new RegExp(`${chineseBoundary}${chineseForeignToken}`, "u").test(normalized);
}

const GENERIC_OR_AMBIGUOUS_LOCATION_SEGMENTS = new Set([
  "remote",
  "multiple location",
  "multiple locations",
  "various location",
  "various locations",
  "global",
  "hybrid",
  "远程",
  "多个地点",
  "多地",
  "全球",
  "混合办公"
]);

export function explicitlyGenericOrAmbiguousLocation(value: string): boolean {
  return value.normalize("NFKC").toLowerCase()
    .split(/[,，/|;；:\r\n>、()（）–—]+|\s+-\s+/u)
    .map((segment) => segment.replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .some((segment) => GENERIC_OR_AMBIGUOUS_LOCATION_SEGMENTS.has(segment));
}

export function safeOfficialJsonEndpoint(value: string): string {
  const url = parseUrl(value, "Official JSON request URL is invalid");
  assertCredentialSafeUrl(url);
  if (url.protocol !== "https:") throw new Error("Official JSON request URL is invalid");
  return url.toString();
}

export function safeOfficialJsonEvidenceUrl(value: string): string {
  const url = parseUrl(value, "Official JSON evidence URL is invalid");
  if (url.protocol !== "https:") throw new Error("Official JSON evidence URL is invalid");
  if (url.username || url.password) throw new Error("Official JSON evidence URL is invalid");
  for (const [key, queryValue] of url.searchParams) {
    if (sensitiveOfficialJsonField({ key, queryValue })) {
      throw new Error("Official JSON evidence URL is invalid");
    }
  }
  if (sensitiveOfficialJsonField({ path: url.pathname, hash: url.hash })) {
    throw new Error("Official JSON evidence URL is invalid");
  }
  return evidenceUrl(url.toString());
}

function evidenceUrl(value: string): string {
  const url = parseUrl(value, "Official JSON evidence URL is invalid");
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.normalize("NFKC").toLowerCase();
    if (normalizedKey === "keyword" || normalizedKey === "keywords") {
      url.searchParams.delete(key);
    }
  }
  return sanitizeEvidenceHttpUrl(url.toString());
}

function assertCredentialSafeUrl(url: URL): void {
  if (url.username || url.password || url.hash) throw new Error("Official JSON URL contains credential material");
  for (const [key, value] of url.searchParams) {
    const normalizedKey = key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (/^(?:token|accesstoken|refreshtoken|auth|authorization|bearer|signature|sig|secret|apikey|credential|password|passwd|pwd|cookie|session|jwt|oauth|clientid|clientsecret)$/.test(normalizedKey)) {
      throw new Error("Official JSON URL contains credential material");
    }
    if (sensitiveOfficialJsonField({ value })) throw new Error("Official JSON URL contains credential material");
  }
  if (sensitiveOfficialJsonField({ path: `${url.pathname}${url.hash}` })) {
    throw new Error("Official JSON URL contains credential material");
  }
}

function hashValue(value: unknown): string {
  return sha256Bytes(Buffer.from(JSON.stringify(value), "utf8")).sha256;
}

function strictInstant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("Official JSON response captured time must be canonical UTC");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("Official JSON response captured time is invalid");
  }
  return date.getTime();
}

function parseUrl(value: string, reason: string): URL {
  try { return new URL(value); } catch { throw new Error(reason); }
}

function decodeAndNormalize(value: string): string {
  let result = value.normalize("NFKC");
  for (let round = 0; round < 2; round += 1) {
    try {
      const decoded = decodeURIComponent(result).normalize("NFKC");
      if (decoded === result) break;
      result = decoded;
    } catch { break; }
  }
  return result.normalize("NFKC");
}
