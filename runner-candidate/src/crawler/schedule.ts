const CHINA_UTC_OFFSET_HOURS = 8;
const P0_CRAWL_WINDOW_DEFINITIONS = Object.freeze([
  { label: "00:01", minuteOfDay: 1 }
] as const);
export const P0_CRAWL_WINDOWS: readonly P0CrawlWindowLabel[] = Object.freeze(
  P0_CRAWL_WINDOW_DEFINITIONS.map(({ label }) => label)
);
export type P0CrawlWindowLabel = (typeof P0_CRAWL_WINDOW_DEFINITIONS)[number]["label"];
export interface P0CrawlWindow { label: P0CrawlWindowLabel; startsAt: string; }
export interface SourceScheduleState { sourceId: string; lastSuccessfulCrawlAt?: string | Date; consecutiveFailureCount: number; }

const CHINA_UTC_OFFSET_MS = CHINA_UTC_OFFSET_HOURS * 60 * 60 * 1000;
const EXPLICIT_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

export function nextP0CrawlWindow(now: Date): P0CrawlWindow {
  const china = chinaDateParts(now);
  const next = P0_CRAWL_WINDOW_DEFINITIONS.find(({ minuteOfDay }) => china.minuteOfDay < minuteOfDay);
  return next === undefined ? windowFor(china, P0_CRAWL_WINDOW_DEFINITIONS[0], 1) : windowFor(china, next);
}

export function nextP0SchedulerWindow(now: Date, latestAttemptStartedAt?: Date): P0CrawlWindow {
  const china = chinaDateParts(now);
  if (china.minuteOfDay < P0_CRAWL_WINDOW_DEFINITIONS[0].minuteOfDay) return windowFor(china, P0_CRAWL_WINDOW_DEFINITIONS[0]);
  const currentDefinition = [...P0_CRAWL_WINDOW_DEFINITIONS].reverse()
    .find(({ minuteOfDay }) => china.minuteOfDay >= minuteOfDay)!;
  const current = windowFor(china, currentDefinition);
  const attempted = latestAttemptStartedAt?.getTime() ?? Number.NaN;
  return Number.isFinite(attempted) && attempted >= timestamp(current.startsAt)
    ? nextP0CrawlWindow(now)
    : current;
}

export function isSourceDueForScheduledRun(source: SourceScheduleState, now: Date): boolean {
  if (!source.lastSuccessfulCrawlAt) return true;
  const last = timestamp(source.lastSuccessfulCrawlAt);
  if (!Number.isFinite(last)) return true;
  const current = currentP0CrawlWindow(now);
  const next = nextP0CrawlWindow(new Date(current.startsAt));
  return !(last >= timestamp(current.startsAt) && last < timestamp(next.startsAt));
}

function currentP0CrawlWindow(now: Date): P0CrawlWindow {
  const china = chinaDateParts(now);
  const current = [...P0_CRAWL_WINDOW_DEFINITIONS].reverse()
    .find(({ minuteOfDay }) => china.minuteOfDay >= minuteOfDay);
  return current === undefined ? windowFor(china, P0_CRAWL_WINDOW_DEFINITIONS.at(-1)!, -1) : windowFor(china, current);
}

function chinaDateParts(date: Date) {
  const clock = new Date(date.getTime() + CHINA_UTC_OFFSET_MS);
  return { year: clock.getUTCFullYear(), monthIndex: clock.getUTCMonth(), day: clock.getUTCDate(),
    minuteOfDay: clock.getUTCHours() * 60 + clock.getUTCMinutes() };
}

function windowFor(
  china: { year: number; monthIndex: number; day: number },
  definition: (typeof P0_CRAWL_WINDOW_DEFINITIONS)[number],
  dayOffset = 0
): P0CrawlWindow {
  const hour = Math.floor(definition.minuteOfDay / 60), minuteWithinHour = definition.minuteOfDay % 60;
  const utc = Date.UTC(china.year, china.monthIndex, china.day + dayOffset,
    hour - CHINA_UTC_OFFSET_HOURS, minuteWithinHour);
  return { label: definition.label, startsAt: new Date(utc).toISOString() };
}

function timestamp(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  const normalized = value.trim();
  return EXPLICIT_TIMEZONE_PATTERN.test(normalized) ? new Date(normalized).getTime() : Number.NaN;
}
