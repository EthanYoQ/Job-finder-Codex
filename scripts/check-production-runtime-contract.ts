import { readFileSync } from "node:fs";
import { buildStagedSourceCrawlPlans } from "../src/crawler/sourcePlan";
import { requiresBGradeTraversalCertificate } from "../src/crawler/traversalCertificate";
import { candidateCompanies } from "../src/data/companyRegistry";

const plans = buildStagedSourceCrawlPlans(candidateCompanies);
const browserRequired = plans.some((plan) =>
  plan.transportPolicy?.fallback === "BROWSER_SESSION" || requiresBGradeTraversalCertificate(plan)
);
const dockerfile = readFileSync("Dockerfile", "utf8");
const runtimeStage = dockerfile.match(
  /FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS runtime\b([\s\S]*?)(?=\nFROM\s|$)/u
)?.[1];
if (!runtimeStage) throw new Error("Production image is missing its pinned runtime stage");
const chromiumInstalled = /install-apt-packages\.sh[^\n]*\bchromium\b/u.test(runtimeStage);

if (browserRequired !== chromiumInstalled) {
  throw new Error(
    `Production Chromium contract mismatch: source plans require browser=${browserRequired}, image installs browser=${chromiumInstalled}`
  );
}

console.log(JSON.stringify({ ok: true, browserRequired, chromiumInstalled }));
