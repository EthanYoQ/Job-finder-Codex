import type { VerificationStatus } from "../domain/company";
import type { JobCategory } from "../domain/search";
import {
  sourceFailureCategoryLabel,
  type SourceFailureCategory,
  type SourceFailureDiagnosticCode
} from "../crawler/sourceFailureDiagnostics";

export type AdminDashboardInput = {
  sourceHealth: Array<{
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
    latestFailure?: {
      finishedAt: Date;
      reason: string;
      category: SourceFailureCategory;
      diagnosticCode: SourceFailureDiagnosticCode;
      fetchAttemptCount: number;
      retryCount: number;
    } | null;
  }>;
  feedbackQueue: Array<{
    id: string;
    companyName: string;
    jobTitle: string;
    issueType: string;
    description: string;
    contact?: string | null;
    status: string;
    createdAt: Date;
  }>;
  recommendationQueue: Array<{
    id: string;
    companyName: string;
    officialWebsiteUrl: string;
    note: string;
    status: string;
    createdAt: Date;
  }>;
  categoryCorrectionQueue: Array<{
    jobId: string;
    companyName: string;
    jobTitle: string;
    currentCategory: JobCategory;
    suggestedCategory: JobCategory;
  }>;
};

export type AdminDashboardModel = {
  sources: Array<{
    sourceId: string;
    companyName: string;
    verificationStatus: VerificationStatus;
    structuredJobCount: number;
    consecutiveFailureCount: number;
    latestCrawledAt: string | null;
    latestOutcomeLabel: "成功" | "失败" | "未抓取";
    latestFailureReason: string | null;
    latestFailureCategoryLabel: string | null;
    latestFetchAttemptCount: number | null;
    latestRetryCount: number | null;
    canQueueManualCrawl: boolean;
  }>;
  feedbackQueue: Array<{
    id: string;
    companyName: string;
    jobTitle: string;
    issueType: string;
    description: string;
    contact?: string | null;
    status: string;
    createdAt: string;
  }>;
  recommendationQueue: Array<{
    id: string;
    companyName: string;
    officialWebsiteUrl: string;
    note: string;
    status: string;
    createdAt: string;
  }>;
  categoryCorrectionQueue: Array<{
    jobId: string;
    companyName: string;
    jobTitle: string;
    currentCategory: JobCategory;
    suggestedCategory: JobCategory;
  }>;
};

export function buildAdminDashboardModel(input: AdminDashboardInput): AdminDashboardModel {
  return {
    sources: [...input.sourceHealth]
      .sort((left, right) => {
        const failureGap = right.consecutiveFailureCount - left.consecutiveFailureCount;

        if (failureGap !== 0) {
          return failureGap;
        }

        const rightTime = Math.max(
          right.latestObservation?.crawledAt.getTime() ?? 0,
          right.latestFailure?.finishedAt.getTime() ?? 0
        );
        const leftTime = Math.max(
          left.latestObservation?.crawledAt.getTime() ?? 0,
          left.latestFailure?.finishedAt.getTime() ?? 0
        );

        return rightTime - leftTime;
      })
      .map((source) => {
        const latestFailure = source.latestFailure ?? null;
        const failureIsLatest = latestFailure !== null && (
          source.latestObservation === null ||
          latestFailure.finishedAt.getTime() >= source.latestObservation.crawledAt.getTime()
        );
        const latestAt = failureIsLatest
          ? latestFailure.finishedAt
          : source.latestObservation?.crawledAt ?? null;
        return {
          sourceId: source.sourceId,
          companyName: source.companyName,
          verificationStatus: source.verificationStatus,
          structuredJobCount: source.structuredJobCount,
          consecutiveFailureCount: source.consecutiveFailureCount,
          latestCrawledAt: latestAt?.toISOString() ?? null,
          latestOutcomeLabel: failureIsLatest
            ? "失败" as const
            : source.latestObservation === null
              ? "未抓取" as const
              : source.latestObservation.successful
                ? "成功" as const
                : "失败" as const,
          latestFailureReason: failureIsLatest
            ? latestFailure.reason
            : source.latestObservation?.failureReason ?? null,
          latestFailureCategoryLabel: failureIsLatest
            ? sourceFailureCategoryLabel(latestFailure.category)
            : null,
          latestFetchAttemptCount: failureIsLatest ? latestFailure.fetchAttemptCount : null,
          latestRetryCount: failureIsLatest ? latestFailure.retryCount : null,
          canQueueManualCrawl: true
        };
      }),
    feedbackQueue: input.feedbackQueue.map((item) => ({
      id: item.id,
      companyName: item.companyName,
      jobTitle: item.jobTitle,
      issueType: item.issueType,
      description: item.description,
      ...(item.contact === undefined ? {} : { contact: item.contact }),
      status: item.status,
      createdAt: item.createdAt.toISOString()
    })),
    recommendationQueue: input.recommendationQueue.map((item) => ({
      id: item.id,
      companyName: item.companyName,
      officialWebsiteUrl: item.officialWebsiteUrl,
      note: item.note,
      status: item.status,
      createdAt: item.createdAt.toISOString()
    })),
    categoryCorrectionQueue: input.categoryCorrectionQueue.map((item) => ({
      jobId: item.jobId,
      companyName: item.companyName,
      jobTitle: item.jobTitle,
      currentCategory: item.currentCategory,
      suggestedCategory: item.suggestedCategory
    }))
  };
}
