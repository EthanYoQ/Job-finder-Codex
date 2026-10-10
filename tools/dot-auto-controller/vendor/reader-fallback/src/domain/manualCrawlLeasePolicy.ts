export const MANUAL_CRAWL_DEFAULT_LEASE_DURATION_MS = 5 * 60_000;
export const MANUAL_CRAWL_HEARTBEAT_INTERVAL_MS = 60_000;

// The 15-minute ceiling is three times the 5-minute default while remaining a bounded operational lease.
export const MANUAL_CRAWL_MAX_LEASE_DURATION_MS = 15 * 60_000;

export function isValidManualCrawlLeaseDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MANUAL_CRAWL_MAX_LEASE_DURATION_MS;
}
