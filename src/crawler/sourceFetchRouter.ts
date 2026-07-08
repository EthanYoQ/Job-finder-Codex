import type { SourceFetchFunction } from "./runSourceCrawl";

export interface SourceFetchRouterDeps {
  moka: SourceFetchFunction;
  html?: SourceFetchFunction;
  fallback: SourceFetchFunction;
}

export function createSourceFetchRouter({
  moka,
  html,
  fallback
}: SourceFetchRouterDeps): SourceFetchFunction {
  return (plan) => {
    if (plan.source.atsKind === "MOKA") {
      return moka(plan);
    }

    if (plan.adapterId === "html-table" && html) {
      return html(plan);
    }

    return fallback(plan);
  };
}
