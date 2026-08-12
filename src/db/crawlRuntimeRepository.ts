import { toJobSnapshots, type PersistedCrawlObservationRow, type PersistedJobRow } from "./crawlStateRepository";

export interface PrismaCrawlRuntimeDb {
  job: {
    findMany(args: {
      where: { sourceId: string };
      include: {
        source: {
          select: {
            atsKind: true;
            kind: true;
            status: true;
            officialEntryUrl: true;
            officialChainEvidenceUrl: true;
          };
        };
        company: {
          select: {
            officialChineseName: true;
          };
        };
      };
      orderBy: { lastSeenAt: "desc" };
    }): Promise<PersistedJobRow[]>;
  };
  crawlObservation: {
    findMany(args: {
      where: { sourceId: string; batch: { is: { kind: { not: "MANUAL_SOURCE" } } } };
      select: { crawledAt: true; successful: true };
      orderBy: { crawledAt: "desc" };
      take: 10;
    }): Promise<PersistedCrawlObservationRow[]>;
    findFirst(args: {
      where: { sourceId: string; successful: true;
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } } };
      select: { id: true };
      orderBy: { crawledAt: "asc" };
    }): Promise<{ id: string } | null>;
  };
}

export function createPrismaCrawlRuntimeDeps(db: PrismaCrawlRuntimeDb) {
  return {
    async getPreviousJobs(sourceId: string) {
      const rows = await db.job.findMany({
        where: { sourceId },
        include: {
          source: {
            select: {
              atsKind: true,
              kind: true,
              status: true,
              officialEntryUrl: true,
              officialChainEvidenceUrl: true
            }
          },
          company: {
            select: {
              officialChineseName: true
            }
          }
        },
        orderBy: { lastSeenAt: "desc" }
      });

      return toJobSnapshots(rows);
    },
    async getRecentObservations(sourceId: string) {
      return db.crawlObservation.findMany({
        where: { sourceId, batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
        select: { crawledAt: true, successful: true },
        orderBy: { crawledAt: "desc" },
        take: 10
      });
    },
    async isBaselineCompleted(sourceId: string) {
      const firstSuccess = await db.crawlObservation.findFirst({
        where: { sourceId, successful: true,
          batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
        select: { id: true },
        orderBy: { crawledAt: "asc" }
      });

      return firstSuccess !== null;
    }
  };
}
