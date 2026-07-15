import { readdir } from "node:fs/promises";
import { buildCrawlAttemptEvent, writeCrawlAttemptEvent, type CrawlAttemptFailureCode } from "./crawlAttemptEvidence";

export function classifyCrawlAttemptFailure(input:{
  advisoryLockAcquired:boolean;
  fileLockAcquired:boolean;
  executionStarted:boolean;
  operationStage:"EXECUTION"|"QUALIFICATION_PAUSE"|"SOURCE_HEALTH"|"PUBLISH"|undefined;
  cleanupFailed?:boolean;
}):CrawlAttemptFailureCode{
  if(input.cleanupFailed)return "CLEANUP_FAILED";
  if(!input.advisoryLockAcquired)return "ADVISORY_LOCK_FAILED";
  if(!input.fileLockAcquired)return "FILE_LOCK_FAILED";
  if(!input.executionStarted)return "PREFLIGHT_FAILED";
  if(input.operationStage==="QUALIFICATION_PAUSE")return "QUALIFICATION_PAUSE_EVIDENCE_FAILED";
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
    readTerminalState(attemptDir:string,attemptId:string):Promise<CrawlAttemptTerminalState|null>;
  };
}):Promise<{error?:Error;status:number|null;terminalEvidencePresent:boolean;terminalState:CrawlAttemptTerminalState}>{
  const writeEvent=input.deps?.writeEvent??writeCrawlAttemptEvent;
  const readTerminalState=input.deps?.readTerminalState??readCrawlAttemptTerminalState;
  const emptyAuthority={advisoryLockAcquired:false,fileLockAcquired:false};
  await writeEvent(input.attemptDir,buildCrawlAttemptEvent({attemptId:input.attemptId,state:"RUNNING",
    startedAt:input.startedAt,finishedAt:null,identity:null,authority:emptyAuthority,
    canonicalSummaryBinding:null,failureCode:null}));
  const result=input.spawnChild({...input.baseEnv,P0_CRAWL_ATTEMPT_ID:input.attemptId,
    P0_CRAWL_ATTEMPT_STARTED_AT:input.startedAt.toISOString(),P0_CRAWL_ATTEMPT_OWNER:"scheduler"});
  let terminalState=await readTerminalState(input.attemptDir,input.attemptId);
  if(terminalState===null){
    await writeEvent(input.attemptDir,buildCrawlAttemptEvent({attemptId:input.attemptId,state:"FAILED",
      startedAt:input.startedAt,finishedAt:new Date(),identity:null,authority:emptyAuthority,
      canonicalSummaryBinding:null,failureCode:result.error?"CHILD_PROCESS_FAILED":"SCHEDULER_CHILD_FAILED"}));
    terminalState="FAILED";
  }
  return {...result,terminalEvidencePresent:true,terminalState};
}

export type CrawlAttemptTerminalState="SUCCESS"|"FAILED"|"PAUSED";

export async function readCrawlAttemptTerminalState(
  directory:string,
  attemptId:string
):Promise<CrawlAttemptTerminalState|null>{
  if(!/^[A-Za-z0-9._-]{1,128}$/u.test(attemptId))throw new Error("Scheduler attempt id is invalid");
  const prefix=`__${attemptId}__`;
  const states=(await readdir(directory).catch(()=>[])).flatMap(name=>{
    if(!name.includes(prefix))return [];
    const match=/^\d+__[A-Za-z0-9._-]{1,128}__(RUNNING|SUCCESS|FAILED|PAUSED)\.json$/u.exec(name);
    if(!match)throw new Error("Scheduler terminal evidence filename is invalid");
    return match[1]==="RUNNING"?[]:[match[1] as CrawlAttemptTerminalState];
  });
  if(states.length>1)throw new Error("Scheduler found multiple terminal states for one attempt");
  return states[0]??null;
}
