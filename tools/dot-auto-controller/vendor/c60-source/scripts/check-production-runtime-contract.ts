import { readFileSync } from "node:fs";
import { buildStagedSourceCrawlPlans } from "../src/crawler/sourcePlan";
import { requiresBGradeTraversalCertificate } from "../src/crawler/traversalCertificate";
import { candidateCompanies } from "../src/data/companyRegistry";
import { extractProductionImageStage, PRODUCTION_BROWSER_DEB_SHA256, PRODUCTION_BROWSER_DEB_URL,
  PRODUCTION_RUNTIME_APT_COMMAND } from "../src/readiness/productionImageContract";

const plans = buildStagedSourceCrawlPlans(candidateCompanies);
const browserRequired = plans.some((plan) =>
  plan.transportPolicy?.fallback === "BROWSER_SESSION" || requiresBGradeTraversalCertificate(plan)
);
const dockerfile = readFileSync("Dockerfile", "utf8");
const runtimeStage = extractProductionImageStage(dockerfile, "runtime");
const chromiumInstalled = runtimeStage.includes(PRODUCTION_RUNTIME_APT_COMMAND) &&
  runtimeStage.includes(PRODUCTION_BROWSER_DEB_URL) && runtimeStage.includes(PRODUCTION_BROWSER_DEB_SHA256);

if (browserRequired !== chromiumInstalled) {
  throw new Error(
    `Production Chromium contract mismatch: source plans require browser=${browserRequired}, image installs browser=${chromiumInstalled}`
  );
}

console.log(JSON.stringify({ ok: true, browserRequired, chromiumInstalled }));
