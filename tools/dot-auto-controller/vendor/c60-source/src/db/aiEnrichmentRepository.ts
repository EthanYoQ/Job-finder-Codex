import { createHash } from "node:crypto";
import { containsCredentialMaterial } from "../security/credentialMaterial";
import type { PrismaJobCategoryName } from "./prismaMappers";

const SHA256 = /^[a-f0-9]{64}$/u;
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.75;
const MAX_LEASE_MS = 15 * 60_000;

export type AiEnrichmentRepositoryErrorCode =
  | "JOB_NOT_FOUND" | "INVALID_INPUT" | "OWNERSHIP_LOST" | "STALE_INPUT" | "UNSAFE_RESULT";

export class AiEnrichmentRepositoryError extends Error {
  constructor(public readonly code: AiEnrichmentRepositoryErrorCode) {
    super(code);
    this.name = "AiEnrichmentRepositoryError";
  }
}

export interface AiModelIdentityInput {
  officialTitle: string;
  provider: string;
  modelVersion: string;
  promptVersion: string;
  targetLanguage: string;
}

export interface TranslationCacheIdentityInput {
  normalizedOfficialTitle: string;
  provider: string;
  modelVersion: string;
  promptVersion: string;
  targetLanguage: string;
}

export function buildAiEnrichmentInputIdentity(input: AiModelIdentityInput): {
  normalizedOfficialTitle: string; inputHash: string;
} {
  const normalizedOfficialTitle = normalizeOfficialTitle(input.officialTitle);
  const identity = validateIdentity({
    normalizedOfficialTitle, provider: input.provider, modelVersion: input.modelVersion,
    promptVersion: input.promptVersion, targetLanguage: input.targetLanguage
  });
  return { normalizedOfficialTitle, inputHash: identityDigest(identity) };
}

export function buildTranslationCacheIdentity(input: TranslationCacheIdentityInput): { cacheKey: string } {
  return { cacheKey: identityDigest(validateIdentity({
    ...input, normalizedOfficialTitle: normalizeOfficialTitle(input.normalizedOfficialTitle)
  })) };
}

type ClaimedRequest = {
  id: string; jobId: string; inputHash: string; officialTitleSnapshot: string; normalizedOfficialTitle: string;
  provider: string; modelVersion: string; promptVersion: string; targetLanguage: string; attemptCount: number;
  maxAttempts: number;
};
type LockedRequest = ClaimedRequest & { currentOfficialTitle: string };
type CountResult = { count: number };

type AiEnrichmentTransaction = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
  job: {
    findUnique?(args: Record<string, unknown>): Promise<{ id: string; officialTitle: string } | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<CountResult>;
  };
  aiEnrichmentRequest: {
    upsert(args: Record<string, unknown>): Promise<{ id: string }>;
    update(args: Record<string, unknown>): Promise<unknown>;
    updateMany(args: Record<string, unknown>): Promise<CountResult>;
  };
  aiEnrichmentAttempt: {
    create(args: Record<string, unknown>): Promise<unknown>;
    updateMany?(args: Record<string, unknown>): Promise<CountResult>;
  };
  aiEnrichmentResult: { create(args: Record<string, unknown>): Promise<unknown> };
  aiTranslationCache: { upsert(args: Record<string, unknown>): Promise<unknown> };
};

export type AiEnrichmentDb = {
  $transaction<T>(operation: (transaction: AiEnrichmentTransaction) => Promise<T>): Promise<T>;
};

export function createAiEnrichmentRepository(input: {
  db: AiEnrichmentDb;
  lowConfidenceThreshold?: number;
}) {
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  if (lowConfidenceThreshold !== DEFAULT_LOW_CONFIDENCE_THRESHOLD) {
    throw new AiEnrichmentRepositoryError("INVALID_INPUT");
  }

  return {
    async enqueue(request: AiModelIdentityInput & { jobId: string; maxAttempts?: number }): Promise<{ id: string }> {
      assertNonblank(request.jobId);
      const maxAttempts = request.maxAttempts ?? 3;
      if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) invalidInput();
      return input.db.$transaction(async (transaction) => {
        if (!transaction.job.findUnique) invalidInput();
        const job = await transaction.job.findUnique({
          where: { id: request.jobId }, select: { id: true, officialTitle: true }
        });
        if (!job) throw new AiEnrichmentRepositoryError("JOB_NOT_FOUND");
        const identity = buildAiEnrichmentInputIdentity({ ...request, officialTitle: job.officialTitle });
        return transaction.aiEnrichmentRequest.upsert({
          where: { jobId_inputHash: { jobId: job.id, inputHash: identity.inputHash } },
          create: {
            jobId: job.id, officialTitleSnapshot: job.officialTitle,
            normalizedOfficialTitle: identity.normalizedOfficialTitle, inputHash: identity.inputHash,
            provider: request.provider, modelVersion: request.modelVersion, promptVersion: request.promptVersion,
            targetLanguage: request.targetLanguage, maxAttempts
          },
          update: {}
        });
      });
    },

    async claimNext(claim: { ownerId: string; leaseDurationMs: number }): Promise<ClaimedRequest | null> {
      assertLease(claim.ownerId, claim.leaseDurationMs);
      return input.db.$transaction(async (transaction) => {
        const rows = await transaction.$queryRawUnsafe<ClaimedRequest[]>(CLAIM_NEXT_SQL,
          claim.ownerId, claim.leaseDurationMs);
        const claimed = rows[0] ?? null;
        if (!claimed) return null;
        await transaction.aiEnrichmentAttempt.create({ data: {
          requestId: claimed.id, sequence: claimed.attemptCount, inputHash: claimed.inputHash,
          ownerId: claim.ownerId, outcome: "RUNNING"
        } });
        return claimed;
      });
    },

    async complete(result: {
      requestId: string; ownerId: string; inputHash: string; primaryCategory: PrismaJobCategoryName;
      secondaryCategory: PrismaJobCategoryName | null; confidence: number; safeRationale: string;
      hardRuleHits: string[]; auxiliaryChineseTitle: string | null; translationPromptVersion: string;
    }): Promise<void> {
      validateResult(result);
      const completion = await input.db.$transaction(async (transaction) => {
        const rows = await transaction.$queryRawUnsafe<LockedRequest[]>(LOCK_OWNED_REQUEST_SQL,
          result.requestId, result.ownerId, result.inputHash);
        const locked = rows[0];
        if (!locked) throw new AiEnrichmentRepositoryError("OWNERSHIP_LOST");
        const currentIdentity = buildAiEnrichmentInputIdentity({
          officialTitle: locked.currentOfficialTitle, provider: locked.provider, modelVersion: locked.modelVersion,
          promptVersion: locked.promptVersion, targetLanguage: locked.targetLanguage
        });
        if (locked.inputHash !== result.inputHash || locked.officialTitleSnapshot !== locked.currentOfficialTitle ||
            locked.normalizedOfficialTitle !== currentIdentity.normalizedOfficialTitle ||
            locked.inputHash !== currentIdentity.inputHash) {
          await rejectStale(transaction, locked, result.ownerId);
          return "STALE" as const;
        }

        const requiresReview = result.confidence < lowConfidenceThreshold;
        const primaryCategory = requiresReview ? "OTHER" : result.primaryCategory;
        const secondaryCategory = requiresReview ? null : result.secondaryCategory;
        let translationCacheKey: string | null = null;
        let auxiliaryChineseTitle = result.auxiliaryChineseTitle;
        if (result.auxiliaryChineseTitle !== null) {
          translationCacheKey = buildTranslationCacheIdentity({
            normalizedOfficialTitle: locked.normalizedOfficialTitle, provider: locked.provider,
            modelVersion: locked.modelVersion, promptVersion: result.translationPromptVersion,
            targetLanguage: locked.targetLanguage
          }).cacheKey;
          const cacheRows = await transaction.$queryRawUnsafe<Array<{
            cacheKey: string; normalizedOfficialTitle: string; provider: string; modelVersion: string;
            promptVersion: string; targetLanguage: string; auxiliaryChineseTitle: string;
          }>>(UPSERT_TRANSLATION_CACHE_SQL, translationCacheKey, locked.normalizedOfficialTitle,
            locked.provider, locked.modelVersion, result.translationPromptVersion, locked.targetLanguage,
            result.auxiliaryChineseTitle);
          const cacheRow = cacheRows[0];
          if (!cacheRow || cacheRows.length !== 1 || cacheRow.cacheKey !== translationCacheKey ||
              cacheRow.normalizedOfficialTitle !== locked.normalizedOfficialTitle ||
              cacheRow.provider !== locked.provider || cacheRow.modelVersion !== locked.modelVersion ||
              cacheRow.promptVersion !== result.translationPromptVersion ||
              cacheRow.targetLanguage !== locked.targetLanguage ||
              !cacheRow.auxiliaryChineseTitle.trim() || containsCredentialMaterial(cacheRow.auxiliaryChineseTitle)) {
            throw new AiEnrichmentRepositoryError("UNSAFE_RESULT");
          }
          auxiliaryChineseTitle = cacheRow.auxiliaryChineseTitle;
        }
        await transaction.aiEnrichmentResult.create({ data: {
          requestId: locked.id, jobId: locked.jobId, inputHash: locked.inputHash,
          primaryCategory, secondaryCategory, confidence: result.confidence,
          safeRationale: result.safeRationale.trim(), provider: locked.provider,
          modelVersion: locked.modelVersion, promptVersion: locked.promptVersion,
          hardRuleHits: [...result.hardRuleHits], officialTitleSnapshot: locked.officialTitleSnapshot,
          auxiliaryChineseTitle, translationCacheKey, requiresReview
        } });
        const updated = await transaction.job.updateMany({
          where: { id: locked.jobId, officialTitle: locked.currentOfficialTitle },
          data: {
            category: primaryCategory, secondaryCategory,
            classificationConfidence: result.confidence,
            classificationRationale: result.safeRationale.trim(),
            classificationModelVersion: locked.modelVersion,
            classificationProvider: locked.provider,
            classificationPromptVersion: locked.promptVersion,
            classificationInputHash: locked.inputHash,
            classificationHardRuleHits: [...result.hardRuleHits],
            auxiliaryChineseTitle,
            aiReviewRequired: requiresReview
          }
        });
        if (updated.count !== 1) throw new AiEnrichmentRepositoryError("STALE_INPUT");
        await finishAttempt(transaction, locked, "SUCCEEDED", null);
        await transaction.aiEnrichmentRequest.update({ where: { id: locked.id }, data: {
          status: "SUCCEEDED", ownerId: null, leaseExpiresAt: null, heartbeatAt: new Date(),
          failureCode: null, finishedAt: new Date()
        } });
        return "SUCCEEDED" as const;
      });
      if (completion === "STALE") throw new AiEnrichmentRepositoryError("STALE_INPUT");
    },

    async fail(failure: { requestId: string; ownerId: string; inputHash: string; failureCode: string }): Promise<void> {
      assertSafeCode(failure.failureCode);
      await input.db.$transaction(async (transaction) => {
        const rows = await transaction.$queryRawUnsafe<LockedRequest[]>(LOCK_OWNED_REQUEST_SQL,
          failure.requestId, failure.ownerId, failure.inputHash);
        const locked = rows[0];
        if (!locked) throw new AiEnrichmentRepositoryError("OWNERSHIP_LOST");
        const retry = locked.attemptCount < locked.maxAttempts;
        await finishAttempt(transaction, locked, retry ? "RETRY_QUEUED" : "FAILED", failure.failureCode);
        await transaction.aiEnrichmentRequest.update({ where: { id: locked.id }, data: {
          status: retry ? "QUEUED" : "FAILED", ownerId: null, leaseExpiresAt: null,
          heartbeatAt: new Date(), failureCode: failure.failureCode,
          ...(retry ? {} : { finishedAt: new Date() })
        } });
      });
    }
  };
}

const CLAIM_NEXT_SQL = `
WITH candidate AS (
  SELECT request."id"
  FROM "AiEnrichmentRequest" request
  WHERE (request."status" = 'QUEUED' OR
    (request."status" = 'RUNNING' AND request."leaseExpiresAt" <= clock_timestamp()))
    AND request."attemptCount" < request."maxAttempts"
  ORDER BY request."createdAt", request."id"
  FOR UPDATE SKIP LOCKED LIMIT 1
), claimed AS (
  UPDATE "AiEnrichmentRequest" request
  SET "status" = 'RUNNING', "ownerId" = $1, "heartbeatAt" = clock_timestamp(),
      "leaseExpiresAt" = clock_timestamp() + ($2::bigint * INTERVAL '1 millisecond'),
      "startedAt" = COALESCE(request."startedAt", clock_timestamp()),
      "attemptCount" = request."attemptCount" + 1, "failureCode" = NULL, "updatedAt" = clock_timestamp()
  FROM candidate WHERE request."id" = candidate."id"
  RETURNING request."id", request."jobId", request."inputHash", request."officialTitleSnapshot",
    request."normalizedOfficialTitle", request."provider", request."modelVersion", request."promptVersion",
    request."targetLanguage", request."attemptCount", request."maxAttempts"
) SELECT * FROM claimed`;

const LOCK_OWNED_REQUEST_SQL = `
SELECT request."id", request."jobId", request."inputHash", request."officialTitleSnapshot",
  request."normalizedOfficialTitle", request."provider", request."modelVersion", request."promptVersion",
  request."targetLanguage", request."attemptCount", request."maxAttempts", job."officialTitle" AS "currentOfficialTitle"
FROM "AiEnrichmentRequest" request JOIN "Job" job ON job."id" = request."jobId"
WHERE request."id" = $1 AND request."ownerId" = $2 AND request."inputHash" = $3
  AND request."status" = 'RUNNING' AND request."leaseExpiresAt" > clock_timestamp()
FOR UPDATE OF request, job`;

const UPSERT_TRANSLATION_CACHE_SQL = `
WITH inserted AS (
  INSERT INTO "AiTranslationCache" ("cacheKey", "normalizedOfficialTitle", "provider", "modelVersion",
    "promptVersion", "targetLanguage", "auxiliaryChineseTitle")
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT ("cacheKey") DO NOTHING
  RETURNING "cacheKey", "normalizedOfficialTitle", "provider", "modelVersion", "promptVersion",
    "targetLanguage", "auxiliaryChineseTitle"
)
SELECT * FROM inserted
UNION ALL
SELECT "cacheKey", "normalizedOfficialTitle", "provider", "modelVersion", "promptVersion",
  "targetLanguage", "auxiliaryChineseTitle"
FROM "AiTranslationCache" WHERE "cacheKey" = $1 AND NOT EXISTS (SELECT 1 FROM inserted)
LIMIT 1`;

async function rejectStale(tx: AiEnrichmentTransaction, locked: LockedRequest, ownerId: string): Promise<void> {
  await finishAttempt(tx, locked, "STALE_REJECTED", "STALE_INPUT");
  await tx.aiEnrichmentRequest.update({ where: { id: locked.id }, data: {
    status: "FAILED", ownerId: null, leaseExpiresAt: null, heartbeatAt: new Date(),
    failureCode: "STALE_INPUT", finishedAt: new Date()
  } });
}

async function finishAttempt(tx: AiEnrichmentTransaction, request: ClaimedRequest,
  outcome: "SUCCEEDED" | "RETRY_QUEUED" | "FAILED" | "STALE_REJECTED", failureCode: string | null): Promise<void> {
  if (!tx.aiEnrichmentAttempt.updateMany) return;
  const updated = await tx.aiEnrichmentAttempt.updateMany({
    where: { requestId: request.id, sequence: request.attemptCount, inputHash: request.inputHash, outcome: "RUNNING" },
    data: { outcome, failureCode, finishedAt: new Date() }
  });
  if (updated.count !== 1) throw new AiEnrichmentRepositoryError("OWNERSHIP_LOST");
}

function normalizeOfficialTitle(value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > 1000 || containsCredentialMaterial(normalized)) invalidInput();
  return normalized;
}

function validateIdentity(input: TranslationCacheIdentityInput): TranslationCacheIdentityInput {
  for (const value of Object.values(input)) assertNonblank(value);
  return input;
}

function validateResult(result: { requestId: string; ownerId: string; inputHash: string; confidence: number;
  safeRationale: string; hardRuleHits: string[]; auxiliaryChineseTitle: string | null; translationPromptVersion: string }): void {
  assertNonblank(result.requestId); assertNonblank(result.ownerId); assertNonblank(result.translationPromptVersion);
  if (!SHA256.test(result.inputHash) || !Number.isFinite(result.confidence) || result.confidence < 0 ||
      result.confidence > 1 || !result.safeRationale.trim() || result.safeRationale.length > 2000 ||
      containsCredentialMaterial(result.safeRationale) || result.hardRuleHits.length > 50 ||
      result.hardRuleHits.some((hit) => !hit.trim() || hit.length > 200 || containsCredentialMaterial(hit)) ||
      (result.auxiliaryChineseTitle !== null && (!result.auxiliaryChineseTitle.trim() ||
        result.auxiliaryChineseTitle.length > 1000 || containsCredentialMaterial(result.auxiliaryChineseTitle)))) {
    throw new AiEnrichmentRepositoryError("UNSAFE_RESULT");
  }
}

function assertLease(ownerId: string, leaseDurationMs: number): void {
  if (!ownerId.trim() || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 ||
      leaseDurationMs > MAX_LEASE_MS) invalidInput();
}
function assertSafeCode(value: string): void {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/u.test(value)) throw new AiEnrichmentRepositoryError("UNSAFE_RESULT");
}
function assertNonblank(value: string): void {
  if (!value.trim() || value.length > 1000 || containsCredentialMaterial(value)) invalidInput();
}
function invalidInput(): never { throw new AiEnrichmentRepositoryError("INVALID_INPUT"); }
function identityDigest(value: TranslationCacheIdentityInput): string {
  return createHash("sha256").update(JSON.stringify([
    value.normalizedOfficialTitle, value.provider, value.modelVersion, value.promptVersion, value.targetLanguage
  ]), "utf8").digest("hex");
}
