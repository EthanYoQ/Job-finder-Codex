import { toJobSnapshots, type PersistedCrawlObservationRow, type PersistedJobRow } from "./crawlStateRepository";
import {
  assertTrustedBaselineTransition,
  assertTrustedCompletenessBaseline,
  type PersistedTrustedCompletenessBaseline,
} from "../crawler/completenessAnomalyPolicy";

interface PersistedTrustedBaselineRow {
  id: string;
  sourceId: string;
  sourceConfigHash: string;
  dedupeOutputCount: number;
  completenessCertificate: unknown;
  completenessCertificateSha256: string | null;
  finishedAt: Date | null;
  baselinePreviousSourceResultId: string | null;
  baselinePreviousJobCount: number | null;
  baselineChangeReason: string | null;
}

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
    findFirst?(args: {
      where: { sourceId: string; successful: true;
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } } };
      select: { id: true };
      orderBy: { crawledAt: "asc" };
    }): Promise<{ id: string } | null>;
  };
  crawlBatchSourceResult?: {
    findFirst(args: {
      where: {
        sourceId: string;
        completenessState: "VERIFIED";
        atomicCommitState: "COMMITTED";
        completenessCertificateSha256: { not: null };
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } };
      };
      select: {
        id: true;
        sourceId: true;
        sourceConfigHash: true;
        dedupeOutputCount: true;
        completenessCertificate: true;
        completenessCertificateSha256: true;
        finishedAt: true;
        baselinePreviousSourceResultId: true;
        baselinePreviousJobCount: true;
        baselineChangeReason: true;
      };
      orderBy: { finishedAt: "desc" };
    }): Promise<PersistedTrustedBaselineRow | null>;
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
    async getTrustedCompletenessBaseline(sourceId: string) {
      const row = await findTrustedCompletenessBaselineRow(db, sourceId);
      return row === null ? null : toTrustedCompletenessBaseline(row);
    },
    async isBaselineCompleted(sourceId: string) {
      if (!db.crawlObservation.findFirst) return false;
      return (await db.crawlObservation.findFirst({
        where: { sourceId, successful: true,
          batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
        select: { id: true },
        orderBy: { crawledAt: "asc" }
      })) !== null;
    }
  };
}

function findTrustedCompletenessBaselineRow(
  db: PrismaCrawlRuntimeDb,
  sourceId: string
): Promise<PersistedTrustedBaselineRow | null> {
  if (!db.crawlBatchSourceResult) return Promise.resolve(null);
  return db.crawlBatchSourceResult.findFirst({
    where: {
      sourceId,
      completenessState: "VERIFIED",
      atomicCommitState: "COMMITTED",
      completenessCertificateSha256: { not: null },
      batch: { is: { kind: { not: "MANUAL_SOURCE" } } }
    },
    select: {
      id: true,
      sourceId: true,
      sourceConfigHash: true,
      dedupeOutputCount: true,
      completenessCertificate: true,
      completenessCertificateSha256: true,
      finishedAt: true,
      baselinePreviousSourceResultId: true,
      baselinePreviousJobCount: true,
      baselineChangeReason: true
    },
    orderBy: { finishedAt: "desc" }
  });
}

function toTrustedCompletenessBaseline(
  row: PersistedTrustedBaselineRow
): PersistedTrustedCompletenessBaseline {
  if (!row.finishedAt || !row.completenessCertificateSha256 ||
      typeof row.completenessCertificate !== "object" || row.completenessCertificate === null) {
    throw new Error("Persisted trusted baseline certificate row is incomplete");
  }
  const grade = (row.completenessCertificate as { grade?: unknown }).grade;
  if (grade !== "A" && grade !== "B") {
    throw new Error("Persisted trusted baseline certificate grade is invalid");
  }
  let changeReason: PersistedTrustedCompletenessBaseline["changeReason"] = null;
  if (row.baselineChangeReason !== null) {
    changeReason = assertTrustedBaselineTransition({
      previousSourceResultId: row.baselinePreviousSourceResultId,
      previousJobCount: row.baselinePreviousJobCount,
      currentSourceResultId: row.id,
      currentJobCount: row.dedupeOutputCount,
      certificateGrade: grade,
      changeReason: row.baselineChangeReason
    }).changeReason;
  } else if (row.baselinePreviousSourceResultId !== null || row.baselinePreviousJobCount !== null) {
    throw new Error("Persisted trusted baseline previous values require a change reason");
  }
  const baseline: PersistedTrustedCompletenessBaseline = {
    sourceId: row.sourceId,
    sourceResultId: row.id,
    sourceConfigSha256: row.sourceConfigHash,
    certificateGrade: grade,
    certificateSha256: row.completenessCertificateSha256,
    certifiedJobCount: row.dedupeOutputCount,
    verifiedAt: row.finishedAt.toISOString(),
    certificate: row.completenessCertificate,
    previousSourceResultId: row.baselinePreviousSourceResultId,
    previousJobCount: row.baselinePreviousJobCount,
    changeReason
  };
  assertTrustedCompletenessBaseline(baseline);
  return baseline;
}
