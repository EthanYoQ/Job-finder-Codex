import type { IngestionCommand } from "../crawler/ingestion";
import {
  toPrismaJobCategory,
  toPrismaLifecycleStatus,
  toPrismaRequiredJobField,
  type PrismaJobCategoryName,
  type PrismaLifecycleStatusName,
  type PrismaRequiredJobFieldName
} from "./prismaMappers";

interface CrawlObservationCreateArgs {
  data: {
    sourceId: string;
    batchId: string;
    crawledAt: Date;
    successful: boolean;
    structuredJobCount: number;
    stableRequiredFields: PrismaRequiredJobFieldName[];
    failureReason: string | null;
  };
}

interface JobUpsertData {
  companyId: string;
  sourceId: string;
  dedupeKey: string;
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
  visibleInFrontend: boolean;
  isNew: boolean;
}

interface JobUpdateData {
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
  lastSeenAt: Date;
  missingSuccessCount: number;
  lifecycleStatus: PrismaLifecycleStatusName;
  visibleInFrontend: boolean;
  isNew: boolean;
}

interface JobUpsertArgs {
  where: {
    sourceId_dedupeKey: {
      sourceId: string;
      dedupeKey: string;
    };
  };
  create: JobUpsertData;
  update: JobUpdateData;
}

export interface PrismaIngestionDb {
  crawlObservation: {
    create(args: CrawlObservationCreateArgs): Promise<unknown>;
  };
  job: {
    upsert(args: JobUpsertArgs): Promise<unknown>;
  };
}

export interface IngestionExecutionContext {
  batchId: string;
}

export async function executeIngestionCommands(
  commands: readonly IngestionCommand[],
  context: IngestionExecutionContext,
  db: PrismaIngestionDb
): Promise<void> {
  for (const command of commands) {
    if (command.type === "UPSERT_CRAWL_OBSERVATION") {
      await db.crawlObservation.create({
        data: {
          sourceId: command.observation.sourceId,
          batchId: context.batchId,
          crawledAt: command.observation.crawledAt,
          successful: command.observation.successful,
          structuredJobCount: command.observation.structuredJobCount,
          stableRequiredFields: command.observation.stableRequiredFields.map(
            toPrismaRequiredJobField
          ),
          failureReason: command.observation.failureReason ?? null
        }
      });

      continue;
    }

    const primaryCity = command.record.cities[0];
    if (!primaryCity) {
      throw new Error(`Cannot ingest job ${command.dedupeKey} without at least one city`);
    }

    await db.job.upsert({
      where: {
        sourceId_dedupeKey: {
          sourceId: command.record.sourceId,
          dedupeKey: command.dedupeKey
        }
      },
      create: {
        companyId: command.record.companyId,
        sourceId: command.record.sourceId,
        dedupeKey: command.dedupeKey,
        sourceJobId: command.record.sourceJobId ?? null,
        officialTitle: command.record.officialTitle,
        auxiliaryChineseTitle: command.record.auxiliaryChineseTitle ?? null,
        officialUrl: command.record.officialUrl,
        listUrl: command.record.listUrl ?? null,
        locationRaw: command.record.locationRaw,
        city: primaryCity,
        cities: [...command.record.cities],
        category: toPrismaJobCategory(command.record.category),
        officialPublishedAt: toOptionalDate(command.record.officialPublishedAt),
        firstSeenAt: new Date(command.firstSeenAt),
        lastSeenAt: new Date(command.lastSeenAt),
        missingSuccessCount: command.missingSuccessfulCrawlCount,
        lifecycleStatus: toPrismaLifecycleStatus(command.lifecycleStatus),
        visibleInFrontend: command.visibleInFrontend,
        isNew: command.isNew
      },
      update: {
        sourceJobId: command.record.sourceJobId ?? null,
        officialTitle: command.record.officialTitle,
        auxiliaryChineseTitle: command.record.auxiliaryChineseTitle ?? null,
        officialUrl: command.record.officialUrl,
        listUrl: command.record.listUrl ?? null,
        locationRaw: command.record.locationRaw,
        city: primaryCity,
        cities: [...command.record.cities],
        category: toPrismaJobCategory(command.record.category),
        officialPublishedAt: toOptionalDate(command.record.officialPublishedAt),
        lastSeenAt: new Date(command.lastSeenAt),
        missingSuccessCount: command.missingSuccessfulCrawlCount,
        lifecycleStatus: toPrismaLifecycleStatus(command.lifecycleStatus),
        visibleInFrontend: command.visibleInFrontend,
        isNew: command.isNew
      }
    });
  }
}

function toOptionalDate(value: string | undefined): Date | null {
  return value === undefined ? null : new Date(value);
}
