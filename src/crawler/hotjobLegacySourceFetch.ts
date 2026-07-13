import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import {
  assertHotjobEvidenceResponse,
  assertHotjobJsonContentType,
  assertSafeHotjobRequestUrl,
  abortHotjobEvidence,
  emptyHotjobEvidenceState,
  explicitlyOutsideChina,
  finalizeHotjobEvidence,
  finalizeHotjobFailureEvidence,
  hotjobArtifact,
  hotjobRawLocator,
  irreversibleHotjobId,
  persistentHotjobId,
  responseSha256,
  safeEntryUrl,
  safeHotjobOfficialId,
  sensitiveOutputField,
  type HotjobEvidenceState
} from "./hotjobEvidence";
import {
  type PersistentSourceFetchEvidence,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import type { PaginationEvaluation } from "./paginationEvidence";

export interface HotjobLegacyFetchConfig {
  listUrl: string;
  suitePath: string;
  paginationMode?: "body-current-page" | "query-page";
  pageSize?: number;
  maxPages?: number;
}

export interface HotjobLegacyHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface HotjobLegacyHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type HotjobLegacyHttpClient = (request: HotjobLegacyHttpRequest) => Promise<HotjobLegacyHttpResponse>;

export interface HotjobLegacySourceFetchDeps {
  http?: HotjobLegacyHttpClient;
  now?: () => Date;
}

interface ParsedLegacyPage {
  rowCount?: number;
  totalPages?: number;
  returnedPage?: number;
  details: unknown[];
  detailsPath: "$.data.details" | "$.postList";
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 20;

export function createHotjobLegacySourceFetch(deps: HotjobLegacySourceFetchDeps = {}): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();
    const crawlStartedAtMs = Date.parse(capturedAt);
    let previousCapturedAtMs = crawlStartedAtMs;
    let latestEvidence: PersistentSourceFetchEvidence | undefined;
    let latestEvaluation: PaginationEvaluation | undefined;
    const state = emptyHotjobEvidenceState();

    if (plan.adapterId !== "official-json" || !plan.hotjobLegacy) {
      return failed(capturedAt, `Hotjob legacy source ${plan.source.id} is missing config`);
    }

    try {
      const http = deps.http ?? defaultHttpClient(now);
      const evidenceEntryUrl = safeEntryUrl(plan.source.officialEntryUrl);
      const safeListUrl = assertSafeHotjobRequestUrl(withoutEmptyHotjobQueryValues(plan.hotjobLegacy.listUrl));
      const jobs: Array<{ sourceJobId: string; title: string; officialUrl: string; locationRaw: string }> = [];
      const seenOfficialIds = new Set<string>();
      const pageSize = normalizePageSize(plan.hotjobLegacy.pageSize);
      const maxPages = Math.max(1, plan.hotjobLegacy.maxPages ?? DEFAULT_MAX_PAGES);
      let officialRowCount: number | undefined;
      let officialTotalPages: number | undefined;

      for (let page = 1; page <= maxPages; page += 1) {
        const pageIndex = page - 1;
        const requestedUrl = buildListUrl(safeListUrl, plan.hotjobLegacy.paginationMode, page);
        let response: HotjobLegacyHttpResponse;
        try {
          response = await http({
            url: requestedUrl,
            method: "POST",
            headers: legacyHeaders(evidenceEntryUrl),
            body: new URLSearchParams({ pageSize: String(pageSize), currentPage: String(page) }).toString()
          });
        } catch {
          return failed(
            capturedAt,
            `Hotjob legacy TRANSPORT_FAILURE at PAGE_${page} ATTEMPT_1`,
            abortHotjobEvidence(state)
          );
        }
        previousCapturedAtMs = assertHotjobEvidenceResponse(response, {
          requestedUrl,
          crawlStartedAtMs,
          previousCapturedAtMs,
          observedNowMs: now().getTime()
        });
        const logicalKey = `hotjob-legacy-page-${String(pageIndex).padStart(4, "0")}`;
        if (response.status < 200 || response.status >= 300) {
          state.artifacts.push(hotjobArtifact({
            logicalKey, requestedUrl, response,
            extractorLocator: `hotjob-legacy-v1|raw:${logicalKey}|request:page=${page},pageSize=${pageSize}|json:unavailable`
          }));
          return failedWithExistingArtifact({
            capturedAt, state, response, logicalKey, pageIndex, requestedPage: page, requestedPageSize: pageSize,
            failureReason: `Hotjob legacy source returned HTTP ${response.status}`, code: "HTTP_RESPONSE_FAILURE"
          });
        }
        try {
          assertHotjobJsonContentType(response);
        } catch (error) {
          state.artifacts.push(hotjobArtifact({
            logicalKey, requestedUrl, response,
            extractorLocator: `hotjob-legacy-v1|raw:${logicalKey}|request:page=${page},pageSize=${pageSize}|json:unavailable`
          }));
          return failedWithExistingArtifact({
            capturedAt, state, response, logicalKey, pageIndex, requestedPage: page, requestedPageSize: pageSize,
            failureReason: error instanceof Error ? error.message : "Hotjob response has an invalid Content-Type",
            code: "INVALID_CONTENT_TYPE"
          });
        }
        let parsed: ParsedLegacyPage;
        try {
          parsed = parseResponse(response.body);
        } catch (error) {
          return failedWithRawPage({
            capturedAt, state, response, requestedUrl, logicalKey, pageIndex, requestedPage: page, requestedPageSize: pageSize,
            failureReason: error instanceof Error ? error.message : String(error), code: "INVALID_RECORD_COLLECTION"
          });
        }
        const locator = legacyLocator(logicalKey, page, pageSize, parsed);
        state.artifacts.push(hotjobArtifact({ logicalKey, requestedUrl, response, extractorLocator: locator }));

        const pageRawIds: string[] = [];
        const pageValidIds: string[] = [];
        for (let recordIndex = 0; recordIndex < parsed.details.length; recordIndex += 1) {
          const raw = parsed.details[recordIndex];
          const rawLocator = hotjobRawLocator(raw, logicalKey, pageIndex, recordIndex);
          pageRawIds.push(irreversibleHotjobId([readOfficialId(raw), recordIndex, raw]));
          state.rawCount += 1;
          if (!isRecord(raw) || Array.isArray(raw)) {
            addLoss(state, "PARSE", "Hotjob legacy record is not an object", rawLocator,
              { code: "NON_OBJECT_RECORD", pageSequence: pageIndex, recordIndex }, response.capturedAt!);
            continue;
          }
          state.parsedCount += 1;
          const officialId = readOfficialId(raw);
          const title = readString(raw.PostName) ?? readString(raw.postName);
          const locationRaw = readString(raw.WorkPlace) ?? readString(raw.workPlace);
          if (!officialId || !title || !locationRaw) {
            const missingField = !officialId ? "postId" : !title ? "title" : "locationRaw";
            addLoss(state, "VALIDATION", "Hotjob legacy record is missing a required field", rawLocator,
              { code: "MISSING_REQUIRED_FIELD", field: missingField, pageSequence: pageIndex, recordIndex }, response.capturedAt!);
            continue;
          }
          if (seenOfficialIds.has(officialId)) {
            addLoss(state, "VALIDATION", "Hotjob legacy record duplicates an official job ID", rawLocator,
              { code: "DUPLICATE_OFFICIAL_ID", field: "postId", pageSequence: pageIndex, recordIndex }, response.capturedAt!);
            continue;
          }
          if (explicitlyOutsideChina(locationRaw)) {
            addLoss(state, "VALIDATION", "Hotjob legacy record is explicitly outside China scope", rawLocator,
              { code: "OUT_OF_SCOPE", pageSequence: pageIndex, recordIndex }, response.capturedAt!);
            continue;
          }
          if (!safeHotjobOfficialId(officialId)) {
            addLoss(state, "VALIDATION", "Hotjob legacy record has an invalid official URL identifier", rawLocator,
              { code: "INVALID_OFFICIAL_URL", field: "postId", pageSequence: pageIndex, recordIndex }, response.capturedAt!);
            continue;
          }
          const sensitive = sensitiveOutputField({ sourceJobId: officialId, title, locationRaw });
          if (sensitive) {
            addLoss(state, "VALIDATION", "Hotjob legacy record contains sensitive output material", rawLocator,
              { code: "SENSITIVE_OUTPUT", field: sensitive, pageSequence: pageIndex, recordIndex }, response.capturedAt!);
            continue;
          }
          seenOfficialIds.add(officialId);
          state.validCount += 1;
          pageValidIds.push(irreversibleHotjobId(officialId));
          jobs.push({
            sourceJobId: persistentHotjobId(officialId),
            title,
            officialUrl: `${evidenceEntryUrl}#/position/detail?postId=${encodeURIComponent(officialId)}`,
            locationRaw
          });
        }

        officialRowCount = officialRowCount ?? parsed.rowCount;
        officialTotalPages = officialTotalPages ?? parsed.totalPages;
        const totalChanged =
          (officialRowCount !== undefined && parsed.rowCount !== undefined && officialRowCount !== parsed.rowCount) ||
          (officialTotalPages !== undefined && parsed.totalPages !== undefined && officialTotalPages !== parsed.totalPages);
        const hasNext = totalChanged ||
          (parsed.totalPages !== undefined ? page < parsed.totalPages :
            parsed.rowCount !== undefined ? state.rawCount < parsed.rowCount : false);
        const isMax = page === maxPages;
        const allValid = new Set([...state.pages.flatMap((candidate) => candidate.validJobIds), ...pageValidIds]).size;
        const termination: SourceFetchPageTrace["termination"] = hasNext
          ? (isMax ? "MAX_PAGE_LIMIT" : "CONTINUE")
          : parsed.rowCount === 0 && parsed.details.length === 0 ? "EMPTY_PAGE"
            : parsed.rowCount !== undefined && parsed.rowCount === allValid ? "DECLARED_TOTAL_REACHED"
              : "NEXT_ABSENT";
        state.pages.push({
          sequence: pageIndex,
          artifactLogicalKey: logicalKey,
          requestedPage: page,
          returnedPage: parsed.returnedPage ?? null,
          requestedPageSize: pageSize,
          returnedPageSize: null,
          requestedOffset: null,
          returnedOffset: null,
          rawJobIds: pageRawIds,
          validJobIds: pageValidIds,
          declaredTotal: parsed.rowCount ?? null,
          declaredCount: null,
          declaredPages: parsed.totalPages ?? null,
          nextPageSignalBefore: page === 1 ? null : String(page),
          nextPageSignalAfter: hasNext ? String(page + 1) : null,
          responseFingerprintSha256: responseSha256(response.body),
          termination,
          anomalyCodes: [],
          capturedAt: response.capturedAt!
        });
        if (!hasNext || isMax) break;
      }

      const declared = declaredLegacyCompleteness(state, officialRowCount, officialTotalPages);
      const finalized = finalizeHotjobEvidence({ state, ...(declared ? { declaredCompleteness: declared } : {}) });
      latestEvidence = finalized.evidence;
      latestEvaluation = finalized.evaluation;
      if (!finalized.evaluation.safeCompleteness) {
        return failed(capturedAt, `Hotjob legacy pagination evidence failed: ${finalized.evaluation.derivedAnomalyCodes.join(",")}`,
          finalized.evidence, finalized.evaluation);
      }
      return {
        ok: true,
        capturedAt,
        payload: { jobs },
        completeness: officialRowCount !== undefined
          ? manualCompleteness(evidenceEntryUrl, "OFFICIAL_TOTAL_COUNT", state.pages.length, pageSize, officialRowCount, officialTotalPages)
          : officialTotalPages !== undefined
            ? manualCompleteness(evidenceEntryUrl, "OFFICIAL_TOTAL_PAGES", state.pages.length, pageSize, undefined, officialTotalPages)
            : {
                completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
                completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
                completenessEvidenceUrl: evidenceEntryUrl,
                completenessBlockerReason: "Hotjob legacy response did not declare an official total count or page count",
                pageSize,
                pagesVisited: state.pages.length
              },
        fetchEvidence: finalized.evidence,
        paginationEvaluation: finalized.evaluation
      };
    } catch (error) {
      return failed(
        capturedAt,
        error instanceof Error ? error.message : String(error),
        latestEvidence ?? abortHotjobEvidence(state),
        latestEvaluation
      );
    }
  };
}

function parseResponse(body: string): ParsedLegacyPage {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new Error("Hotjob legacy response is not valid JSON"); }
  if (!isRecord(parsed)) throw new Error("Hotjob legacy response is not an object");
  const data = isRecord(parsed.data) ? parsed.data : undefined;
  const details = Array.isArray(data?.details) ? data.details : Array.isArray(parsed.postList) ? parsed.postList : undefined;
  if (!details) throw new Error("Hotjob legacy response is missing the required job collection");
  const rowCount = nonnegativeInt(data?.rowCount);
  const totalPages = nonnegativeInt(parsed.pageCount);
  const returnedPage = nonnegativeInt(data?.currentPage ?? parsed.currentPage ?? parsed.page);
  return {
    ...(rowCount === undefined ? {} : { rowCount }),
    ...(totalPages === undefined ? {} : { totalPages }),
    ...(returnedPage === undefined ? {} : { returnedPage }),
    details,
    detailsPath: Array.isArray(data?.details) ? "$.data.details" : "$.postList"
  };
}

function declaredLegacyCompleteness(
  state: HotjobEvidenceState,
  rowCount: number | undefined,
  totalPages: number | undefined
): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  const declaredPage = rowCount !== undefined
    ? state.pages.find((page) => page.declaredTotal === rowCount)
    : totalPages !== undefined
      ? state.pages.find((page) => page.declaredPages === totalPages)
      : undefined;
  if (!declaredPage) return undefined;
  const artifact = state.artifacts.find((candidate) => candidate.logicalKey === declaredPage.artifactLogicalKey)!;
  if (rowCount !== undefined) return {
    kind: "OFFICIAL_TOTAL_COUNT", value: rowCount, artifactLogicalKey: artifact.logicalKey,
    extractorLocator: artifact.extractorLocator, scope: "SOURCE"
  };
  if (totalPages !== undefined) return {
    kind: "OFFICIAL_TOTAL_PAGES", value: totalPages, artifactLogicalKey: artifact.logicalKey,
    extractorLocator: artifact.extractorLocator, scope: "SOURCE"
  };
  return undefined;
}

function legacyLocator(key: string, page: number, pageSize: number, parsed: ParsedLegacyPage): string {
  const paths = [
    ...(parsed.rowCount === undefined ? [] : ["rowCount=$.data.rowCount"]),
    ...(parsed.totalPages === undefined ? [] : ["pageCount=$.pageCount"]),
    `records=${parsed.detailsPath}`
  ];
  return `hotjob-legacy-v1|raw:${key}|request:page=${page},pageSize=${pageSize}|json:${paths.join(";")}`;
}

function manualCompleteness(
  entryUrl: string,
  kind: "OFFICIAL_TOTAL_COUNT" | "OFFICIAL_TOTAL_PAGES",
  pagesVisited: number,
  pageSize: number,
  expectedJobCount?: number,
  totalPages?: number
) {
  return {
    completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" as const,
    ...(expectedJobCount === undefined ? {} : { expectedJobCount }),
    completenessEvidenceKind: kind,
    completenessEvidenceUrl: safeEntryUrl(entryUrl),
    completenessBlockerReason: "Official Hotjob declaration is archived; downstream adapter accounting must prove final output",
    ...(totalPages === undefined ? {} : { totalPages }),
    pageSize,
    pagesVisited
  };
}

function failedWithRawPage(input: {
  capturedAt: string; state: HotjobEvidenceState; response: HotjobLegacyHttpResponse; requestedUrl: string;
  logicalKey: string; pageIndex: number; requestedPage: number; requestedPageSize: number; failureReason: string; code: string;
}): SourceFetchResult {
  input.state.artifacts.push(hotjobArtifact({
    logicalKey: input.logicalKey, requestedUrl: input.requestedUrl, response: input.response,
    extractorLocator: `hotjob-legacy-v1|raw:${input.logicalKey}|request:page=${input.requestedPage}|json:unavailable`
  }));
  return failedWithExistingArtifact(input);
}

function failedWithExistingArtifact(input: {
  capturedAt: string; state: HotjobEvidenceState; response: HotjobLegacyHttpResponse;
  logicalKey: string; pageIndex: number; requestedPage: number; requestedPageSize: number; failureReason: string; code: string;
}): SourceFetchResult {
  input.state.rawCount += 1;
  input.state.parseDiscardCount += 1;
  const hash = responseSha256(input.response.body);
  input.state.fetchLosses.push({
    stage: "PARSE", reason: input.failureReason,
    rawLocator: `${input.logicalKey}#response#sha256:${hash}`,
    details: { code: input.code, pageSequence: input.pageIndex }, recordedAt: input.response.capturedAt!
  });
  input.state.pages.push({
    sequence: input.pageIndex, artifactLogicalKey: input.logicalKey,
    requestedPage: input.requestedPage, returnedPage: null,
    requestedPageSize: input.requestedPageSize, returnedPageSize: null,
    requestedOffset: null, returnedOffset: null,
    rawJobIds: [irreversibleHotjobId(input.response.body)], validJobIds: [],
    declaredTotal: null, declaredCount: null, declaredPages: null,
    nextPageSignalBefore: input.pageIndex === 0 ? null : String(input.requestedPage),
    nextPageSignalAfter: null, responseFingerprintSha256: hash,
    termination: "FAILED", anomalyCodes: [], capturedAt: input.response.capturedAt!
  });
  const evidence = finalizeFailedEvidence(input.state);
  return failed(input.capturedAt, input.failureReason, evidence);
}

function finalizeFailedEvidence(state: HotjobEvidenceState): PersistentSourceFetchEvidence {
  return finalizeHotjobFailureEvidence(state);
}

function addLoss(
  state: HotjobEvidenceState,
  stage: "PARSE" | "VALIDATION",
  reason: string,
  rawLocator: string,
  details: PersistentSourceFetchEvidence["fetchLosses"][number]["details"],
  recordedAt: string
): void {
  if (stage === "PARSE") state.parseDiscardCount += 1;
  else state.validationDiscardCount += 1;
  state.fetchLosses.push({ stage, reason, rawLocator, details, recordedAt });
}

function legacyHeaders(entryUrl: string): Record<string, string> {
  return { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json",
    Referer: entryUrl, "X-Requested-With": "XMLHttpRequest", "User-Agent": "job-search-crawler/0.1" };
}

function buildListUrl(listUrl: string, mode: HotjobLegacyFetchConfig["paginationMode"], page: number): string {
  if (mode !== "query-page") return listUrl;
  const url = new URL(listUrl); url.searchParams.set("page", String(page)); return url.toString();
}

function withoutEmptyHotjobQueryValues(listUrl: string): string {
  let url: URL;
  try {
    url = new URL(listUrl);
  } catch {
    throw new Error("Hotjob request URL is invalid");
  }
  const retained = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (value !== "") retained.append(key, value);
  }
  url.search = retained.toString();
  return url.toString();
}

function defaultHttpClient(now: () => Date): HotjobLegacyHttpClient {
  return async (request) => {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, redirect: "follow" });
    const contentType = response.headers.get("content-type");
    return { status: response.status, body: await response.text(), finalUrl: response.url,
      ...(contentType ? { contentType } : {}), capturedAt: now().toISOString() };
  };
}

function normalizePageSize(value: number | undefined): number {
  return !value || !Number.isFinite(value) ? DEFAULT_PAGE_SIZE : Math.min(50, Math.max(1, Math.floor(value)));
}

function failed(capturedAt: string, failureReason: string, fetchEvidence?: PersistentSourceFetchEvidence,
  paginationEvaluation?: PaginationEvaluation): SourceFetchResult {
  return { ok: false, capturedAt, failureReason, ...(fetchEvidence ? { fetchEvidence } : {}),
    ...(paginationEvaluation ? { paginationEvaluation } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function readString(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function readOfficialId(value: unknown): string | undefined {
  return isRecord(value) ? readString(value.PostId) ?? readString(value.postId) : undefined;
}
function nonnegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
