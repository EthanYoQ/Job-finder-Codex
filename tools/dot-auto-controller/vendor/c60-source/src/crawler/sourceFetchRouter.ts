import {
  createSourceFetchAttemptTracker,
  markInitialSourceFetchAttempt,
  markSourceFetchRetry,
  type SourceFetchFunction
} from "./runSourceCrawl";
import {
  currentOfficialSourceAttemptRemainingMs,
  currentOfficialSourceAttemptSignal
} from "./officialHttpRuntimeLimits";
import { isRetryableSourceTransportFailure } from "./sourceFetchFailure";

export interface SourceFetchRouterDeps {
  moka: SourceFetchFunction;
  html?: SourceFetchFunction;
  officialJson?: SourceFetchFunction;
  workday?: SourceFetchFunction;
  hotjob?: SourceFetchFunction;
  hotjobLegacy?: SourceFetchFunction;
  profileBoundSource?: SourceFetchFunction;
  fallback: SourceFetchFunction;
  delay?: (milliseconds: number) => Promise<void>;
}

export function createSourceFetchRouter({
  moka,
  html,
  officialJson,
  workday,
  hotjob,
  hotjobLegacy,
  profileBoundSource,
  fallback,
  delay = defaultDelay
}: SourceFetchRouterDeps): SourceFetchFunction {
  return async (plan, suppliedAttemptTracker) => {
    const attemptTracker = suppliedAttemptTracker ?? createSourceFetchAttemptTracker();
    markInitialSourceFetchAttempt(attemptTracker);
    const delegate = routeSourceFetcher(plan, {
      moka,
      ...(html ? { html } : {}),
      ...(officialJson ? { officialJson } : {}),
      ...(workday ? { workday } : {}),
      ...(hotjob ? { hotjob } : {}),
      ...(hotjobLegacy ? { hotjobLegacy } : {}),
      ...(profileBoundSource ? { profileBoundSource } : {}),
      fallback
    });
    let result = await delegate(plan);
    const policy = plan.transientRetryPolicy;
    if (!policy) return result;
    if (![1, 2].includes(policy.maxRetries) || !Number.isSafeInteger(policy.backoffMs) ||
      policy.backoffMs < 1_000 || policy.backoffMs > 60_000) {
      throw new Error("Transient retry policy must allow one or two retries after 1000 through 60000 milliseconds");
    }
    for (let retry = 0; retry < policy.maxRetries; retry += 1) {
      if (result.ok || result.sourceRetryExhausted || !isRetryableSourceTransportFailure(result.transportFailure)) return result;
      const retryAfterMs = result.transportFailure.retryAfterMs;
      if (retryAfterMs !== undefined &&
        (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > policy.backoffMs)) return result;
      const signal = currentOfficialSourceAttemptSignal();
      if (signal?.aborted) return result;
      const remainingBeforeDelay = currentOfficialSourceAttemptRemainingMs();
      if (remainingBeforeDelay !== undefined &&
        (!Number.isFinite(remainingBeforeDelay) || remainingBeforeDelay <= policy.backoffMs)) return result;
      await delay(policy.backoffMs);
      if (signal?.aborted) return result;
      const remainingBeforeRetry = currentOfficialSourceAttemptRemainingMs();
      if (remainingBeforeRetry !== undefined &&
        (!Number.isFinite(remainingBeforeRetry) || remainingBeforeRetry <= 0)) return result;
      markSourceFetchRetry(attemptTracker, result.transportFailure.code);
      result = await delegate(plan);
    }
    return result;
  };
}

function routeSourceFetcher(
  plan: Parameters<SourceFetchFunction>[0],
  {
    moka,
    html,
    officialJson,
    workday,
    hotjob,
    hotjobLegacy,
    profileBoundSource,
    fallback
  }: Omit<SourceFetchRouterDeps, "delay">
): SourceFetchFunction {
    if (plan.source.atsKind === "MOKA") {
      return moka;
    }

    if (plan.source.atsKind === "WORKDAY" && workday) {
      return workday;
    }

    if ("hotjobLegacy" in plan && plan.hotjobLegacy && hotjobLegacy) {
      return hotjobLegacy;
    }

    if ("profileBoundSource" in plan && plan.profileBoundSource && profileBoundSource) {
      return profileBoundSource;
    }

    if (plan.source.atsKind === "HOTJOB_WECRUIT" && hotjob) {
      return hotjob;
    }

    if (
      plan.adapterId === "official-json" &&
      "officialJsonFetch" in plan &&
      plan.officialJsonFetch &&
      officialJson
    ) {
      return officialJson;
    }

    if (plan.adapterId === "html-table" && html) {
      return html;
    }

    return fallback;
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
