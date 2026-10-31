ALTER TABLE "CrawlBatchSourceResult"
ADD COLUMN "completenessCertificate" JSONB,
ADD COLUMN "completenessCertificateSha256" TEXT;
