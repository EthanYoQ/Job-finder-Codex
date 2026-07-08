import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface HotjobLegacyFetchConfig {
  listUrl: string;
  suitePath: string;
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
}

export type HotjobLegacyHttpClient = (
  request: HotjobLegacyHttpRequest
) => Promise<HotjobLegacyHttpResponse>;

export interface HotjobLegacySourceFetchDeps {
  http?: HotjobLegacyHttpClient;
  now?: () => Date;
}

interface HotjobLegacyPosition {
  PostId?: unknown;
  PostName?: unknown;
  WorkPlace?: unknown;
}

interface HotjobLegacyResponse {
  data?: {
    rowCount?: unknown;
    details?: unknown;
  };
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 20;

export function createHotjobLegacySourceFetch(
  deps: HotjobLegacySourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.adapterId !== "official-json" || !plan.hotjobLegacy) {
      return failed(capturedAt, `Hotjob legacy source ${plan.source.id} is missing config`);
    }

    try {
      const http = deps.http ?? defaultHttpClient;
      const jobs = [];
      const pageSize = normalizePageSize(plan.hotjobLegacy.pageSize);
      const maxPages = Math.max(1, plan.hotjobLegacy.maxPages ?? DEFAULT_MAX_PAGES);

      for (let page = 1; page <= maxPages; page += 1) {
        const response = await http({
          url: plan.hotjobLegacy.listUrl,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json",
            Referer: plan.source.officialEntryUrl,
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "job-search-crawler/0.1"
          },
          body: new URLSearchParams({
            pageSize: String(pageSize),
            currentPage: String(page)
          }).toString()
        });

        if (response.status < 200 || response.status >= 300) {
          return failed(capturedAt, `Hotjob legacy source returned HTTP ${response.status}`);
        }

        const parsed = parseResponse(response.body);
        jobs.push(
          ...parsed.details.flatMap((job) =>
            normalizePosition(job, {
              entryUrl: plan.source.officialEntryUrl
            })
          )
        );

        if (parsed.details.length === 0 || page * pageSize >= parsed.rowCount) {
          break;
        }
      }

      return {
        ok: true,
        capturedAt,
        payload: { jobs }
      };
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

function parseResponse(body: string): {
  rowCount: number;
  details: HotjobLegacyPosition[];
} {
  const parsed = JSON.parse(body) as HotjobLegacyResponse;
  const rowCount = typeof parsed.data?.rowCount === "number" ? parsed.data.rowCount : 0;
  const details = Array.isArray(parsed.data?.details)
    ? (parsed.data.details as HotjobLegacyPosition[])
    : [];

  return { rowCount, details };
}

function normalizePosition(
  job: HotjobLegacyPosition,
  context: { entryUrl: string }
): Array<{
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
}> {
  const sourceJobId = stringValue(job.PostId);
  const title = stringValue(job.PostName);
  const locationRaw = stringValue(job.WorkPlace);
  if (!sourceJobId || !title || !locationRaw) {
    return [];
  }

  return [
    {
      sourceJobId,
      title,
      officialUrl: `${context.entryUrl}#/position/detail?postId=${sourceJobId}`,
      locationRaw
    }
  ];
}

async function defaultHttpClient(
  request: HotjobLegacyHttpRequest
): Promise<HotjobLegacyHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  return {
    status: response.status,
    body: await response.text()
  };
}

function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(50, Math.max(1, Math.floor(pageSize)));
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
