/** Current official-surface audit findings. These holds are deliberately separate
 * from immutable accepted history and from the historical 41-company manifest. */
export const SOURCE_COVERAGE_REVIEW_PENDING = "SOURCE_COVERAGE_REVIEW_PENDING" as const;

export interface TemporarySourcePause {
  readonly pausedFromIso: string;
  readonly pausedUntilIso: string;
  readonly reason: string;
}

export const TEMPORARY_SOURCE_PAUSES: Readonly<Record<string, TemporarySourcePause>> = Object.freeze({
  "source-biogen-china-social": {
    pausedFromIso: "2026-11-22T00:01:00+08:00",
    pausedUntilIso: "2026-11-29T00:01:00+08:00",
    reason: "Upstream Cloudflare challenge on biibhr.wd3.myworkdayjobs.com; paused for 1 week by user authorization"
  }
});

/** Return whether a source is inside an authorized temporary pause window. */
export function isSourceTemporarilyPaused(sourceId: string, nowMs = Date.now()): boolean {
  const entry = Object.hasOwn(TEMPORARY_SOURCE_PAUSES, sourceId) ? TEMPORARY_SOURCE_PAUSES[sourceId] : undefined;
  if (!entry) return false;
  const fromMs = Date.parse(entry.pausedFromIso);
  const untilMs = Date.parse(entry.pausedUntilIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs)) {
    throw new Error(`INVALID_TEMPORARY_SOURCE_PAUSE:${sourceId}`);
  }
  return Number.isFinite(nowMs) && nowMs >= fromMs && nowMs < untilMs;
}

export function getPortableSourceCoverageHold(
  sourceId: string,
  nowMs = Date.now()
): typeof SOURCE_COVERAGE_REVIEW_PENDING | null {
  return isSourceTemporarilyPaused(sourceId, nowMs) ? SOURCE_COVERAGE_REVIEW_PENDING : null;
}
