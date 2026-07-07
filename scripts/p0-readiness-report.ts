import { getP0ReadinessReport } from "../src/readiness/p0Readiness";

const report = getP0ReadinessReport();

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

process.exitCode = report.canLaunchP0 ? 0 : 1;
