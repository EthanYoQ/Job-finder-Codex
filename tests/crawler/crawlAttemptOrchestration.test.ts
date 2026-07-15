import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildCrawlAttemptEvent, writeCrawlAttemptEvent } from "../../src/crawler/crawlAttemptEvidence";
import { classifyCrawlAttemptFailure, readCrawlAttemptTerminalState, runScheduledCrawlWindow } from "../../src/crawler/crawlAttemptOrchestration";

describe("crawl attempt orchestration",()=>{
  it.each([
    [{advisoryLockAcquired:false,fileLockAcquired:false,executionStarted:false,operationStage:undefined},"ADVISORY_LOCK_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:false,executionStarted:false,operationStage:undefined},"FILE_LOCK_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:false,operationStage:undefined},"PREFLIGHT_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:true,operationStage:"EXECUTION" as const},"CRAWL_EXECUTION_FAILED"],
    [{advisoryLockAcquired:true,fileLockAcquired:true,executionStarted:true,operationStage:"QUALIFICATION_PAUSE" as const},"QUALIFICATION_PAUSE_EVIDENCE_FAILED"],
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
        writeEvent:async(_dir,event)=>{events.push(event);},readTerminalState:async()=>"SUCCESS"
      }});
    expect(events.map(event=>event.state)).toEqual(["RUNNING"]);
    expect(spawnChild).toHaveBeenCalledWith(expect.objectContaining({SAFE:"1",P0_CRAWL_ATTEMPT_ID:"attempt-one",
      P0_CRAWL_ATTEMPT_STARTED_AT:"2026-07-12T10:00:00.000Z",P0_CRAWL_ATTEMPT_OWNER:"scheduler"}));
    expect(result).toMatchObject({status:0,terminalEvidencePresent:true,terminalState:"SUCCESS"});
  });

  it.each([
    [{status:1},"SCHEDULER_CHILD_FAILED"],
    [{status:0},"SCHEDULER_CHILD_FAILED"],
    [{status:null,error:new Error("spawn failed")},"CHILD_PROCESS_FAILED"]
  ] as const)("writes a fail-closed scheduler terminal when the child leaves none %#",async(child,code)=>{
    const events:any[]=[];
    await runScheduledCrawlWindow({attemptId:"attempt-two",startedAt:new Date("2026-07-12T10:00:00Z"),
      attemptDir:"ignored",baseEnv:{},spawnChild:()=>child,deps:{
        writeEvent:async(_dir,event)=>{events.push(event);},readTerminalState:async()=>null
      }});
    expect(events.map(event=>event.state)).toEqual(["RUNNING","FAILED"]);
    expect(events[1]).toMatchObject({failureCode:code,identity:null,
      authority:{advisoryLockAcquired:false,fileLockAcquired:false}});
  });

  it("returns the dedicated PAUSED terminal with the child's nonzero status",async()=>{
    const result=await runScheduledCrawlWindow({attemptId:"attempt-pause",startedAt:new Date("2026-07-15T00:01:00Z"),
      attemptDir:"ignored",baseEnv:{},spawnChild:()=>({status:1}),deps:{
        writeEvent:async()=>undefined,readTerminalState:async()=>"PAUSED"
      }});
    expect(result).toMatchObject({status:1,terminalEvidencePresent:true,terminalState:"PAUSED"});
  });

  it("finds PAUSED beside its mandatory RUNNING journal entry",async()=>{
    const root=mkdtempSync(resolve(tmpdir(),"job-finder-scheduler-terminal-"));
    const startedAt=new Date("2026-07-15T00:01:00Z");
    const identity={releaseCandidateId:"rc-pause",batchKind:"SCHEDULED" as const,commitSha:"1".repeat(40),
      rosterSha256:"2".repeat(64),sourcePlanSha256:"3".repeat(64),sourceConfigSha256:"4".repeat(64),
      adapterBundleSha256:"5".repeat(64),plannedSourceSetSha256:"6".repeat(64),plannedSourceCount:2};
    await writeCrawlAttemptEvent(root,buildCrawlAttemptEvent({attemptId:"attempt-pause",state:"RUNNING",startedAt,
      finishedAt:null,identity:null,authority:{advisoryLockAcquired:false,fileLockAcquired:false},
      canonicalSummaryBinding:null,failureCode:null}));
    await writeCrawlAttemptEvent(root,buildCrawlAttemptEvent({attemptId:"attempt-pause",state:"PAUSED",startedAt,
      finishedAt:new Date("2026-07-15T00:05:00Z"),identity,
      authority:{advisoryLockAcquired:true,fileLockAcquired:true},
      canonicalSummaryBinding:{batchId:"batch-two",summarySha256:"a".repeat(64)},failureCode:null,
      initialQualificationPause:{reasonCode:"INITIAL_QUALIFICATION_BELOW_MINIMUM_AFTER_TWO_COMPLETED_ROUNDS",
        notificationKey:"b".repeat(64),completedRoundCount:2,stableCompanyCount:44,minimumStableCompanyCount:45}}));
    await expect(readCrawlAttemptTerminalState(root,"attempt-pause")).resolves.toBe("PAUSED");
  });
});
