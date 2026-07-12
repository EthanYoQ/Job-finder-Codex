import {
  formatP0CrawlResult,
  parseP0CrawlArgs,
  p0CrawlBatchExitCode,
  requireP0RuntimeIdentity,
  runP0CrawlCommand
} from "../src/crawler/p0CrawlCommand";
import {runFormalCleanup} from "../src/crawler/formalCleanup";
import { resolve } from "node:path";
import {
  buildExceptionalCrawlSummary,
  collectConsecutiveFailuresByCompany,
  runAndPublishCrawlSummary,
  writeCrawlSummaryAtomic
} from "../src/crawler/crawlSummary";

function printHelp(): void {
  console.log("Usage: npm run p0:crawl -- [--force]");
  console.log("");
  console.log("Runs configured P0 official-source crawl plans and persists observations to PostgreSQL.");
  console.log("Use --force to bypass the schedule gate for manual validation crawls.");
  console.log("Formal release identity is derived from the running build and startup-pinned authorities.");
}

let options: ReturnType<typeof parseP0CrawlArgs>;
try {
  const forbiddenIdentityFlags=["release-candidate-id","commit-sha","roster-sha256","source-plan-sha256","source-config-sha256","adapter-bundle-sha256","batch-kind","owner-id"].map(name=>`--${name}`);
  const suppliedForbidden=process.argv.slice(2).find(arg=>forbiddenIdentityFlags.includes(arg));
  if(suppliedForbidden)throw new Error(`Unknown argument: ${suppliedForbidden}; caller-supplied release identity is forbidden`);
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

const [{ candidateCompanies }, { buildSourceCrawlPlans }] = await Promise.all([
  import("../src/data/companyRegistry"),
  import("../src/crawler/sourcePlan")
]);

const plans = buildSourceCrawlPlans(candidateCompanies);
const crawlSummaryPath = process.env.CRAWL_SUMMARY_PATH ?? resolve(process.cwd(), "outputs", "crawl-summary.json");
const crawlCapturedAt = new Date();
let identity: ReturnType<typeof requireP0RuntimeIdentity>;
try {
  if(options.sourceIds.length>0)throw new Error("Partial diagnostic selection cannot certify formal release evidence");
  const { loadCurrentReleaseIdentity }=await import("../src/readiness/currentReleaseIdentity");
  const current=await loadCurrentReleaseIdentity();
  identity=requireP0RuntimeIdentity({help:false,sourceIds:[],force:options.force,identity:{
    releaseCandidateId:current.releaseCandidateId,commitSha:current.commitSha,rosterSha256:current.rosterSha256,
    sourcePlanSha256:current.sourcePlanSha256,sourceConfigSha256:current.sourceConfigSha256,
    adapterBundleSha256:current.adapterBundleSha256,batchKind:"FULL_RELEASE",ownerId:"formal-crawler",
    expectedPlannedSourceIds:current.plannedSourceIds,expectedPlannedSourceSetSha256:current.plannedSourceSetSha256,
    expectedPlannedSourceCount:current.plannedSourceIds.length
  }});
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const { assertFormalBrowserReady } = await import("../src/readiness/formalBrowserPreflight");
const [{acquireFormalAdvisoryLock},{acquireFormalCrawlLock,FORMAL_CRAWL_LOCK_PATH},{unlink}]=await Promise.all([
  import("../src/crawler/formalAdvisoryLock"),import("../src/crawler/formalCrawlLock"),import("node:fs/promises")]);
let advisoryLock:Awaited<ReturnType<typeof acquireFormalAdvisoryLock>>|undefined;
let fileLock:Awaited<ReturnType<typeof acquireFormalCrawlLock>>|undefined;
let prisma:{ $disconnect():Promise<void> }|undefined;
let loadPersistedFailures:(()=>Promise<Record<string,number>>)|undefined;
let summaryPublished=false;
try{
advisoryLock=await acquireFormalAdvisoryLock({databaseUrl:process.env.DATABASE_URL??""});
fileLock=await acquireFormalCrawlLock();
await assertFormalBrowserReady();

const [
  { PrismaClient },
  { syncPlannedSourcesToDb },
  { createPrismaCrawlRuntimeDeps },
  { runP0CrawlBatch },
  { createMokaSourceFetch },
  { createHttpHtmlSourceFetch },
  { createWorkdaySourceFetch },
  { createHotjobWecruitSourceFetch },
  { createHotjobLegacySourceFetch },
  { createOfficialJsonSourceFetch },
  { createUnsupportedSourceFetch },
  { createSourceFetchRouter }
] = await Promise.all([
  import("@prisma/client"),
  import("../src/db/companyRegistrySync"),
  import("../src/db/crawlRuntimeRepository"),
  import("../src/crawler/runCrawlBatch"),
  import("../src/crawler/mokaSourceFetch"),
  import("../src/crawler/httpHtmlSourceFetch"),
  import("../src/crawler/workdaySourceFetch"),
  import("../src/crawler/hotjobWecruitSourceFetch"),
  import("../src/crawler/hotjobLegacySourceFetch"),
  import("../src/crawler/officialJsonSourceFetch"),
  import("../src/crawler/unsupportedSourceFetch"),
  import("../src/crawler/sourceFetchRouter")
]);

const fetch = createSourceFetchRouter({
  moka: createMokaSourceFetch(),
  html: createHttpHtmlSourceFetch(),
  officialJson: createOfficialJsonSourceFetch(),
  workday: createWorkdaySourceFetch(),
  hotjob: createHotjobWecruitSourceFetch(),
  hotjobLegacy: createHotjobLegacySourceFetch(),
  fallback: createUnsupportedSourceFetch()
});

prisma = new PrismaClient();
  const runtimeDeps=createPrismaCrawlRuntimeDeps(prisma);
  loadPersistedFailures=()=>collectConsecutiveFailuresByCompany(
    plans.map(plan=>({companyId:plan.company.id,sourceId:plan.source.id})),
    runtimeDeps.getRecentObservations
  );

  const result = await runAndPublishCrawlSummary({
    identity,
    capturedAt:crawlCapturedAt,
    run:()=>runP0CrawlCommand({
      plans,
      companies: candidateCompanies,
      options,
      identity,
      db: prisma!,
      fetch,
      now: () => new Date(),
      syncPlannedSourcesToDb,
      createRuntimeDeps:()=>runtimeDeps,
      runP0CrawlBatch
    }),
    loadConsecutiveFailuresByCompany:loadPersistedFailures,
    publish:async summary=>{
      await writeCrawlSummaryAtomic(crawlSummaryPath,summary);
      summaryPublished=true;
    }
  });

  console.log(formatP0CrawlResult(result));
  process.exitCode = p0CrawlBatchExitCode(result.batch);
 }catch(error){
   if(!summaryPublished){
     let persistedFailures:Record<string,number>|null=null;
     if(loadPersistedFailures){
       try{persistedFailures=await loadPersistedFailures();}catch{persistedFailures=null;}
     }
     await writeCrawlSummaryAtomic(crawlSummaryPath,buildExceptionalCrawlSummary({
       identity,capturedAt:crawlCapturedAt,finishedAt:new Date(),consecutiveFailuresByCompany:persistedFailures
     }));
     summaryPublished=true;
   }
   throw error;
 }finally{
  await runFormalCleanup([
    ...(prisma?[{name:"Prisma disconnect",run:()=>prisma!.$disconnect()}]:[]),
    ...(fileLock?[{name:"filesystem lock close",run:()=>fileLock!.close()},{name:"filesystem lock unlink",run:()=>unlink(FORMAL_CRAWL_LOCK_PATH).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;})}]:[]),
    ...(advisoryLock?[{name:"PostgreSQL advisory lock release",run:()=>advisoryLock!.release()}]:[])
  ]);
}
