import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface HotjobWecruitFetchConfig {
  suiteKey: string;
  pageSize?: number;
  maxPages?: number;
}

export interface HotjobWecruitHttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface HotjobWecruitHttpResponse {
  status: number;
  body: string;
}

export type HotjobWecruitHttpClient = (
  request: HotjobWecruitHttpRequest
) => Promise<HotjobWecruitHttpResponse>;

export interface HotjobWecruitSourceFetchDeps {
  http?: HotjobWecruitHttpClient;
  now?: () => Date;
}

interface HotjobWecruitJob {
  postName?: unknown;
  postId?: unknown;
  workPlaceStr?: unknown;
}

interface HotjobWecruitResponse {
  data?: {
    pageForm?: {
      totalPage?: unknown;
      pageData?: unknown;
    };
  };
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_MAX_PAGES = 20;

export function createHotjobWecruitSourceFetch(
  deps: HotjobWecruitSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.source.atsKind !== "HOTJOB_WECRUIT") {
      return failed(capturedAt, "Hotjob Wecruit source fetch only supports HOTJOB_WECRUIT sources");
    }

    if (plan.adapterId !== "official-json" || !plan.hotjob) {
      return failed(capturedAt, `Hotjob Wecruit source ${plan.source.id} is missing Hotjob config`);
    }

    try {
      const http = deps.http ?? defaultHotjobWecruitHttpClient;
      const jobs = [];
      const pageSize = normalizePageSize(plan.hotjob.pageSize);
      const maxPages = Math.max(1, plan.hotjob.maxPages ?? DEFAULT_MAX_PAGES);
      const origin = new URL(plan.source.officialEntryUrl).origin;
      const url = `${origin}/wecruit/positionInfo/listPosition/${plan.hotjob.suiteKey}?iSaJAx=isAjax&request_locale=zh-CN`;

      for (let page = 1; page <= maxPages; page += 1) {
        const response = await http({
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json",
            Origin: origin,
            Referer: plan.source.officialEntryUrl,
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "job-search-crawler/0.1"
          },
          body: new URLSearchParams({
            isFrompb: "true",
            recruitType: "2",
            pageSize: String(pageSize),
            currentPage: String(page)
          }).toString()
        });

        if (response.status < 200 || response.status >= 300) {
          return failed(capturedAt, `Hotjob Wecruit jobs API returned HTTP ${response.status}`);
        }

        const parsed = parseHotjobWecruitResponse(response.body);
        jobs.push(
          ...parsed.pageData.flatMap((job) =>
            enrichHotjobJob(job, {
              origin,
              suiteKey: plan.hotjob!.suiteKey
            })
          )
        );

        if (page >= parsed.totalPage || parsed.pageData.length === 0) {
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

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}

async function defaultHotjobWecruitHttpClient(
  request: HotjobWecruitHttpRequest
): Promise<HotjobWecruitHttpResponse> {
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

function parseHotjobWecruitResponse(body: string): {
  totalPage: number;
  pageData: HotjobWecruitJob[];
} {
  const parsed = JSON.parse(body) as HotjobWecruitResponse;
  const pageForm = parsed.data?.pageForm;
  const totalPage = typeof pageForm?.totalPage === "number" ? pageForm.totalPage : 0;
  const pageData = Array.isArray(pageForm?.pageData)
    ? (pageForm.pageData as HotjobWecruitJob[])
    : [];

  return { totalPage, pageData };
}

function enrichHotjobJob(
  job: HotjobWecruitJob,
  context: { origin: string; suiteKey: string }
): Array<{
  sourceJobId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
}> {
  const title = stringValue(job.postName);
  const postId = stringValue(job.postId);
  const locationRaw = stringValue(job.workPlaceStr);
  if (!title || !postId || !locationRaw) {
    return [];
  }

  return [
    {
      sourceJobId: postId,
      title,
      officialUrl: `${context.origin}/${context.suiteKey}/pb/posDetail.html?postId=${postId}&recruitType=2`,
      locationRaw
    }
  ];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
