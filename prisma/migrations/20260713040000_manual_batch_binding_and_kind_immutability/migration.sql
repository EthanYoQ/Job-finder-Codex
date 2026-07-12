ALTER TABLE "CrawlBatch" ADD COLUMN "manualCrawlRequestId" TEXT;

UPDATE "CrawlBatch" AS batch
SET "manualCrawlRequestId" = request."id"
FROM "ManualCrawlRequest" AS request
WHERE batch."kind" = 'MANUAL_SOURCE' AND request."crawlBatchId" = batch."id";

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "CrawlBatch"
    WHERE "kind" = 'MANUAL_SOURCE' AND "manualCrawlRequestId" IS NULL
  ) THEN
    RAISE EXCEPTION 'existing MANUAL_SOURCE batch lacks exact manual request binding';
  END IF;
END $$;

ALTER TABLE "CrawlBatch" ADD CONSTRAINT "CrawlBatch_manual_binding_check" CHECK (
  ("kind" = 'MANUAL_SOURCE') = ("manualCrawlRequestId" IS NOT NULL)
);
ALTER TABLE "CrawlBatch" ADD CONSTRAINT "CrawlBatch_manualCrawlRequestId_fkey"
  FOREIGN KEY ("manualCrawlRequestId") REFERENCES "ManualCrawlRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD."kind" IS DISTINCT FROM NEW."kind"
     OR OLD."manualCrawlRequestId" IS DISTINCT FROM NEW."manualCrawlRequestId" THEN
    RAISE EXCEPTION 'crawl batch kind and manual request binding are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CrawlBatch_kind_and_manual_binding_immutable"
BEFORE UPDATE OF "kind", "manualCrawlRequestId" ON "CrawlBatch"
FOR EACH ROW EXECUTE FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation();

ALTER FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation() OWNER TO CURRENT_USER;
REVOKE ALL ON FUNCTION prevent_crawl_batch_kind_or_manual_binding_mutation() FROM PUBLIC;
