import type { VerificationStatus } from "../domain/company";
import type { JobCategory } from "../domain/search";

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

        const rightTime = right.latestObservation?.crawledAt.getTime() ?? 0;
        const leftTime = left.latestObservation?.crawledAt.getTime() ?? 0;

        return rightTime - leftTime;
      })
      .map((source) => ({
        sourceId: source.sourceId,
        companyName: source.companyName,
        verificationStatus: source.verificationStatus,
        structuredJobCount: source.structuredJobCount,
        consecutiveFailureCount: source.consecutiveFailureCount,
        latestCrawledAt: source.latestObservation?.crawledAt.toISOString() ?? null,
        latestOutcomeLabel:
          source.latestObservation === null
            ? "未抓取"
            : source.latestObservation.successful
              ? "成功"
              : "失败",
        latestFailureReason: source.latestObservation?.failureReason ?? null,
        canQueueManualCrawl: true
      })),
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
