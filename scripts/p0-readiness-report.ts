import { getP0ReadinessReport, type P0ReadinessReport } from "../src/readiness/p0Readiness";
import { getP0ReadinessReportFromDb } from "../src/readiness/prismaReadiness";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log("Usage: npm run p0:readiness -- [--db]");
  console.log("");
  console.log("Without --db, uses the static candidate registry and no persisted observations.");
  console.log("With --db, reads companies, sources, and the latest two crawl observations per source from PostgreSQL.");
  process.exit(0);
}

void main();

async function main(): Promise<void> {
  const report = args.has("--db") ? await reportFromDb() : getP0ReadinessReport();

  printReport(report);
  process.exitCode = report.canLaunchP0 ? 0 : 1;
}

async function reportFromDb(): Promise<P0ReadinessReport> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    return await getP0ReadinessReportFromDb(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

function printReport(report: P0ReadinessReport): void {
  console.log("# P0 Readiness Report");
  console.log("");
  console.log(`Can launch P0: ${report.canLaunchP0 ? "yes" : "no"}`);
  console.log(`Candidate companies: ${report.totalCandidates}`);
  console.log(`Declared verified social sources: ${report.declaredVerifiedSocialSources}`);
  console.log(`Configured verified social sources: ${report.configuredVerifiedSocialSources}`);
  console.log(
    `Crawl-evidenced verified companies: ${report.crawlEvidencedVerifiedCompanies}/${report.requiredVerifiedCompanies}`
  );

  if (report.verifiedSourcesMissingCrawlPlan.length > 0) {
    console.log("");
    console.log("## Verified sources missing crawl plans");
    for (const issue of report.verifiedSourcesMissingCrawlPlan) {
      console.log(`- ${issue.companyName} (${issue.companyId}, ${issue.sourceId})`);
    }
  }

  if (report.blockers.length > 0) {
    console.log("");
    console.log("## Blockers");
    for (const blocker of report.blockers) {
      console.log(`- ${blocker.code}: ${blocker.message}`);
    }
  }
}
