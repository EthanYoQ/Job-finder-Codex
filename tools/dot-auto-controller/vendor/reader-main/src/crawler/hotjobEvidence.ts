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

export interface HotjobEvidenceHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export interface HotjobEvidenceState {
  artifacts: SourceFetchArtifactDraft[];
  pages: SourceFetchPageTrace[];
  fetchLosses: PersistentSourceFetchEvidence["fetchLosses"];
  rawCount: number;
  parsedCount: number;
  validCount: number;
  parseDiscardCount: number;
  validationDiscardCount: number;
}

export function emptyHotjobEvidenceState(): HotjobEvidenceState {
  return {
    artifacts: [], pages: [], fetchLosses: [], rawCount: 0, parsedCount: 0,
    validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0
  };
}

export function assertHotjobEvidenceResponse(
  response: HotjobEvidenceHttpResponse,
  input: {
    requestedUrl: string;
    crawlStartedAtMs: number;
    previousCapturedAtMs: number;
    observedNowMs: number;
  }
): number {
  if (
    typeof response.finalUrl !== "string" || !response.finalUrl ||
    typeof response.contentType !== "string" || !response.contentType.trim() ||
    typeof response.capturedAt !== "string"
  ) {
    throw new Error("Hotjob response is missing required evidence metadata (final URL, content type, or captured time)");
  }
  const requested = parseHotjobUrl(sanitizeEvidenceHttpUrl(input.requestedUrl), "Hotjob response has an invalid final URL");
  const final = parseHotjobUrl(sanitizeEvidenceHttpUrl(response.finalUrl), "Hotjob response has an invalid final URL");
  if (sensitiveOutputField({ requestedPath: requested.pathname, finalPath: final.pathname })) {
    throw new Error("Hotjob response has an invalid final URL");
  }
  if (
    requested.protocol !== "https:" || final.protocol !== "https:" ||
    requested.origin !== final.origin || requested.pathname !== final.pathname ||
    requested.search !== final.search || final.hash
  ) {
    throw new Error("Hotjob response has an invalid final URL");
  }
  const responseTime = strictInstant(response.capturedAt);
  if (responseTime < input.crawlStartedAtMs) throw new Error("Hotjob response captured time precedes crawl start");
  if (responseTime > input.observedNowMs) throw new Error("Hotjob response captured time is unexpectedly in the future");
  if (responseTime < input.previousCapturedAtMs) throw new Error("Hotjob response captured time must be non-decreasing");
  return responseTime;
}

export function assertHotjobJsonContentType(response: HotjobEvidenceHttpResponse): void {
  const essence = response.contentType!.split(";", 1)[0]!.trim().toLowerCase();
  if (!(essence === "application/json" || /^application\/[a-z0-9.+-]+\+json$/.test(essence))) {
    throw new Error("Hotjob response has an invalid Content-Type");
  }
}

export function hotjobArtifact(input: {
  logicalKey: string;
  requestedUrl: string;
  response: HotjobEvidenceHttpResponse;
  extractorLocator: string;
}): SourceFetchArtifactDraft {
  return {
    id: input.logicalKey,
    logicalKey: input.logicalKey,
    kind: "PAGINATION_PAGE",
    requestedUrl: sanitizeEvidenceHttpUrl(input.requestedUrl),
    finalUrl: sanitizeEvidenceHttpUrl(input.response.finalUrl!),
    httpStatus: input.response.status,
    contentType: input.response.contentType!,
    capturedAt: input.response.capturedAt!,
    body: input.response.body,
    extractorLocator: input.extractorLocator
  };
}

export function finalizeHotjobEvidence(input: {
  state: HotjobEvidenceState;
  declaredCompleteness?: PersistentSourceFetchEvidence["declaredCompleteness"];
}): { evidence: PersistentSourceFetchEvidence; evaluation: PaginationEvaluation } {
  const raw = parsePersistentSourceFetchEvidence({
    captureTool: { name: "hotjob-http", version: "1" },
    artifacts: input.state.artifacts,
    pages: input.state.pages,
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
  const evidence = deriveCanonicalPaginationEvidence({ evidence: raw, expectedChannelIds: [], filteredOutput: true });
  const evaluation = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true });
  return { evidence, evaluation };
}

export function responseSha256(body: string): string {
  return sha256Bytes(Buffer.from(body, "utf8")).sha256;
}

export function irreversibleHotjobId(value: unknown): string {
  return `sha256:${sha256Bytes(Buffer.from(JSON.stringify(value), "utf8")).sha256}`;
}

export function persistentHotjobId(value: string): string {
  return `hotjob:sha256:${sha256Bytes(Buffer.from(value, "utf8")).sha256}`;
}

export function hotjobRawLocator(
  raw: unknown,
  artifactLogicalKey: string,
  pageSequence: number,
  recordIndex: number
): string {
  return `${artifactLogicalKey}#page:${pageSequence}#record:${recordIndex}#sha256:${
    sha256Bytes(Buffer.from(JSON.stringify(raw), "utf8")).sha256
  }`;
}

export function sensitiveOutputField(fields: Record<string, string>): string | undefined {
  for (const [field, value] of Object.entries(fields)) {
    const normalized = decodeAndNormalize(value);
    if (/\b(?:bearer|basic)(?:\s|%20|:|=)+[a-z0-9._~+\/-]{3,}/iu.test(normalized)) return field;
    if (/(?:^|[^a-z0-9])(?:api[._-]?key|client[._-]?secret|access[._-]?token|refresh[._-]?token|token|secret|password|passwd|pwd|credential|auth|authorization|cookie|session|jwt)\s*[:=]\s*\S+/iu.test(normalized)) return field;
  }
  return undefined;
}

export function safeHotjobOfficialId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(value) && !sensitiveOutputField({ id: value });
}

export function explicitlyOutsideChina(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  return /(?:美国|纽约|波士顿|新加坡|日本|东京|印度|德国|法国|加拿大|澳大利亚|英国|伦敦)|\b(?:united states|usa|u\.s\.|boston|new york|singapore|japan|tokyo|india|germany|france|canada|australia|united kingdom|london)\b/u.test(normalized) &&
    !/(?:中华人民共和国|中国大陆|中国|大陆|china|prc|people'?s republic of china|mainland china|上海|北京|广州|深圳|成都|杭州|南京|苏州|武汉|天津|重庆|西安|兰州)/iu.test(normalized);
}

export function safeEntryUrl(value: string): string {
  const url = parseHotjobUrl(value, "Hotjob entry URL is invalid");
  if (
    url.protocol !== "https:" || url.username || url.password ||
    sensitiveOutputField({ metadata: `${url.pathname}${url.search}${url.hash}` })
  ) {
    throw new Error("Hotjob entry URL is invalid");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function assertSafeHotjobRequestUrl(value: string): string {
  const url = parseHotjobUrl(value, "Hotjob request URL is invalid");
  if (
    url.protocol !== "https:" || url.username || url.password || url.hash ||
    sensitiveOutputField({ metadata: `${url.pathname}${url.search}` })
  ) {
    throw new Error("Hotjob request URL contains credential material");
  }
  return url.toString();
}

export function finalizeHotjobFailureEvidence(state: HotjobEvidenceState): PersistentSourceFetchEvidence {
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "hotjob-http", version: "1" },
    artifacts: state.artifacts,
    pages: state.pages,
    fetchCounts: {
      rawCount: state.rawCount,
      parsedCount: state.parsedCount,
      validCount: state.validCount,
      parseDiscardCount: state.parseDiscardCount,
      validationDiscardCount: state.validationDiscardCount
    },
    fetchLosses: state.fetchLosses
  });
}

export function abortHotjobEvidence(state: HotjobEvidenceState): PersistentSourceFetchEvidence | undefined {
  if (state.artifacts.length === 0 || state.pages.length === 0) return undefined;
  const pages = state.pages.map((page, index) => index === state.pages.length - 1
    ? { ...page, termination: "ABORTED" as const }
    : page);
  return finalizeHotjobFailureEvidence({ ...state, pages });
}

function strictInstant(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error("Hotjob response captured time must be a canonical UTC instant");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("Hotjob response captured time is invalid");
  }
  return date.getTime();
}

function parseHotjobUrl(value: string, safeFailureReason: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(safeFailureReason);
  }
}

function decodeAndNormalize(value: string): string {
  let result = value.normalize("NFKC");
  for (let round = 0; round < 2; round += 1) {
    try {
      const decoded = decodeURIComponent(result).normalize("NFKC");
      if (decoded === result) break;
      result = decoded;
    } catch {
      break;
    }
  }
  return result.normalize("NFKC");
}
