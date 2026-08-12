export const P0_CRAWL_WINDOWS = ["00:01", "12:01"] as const;
export type P0CrawlWindowLabel = (typeof P0_CRAWL_WINDOWS)[number];
export interface P0CrawlWindow { label: P0CrawlWindowLabel; startsAt: string; }
export interface SourceScheduleState { sourceId: string; lastSuccessfulCrawlAt?: string | Date; consecutiveFailureCount: number; }

const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const WINDOW_MINUTES = [1, 12 * 60 + 1] as const;
const EXPLICIT_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

export function nextP0CrawlWindow(now: Date): P0CrawlWindow {
  const china = chinaDateParts(now);
  const next = WINDOW_MINUTES.find((minute) => china.minuteOfDay < minute);
  return next === undefined ? windowFor(china, 1, 1) : windowFor(china, next);
}

export function nextP0SchedulerWindow(now: Date, latestAttemptStartedAt?: Date): P0CrawlWindow {
  const china = chinaDateParts(now);
  if (china.minuteOfDay < WINDOW_MINUTES[0]) return windowFor(china, WINDOW_MINUTES[0]);
  const currentMinute = [...WINDOW_MINUTES].reverse().find((minute) => china.minuteOfDay >= minute)!;
  const current = windowFor(china, currentMinute);
  const attempted = latestAttemptStartedAt?.getTime() ?? Number.NaN;
  return Number.isFinite(attempted) && attempted >= timestamp(current.startsAt)
    ? nextP0CrawlWindow(now)
    : current;
}

export function isSourceDueForScheduledRun(source: SourceScheduleState, now: Date): boolean {
  if (source.consecutiveFailureCount >= 3 || !source.lastSuccessfulCrawlAt) return true;
  const last = timestamp(source.lastSuccessfulCrawlAt);
  if (!Number.isFinite(last)) return true;
  const current = currentP0CrawlWindow(now);
  const next = nextP0CrawlWindow(new Date(current.startsAt));
  return !(last >= timestamp(current.startsAt) && last < timestamp(next.startsAt));
}

function currentP0CrawlWindow(now: Date): P0CrawlWindow {
  const china = chinaDateParts(now);
  const current = [...WINDOW_MINUTES].reverse().find((minute) => china.minuteOfDay >= minute);
  return current === undefined ? windowFor(china, WINDOW_MINUTES[1], -1) : windowFor(china, current);
}

function chinaDateParts(date: Date) {
  const clock = new Date(date.getTime() + CHINA_UTC_OFFSET_MS);
  return { year: clock.getUTCFullYear(), monthIndex: clock.getUTCMonth(), day: clock.getUTCDate(),
    minuteOfDay: clock.getUTCHours() * 60 + clock.getUTCMinutes() };
}

function windowFor(china: { year: number; monthIndex: number; day: number }, minute: number, dayOffset = 0): P0CrawlWindow {
  const hour = Math.floor(minute / 60), minuteWithinHour = minute % 60;
  const utc = Date.UTC(china.year, china.monthIndex, china.day + dayOffset, hour - 8, minuteWithinHour);
  return { label: `${String(hour).padStart(2, "0")}:${String(minuteWithinHour).padStart(2, "0")}` as P0CrawlWindowLabel,
    startsAt: new Date(utc).toISOString() };
}

function timestamp(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  const normalized = value.trim();
  return EXPLICIT_TIMEZONE_PATTERN.test(normalized) ? new Date(normalized).getTime() : Number.NaN;
}
