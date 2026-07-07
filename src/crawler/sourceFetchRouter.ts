import type { SourceFetchFunction } from "./runSourceCrawl";

export interface SourceFetchRouterDeps {
  moka: SourceFetchFunction;
  fallback: SourceFetchFunction;
}

export function createSourceFetchRouter({
  moka,
  fallback
}: SourceFetchRouterDeps): SourceFetchFunction {
  return (plan) => (plan.source.atsKind === "MOKA" ? moka(plan) : fallback(plan));
}
