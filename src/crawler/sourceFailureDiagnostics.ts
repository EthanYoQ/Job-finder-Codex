import {
  isRetryableSourceTransportFailure,
  type SourceTransportFailure
} from "./sourceFetchFailure";
import type { SourceFetchAttemptTracker } from "./runSourceCrawl";

export const SOURCE_FAILURE_CATEGORIES = [
  "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
  "SOURCE_TIME_LIMIT_REACHED",
  "OFFICIAL_SOURCE_REVIEW_REQUIRED",
  "EVIDENCE_PERSISTENCE_FAILURE",
  "UNCLASSIFIED_SOURCE_FAILURE"
] as const;

export type SourceFailureCategory = typeof SOURCE_FAILURE_CATEGORIES[number];

export const SOURCE_FAILURE_DIAGNOSTIC_CODES = [
  "OFFICIAL_HTTP_TIMEOUT",
  "OFFICIAL_HTTP_429",
  "OFFICIAL_HTTP_502",
  "OFFICIAL_HTTP_503",
  "OFFICIAL_HTTP_504",
  "SOURCE_ATTEMPT_TIMEOUT",
  "FETCH_EXECUTION_FAILED",
  "FETCH_FAILED_CLOSED",
  "ADAPTER_EXECUTION_FAILED",
  "ADAPTER_FAILED_CLOSED",
  "EVIDENCE_PROCESSING_FAILED",
  "BATCH_ABORTED_BEFORE_SOURCE_TERMINAL"
] as const;

export type SourceFailureDiagnosticCode = typeof SOURCE_FAILURE_DIAGNOSTIC_CODES[number];

export interface SourceFailureDiagnosticBundle {
  failureCategory: SourceFailureCategory;
  failureDiagnosticCode: SourceFailureDiagnosticCode;
  fetchAttemptCount: number;
  retryCount: number;
}

const CATEGORY_SET = new Set<string>(SOURCE_FAILURE_CATEGORIES);
const DIAGNOSTIC_CODE_SET = new Set<string>(SOURCE_FAILURE_DIAGNOSTIC_CODES);

export function isSourceFailureCategory(value: unknown): value is SourceFailureCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

export function isSourceFailureDiagnosticCode(value: unknown): value is SourceFailureDiagnosticCode {
  return typeof value === "string" && DIAGNOSTIC_CODE_SET.has(value);
}

export function sourceFailureDiagnosticBundle(
  failureCategory: SourceFailureCategory,
  failureDiagnosticCode: SourceFailureDiagnosticCode,
  tracker: Pick<SourceFetchAttemptTracker, "fetchAttemptCount" | "retryCount">
): SourceFailureDiagnosticBundle {
  return {
    failureCategory,
    failureDiagnosticCode,
    fetchAttemptCount: tracker.fetchAttemptCount,
    retryCount: tracker.retryCount
  };
}

export function transportFailureDiagnosticBundle(
  failure: SourceTransportFailure | undefined,
  tracker: Pick<SourceFetchAttemptTracker, "fetchAttemptCount" | "retryCount">
): SourceFailureDiagnosticBundle {
  return isRetryableSourceTransportFailure(failure)
    ? sourceFailureDiagnosticBundle(
        "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
        failure.code,
        tracker
      )
    : sourceFailureDiagnosticBundle(
        "UNCLASSIFIED_SOURCE_FAILURE",
        "FETCH_FAILED_CLOSED",
        tracker
      );
}

export function sourceFailureCategoryLabel(category: SourceFailureCategory): string {
  switch (category) {
    case "TEMPORARY_OFFICIAL_SOURCE_FAILURE":
      return "官网招聘入口暂时不可用";
    case "SOURCE_TIME_LIMIT_REACHED":
      return "官网抓取超过时间限制";
    case "OFFICIAL_SOURCE_REVIEW_REQUIRED":
      return "官网招聘入口内容需要复核";
    case "EVIDENCE_PERSISTENCE_FAILURE":
      return "抓取结果保存失败";
    case "UNCLASSIFIED_SOURCE_FAILURE":
      return "抓取失败，原因待核验";
  }
}
