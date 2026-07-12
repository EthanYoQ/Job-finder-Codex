import { readdir } from "node:fs/promises";
import { buildCrawlAttemptEvent, writeCrawlAttemptEvent, type CrawlAttemptFailureCode } from "./crawlAttemptEvidence";

export function classifyCrawlAttemptFailure(input:{
  advisoryLockAcquired:boolean;
  fileLockAcquired:boolean;
  executionStarted:boolean;
  operationStage:"EXECUTION"|"SOURCE_HEALTH"|"PUBLISH"|undefined;
  cleanupFailed?:boolean;
}):CrawlAttemptFailureCode{
  if(input.cleanupFailed)return "CLEANUP_FAILED";
  if(!input.advisoryLockAcquired)return "ADVISORY_LOCK_FAILED";
  if(!input.fileLockAcquired)return "FILE_LOCK_FAILED";
  if(!input.executionStarted)return "PREFLIGHT_FAILED";
  if(input.operationStage==="SOURCE_HEALTH")return "SOURCE_HEALTH_FAILED";
  if(input.operationStage==="PUBLISH")return "CANONICAL_SUMMARY_WRITE_FAILED";
  return "CRAWL_EXECUTION_FAILED";
}

export async function runScheduledCrawlWindow(input:{
  attemptId:string;
  startedAt:Date;
  attemptDir:string;
  baseEnv:NodeJS.ProcessEnv;
  spawnChild(env:NodeJS.ProcessEnv):{error?:Error;status:number|null};
  deps?:{
    writeEvent:typeof writeCrawlAttemptEvent;
    hasTerminal(attemptDir:string,attemptId:string):Promise<boolean>;
  };
}):Promise<{error?:Error;status:number|null;terminalEvidencePresent:boolean}>{
  const writeEvent=input.deps?.writeEvent??writeCrawlAttemptEvent;
  const hasTerminal=input.deps?.hasTerminal??hasCrawlAttemptTerminal;
  const emptyAuthority={advisoryLockAcquired:false,fileLockAcquired:false};
  await writeEvent(input.attemptDir,buildCrawlAttemptEvent({attemptId:input.attemptId,state:"RUNNING",
    startedAt:input.startedAt,finishedAt:null,identity:null,authority:emptyAuthority,
    canonicalSummaryBinding:null,failureCode:null}));
  const result=input.spawnChild({...input.baseEnv,P0_CRAWL_ATTEMPT_ID:input.attemptId,
    P0_CRAWL_ATTEMPT_STARTED_AT:input.startedAt.toISOString(),P0_CRAWL_ATTEMPT_OWNER:"scheduler"});
  let terminalEvidencePresent=await hasTerminal(input.attemptDir,input.attemptId);
  if(!terminalEvidencePresent){
    await writeEvent(input.attemptDir,buildCrawlAttemptEvent({attemptId:input.attemptId,state:"FAILED",
      startedAt:input.startedAt,finishedAt:new Date(),identity:null,authority:emptyAuthority,
      canonicalSummaryBinding:null,failureCode:result.error?"CHILD_PROCESS_FAILED":"SCHEDULER_CHILD_FAILED"}));
    terminalEvidencePresent=true;
  }
  return {...result,terminalEvidencePresent};
}

async function hasCrawlAttemptTerminal(directory:string,attemptId:string):Promise<boolean>{
  return (await readdir(directory).catch(()=>[])).some(name=>
    name.includes(`__${attemptId}__FAILED.json`)||name.includes(`__${attemptId}__SUCCESS.json`));
}
