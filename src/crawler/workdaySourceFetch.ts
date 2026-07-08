import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface WorkdayFetchConfig {
  tenant: string;
  site: string;
  searchText?: string;
  appliedFacets?: Record<string, readonly string[]>;
  pageSize?: number;
  maxPages?: number;
  cityHints?: Record<string, readonly string[]>;
}

export interface WorkdayHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface WorkdayHttpResponse {
  status: number;
  body: string;
}

export type WorkdayHttpClient = (request: WorkdayHttpRequest) => Promise<WorkdayHttpResponse>;

export interface WorkdaySourceFetchDeps {
  http?: WorkdayHttpClient;
  now?: () => Date;
}

interface WorkdayJobPosting {
  title?: unknown;
  externalPath?: unknown;
  locationsText?: unknown;
  bulletFields?: unknown;
}

interface WorkdayJobsResponse {
  total?: unknown;
  jobPostings?: unknown;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 20;

const CITY_MATCHES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"],
  ["Beijing", "北京"],
  ["Suzhou", "苏州"],
  ["Guangzhou", "广州"],
  ["Shenzhen", "深圳"],
  ["Hangzhou", "杭州"],
  ["Nanjing", "南京"],
  ["Wuhan", "武汉"],
  ["Chengdu", "成都"],
  ["Tianjin", "天津"],
  ["Zhengzhou", "郑州"],
  ["Shenyang", "沈阳"],
  ["Huhehaote", "呼和浩特"],
  ["Hohhot", "呼和浩特"]
];

export function createWorkdaySourceFetch(deps: WorkdaySourceFetchDeps = {}): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.source.atsKind !== "WORKDAY") {
      return failed(capturedAt, "Workday source fetch only supports WORKDAY sources");
    }

    if (plan.adapterId !== "official-json" || !plan.workday) {
      return failed(capturedAt, `Workday source ${plan.source.id} is missing Workday config`);
    }

    try {
      const http = deps.http ?? defaultWorkdayHttpClient;
      const jobs = [];
      const pageSize = normalizePageSize(plan.workday.pageSize);
      const maxPages = Math.max(1, plan.workday.maxPages ?? DEFAULT_MAX_PAGES);
      const url = workdayJobsUrl(plan.source.officialEntryUrl, plan.workday);
      const origin = new URL(plan.source.officialEntryUrl).origin;
      const sitePath = normalizedSitePath(plan.source.officialEntryUrl);

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        const offset = pageIndex * pageSize;
        const response = await http({
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Origin: origin,
            Referer: plan.source.officialEntryUrl,
            "User-Agent": "job-search-crawler/0.1"
          },
          body: JSON.stringify({
            appliedFacets: plan.workday.appliedFacets ?? {},
            ...(plan.workday.searchText ? { searchText: plan.workday.searchText } : {}),
            limit: pageSize,
            offset
          })
        });

        if (response.status < 200 || response.status >= 300) {
          return failed(capturedAt, `Workday jobs API returned HTTP ${response.status}`);
        }

        const parsed = parseWorkdayJobsResponse(response.body);
        const pageJobs = parsed.jobPostings.flatMap((job) =>
          enrichWorkdayJob(job, {
            origin,
            sitePath,
            ...(plan.workday?.cityHints ? { cityHints: plan.workday.cityHints } : {})
          })
        );

        jobs.push(...pageJobs);

        if (pageJobs.length === 0 || jobs.length >= parsed.total) {
          break;
        }
      }

      return {
        ok: true,
        capturedAt,
        payload: { jobPostings: jobs }
      };
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}

async function defaultWorkdayHttpClient(
  request: WorkdayHttpRequest
): Promise<WorkdayHttpResponse> {
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

function workdayJobsUrl(entryUrl: string, config: WorkdayFetchConfig): string {
  const origin = new URL(entryUrl).origin;
  return `${origin}/wday/cxs/${config.tenant}/${config.site}/jobs`;
}

function normalizedSitePath(entryUrl: string): string {
  const pathname = new URL(entryUrl).pathname.replace(/\/+$/, "");
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function normalizePageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(20, Math.max(1, Math.floor(pageSize)));
}

function parseWorkdayJobsResponse(body: string): {
  total: number;
  jobPostings: WorkdayJobPosting[];
} {
  const parsed = JSON.parse(body) as WorkdayJobsResponse;
  const total = typeof parsed.total === "number" ? parsed.total : 0;
  const jobPostings = Array.isArray(parsed.jobPostings)
    ? (parsed.jobPostings as WorkdayJobPosting[])
    : [];

  return { total, jobPostings };
}

function enrichWorkdayJob(
  job: WorkdayJobPosting,
  context: {
    origin: string;
    sitePath: string;
    cityHints?: Record<string, readonly string[]>;
  }
): Array<{
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  cities: string[];
}> {
  const title = stringValue(job.title);
  const externalPath = stringValue(job.externalPath);
  const locationRaw = stringValue(job.locationsText);
  if (!title || !externalPath || !locationRaw) {
    return [];
  }

  return [
    {
      sourceJobId: sourceJobId(job, externalPath),
      title,
      officialUrl: `${context.origin}${context.sitePath}${externalPath}`,
      locationRaw,
      cities: citiesFromWorkdayLocation(locationRaw, context.cityHints)
    }
  ];
}

function sourceJobId(job: WorkdayJobPosting, externalPath: string): string {
  if (Array.isArray(job.bulletFields)) {
    const firstString = job.bulletFields.find((field): field is string => typeof field === "string");
    if (firstString) {
      return firstString;
    }
  }

  return externalPath;
}

function citiesFromWorkdayLocation(
  locationRaw: string,
  cityHints: Record<string, readonly string[]> | undefined
): string[] {
  const lowerLocation = locationRaw.toLowerCase();
  const hinted = Object.entries(cityHints ?? {}).flatMap(([hint, cities]) =>
    lowerLocation.includes(hint.toLowerCase()) ? cities : []
  );
  const mapped = CITY_MATCHES.flatMap(([needle, city]) =>
    lowerLocation.includes(needle.toLowerCase()) ? [city] : []
  );

  return [...new Set([...hinted, ...mapped])];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
