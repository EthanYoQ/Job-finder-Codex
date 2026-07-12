import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(resolve(
  process.cwd(), "prisma", "migrations", "20260713010000_manual_crawl_request_ownership", "migration.sql"
), "utf8");
const previewIsolationMigration = readFileSync(resolve(
  process.cwd(), "prisma", "migrations", "20260713030000_manual_crawl_preview_isolation", "migration.sql"
), "utf8");

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name}\\s+\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing Prisma model ${name}`);
  return match[1]!;
}

describe("manual crawl persistence contract", () => {
  it("renames the historical success enum value without recreating or deleting it", () => {
    expect(schema.match(/enum ManualCrawlStatus\s+\{([\s\S]*?)\n\}/)?.[1]).toContain("SUCCESS");
    expect(schema.match(/enum ManualCrawlStatus\s+\{([\s\S]*?)\n\}/)?.[1]).not.toContain("SUCCEEDED");
    expect(migration).toContain("ALTER TYPE \"ManualCrawlStatus\" RENAME VALUE 'SUCCEEDED' TO 'SUCCESS'");
    expect(migration).not.toMatch(/DROP TYPE\s+"ManualCrawlStatus"/);
  });

  it("models worker ownership, leases, attempts and the manual crawl batch", () => {
    const request = model("ManualCrawlRequest");
    for (const field of ["ownerId", "heartbeatAt", "leaseExpiresAt", "attemptCount", "crawlBatchId"]) {
      expect(request).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    expect(request).toMatch(/^\s*crawlBatch\s+CrawlBatch\?/m);
    expect(model("CrawlBatch")).toMatch(/^\s*manualCrawlRequests\s+ManualCrawlRequest\[\]/m);
    expect(migration).toContain("ManualCrawlRequest_crawlBatchId_fkey");
  });

  it("enforces one active request per source and append-only transition events", () => {
    expect(migration).toContain("ManualCrawlRequest_one_active_per_source");
    expect(migration).toMatch(/WHERE\s+"status"\s+IN\s*\('QUEUED',\s*'RUNNING'\)/);
    expect(schema).toContain("model ManualCrawlRequestEvent");
    expect(schema).toContain("enum ManualCrawlEventActor");
    expect(migration).toContain("prevent_manual_crawl_request_event_mutation");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "ManualCrawlRequestEvent"');
    expect(migration).toContain("ManualCrawlRequestEvent_transition_check");
    expect(migration).toContain("btrim(\"ownerId\") <> ''");
  });

  it("uses an explicit failure-code enum and safely remediates legacy rows before constraints", () => {
    expect(schema).toContain("enum ManualCrawlFailureCode");
    expect(model("ManualCrawlRequest")).toMatch(/^\s*failureCode\s+ManualCrawlFailureCode\?/m);
    expect(migration).toMatch(/UPDATE "ManualCrawlRequest"[\s\S]+"failureReason" = 'MANUAL_CRAWL_FAILED'/);
    expect(migration).toContain("ROW_NUMBER() OVER");
    expect(migration).toContain("DUPLICATE_ACTIVE_REQUEST");
    expect(migration.indexOf("ROW_NUMBER() OVER")).toBeLessThan(
      migration.indexOf('CREATE UNIQUE INDEX "ManualCrawlRequest_one_active_per_source"')
    );
  });

  it("isolates verified MANUAL_SOURCE preview hashes without relaxing the formal lifecycle projection", () => {
    expect(previewIsolationMigration).toContain("MANUAL_SOURCE");
    expect(previewIsolationMigration).toMatch(/parent_output\s+IS\s+DISTINCT\s+FROM\s+parent_current/i);
    expect(previewIsolationMigration).toContain("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
    expect(previewIsolationMigration).toMatch(/IF\s+parent_kind\s*=\s*'MANUAL_SOURCE'[\s\S]+RETURN;[\s\S]+current_hash\s+IS\s+DISTINCT\s+FROM\s+parent_current/i);
    expect(previewIsolationMigration).toContain("verified committed parent lifecycle projection mismatch");
  });
});
