-- PostgreSQL requires newly added enum values to commit before a later migration can use them.
ALTER TYPE "CrawlStatus" ADD VALUE 'RUNNING' BEFORE 'SUCCESS';
ALTER TYPE "CrawlStatus" ADD VALUE 'INCOMPLETE' BEFORE 'SUCCESS';
ALTER TYPE "CrawlStatus" ADD VALUE 'ABORTED' BEFORE 'SUCCESS';
