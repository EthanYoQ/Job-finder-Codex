import { hostname } from "node:os";
import { PrismaClient } from "@prisma/client";
import { candidateCompanies } from "../src/data/companyRegistry";
import { createManualCrawlRequestRepository } from "../src/db/manualCrawlRequestRepository";
import { createPrismaCrawlRuntimeDeps } from "../src/db/crawlRuntimeRepository";
import { createHotjobLegacySourceFetch } from "../src/crawler/hotjobLegacySourceFetch";
import { createHotjobWecruitSourceFetch } from "../src/crawler/hotjobWecruitSourceFetch";
import { createHttpHtmlSourceFetch } from "../src/crawler/httpHtmlSourceFetch";
import { createManualSourceBatchExecutor } from "../src/crawler/manualSourceBatchExecutor";
import { runManualCrawlWorker } from "../src/crawler/manualCrawlWorker";
import { parseManualCrawlWorkerArgs } from "../src/crawler/manualCrawlWorkerCli";
import { createMokaSourceFetch } from "../src/crawler/mokaSourceFetch";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch";
import { runP0CrawlBatch } from "../src/crawler/runCrawlBatch";
import { createSourceFetchRouter } from "../src/crawler/sourceFetchRouter";
import { buildSourceCrawlPlans } from "../src/crawler/sourcePlan";
import { createUnsupportedSourceFetch } from "../src/crawler/unsupportedSourceFetch";
import { createWorkdaySourceFetch } from "../src/crawler/workdaySourceFetch";
import { loadCurrentReleaseIdentity } from "../src/readiness/currentReleaseIdentity";

function printHelp(): void {
  console.log("Usage: npm run p0:manual-crawl-worker -- [--once]");
  console.log("Consumes eligible ManualCrawlRequest rows; --once drains the queue and exits when idle.");
}

let options: ReturnType<typeof parseManualCrawlWorkerArgs>;
try {
  options = parseManualCrawlWorkerArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid manual crawl worker arguments");
  printHelp();
  process.exit(2);
}
if (options.help) {
  printHelp();
  process.exit(0);
}

const ownerId = process.env.P0_MANUAL_CRAWL_WORKER_ID?.trim() || `manual-${hostname()}-${process.pid}`;
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort());
}

const prisma = new PrismaClient();
try {
  const plans = buildSourceCrawlPlans(candidateCompanies);
  const baseIdentity = await loadCurrentReleaseIdentity();
  const fetch = createSourceFetchRouter({
    moka: createMokaSourceFetch(),
    html: createHttpHtmlSourceFetch(),
    officialJson: createOfficialJsonSourceFetch(),
    workday: createWorkdaySourceFetch(),
    hotjob: createHotjobWecruitSourceFetch(),
    hotjobLegacy: createHotjobLegacySourceFetch(),
    fallback: createUnsupportedSourceFetch()
  });
  const repository = createManualCrawlRequestRepository({ db: prisma });
  const executeSource = createManualSourceBatchExecutor({
    plans,
    baseIdentity,
    db: prisma,
    fetch,
    runtimeDeps: createPrismaCrawlRuntimeDeps(prisma),
    now: () => new Date(),
    runP0CrawlBatch
  });
  const result = await runManualCrawlWorker({
    repository,
    executeSource,
    ownerId,
    signal: controller.signal,
    stopWhenIdle: options.stopWhenIdle,
    onOperationalError: (event) => console.error(JSON.stringify({ component: "manual-crawl-worker", ...event }))
  });
  console.log(JSON.stringify({ component: "manual-crawl-worker", state: "STOPPED", ...result }));
} finally {
  await prisma.$disconnect();
}
