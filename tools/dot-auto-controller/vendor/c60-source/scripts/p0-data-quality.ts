import { PrismaClient } from "@prisma/client";
import { buildSourceCrawlPlans } from "../src/crawler/sourcePlan";
import { candidateCompanies } from "../src/data/companyRegistry";
import {
  getP0DataQualityReport,
  type P0DataQualityObservation
} from "../src/readiness/dataQuality";

const args = new Set(process.argv.slice(2));

if (args.has("--help") || !args.has("--db")) {
  console.log("Usage: npm run p0:data-quality -- --db");
  console.log("");
  console.log("Checks current P0 planned sources against persisted observations and visible jobs.");
  process.exit(args.has("--help") ? 0 : 2);
}

void main();

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const plannedSourceIds = plans.map((plan) => plan.source.id);
    const companiesById = new Map(candidateCompanies.map((company) => [company.id, company]));
    const sourceLabelsById = Object.fromEntries(
      plans.map((plan) => [
        plan.source.id,
        `${plan.company.officialChineseName} (${plan.company.id})`
      ])
    );
    const highRiskLowCountSourceIds = plans
      .filter((plan) => {
        const inclusionReason = companiesById.get(plan.company.id)?.inclusionReason;
        return inclusionReason === "外资医药 Top 30" || inclusionReason === "国内制药 Top 30";
      })
      .map((plan) => plan.source.id);
    const [
      latestObservationsBySource,
      activeVisibleJobCountsBySource,
      unplannedActiveVisibleJobCountsBySource
    ] = await Promise.all([
      readLatestObservations(prisma, plannedSourceIds),
      readActiveVisibleJobCounts(prisma, plannedSourceIds),
      readUnplannedActiveVisibleJobCounts(prisma, plannedSourceIds)
    ]);
    const report = getP0DataQualityReport({
      plannedSourceIds,
      latestObservationsBySource,
      activeVisibleJobCountsBySource,
      unplannedActiveVisibleJobCountsBySource,
      highRiskLowCountSourceIds
    });

    printReport(report, sourceLabelsById);
    process.exitCode = report.canPass ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

async function readUnplannedActiveVisibleJobCounts(
  prisma: PrismaClient,
  plannedSourceIds: readonly string[]
): Promise<Record<string, number>> {
  const rows = await prisma.job.groupBy({
    by: ["sourceId"],
    where: {
      NOT: {
        sourceId: { in: [...plannedSourceIds] }
      },
      lifecycleStatus: "ACTIVE",
      visibleInFrontend: true
    },
    _count: true
  });

  return Object.fromEntries(rows.map((row) => [row.sourceId, row._count]));
}

async function readLatestObservations(
  prisma: PrismaClient,
  plannedSourceIds: readonly string[]
): Promise<Record<string, P0DataQualityObservation | undefined>> {
  const entries = await Promise.all(
    plannedSourceIds.map(async (sourceId) => {
      const observation = await prisma.crawlObservation.findFirst({
        where: { sourceId },
        orderBy: { crawledAt: "desc" },
        select: {
          successful: true,
          structuredJobCount: true,
          expectedJobCount: true,
          completenessStatus: true,
          completenessEvidenceKind: true,
          completenessEvidenceUrl: true,
          completenessBlockerReason: true,
          crawledAt: true,
          failureReason: true
        }
      });

      return [sourceId, observation ?? undefined] as const;
    })
  );

  return Object.fromEntries(entries);
}

async function readActiveVisibleJobCounts(
  prisma: PrismaClient,
  plannedSourceIds: readonly string[]
): Promise<Record<string, number>> {
  const rows = await prisma.job.groupBy({
    by: ["sourceId"],
    where: {
      sourceId: { in: [...plannedSourceIds] },
      lifecycleStatus: "ACTIVE",
      visibleInFrontend: true
    },
    _count: true
  });

  return Object.fromEntries(rows.map((row) => [row.sourceId, row._count]));
}

function printReport(
  report: ReturnType<typeof getP0DataQualityReport>,
  sourceLabelsById: Readonly<Record<string, string>>
): void {
  console.log("# P0 Data Quality Report");
  console.log("");
  console.log(`Can pass: ${report.canPass ? "yes" : "no"}`);
  console.log(`Planned sources: ${report.plannedSourceCount}`);
  console.log(`Issues: ${report.issueCount}`);

  if (report.issues.length > 0) {
    console.log("");
    console.log("## Issues");
    for (const issue of report.issues) {
      const details = [
        `company=${sourceLabelsById[issue.sourceId] ?? "unplanned/unknown"}`,
        `source=${issue.sourceId}`,
        `observed=${issue.observedCount ?? "n/a"}`,
        `expected=${issue.expectedCount ?? "n/a"}`,
        `activeVisible=${issue.activeVisibleCount ?? "n/a"}`,
        `status=${issue.completenessStatus ?? "n/a"}`,
        `evidenceKind=${issue.evidenceKind ?? "n/a"}`,
        `evidenceUrl=${issue.evidenceUrl ?? "n/a"}`,
        `blocker=${issue.blockerReason ?? issue.message}`
      ].join("; ");
      console.log(`- ${issue.code}: ${details}`);
    }
  }
}
