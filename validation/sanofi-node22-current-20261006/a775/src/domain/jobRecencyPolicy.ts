export const RECENT_JOB_WINDOW_DAYS = 183 as const;
export const SOURCE_NATIVE_HALF_YEAR_WINDOW_DAYS = 180 as const;

export function chinaCalendarDateKey(value: Date): string {
  const chinaTime = new Date(value.getTime() + 8 * 60 * 60 * 1_000);
  return [
    chinaTime.getUTCFullYear(),
    String(chinaTime.getUTCMonth() + 1).padStart(2, "0"),
    String(chinaTime.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function recentJobCutoffChinaDateKey(capturedAt: Date, days = RECENT_JOB_WINDOW_DAYS): string {
  const captureKey = chinaCalendarDateKey(capturedAt);
  const [year, month, day] = captureKey.split("-").map(Number) as [number, number, number];
  return chinaCalendarDateKey(new Date(Date.UTC(year, month - 1, day - days) - 8 * 60 * 60 * 1_000));
}
