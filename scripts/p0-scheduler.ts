import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { nextP0SchedulerWindow } from "../src/crawler/schedule";
import { readLatestCrawlAttemptStartedAt } from "../src/crawler/crawlAttemptEvidence";
import { runScheduledCrawlWindow } from "../src/crawler/crawlAttemptOrchestration";
import { resolveStagedCrawlEvidencePaths } from "../src/crawler/stagedCrawlEvidencePaths";
import { readInitialQualificationPauseBundle } from "../src/crawler/initialQualificationPauseBundle";
import { loadProductionInitialQualificationPauseCandidateStatus } from "../src/crawler/initialQualificationPauseCandidate";
import { loadProductionStagedMonitoringIdentity } from "../src/crawler/stagedMonitoringIdentity";
import { scheduledAttemptTimeoutMs } from "../src/crawler/officialHttpRuntimeLimits";

const {attemptDir,summaryPath,initialQualificationPausePath}=resolveStagedCrawlEvidencePaths();
let qualificationPaused=await loadQualificationPause();
if(qualificationPaused)console.error(formatQualificationPause(qualificationPaused));

for(;;){
  if(qualificationPaused){
    await delay(3_600_000);
    qualificationPaused=await loadQualificationPause();
    if(qualificationPaused)continue;
    console.log("A current staged authority superseded the previous qualification pause; scheduler resumed.");
  }
  const now=new Date();
  const latestAttemptStartedAt=await readLatestCrawlAttemptStartedAt(attemptDir);
  const window=nextP0SchedulerWindow(now,latestAttemptStartedAt);
  const wait=Math.max(0,new Date(window.startsAt).getTime()-now.getTime());
  console.log(`Next staged crawl window ${window.label} at ${window.startsAt}`);
  await delay(wait);
  const attemptId=randomUUID();
  const startedAt=new Date();
  const result=await runScheduledCrawlWindow({attemptId,startedAt,attemptDir,
    baseEnv:{...process.env,STAGED_CRAWL_ATTEMPT_DIR:attemptDir,STAGED_CRAWL_SUMMARY_PATH:summaryPath,
      STAGED_INITIAL_QUALIFICATION_PAUSE_PATH:initialQualificationPausePath},
    spawnChild:env=>spawnSync("npm",["run","p0:staged-crawl"],{
      stdio:"inherit",env,timeout:scheduledAttemptTimeoutMs(env),killSignal:"SIGTERM"
    })});
  if(result.error||result.status!==0){
    console.error(result.error??`Staged window ${window.label} blocked with status ${String(result.status)}; no immediate retry`);
  }
  const pauseAfterWindow=await loadQualificationPause();
  if(result.terminalState==="PAUSED"&&!pauseAfterWindow){
    throw new Error("PAUSED terminal has no matching initial qualification pause evidence; scheduler remains fail-closed");
  }
  if(pauseAfterWindow){
    qualificationPaused=pauseAfterWindow;
    console.error(formatQualificationPause(pauseAfterWindow));
    continue;
  }
  await delay(60_000);
}

async function loadQualificationPause(){
  let activeIdentity;
  try{
    activeIdentity=await loadProductionStagedMonitoringIdentity(process.env.DATABASE_URL);
  }catch{
    activeIdentity=undefined;
  }
  const result=await readInitialQualificationPauseBundle({
    pausePath:initialQualificationPausePath,
    summaryPath,
    attemptDir,
    now:new Date(),
    ...(activeIdentity?{activeIdentity}:{}),
    loadCandidateStatus:evidence=>loadProductionInitialQualificationPauseCandidateStatus(
      process.env.DATABASE_URL,evidence
    )
  });
  if(result.state==="INVALID"){
    throw new Error("Initial qualification pause evidence bundle is invalid; scheduler remains fail-closed");
  }
  if(result.state==="PAUSED")return result.evidence;
  if(result.state==="MISSING"&&!activeIdentity){
    throw new Error("No active staged authority or valid qualification pause bundle; scheduler remains fail-closed");
  }
  return null;
}

function formatQualificationPause(pause:NonNullable<Awaited<ReturnType<typeof loadQualificationPause>>>){
  return `PAUSED_BELOW_MINIMUM: ${pause.stableCompanyCount}/${pause.minimumStableCompanyCount} stable companies after exactly two completed qualification rounds; scheduler will not start another qualification attempt.`;
}
