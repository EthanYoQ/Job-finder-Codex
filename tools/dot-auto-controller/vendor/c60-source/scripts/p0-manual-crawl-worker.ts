import { hostname } from "node:os";
import { PrismaClient } from "@prisma/client";
import { createManualCrawlRequestRepository } from "../src/db/manualCrawlRequestRepository";
import { createPrismaCrawlRuntimeDeps } from "../src/db/crawlRuntimeRepository";
import { createHotjobLegacySourceFetch } from "../src/crawler/hotjobLegacySourceFetch";
import { createHotjobWecruitSourceFetch } from "../src/crawler/hotjobWecruitSourceFetch";
import { createHttpHtmlSourceFetch } from "../src/crawler/httpHtmlSourceFetch";
import { createCurrentAuthorityManualSourceBatchExecutor } from "../src/crawler/manualSourceBatchExecutor";
import { manualCrawlWorkerExitCode, runManualCrawlWorker } from "../src/crawler/manualCrawlWorker";
import { parseManualCrawlWorkerArgs } from "../src/crawler/manualCrawlWorkerCli";
import { createMokaSourceFetch } from "../src/crawler/mokaSourceFetch";
import { createProfileBoundSourceFetch } from "../src/crawler/profileBoundSourceFetch";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch";
import { runP0CrawlBatch } from "../src/crawler/runCrawlBatch";
import { createSourceFetchRouter } from "../src/crawler/sourceFetchRouter";
import { createUnsupportedSourceFetch } from "../src/crawler/unsupportedSourceFetch";
import { createWorkdaySourceFetch } from "../src/crawler/workdaySourceFetch";
import { resolveCurrentStagedScheduleAuthority } from "../src/crawler/stagedScheduleAuthority";

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
  const fetch = createSourceFetchRouter({
    moka: createMokaSourceFetch(),
    html: createHttpHtmlSourceFetch(),
    officialJson: createOfficialJsonSourceFetch(),
    workday: createWorkdaySourceFetch(),
    hotjob: createHotjobWecruitSourceFetch(),
    hotjobLegacy: createHotjobLegacySourceFetch(),
    profileBoundSource: createProfileBoundSourceFetch(),
    fallback: createUnsupportedSourceFetch()
  });
  const resolveAuthority = () => resolveCurrentStagedScheduleAuthority(prisma);
  const repository = createManualCrawlRequestRepository({
    db: prisma,
    resolveClaimableSourceIds: async () => (await resolveAuthority()).plans.map(({ source }) => source.id)
  });
  const executeSource = createCurrentAuthorityManualSourceBatchExecutor({
    resolveAuthority: async () => {
      const authority = await resolveAuthority();
      return { plans: authority.plans, baseIdentity: authority.identity };
    },
    execution: {
      db: prisma,
      fetch,
      runtimeDeps: createPrismaCrawlRuntimeDeps(prisma),
      now: () => new Date(),
      runP0CrawlBatch
    }
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
  process.exitCode = manualCrawlWorkerExitCode(result);
} finally {
  await prisma.$disconnect();
}
