import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schemaPath = resolve(process.cwd(), "prisma", "schema.prisma");
const schema = readFileSync(schemaPath, "utf8");

describe("prisma schema", () => {
  it("validates the PostgreSQL data model", () => {
    const output = execSync("npm run --silent prisma:validate", {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "" }
    });

    expect(output).toMatch(/is valid/i);
  });

  it("stores a required per-source dedupe key for jobs", () => {
    expect(schema).toMatch(/dedupeKey\s+String/);
    expect(schema).toMatch(/@@unique\(\[sourceId,\s*dedupeKey\]\)/);
  });

  it("stores job classification with typed enum fields and audit metadata", () => {
    expect(schema).toMatch(/enum JobCategory\s+\{/);
    expect(schema).toMatch(/SALES\s+@map\("销售"\)/);
    expect(schema).toMatch(/OTHER\s+@map\("其他"\)/);
    expect(schema).toMatch(/category\s+JobCategory/);
    expect(schema).toMatch(/secondaryCategory\s+JobCategory\?/);
    expect(schema).toMatch(/classificationConfidence\s+Float\?/);
    expect(schema).toMatch(/classificationRationale\s+String\?/);
    expect(schema).toMatch(/classificationModelVersion\s+String\?/);
    expect(schema).toMatch(/classificationHardRuleHit\s+String\?/);
    expect(schema).toMatch(/humanCorrectedCategory\s+JobCategory\?/);
    expect(schema).toMatch(/humanCorrectedSecondaryCategory\s+JobCategory\?/);
    expect(schema).toMatch(/humanCorrectionReason\s+String\?/);
    expect(schema).toMatch(/humanCorrectedAt\s+DateTime\?/);
  });

  it("types crawl stable required fields with a Prisma enum array", () => {
    expect(schema).toMatch(/enum RequiredJobField\s+\{/);
    expect(schema).toMatch(/COMPANY\s+@map\("company"\)/);
    expect(schema).toMatch(/TITLE\s+@map\("title"\)/);
    expect(schema).toMatch(/OFFICIAL_URL\s+@map\("officialUrl"\)/);
    expect(schema).toMatch(/LOCATION\s+@map\("location"\)/);
    expect(schema).toMatch(/stableRequiredFields\s+RequiredJobField\[\]/);
  });

  it("stores frontend visibility, new labels, and multi-city job evidence", () => {
    expect(schema).toMatch(/visibleInFrontend\s+Boolean\s+@default\(true\)/);
    expect(schema).toMatch(/isNew\s+Boolean\s+@default\(false\)/);
    expect(schema).toMatch(/cities\s+String\[\]\s+@default\(\[\]\)/);
    expect(schema).toMatch(/@@index\(\[visibleInFrontend,\s*lifecycleStatus\]\)/);
  });
});
