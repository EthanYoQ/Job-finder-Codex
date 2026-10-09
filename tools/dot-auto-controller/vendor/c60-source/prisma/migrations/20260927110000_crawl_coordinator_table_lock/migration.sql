-- Crawl coordinator table-based distributed lock.
-- Replaces session-level PostgreSQL advisory locks, which are incompatible with
-- Supavisor transaction-pool mode (each query may hit a different backend session,
-- so pg_try_advisory_lock provides zero mutual exclusion through the pooler).
-- This table works through any pooler mode using standard transactional semantics.
--
-- Lock protocol:
--   Acquire: INSERT ... ON CONFLICT DO NOTHING; if no row inserted, the lock is held.
--   A holder is considered stale if heartbeatAt is older than 5 minutes; a new
--   acquirer may steal it via conditional UPDATE (compare-and-swap on heartbeatAt).
--   Holders must heartbeat at least every 60 seconds while active.
--   Release: DELETE WHERE id = ? AND holderId = ? (only the holder can release).

CREATE TABLE IF NOT EXISTS "CrawlCoordinatorLock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "holderId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "heartbeatAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "metadata" TEXT NULL
);

-- Seed the well-known formal crawl lock row so its existence is guaranteed.
-- The row starts unheld (holderId empty); acquisition uses conditional updates.
INSERT INTO "CrawlCoordinatorLock" ("id", "holderId", "acquiredAt", "heartbeatAt", "metadata")
VALUES ('formal-crawl', '', NOW(), NOW() - INTERVAL '1 hour', 'unheld')
ON CONFLICT ("id") DO NOTHING;
