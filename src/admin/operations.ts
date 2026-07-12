import type { Prisma } from "@prisma/client";
import { toSourceScheduleState } from "../db/crawlStateRepository";
import { toPrismaJobCategory, type PrismaJobCategoryName } from "../db/prismaMappers";
import type { VerificationStatus } from "../domain/company";
import type { JobCategory } from "../domain/search";
import {
  createManualCrawlRequestRepository,
  type ManualCrawlRequestDb,
  type ManualCrawlRequestRepository
} from "../db/manualCrawlRequestRepository";

type FeedbackReviewStatus = "REVIEWED" | "CLOSED" | "SPAM";
type RecommendationReviewStatus = FeedbackReviewStatus;
type ManualCrawlStatus = "QUEUED";

export type AdminOperationContext = {
  adminUserId: string;
  ip: string;
  userAgent: string;
};

type AdminAuditCreateArgs = {
  data: {
    adminUserId: string;
    action: string;
    targetType: string;
    targetId: string | null;
    ip: string;
    userAgent: string;
    metadata?: Prisma.InputJsonValue;
  };
};

type ManualCrawlRequestRecord = {
  id: string;
};

type FeedbackRecord = {
  id: string;
  status: string;
};

type RecommendedCompanyRecord = {
  id: string;
  status: string;
};

type JobRecord = {
  id: string;
};

type SourceHealthObservationRow = {
  crawledAt: Date;
  successful: boolean;
  structuredJobCount: number;
  failureReason: string | null;
};

type SourceHealthRow = {
  id: string;
  companyId: string;
  status: VerificationStatus;
  company: {
    officialChineseName: string;
  };
  crawlObservations: SourceHealthObservationRow[];
  _count: {
    jobs: number;
  };
};

export type AdminOperationsDb = {
  manualCrawlRequest: {
    create(args: {
      data: {
        sourceId: string;
        requestedById: string;
        status: ManualCrawlStatus;
        reason?: string;
      };
    }): Promise<ManualCrawlRequestRecord>;
  };
  adminAuditEvent: {
    create(args: AdminAuditCreateArgs): Promise<unknown>;
  };
  feedback: {
    update(args: {
      where: { id: string };
      data: { status: FeedbackReviewStatus; closedAt?: Date };
    }): Promise<FeedbackRecord>;
  };
  recommendedCompany: {
    update(args: {
      where: { id: string };
      data: { status: RecommendationReviewStatus; closedAt?: Date };
    }): Promise<RecommendedCompanyRecord>;
  };
  job: {
    update(args: {
      where: { id: string };
      data: {
        humanCorrectedCategory: PrismaJobCategoryName;
        humanCorrectedSecondaryCategory: PrismaJobCategoryName | null;
        humanCorrectionReason: string;
        humanCorrectedAt: Date;
      };
    }): Promise<JobRecord>;
  };
  recruitmentSource: {
    findMany(args: {
      include: {
        company: {
          select: {
            officialChineseName: true;
          };
        };
        crawlObservations: {
          orderBy: {
            crawledAt: "desc";
          };
          select: {
            crawledAt: true;
            successful: true;
            structuredJobCount: true;
            failureReason: true;
          };
        };
        _count: {
          select: {
            jobs: true;
          };
        };
      };
    }): Promise<SourceHealthRow[]>;
  };
};

export type AdminOperationsDeps = {
  db: AdminOperationsDb;
  now?: () => Date;
  manualCrawlRequestRepository?: Pick<ManualCrawlRequestRepository, "enqueue">;
};

export async function queueManualCrawl(
  input: { sourceId: string; reason?: string },
  context: AdminOperationContext,
  deps: AdminOperationsDeps
): Promise<ManualCrawlRequestRecord> {
  const repository = deps.manualCrawlRequestRepository ?? createManualCrawlRequestRepository({
    db: deps.db as unknown as ManualCrawlRequestDb
  });
  return repository.enqueue({
    sourceId: input.sourceId,
    requestedById: context.adminUserId,
    ip: context.ip,
    userAgent: context.userAgent,
    ...(input.reason === undefined ? {} : { reason: input.reason })
  });
}

export async function reviewFeedback(
  input: { feedbackId: string; status: string; note?: string },
  context: AdminOperationContext,
  deps: AdminOperationsDeps
): Promise<FeedbackRecord> {
  const status = assertReviewStatus(input.status, "feedback");
  const closedAt = status === "CLOSED" ? (deps.now?.() ?? new Date()) : undefined;
  const feedback = await deps.db.feedback.update({
    where: { id: input.feedbackId },
    data: { status, ...(closedAt === undefined ? {} : { closedAt }) }
  });

  await writeAuditEvent(context, deps.db, {
    action: "REVIEW_FEEDBACK",
    targetType: "Feedback",
    targetId: input.feedbackId,
    metadata: {
      feedbackId: input.feedbackId,
      status,
      ...(input.note === undefined ? {} : { note: input.note })
    }
  });

  return feedback;
}

export async function reviewRecommendedCompany(
  input: { recommendationId: string; status: string; note?: string },
  context: AdminOperationContext,
  deps: AdminOperationsDeps
): Promise<RecommendedCompanyRecord> {
  const status = assertReviewStatus(input.status, "recommended company");
  const closedAt = status === "CLOSED" ? (deps.now?.() ?? new Date()) : undefined;
  const recommendation = await deps.db.recommendedCompany.update({
    where: { id: input.recommendationId },
    data: { status, ...(closedAt === undefined ? {} : { closedAt }) }
  });

  await writeAuditEvent(context, deps.db, {
    action: "REVIEW_RECOMMENDED_COMPANY",
    targetType: "RecommendedCompany",
    targetId: input.recommendationId,
    metadata: {
      recommendationId: input.recommendationId,
      status,
      ...(input.note === undefined ? {} : { note: input.note })
    }
  });

  return recommendation;
}

export async function applyJobCategoryCorrection(
  input: {
    jobId: string;
    category: JobCategory;
    secondaryCategory?: JobCategory;
    reason: string;
  },
  context: AdminOperationContext,
  deps: AdminOperationsDeps
): Promise<JobRecord> {
  const correctedAt = deps.now?.() ?? new Date();
  const job = await deps.db.job.update({
    where: { id: input.jobId },
    data: {
      humanCorrectedCategory: toPrismaJobCategory(input.category),
      humanCorrectedSecondaryCategory:
        input.secondaryCategory === undefined ? null : toPrismaJobCategory(input.secondaryCategory),
      humanCorrectionReason: input.reason,
      humanCorrectedAt: correctedAt
    }
  });

  await writeAuditEvent(context, deps.db, {
    action: "APPLY_JOB_CATEGORY_CORRECTION",
    targetType: "Job",
    targetId: input.jobId,
    metadata: {
      jobId: input.jobId,
      category: input.category,
      ...(input.secondaryCategory === undefined ? {} : { secondaryCategory: input.secondaryCategory }),
      reason: input.reason
    }
  });

  return job;
}

export async function listSourceHealth(
  deps: Pick<AdminOperationsDeps, "db">
): Promise<
  Array<{
    sourceId: string;
    companyId: string;
    companyName: string;
    verificationStatus: VerificationStatus;
    structuredJobCount: number;
    consecutiveFailureCount: number;
    latestObservation: {
      crawledAt: Date;
      successful: boolean;
      structuredJobCount: number;
      failureReason: string | null;
    } | null;
  }>
> {
  const sources = await deps.db.recruitmentSource.findMany({
    include: {
      company: {
        select: {
          officialChineseName: true
        }
      },
      crawlObservations: {
        orderBy: {
          crawledAt: "desc"
        },
        select: {
          crawledAt: true,
          successful: true,
          structuredJobCount: true,
          failureReason: true
        }
      },
      _count: {
        select: {
          jobs: true
        }
      }
    }
  });

  return sources.map((source) => {
    const sortedObservations = [...source.crawlObservations].sort(
      (left, right) => right.crawledAt.getTime() - left.crawledAt.getTime()
    );
    const latestObservation = sortedObservations[0] ?? null;
    const sourceScheduleState = toSourceScheduleState(source.id, sortedObservations);

    return {
      sourceId: source.id,
      companyId: source.companyId,
      companyName: source.company.officialChineseName,
      verificationStatus: source.status,
      structuredJobCount: source._count.jobs,
      consecutiveFailureCount: sourceScheduleState.consecutiveFailureCount,
      latestObservation:
        latestObservation === null
          ? null
          : {
              crawledAt: latestObservation.crawledAt,
              successful: latestObservation.successful,
              structuredJobCount: latestObservation.structuredJobCount,
              failureReason: latestObservation.failureReason
            }
    };
  });
}

function assertReviewStatus(status: string, target: "feedback" | "recommended company"): FeedbackReviewStatus {
  if (status === "REVIEWED" || status === "CLOSED" || status === "SPAM") {
    return status;
  }

  throw new Error(`Invalid ${target} review status`);
}

async function writeAuditEvent(
  context: AdminOperationContext,
  db: AdminOperationsDb,
  audit: {
    action: string;
    targetType: string;
    targetId: string | null;
    metadata?: Prisma.InputJsonValue;
  }
): Promise<void> {
  await db.adminAuditEvent.create({
    data: {
      adminUserId: context.adminUserId,
      action: audit.action,
      targetType: audit.targetType,
      targetId: audit.targetId,
      ip: context.ip,
      userAgent: context.userAgent,
      ...(audit.metadata === undefined ? {} : { metadata: audit.metadata })
    }
  });
}
