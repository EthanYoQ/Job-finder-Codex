import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { load } from "cheerio";
import { CITY_PENDING } from "../domain/jobLocation";
import type { OfficialJsonConfig } from "./adapters/types";
import { WORKDAY_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { JOB_QUARANTINE_PAGINATION, quarantineCompleteList, type JobQuarantine } from "./jobQuarantine";
import type { NormalizedJobRecord } from "./normalizedJob";
import { explicitlyForeignOrNonMainlandLocation, irreversibleOfficialJsonEvidenceId } from "./officialJsonEvidence";
import { currentOfficialSourceAttemptSignal, fetchWithOfficialTimeout, officialHttpTimeoutMs } from "./officialHttpRuntimeLimits";
import { parseOfficialRetryAfter, type OfficialRetryAfter } from "./officialRetryAfter";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { PFIZER_OFFICIAL_LOCALITIES } from "./pfizerOfficialLocalities";
import type { StrictProfileBoundSourcePolicy } from "./profileBoundSourceEvidence";
import type { SourceFetchFunction } from "./runSourceCrawl";
import {
  parsePersistentSourceFetchEvidence,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft
} from "./sourceFetchEvidence";
import { retryableHttpTransportFailure, retryableTransportFailureFromError, safeSourceTransportFailureReason, type SourceTransportFailureStage } from "./sourceFetchFailure";
import type { SourceCrawlPlan } from "./sourcePlan";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";

export const PFIZER_OFFICIAL_PORTAL_ENTRY = "https://www.pfizer.com/about/careers/search-results";
export const PFIZER_OFFICIAL_PORTAL_API = "https://www.pfizer.com/v1/api/workday/search";
export const PFIZER_OFFICIAL_PORTAL_CONFIG = Object.freeze({
  policy: "PFIZER_OFFICIAL_PORTAL_V1",
  pageSize: 50,
  maxPages: 20,
  region: "China",
  langcode: "en",
  sort: "latest"
} as const);
export type PfizerOfficialPortalConfig = typeof PFIZER_OFFICIAL_PORTAL_CONFIG;
export const PFIZER_PORTAL_JSON_CONFIG: OfficialJsonConfig = Object.freeze({
  ...WORKDAY_JSON_CONFIG,
  fields: Object.freeze({
    ...WORKDAY_JSON_CONFIG.fields,
    officialPublishedAt: "officialPublishedAt"
  })
});

const ORIGIN = "https://www.pfizer.com";
const CHAIN = "https://www.pfizer.com/about/careers";
const WD_SITE_PREFIX = "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers";
const TERMINAL_KEY = "pfizer-portal-terminal";
const REPORT = "pfizer-official-portal-binding-report";
const BODY_LIMIT = 4 * 1024 * 1024;
const LIMIT = 32 * 1024 * 1024;
const WINDOW = 30 * 60 * 1000;
const FAILURE = "PFIZER_OFFICIAL_PORTAL_INVALID";
const EXTERNAL_URL_RE = /^https:\/\/pfizer\.wd1\.myworkdayjobs\.com\/PfizerCareers(\/job\/[^?#]+)$/u;
const MAINLAND_LOC_RE = /^(?:China|CHN) - [A-Za-z0-9][A-Za-z0-9 '\-()&]+(?: - [A-Za-z0-9][A-Za-z0-9 '\-()&]+)*$/u;
const FOREIGN_HINT_RE = /Hong Kong|Macau|Macao|Taiwan|香港|澳门|台湾/iu;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type Request = { url: string; method: "POST"; headers: Record<string, string>; body: string };
type HttpResponse = { status: number; body: string; finalUrl?: string; contentType?: string; capturedAt?: string; retryAfter?: OfficialRetryAfter };
type HttpStatusMeta = Pick<HttpResponse, "status" | "retryAfter">;
type Http = (request: Request) => Promise<HttpResponse>;
type Role = "list" | "terminal";
type ParsedSearchPage = { page: number; declaredTotal: number; totalPages: number; rows: unknown[] };
type ProjectedJob = { sourceJobId: string; title: string; officialUrl: string; locationRaw: string; cities: string[]; officialPublishedAt: string };
type DetailBinding = { reqId: string; externalPath: string; officialUrl: string; officialPublishedAt: string };

class PortalHttpBodyError extends Error {
  constructor(message: string, readonly httpMeta: HttpStatusMeta) {
    super(message);
  }
}

const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const clean = (v: string) => v.replace(/\s+/gu, " ").trim();
const nonempty = (v: unknown): v is string => typeof v === "string" && clean(v).length > 0;
function assert(v: unknown): asserts v { if (!v) throw Error(FAILURE); }
const object = (v: unknown): Record<string, unknown> => { assert(v && typeof v === "object" && !Array.isArray(v)); return v as Record<string, unknown>; };
const parseJson = (body: string) => { assert(hasUniqueJsonObjectKeys(body)); return object(JSON.parse(body)); };
const pageKey = (page: number) => `pfizer-portal-list-${String(page).padStart(4, "0")}`;
const requestPayload = (page: number) => ({
  keywords: "",
  pager: PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize,
  sort: PFIZER_OFFICIAL_PORTAL_CONFIG.sort,
  page,
  langcode: PFIZER_OFFICIAL_PORTAL_CONFIG.langcode,
  region: [PFIZER_OFFICIAL_PORTAL_CONFIG.region]
});
const makeRequest = (page: number): Request => ({
  url: PFIZER_OFFICIAL_PORTAL_API,
  method: "POST",
  headers: {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: ORIGIN,
    Referer: PFIZER_OFFICIAL_PORTAL_ENTRY,
    "User-Agent": UA
  },
  body: JSON.stringify(requestPayload(page))
});
const paginationOptions = {
  expectedChannelIds: [] as string[],
  filteredOutput: true,
  allowCompleteTraversalOfEmptyFirstPage: true as const,
  ...JOB_QUARANTINE_PAGINATION
};

export function isSafePfizerOfficialPortalFailureCode(value: unknown): value is string {
  return value === FAILURE;
}

function normalizePublishedDate(value: unknown): string {
  assert(typeof value === "string");
  const trimmed = value.trim();
  assert(/^\d{4}-\d{2}-\d{2}$/u.test(trimmed));
  const iso = `${trimmed}T00:00:00.000Z`;
  assert(Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().startsWith(trimmed));
  return iso;
}

async function fetchPortalHttp(request: Request): Promise<HttpResponse> {
  const controller = new AbortController(), source = currentOfficialSourceAttemptSignal();
  const abort = () => controller.abort(source?.reason);
  const deadline = setTimeout(() => controller.abort(new Error("Pfizer official portal body deadline exceeded")), officialHttpTimeoutMs());
  if (source?.aborted) abort(); else source?.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel(controller.signal.reason).catch(() => undefined); };
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await fetchWithOfficialTimeout(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: "error"
    });
    const retryAfter = parseOfficialRetryAfter(response.headers.get("retry-after"), Date.now());
    const httpMeta: HttpStatusMeta = {
      status: response.status,
      ...(retryAfter && "delayMs" in retryAfter ? { retryAfter } : {})
    };
    try {
      const declared = response.headers.get("content-length");
      if (declared && (!/^[0-9]+$/u.test(declared) || Number(declared) > BODY_LIMIT)) {
        void response.body?.cancel().catch(() => undefined);
        throw new PortalHttpBodyError("Pfizer official portal response exceeds byte limit", httpMeta);
      }
      if (!response.body) throw new PortalHttpBodyError("Pfizer official portal response body is missing", httpMeta);
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        controller.signal.throwIfAborted();
        const chunk = await reader.read();
        controller.signal.throwIfAborted();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > BODY_LIMIT) {
          void reader.cancel().catch(() => undefined);
          throw new PortalHttpBodyError("Pfizer official portal response exceeds byte limit", httpMeta);
        }
        chunks.push(chunk.value);
      }
      return {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get("content-type") ?? "",
        body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
        capturedAt: new Date().toISOString(),
        ...(httpMeta.retryAfter ? { retryAfter: httpMeta.retryAfter } : {})
      };
    } catch (error) {
      if (error instanceof PortalHttpBodyError) throw error;
      if (httpMeta.status !== 200) {
        throw new PortalHttpBodyError(error instanceof Error ? error.message : "Failed to read HTTP response body", httpMeta);
      }
      throw error;
    }
  } finally {
    clearTimeout(deadline);
    source?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
}

function exactPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.company.id === "company-pfizer-china" && plan.source.id === "source-pfizer-china-social" &&
    plan.source.companyId === plan.company.id && plan.company.officialChineseName === "辉瑞中国" && plan.company.category === "FOREIGN_PHARMA" &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === PFIZER_OFFICIAL_PORTAL_ENTRY && plan.source.officialChainEvidenceUrl === CHAIN &&
    same(plan.profileBoundSource, { kind: "pfizer-official-portal", config: PFIZER_OFFICIAL_PORTAL_CONFIG }) && same(plan.json, PFIZER_PORTAL_JSON_CONFIG) &&
    !plan.workday && !plan.officialJsonFetch && !plan.moka && !plan.hotjob && !plan.hotjobLegacy;
}

function makeArtifact(role: Role, page: number, req: Request, response: HttpResponse, now: string): SourceFetchArtifactDraft {
  assert(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 && response.finalUrl === req.url &&
    typeof response.body === "string" && Buffer.byteLength(response.body) <= BODY_LIMIT &&
    typeof response.contentType === "string" && response.contentType.length > 0 &&
    (response.status !== 200 || /^application\/json(?:;|$)/iu.test(response.contentType)));
  const capturedAt = response.capturedAt ?? now;
  assert(Number.isFinite(Date.parse(capturedAt)));
  const logicalKey = role === "list" ? pageKey(page) : TERMINAL_KEY;
  return {
    id: logicalKey,
    logicalKey,
    kind: role === "list" ? "PAGINATION_PAGE" : "ATS_API_RESPONSE",
    requestedUrl: req.url,
    finalUrl: req.url,
    httpStatus: response.status,
    contentType: response.contentType,
    capturedAt,
    body: response.body,
    bodyRepresentation: "EXACT",
    extractorLocator: requestContractV2Locator("data.data+data.dependant_filters.region.China", {
      family: "pfizer-official-portal",
      role: `pfizer-official-portal-${role}`,
      method: req.method,
      url: req.url,
      body: JSON.parse(req.body),
      coordinate: { page }
    })
  };
}

function isEmptyPortalData(data: Record<string, unknown>): boolean {
  return data.count === 0 && data.total_count === 0 &&
    (data.data === "No jobs found" || (Array.isArray(data.data) && data.data.length === 0));
}

function parseSearchPage(body: string, page: number): ParsedSearchPage {
  const root = parseJson(body);
  assert(root.status === 200);
  const data = object(root.data);
  if (isEmptyPortalData(data)) {
    assert(page === 1);
    const df = data.dependant_filters;
    if (Array.isArray(df)) assert(df.length === 0);
    else {
      const region = object(object(df).region);
      assert(region.China === undefined || region.China === "China (0)");
    }
    return { page: 1, declaredTotal: 0, totalPages: 0, rows: [] };
  }
  const region = object(object(data.dependant_filters).region);
  assert(typeof region.China === "string");
  const totalMatch = /^China\s*\((\d+)\)$/u.exec(region.China.trim());
  assert(totalMatch);
  const declaredTotal = Number(totalMatch[1]);
  assert(Number.isSafeInteger(declaredTotal) && declaredTotal >= 1);
  const totalPages = Math.ceil(declaredTotal / PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize);
  assert(totalPages >= 1 && totalPages <= PFIZER_OFFICIAL_PORTAL_CONFIG.maxPages && page <= totalPages);
  assert(data.total_count === totalPages && Array.isArray(data.data));
  const expectedCount = page < totalPages
    ? PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize
    : declaredTotal - (totalPages - 1) * PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize;
  assert(data.count === expectedCount && data.data.length === expectedCount);
  return { page, declaredTotal, totalPages, rows: data.data };
}

function parseTerminalPage(body: string): void {
  const root = parseJson(body);
  assert(root.status === 200);
  const data = object(root.data);
  assert(isEmptyPortalData(data));
}

function parseExternalPath(url: unknown, reqId?: string): string | undefined {
  if (typeof url !== "string" || url.trim() !== url) return undefined;
  try {
    const parsed = new URL(url);
    const match = EXTERNAL_URL_RE.exec(parsed.href);
    if (parsed.origin !== "https://pfizer.wd1.myworkdayjobs.com" || parsed.username || parsed.password ||
        parsed.search || parsed.hash || parsed.href !== url || !match) {
      return undefined;
    }
    const externalPath = match[1]!;
    if (reqId && !new RegExp(`_${reqId}(?:-\\d+)?$`, "u").test(externalPath)) return undefined;
    return externalPath;
  } catch {
    return undefined;
  }
}

function extractRowIdentity(raw: unknown): { reqId?: string; externalPath?: string; sourceJobId?: string; officialUrl?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const reqId = typeof row.jobRequisitionId === "string" && /^\d{7}$/u.test(row.jobRequisitionId) ? row.jobRequisitionId : undefined;
  const externalPath = parseExternalPath(row.External_Posting_URL, reqId);
  if (!externalPath) return reqId ? { reqId } : {};
  return {
    ...(reqId ? { reqId } : {}),
    externalPath,
    sourceJobId: `workday:sha256:${hash(externalPath)}`,
    officialUrl: `${WD_SITE_PREFIX}${externalPath}`
  };
}

function projectRow(raw: unknown): { job: ProjectedJob; binding: DetailBinding } {
  const row = object(raw);
  const reqId = row.jobRequisitionId;
  assert(typeof reqId === "string" && /^\d{7}$/u.test(reqId));
  assert(nonempty(row.title) && row.External_Posting === "1");
  assert(row.detailPageUrl === `/about/careers/job/${reqId}?langcode=${PFIZER_OFFICIAL_PORTAL_CONFIG.langcode}`);
  assert(row.Country === "China" && row.locationCountry === "China");

  const externalPath = parseExternalPath(row.External_Posting_URL, reqId);
  assert(externalPath);
  const officialUrl = `${WD_SITE_PREFIX}${externalPath}`;
  const officialPublishedAt = normalizePublishedDate(row.startDate);

  assert(typeof row.jobDescription === "string" && load(row.jobDescription).text().trim().length > 20);
  assert(nonempty(row.primaryLocation) && nonempty(row.locations));
  const primary = clean(row.primaryLocation);
  const splitLocs = row.locations.split(";").map(clean).filter(Boolean);
  assert(splitLocs.includes(primary));
  const orderedLocs = [...new Set([primary, ...splitLocs])];
  const mainland = orderedLocs.filter(v =>
    (Object.hasOwn(PFIZER_OFFICIAL_LOCALITIES, v) || MAINLAND_LOC_RE.test(v)) &&
    !FOREIGN_HINT_RE.test(v) && !explicitlyForeignOrNonMainlandLocation(v)
  );
  assert(mainland.length > 0 && mainland.length === orderedLocs.length);
  const mapped = mainland.map(v => PFIZER_OFFICIAL_LOCALITIES[v] ?? CITY_PENDING);
  const cities = mapped.includes(CITY_PENDING) ? [CITY_PENDING] : [...new Set(mapped)];

  return {
    job: {
      sourceJobId: `workday:sha256:${hash(externalPath)}`,
      title: clean(row.title),
      officialUrl,
      locationRaw: mainland.join(" | "),
      cities,
      officialPublishedAt
    },
    binding: { reqId, externalPath, officialUrl, officialPublishedAt }
  };
}

function reportArtifact(total: number, bindings: DetailBinding[], capturedAt: string): SourceFetchArtifactDraft {
  return {
    id: REPORT,
    logicalKey: REPORT,
    kind: "ORACLE_RESULT",
    capturedAt,
    bodyRepresentation: "EXACT",
    extractorLocator: "pfizer-official-portal-v1:replayed-official-list",
    body: JSON.stringify({ policy: PFIZER_OFFICIAL_PORTAL_CONFIG.policy, total, bindings })
  };
}

function pageTrace(page: ParsedSearchPage, artifact: SourceFetchArtifactDraft, jobs: readonly { sourceJobId: string }[], rawIds: readonly string[]) {
  const hasNext = page.declaredTotal > 0 && page.page < page.totalPages;
  return {
    artifactLogicalKey: artifact.logicalKey,
    sequence: page.page - 1,
    requestedPage: page.page,
    returnedPage: page.page,
    requestedPageSize: PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize,
    returnedPageSize: PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize,
    rawJobIds: [...rawIds],
    validJobIds: jobs.map(j => irreversibleOfficialJsonEvidenceId(j.sourceJobId)),
    declaredTotal: page.declaredTotal,
    declaredCount: null,
    declaredPages: page.totalPages,
    nextPageSignalBefore: page.page === 1 ? null : `page=${page.page}`,
    nextPageSignalAfter: hasNext ? `page=${page.page + 1}` : null,
    responseFingerprintSha256: hash(artifact.body as string),
    termination: (page.declaredTotal === 0 ? "EMPTY_PAGE" : hasNext ? "CONTINUE" : "NEXT_ABSENT") as "EMPTY_PAGE" | "CONTINUE" | "NEXT_ABSENT",
    anomalyCodes: [],
    capturedAt: artifact.capturedAt
  };
}

function assemble(
  artifacts: SourceFetchArtifactDraft[],
  pages: ParsedSearchPage[],
  jobs: readonly { sourceJobId: string }[],
  rawIdsByPage: readonly string[][],
  quarantines: JobQuarantine[] = []
): PersistentSourceFetchEvidence {
  let offset = 0;
  const traces = pages.map((page, index) => {
    const selected = jobs.slice(offset, offset + page.rows.length);
    offset += page.rows.length;
    return pageTrace(page, artifacts.find(a => a.logicalKey === pageKey(page.page))!, selected, rawIdsByPage[index]!);
  });
  const first = artifacts[0]!;
  const evidence = parsePersistentSourceFetchEvidence({
    captureTool: { name: "pfizer-official-portal-http", version: "1" },
    artifacts,
    pages: traces,
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT",
      scope: "SOURCE",
      value: pages[0]!.declaredTotal,
      artifactLogicalKey: first.logicalKey,
      extractorLocator: first.extractorLocator
    },
    fetchCounts: { rawCount: jobs.length, parsedCount: jobs.length, validCount: jobs.length, parseDiscardCount: 0, validationDiscardCount: 0 },
    fetchLosses: []
  });
  return deriveCanonicalPaginationEvidence({ ...paginationOptions, evidence: quarantineCompleteList(evidence, quarantines) });
}

function replay(artifacts: SourceFetchArtifactDraft[]) {
  const map = new Map(artifacts.map(a => [a.logicalKey, a]));
  assert(map.size === artifacts.length && artifacts.reduce((n, a) => n + Buffer.byteLength(a.body), 0) <= LIMIT);
  let consumed = 0, previous = Date.parse(artifacts[0]!.capturedAt);
  const start = previous;
  const read = (role: Role, pageNum: number, req: Request) => {
    const k = role === "list" ? pageKey(pageNum) : TERMINAL_KEY;
    const a = map.get(k);
    assert(a && typeof a.body === "string" && a.logicalKey === artifacts[consumed]?.logicalKey);
    const time = Date.parse(a.capturedAt);
    assert(time >= previous && time - start <= WINDOW);
    previous = time;
    const expected = makeArtifact(role, pageNum, req, {
      body: a.body, status: a.httpStatus!, finalUrl: a.finalUrl!, contentType: a.contentType!, capturedAt: a.capturedAt
    }, a.capturedAt);
    assert(same({ ...a, id: expected.id }, expected));
    consumed++;
    assert(a.httpStatus === 200);
    return a.body;
  };

  const first = parseSearchPage(read("list", 1, makeRequest(1)), 1);
  const pages: ParsedSearchPage[] = [first];
  for (let p = 2; p <= first.totalPages; p++) {
    const next = parseSearchPage(read("list", p, makeRequest(p)), p);
    assert(next.declaredTotal === first.declaredTotal && next.totalPages === first.totalPages);
    pages.push(next);
  }
  if (first.declaredTotal > 0) {
    parseTerminalPage(read("terminal", first.totalPages + 1, makeRequest(first.totalPages + 1)));
  }

  const seenReqs = new Set<string>(), seenPaths = new Set<string>(), seenRawIds = new Set<string>();
  const projected: ReturnType<typeof projectRow>[] = [], listJobs: Array<{ sourceJobId: string }> = [], quarantines: JobQuarantine[] = [];
  const rawIdsByPage: string[][] = [];
  let globalIndex = 0;

  for (const [pageIndex, page] of pages.entries()) {
    const pageRawIds: string[] = [];
    for (let recordIndex = 0; recordIndex < page.rows.length; recordIndex++) {
      const raw = page.rows[recordIndex];
      const ident = extractRowIdentity(raw);
      if (ident.reqId) {
        assert(!seenReqs.has(ident.reqId));
        seenReqs.add(ident.reqId);
      }
      if (ident.externalPath) {
        assert(!seenPaths.has(ident.externalPath));
        seenPaths.add(ident.externalPath);
      }
      const rawJobId = irreversibleOfficialJsonEvidenceId(ident.reqId ?? [pageIndex, recordIndex, raw]);
      assert(!seenRawIds.has(rawJobId));
      seenRawIds.add(rawJobId);
      pageRawIds.push(rawJobId);

      let candidate: ReturnType<typeof projectRow> | undefined;
      try {
        candidate = projectRow(raw);
      } catch {
        // Single malformed/out-of-scope row isolates via quarantineCompleteList unless all rows fail.
      }
      if (candidate) {
        projected.push(candidate);
        listJobs.push(candidate.job);
      } else {
        const quarantineId = ident.sourceJobId ?? `unidentified:${globalIndex}`;
        quarantines.push({
          pageSequence: pageIndex,
          recordIndex,
          validJobId: irreversibleOfficialJsonEvidenceId(quarantineId),
          rawLocator: `${pageKey(page.page)}#row:${recordIndex}`,
          code: "PFIZER_OFFICIAL_PORTAL_JOB_UNVERIFIED",
          ...(ident.sourceJobId && ident.officialUrl ? { sourceJobId: ident.sourceJobId, officialUrl: ident.officialUrl } : {})
        });
        listJobs.push({ sourceJobId: quarantineId });
      }
      globalIndex++;
    }
    rawIdsByPage.push(pageRawIds);
  }

  assert(first.declaredTotal === 0 || projected.length > 0);
  assert(artifacts.length === consumed + 1);
  const report = reportArtifact(first.declaredTotal, projected.map(p => p.binding), artifacts[consumed - 1]!.capturedAt);
  assert(same(artifacts[consumed], report));
  const jobs = projected.map(p => p.job);
  assert(new Set(jobs.map(j => j.sourceJobId)).size === jobs.length);
  return { evidence: assemble(artifacts, pages, listJobs, rawIdsByPage, quarantines), jobs, declaredTotal: first.declaredTotal, totalPages: pages.length };
}

export function createPfizerOfficialPortalSourceFetch(deps: { http?: Http; now?: () => Date } = {}): SourceFetchFunction {
  return async plan => {
    const now = deps.now ?? (() => new Date()), startedAt = now().toISOString(), artifacts: SourceFetchArtifactDraft[] = [];
    let bytes = 0;
    let failedHttp: HttpStatusMeta | undefined;
    let stage: SourceTransportFailureStage = "ENTRY";
    try {
      assert(exactPlan(plan));
      const http: Http = deps.http ?? fetchPortalHttp;
      const acquire = async (role: Role, pageNum: number, req: Request) => {
        stage = role === "list" && pageNum === 1 ? "ENTRY" : "PAGE";
        let response: HttpResponse;
        try {
          response = await http(req);
        } catch (error) {
          if (error instanceof PortalHttpBodyError && error.httpMeta.status !== 200) {
            failedHttp = error.httpMeta;
          }
          throw error;
        }
        if (response.status !== 200) failedHttp = response;
        const a = makeArtifact(role, pageNum, req, response, now().toISOString());
        bytes += Buffer.byteLength(a.body);
        assert(bytes <= LIMIT);
        artifacts.push(a);
        assert(a.httpStatus === 200);
        return a.body as string;
      };

      const first = parseSearchPage(await acquire("list", 1, makeRequest(1)), 1);
      for (let p = 2; p <= first.totalPages; p++) {
        const next = parseSearchPage(await acquire("list", p, makeRequest(p)), p);
        assert(next.declaredTotal === first.declaredTotal && next.totalPages === first.totalPages);
      }
      if (first.declaredTotal > 0) {
        parseTerminalPage(await acquire("terminal", first.totalPages + 1, makeRequest(first.totalPages + 1)));
      }

      const preBindings = replayForReport(artifacts);
      const report = reportArtifact(first.declaredTotal, preBindings, artifacts.at(-1)!.capturedAt);
      assert(bytes + Buffer.byteLength(report.body) <= LIMIT);
      artifacts.push(report);

      const result = replay(artifacts), paginationEvaluation = evaluatePaginationEvidence({ ...paginationOptions, evidence: result.evidence });
      assert(paginationEvaluation.safeCompleteness && paginationEvaluation.verifiedEligible);
      return {
        ok: true,
        capturedAt: artifacts[0]!.capturedAt,
        payload: { jobPostings: result.jobs },
        fetchEvidence: result.evidence,
        paginationEvaluation,
        completeness: {
          completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
          expectedJobCount: result.declaredTotal,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: PFIZER_OFFICIAL_PORTAL_ENTRY,
          completenessBlockerReason: "Pfizer official career portal paginated JSON search replay",
          totalPages: result.declaredTotal === 0 ? 1 : result.totalPages,
          pageSize: PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize,
          pagesVisited: result.totalPages
        }
      };
    } catch (error) {
      const failure = failedHttp
        ? retryableHttpTransportFailure(failedHttp.status, failedHttp.retryAfter)
        : retryableTransportFailureFromError(error);
      const transportFailure = failure ? { ...failure, stage } : undefined;
      const failureReason = transportFailure ? safeSourceTransportFailureReason(transportFailure)
        : failedHttp ? `Official JSON source returned HTTP ${failedHttp.status}` : FAILURE;
      const fetchEvidence = artifacts.length ? parsePersistentSourceFetchEvidence({
        captureTool: { name: "pfizer-official-portal-http", version: "1" },
        artifacts: artifacts.map(a => a.kind === "ORACLE_RESULT" ? a : { ...a, kind: "ATS_API_RESPONSE" }),
        pages: [],
        supportingArtifactOnlyFailure: { code: FAILURE },
        fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
        fetchLosses: []
      }) : undefined;
      return {
        ok: false,
        capturedAt: startedAt,
        failureReason,
        ...(transportFailure ? { transportFailure } : {}),
        ...(fetchEvidence ? { fetchEvidence } : {})
      };
    }
  };
}

function replayForReport(artifacts: readonly SourceFetchArtifactDraft[]): DetailBinding[] {
  const bindings: DetailBinding[] = [];
  for (const a of artifacts) {
    if (!a.logicalKey.startsWith("pfizer-portal-list-")) continue;
    const data = object(parseJson(a.body as string).data);
    if (isEmptyPortalData(data)) continue;
    assert(Array.isArray(data.data));
    for (const raw of data.data) {
      try {
        bindings.push(projectRow(raw).binding);
      } catch {
        // Invalid single rows are quarantined during full replay below.
      }
    }
  }
  return bindings;
}

export function validateStrictPfizerOfficialPortalEvidence(
  plan: SourceCrawlPlan,
  input: PersistentSourceFetchEvidence,
  output: readonly NormalizedJobRecord[]
): boolean {
  try {
    assert(exactPlan(plan));
    const evidence = parsePersistentSourceFetchEvidence(input), result = replay(evidence.artifacts);
    assert(same(evidence, result.evidence));
    assert(output.length === result.jobs.length && new Set(output.map(j => j.sourceJobId)).size === output.length);
    const byId = new Map(result.jobs.map(j => [j.sourceJobId, j]));
    return output.every(job => {
      const row = byId.get(job.sourceJobId!);
      return row && typeof job.isBaseline === "boolean" && same(job, {
        companyId: plan.company.id,
        sourceId: plan.source.id,
        sourceKind: "SOCIAL",
        atsKind: "OFFICIAL_JSON",
        officialChineseCompanyName: plan.company.officialChineseName,
        sourceJobId: row.sourceJobId,
        officialTitle: row.title,
        officialUrl: row.officialUrl,
        listUrl: PFIZER_OFFICIAL_PORTAL_ENTRY,
        locationRaw: row.locationRaw,
        cities: row.cities,
        category: "其他",
        officialPublishedAt: row.officialPublishedAt,
        isBaseline: job.isBaseline,
        evidence: { officialEntryUrl: PFIZER_OFFICIAL_PORTAL_ENTRY, officialChainEvidenceUrl: CHAIN, capturedAt: evidence.artifacts[0]!.capturedAt }
      });
    });
  } catch {
    return false;
  }
}

export function getStrictPfizerOfficialPortalPolicy(plan: SourceCrawlPlan): StrictProfileBoundSourcePolicy | undefined {
  if (!exactPlan(plan)) return undefined;
  return {
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true,
    allowCompleteTraversalOfEmptyFirstPage: true,
    urlRules: [
      {
        id: "pfizer-official-search-api",
        url: PFIZER_OFFICIAL_PORTAL_API,
        match: "EXACT",
        allowsPagination: true,
        allowsDeclaration: true,
        allowsPositiveTotalDeclaration: true
      }
    ]
  };
}
