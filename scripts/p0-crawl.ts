import { PrismaClient } from "@prisma/client";
import { candidateCompanies } from "../src/data/companyRegistry";
import { syncPlannedSourcesToDb } from "../src/db/companyRegistrySync";
import { createPrismaCrawlRuntimeDeps } from "../src/db/crawlRuntimeRepository";
import {
  formatP0CrawlResult,
  parseP0CrawlArgs,
  runP0CrawlCommand,
  selectP0CrawlPlans
} from "../src/crawler/p0CrawlCommand";
import { runP0CrawlBatch } from "../src/crawler/runCrawlBatch";
import { createMokaSourceFetch } from "../src/crawler/mokaSourceFetch";
import { createHttpHtmlSourceFetch } from "../src/crawler/httpHtmlSourceFetch";
import { createUnsupportedSourceFetch } from "../src/crawler/unsupportedSourceFetch";
import { createSourceFetchRouter } from "../src/crawler/sourceFetchRouter";
import { buildSourceCrawlPlans } from "../src/crawler/sourcePlan";

function printHelp(): void {
  console.log("Usage: npm run p0:crawl -- [--source-id <sourceId>] [--force]");
  console.log("");
  console.log("Runs configured P0 official-source crawl plans and persists observations to PostgreSQL.");
  console.log("Use --source-id more than once to run selected sources only.");
  console.log("Use --force to bypass the schedule gate for manual validation crawls.");
}

let options: ReturnType<typeof parseP0CrawlArgs>;
try {
  options = parseP0CrawlArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  printHelp();
  process.exit(2);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

const plans = buildSourceCrawlPlans(candidateCompanies);
let selectedPlans: ReturnType<typeof selectP0CrawlPlans>;
try {
  selectedPlans = selectP0CrawlPlans(plans, options);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const fetch = createSourceFetchRouter({
  moka: createMokaSourceFetch(),
  html: createHttpHtmlSourceFetch(),
  fallback: createUnsupportedSourceFetch()
});

const prisma = new PrismaClient();

try {
  const result = await runP0CrawlCommand({
    plans: selectedPlans,
    companies: candidateCompanies,
    options: { help: false, sourceIds: [], force: options.force },
    db: prisma,
    fetch,
    now: () => new Date(),
    syncPlannedSourcesToDb,
    createRuntimeDeps: createPrismaCrawlRuntimeDeps,
    runP0CrawlBatch
  });

  console.log(formatP0CrawlResult(result));
  process.exitCode = result.batch.failedSourceCount > 0 ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
