-- Preserve historical rows while aligning the terminal value with CrawlStatus.SUCCESS.
ALTER TYPE "ManualCrawlStatus" RENAME VALUE 'SUCCEEDED' TO 'SUCCESS';

CREATE TYPE "ManualCrawlEventActor" AS ENUM ('ADMIN', 'SYSTEM');
CREATE TYPE "ManualCrawlEventType" AS ENUM (
  'ENQUEUED', 'CLAIMED', 'LEASE_RECLAIMED', 'HEARTBEAT', 'SUCCEEDED', 'FAILED'
);

ALTER TABLE "ManualCrawlRequest"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "crawlBatchId" TEXT;

ALTER TABLE "ManualCrawlRequest" RENAME COLUMN "failureReason" TO "failureCode";

ALTER TABLE "ManualCrawlRequest"
  ADD CONSTRAINT "ManualCrawlRequest_attemptCount_check" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "ManualCrawlRequest_failureCode_check" CHECK (
    "failureCode" IS NULL OR "failureCode" ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  ADD CONSTRAINT "ManualCrawlRequest_crawlBatchId_fkey"
    FOREIGN KEY ("crawlBatchId") REFERENCES "CrawlBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ManualCrawlRequest_ownerId_leaseExpiresAt_idx"
  ON "ManualCrawlRequest"("ownerId", "leaseExpiresAt");
CREATE INDEX "ManualCrawlRequest_crawlBatchId_idx" ON "ManualCrawlRequest"("crawlBatchId");
CREATE UNIQUE INDEX "ManualCrawlRequest_one_active_per_source"
  ON "ManualCrawlRequest"("sourceId") WHERE "status" IN ('QUEUED', 'RUNNING');

CREATE TABLE "ManualCrawlRequestEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "eventType" "ManualCrawlEventType" NOT NULL,
  "actor" "ManualCrawlEventActor" NOT NULL,
  "adminUserId" TEXT,
  "ownerId" TEXT,
  "fromStatus" "ManualCrawlStatus",
  "toStatus" "ManualCrawlStatus" NOT NULL,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualCrawlRequestEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualCrawlRequestEvent_actor_check" CHECK (
    ("actor" = 'ADMIN' AND "adminUserId" IS NOT NULL AND "ownerId" IS NULL)
    OR ("actor" = 'SYSTEM' AND "adminUserId" IS NULL AND "ownerId" IS NOT NULL)
  ),
  CONSTRAINT "ManualCrawlRequestEvent_failureCode_check" CHECK (
    "failureCode" IS NULL OR "failureCode" ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  CONSTRAINT "ManualCrawlRequestEvent_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "ManualCrawlRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManualCrawlRequestEvent_adminUserId_fkey"
    FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ManualCrawlRequestEvent_requestId_createdAt_idx"
  ON "ManualCrawlRequestEvent"("requestId", "createdAt");
CREATE INDEX "ManualCrawlRequestEvent_adminUserId_createdAt_idx"
  ON "ManualCrawlRequestEvent"("adminUserId", "createdAt");

CREATE FUNCTION prevent_manual_crawl_request_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ManualCrawlRequestEvent rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ManualCrawlRequestEvent_append_only"
BEFORE UPDATE OR DELETE ON "ManualCrawlRequestEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_manual_crawl_request_event_mutation();
