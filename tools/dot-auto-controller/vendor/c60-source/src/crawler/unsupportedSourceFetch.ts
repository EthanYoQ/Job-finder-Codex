import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface UnsupportedSourceFetchDeps {
  now?: () => Date;
}

export function createUnsupportedSourceFetch(
  deps: UnsupportedSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    return failed(
      capturedAt,
      `Formal readiness crawl is not configured for ${plan.source.atsKind} source ${plan.source.id}`
    );
  };
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}
