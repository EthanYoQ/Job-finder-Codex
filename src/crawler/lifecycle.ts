import { buildJobDedupeKey, type NormalizedJobRecord } from "./normalizedJob";

export type LifecycleStatus = "ACTIVE" | "SUSPECTED_OFFLINE" | "OFFLINE";

export interface JobSnapshot {
  dedupeKey: string;
  record: NormalizedJobRecord;
  lifecycleStatus: LifecycleStatus;
  missingSuccessfulCrawlCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface LifecycleDecision extends JobSnapshot {
  isNew: boolean;
}

export interface ApplyCrawlObservationOptions {
  crawlSucceeded: boolean;
  observedAt: string;
}

export function applyCrawlObservation(
  previousJobs: readonly JobSnapshot[],
  currentJobs: readonly NormalizedJobRecord[],
  options: ApplyCrawlObservationOptions
): LifecycleDecision[] {
  if (!options.crawlSucceeded) {
    return previousJobs.map((snapshot) => ({
      ...snapshot,
      isNew: false
    }));
  }

  const previousByKey = new Map(previousJobs.map((snapshot) => [snapshot.dedupeKey, snapshot]));
  const currentByKey = new Map<string, NormalizedJobRecord>();

  for (const record of currentJobs) {
    currentByKey.set(buildJobDedupeKey(record), record);
  }

  const decisions: LifecycleDecision[] = [];

  for (const [dedupeKey, record] of currentByKey) {
    const previous = previousByKey.get(dedupeKey);

    decisions.push({
      dedupeKey,
      record,
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 0,
      firstSeenAt: previous?.firstSeenAt ?? options.observedAt,
      lastSeenAt: options.observedAt,
      isNew: previous === undefined && !record.isBaseline
    });
  }

  for (const previous of previousJobs) {
    if (currentByKey.has(previous.dedupeKey)) {
      continue;
    }

    const missingSuccessfulCrawlCount = previous.missingSuccessfulCrawlCount + 1;

    decisions.push({
      ...previous,
      lifecycleStatus: lifecycleStatusForMissingCount(missingSuccessfulCrawlCount),
      missingSuccessfulCrawlCount,
      isNew: false
    });
  }

  return decisions;
}

function lifecycleStatusForMissingCount(missingSuccessfulCrawlCount: number): LifecycleStatus {
  if (missingSuccessfulCrawlCount >= 3) {
    return "OFFLINE";
  }

  if (missingSuccessfulCrawlCount >= 2) {
    return "SUSPECTED_OFFLINE";
  }

  return "ACTIVE";
}
