import { htmlTableAdapter } from "./adapters/htmlTable";
import { officialJsonAdapter } from "./adapters/officialJson";
import type { CrawlAdapterResult } from "./adapters/types";
import type { SourceCrawlPlan } from "./sourcePlan";

export type SourceFetchResult =
  | { ok: true; capturedAt: string; payload: unknown }
  | { ok: true; capturedAt: string; html: string }
  | { ok: false; capturedAt: string; failureReason: string };

export type SourceFetchFunction = (
  plan: SourceCrawlPlan
) => SourceFetchResult | Promise<SourceFetchResult>;

export interface RunSourceCrawlDeps {
  fetch: SourceFetchFunction;
  isBaseline?: boolean;
}

export async function runSourceCrawl(
  plan: SourceCrawlPlan,
  deps: RunSourceCrawlDeps
): Promise<CrawlAdapterResult> {
  const fetchResult = await deps.fetch(plan);

  if (!fetchResult.ok) {
    return failedFetchResult(plan, fetchResult.capturedAt, fetchResult.failureReason);
  }

  const baseInput = {
    company: plan.company,
    source: plan.source,
    capturedAt: fetchResult.capturedAt,
    ...(deps.isBaseline === undefined ? {} : { isBaseline: deps.isBaseline })
  };

  if (plan.adapterId === "official-json") {
    if (!("payload" in fetchResult)) {
      return failedFetchResult(plan, fetchResult.capturedAt, "Expected JSON payload for official-json adapter");
    }

    return officialJsonAdapter.extract({
      ...baseInput,
      payload: fetchResult.payload,
      json: plan.json
    });
  }

  if (!("html" in fetchResult)) {
    return failedFetchResult(plan, fetchResult.capturedAt, "Expected HTML payload for html-table adapter");
  }

  return htmlTableAdapter.extract({
    ...baseInput,
    html: fetchResult.html,
    table: plan.table
  });
}

function failedFetchResult(
  plan: SourceCrawlPlan,
  capturedAt: string,
  failureReason: string
): CrawlAdapterResult {
  return {
    status: "FAILED",
    jobs: [],
    failureReason,
    observation: {
      id: `${plan.source.id}:fetch:${capturedAt}`,
      sourceId: plan.source.id,
      crawledAt: new Date(capturedAt),
      successful: false,
      stableRequiredFields: [],
      structuredJobCount: 0,
      failureReason
    }
  };
}
