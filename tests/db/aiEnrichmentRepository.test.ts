import { describe, expect, it, vi } from "vitest";
import {
  AiEnrichmentRepositoryError,
  buildAiEnrichmentInputIdentity,
  buildTranslationCacheIdentity,
  createAiEnrichmentRepository
} from "../../src/db/aiEnrichmentRepository";

describe("AI enrichment identity", () => {
  it("normalizes official titles and binds classifier identity to provider/model/prompt/language", () => {
    const first = buildAiEnrichmentInputIdentity({
      officialTitle: "  Senior   MSL  ", provider: "provider-a", modelVersion: "m1",
      promptVersion: "classification-v1", targetLanguage: "zh-CN"
    });
    const equivalent = buildAiEnrichmentInputIdentity({
      officialTitle: "Senior MSL", provider: "provider-a", modelVersion: "m1",
      promptVersion: "classification-v1", targetLanguage: "zh-CN"
    });
    expect(first).toEqual(equivalent);
    expect(first.normalizedOfficialTitle).toBe("Senior MSL");
    expect(first.inputHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(buildAiEnrichmentInputIdentity({
      officialTitle: "Senior MSL", provider: "provider-a", modelVersion: "m2",
      promptVersion: "classification-v1", targetLanguage: "zh-CN"
    }).inputHash).not.toBe(first.inputHash);
  });

  it("prevents cross-job cache pollution by binding every translation-producing input", () => {
    const base = buildTranslationCacheIdentity({ normalizedOfficialTitle: "Senior MSL", provider: "provider-a",
      modelVersion: "m1", promptVersion: "translation-v1", targetLanguage: "zh-CN" });
    expect(base.cacheKey).toMatch(/^[a-f0-9]{64}$/u);
    for (const changed of [
      { normalizedOfficialTitle: "Senior Medical Director" }, { provider: "provider-b" },
      { modelVersion: "m2" }, { promptVersion: "translation-v2" }, { targetLanguage: "zh-TW" }
    ]) {
      expect(buildTranslationCacheIdentity({ normalizedOfficialTitle: "Senior MSL", provider: "provider-a",
        modelVersion: "m1", promptVersion: "translation-v1", targetLanguage: "zh-CN", ...changed }).cacheKey)
        .not.toBe(base.cacheKey);
    }
  });
});

describe("AI enrichment repository", () => {
  it("claims one request with SKIP LOCKED and records its exact input attempt", async () => {
    const { db, sql, attempts } = fakeDb([[{ id: "request-1", jobId: "job-1", inputHash: "a".repeat(64),
      officialTitleSnapshot: "Senior MSL", normalizedOfficialTitle: "Senior MSL", provider: "provider-a",
      modelVersion: "m1", promptVersion: "classification-v1", targetLanguage: "zh-CN", attemptCount: 1 }]]);
    const repository = createAiEnrichmentRepository({ db });
    const claimed = await repository.claimNext({ ownerId: "worker-1", leaseDurationMs: 60_000 });
    expect(claimed?.id).toBe("request-1");
    expect(sql[0]).toMatch(/FOR UPDATE[\s\S]+SKIP LOCKED/);
    expect(sql[0]).toMatch(/leaseExpiresAt/);
    expect(attempts[0]).toMatchObject({ data: { requestId: "request-1", sequence: 1,
      inputHash: "a".repeat(64), ownerId: "worker-1", outcome: "RUNNING" } });
  });

  it("rejects a stale result after locking the current Job title", async () => {
    const { db, requests, results, jobUpdates } = fakeDb([
      [{ id: "request-1", jobId: "job-1", inputHash: "a".repeat(64), officialTitleSnapshot: "Old title",
        normalizedOfficialTitle: "Old title", provider: "provider-a", modelVersion: "m1",
        promptVersion: "classification-v1", targetLanguage: "zh-CN", attemptCount: 1,
        currentOfficialTitle: "New title" }]
    ]);
    const repository = createAiEnrichmentRepository({ db });
    await expect(repository.complete({ requestId: "request-1", ownerId: "worker-1", inputHash: "a".repeat(64),
      primaryCategory: "MEDICAL_AFFAIRS", secondaryCategory: null, confidence: 0.98,
      safeRationale: "Medical liaison role", hardRuleHits: [], auxiliaryChineseTitle: "高级医学联络官",
      translationPromptVersion: "translation-v1" })).rejects.toMatchObject({ code: "STALE_INPUT" });
    expect(results).toHaveLength(0);
    expect(jobUpdates).toHaveLength(0);
    expect(requests).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED",
      failureCode: "STALE_INPUT" }) }));
  });

  it("routes low confidence to OTHER and review without touching human correction fields", async () => {
    const title = "Unclear role";
    const identity = buildAiEnrichmentInputIdentity({ officialTitle: title, provider: "provider-a", modelVersion: "m1",
      promptVersion: "classification-v1", targetLanguage: "zh-CN" });
    const { db, results, jobUpdates } = fakeDb([[{ id: "request-1", jobId: "job-1", inputHash: identity.inputHash,
      officialTitleSnapshot: title, normalizedOfficialTitle: identity.normalizedOfficialTitle, provider: "provider-a",
      modelVersion: "m1", promptVersion: "classification-v1", targetLanguage: "zh-CN", attemptCount: 1,
      currentOfficialTitle: title }]]);
    const repository = createAiEnrichmentRepository({ db, lowConfidenceThreshold: 0.75 });
    await repository.complete({ requestId: "request-1", ownerId: "worker-1", inputHash: identity.inputHash,
      primaryCategory: "SALES", secondaryCategory: "MARKETING", confidence: 0.42,
      safeRationale: "Ambiguous title", hardRuleHits: ["NO_DESCRIPTION"], auxiliaryChineseTitle: null,
      translationPromptVersion: "translation-v1" });
    expect(results[0]).toMatchObject({ data: { primaryCategory: "OTHER", secondaryCategory: null,
      requiresReview: true, inputHash: identity.inputHash } });
    expect(jobUpdates[0]).toMatchObject({ data: { category: "OTHER", secondaryCategory: null,
      aiReviewRequired: true, classificationInputHash: identity.inputHash } });
    const data = (jobUpdates[0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("humanCorrectedCategory");
    expect(data).not.toHaveProperty("humanCorrectedTitle");
  });

  it("reuses only the exact immutable translation cache row on a cache-key conflict", async () => {
    const title = "Senior MSL";
    const identity = buildAiEnrichmentInputIdentity({ officialTitle: title, provider: "provider-a", modelVersion: "m1",
      promptVersion: "classification-v1", targetLanguage: "zh-CN" });
    const locked = { id: "request-1", jobId: "job-1", inputHash: identity.inputHash,
      officialTitleSnapshot: title, normalizedOfficialTitle: title, provider: "provider-a", modelVersion: "m1",
      promptVersion: "classification-v1", targetLanguage: "zh-CN", attemptCount: 1, maxAttempts: 3,
      currentOfficialTitle: title };
    const cacheIdentity = buildTranslationCacheIdentity({ normalizedOfficialTitle: title, provider: "provider-a",
      modelVersion: "m1", promptVersion: "translation-v1", targetLanguage: "zh-CN" });
    const { db, sql, results, jobUpdates } = fakeDb([[locked], [{ cacheKey: cacheIdentity.cacheKey,
      normalizedOfficialTitle: title, provider: "provider-a", modelVersion: "m1",
      promptVersion: "translation-v1", targetLanguage: "zh-CN", auxiliaryChineseTitle: "缓存医学科学联络官" }]]);
    const repository = createAiEnrichmentRepository({ db });
    await repository.complete({ requestId: "request-1", ownerId: "worker-1", inputHash: identity.inputHash,
      primaryCategory: "MEDICAL_AFFAIRS", secondaryCategory: null, confidence: 0.95,
      safeRationale: "Medical liaison role", hardRuleHits: [], auxiliaryChineseTitle: "新生成翻译",
      translationPromptVersion: "translation-v1" });
    expect(sql[1]).toMatch(/ON CONFLICT \("cacheKey"\) DO NOTHING/);
    expect(results[0]).toMatchObject({ data: { auxiliaryChineseTitle: "缓存医学科学联络官" } });
    expect(jobUpdates[0]).toMatchObject({ data: { auxiliaryChineseTitle: "缓存医学科学联络官" } });
  });

  it("rejects unsafe rationale before persistence", async () => {
    const { db, results } = fakeDb([]);
    const repository = createAiEnrichmentRepository({ db });
    await expect(repository.complete({ requestId: "request-1", ownerId: "worker-1", inputHash: "a".repeat(64),
      primaryCategory: "OTHER", secondaryCategory: null, confidence: 0.2,
      safeRationale: "Authorization: Bearer secret", hardRuleHits: [], auxiliaryChineseTitle: null,
      translationPromptVersion: "translation-v1" })).rejects.toMatchObject({ code: "UNSAFE_RESULT" });
    expect(results).toHaveLength(0);
  });
});

function fakeDb(rawResponses: unknown[]) {
  const sql: string[] = []; const attempts: unknown[] = []; const requests: unknown[] = [];
  const results: unknown[] = []; const jobUpdates: unknown[] = []; const cache: unknown[] = [];
  const db = {
    async $transaction<T>(operation: (tx: any) => Promise<T>): Promise<T> {
      return operation({
        async $queryRawUnsafe(query: string) { sql.push(query); return rawResponses.shift() ?? []; },
        aiEnrichmentAttempt: {
          async create(args: unknown) { attempts.push(args); return args; },
          async updateMany(args: unknown) { attempts.push(args); return { count: 1 }; }
        },
        aiEnrichmentRequest: {
          async upsert(args: unknown) { requests.push(args); return { id: "request-1" }; },
          async update(args: unknown) { requests.push(args); return args; },
          async updateMany(args: unknown) { requests.push(args); return { count: 1 }; }
        },
        aiEnrichmentResult: { async create(args: unknown) { results.push(args); return args; } },
        aiTranslationCache: { async upsert(args: unknown) { cache.push(args); return args; } },
        job: { async updateMany(args: unknown) { jobUpdates.push(args); return { count: 1 }; } }
      });
    }
  };
  return { db, sql, attempts, requests, results, jobUpdates, cache };
}
