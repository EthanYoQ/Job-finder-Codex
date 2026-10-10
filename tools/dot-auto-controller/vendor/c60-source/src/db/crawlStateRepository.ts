import type { ATSKind, VerificationStatus } from "../domain/company";
import type { JobSnapshot } from "../crawler/lifecycle";
import type { SourceScheduleState } from "../crawler/schedule";
import {
  fromPrismaJobCategory,
  fromPrismaLifecycleStatus,
  type PrismaJobCategoryName,
  type PrismaLifecycleStatusName
} from "./prismaMappers";

export interface PersistedJobRow {
  dedupeKey: string;
  companyId: string;
  sourceId: string;
  sourceJobId: string | null;
  officialTitle: string;
  auxiliaryChineseTitle: string | null;
  officialUrl: string;
  listUrl: string | null;
  locationRaw: string;
  city: string;
  cities: string[];
  category: PrismaJobCategoryName;
  officialPublishedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  missingSuccessCount: number;
  lifecycleStatus: PrismaLifecycleStatusName;
  source: {
    atsKind: ATSKind;
    kind: "SOCIAL";
    status: VerificationStatus;
    officialEntryUrl: string;
    officialChainEvidenceUrl: string;
  };
  company: {
    officialChineseName: string;
  };
}

export interface PersistedCrawlObservationRow {
  /** Only the verified portable result reader supplies this failure backoff. */
  portableRetryNotBefore?: Date;
  crawledAt: Date;
  successful: boolean;
}

export function toJobSnapshots(rows: readonly PersistedJobRow[]): JobSnapshot[] {
  return rows.map((row) => ({
    dedupeKey: row.dedupeKey,
    lifecycleStatus: fromPrismaLifecycleStatus(row.lifecycleStatus),
    missingSuccessfulCrawlCount: row.missingSuccessCount,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    record: {
      companyId: row.companyId,
      sourceId: row.sourceId,
      sourceKind: "SOCIAL",
      atsKind: row.source.atsKind,
      officialChineseCompanyName: row.company.officialChineseName,
      officialTitle: row.officialTitle,
      ...(row.auxiliaryChineseTitle === null
        ? {}
        : { auxiliaryChineseTitle: row.auxiliaryChineseTitle }),
      officialUrl: row.officialUrl,
      ...(row.listUrl === null ? {} : { listUrl: row.listUrl }),
      ...(row.sourceJobId === null ? {} : { sourceJobId: row.sourceJobId }),
      locationRaw: row.locationRaw,
      cities: [...row.cities],
      category: fromPrismaJobCategory(row.category),
      ...(row.officialPublishedAt === null
        ? {}
        : { officialPublishedAt: row.officialPublishedAt.toISOString() }),
      isBaseline: false,
      evidence: {
        officialEntryUrl: row.source.officialEntryUrl,
        officialChainEvidenceUrl: row.source.officialChainEvidenceUrl,
        capturedAt: row.lastSeenAt.toISOString()
      }
    }
  }));
}

export function toSourceScheduleState(
  sourceId: string,
  observations: readonly PersistedCrawlObservationRow[]
): SourceScheduleState {
  const sortedObservations = [...observations].sort(
    (left, right) => right.crawledAt.getTime() - left.crawledAt.getTime()
  );
  let lastSuccessfulCrawlAt: Date | undefined;
  let consecutiveFailureCount = 0;

  for (const observation of sortedObservations) {
    if (observation.successful) {
      lastSuccessfulCrawlAt = observation.crawledAt;
      break;
    }

    consecutiveFailureCount += 1;
  }

  return {
    sourceId,
    ...(lastSuccessfulCrawlAt === undefined ? {} : { lastSuccessfulCrawlAt }),
    consecutiveFailureCount,
    ...(sortedObservations[0]?.successful===false&&sortedObservations[0].portableRetryNotBefore
      ?{retryNotBefore:sortedObservations[0].portableRetryNotBefore}:{})
  };
}
