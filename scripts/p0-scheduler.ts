import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { nextP0CrawlWindow } from "../src/crawler/schedule";
import { runScheduledCrawlWindow } from "../src/crawler/crawlAttemptOrchestration";
import { resolveStagedCrawlEvidencePaths } from "../src/crawler/stagedCrawlEvidencePaths";

const {attemptDir,summaryPath}=resolveStagedCrawlEvidencePaths();

for(;;){
  const window=nextP0CrawlWindow(new Date());
  const wait=Math.max(0,new Date(window.startsAt).getTime()-Date.now());
  console.log(`Next staged crawl window ${window.label} at ${window.startsAt}`);
  await delay(wait);
  const attemptId=randomUUID();
  const startedAt=new Date();
  const result=await runScheduledCrawlWindow({attemptId,startedAt,attemptDir,
    baseEnv:{...process.env,STAGED_CRAWL_ATTEMPT_DIR:attemptDir,STAGED_CRAWL_SUMMARY_PATH:summaryPath},
    spawnChild:env=>spawnSync("npm",["run","p0:staged-crawl"],{stdio:"inherit",env})});
  if(result.error||result.status!==0){
    console.error(result.error??`Staged window ${window.label} blocked with status ${String(result.status)}; no immediate retry`);
  }
  await delay(60_000);
}
