import {
  formatP0CrawlResult,
  parseP0CrawlArgs,
  p0CrawlBatchExitCode,
  requireP0RuntimeIdentity,
  runP0CrawlCommand
} from "../src/crawler/p0CrawlCommand";
import {runFormalCleanup} from "../src/crawler/formalCleanup";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  collectConsecutiveFailuresByCompany,
  crawlEvidenceIdentityFromRuntime,
  runAndPublishCrawlSummary,
  writeCrawlSummaryAtomic
} from "../src/crawler/crawlSummary";
import { buildCrawlAttemptEvent, writeCrawlAttemptEvent, type CrawlAttemptFailureCode } from "../src/crawler/crawlAttemptEvidence";
import { classifyCrawlAttemptFailure } from "../src/crawler/crawlAttemptOrchestration";

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

const crawlSummaryPath = process.env.CRAWL_SUMMARY_PATH ?? resolve(process.cwd(), "outputs", "crawl-summary.json");
const crawlAttemptDir = process.env.CRAWL_ATTEMPT_DIR ?? resolve(process.cwd(), "outputs", "crawl-attempts");
const crawlCapturedAt = new Date();
const attemptId = process.env.P0_CRAWL_ATTEMPT_ID ?? randomUUID();
const attemptStartedAt = process.env.P0_CRAWL_ATTEMPT_STARTED_AT ? new Date(process.env.P0_CRAWL_ATTEMPT_STARTED_AT) : crawlCapturedAt;
const schedulerOwnsAttempt = process.env.P0_CRAWL_ATTEMPT_OWNER === "scheduler";
const attemptAuthority = { advisoryLockAcquired: false, fileLockAcquired: false };
if (!schedulerOwnsAttempt) await writeCrawlAttemptEvent(crawlAttemptDir, buildCrawlAttemptEvent({
  attemptId, state: "RUNNING", startedAt: attemptStartedAt, finishedAt: null, identity: null,
  authority: attemptAuthority, canonicalSummaryBinding: null, failureCode: null
}));
let candidateCompanies: typeof import("../src/data/companyRegistry")["candidateCompanies"];
let plans: ReturnType<typeof import("../src/crawler/sourcePlan")["buildSourceCrawlPlans"]>;
let identity: ReturnType<typeof requireP0RuntimeIdentity>;
try {
  if(options.sourceIds.length>0)throw new Error("Partial diagnostic selection cannot certify formal release evidence");
  for(const name of ["P0_FULL_RELEASE_MEMBERSHIP_FILE","P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256",
    "P0_FULL_RELEASE_ORACLE_FILE","P0_FULL_RELEASE_ORACLE_FILE_SHA256"]){
    if(!process.env[name]?.trim())throw new Error(`Production release authority is unavailable: ${name}`);
  }
  const [registry, sourcePlan] = await Promise.all([
    import("../src/data/companyRegistry"), import("../src/crawler/sourcePlan")
  ]);
  candidateCompanies=registry.candidateCompanies;
  plans=sourcePlan.buildSourceCrawlPlans(candidateCompanies);
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
  await writeCrawlAttemptEvent(crawlAttemptDir, buildCrawlAttemptEvent({
    attemptId, state: "FAILED", startedAt: attemptStartedAt, finishedAt: new Date(), identity: null,
    authority: attemptAuthority, canonicalSummaryBinding: null, failureCode: "PRE_IDENTITY_FAILED"
  }));
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

let preflightModules:[
  typeof import("../src/readiness/formalBrowserPreflight"),
  typeof import("../src/crawler/formalAdvisoryLock"),
  typeof import("../src/crawler/formalCrawlLock"),
  typeof import("node:fs/promises")
];
try{preflightModules=await Promise.all([import("../src/readiness/formalBrowserPreflight"),
  import("../src/crawler/formalAdvisoryLock"),import("../src/crawler/formalCrawlLock"),import("node:fs/promises")]);}
catch(error){
  await writeCrawlAttemptEvent(crawlAttemptDir,buildCrawlAttemptEvent({attemptId,state:"FAILED",
    startedAt:attemptStartedAt,finishedAt:new Date(),identity:crawlEvidenceIdentityFromRuntime(identity),authority:attemptAuthority,
    canonicalSummaryBinding:null,failureCode:"PREFLIGHT_FAILED"}));
  throw error;
}
const [{assertFormalBrowserReady},{acquireFormalAdvisoryLock},{acquireFormalCrawlLock,FORMAL_CRAWL_LOCK_PATH},{unlink}]=preflightModules;
let advisoryLock:Awaited<ReturnType<typeof acquireFormalAdvisoryLock>>|undefined;
let fileLock:Awaited<ReturnType<typeof acquireFormalCrawlLock>>|undefined;
let prisma:{ $disconnect():Promise<void> }|undefined;
let loadPersistedFailures:(()=>Promise<Record<string,number>>)|undefined;
let canonicalSummaryWriteAttempted=false;
let summaryBinding:{batchId:string;summarySha256:string}|undefined;
let commandResult:Awaited<ReturnType<typeof runP0CrawlCommand>>|undefined;
let terminalError:unknown;
let failureCode:CrawlAttemptFailureCode="CRAWL_EXECUTION_FAILED";
let executionStarted=false;
let operationStage:"EXECUTION"|"SOURCE_HEALTH"|"PUBLISH"|undefined;
try{
advisoryLock=await acquireFormalAdvisoryLock({databaseUrl:process.env.DATABASE_URL??""});
attemptAuthority.advisoryLockAcquired=true;
fileLock=await acquireFormalCrawlLock();
attemptAuthority.fileLockAcquired=true;
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
  { createProfileBoundSourceFetch },
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
  import("../src/crawler/profileBoundSourceFetch"),
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
  profileBoundSource: createProfileBoundSourceFetch(),
  fallback: createUnsupportedSourceFetch()
});

prisma = new PrismaClient();
  const runtimeDeps=createPrismaCrawlRuntimeDeps(prisma);
  loadPersistedFailures=()=>collectConsecutiveFailuresByCompany(
    plans.map(plan=>({companyId:plan.company.id,sourceId:plan.source.id})),
    runtimeDeps.getRecentObservations
  );

  executionStarted=true;
  commandResult = await runAndPublishCrawlSummary({
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
    onStage:stage=>{operationStage=stage;},
    publish:async summary=>{
      if(!advisoryLock||!fileLock)throw new Error("Canonical crawl summary requires both formal locks");
      if(canonicalSummaryWriteAttempted)throw new Error("Canonical crawl summary write already attempted");
      canonicalSummaryWriteAttempted=true;
      const published=await writeCrawlSummaryAtomic(crawlSummaryPath,summary);
      if(summary.batchId)summaryBinding={batchId:summary.batchId,summarySha256:published.sha256};
    }
  });
  if(commandResult.batch.status!=="SUCCESS"){
    terminalError=new Error(`Formal crawl ended ${commandResult.batch.status}`);
    failureCode="CRAWL_EXECUTION_FAILED";
  }
 }catch(error){
   terminalError=error;
   failureCode=classifyCrawlAttemptFailure({advisoryLockAcquired:!!advisoryLock,fileLockAcquired:!!fileLock,
     executionStarted,operationStage});
 }finally{
  try{await runFormalCleanup([
    ...(prisma?[{name:"Prisma disconnect",run:()=>prisma!.$disconnect()}]:[]),
    ...(fileLock?[{name:"filesystem lock close",run:()=>fileLock!.close()},{name:"filesystem lock unlink",run:()=>unlink(FORMAL_CRAWL_LOCK_PATH).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;})}]:[]),
    ...(advisoryLock?[{name:"PostgreSQL advisory lock release",run:()=>advisoryLock!.release()}]:[])
  ]);}catch(error){terminalError=error;failureCode=classifyCrawlAttemptFailure({advisoryLockAcquired:!!advisoryLock,
    fileLockAcquired:!!fileLock,executionStarted,operationStage,cleanupFailed:true});}
}

const succeeded=!terminalError&&commandResult?.batch.status==="SUCCESS"&&summaryBinding!==undefined;
await writeCrawlAttemptEvent(crawlAttemptDir,buildCrawlAttemptEvent({
  attemptId,state:succeeded?"SUCCESS":"FAILED",startedAt:attemptStartedAt,finishedAt:new Date(),
  identity:crawlEvidenceIdentityFromRuntime(identity),authority:attemptAuthority,
  canonicalSummaryBinding:succeeded?summaryBinding!:null,failureCode:succeeded?null:failureCode
}));
if(terminalError)throw terminalError;
if(!commandResult)throw new Error("Formal crawl returned no command result");
console.log(formatP0CrawlResult(commandResult));
process.exitCode=p0CrawlBatchExitCode(commandResult.batch);
