export type ManualCrawlRequestStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED";

export interface RecentManualCrawlStatus {
  id: string;
  sourceId: string;
  status: ManualCrawlRequestStatus;
  attemptCount: number;
  crawlBatchId: string | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ManualCrawlStatusDb {
  manualCrawlRequest: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      sourceId: string;
      status: ManualCrawlRequestStatus;
      attemptCount: number;
      crawlBatchId: string | null;
      failureCode: string | null;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
    }>>;
  };
}

export async function listRecentManualCrawlStatuses(db: ManualCrawlStatusDb): Promise<RecentManualCrawlStatus[]> {
  const rows = await db.manualCrawlRequest.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sourceId: true,
      status: true,
      attemptCount: true,
      crawlBatchId: true,
      failureCode: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true
    },
    take: 50
  });
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null
  }));
}
