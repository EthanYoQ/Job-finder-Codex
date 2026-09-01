import { load } from "cheerio";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
import type { SourceFetchFunction } from "./runSourceCrawl";

const JNJ_CAREERS_ORIGIN = "https://www.careers.jnj.com";
const JNJ_CAREERS_CHINA_SEARCH_URL = `${JNJ_CAREERS_ORIGIN}/en/jobs/?country=China`;
const JNJ_PAGE_SIZE = 20;
const JNJ_MAX_PAGES = 20;
const SAFE_JNJ_FAILURE_CODES = new Set([
  "JNJ_HTTP_FAILURE",
  "JNJ_INNOVATIVE_MEDICINE_SCOPE_UNPROVEN",
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
}

export const JNJ_CAREERS_CHINA_FETCH_CONFIG = Object.freeze({
  officialSearchUrl: JNJ_CAREERS_CHINA_SEARCH_URL,
  country: "China",
  pageSize: JNJ_PAGE_SIZE,
  maxPages: JNJ_MAX_PAGES
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
}

export type JnjCareersHttpClient = (
  request: JnjCareersHttpRequest
) => Promise<JnjCareersHttpResponse>;

export interface JnjCareersChinaJobSummary {
  officialId: string;
  title: string;
  officialUrl: string;
}

export type JnjCareersChinaAuditResult =
  | {
      ok: true;
      total: number;
      pagesVisited: number;
      jobs: JnjCareersChinaJobSummary[];
    }
  | {
      ok: false;
      failureCode:
        | "JNJ_HTTP_FAILURE"
        | "JNJ_INVALID_CONFIG"
        | "JNJ_INVALID_PAGE"
        | "JNJ_MAX_PAGES_REACHED"
        | "JNJ_PAGINATION_DRIFT"
        | "JNJ_TOTAL_NOT_CLOSED";
    };

export interface JnjCareersChinaAuditDeps {
  http?: JnjCareersHttpClient;
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
  const jobs: JnjCareersChinaJobSummary[] = [];
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
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "job-search-crawler/0.1"
        }
      });
    } catch {
      return { ok: false, failureCode: "JNJ_HTTP_FAILURE" };
    }
    if (response.status < 200 || response.status >= 300 ||
      response.finalUrl !== url || !isHtmlContentType(response.contentType)) {
      return { ok: false, failureCode: "JNJ_HTTP_FAILURE" };
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
    if (jobs.length === declaredTotal) {
      return { ok: true, total: declaredTotal, pagesVisited: page, jobs };
    }
    if (jobs.length > declaredTotal || parsed.jobs.length !== config.pageSize) {
      return { ok: false, failureCode: "JNJ_TOTAL_NOT_CLOSED" };
    }
  }
  return { ok: false, failureCode: "JNJ_MAX_PAGES_REACHED" };
}

/**
 * The official country filter currently combines Innovative Medicine and
 * MedTech and exposes no structured business-segment filter. The crawler keeps
 * this source fail-closed after auditing the complete public result set.
 */
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
    const audit = await auditJnjCareersChinaResultSet(plan.profileBoundSource.config, deps);
    if (!audit.ok) return { ok: false, capturedAt, failureReason: audit.failureCode };
    return {
      ok: false,
      capturedAt,
      failureReason: "JNJ_INNOVATIVE_MEDICINE_SCOPE_UNPROVEN"
    };
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
  const visibleText = $.root().text().replace(/\s+/gu, " ").trim();
  if (!/Country\s*\/\s*Territory[\s\S]{0,500}China/iu.test(visibleText)) return undefined;
  const count = /Displaying\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+matching jobs/iu.exec(visibleText);
  if (!count) return undefined;
  const first = Number(count[1]);
  const last = Number(count[2]);
  const total = Number(count[3]);
  if (![first, last, total].every(Number.isSafeInteger) || total < 0) return undefined;

  const jobs: JnjCareersChinaJobSummary[] = [];
  const ids = new Set<string>();
  $('a[href*="/jobs/r-"]').each((_index, element) => {
    const href = $(element).attr("href");
    const title = $(element).text().replace(/\s+/gu, " ").trim();
    const url = href ? safeJnjJobUrl(href) : undefined;
    const match = url ? /^\/en\/jobs\/(r-[0-9]+)\/(?:[^/?#]+)\/$/u.exec(new URL(url).pathname) : undefined;
    const id = match?.[1];
    if (!id || !title || ids.has(id)) return;
    ids.add(id);
    jobs.push({ officialId: id, title, officialUrl: url! });
  });
  const expectedFirst = total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const expectedCount = total === 0 ? 0 : Math.min(pageSize, total - expectedFirst + 1);
  if (first !== expectedFirst || last !== (total === 0 ? 0 : first + expectedCount - 1) ||
    jobs.length !== expectedCount) return undefined;
  return { total, jobs };
}

function jnjCareersPageUrl(config: JnjCareersChinaFetchConfig, page: number): string {
  if (page === 1) return config.officialSearchUrl;
  return `${JNJ_CAREERS_ORIGIN}/en/jobs/?page=${page}&country=${encodeURIComponent(config.country)}`;
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
    config.country === "China" && config.pageSize === JNJ_PAGE_SIZE && config.maxPages === JNJ_MAX_PAGES;
}

function isHtmlContentType(value: string | undefined): boolean {
  return typeof value === "string" && /^text\/html(?:\s*;|$)/iu.test(value.trim());
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
    ...(contentType ? { contentType } : {})
  };
}
