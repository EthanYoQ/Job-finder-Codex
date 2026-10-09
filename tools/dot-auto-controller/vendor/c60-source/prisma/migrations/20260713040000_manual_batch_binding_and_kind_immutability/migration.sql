ALTER TABLE "CrawlBatch" ADD COLUMN "manualCrawlRequestId" TEXT;

DO $$
DECLARE invalid_batch_count BIGINT;
BEGIN
  SELECT count(*) INTO invalid_batch_count
  FROM (
    SELECT batch."id"
    FROM "CrawlBatch" AS batch
    LEFT JOIN "ManualCrawlRequest" AS request ON request."crawlBatchId" = batch."id"
    WHERE batch."kind" = 'MANUAL_SOURCE'
    GROUP BY batch."id"
    HAVING count(request."id") <> 1
  ) AS candidate;
  IF invalid_batch_count <> 0 THEN
    RAISE EXCEPTION 'MANUAL_BATCH_BACKFILL_INVALID_COUNT:%', invalid_batch_count;
  END IF;
END $$;

UPDATE "CrawlBatch" AS batch
SET "manualCrawlRequestId" = request."id"
FROM "ManualCrawlRequest" AS request
WHERE batch."kind" = 'MANUAL_SOURCE' AND request."crawlBatchId" = batch."id";

ALTER TABLE "CrawlBatch" ADD CONSTRAINT "CrawlBatch_manual_binding_check" CHECK (
  (("kind" = 'MANUAL_SOURCE' AND "manualCrawlRequestId" IS NOT NULL)
    OR ("kind" IS DISTINCT FROM 'MANUAL_SOURCE' AND "manualCrawlRequestId" IS NULL))
);
ALTER TABLE "CrawlBatch" ADD CONSTRAINT "CrawlBatch_manualCrawlRequestId_fkey"
  FOREIGN KEY ("manualCrawlRequestId") REFERENCES "ManualCrawlRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD."kind" IS DISTINCT FROM NEW."kind"
     OR OLD."manualCrawlRequestId" IS DISTINCT FROM NEW."manualCrawlRequestId"
     OR (OLD."kind" = 'MANUAL_SOURCE' AND OLD."ownerId" IS DISTINCT FROM NEW."ownerId") THEN
    RAISE EXCEPTION 'crawl batch kind, manual request binding, and manual owner are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CrawlBatch_kind_and_manual_binding_immutable"
BEFORE UPDATE OF "kind", "manualCrawlRequestId", "ownerId" ON "CrawlBatch"
FOR EACH ROW EXECUTE FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation();

ALTER FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION prevent_manual_crawl_request_source_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD."sourceId" IS DISTINCT FROM NEW."sourceId" THEN
    RAISE EXCEPTION 'manual crawl request source is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ManualCrawlRequest_source_immutable"
BEFORE UPDATE OF "sourceId" ON "ManualCrawlRequest"
FOR EACH ROW EXECUTE FUNCTION prevent_manual_crawl_request_source_mutation();

ALTER FUNCTION prevent_manual_crawl_request_source_mutation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION prevent_manual_crawl_request_source_mutation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION guard_crawl_batch_source_result_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  parent_status public."CrawlStatus";
  parent_planned JSONB;
BEGIN
  SELECT batch."status", batch."plannedSourceIds"
  INTO parent_status, parent_planned
  FROM public."CrawlBatch" AS batch
  WHERE batch."id" = NEW."batchId"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'source result parent batch does not exist';
  END IF;
  IF parent_status <> 'RUNNING' THEN
    RAISE EXCEPTION 'source result parent batch is terminal';
  END IF;
  IF parent_planned IS NULL OR NOT (parent_planned @> pg_catalog.jsonb_build_array(NEW."sourceId")) THEN
    RAISE EXCEPTION 'source result source is outside the parent planned set';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CrawlBatchSourceResult_parent_insert_guard"
BEFORE INSERT ON "CrawlBatchSourceResult"
FOR EACH ROW EXECUTE FUNCTION guard_crawl_batch_source_result_insert();

ALTER FUNCTION guard_crawl_batch_source_result_insert() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION guard_crawl_batch_source_result_insert() FROM PUBLIC;
