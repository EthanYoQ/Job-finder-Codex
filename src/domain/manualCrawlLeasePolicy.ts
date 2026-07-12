export const MANUAL_CRAWL_DEFAULT_LEASE_DURATION_MS = 5 * 60_000;
export const MANUAL_CRAWL_HEARTBEAT_INTERVAL_MS = 60_000;

// Three missed heartbeats are enough to tolerate transient DB latency without allowing an unbounded lease.
export const MANUAL_CRAWL_MAX_LEASE_DURATION_MS = 15 * 60_000;

export function isValidManualCrawlLeaseDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MANUAL_CRAWL_MAX_LEASE_DURATION_MS;
}
