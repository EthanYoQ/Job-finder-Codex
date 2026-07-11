import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import {
  assertHotjobEvidenceResponse,
  assertHotjobJsonContentType,
  assertSafeHotjobRequestUrl,
  abortHotjobEvidence,
  emptyHotjobEvidenceState,
  explicitlyOutsideChina,
  finalizeHotjobEvidence,
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
  parsePersistentSourceFetchEvidence,
  type PersistentSourceFetchEvidence,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import type { PaginationEvaluation } from "./paginationEvidence";

export interface HotjobWecruitFetchConfig { suiteKey: string; pageSize?: number; maxPages?: number; }
export interface HotjobWecruitHttpRequest {
  url: string; method: "POST"; headers: Record<string, string>; body: string;
}
export interface HotjobWecruitHttpResponse {
  status: number; body: string; finalUrl?: string; contentType?: string; capturedAt?: string;
}
export type HotjobWecruitHttpClient = (request: HotjobWecruitHttpRequest) => Promise<HotjobWecruitHttpResponse>;
export interface HotjobWecruitSourceFetchDeps { http?: HotjobWecruitHttpClient; now?: () => Date; }

interface ParsedWecruitPage { totalPages?: number; returnedPage?: number; pageData: unknown[]; }
type HotjobWecruitAttempt =
  | { kind: "RESPONSE"; attempt: number; response: HotjobWecruitHttpResponse }
  | { kind: "TRANSPORT_FAILURE"; attempt: number };

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_HTTP_ATTEMPTS = 2;

export function createHotjobWecruitSourceFetch(deps: HotjobWecruitSourceFetchDeps = {}): SourceFetchFunction {
  return async (plan) => {
    const now = deps.now ?? (() => new Date());
    const capturedAt = now().toISOString();
    const crawlStartedAtMs = Date.parse(capturedAt);
    let previousCapturedAtMs = crawlStartedAtMs;
    let latestEvidence: PersistentSourceFetchEvidence | undefined;
    let latestEvaluation: PaginationEvaluation | undefined;
    const state = emptyHotjobEvidenceState();

    if (plan.source.atsKind !== "HOTJOB_WECRUIT") {
      return failed(capturedAt, "Hotjob Wecruit source fetch only supports HOTJOB_WECRUIT sources");
    }
    if (plan.adapterId !== "official-json" || !plan.hotjob) {
      return failed(capturedAt, `Hotjob Wecruit source ${plan.source.id} is missing Hotjob config`);
    }

    try {
      const http = deps.http ?? defaultHotjobWecruitHttpClient(now);
      const jobs: Array<{ sourceJobId: string; title: string; officialUrl: string; locationRaw: string }> = [];
      const seenOfficialIds = new Set<string>();
      const pageSize = normalizePageSize(plan.hotjob.pageSize);
      const maxPages = Math.max(1, plan.hotjob.maxPages ?? DEFAULT_MAX_PAGES);
      const evidenceEntryUrl = safeEntryUrl(plan.source.officialEntryUrl);
      const entry = new URL(evidenceEntryUrl);
      if (!safeHotjobOfficialId(plan.hotjob.suiteKey)) throw new Error("Hotjob Wecruit suite key is invalid");
      const apiUrl = assertSafeHotjobRequestUrl(
        `${entry.origin}/wecruit/positionInfo/listPosition/${encodeURIComponent(plan.hotjob.suiteKey)}` +
        "?iSaJAx=isAjax&request_locale=zh-CN"
      );
      let officialTotalPages: number | undefined;

      for (let page = 1; page <= maxPages; page += 1) {
        const pageIndex = page - 1;
        const request: HotjobWecruitHttpRequest = {
          url: apiUrl, method: "POST",
          headers: wecruitHeaders(entry.origin, evidenceEntryUrl),
          body: new URLSearchParams({ isFrompb: "true", recruitType: "2", pageSize: String(pageSize), currentPage: String(page) }).toString()
        };
        const attempts = await fetchHotjobPageWithRetry(http, request);
        let successfulResponse: HotjobWecruitHttpResponse | undefined;
        let successfulAttempt = 0;
        for (const attemptResult of attempts) {
          if (attemptResult.kind === "TRANSPORT_FAILURE") continue;
          const response = attemptResult.response;
          previousCapturedAtMs = assertHotjobEvidenceResponse(response, {
            requestedUrl: apiUrl, crawlStartedAtMs, previousCapturedAtMs, observedNowMs: now().getTime()
          });
          const attempt = attemptResult.attempt;
          const logicalKey = wecruitKey(pageIndex, attempt);
          state.artifacts.push(hotjobArtifact({
            logicalKey, requestedUrl: apiUrl, response,
            extractorLocator: response.status >= 200 && response.status < 300
              ? wecruitLocator(logicalKey, page, pageSize, attempt, false)
              : `hotjob-wecruit-v1|raw:${logicalKey}|request:page=${page},pageSize=${pageSize},attempt=${attempt}|json:unavailable`
          }));
          if (response.status >= 200 && response.status < 300) {
            try {
              assertHotjobJsonContentType(response);
            } catch (error) {
              return failedWecruitPage({
                capturedAt, state, response, logicalKey, pageIndex, requestedPage: page, requestedPageSize: pageSize,
                failureReason: error instanceof Error ? error.message : "Hotjob response has an invalid Content-Type",
                code: "INVALID_CONTENT_TYPE"
              });
            }
            successfulResponse = response;
            successfulAttempt = attempt;
            break;
          }
        }
        if (!successfulResponse) {
          const lastAttempt = attempts.at(-1)!;
          if (lastAttempt.kind === "TRANSPORT_FAILURE") {
            const failureReason = `Hotjob Wecruit TRANSPORT_FAILURE at ATTEMPT_${lastAttempt.attempt}`;
            const priorResponse = [...attempts].reverse().find(
              (candidate): candidate is Extract<HotjobWecruitAttempt, { kind: "RESPONSE" }> => candidate.kind === "RESPONSE"
            );
            if (!priorResponse) {
              return failed(capturedAt, failureReason, abortHotjobEvidence(state));
            }
            return failedWecruitPage({
              capturedAt, state, response: priorResponse.response,
              logicalKey: wecruitKey(pageIndex, priorResponse.attempt), pageIndex, requestedPage: page, requestedPageSize: pageSize,
              failureReason, code: "TRANSPORT_FAILURE", noteCode: `ATTEMPT_${lastAttempt.attempt}`
            });
          }
          const response = lastAttempt.response;
          return failedWecruitPage({
            capturedAt, state, response, logicalKey: wecruitKey(pageIndex, lastAttempt.attempt), pageIndex,
            requestedPage: page, requestedPageSize: pageSize, failureReason: `Hotjob Wecruit jobs API returned HTTP ${response.status}`,
            code: "HTTP_RESPONSE_FAILURE"
          });
        }

        const logicalKey = wecruitKey(pageIndex, successfulAttempt);
        let parsed: ParsedWecruitPage;
        try { parsed = parseHotjobWecruitResponse(successfulResponse.body); }
        catch (error) {
          return failedWecruitPage({
            capturedAt, state, response: successfulResponse, logicalKey, pageIndex, requestedPage: page, requestedPageSize: pageSize,
            failureReason: error instanceof Error ? error.message : String(error), code: "INVALID_RECORD_COLLECTION"
          });
        }
        const successfulArtifactIndex = state.artifacts.findIndex((artifact) => artifact.logicalKey === logicalKey);
        state.artifacts[successfulArtifactIndex] = {
          ...state.artifacts[successfulArtifactIndex]!,
          extractorLocator: wecruitLocator(logicalKey, page, pageSize, successfulAttempt, parsed.totalPages !== undefined)
        };

        const pageRawIds: string[] = [];
        const pageValidIds: string[] = [];
        for (let recordIndex = 0; recordIndex < parsed.pageData.length; recordIndex += 1) {
          const raw = parsed.pageData[recordIndex];
          const rawLocator = hotjobRawLocator(raw, logicalKey, pageIndex, recordIndex);
          pageRawIds.push(irreversibleHotjobId([readOfficialId(raw), recordIndex, raw]));
          state.rawCount += 1;
          if (!isRecord(raw) || Array.isArray(raw)) {
            addLoss(state, "PARSE", "Hotjob Wecruit record is not an object", rawLocator,
              { code: "NON_OBJECT_RECORD", pageSequence: pageIndex, recordIndex }, successfulResponse.capturedAt!);
            continue;
          }
          state.parsedCount += 1;
          const officialId = readOfficialId(raw);
          const title = readString(raw.postName);
          const locationRaw = readString(raw.workPlaceStr);
          if (!officialId || !title || !locationRaw) {
            const missing = !officialId ? "postId" : !title ? "title" : "locationRaw";
            addLoss(state, "VALIDATION", "Hotjob Wecruit record is missing a required field", rawLocator,
              { code: "MISSING_REQUIRED_FIELD", field: missing, pageSequence: pageIndex, recordIndex }, successfulResponse.capturedAt!);
            continue;
          }
          if (seenOfficialIds.has(officialId)) {
            addLoss(state, "VALIDATION", "Hotjob Wecruit record duplicates an official job ID", rawLocator,
              { code: "DUPLICATE_OFFICIAL_ID", field: "postId", pageSequence: pageIndex, recordIndex }, successfulResponse.capturedAt!);
            continue;
          }
          if (explicitlyOutsideChina(locationRaw)) {
            addLoss(state, "VALIDATION", "Hotjob Wecruit record is explicitly outside China scope", rawLocator,
              { code: "OUT_OF_SCOPE", pageSequence: pageIndex, recordIndex }, successfulResponse.capturedAt!);
            continue;
          }
          if (!safeHotjobOfficialId(officialId)) {
            addLoss(state, "VALIDATION", "Hotjob Wecruit record has an invalid official URL identifier", rawLocator,
              { code: "INVALID_OFFICIAL_URL", field: "postId", pageSequence: pageIndex, recordIndex }, successfulResponse.capturedAt!);
            continue;
          }
          const sensitive = sensitiveOutputField({ sourceJobId: officialId, title, locationRaw });
          if (sensitive) {
            addLoss(state, "VALIDATION", "Hotjob Wecruit record contains sensitive output material", rawLocator,
              { code: "SENSITIVE_OUTPUT", field: sensitive, pageSequence: pageIndex, recordIndex }, successfulResponse.capturedAt!);
            continue;
          }
          seenOfficialIds.add(officialId);
          state.validCount += 1;
          pageValidIds.push(irreversibleHotjobId(officialId));
          jobs.push({
            sourceJobId: persistentHotjobId(officialId), title,
            officialUrl: `${entry.origin}/${encodeURIComponent(plan.hotjob.suiteKey)}/pb/posDetail.html?postId=${encodeURIComponent(officialId)}&recruitType=2`,
            locationRaw
          });
        }

        officialTotalPages = officialTotalPages ?? parsed.totalPages;
        const totalChanged = officialTotalPages !== undefined && parsed.totalPages !== undefined && officialTotalPages !== parsed.totalPages;
        const hasNext = totalChanged || (parsed.totalPages !== undefined ? page < parsed.totalPages : false);
        const isMax = page === maxPages;
        const termination: SourceFetchPageTrace["termination"] = hasNext
          ? (isMax ? "MAX_PAGE_LIMIT" : "CONTINUE")
          : parsed.totalPages === 0 && parsed.pageData.length === 0 ? "EMPTY_PAGE" : "NEXT_ABSENT";
        state.pages.push({
          sequence: pageIndex, artifactLogicalKey: logicalKey,
          requestedPage: page, returnedPage: parsed.returnedPage ?? null,
          requestedPageSize: pageSize, returnedPageSize: null,
          requestedOffset: null, returnedOffset: null,
          rawJobIds: pageRawIds, validJobIds: pageValidIds,
          declaredTotal: null, declaredCount: null, declaredPages: parsed.totalPages ?? null,
          nextPageSignalBefore: page === 1 ? null : String(page),
          nextPageSignalAfter: hasNext ? String(page + 1) : null,
          responseFingerprintSha256: responseSha256(successfulResponse.body),
          termination, anomalyCodes: [], capturedAt: successfulResponse.capturedAt!
        });
        if (!hasNext || isMax) break;
      }

      const declared = declaredWecruitCompleteness(state, officialTotalPages);
      const finalized = finalizeHotjobEvidence({ state, ...(declared ? { declaredCompleteness: declared } : {}) });
      latestEvidence = finalized.evidence;
      latestEvaluation = finalized.evaluation;
      if (!finalized.evaluation.safeCompleteness) {
        return failed(capturedAt, `Hotjob Wecruit pagination evidence failed: ${finalized.evaluation.derivedAnomalyCodes.join(",")}`,
          finalized.evidence, finalized.evaluation);
      }
      return {
        ok: true, capturedAt, payload: { jobs },
        completeness: officialTotalPages === undefined
          ? {
              completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
              completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
              completenessEvidenceUrl: evidenceEntryUrl,
              completenessBlockerReason: "Hotjob Wecruit response did not include an official total page count",
              pageSize, pagesVisited: state.pages.length
            }
          : {
              completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
              completenessEvidenceKind: "OFFICIAL_TOTAL_PAGES",
              completenessEvidenceUrl: evidenceEntryUrl,
              completenessBlockerReason: "Official Hotjob page count is archived; downstream adapter accounting must prove final output",
              totalPages: officialTotalPages, pageSize, pagesVisited: state.pages.length
            },
        fetchEvidence: finalized.evidence, paginationEvaluation: finalized.evaluation
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

async function fetchHotjobPageWithRetry(http: HotjobWecruitHttpClient, request: HotjobWecruitHttpRequest): Promise<HotjobWecruitAttempt[]> {
  const attempts: HotjobWecruitAttempt[] = [];
  for (let attempt = 1; attempt <= DEFAULT_HTTP_ATTEMPTS; attempt += 1) {
    try {
      const response = await http(request);
      attempts.push({ kind: "RESPONSE", attempt, response });
      if (response.status >= 200 && response.status < 300) return attempts;
    } catch {
      attempts.push({ kind: "TRANSPORT_FAILURE", attempt });
    }
  }
  return attempts;
}

function parseHotjobWecruitResponse(body: string): ParsedWecruitPage {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { throw new Error("Hotjob Wecruit response is not valid JSON"); }
  if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.data.pageForm)) {
    throw new Error("Hotjob Wecruit response is missing the required page form");
  }
  const pageForm = parsed.data.pageForm;
  if (!Array.isArray(pageForm.pageData)) throw new Error("Hotjob Wecruit response is missing the required pageData array");
  const totalPages = nonnegativeInt(pageForm.totalPage);
  const returnedPage = nonnegativeInt(pageForm.currentPage ?? pageForm.page);
  return { ...(totalPages === undefined ? {} : { totalPages }),
    ...(returnedPage === undefined ? {} : { returnedPage }), pageData: pageForm.pageData };
}

function declaredWecruitCompleteness(
  state: HotjobEvidenceState,
  totalPages: number | undefined
): PersistentSourceFetchEvidence["declaredCompleteness"] | undefined {
  const declaredPage = totalPages === undefined ? undefined : state.pages.find((page) => page.declaredPages === totalPages);
  if (!declaredPage) return undefined;
  const artifact = state.artifacts.find((candidate) => candidate.logicalKey === declaredPage.artifactLogicalKey)!;
  return { kind: "OFFICIAL_TOTAL_PAGES", value: totalPages!, artifactLogicalKey: artifact.logicalKey,
    extractorLocator: artifact.extractorLocator, scope: "SOURCE" };
}

function failedWecruitPage(input: {
  capturedAt: string; state: HotjobEvidenceState; response: HotjobWecruitHttpResponse; logicalKey: string;
  pageIndex: number; requestedPage: number; requestedPageSize: number; failureReason: string; code: string; noteCode?: string;
}): SourceFetchResult {
  input.state.rawCount += 1;
  input.state.parseDiscardCount += 1;
  const hash = responseSha256(input.response.body);
  input.state.fetchLosses.push({ stage: "PARSE", reason: input.failureReason,
    rawLocator: `${input.logicalKey}#response#sha256:${hash}`,
    details: {
      code: input.code,
      pageSequence: input.pageIndex,
      ...(input.noteCode ? { noteCode: input.noteCode } : {})
    },
    recordedAt: input.response.capturedAt!
  });
  input.state.pages.push({
    sequence: input.pageIndex, artifactLogicalKey: input.logicalKey,
    requestedPage: input.requestedPage, returnedPage: null,
    requestedPageSize: input.requestedPageSize, returnedPageSize: null,
    requestedOffset: null, returnedOffset: null,
    rawJobIds: [irreversibleHotjobId(input.response.body)], validJobIds: [],
    declaredTotal: null, declaredCount: null, declaredPages: null,
    nextPageSignalBefore: input.pageIndex === 0 ? null : String(input.requestedPage), nextPageSignalAfter: null,
    responseFingerprintSha256: hash, termination: "FAILED", anomalyCodes: [], capturedAt: input.response.capturedAt!
  });
  const evidence = parsePersistentSourceFetchEvidence({
    captureTool: { name: "hotjob-http", version: "1" }, artifacts: input.state.artifacts, pages: input.state.pages,
    fetchCounts: { rawCount: input.state.rawCount, parsedCount: input.state.parsedCount, validCount: input.state.validCount,
      parseDiscardCount: input.state.parseDiscardCount, validationDiscardCount: input.state.validationDiscardCount },
    fetchLosses: input.state.fetchLosses
  });
  return failed(input.capturedAt, input.failureReason, evidence);
}

function addLoss(state: HotjobEvidenceState, stage: "PARSE" | "VALIDATION", reason: string, rawLocator: string,
  details: PersistentSourceFetchEvidence["fetchLosses"][number]["details"], recordedAt: string): void {
  if (stage === "PARSE") state.parseDiscardCount += 1; else state.validationDiscardCount += 1;
  state.fetchLosses.push({ stage, reason, rawLocator, details, recordedAt });
}

function wecruitKey(pageIndex: number, attempt: number): string {
  return `hotjob-wecruit-page-${String(pageIndex).padStart(4, "0")}-attempt-${String(attempt).padStart(2, "0")}`;
}
function wecruitLocator(key: string, page: number, pageSize: number, attempt: number, hasTotal: boolean): string {
  return `hotjob-wecruit-v1|raw:${key}|request:page=${page},pageSize=${pageSize},attempt=${attempt}|json:` +
    (hasTotal ? "totalPage=$.data.pageForm.totalPage;records=$.data.pageForm.pageData" : "records=$.data.pageForm.pageData");
}
function wecruitHeaders(origin: string, entryUrl: string): Record<string, string> {
  return { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json",
    Origin: origin, Referer: entryUrl, "X-Requested-With": "XMLHttpRequest", "User-Agent": "job-search-crawler/0.1" };
}
function defaultHotjobWecruitHttpClient(now: () => Date): HotjobWecruitHttpClient {
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
function readString(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function readOfficialId(value: unknown): string | undefined { return isRecord(value) ? readString(value.postId) : undefined; }
function nonnegativeInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
