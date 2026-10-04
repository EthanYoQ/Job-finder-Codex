// @vitest-environment node
// All identity, HTTP, SQL and Library boundaries below are synthetic/offline.
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveCurrentStagedScheduleExpectation, resolveCurrentStagedScheduleAuthority } from "../../src/crawler/stagedScheduleAuthority";
import { buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { FilePilotRelay, PilotSqlFailure, sha256 } from "../../src/crawler/cloudSourcePilotRelay";
import * as sourceCrawl from "../../src/crawler/runSourceCrawl";
import { runCloudSourcePilot, selectedPilotIdentity, preservePilotFailure } from "../../scripts/p0-cloud-source-pilot";
import { qiluPilotHttpFixture } from "../helpers/cloudQiluPilotFixture";
import { ownedPortableFixture } from "../db/helpers/ownedPortableCommit";
const build=vi.hoisted(()=>({schemaVersion:2 as const,commitSha:"a".repeat(40),sourceTreeSha256:"b".repeat(64),runtimeTreeSha256:"c".repeat(64),contentSha256:"d".repeat(64)}));
vi.mock("../../src/readiness/buildIdentity",()=>({resolveCurrentBuildIdentity:()=>build}));
// Absolute unknown-result settlement is exercised by cloudSourcePilot.test.ts.
vi.mock("node:timers/promises",()=>({setTimeout:async()=>undefined}));
const roots:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it.each(["success","success-extended","success-slow-controls","success-slow-upload","archive-unknown","archive-missing-ack","archive-bad-hash","archive-bad-size","archive-missing-reference","archive-bad-packed-hash","archive-bad-packed-size","archive-not-stored","archive-fake-verification","archive-local-hash","archive-local-size","renew-budget-exhausted","exception","failure-result","renew-unknown","exception-release-failure","renew-unknown-release-failure","renew-unknown-late-release-failure"])("retains truthful one-process Qilu outcome for %s",async mode=>{
  const archiveFailure=mode.startsWith("archive-"),slowUpload=mode==="success-slow-upload";
  const slow=mode==="success-slow-controls",renewBudget=mode==="renew-budget-exhausted";
  const lateUnknown=mode==="renew-unknown-late-release-failure",extended=mode==="success-extended",success=mode.startsWith("success"),exception=mode.startsWith("exception"),renewUnknown=mode.startsWith("renew-unknown"),releaseFailure=mode.endsWith("release-failure");
  const sourceError=new sourceCrawl.SourceCrawlStageError("FETCH",Object.assign(new TypeError("private upstream text must not reach console"),{code:"SYNTHETIC_NETWORK_BREAK"}));
  const renewError=new PilotSqlFailure("UNKNOWN","CONNECTION_LOST"),releaseError=new PilotSqlFailure("UNKNOWN","RELEASE_CONNECTION_LOST");
  const timers:Array<{ms:number;controller:AbortController}>=[];
  if(extended||lateUnknown||slow||slowUpload||renewBudget){vi.useFakeTimers({toFake:["Date"]});vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{const controller=new AbortController();timers.push({ms,controller});return controller.signal;});}
  const workspaceRoot=await mkdtemp(join(tmpdir(),"qilu-pilot-integration-"));roots.push(workspaceRoot);
  const expected=deriveCurrentStagedScheduleExpectation(build),candidate={id:"synthetic-cloud-candidate",status:"BUILDING",commitSha:expected.commitSha,rosterHash:expected.rosterSha256,sourcePlanHash:expected.sourcePlanSha256,sourceConfigHash:expected.sourceConfigSha256,adapterBundleHash:expected.adapterBundleSha256,sourceTreeHash:expected.sourceTreeSha256,runtimeTreeHash:expected.runtimeTreeSha256,oracleVersion:"staged-official-source-v1",minimumStableCompanyCount:41};
  const authority=await resolveCurrentStagedScheduleAuthority({releaseCandidate:{findMany:async()=>[candidate]}}),identity=selectedPilotIdentity(authority.identity),plan=authority.plans.find(p=>p.source.id===identity.expectedPlannedSourceIds[0])!;
  const now=new Date(),planned=buildPendingRuntimeBatch("synthetic-qilu-pilot",[plan],identity,now),initialSource={...planned.sources[0],releaseCandidateId:identity.releaseCandidateId,batchId:planned.batch.id,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null};
  let source:Record<string,unknown>=initialSource;
  const context=process.env.QILU_PILOT_CONTEXT ? JSON.parse(await readFile(process.env.QILU_PILOT_CONTEXT,"utf8")) : {sourceId:plan.source.id,sourceConfigSha256:planned.sources[0]!.sourceConfigHash,jobs:[],firstAccepted:null,latestAccepted:null};
  const bootstrap={schemaVersion:1,checkedAt:now.toISOString(),candidateRows:[candidate],batchId:planned.batch.id};
  const bootstrapPath=join(workspaceRoot,"bootstrap.json"),bootstrapBytes=JSON.stringify(bootstrap);await writeFile(bootstrapPath,bootstrapBytes);
  const fixture=await qiluPilotHttpFixture(process.env.QILU_RETAINED_ARTIFACT_ROOT);
  const http=vi.fn(async (url:string,init?:RequestInit)=>{
    if(exception)throw Object.assign(new TypeError("private upstream text must not reach console"),{code:"SYNTHETIC_NETWORK_BREAK"});
    if(mode==="failure-result")return {status:403,url,headers:new Headers({"content-type":"text/html"}),text:async()=>"Forbidden"};
    return fixture.fetch(url,init);
  });vi.stubGlobal("fetch",http);
  let terminal:Record<string,unknown>={},archiveSaved=false,sqlByteCount=0,archiveByteCount=0,cleanupDeadline=0;
  const started=Date.now();
  const advanceControl=(kind:string,deadline:number)=>{
    if(!slow)return;
    const pickup=kind==="LEASE_ACQUIRE"?15000:kind==="READ_CONTEXT"||kind==="READ_OUTCOME"?34999:30000;
    const sent=Date.now();expect(deadline).toBe(sent+60000);vi.setSystemTime(sent+pickup+5000);
  };
  const sql=vi.spyOn(FilePilotRelay.prototype,"sql").mockImplementation(async(kind,query,deadline,signal)=>{
    if(kind!=="PUBLISH")advanceControl(kind,deadline);
    if(kind==="LEASE_ACQUIRE")return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    if(kind==="LEASE_RELEASE"){
      cleanupDeadline=deadline;
      if(releaseFailure)throw releaseError;
      if(extended)expect(deadline).toBeGreaterThan(started+310000);
      return [{holderId:""}];
    }
    if(kind==="LEASE_RENEW"){
      expect(archiveSaved).toBe(true);
      if(lateUnknown)vi.setSystemTime(started+289000);
      if(renewUnknown)throw renewError;
      if(extended)vi.setSystemTime(started+220000);
      if(renewBudget)vi.setSystemTime(started+284000);
      return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    }
    if(kind==="PUBLISH"){
      if(extended){
        const initial=timers.find(t=>t.ms>280000&&t.ms<=290000)!;expect(initial).toBeDefined();
        vi.setSystemTime(started+310000);initial.controller.abort();
        expect(signal?.aborted).toBe(false);expect(deadline).toBe(started+430000);
      }
      sqlByteCount=Buffer.byteLength(query);
      expect(archiveSaved).toBe(true);expect(query).toMatch(/^SET LOCAL statement_timeout = '120000ms';\nDO /);
      const match=query.match(/FROM jsonb_populate_record\(NULL::public\."CrawlBatchSourceResult", E'((?:[^']|'')*)'::jsonb\) AS v/)!;
      terminal=JSON.parse(match[1]!.replaceAll("''","'").replaceAll("\\\\","\\"));return [];
    }
    if(kind==="READ_OUTCOME")return [{row:JSON.parse(JSON.stringify({blockerCode:null,blockerReason:null,failureCategory:null,failureDiagnosticCode:null,failureCode:null,failureReason:null,...source,...terminal}))}];
    throw Error("Unexpected SQL");
  });
  const request=vi.spyOn(FilePilotRelay.prototype,"request").mockImplementation(async(kind,payload,_deadline,parse)=>{
    if(kind==="CREATE_PENDING"||kind==="READ_CONTEXT")advanceControl(kind,_deadline);
    if(kind==="CREATE_PENDING"){
      const request=payload as {planned:ReturnType<typeof buildPendingRuntimeBatch>};
      source={...request.planned.sources[0],releaseCandidateId:identity.releaseCandidateId,batchId:planned.batch.id,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null};
      return parse(JSON.parse(JSON.stringify({batch:{...request.planned.batch,status:"RUNNING",finishedAt:null},sourceRows:[source]})));
    }
    if(kind==="READ_CONTEXT")return parse({...context,checkedAt:new Date().toISOString()});
    expect(kind).toBe("ARCHIVE_STORE");
    const pack=payload as {bundlePath:string;bundleSha256:string;byteCount:number},bytes=await readFile(pack.bundlePath);
    archiveByteCount=bytes.length;
    if(extended||lateUnknown||slow||slowUpload||renewBudget)expect(_deadline).toBe(started+230000);
    expect(sha256(bytes)).toBe(pack.bundleSha256);expect(bytes.length).toBe(pack.byteCount);
    if(mode==="archive-unknown")throw Error("ARCHIVE_UPLOAD_OUTCOME_UNKNOWN");
    if(mode==="archive-missing-ack")return parse(undefined);
    archiveSaved=true;
    if(extended)vi.setSystemTime(started+200000);
    if(slowUpload)vi.setSystemTime(started+65000);
    if(lateUnknown)vi.setSystemTime(started+229000);
    if(renewBudget)vi.setSystemTime(started+225000);
    if(mode==="archive-local-hash"){const changed=Buffer.from(bytes);changed[0]=changed[0]===32?10:32;await writeFile(pack.bundlePath,changed);}
    if(mode==="archive-local-size")await writeFile(pack.bundlePath,Buffer.concat([bytes,Buffer.from(" ")]));
    const ack:Record<string,unknown>={bundleSha256:pack.bundleSha256,bundleByteCount:pack.byteCount,libraryFileId:"libfile_synthetic",libraryVersion:"0",libraryFileIdBacking:"file_synthetic",packedSha256:"e".repeat(64),packedByteCount:123,stored:true,recoveryVerification:"PENDING"};
    if(mode==="archive-bad-hash")ack.bundleSha256="0".repeat(64);
    if(mode==="archive-bad-size")ack.bundleByteCount=pack.byteCount+1;
    if(mode==="archive-missing-reference")delete ack.libraryFileIdBacking;
    if(mode==="archive-bad-packed-hash")ack.packedSha256="invalid";
    if(mode==="archive-bad-packed-size")ack.packedByteCount=0;
    if(mode==="archive-not-stored")ack.stored=false;
    if(mode==="archive-fake-verification")ack.fullContentVerified=true;
    return parse(ack);
  });
  if(exception)vi.spyOn(sourceCrawl,"runSourceCrawl").mockImplementationOnce(async(_plan,deps)=>{
    deps.attemptTracker!.fetchAttemptCount=1;
    throw sourceError;
  });
  const run=()=>runCloudSourcePilot({bootstrapPath,reviewedSha256:sha256(bootstrapBytes),workspaceRoot,relayDirectory:join(workspaceRoot,"relay")});
  if(!success){
    const consoleError=vi.spyOn(console,"error").mockImplementation(()=>{});
    // This is the previous CLI catch: its generic text contains no root code.
    let caught:unknown;await run().catch(error=>{caught=error;console.error("CLOUD_SOURCE_PILOT_STOPPED_REVIEW_RELAY_AND_PERSISTED_OUTCOME");});
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/SYNTHETIC_NETWORK_BREAK|private upstream text/);
    const artifacts=(await readdir(workspaceRoot)).filter(name=>name.includes(".failure-"));expect(artifacts.length).toBe(releaseFailure?2:1);
    const diagnostics=await Promise.all(artifacts.map(async name=>{expect((await stat(join(workspaceRoot,name))).mode&0o777).toBe(0o600);return JSON.parse(await readFile(join(workspaceRoot,name),"utf8"));}));
    const diagnostic=diagnostics.find(d=>d.phase!=="RELEASE_LEASE")!;
    if(lateUnknown)expect(cleanupDeadline).toBe(started+349000);
    if(releaseFailure)expect(diagnostics.find(d=>d.phase==="RELEASE_LEASE").errors).toContainEqual(expect.objectContaining({code:"RELEASE_CONNECTION_LOST"}));
    if(archiveFailure){
      expect(caught).toBeDefined();
      expect(diagnostic.phase).toBe(mode.startsWith("archive-local-")?"VERIFY_LOCAL_ARCHIVE":"LIBRARY_STORE");
      expect(request.mock.calls.filter(c=>c[0]==="ARCHIVE_STORE")).toHaveLength(1);
      expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RELEASE"]);return;
    }
    if(renewBudget){
      expect(caught).toMatchObject({message:"PILOT_PUBLICATION_BUDGET_EXHAUSTED"});expect(diagnostic.phase).toBe("PUBLISH_AND_RECONCILE");expect(archiveSaved).toBe(true);
      expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE"]);return;
    }
    if(renewUnknown){
      expect(caught).toBe(renewError);expect(diagnostic.phase).toBe("RENEW_LEASE");expect(archiveSaved).toBe(true);
      expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE"]);return;
    }
    if(exception)expect(caught).toBe(sourceError);
    expect(diagnostic.sourceId).toBe("source-qilu-social");
    expect(diagnostic.attempts).toMatchObject({fetchAttemptCount:1,httpRequestCount:null});
    if(exception){
      expect(diagnostic.phase).toBe("ACQUIRE_SOURCE");expect(diagnostic.errors).toContainEqual(expect.objectContaining({class:"TypeError",code:"SYNTHETIC_NETWORK_BREAK"}));
    }else{
      expect(diagnostic.phase).toBe("CHECK_SOURCE_RESULT");expect(diagnostic.crawlResult).toMatchObject({status:"FAILED",truth:{transportSuccess:false,adapterSuccess:false}});
      expect(diagnostic.crawlResult.failureReason).toBeTypeOf("string");
    }
    expect(archiveSaved).toBe(false);expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RELEASE"]);return;
  }
  const report=await run();
  expect(report).toMatchObject({state:"COMMITTED_EXACT",jobCount:fixture.jobCount,batchFinalizationRequired:true,stored:true,recoveryVerification:"PENDING",libraryFileId:"libfile_synthetic",libraryVersion:"0",libraryFileIdBacking:"file_synthetic",packedSha256:"e".repeat(64),packedByteCount:123, bundleByteCount:archiveByteCount});
  expect(report).not.toHaveProperty("fullContentVerified");
  expect(request.mock.calls.filter(c=>c[0]==="ARCHIVE_STORE")).toHaveLength(1);
  expect(http).toHaveBeenCalledTimes(fixture.requestCount);expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","PUBLISH","READ_OUTCOME","LEASE_RELEASE"]);
  expect(terminal).toMatchObject({rawCount:fixture.rawCount,dedupeOutputCount:fixture.jobCount,completenessState:"VERIFIED",atomicCommitState:"COMMITTED"});
  if(process.env.QILU_RETAINED_ARTIFACT_ROOT)console.info("OFFLINE_QILU_RUNNER_BYTES",JSON.stringify({jobs:fixture.jobCount,sqlByteCount,archiveByteCount,contextJobs:context.jobs.length,retainedResponseBytes:fixture.responseBytes}));
});

it("preserves available evidence bytes privately and leaves unobserved attempt counts unknown",async()=>{
  const fixture=await ownedPortableFixture(),result=structuredClone(fixture.input.result);
  result.fetchEvidence!.artifacts[0]!.body=new Uint8Array([0,255,3]);
  const artifact=await preservePilotFailure({workspaceRoot:fixture.input.archive.workspaceRoot,batchId:"synthetic-diagnostic",phase:"BUILD_COMMIT",error:Error("SYNTHETIC_FAILURE"),result});
  const saved=JSON.parse(await readFile(artifact,"utf8"));
  expect(saved.attempts).toEqual({fetchAttemptCount:null,retryCount:null,retryReasonCodes:null,httpRequestCount:null});
  expect(saved.errors[0]).toMatchObject({class:"Error",code:"SYNTHETIC_FAILURE"});
  expect(saved.crawlResult.fetchEvidence.artifacts[0].body).toEqual({encoding:"base64",bytes:"AP8D"});
  expect(saved.crawlResult.fetchEvidence.artifacts[0].capturedAt).toBe(result.fetchEvidence!.artifacts[0]!.capturedAt);
});
