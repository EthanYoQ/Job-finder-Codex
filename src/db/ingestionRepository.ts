import type { PrismaClient } from "@prisma/client";
import type { IngestionCommand } from "../crawler/ingestion";
import {
  toPrismaJobCategory,
  toPrismaLifecycleStatus,
  toPrismaRequiredJobField
} from "./prismaMappers";

export type PrismaIngestionDb = Pick<PrismaClient, "crawlObservation" | "job">;

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
          failureReason: command.observation.failureReason
        }
      });

      continue;
    }

    const primaryCity = command.record.cities[0];

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
        sourceJobId: command.record.sourceJobId,
        officialTitle: command.record.officialTitle,
        auxiliaryChineseTitle: command.record.auxiliaryChineseTitle,
        officialUrl: command.record.officialUrl,
        listUrl: command.record.listUrl,
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
        sourceJobId: command.record.sourceJobId,
        officialTitle: command.record.officialTitle,
        auxiliaryChineseTitle: command.record.auxiliaryChineseTitle,
        officialUrl: command.record.officialUrl,
        listUrl: command.record.listUrl,
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

function toOptionalDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}
