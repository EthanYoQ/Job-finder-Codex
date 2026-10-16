import type { P0ReadinessReport } from "../src/readiness/p0Readiness";
import { getStrictP0ReadinessReportFromDb } from "../src/readiness/strictPrismaReadiness";
import { loadCurrentReleaseIdentity } from "../src/readiness/currentReleaseIdentity";

const args = new Set(process.argv.slice(2));
const rawArgs=process.argv.slice(2);
if(rawArgs.some(arg=>arg!=="--db"&&arg!=="--help"))throw new Error("Unknown or forbidden readiness argument");
if(args.has("--help")&&rawArgs.length!==1)throw new Error("Unknown or forbidden readiness argument combination");
if(!args.has("--help")&&(rawArgs.length!==1||!args.has("--db")))throw new Error("Formal readiness requires exactly --db");

if (args.has("--help")) {
  console.log("Usage: npm run p0:readiness -- --db");
  console.log("");
  console.log("Formal readiness is DB-only. Identity is recomputed from startup-trusted artifacts and the running build; legacy observation/path/identity flags are rejected.");
  process.exit(0);
}

void main();

async function main(): Promise<void> {
  const report = await reportFromDb();

  printReport(report);
  process.exitCode = report.canLaunchP0 ? 0 : 1;
}

async function reportFromDb(): Promise<P0ReadinessReport> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    if(process.argv.slice(2).some(arg=>arg!=="--db"))throw new Error("Legacy observation/path/identity readiness flags are forbidden");
    return await getStrictP0ReadinessReportFromDb(prisma as never,await loadCurrentReleaseIdentity());
  } finally {
    await prisma.$disconnect();
  }
}

function printReport(report: P0ReadinessReport): void {
  console.log("# P0 Readiness Report");
  console.log("");
  console.log(`Can launch P0: ${report.canLaunchP0 ? "yes" : "no"}`);
  console.log(`Candidate companies: ${report.totalCandidates}`);
  console.log(`Foreign pharma companies: ${report.foreignPharmaCompanies}`);
  console.log(`Domestic pharma companies: ${report.domesticPharmaCompanies}`);
  console.log(`Required official-link sources: ${report.requiredOfficialLinkSources}`);
  console.log(`Planned official-link sources: ${report.plannedOfficialLinkSources}`);
  console.log(`Crawl-evidenced official-link sources: ${report.crawlEvidencedOfficialLinkSources}`);
  console.log(`No-public-official-careers-link companies: ${report.noPublicOfficialCareersLinkCompanies}`);
  console.log(`Blocking evidence-gap companies: ${report.blockingEvidenceGapCompanies}`);

  if (report.sourcePlanOmissions.length > 0) {
    console.log("");
    console.log("## Required official-link sources missing crawl plans");
    for (const issue of report.sourcePlanOmissions) {
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
