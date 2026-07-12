import {
  canonicalPhase1InScopeRosterMembers,
  isUserAuthorizedPhase1Exclusion
} from "../data/phase1ScopePolicy";

export type ManualCrawlRequestRepositoryErrorCode =
  | "SOURCE_NOT_FOUND"
  | "AUTHORIZED_EXCLUSION"
  | "OUT_OF_SCOPE"
  | "NOT_EXECUTABLE"
  | "ALREADY_ACTIVE"
  | "OWNERSHIP_LOST"
  | "INVALID_MANUAL_BATCH"
  | "UNSAFE_FAILURE_CODE";

export class ManualCrawlRequestRepositoryError extends Error {
  constructor(public readonly code: ManualCrawlRequestRepositoryErrorCode) {
    super(code);
    this.name = "ManualCrawlRequestRepositoryError";
  }
}

export type ManualCrawlSource = {
  id: string;
  companyId: string;
  kind: string;
  atsKind: string;
  status: string;
};

export type ManualCrawlEligibility =
  | { eligible: true }
  | { eligible: false; code: "AUTHORIZED_EXCLUSION" | "OUT_OF_SCOPE" | "NOT_EXECUTABLE" };

type CountResult = { count: number };
type ManualCrawlRequestRecord = { id: string };
type ClaimedManualCrawlRequest = {
  id: string;
  sourceId: string;
  attemptCount: number;
  previousStatus?: "QUEUED" | "RUNNING";
};

type ManualCrawlTransaction = {
  recruitmentSource: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; companyId: true; kind: true; atsKind: true; status: true };
    }): Promise<ManualCrawlSource | null>;
  };
  crawlBatch: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; kind: true };
    }): Promise<{ id: string; kind: string | null } | null>;
  };
  manualCrawlRequest: {
    create(args: { data: Record<string, unknown> }): Promise<ManualCrawlRequestRecord>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<CountResult>;
  };
  manualCrawlRequestEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  adminAuditEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

export type ManualCrawlRequestDb = {
  $transaction<T>(callback: (transaction: ManualCrawlTransaction) => Promise<T>): Promise<T>;
};

export type ManualCrawlRequestRepository = ReturnType<typeof createManualCrawlRequestRepository>;

const inScopeCompanyIds = new Set(canonicalPhase1InScopeRosterMembers.map(({ id }) => id));
const SAFE_FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export function evaluateCanonicalManualCrawlEligibility(source: ManualCrawlSource): ManualCrawlEligibility {
  if (isUserAuthorizedPhase1Exclusion(source.companyId)) {
    return { eligible: false, code: "AUTHORIZED_EXCLUSION" };
  }
  if (!inScopeCompanyIds.has(source.companyId)) {
    return { eligible: false, code: "OUT_OF_SCOPE" };
  }
  if (source.kind !== "SOCIAL" || source.status !== "VERIFIED_SCRAPABLE" || source.atsKind === "UNKNOWN") {
    return { eligible: false, code: "NOT_EXECUTABLE" };
  }
  return { eligible: true };
}

export function createManualCrawlRequestRepository(input: {
  db: ManualCrawlRequestDb;
  evaluateEligibility?: (source: ManualCrawlSource) => ManualCrawlEligibility;
}) {
  const evaluateEligibility = input.evaluateEligibility ?? evaluateCanonicalManualCrawlEligibility;

  return {
    async enqueue(request: {
      sourceId: string;
      requestedById: string;
      reason?: string;
      ip: string;
      userAgent: string;
    }): Promise<ManualCrawlRequestRecord> {
      try {
        return await input.db.$transaction(async (transaction) => {
          const source = await transaction.recruitmentSource.findUnique({
            where: { id: request.sourceId },
            select: { id: true, companyId: true, kind: true, atsKind: true, status: true }
          });
          if (!source) throw new ManualCrawlRequestRepositoryError("SOURCE_NOT_FOUND");
          const eligibility = evaluateEligibility(source);
          if (!eligibility.eligible) throw new ManualCrawlRequestRepositoryError(eligibility.code);

          const created = await transaction.manualCrawlRequest.create({
            data: {
              sourceId: request.sourceId,
              requestedById: request.requestedById,
              status: "QUEUED",
              ...(request.reason === undefined ? {} : { reason: request.reason })
            }
          });
          await transaction.manualCrawlRequestEvent.create({
            data: {
              requestId: created.id,
              eventType: "ENQUEUED",
              actor: "ADMIN",
              adminUserId: request.requestedById,
              ownerId: null,
              fromStatus: null,
              toStatus: "QUEUED"
            }
          });
          await transaction.adminAuditEvent.create({
            data: {
              adminUserId: request.requestedById,
              action: "QUEUE_MANUAL_CRAWL",
              targetType: "RecruitmentSource",
              targetId: request.sourceId,
              ip: request.ip,
              userAgent: request.userAgent,
              metadata: {
                sourceId: request.sourceId,
                ...(request.reason === undefined ? {} : { reason: request.reason }),
                manualCrawlRequestId: created.id
              }
            }
          });
          return created;
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ManualCrawlRequestRepositoryError("ALREADY_ACTIVE");
        throw error;
      }
    },

    async claimNext(claim: {
      ownerId: string;
      now: Date;
      leaseExpiresAt: Date;
    }): Promise<ClaimedManualCrawlRequest | null> {
      return input.db.$transaction(async (transaction) => {
        const rows = await transaction.$queryRawUnsafe<ClaimedManualCrawlRequest[]>(CLAIM_NEXT_SQL,
          claim.now, claim.ownerId, claim.leaseExpiresAt);
        const claimed = rows[0] ?? null;
        if (!claimed) return null;
        const reclaimed = claimed.previousStatus === "RUNNING";
        await transaction.manualCrawlRequestEvent.create({
          data: {
            requestId: claimed.id,
            eventType: reclaimed ? "LEASE_RECLAIMED" : "CLAIMED",
            actor: "SYSTEM",
            adminUserId: null,
            ownerId: claim.ownerId,
            fromStatus: reclaimed ? "RUNNING" : "QUEUED",
            toStatus: "RUNNING"
          }
        });
        return claimed;
      });
    },

    async heartbeat(heartbeat: {
      requestId: string;
      ownerId: string;
      now: Date;
      leaseExpiresAt: Date;
    }): Promise<void> {
      await input.db.$transaction(async (transaction) => {
        const result = await transaction.manualCrawlRequest.updateMany({
          where: { id: heartbeat.requestId, ownerId: heartbeat.ownerId, status: "RUNNING" },
          data: { heartbeatAt: heartbeat.now, leaseExpiresAt: heartbeat.leaseExpiresAt }
        });
        assertOwnedUpdate(result);
        await createSystemEvent(transaction, heartbeat.requestId, heartbeat.ownerId, "HEARTBEAT", "RUNNING", "RUNNING");
      });
    },

    async finishSuccess(finish: {
      requestId: string;
      ownerId: string;
      crawlBatchId: string;
      now: Date;
    }): Promise<void> {
      await input.db.$transaction(async (transaction) => {
        const batch = await transaction.crawlBatch.findUnique({
          where: { id: finish.crawlBatchId }, select: { id: true, kind: true }
        });
        if (!batch || batch.kind !== "MANUAL_SOURCE") {
          throw new ManualCrawlRequestRepositoryError("INVALID_MANUAL_BATCH");
        }
        const result = await transaction.manualCrawlRequest.updateMany({
          where: { id: finish.requestId, ownerId: finish.ownerId, status: "RUNNING" },
          data: {
            status: "SUCCESS", crawlBatchId: finish.crawlBatchId, finishedAt: finish.now,
            heartbeatAt: finish.now, leaseExpiresAt: null, failureCode: null
          }
        });
        assertOwnedUpdate(result);
        await createSystemEvent(transaction, finish.requestId, finish.ownerId, "SUCCEEDED", "RUNNING", "SUCCESS");
      });
    },

    async finishFailed(finish: {
      requestId: string;
      ownerId: string;
      failureCode: string;
      now: Date;
    }): Promise<void> {
      if (!SAFE_FAILURE_CODE.test(finish.failureCode)) {
        throw new ManualCrawlRequestRepositoryError("UNSAFE_FAILURE_CODE");
      }
      await input.db.$transaction(async (transaction) => {
        const result = await transaction.manualCrawlRequest.updateMany({
          where: { id: finish.requestId, ownerId: finish.ownerId, status: "RUNNING" },
          data: {
            status: "FAILED", failureCode: finish.failureCode, finishedAt: finish.now,
            heartbeatAt: finish.now, leaseExpiresAt: null
          }
        });
        assertOwnedUpdate(result);
        await createSystemEvent(transaction, finish.requestId, finish.ownerId, "FAILED", "RUNNING", "FAILED",
          finish.failureCode);
      });
    }
  };
}

const CLAIM_NEXT_SQL = `
WITH candidate AS (
  SELECT "id", "status" AS "previousStatus"
  FROM "ManualCrawlRequest"
  WHERE "status" = 'QUEUED'
     OR ("status" = 'RUNNING' AND "leaseExpiresAt" <= $1)
  ORDER BY "createdAt" ASC, "id" ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
), claimed AS (
  UPDATE "ManualCrawlRequest" AS request
  SET "status" = 'RUNNING',
      "ownerId" = $2,
      "heartbeatAt" = $1,
      "leaseExpiresAt" = $3,
      "startedAt" = COALESCE(request."startedAt", $1),
      "attemptCount" = request."attemptCount" + 1
  FROM candidate
  WHERE request."id" = candidate."id"
  RETURNING request."id", request."sourceId", request."attemptCount", candidate."previousStatus"
)
SELECT * FROM claimed
`;

function assertOwnedUpdate(result: CountResult): void {
  if (result.count !== 1) throw new ManualCrawlRequestRepositoryError("OWNERSHIP_LOST");
}

async function createSystemEvent(
  transaction: ManualCrawlTransaction,
  requestId: string,
  ownerId: string,
  eventType: "HEARTBEAT" | "SUCCEEDED" | "FAILED",
  fromStatus: "RUNNING",
  toStatus: "RUNNING" | "SUCCESS" | "FAILED",
  failureCode?: string
): Promise<void> {
  await transaction.manualCrawlRequestEvent.create({
    data: {
      requestId, eventType, actor: "SYSTEM", adminUserId: null, ownerId, fromStatus, toStatus,
      ...(failureCode === undefined ? {} : { failureCode })
    }
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
