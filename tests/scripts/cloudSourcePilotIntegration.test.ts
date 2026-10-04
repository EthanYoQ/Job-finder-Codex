// @vitest-environment node
// All identity, HTTP, SQL and Library boundaries below are synthetic/offline.
import { afterAll, afterEach, expect, it, vi } from "vitest";
const selectedSourceBeforeTest = vi.hoisted(() => {
  const previous = process.env.JOBFINDER_CLOUD_SOURCE_ID;
  process.env.JOBFINDER_CLOUD_SOURCE_ID = "source-qilu-social";
  return previous;
});
afterAll(() => {
  if (selectedSourceBeforeTest === undefined) delete process.env.JOBFINDER_CLOUD_SOURCE_ID;
  else process.env.JOBFINDER_CLOUD_SOURCE_ID = selectedSourceBeforeTest;
});
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveCurrentStagedScheduleExpectation, resolveCurrentStagedScheduleAuthority } from "../../src/crawler/stagedScheduleAuthority";
import { buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { FilePilotRelay, PilotSqlFailure, sha256 } from "../../src/crawler/cloudSourcePilotRelay";
import * as sourceCrawl from "../../src/crawler/runSourceCrawl";
import { selectedPilotIdentity, preservePilotFailure } from "../../scripts/p0-cloud-source-pilot";
import { runCloudPortableSourcePilot } from "../../scripts/p0-cloud-portable-source-pilot";
import { qiluPilotHttpFixture } from "../helpers/cloudQiluPilotFixture";
import { ownedPortableFixture } from "../db/helpers/ownedPortableCommit";
const build=vi.hoisted(()=>({schemaVersion:2 as const,commitSha:"a".repeat(40),sourceTreeSha256:"b".repeat(64),runtimeTreeSha256:"c".repeat(64),contentSha256:"d".repeat(64)}));
vi.mock("../../src/readiness/buildIdentity",()=>({resolveCurrentBuildIdentity:()=>build}));
// Absolute unknown-result settlement is exercised by cloudSourcePilot.test.ts.
vi.mock("node:timers/promises",()=>({setTimeout:async()=>undefined}));
const roots:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
// Coverage migration from the retired in-lease Library upload:
// success-slow-upload -> success-delayed-pre-lock (readiness waits without a lease).
// archive-unknown/missing-ack -> pre-lock-read-unknown/missing-ack.
// archive-bad-hash/bad-size/missing-reference -> pre-lock-wrong-config/expired/wrong-source.
// archive-bad-packed-hash/bad-packed-size/not-stored -> pre-lock-invalid-time/stale/future.
// archive-fake-verification -> success-forged-storage-claim (never promote an unsolicited claim).
// exception-release-failure -> context-failure-release-failure: source acquisition
// now precedes ownership, so a source exception must never attempt lease cleanup.
// Local archive hash/size, all renewal/unknown/cleanup cases remain end-to-end.
const modes = [
  "success", "success-extended", "success-slow-controls", "success-delayed-pre-lock",
  "pre-lock-read-unknown", "pre-lock-missing-ack", "pre-lock-wrong-config", "pre-lock-expired",
  "pre-lock-wrong-source", "pre-lock-invalid-time", "pre-lock-stale", "pre-lock-future",
  "success-forged-storage-claim", "archive-local-hash", "archive-local-size", "renew-budget-exhausted",
  "exception", "failure-result", "renew-unknown", "context-failure-release-failure",
  "renew-unknown-release-failure", "renew-unknown-late-release-failure"
] as const;
it.each(modes)("retains truthful one-process Qilu portable outcome for %s",async mode=>{
  const archiveFailure=mode.startsWith("archive-local-"),preLockFailure=mode.startsWith("pre-lock-");
  const slow=mode==="success-slow-controls",renewBudget=mode==="renew-budget-exhausted";
  const lateUnknown=mode==="renew-unknown-late-release-failure",extended=mode==="success-extended";
  const success=mode.startsWith("success"),exception=mode==="exception",renewUnknown=mode.startsWith("renew-unknown"),releaseFailure=mode.endsWith("release-failure");
  const sourceError=new sourceCrawl.SourceCrawlStageError("FETCH",Object.assign(new TypeError("private upstream text must not reach console"),{code:"SYNTHETIC_NETWORK_BREAK"}));
  const renewError=new PilotSqlFailure("UNKNOWN","CONNECTION_LOST"),releaseError=new PilotSqlFailure("UNKNOWN","RELEASE_CONNECTION_LOST");
  const contextError=Error("SYNTHETIC_OWNED_CONTEXT_FAILURE"),readyError=Error("SYNTHETIC_READY_READ_UNKNOWN");
  const timers:Array<{ms:number;controller:AbortController}>=[];
  vi.useFakeTimers({toFake:["Date"]});
  vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{const controller=new AbortController();timers.push({ms,controller});return controller.signal;});
  const workspaceRoot=await mkdtemp(join(tmpdir(),"qilu-pilot-integration-"));roots.push(workspaceRoot);
  const expected=deriveCurrentStagedScheduleExpectation(build),candidate={id:"synthetic-cloud-candidate",status:"BUILDING",commitSha:expected.commitSha,rosterHash:expected.rosterSha256,sourcePlanHash:expected.sourcePlanSha256,sourceConfigHash:expected.sourceConfigSha256,adapterBundleHash:expected.adapterBundleSha256,sourceTreeHash:expected.sourceTreeSha256,runtimeTreeHash:expected.runtimeTreeSha256,oracleVersion:"staged-official-source-v1",minimumStableCompanyCount:41};
  const authority=await resolveCurrentStagedScheduleAuthority({releaseCandidate:{findMany:async()=>[candidate]}}),identity=selectedPilotIdentity(authority.identity),plan=authority.plans.find(p=>p.source.id===identity.expectedPlannedSourceIds[0])!;
  const now=new Date(),planned=buildPendingRuntimeBatch("synthetic-qilu-pilot",[plan],identity,now);
  let source:Record<string,unknown>={},terminal:Record<string,unknown>={};
  const context={sourceId:plan.source.id,sourceConfigSha256:planned.sources[0]!.sourceConfigHash,jobs:[],firstAccepted:null,latestAccepted:null};
  const bootstrap={schemaVersion:1,checkedAt:now.toISOString(),candidateRows:[candidate],batchId:planned.batch.id};
  const bootstrapPath=join(workspaceRoot,"bootstrap.json"),bootstrapBytes=JSON.stringify(bootstrap);await writeFile(bootstrapPath,bootstrapBytes);
  const fixture=await qiluPilotHttpFixture(),events:string[]=[];
  const http=vi.fn(async (url:string,init?:RequestInit)=>{
    events.push("HTTP");expect(leaseStarted).toBeUndefined();
    if(mode==="failure-result")return {status:403,url,headers:new Headers({"content-type":"text/html"}),text:async()=>"Forbidden"};
    return fixture.fetch(url,init);
  });vi.stubGlobal("fetch",http);
  let leaseStarted:number|undefined,cleanupDeadline=0,localArchiveChecked=false;
  const archivePath=join(workspaceRoot,`${planned.batch.id}.archive.json`);
  const advanceControl=(kind:string,deadline:number)=>{
    if(!slow)return;
    const pickup=kind==="LEASE_ACQUIRE"?15000:kind==="READ_CONTEXT"||kind==="READ_OUTCOME"?34999:30000;
    const sent=Date.now();expect(deadline).toBe(sent+60000);vi.setSystemTime(sent+pickup+5000);
  };
  const sql=vi.spyOn(FilePilotRelay.prototype,"sql").mockImplementation(async(kind,query,deadline,signal)=>{
    events.push(kind);
    if(kind==="LEASE_ACQUIRE")leaseStarted=Date.now();
    if(kind!=="PUBLISH")advanceControl(kind,deadline);
    if(kind==="LEASE_ACQUIRE"){
      expect(events.indexOf("PRE_LOCK_READY")).toBeLessThan(events.indexOf(kind));
      expect(http).toHaveBeenCalledTimes(fixture.requestCount);
      return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    }
    if(kind==="LEASE_RELEASE"){
      cleanupDeadline=deadline;
      expect(query).toContain('"holderId"');
      if(releaseFailure)throw releaseError;
      if(extended)expect(deadline).toBeGreaterThan(leaseStarted!+310000);
      return [{holderId:""}];
    }
    if(kind==="LEASE_RENEW"){
      expect(localArchiveChecked).toBe(true);
      if(lateUnknown)vi.setSystemTime(leaseStarted!+289000);
      if(renewUnknown)throw renewError;
      if(extended)vi.setSystemTime(leaseStarted!+220000);
      if(renewBudget)vi.setSystemTime(leaseStarted!+284000);
      return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    }
    if(kind==="PUBLISH"){
      if(extended){
        const initial=timers.find(t=>t.ms>280000&&t.ms<=290000)!;expect(initial).toBeDefined();
        vi.setSystemTime(leaseStarted!+310000);initial.controller.abort();
        expect(signal?.aborted).toBe(false);expect(deadline).toBe(leaseStarted!+430000);
      }
      expect(localArchiveChecked).toBe(true);expect(query).toMatch(/^SET LOCAL statement_timeout = '120000ms';\nDO /);
      const match=query.match(/FROM jsonb_populate_record\(NULL::public\."CrawlBatchSourceResult", E'((?:[^']|'')*)'::jsonb\) AS v/)!;
      terminal=JSON.parse(match[1]!.replaceAll("''","'").replaceAll("\\\\","\\"));return [];
    }
    if(kind==="READ_OUTCOME")return [{row:JSON.parse(JSON.stringify({blockerCode:null,blockerReason:null,failureCategory:null,failureDiagnosticCode:null,failureCode:null,failureReason:null,...source,...terminal}))}];
    throw Error(`Unexpected SQL: ${kind}`);
  });
  const request=vi.spyOn(FilePilotRelay.prototype,"request").mockImplementation(async(kind,payload,deadline,parse)=>{
    const p=payload as Record<string,unknown>,purpose=p.purpose;
    events.push(kind==="READ_CONTEXT"&&purpose?String(purpose):kind);
    if(kind==="CREATE_PENDING"){
      advanceControl(kind,deadline);
      const request=payload as {planned:ReturnType<typeof buildPendingRuntimeBatch>};
      source={...request.planned.sources[0],releaseCandidateId:identity.releaseCandidateId,batchId:planned.batch.id,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null};
      return parse(JSON.parse(JSON.stringify({batch:{...request.planned.batch,status:"RUNNING",finishedAt:null},sourceRows:[source]})));
    }
    if(kind!=="READ_CONTEXT")throw Error(`Unexpected request: ${kind}`);
    if(purpose){expect(sql).not.toHaveBeenCalled();expect(p).not.toHaveProperty("holderId");expect(p).not.toHaveProperty("sourceResultId");}
    if(purpose==="PRE_LOCK_READY"){
      const requestedAt=Date.now();expect(deadline).toBe(requestedAt+300000);
      if(mode==="pre-lock-read-unknown")throw readyError;
      if(mode==="pre-lock-missing-ack")return parse(undefined);
      if(mode==="success-delayed-pre-lock")vi.setSystemTime(requestedAt+65000);
      if(mode==="pre-lock-expired")vi.setSystemTime(deadline);
      if(mode==="pre-lock-stale")vi.setSystemTime(requestedAt+120000);
      const ready:Record<string,unknown>={...context,checkedAt:new Date().toISOString()};
      if(mode==="pre-lock-wrong-source")ready.sourceId="source-novo-nordisk-china-social";
      if(mode==="pre-lock-wrong-config")ready.sourceConfigSha256="0".repeat(64);
      if(mode==="pre-lock-invalid-time")ready.checkedAt="not-a-timestamp";
      if(mode==="pre-lock-stale")ready.checkedAt=new Date(requestedAt).toISOString();
      if(mode==="pre-lock-future")ready.checkedAt=new Date(Date.now()+2000).toISOString();
      if(mode==="success-forged-storage-claim")Object.assign(ready,{stored:true,archiveRetention:"STORED",recoveryVerification:"VERIFIED",libraryFileId:"libfile_untrusted",libraryFileIdBacking:"file_untrusted",packedSha256:"e".repeat(64),packedByteCount:123,fullContentVerified:true});
      return parse(ready);
    }
    advanceControl(kind,deadline);
    if(!purpose){
      expect(p.holderId).toBeTypeOf("string");expect(p.sourceResultId).toBe(source.id);
      if(mode==="context-failure-release-failure")throw contextError;
      const bytes=await readFile(archivePath);localArchiveChecked=true;
      if(mode==="archive-local-hash"){const changed=Buffer.from(bytes);changed[0]=changed[0]===32?10:32;await writeFile(archivePath,changed);}
      if(mode==="archive-local-size")await writeFile(archivePath,Buffer.concat([bytes,Buffer.from(" ")]));
      if(extended)vi.setSystemTime(leaseStarted!+200000);
      if(lateUnknown)vi.setSystemTime(leaseStarted!+229000);
      if(renewBudget)vi.setSystemTime(leaseStarted!+225000);
    }
    return parse({...context,checkedAt:new Date().toISOString()});
  });
  if(exception)vi.spyOn(sourceCrawl,"runSourceCrawl").mockImplementationOnce(async(_plan,deps)=>{
    deps.attemptTracker!.fetchAttemptCount=1;throw sourceError;
  });
  const run=()=>runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:sha256(bootstrapBytes),workspaceRoot,relayDirectory:join(workspaceRoot,"relay")});
  if(!success){
    const consoleError=vi.spyOn(console,"error").mockImplementation(()=>{});
    let caught:unknown;await run().catch(error=>{caught=error;console.error("CLOUD_SOURCE_PILOT_STOPPED_REVIEW_RELAY_AND_PERSISTED_OUTCOME");});
    expect(caught).toBeDefined();
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/SYNTHETIC_NETWORK_BREAK|private upstream text/);
    expect(request.mock.calls.some(c=>c[0]==="ARCHIVE_STORE")).toBe(false);
    expect((await readdir(workspaceRoot)).some(name=>name.endsWith(".outcome.json"))).toBe(false);
    const artifacts=(await readdir(workspaceRoot)).filter(name=>name.includes(".failure-"));expect(artifacts.length).toBe(releaseFailure?2:1);
    const diagnostics=await Promise.all(artifacts.map(async name=>{expect((await stat(join(workspaceRoot,name))).mode&0o777).toBe(0o600);return JSON.parse(await readFile(join(workspaceRoot,name),"utf8"));}));
    const diagnostic=diagnostics.find(d=>d.phase!=="RELEASE_LEASE")!;
    if(lateUnknown)expect(cleanupDeadline).toBe(leaseStarted!+349000);
    if(releaseFailure)expect(diagnostics.find(d=>d.phase==="RELEASE_LEASE").errors).toContainEqual(expect.objectContaining({code:"RELEASE_CONNECTION_LOST"}));
    if(preLockFailure){
      expect(diagnostic.phase).toBe("PRE_LOCK_READY");expect(sql).not.toHaveBeenCalled();expect(events).not.toContain("CREATE_PENDING");
      expect(http).toHaveBeenCalledTimes(fixture.requestCount);
      if(mode==="pre-lock-read-unknown")expect(caught).toBe(readyError);
      return;
    }
    if(archiveFailure){
      expect(caught).toMatchObject({message:"PILOT_ORIGINAL_ARCHIVE_BYTES_CHANGED"});expect(diagnostic.phase).toBe("VERIFY_LOCAL_ARCHIVE");
      expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RELEASE"]);return;
    }
    if(mode==="context-failure-release-failure"){
      expect(caught).toBe(contextError);expect(diagnostic.phase).toBe("READ_CONTEXT");
      expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RELEASE"]);return;
    }
    if(renewBudget){
      expect(caught).toMatchObject({message:"PILOT_PUBLICATION_BUDGET_EXHAUSTED"});expect(diagnostic.phase).toBe("PUBLISH_AND_RECONCILE");expect(localArchiveChecked).toBe(true);
      expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE"]);return;
    }
    if(renewUnknown){
      expect(caught).toBe(renewError);expect(diagnostic.phase).toBe("RENEW_LEASE");expect(localArchiveChecked).toBe(true);
      expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE"]);return;
    }
    if(exception)expect(caught).toBe(sourceError);
    expect(diagnostic.sourceId).toBe("source-qilu-social");expect(diagnostic.attempts).toMatchObject({fetchAttemptCount:1,httpRequestCount:null});
    if(exception){expect(diagnostic.phase).toBe("ACQUIRE_SOURCE");expect(diagnostic.errors).toContainEqual(expect.objectContaining({class:"TypeError",code:"SYNTHETIC_NETWORK_BREAK"}));}
    else{expect(diagnostic.phase).toBe("CHECK_SOURCE_RESULT");expect(diagnostic.crawlResult).toMatchObject({status:"FAILED",truth:{transportSuccess:false,adapterSuccess:false}});expect(diagnostic.crawlResult.failureReason).toBeTypeOf("string");}
    expect(localArchiveChecked).toBe(false);expect(sql).not.toHaveBeenCalled();return;
  }
  const report=await run(),bundleBytes=await readFile(archivePath);
  expect(report).toMatchObject({state:"COMMITTED_EXACT",jobCount:fixture.jobCount,batchFinalizationRequired:true,archiveRetention:"PENDING",recoveryVerification:"PENDING",certificateGrade:"PLAN_BOUND_SOURCE_QUALITY_V1",bundleByteCount:bundleBytes.length,bundleSha256:sha256(bundleBytes)});
  for(const key of ["stored","libraryFileId","libraryVersion","libraryFileIdBacking","packedSha256","packedByteCount","fullContentVerified"])expect(report).not.toHaveProperty(key);
  expect(request.mock.calls.some(c=>c[0]==="ARCHIVE_STORE")).toBe(false);
  expect(http).toHaveBeenCalledTimes(fixture.requestCount);expect(sql.mock.calls.map(c=>c[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","PUBLISH","READ_OUTCOME","LEASE_RELEASE"]);
  expect(terminal).toMatchObject({rawCount:fixture.rawCount,dedupeOutputCount:fixture.jobCount,completenessState:"VERIFIED",atomicCommitState:"COMMITTED"});
  if(mode==="success-delayed-pre-lock")expect(leaseStarted).toBe(now.getTime()+65000);
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
