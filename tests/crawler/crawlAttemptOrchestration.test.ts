import { describe, expect, it, vi } from "vitest";
import { classifyCrawlAttemptFailure, runScheduledCrawlWindow } from "../../src/crawler/crawlAttemptOrchestration";

describe("crawl attempt orchestration",()=>{
  it.each([
    [{advisoryLockAcquired:false,fileLockAcquired:false,executionStarted:false,operationStage:undefined},"ADVISORY_LOCK_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:false,executionStarted:false,operationStage:undefined},"FILE_LOCK_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:false,operationStage:undefined},"PREFLIGHT_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:true,operationStage:"EXECUTION" as const},"CRAWL_EXECUTION_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:true,operationStage:"SOURCE_HEALTH" as const},"SOURCE_HEALTH_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:true,operationStage:"PUBLISH" as const},"CANONICAL_SUMMARY_WRITE_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:true,operationStage:"EXECUTION" as const,cleanupFailed:true},"CLEANUP_FAILED"]
  ] as const)("classifies truthful terminal stage %#",(input,expected)=>{
    expect(classifyCrawlAttemptFailure(input)).toBe(expected);
  });

  it("lets the child own terminal truth and passes scheduler attempt identity",async()=>{
    const events:any[]=[];
    const spawnChild=vi.fn(()=>({status:0}));
    const result=await runScheduledCrawlWindow({attemptId:"attempt-one",startedAt:new Date("2026-07-12T10:00:00Z"),
      attemptDir:"ignored",baseEnv:{SAFE:"1"},spawnChild,deps:{
        writeEvent:async(_dir,event)=>{events.push(event);},hasTerminal:async()=>true
      }});
    expect(events.map(event=>event.state)).toEqual(["RUNNING"]);
    expect(spawnChild).toHaveBeenCalledWith(expect.objectContaining({SAFE:"1",P0_CRAWL_ATTEMPT_ID:"attempt-one",
      P0_CRAWL_ATTEMPT_STARTED_AT:"2026-07-12T10:00:00.000Z",P0_CRAWL_ATTEMPT_OWNER:"scheduler"}));
    expect(result).toMatchObject({status:0,terminalEvidencePresent:true});
  });

  it.each([
    [{status:1},"SCHEDULER_CHILD_FAILED"],
    [{status:0},"SCHEDULER_CHILD_FAILED"],
    [{status:null,error:new Error("spawn failed")},"CHILD_PROCESS_FAILED"]
  ] as const)("writes a fail-closed scheduler terminal when the child leaves none %#",async(child,code)=>{
    const events:any[]=[];
    await runScheduledCrawlWindow({attemptId:"attempt-two",startedAt:new Date("2026-07-12T10:00:00Z"),
      attemptDir:"ignored",baseEnv:{},spawnChild:()=>child,deps:{
        writeEvent:async(_dir,event)=>{events.push(event);},hasTerminal:async()=>false
      }});
    expect(events.map(event=>event.state)).toEqual(["RUNNING","FAILED"]);
    expect(events[1]).toMatchObject({failureCode:code,identity:null,
      authority:{advisoryLockAcquired:false,fileLockAcquired:false}});
  });
});
