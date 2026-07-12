import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve("prisma/migrations/20260713050000_ai_enrichment_persistence/migration.sql"),
  "utf8"
);

describe("AI enrichment persistence", () => {
  it("stores durable requests, immutable attempts/results, and exact translation cache identities", () => {
    expect(schema).toContain("enum AiEnrichmentStatus");
    expect(schema).toMatch(/model AiEnrichmentRequest\s+\{[\s\S]+officialTitleSnapshot\s+String[\s\S]+inputHash\s+String[\s\S]+ownerId\s+String\?[\s\S]+leaseExpiresAt\s+DateTime\?[\s\S]+attemptCount\s+Int[\s\S]+maxAttempts\s+Int[\s\S]+@@unique\(\[jobId, inputHash\]\)/);
    expect(schema).toMatch(/model AiEnrichmentAttempt\s+\{[\s\S]+inputHash\s+String[\s\S]+outcome\s+AiEnrichmentAttemptOutcome[\s\S]+@@unique\(\[requestId, sequence\]\)/);
    expect(schema).toMatch(/model AiEnrichmentResult\s+\{[\s\S]+inputHash\s+String[\s\S]+primaryCategory\s+JobCategory[\s\S]+secondaryCategory\s+JobCategory\?[\s\S]+confidence\s+Float[\s\S]+safeRationale\s+String[\s\S]+hardRuleHits\s+String\[\][\s\S]+officialTitleSnapshot\s+String[\s\S]+auxiliaryChineseTitle\s+String\?/);
    expect(schema).toMatch(/model AiTranslationCache\s+\{[\s\S]+cacheKey\s+String\s+@id[\s\S]+normalizedOfficialTitle\s+String[\s\S]+provider\s+String[\s\S]+modelVersion\s+String[\s\S]+promptVersion\s+String[\s\S]+targetLanguage\s+String/);
    expect(migration).toMatch(/AiEnrichmentRequest_inputHash_sha256/);
    expect(migration).toMatch(/AiTranslationCache_cacheKey_sha256/);
    expect(migration).toMatch(/prevent_ai_enrichment_immutable_mutation/);
  });

  it("adds explicit human title priority and independent model metadata to Job", () => {
    expect(schema).toMatch(/humanCorrectedTitle\s+String\?/);
    expect(schema).toMatch(/humanTitleCorrectionReason\s+String\?/);
    expect(schema).toMatch(/humanTitleCorrectedAt\s+DateTime\?/);
    expect(schema).toMatch(/classificationProvider\s+String\?/);
    expect(schema).toMatch(/classificationPromptVersion\s+String\?/);
    expect(schema).toMatch(/classificationInputHash\s+String\?/);
    expect(schema).toMatch(/classificationHardRuleHits\s+String\[\]/);
    expect(schema).toMatch(/aiReviewRequired\s+Boolean/);
  });

  it("enforces lease ownership, bounded retries, low-confidence review, and input-bound result writes in SQL", () => {
    expect(migration).toMatch(/AiEnrichmentRequest_owner_lease_check/);
    expect(migration).toMatch(/AiEnrichmentRequest_retry_check/);
    expect(migration).toMatch(/Job_human_title_correction_check/);
    expect(migration).toMatch(/Job_classificationInputHash_sha256/);
    expect(migration).toMatch(/AiEnrichmentResult_confidence_check/);
    expect(migration).toMatch(/AiEnrichmentResult_low_confidence_review_check/);
    expect(migration).toMatch(/AiEnrichmentResult_request_input_job_tuple_fkey/);
    expect(migration).toMatch(/AiEnrichmentAttempt_request_input_tuple_fkey/);
  });
});
