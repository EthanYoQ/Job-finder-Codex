// @vitest-environment node
import { createNovoSyntheticFixture } from "../helpers/novoSyntheticFixture";
// Invented offline bodies with mocked HTTP/SQL/Library: no live acquisition or DB.
import { afterAll, afterEach, expect, it, vi } from "vitest";
const selectedSourceBeforeTest = vi.hoisted(() => {
  const previous = process.env.JOBFINDER_CLOUD_SOURCE_ID;
  process.env.JOBFINDER_CLOUD_SOURCE_ID = "source-novo-nordisk-china-social";
  return previous;
});
afterAll(() => {
  if (selectedSourceBeforeTest === undefined) delete process.env.JOBFINDER_CLOUD_SOURCE_ID;
  else process.env.JOBFINDER_CLOUD_SOURCE_ID = selectedSourceBeforeTest;
});
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveCurrentStagedScheduleExpectation, resolveCurrentStagedScheduleAuthority } from "../../src/crawler/stagedScheduleAuthority";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { FilePilotRelay, sha256 } from "../../src/crawler/cloudSourcePilotRelay";
import * as quality from "../../src/crawler/sourceQualityAdmission";
import * as limits from "../../src/crawler/officialHttpRuntimeLimits";
import { selectedPilotIdentity } from "../../scripts/p0-cloud-source-pilot";
import { portablePreLockReadyDeadline, runCloudPortableSourcePilot } from "../../scripts/p0-cloud-portable-source-pilot";
import { CLOUD_PILOT_SOURCE, compileCloudPilotCreatePendingSql } from "../../src/db/cloudPilotSqlControl";
const build=vi.hoisted(()=>{const base={schemaVersion:2 as const,commitSha:"a".repeat(40),sourceTreeSha256:"b".repeat(64),runtimeTreeSha256:"c".repeat(64)};return {...base,contentSha256:"d".repeat(64)};});
vi.mock("../../src/readiness/buildIdentity",()=>({resolveCurrentBuildIdentity:()=>build}));
const {body:syntheticBody,captures}=createNovoSyntheticFixture();
const endpoint="https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
const roots:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});

it.each(["success","source-failure","quality-rejected","newer-observation","newer-observation-after-lock","expired-after-capture"])("captures before the short publication lock: %s",async mode=>{
  vi.useFakeTimers({toFake:["Date"]});const started=Date.now(),events:string[]=[];
  const workspaceRoot=await mkdtemp(join(tmpdir(),"novo-short-lock-"));roots.push(workspaceRoot);
  const e=deriveCurrentStagedScheduleExpectation(build),candidate={id:"synthetic-novo-candidate",status:"BUILDING",commitSha:e.commitSha,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,oracleVersion:"staged-official-source-v1",minimumStableCompanyCount:41};
  const authority=await resolveCurrentStagedScheduleAuthority({releaseCandidate:{findMany:async()=>[candidate]}}),identity=selectedPilotIdentity(authority.identity),plan=authority.plans.find(p=>p.source.id===identity.expectedPlannedSourceIds[0])!;
  const batchId="synthetic-novo-short-lock",bootstrapBytes=JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[candidate],batchId}),bootstrapPath=join(workspaceRoot,"bootstrap.json");await writeFile(bootstrapPath,bootstrapBytes);
  let admitted:Awaited<ReturnType<typeof quality.issueSourceQualityAdmission>>|undefined,admissionInput:Parameters<typeof quality.issueSourceQualityAdmission>[0]|undefined,pending:ReturnType<typeof buildPendingRuntimeBatch>|undefined,publicationStart=0,terminal:Record<string,unknown>={};
  const issue=quality.issueSourceQualityAdmission,admissions:Array<Awaited<ReturnType<typeof quality.issueSourceQualityAdmission>>>=[],sourceTimer=vi.spyOn(limits,"runWithOfficialSourceAttemptTimeout");
  vi.spyOn(quality,"issueSourceQualityAdmission").mockImplementation(async input=>{
    events.push("ADMISSION");admissionInput=input;
    admitted=mode==="quality-rejected"?{status:"REJECTED",codes:["SYNTHETIC_REPLAY_REJECTION"]}:await issue(input);admissions.push(admitted);return admitted;
  });
  const http=vi.fn(async (url:string,init?:RequestInit)=>{
    events.push("HTTP");expect(publicationStart).toBe(0);expect(init?.method).toBe("GET");
    vi.setSystemTime(Date.now()+13000);
    if(mode==="source-failure")throw Error("SYNTHETIC_SOURCE_FAILED");
    const body=url===endpoint?{body:syntheticBody,finalUrl:url,contentType:"application/json"}:captures[url];if(!body)throw Error(`Unexpected synthetic URL ${url}`);
    return {status:200,url:body.finalUrl,headers:new Headers({"content-type":body.contentType}),text:async()=>body.body};
  });vi.stubGlobal("fetch",http);
  const sql=vi.spyOn(FilePilotRelay.prototype,"sql").mockImplementation(async(kind,query,deadline)=>{
    events.push(kind);
    if(kind==="LEASE_ACQUIRE"){
      expect(admitted?.status).toBe("ACCEPTED");expect(events.indexOf("ADMISSION")).toBeLessThan(events.indexOf(kind));publicationStart=Date.now();
      expect(publicationStart-started).toBeGreaterThan(600000);expect(deadline).toBe(publicationStart+60000);
      return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    }
    if(kind==="LEASE_RENEW")return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    if(kind==="LEASE_RELEASE")return [{holderId:""}];
    if(kind==="PUBLISH"){
      expect(deadline).toBeGreaterThan(publicationStart+165000);expect(deadline).toBeLessThanOrEqual(publicationStart+430000);
      const match=query.match(/FROM jsonb_populate_record\(NULL::public\."CrawlBatchSourceResult", E'((?:[^']|'')*)'::jsonb\) AS v/)!;
      terminal=JSON.parse(match[1]!.replaceAll("''","'").replaceAll("\\\\","\\"));return [];
    }
    if(kind==="READ_OUTCOME")return [{row:JSON.parse(JSON.stringify({blockerCode:null,blockerReason:null,failureCategory:null,failureDiagnosticCode:null,failureCode:null,failureReason:null,...pending!.sources[0],releaseCandidateId:identity.releaseCandidateId,batchId,...terminal}))}];
    throw Error("Unexpected SQL");
  });
  const request=vi.spyOn(FilePilotRelay.prototype,"request").mockImplementation(async(kind,payload,deadline,parse)=>{
    const p=payload as Record<string,unknown>;events.push(kind==="READ_CONTEXT"&&p.purpose?String(p.purpose)+"_CONTEXT":kind);
    if(kind==="READ_CONTEXT"){
      const context={sourceId:plan.source.id,sourceConfigSha256:CLOUD_PILOT_SOURCE.sourceConfigSha256,jobs:[],firstAccepted:null as unknown,latestAccepted:null as unknown,checkedAt:new Date().toISOString()};
      if(p.purpose){expect(p).not.toHaveProperty("holderId");expect(p).not.toHaveProperty("sourceResultId");expect(sql).not.toHaveBeenCalled();}
      else{
        expect(p.holderId).toBeTypeOf("string");expect(p.sourceResultId).toBe(pending!.sources[0]!.id);
      }
      if((mode==="newer-observation"&&p.purpose==="PRE_LOCK_READY")||(mode==="newer-observation-after-lock"&&!p.purpose)){
        const input=admissionInput!,sourcePending=pending?.sources[0]??buildPendingRuntimeBatch(batchId,[plan],identity,new Date(started)).sources[0]!;
        const commit=buildAtomicRuntimeCommit({plan,pending:sourcePending,identity,batchId,result:input.result,previousJobs:[],baselineCompletedBeforeCrawl:false,artifacts:input.archive.artifacts,sourceAdmissionPolicy:quality.SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admitted!,firstAcceptedCurrentPolicyReceipt:null});
        context.firstAccepted=context.latestAccepted=JSON.parse(JSON.stringify(commit.sourceResult));
      }
      if(mode==="expired-after-capture"&&!p.purpose){vi.setSystemTime(Date.now()+31*60000);context.checkedAt=new Date().toISOString();}
      return parse(context);
    }
    if(kind==="CREATE_PENDING"){
      pending=p.planned as ReturnType<typeof buildPendingRuntimeBatch>;expect(pending.batch.startedAt.getTime()).toBe(started);expect(publicationStart).toBeGreaterThan(started+600000);
      return parse(JSON.parse(JSON.stringify({batch:{...pending.batch,status:"RUNNING",finishedAt:null},sourceRows:[{...pending.sources[0],releaseCandidateId:identity.releaseCandidateId,batchId,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null}]})));
    }
    throw Error("Unexpected request");
  });
  const run=runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:sha256(bootstrapBytes),workspaceRoot,relayDirectory:join(workspaceRoot,"relay")});
  if(mode==="success"){
    const report=await run;expect(report).toMatchObject({state:"COMMITTED_EXACT",sourceId:"source-novo-nordisk-china-social",archiveRetention:"PENDING",recoveryVerification:"PENDING",certificateGrade:"PLAN_BOUND_SOURCE_QUALITY_V1",jobCount:20});
    for(const key of ["stored","libraryFileId","libraryFileIdBacking","packedSha256","fullContentVerified"])expect(report).not.toHaveProperty(key);
    expect(request.mock.calls.some(c=>c[0]==="ARCHIVE_STORE")).toBe(false);
    expect(events.indexOf("PRE_LOCK_READY_CONTEXT")).toBeLessThan(events.indexOf("LEASE_ACQUIRE"));
    expect(http).toHaveBeenCalledTimes(56);expect(events[0]).toBe("PRE_CAPTURE_CONTEXT");
    expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","PUBLISH","READ_OUTCOME","LEASE_RELEASE"]);
    expect(events.filter(x=>x==="ADMISSION")).toHaveLength(2);expect(admissions[1]).toBe(admissions[0]);
    expect(sourceTimer.mock.calls[0]![1]).toBe(20*60*1000);
  }else{
    await expect(run).rejects.toThrow(mode.startsWith("newer-observation")?"PILOT_CAPTURE_PRECEDES_ACCEPTED_OBSERVATION":mode==="quality-rejected"||mode==="expired-after-capture"?"PILOT_ADMISSION_REJECTED":undefined);
    expect(sql.mock.calls.map(c=>c[0])).toEqual(mode==="newer-observation-after-lock"||mode==="expired-after-capture"?["LEASE_ACQUIRE","LEASE_RELEASE"]:[]);
    expect(request.mock.calls.some(c=>c[0]==="ARCHIVE_STORE")).toBe(false);
    const names=(await readdir(workspaceRoot)).filter(n=>n.includes(".failure-"));expect(names).toHaveLength(1);
  }
});

it("closes the control scope to Novo and keeps the independent 24-hour pending timestamp fence, request expiry and owner fences",()=>{
  expect(CLOUD_PILOT_SOURCE).toEqual({id:"source-novo-nordisk-china-social",ownerId:"dot-cloud-novo-nordisk-china-social-pilot",sourceConfigSha256:"40305820c3aa3f36e74f06873c0ddd1a52266cb74d277b3a36137c81fc5c604e"});
  const {contentSha256:_digest,...base}=build,realBuild={...base,contentSha256:sha256(JSON.stringify(base))},e=deriveCurrentStagedScheduleExpectation(realBuild),plan=e.plans.find(p=>p.source.id===CLOUD_PILOT_SOURCE.id)!;
  const identity=selectedPilotIdentity({releaseCandidateId:"synthetic-novo-control",commitSha:e.commitSha,rosterSha256:e.rosterSha256,sourcePlanSha256:e.sourcePlanSha256,sourceConfigSha256:e.sourceConfigSha256,adapterBundleSha256:e.adapterBundleSha256,batchKind:"SCHEDULED",ownerId:"source",expectedPlannedSourceIds:[],expectedPlannedSourceCount:0,expectedPlannedSourceSetSha256:"a".repeat(64)});
  const planned=buildPendingRuntimeBatch("synthetic-novo-control",[plan],identity,new Date(Date.now()-12*60000));
  const input={projectId:"yiopvxysxrtrnvqxwgbx",build:realBuild,candidate:{id:identity.releaseCandidateId,goalId:"jobfinder-portable-required-40",version:20},holderId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",expiresAt:new Date(Date.now()+60000).toISOString(),planned};
  const sql=compileCloudPilotCreatePendingSql(input);
  expect(sql).toContain("clock_timestamp()-interval '24 hours'");expect(sql).toContain("PILOT_REQUEST_EXPIRED");expect(sql.indexOf("FOR UPDATE")).toBeLessThan(sql.indexOf('UPDATE public."CrawlCoordinatorLock"'));
  expect(sql).toContain("\"heartbeatAt\">clock_timestamp()-interval '300 seconds'");
  expect(()=>compileCloudPilotCreatePendingSql({...input,planned:{...planned,batch:{...planned.batch,ownerId:"dot-cloud-qilu-social-pilot"}}})).toThrow("PILOT_EXACT_PLANNED_PROJECTION_REQUIRED");
});

// Pending SQL accepts recovery bookkeeping within 24 hours; a fresh receipt and
// pre-lock readiness still independently enforce the original 30-minute capture age.
it("keeps the Novo pre-lock capture clock at 30 minutes despite the 24-hour pending SQL fence",()=>{
  const now=Date.parse("2026-10-03T21:00:00.000Z");
  expect(portablePreLockReadyDeadline({startedAt:new Date(now-12*60000).toISOString(),finishedAt:new Date(now).toISOString()},now)).toBe(now+5*60000);
  expect(()=>portablePreLockReadyDeadline({startedAt:new Date(now-43*60000).toISOString(),finishedAt:new Date(now-31*60000).toISOString()},now)).toThrow("PILOT_PRE_LOCK_BUDGET_EXHAUSTED");
});
