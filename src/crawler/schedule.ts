export const P0_CRAWL_WINDOWS = ["00:01"] as const;

export type P0CrawlWindowLabel = (typeof P0_CRAWL_WINDOWS)[number];

export interface P0CrawlWindow {
  label: P0CrawlWindowLabel;
  startsAt: string;
}

export interface SourceScheduleState {
  sourceId: string;
  lastSuccessfulCrawlAt?: string | Date;
  consecutiveFailureCount: number;
}

const CHINA_UTC_OFFSET_HOURS = 8;
const CHINA_UTC_OFFSET_MS = CHINA_UTC_OFFSET_HOURS * 60 * 60 * 1000;
const DAILY_WINDOW_MINUTE = 1;
const EXPLICIT_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

export function nextP0CrawlWindow(now: Date): P0CrawlWindow {
  const chinaDate = chinaDateParts(now);

  if (chinaDate.minuteOfDay < DAILY_WINDOW_MINUTE) {
    return p0WindowForChinaDate(chinaDate, "00:01");
  }
  return p0WindowForChinaDate(chinaDate, "00:01", 1);
}

export function nextP0SchedulerWindow(
  now: Date,
  latestAttemptStartedAt?: Date
): P0CrawlWindow {
  const chinaDate = chinaDateParts(now);
  const nextWindow = nextP0CrawlWindow(now);
  if (chinaDate.minuteOfDay < DAILY_WINDOW_MINUTE) return nextWindow;

  const currentWindow = currentP0CrawlWindow(now);
  const currentWindowStart = timestamp(currentWindow.startsAt);
  const latestAttemptStart = latestAttemptStartedAt?.getTime() ?? Number.NaN;
  return Number.isFinite(latestAttemptStart) && latestAttemptStart >= currentWindowStart
    ? nextWindow
    : currentWindow;
}

export function isSourceDueForScheduledRun(
  sourceState: SourceScheduleState,
  now: Date
): boolean {
  if (sourceState.consecutiveFailureCount >= 3) {
    return true;
  }

  if (!sourceState.lastSuccessfulCrawlAt) {
    return true;
  }

  const lastSuccessfulCrawlTime = timestamp(sourceState.lastSuccessfulCrawlAt);
  if (!Number.isFinite(lastSuccessfulCrawlTime)) {
    return true;
  }

  const currentWindow = currentP0CrawlWindow(now);
  const nextWindow = nextP0CrawlWindow(new Date(currentWindow.startsAt));
  const currentWindowStartTime = timestamp(currentWindow.startsAt);
  const nextWindowStartTime = timestamp(nextWindow.startsAt);

  return !(
    lastSuccessfulCrawlTime >= currentWindowStartTime &&
    lastSuccessfulCrawlTime < nextWindowStartTime
  );
}

function currentP0CrawlWindow(now: Date): P0CrawlWindow {
  const chinaDate = chinaDateParts(now);

  if (chinaDate.minuteOfDay >= DAILY_WINDOW_MINUTE) {
    return p0WindowForChinaDate(chinaDate, "00:01");
  }
  return p0WindowForChinaDate(chinaDate, "00:01", -1);
}

function chinaDateParts(date: Date): {
  year: number;
  monthIndex: number;
  day: number;
  minuteOfDay: number;
} {
  const chinaClockDate = new Date(date.getTime() + CHINA_UTC_OFFSET_MS);

  return {
    year: chinaClockDate.getUTCFullYear(),
    monthIndex: chinaClockDate.getUTCMonth(),
    day: chinaClockDate.getUTCDate(),
    minuteOfDay: chinaClockDate.getUTCHours() * 60 + chinaClockDate.getUTCMinutes()
  };
}

function p0WindowForChinaDate(
  chinaDate: { year: number; monthIndex: number; day: number },
  label: P0CrawlWindowLabel,
  dayOffset = 0
): P0CrawlWindow {
  const utcTime = Date.UTC(
    chinaDate.year,
    chinaDate.monthIndex,
    chinaDate.day + dayOffset,
    -CHINA_UTC_OFFSET_HOURS,
    1,
    0,
    0
  );

  return {
    label,
    startsAt: new Date(utcTime).toISOString()
  };
}

function timestamp(value: string | Date): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  const normalizedValue = value.trim();
  if (!EXPLICIT_TIMEZONE_PATTERN.test(normalizedValue)) {
    return Number.NaN;
  }

  return new Date(normalizedValue).getTime();
}
