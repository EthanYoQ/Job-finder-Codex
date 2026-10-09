import type { CrawlAdapterResult } from "./adapters/types";
import type { LifecycleDecision, LifecycleStatus } from "./lifecycle";
import type { NormalizedJobRecord } from "./normalizedJob";

export type IngestionCommand =
  | {
      type: "UPSERT_CRAWL_OBSERVATION";
      observation: CrawlAdapterResult["observation"];
    }
  | {
      type: "UPSERT_JOB";
      dedupeKey: string;
      record: NormalizedJobRecord;
      lifecycleStatus: LifecycleStatus;
      visibleInFrontend: boolean;
      isNew: boolean;
      firstSeenAt: string;
      lastSeenAt: string;
      missingSuccessfulCrawlCount: number;
    };

export function buildIngestionCommands(
  result: CrawlAdapterResult,
  lifecycleDecisions: readonly LifecycleDecision[]
): IngestionCommand[] {
  const commands: IngestionCommand[] = [
    {
      type: "UPSERT_CRAWL_OBSERVATION",
      observation: result.observation
    }
  ];

  if (result.status !== "SUCCESS") {
    return commands;
  }

  for (const decision of lifecycleDecisions) {
    commands.push({
      type: "UPSERT_JOB",
      dedupeKey: decision.dedupeKey,
      record: decision.record,
      lifecycleStatus: decision.lifecycleStatus,
      visibleInFrontend: decision.lifecycleStatus === "ACTIVE",
      isNew: decision.isNew,
      firstSeenAt: decision.firstSeenAt,
      lastSeenAt: decision.lastSeenAt,
      missingSuccessfulCrawlCount: decision.missingSuccessfulCrawlCount
    });
  }

  return commands;
}
