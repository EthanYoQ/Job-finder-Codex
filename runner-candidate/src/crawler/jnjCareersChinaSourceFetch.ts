import { CITY_PENDING } from "../domain/jobLocation";
import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { load } from "cheerio";
import { reviewedMainlandCityLabel } from "./reviewedMainlandCity";
import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";
import {
  currentOfficialSourceAttemptSignal,
  fetchWithOfficialTimeout,
  officialBrowserTimeoutMs
} from "./officialHttpRuntimeLimits";
import type { NormalizedJobRecord } from "./normalizedJob";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import type { SourceFetchFunction, SourceFetchResult, SourceTransportAttempt } from "./runSourceCrawl";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  parsePersistentSourceFetchEvidence,
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";

const JNJ_CAREERS_ORIGIN = "https://www.careers.jnj.com";
const JNJ_CAREERS_CHINA_SEARCH_URL =
  `${JNJ_CAREERS_ORIGIN}/en/jobs/?search=&country=China&pagesize=20`;
const JNJ_PAGE_SIZE = 20;
const JNJ_MAX_PAGES = 20;
const JNJ_LIST_LOCATOR =
  "jnj-careers-list-v1|country:selected:China|html:.PageList-items-item.card-job";
const SAFE_JNJ_FAILURE_CODES = new Set([
  "JNJ_EVIDENCE_INVALID",
  "JNJ_DOM_OBSERVATION_INVALID",
  "JNJ_HTTP_FAILURE",
  "JNJ_INVALID_CONFIG",
  "JNJ_INVALID_PAGE",
  "JNJ_MAX_PAGES_REACHED",
  "JNJ_PAGINATION_DRIFT",
  "JNJ_PLAN_BINDING_INVALID",
  "JNJ_TOTAL_NOT_CLOSED"
]);

export function isSafeJnjCareersFailureCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_JNJ_FAILURE_CODES.has(value);
}

export interface JnjCareersChinaFetchConfig {
  officialSearchUrl: typeof JNJ_CAREERS_CHINA_SEARCH_URL;
  country: "China";
  pageSize: typeof JNJ_PAGE_SIZE;
  maxPages: typeof JNJ_MAX_PAGES;
  scopePolicy: "GROUP_CHINA_ALL_BUSINESSES_V1";
}

export const JNJ_CAREERS_CHINA_FETCH_CONFIG = Object.freeze({
  officialSearchUrl: JNJ_CAREERS_CHINA_SEARCH_URL,
  country: "China",
  pageSize: JNJ_PAGE_SIZE,
  maxPages: JNJ_MAX_PAGES,
  scopePolicy: "GROUP_CHINA_ALL_BUSINESSES_V1"
}) satisfies JnjCareersChinaFetchConfig;

export interface JnjCareersHttpRequest {
  url: string;
  method: "GET";
  headers: Record<string, string>;
}

export interface JnjCareersHttpResponse {
  status: number;
  body: string;
  finalUrl?: string;
  contentType?: string;
  capturedAt?: string;
}

export type JnjCareersHttpClient = (
  request: JnjCareersHttpRequest
) => Promise<JnjCareersHttpResponse>;

export interface JnjCareersBrowserSession {
  http: JnjCareersHttpClient;
  close: () => Promise<void>;
}

export type JnjCareersBrowserSessionFactory = () => Promise<JnjCareersBrowserSession>;

export interface JnjCareersChinaJobSummary {
  officialId: string;
  title: string;
  officialUrl: string;
  functionRaw: string;
  locationRaw: string;
  cities: string[];
}

export type JnjCareersChinaAuditResult =
  | {
      ok: true;
      total: number;
      pagesVisited: number;
      jobs: JnjCareersChinaJobSummary[];
      fetchEvidence: PersistentSourceFetchEvidence;
      paginationEvaluation: ReturnType<typeof evaluatePaginationEvidence>;
    }
  | {
      ok: false;
      failureCode:
        | "JNJ_EVIDENCE_INVALID"
        | "JNJ_HTTP_FAILURE"
        | "JNJ_INVALID_CONFIG"
        | "JNJ_INVALID_PAGE"
        | "JNJ_MAX_PAGES_REACHED"
        | "JNJ_PAGINATION_DRIFT"
        | "JNJ_TOTAL_NOT_CLOSED";
      fetchEvidence?: PersistentSourceFetchEvidence;
    };

export interface JnjCareersChinaAuditDeps {
  http?: JnjCareersHttpClient;
  browserSession?: JnjCareersBrowserSessionFactory;
  now?: () => Date;
}

/**
 * Replays the public country=China result pages exactly as the J&J careers UI
 * exposes them. This establishes the public denominator without claiming that
 * the mixed J&J result set belongs to Innovative Medicine.
 */
export async function auditJnjCareersChinaResultSet(
  config: JnjCareersChinaFetchConfig,
  deps: JnjCareersChinaAuditDeps = {}
): Promise<JnjCareersChinaAuditResult> {
  if (!isExactConfig(config)) return { ok: false, failureCode: "JNJ_INVALID_CONFIG" };
  const http = deps.http ?? defaultJnjHttpClient;
  const now = deps.now ?? (() => new Date());
  const jobs: JnjCareersChinaJobSummary[] = [];
  const artifacts: SourceFetchArtifactDraft[] = [];
  const pages: SourceFetchPageTrace[] = [];
  const seenIds = new Set<string>();
  let declaredTotal: number | undefined;

  for (let page = 1; page <= config.maxPages; page += 1) {
    const url = jnjCareersPageUrl(config, page);
    let response: JnjCareersHttpResponse;
    try {
      response = await http({
        url,
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
        }
      });
    } catch {
      const capturedAt = now().toISOString();
      return { ok: false, failureCode: "JNJ_HTTP_FAILURE",
        fetchEvidence: jnjTransportFailureEvidence(url, undefined, capturedAt) };
    }
    if (response.status < 200 || response.status >= 300 ||
      response.finalUrl !== url || !isHtmlContentType(response.contentType)) {
      return { ok: false, failureCode: "JNJ_HTTP_FAILURE",
        fetchEvidence: jnjTransportFailureEvidence(url, response, response.capturedAt ?? now().toISOString()) };
    }

    const parsed = parseJnjCareersChinaPage(response.body, page, config.pageSize);
    if (!parsed) return { ok: false, failureCode: "JNJ_INVALID_PAGE" };
    if (declaredTotal === undefined) declaredTotal = parsed.total;
    if (parsed.total !== declaredTotal) {
      return { ok: false, failureCode: "JNJ_PAGINATION_DRIFT" };
    }
    for (const job of parsed.jobs) {
      if (seenIds.has(job.officialId)) {
        return { ok: false, failureCode: "JNJ_PAGINATION_DRIFT" };
      }
      seenIds.add(job.officialId);
      jobs.push(job);
    }
    const capturedAt = response.capturedAt ?? now().toISOString();
    const logicalKey = `jnj-list-${String(page - 1).padStart(4, "0")}`;
    artifacts.push({
      id: logicalKey,
      logicalKey,
      kind: "PAGINATION_PAGE",
      requestedUrl: sanitizeEvidenceHttpUrl(url),
      finalUrl: sanitizeEvidenceHttpUrl(response.finalUrl),
      httpStatus: response.status,
      contentType: response.contentType,
      capturedAt,
      bodyRepresentation: "EXACT",
      body: response.body,
      extractorLocator: JNJ_LIST_LOCATOR
    });
    const hasNext = jobs.length < declaredTotal;
    pages.push({
      sequence: page - 1,
      artifactLogicalKey: logicalKey,
      requestedCursor: null,
      returnedCursor: null,
      requestedOffset: (page - 1) * config.pageSize,
      returnedOffset: (page - 1) * config.pageSize,
      requestedPage: page,
      returnedPage: page,
      requestedPageSize: config.pageSize,
      returnedPageSize: config.pageSize,
      rawJobIds: parsed.jobs.map((job) => evidenceId(job.officialId)),
      validJobIds: parsed.jobs.map((job) => evidenceId(job.officialId)),
      declaredTotal,
      declaredCount: declaredTotal,
      declaredPages: Math.ceil(declaredTotal / config.pageSize),
      nextPageSignalBefore: page === 1 ? null : `page:${page}`,
      nextPageSignalAfter: hasNext ? `page:${page + 1}` : null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(response.body, "utf8")).sha256,
      termination: hasNext ? "CONTINUE" : "DECLARED_TOTAL_REACHED",
      anomalyCodes: [],
      capturedAt
    });
    if (jobs.length === declaredTotal) {
      const evidence = deriveCanonicalPaginationEvidence({
        evidence: parsePersistentSourceFetchEvidence({
          captureTool: { name: "jnj-careers-html", version: "1" },
          artifacts,
          pages,
          declaredCompleteness: {
            kind: "OFFICIAL_TOTAL_COUNT",
            value: declaredTotal,
            artifactLogicalKey: artifacts[0]!.logicalKey,
            extractorLocator: JNJ_LIST_LOCATOR,
            scope: "SOURCE"
          },
          fetchCounts: {
            rawCount: jobs.length,
            parsedCount: jobs.length,
            validCount: jobs.length,
            parseDiscardCount: 0,
            validationDiscardCount: 0
          },
          fetchLosses: []
        }),
        expectedChannelIds: [],
        filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      });
      const paginationEvaluation = evaluatePaginationEvidence({
        evidence,
        expectedChannelIds: [],
        filteredOutput: true,
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      });
      if (!paginationEvaluation.safeCompleteness) {
        return { ok: false, failureCode: "JNJ_EVIDENCE_INVALID" };
      }
      return { ok: true, total: declaredTotal, pagesVisited: page, jobs, fetchEvidence: evidence,
        paginationEvaluation };
    }
    if (jobs.length > declaredTotal || parsed.jobs.length !== config.pageSize) {
      return { ok: false, failureCode: "JNJ_TOTAL_NOT_CLOSED" };
    }
  }
  return { ok: false, failureCode: "JNJ_MAX_PAGES_REACHED" };
}

/** Replays the user-verified J&J group China scope, including all business units. */
export function createJnjCareersChinaSourceFetch(
  deps: JnjCareersChinaAuditDeps & { now?: () => Date } = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();
    if (plan.company.id !== "company-johnson-innovative-medicine" ||
      plan.source.id !== "source-johnson-innovative-medicine-social" ||
      plan.source.officialEntryUrl !== JNJ_CAREERS_CHINA_SEARCH_URL ||
      plan.adapterId !== "official-json" ||
      plan.profileBoundSource?.kind !== "jnj-careers-china" ||
      !isExactConfig(plan.profileBoundSource.config)) {
      return { ok: false, capturedAt, failureReason: "JNJ_PLAN_BINDING_INVALID" };
    }
    const config = plan.profileBoundSource.config;
    const direct = await auditJnjCareersChinaResultSet(config, deps);
    if (direct.ok) return jnjSuccessfulFetch(plan, direct, capturedAt);
    if (direct.failureCode !== "JNJ_HTTP_FAILURE") {
      return { ok: false, capturedAt, failureReason: direct.failureCode,
        ...(direct.fetchEvidence ? { fetchEvidence: direct.fetchEvidence } : {}) };
    }

    const attempts: SourceTransportAttempt[] = [{
      transport: "DIRECT_HTTP",
      outcome: "FAILED",
      code: "JNJ_DIRECT_FAILED",
      capturedAt,
      ...(direct.fetchEvidence ? { fetchEvidence: direct.fetchEvidence } : {})
    }];
    let session: JnjCareersBrowserSession | undefined;
    try {
      session = await (deps.browserSession ?? defaultJnjCareersBrowserSession)();
    } catch {
      return jnjBrowserFailure(capturedAt, attempts, "JNJ_BROWSER_SESSION_FAILED");
    }
    try {
      const browserAudit = await auditJnjCareersChinaResultSet(config, {
        http: session.http,
        ...(deps.now ? { now: deps.now } : {})
      });
      if (!browserAudit.ok) {
        return jnjBrowserFailure(capturedAt, attempts, "JNJ_BROWSER_FETCH_FAILED", browserAudit.fetchEvidence);
      }
      return jnjSuccessfulFetch(plan, browserAudit, capturedAt, [...attempts, {
        transport: "BROWSER_SESSION",
        outcome: "SUCCEEDED",
        code: "JNJ_BROWSER_SUCCEEDED",
        capturedAt,
        paginationEvaluation: browserAudit.paginationEvaluation
      }]);
    } finally {
      try { await session.close(); } catch { /* transport evidence is already authoritative */ }
    }
  };
}

function jnjSuccessfulFetch(
  plan: SourceCrawlPlan,
  audit: Extract<JnjCareersChinaAuditResult, { ok: true }>,
  capturedAt: string,
  priorTransportAttempts?: readonly SourceTransportAttempt[]
): SourceFetchResult {
  if (plan.adapterId !== "official-json" || plan.profileBoundSource?.kind !== "jnj-careers-china") {
    throw new Error("JNJ successful fetch received an invalid plan");
  }
  return {
      ok: true as const,
      capturedAt,
      payload: { jobs: audit.jobs.map((job) => ({
        sourceJobId: job.officialId,
        title: job.title,
        officialUrl: job.officialUrl,
        locationRaw: job.locationRaw,
        cities: job.cities
      })) },
      completeness: {
        completenessStatus: "VERIFIED",
        expectedJobCount: audit.total,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: plan.profileBoundSource.config.officialSearchUrl,
        totalPages: Math.ceil(audit.total / plan.profileBoundSource.config.pageSize),
        pageSize: plan.profileBoundSource.config.pageSize,
        pagesVisited: audit.pagesVisited
      },
      fetchEvidence: audit.fetchEvidence,
      paginationEvaluation: audit.paginationEvaluation,
      ...(priorTransportAttempts ? { priorTransportAttempts } : {})
    };
}

function jnjBrowserFailure(
  capturedAt: string,
  attempts: readonly SourceTransportAttempt[],
  code: "JNJ_BROWSER_SESSION_FAILED" | "JNJ_BROWSER_FETCH_FAILED",
  fetchEvidence?: PersistentSourceFetchEvidence
): SourceFetchResult {
  return {
    ok: false as const,
    capturedAt,
    failureReason: code,
    transportFailure: { code: "OFFICIAL_BROWSER_SESSION_ERROR" as const, retryable: true as const, stage: "ENTRY" as const },
    ...(fetchEvidence ? { fetchEvidence } : {}),
    priorTransportAttempts: [...attempts, {
      transport: "BROWSER_SESSION" as const,
      outcome: "FAILED" as const,
      code,
      capturedAt,
      ...(fetchEvidence ? { fetchEvidence } : {})
    }]
  };
}

export function parseJnjCareersChinaPage(
  html: string,
  page: number,
  pageSize: number
): { total: number; jobs: JnjCareersChinaJobSummary[] } | undefined {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    return undefined;
  }
  const $ = load(html);
  const selectedCountries = $('select[name="country"] option[selected]').toArray()
    .map((option) => $(option).attr("value"));
  if (selectedCountries.length !== 1 || selectedCountries[0] !== "China") return undefined;
  const visibleText = $.root().text().replace(/\s+/gu, " ").trim();
  const count = /Displaying\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+matching jobs/iu.exec(visibleText);
  if (!count) return undefined;
  const first = Number(count[1]);
  const last = Number(count[2]);
  const total = Number(count[3]);
  if (![first, last, total].every(Number.isSafeInteger) || total < 0) return undefined;

  const jobs = parseJnjCareersChinaCards(html, "China");
  if (!jobs) return undefined;
  const expectedFirst = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const expectedCount = total === 0 ? 0 : Math.min(pageSize, total - expectedFirst + 1);
  if (first !== expectedFirst || last !== (total === 0 ? 0 : first + expectedCount - 1) ||
    jobs.length !== expectedCount) return undefined;
  return { total, jobs };
}

/** Parse the same real cards from an HTTP document or a captured UI fragment. */
export function parseJnjCareersChinaCards(html: string, countryScope?: "China"): JnjCareersChinaJobSummary[] | undefined {
  const $ = load(html);
  const jobs: JnjCareersChinaJobSummary[] = [];
  const ids = new Set<string>();
  $(".PageList-items-item.card-job").each((_index, element) => {
    const card = $(element);
    const anchor = card.find('a[href*="/jobs/r-"]').first();
    const href = anchor.attr("href");
    const title = anchor.text().replace(/\s+/gu, " ").trim();
    const functionRaw = card.find(".PagePromo-category").first().text().replace(/\s+/gu, " ").trim();
    const locationRaw = card.find(".PagePromo-location").first().text().replace(/\s+/gu, " ").trim();
    const url = href ? safeJnjJobUrl(href) : undefined;
    const match = url ? /^\/en\/jobs\/(r-[0-9]+)\/(?:[^/?#]+)\/$/u.exec(new URL(url).pathname) : undefined;
    const id = match?.[1];
    if (!id || card.attr("data-id")?.toLowerCase() !== id || !title || !functionRaw || !locationRaw || ids.has(id)) return;
    ids.add(id);
    jobs.push({ officialId: id, title, officialUrl: url!, functionRaw, locationRaw,
      cities: citiesFromJnjLocation(locationRaw, countryScope) });
  });
  if (jobs.length !== $(".PageList-items-item.card-job").length) return undefined;
  return jobs;
}

function jnjCareersPageUrl(config: JnjCareersChinaFetchConfig, page: number): string {
  if (page === 1) return config.officialSearchUrl;
  return `${JNJ_CAREERS_ORIGIN}/en/jobs/?page=${page}&country=${encodeURIComponent(config.country)}&pagesize=${config.pageSize}`;
}

function safeJnjJobUrl(value: string): string | undefined {
  try {
    const url = new URL(value, JNJ_CAREERS_ORIGIN);
    if (url.protocol !== "https:" || url.origin !== JNJ_CAREERS_ORIGIN ||
      url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function isExactConfig(config: JnjCareersChinaFetchConfig): boolean {
  return config.officialSearchUrl === JNJ_CAREERS_CHINA_SEARCH_URL &&
    config.country === "China" && config.pageSize === JNJ_PAGE_SIZE && config.maxPages === JNJ_MAX_PAGES &&
    config.scopePolicy === "GROUP_CHINA_ALL_BUSINESSES_V1";
}

function isHtmlContentType(value: string | undefined): boolean {
  return typeof value === "string" && /^text\/html(?:\s*;|$)/iu.test(value.trim());
}

export function validateStrictJnjCareersChinaEvidence(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  try {
    if (plan.adapterId !== "official-json" || !exactPlanConfig(plan) ||
        evidence.captureTool.name !== "jnj-careers-html" ||
        evidence.captureTool.version !== "1" || evidence.supportingArtifactOnlyFailure ||
        evidence.fetchLosses.length !== 0 || evidence.fetchCounts.parseDiscardCount !== 0 ||
        evidence.fetchCounts.validationDiscardCount !== 0 || evidence.artifacts.length !== evidence.pages.length ||
        evidence.artifacts.length === 0) return false;
    const config = plan.profileBoundSource!.config as JnjCareersChinaFetchConfig;
    const listed: JnjCareersChinaJobSummary[] = [];
    let total: number | undefined;
    for (let sequence = 0; sequence < evidence.artifacts.length; sequence += 1) {
      const artifact = evidence.artifacts[sequence]!;
      const page = sequence + 1;
      const expectedUrl = jnjCareersPageUrl(config, page);
      if (artifact.logicalKey !== `jnj-list-${String(sequence).padStart(4, "0")}` ||
          !exactJnjNetworkArtifact(artifact, expectedUrl) || typeof artifact.body !== "string") return false;
      const parsed = parseJnjCareersChinaPage(artifact.body, page, config.pageSize);
      if (!parsed) return false;
      total ??= parsed.total;
      if (parsed.total !== total) return false;
      listed.push(...parsed.jobs);
      const trace = evidence.pages[sequence];
      const rawIds = parsed.jobs.map((job) => evidenceId(job.officialId));
      if (!trace || trace.sequence !== sequence || trace.artifactLogicalKey !== artifact.logicalKey ||
          trace.requestedPage !== page || trace.returnedPage !== page ||
          trace.requestedPageSize !== config.pageSize || trace.returnedPageSize !== config.pageSize ||
          trace.requestedOffset !== sequence * config.pageSize || trace.returnedOffset !== sequence * config.pageSize ||
          trace.declaredTotal !== total || trace.declaredCount !== total ||
          trace.declaredPages !== Math.ceil(total / config.pageSize) ||
          JSON.stringify(trace.rawJobIds) !== JSON.stringify(rawIds) ||
          JSON.stringify(trace.validJobIds) !== JSON.stringify(rawIds) ||
          trace.responseFingerprintSha256 !== sha256Bytes(Buffer.from(artifact.body, "utf8")).sha256 ||
          trace.termination !== (listed.length === total ? "DECLARED_TOTAL_REACHED" : "CONTINUE")) return false;
    }
    if (total === undefined || listed.length !== total ||
        new Set(listed.map((job) => job.officialId)).size !== listed.length ||
        evidence.fetchCounts.rawCount !== total || evidence.fetchCounts.parsedCount !== total ||
        evidence.fetchCounts.validCount !== total) return false;
    const declaration = evidence.declaredCompleteness;
    if (declaration?.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.scope !== "SOURCE" ||
        declaration.value !== total || declaration.artifactLogicalKey !== evidence.artifacts[0]!.logicalKey ||
        declaration.extractorLocator !== JNJ_LIST_LOCATOR) return false;
    const expected = listed.map((job) => ({
      sourceJobId: job.officialId,
      officialTitle: job.title,
      officialUrl: job.officialUrl,
      locationRaw: job.locationRaw,
      cities: job.cities
    })).sort(compareOutputJob);
    const actual = outputJobs.map((job) => ({
      sourceJobId: job.sourceJobId,
      officialTitle: job.officialTitle,
      officialUrl: job.officialUrl,
      locationRaw: job.locationRaw,
      cities: job.cities
    })).sort(compareOutputJob);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
    const evaluated = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true });
    return evaluated.safeCompleteness && evaluated.verifiedEligible && evaluated.derivedAnomalyCodes.length === 0;
  } catch {
    return false;
  }
}

export function getStrictJnjCareersChinaNetworkPolicy(plan: SourceCrawlPlan): {
  urlRules: Array<{
    id: string;
    url: string;
    match: "EXACT";
    allowsPagination: true;
    allowsDeclaration: true;
    allowsPositiveTotalDeclaration: true;
  }>;
  allowPositiveOfficialTotalCountAfterAdapterReconciliation: true;
} | undefined {
  if (plan.adapterId !== "official-json" || !exactPlanConfig(plan)) return undefined;
  const config = plan.profileBoundSource!.config as JnjCareersChinaFetchConfig;
  return {
    urlRules: Array.from({ length: config.maxPages }, (_, index) => ({
      id: `profile-jnj-list-${index + 1}`,
      url: jnjCareersPageUrl(config, index + 1),
      match: "EXACT" as const,
      allowsPagination: true as const,
      allowsDeclaration: true as const,
      allowsPositiveTotalDeclaration: true as const
    })),
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
  };
}

function exactPlanConfig(plan: SourceCrawlPlan): boolean {
  return plan.company.id === "company-johnson-innovative-medicine" &&
    plan.source.id === "source-johnson-innovative-medicine-social" &&
    plan.source.companyId === plan.company.id && plan.source.officialEntryUrl === JNJ_CAREERS_CHINA_SEARCH_URL &&
    plan.adapterId === "official-json" && plan.profileBoundSource?.kind === "jnj-careers-china" &&
    isExactConfig(plan.profileBoundSource.config);
}

function exactJnjNetworkArtifact(
  artifact: PersistentSourceFetchEvidence["artifacts"][number],
  url: string
): boolean {
  const safeUrl = sanitizeEvidenceHttpUrl(url);
  return artifact.kind === "PAGINATION_PAGE" && artifact.requestedUrl === safeUrl &&
    artifact.finalUrl === safeUrl && artifact.httpStatus === 200 &&
    /^text\/html(?:\s*;|$)/iu.test(artifact.contentType ?? "") &&
    artifact.bodyRepresentation === "EXACT" && typeof artifact.body === "string" && artifact.body.length > 0 &&
    artifact.extractorLocator === JNJ_LIST_LOCATOR && Number.isFinite(Date.parse(artifact.capturedAt));
}

const JNJ_CITY_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"], ["Beijing", "北京"], ["Guangzhou", "广州"], ["Shenzhen", "深圳"],
  ["Suzhou", "苏州"], ["Nanjing", "南京"], ["Hangzhou", "杭州"], ["Chengdu", "成都"],
  ["Wuhan", "武汉"], ["Tianjin", "天津"], ["Xi'an", "西安"], ["Xian", "西安"],
  ["Changsha", "长沙"], ["Kunming", "昆明"], ["Qingdao", "青岛"], ["Jinan", "济南"],
  ["Dalian", "大连"], ["Xiamen", "厦门"], ["Fuzhou", "福州"], ["Hefei", "合肥"],
  ["Ningbo", "宁波"], ["Jiaxing", "嘉兴"], ["Zhengzhou", "郑州"], ["Shenyang", "沈阳"],
  ["Nanchang", "南昌"], ["Guiyang", "贵阳"]
];

function citiesFromJnjLocation(locationRaw: string, countryScope?: "China"): string[] {
  const labels = locationRaw.split("/").map(value => value.trim()).filter(Boolean);
  // The China-filtered board also lists global roles. Project each location separately.
  const cities = labels.filter(label => !explicitlyForeignOrNonMainlandLocation(label)).map(label => JNJ_CITY_NAMES.find(([english, chinese]) =>
    label.toLowerCase() === english.toLowerCase() || label === chinese)?.[1] ??
    (countryScope === "China" ? reviewedMainlandCityLabel(label, countryScope) : undefined))
    .filter((city): city is string => city !== undefined);
  if (cities.length) return [...new Set(cities)];
  return labels.some(label => /^(?:China|中国)$/iu.test(label)) ? [CITY_PENDING] : [];
}

function evidenceId(officialId: string): string {
  return `jnj:sha256:${sha256Bytes(Buffer.from(officialId, "utf8")).sha256}`;
}

function compareOutputJob(
  left: { sourceJobId?: string | undefined },
  right: { sourceJobId?: string | undefined }
): number {
  return Buffer.from(left.sourceJobId ?? "", "utf8").compare(Buffer.from(right.sourceJobId ?? "", "utf8"));
}

function jnjTransportFailureEvidence(
  requestedUrl: string,
  response: JnjCareersHttpResponse | undefined,
  capturedAt: string
): PersistentSourceFetchEvidence {
  const logicalKey = "jnj-transport-failure";
  let artifact: SourceFetchArtifactDraft;
  try {
    if (!response?.finalUrl || !response.contentType) throw new Error("network response metadata unavailable");
    artifact = {
      id: logicalKey,
      logicalKey,
      kind: "ATS_PAGE",
      requestedUrl: sanitizeEvidenceHttpUrl(requestedUrl),
      finalUrl: sanitizeEvidenceHttpUrl(response.finalUrl),
      httpStatus: response.status,
      contentType: response.contentType,
      capturedAt,
      bodyRepresentation: "EXACT",
      body: response.body,
      extractorLocator: "jnj-careers-transport-failure-v1|http-response"
    };
  } catch {
    artifact = {
      id: logicalKey,
      logicalKey,
      kind: "COMMAND_OUTPUT",
      capturedAt,
      body: "JNJ_HTTP_FAILURE",
      extractorLocator: "jnj-careers-transport-failure-v1|transport-exception"
    };
  }
  return parsePersistentSourceFetchEvidence({
    captureTool: { name: "jnj-careers-html", version: "1" },
    artifacts: [artifact],
    pages: [],
    supportingArtifactOnlyFailure: { code: "JNJ_HTTP_FAILURE" },
    fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
    fetchLosses: []
  });
}

async function defaultJnjCareersBrowserSession(): Promise<JnjCareersBrowserSession> {
  const signal = currentOfficialSourceAttemptSignal();
  if (signal?.aborted) throw signal.reason;
  const releasePermit = await acquireBrowserSourcePermit(signal);
  let browser: import("playwright-core").Browser | undefined;
  let closed = false;
  let onAbort: (() => void) | undefined;
  try {
    const { chromium } = await import("playwright-core");
    const { FORMAL_CHROMIUM_ARGS, FORMAL_CHROMIUM_PATH } = await import("../readiness/formalBrowserPreflight");
    const timeout = officialBrowserTimeoutMs();
    browser = await chromium.launch({
      ...(process.platform === "linux"
        ? { executablePath: FORMAL_CHROMIUM_PATH, args: [...FORMAL_CHROMIUM_ARGS] }
        : { channel: "chrome" as const }),
      headless: true, chromiumSandbox: true,
      timeout
    });
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      viewport: { width: 1440, height: 900 }
    });
    const close = async () => {
      if (closed) return;
      closed = true;
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      try { await browser?.close(); } finally { releasePermit(); }
    };
    if (signal) {
      onAbort = () => { void close(); };
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return {
      http: async (request) => {
        if (signal?.aborted) throw signal.reason;
        const navigation = await page.goto(request.url, { waitUntil: "domcontentloaded", timeout });
        if (!navigation) throw new Error("JNJ browser navigation response missing");
        const contentType = navigation.headers()["content-type"];
        return {
          status: navigation.status(),
          body: await navigation.text(),
          finalUrl: navigation.url(),
          capturedAt: new Date().toISOString(),
          ...(contentType ? { contentType } : {})
        };
      },
      close
    };
  } catch (error) {
    try { await browser?.close(); } catch { /* launch failure remains authoritative */ }
    releasePermit();
    throw error;
  }
}

async function defaultJnjHttpClient(request: JnjCareersHttpRequest): Promise<JnjCareersHttpResponse> {
  const response = await fetchWithOfficialTimeout(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: "follow"
  });
  const contentType = response.headers.get("content-type") ?? undefined;
  return {
    status: response.status,
    body: await response.text(),
    finalUrl: response.url,
    capturedAt: new Date().toISOString(),
    ...(contentType ? { contentType } : {})
  };
}
