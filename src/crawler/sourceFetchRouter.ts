import type { SourceFetchFunction } from "./runSourceCrawl";

export interface SourceFetchRouterDeps {
  moka: SourceFetchFunction;
  html?: SourceFetchFunction;
  officialJson?: SourceFetchFunction;
  workday?: SourceFetchFunction;
  hotjob?: SourceFetchFunction;
  hotjobLegacy?: SourceFetchFunction;
  profileBoundSource?: SourceFetchFunction;
  fallback: SourceFetchFunction;
}

export function createSourceFetchRouter({
  moka,
  html,
  officialJson,
  workday,
  hotjob,
  hotjobLegacy,
  profileBoundSource,
  fallback
}: SourceFetchRouterDeps): SourceFetchFunction {
  return (plan) => {
    if (plan.source.atsKind === "MOKA") {
      return moka(plan);
    }

    if (plan.source.atsKind === "WORKDAY" && workday) {
      return workday(plan);
    }

    if ("hotjobLegacy" in plan && plan.hotjobLegacy && hotjobLegacy) {
      return hotjobLegacy(plan);
    }

    if ("profileBoundSource" in plan && plan.profileBoundSource && profileBoundSource) {
      return profileBoundSource(plan);
    }

    if (plan.source.atsKind === "HOTJOB_WECRUIT" && hotjob) {
      return hotjob(plan);
    }

    if (
      plan.adapterId === "official-json" &&
      "officialJsonFetch" in plan &&
      plan.officialJsonFetch &&
      officialJson
    ) {
      return officialJson(plan);
    }

    if (plan.adapterId === "html-table" && html) {
      return html(plan);
    }

    return fallback(plan);
  };
}
