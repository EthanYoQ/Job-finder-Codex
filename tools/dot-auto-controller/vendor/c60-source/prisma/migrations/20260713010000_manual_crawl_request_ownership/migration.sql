-- Preserve historical rows while aligning the terminal value with CrawlStatus.SUCCESS.
ALTER TYPE "ManualCrawlStatus" RENAME VALUE 'SUCCEEDED' TO 'SUCCESS';

CREATE TYPE "ManualCrawlEventActor" AS ENUM ('ADMIN', 'SYSTEM');
CREATE TYPE "ManualCrawlEventType" AS ENUM (
  'ENQUEUED', 'CLAIMED', 'LEASE_RECLAIMED', 'HEARTBEAT', 'SUCCEEDED', 'FAILED'
);
CREATE TYPE "ManualCrawlFailureCode" AS ENUM (
  'MANUAL_CRAWL_FAILED', 'SOURCE_CRAWL_FAILED', 'DUPLICATE_ACTIVE_REQUEST'
);

ALTER TABLE "ManualCrawlRequest"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "crawlBatchId" TEXT;

-- Legacy free text is not carried into the new safe enum. Preserve failure truth without secrets.
UPDATE "ManualCrawlRequest"
SET "failureReason" = 'MANUAL_CRAWL_FAILED'
WHERE "failureReason" IS NOT NULL;

-- Pre-ownership RUNNING rows have no trustworthy worker lease; safely return them to the queue.
UPDATE "ManualCrawlRequest" SET "status" = 'QUEUED' WHERE "status" = 'RUNNING';

-- Deterministically retain the oldest active request per source and fail later duplicates.
WITH ranked_active AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "sourceId" ORDER BY "createdAt" ASC, "id" ASC
  ) AS active_rank
  FROM "ManualCrawlRequest"
  WHERE "status" IN ('QUEUED', 'RUNNING')
)
UPDATE "ManualCrawlRequest" AS request
SET "status" = 'FAILED',
    "finishedAt" = COALESCE(request."finishedAt", CURRENT_TIMESTAMP),
    "failureReason" = 'DUPLICATE_ACTIVE_REQUEST'
FROM ranked_active
WHERE request."id" = ranked_active."id" AND ranked_active.active_rank > 1;

ALTER TABLE "ManualCrawlRequest" RENAME COLUMN "failureReason" TO "failureCode";
ALTER TABLE "ManualCrawlRequest"
  ALTER COLUMN "failureCode" TYPE "ManualCrawlFailureCode"
  USING "failureCode"::text::"ManualCrawlFailureCode";

ALTER TABLE "ManualCrawlRequest"
  ADD CONSTRAINT "ManualCrawlRequest_attemptCount_check" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "ManualCrawlRequest_owner_lease_check" CHECK (
    ("ownerId" IS NULL OR btrim("ownerId") <> '')
    AND ("status" <> 'RUNNING' OR (
      "ownerId" IS NOT NULL AND "heartbeatAt" IS NOT NULL AND "leaseExpiresAt" > "heartbeatAt"
    ))
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
  "failureCode" "ManualCrawlFailureCode",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualCrawlRequestEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualCrawlRequestEvent_transition_check" CHECK (
    (
      "actor" = 'ADMIN' AND "eventType" = 'ENQUEUED'
      AND "adminUserId" IS NOT NULL AND "ownerId" IS NULL
      AND "fromStatus" IS NULL AND "toStatus" = 'QUEUED' AND "failureCode" IS NULL
    ) OR (
      "actor" = 'SYSTEM' AND "adminUserId" IS NULL
      AND "ownerId" IS NOT NULL AND btrim("ownerId") <> ''
      AND (
        ("eventType" = 'CLAIMED' AND "fromStatus" = 'QUEUED' AND "toStatus" = 'RUNNING' AND "failureCode" IS NULL)
        OR ("eventType" IN ('LEASE_RECLAIMED', 'HEARTBEAT') AND "fromStatus" = 'RUNNING' AND "toStatus" = 'RUNNING' AND "failureCode" IS NULL)
        OR ("eventType" = 'SUCCEEDED' AND "fromStatus" = 'RUNNING' AND "toStatus" = 'SUCCESS' AND "failureCode" IS NULL)
        OR ("eventType" = 'FAILED' AND "fromStatus" = 'RUNNING' AND "toStatus" = 'FAILED' AND "failureCode" IS NOT NULL)
      )
    )
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
