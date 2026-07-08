import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface HttpHtmlRequest {
  url: string;
  headers: Record<string, string>;
}

export interface HttpHtmlResponse {
  status: number;
  body: string;
}

export type HttpHtmlClient = (request: HttpHtmlRequest) => Promise<HttpHtmlResponse>;

export interface HttpHtmlSourceFetchDeps {
  http?: HttpHtmlClient;
  now?: () => Date;
}

export function createHttpHtmlSourceFetch(
  deps: HttpHtmlSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.adapterId !== "html-table") {
      return failed(capturedAt, "Direct HTML source fetch only supports html-table plans");
    }

    try {
      const http = deps.http ?? defaultHttpHtmlClient;
      const response = await http({
        url: plan.source.officialEntryUrl,
        headers: { "User-Agent": "job-search-crawler/0.1" }
      });

      if (response.status < 200 || response.status >= 300) {
        return failed(capturedAt, `Direct HTML source returned HTTP ${response.status}`);
      }

      if (!response.body.trim()) {
        return failed(capturedAt, "Direct HTML source returned empty content");
      }

      return {
        ok: true,
        capturedAt,
        html: response.body
      };
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

async function defaultHttpHtmlClient(request: HttpHtmlRequest): Promise<HttpHtmlResponse> {
  const response = await fetch(request.url, {
    headers: request.headers,
    redirect: "follow"
  });

  return {
    status: response.status,
    body: await response.text()
  };
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}
