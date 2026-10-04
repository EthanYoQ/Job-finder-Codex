// @vitest-environment node
// Offline regression: official HTTP and database relay are fixtures. Ownership,
// archive replay, portable admission and compact atomic compilation are real.
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilePilotRelay, PilotSqlFailure, PILOT_BUDGET, sha256 } from "../../src/crawler/cloudSourcePilotRelay";
import { deriveCurrentStagedScheduleExpectation } from "../../src/crawler/stagedScheduleAuthority";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { CLOUD_PILOT_SQL45 } from "../../src/db/cloudPilotSql45Manifest";
import { PORTABLE_REFRESH_SOURCE_IDS, assertPortableRefreshPlan, portablePreLockReadyDeadline, runCloudPortableSourcePilot } from "../../scripts/p0-cloud-portable-source-pilot";
import * as admissions from "../../src/crawler/sourceQualityAdmission";
import * as crawls from "../../src/crawler/runSourceCrawl";

const build=vi.hoisted(()=>({schemaVersion:2 as const,commitSha:"a".repeat(40),sourceTreeSha256:"b".repeat(64),runtimeTreeSha256:"c".repeat(64),contentSha256:"d".repeat(64)}));
vi.mock("../../src/readiness/buildIdentity",()=>({resolveCurrentBuildIdentity:()=>build}));
vi.mock("../../src/db/cloudPilotSqlControl",()=>({CLOUD_PILOT_SOURCE:{id:"source-hansoh-social",ownerId:"dot-cloud-hansoh-social-pilot",sourceConfigSha256:"94d0982064af5a70386e017dec29cec1115c08480df2934e8d4cf0ddf644d740"}}));
const roots:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

it("limits the refresh entry to the twenty unchanged configurations registered by SQL47",async()=>{
  const plans=buildStagedSourceCrawlPlans(candidateCompanies);
  expect(PORTABLE_REFRESH_SOURCE_IDS).toHaveLength(20);
  const registration=CLOUD_PILOT_SQL45.migrations.find(m=>m.migrationName==="20261002101515_organon_source_policy")!;
  const sql=await readFile(`prisma/migrations/${registration.migrationName}/migration.sql`,"utf8");
  expect(CLOUD_PILOT_SQL45.migrations).toHaveLength(48);
  for(const plan of plans){
    if(PORTABLE_REFRESH_SOURCE_IDS.includes(plan.source.id)){
      expect(()=>assertPortableRefreshPlan(plan)).not.toThrow();
      expect(sql).toContain(`('${plan.source.id}','${plan.company.id}','${sourcePlanConfigSha256(plan)}')`);
      const changed=structuredClone(plan);changed.source.officialEntryUrl+="?changed=1";
      expect(()=>assertPortableRefreshPlan(changed)).toThrow("PILOT_PORTABLE_REFRESH_CONFIG_NOT_REVIEWED");
    }else expect(()=>assertPortableRefreshPlan(plan)).toThrow("PILOT_PORTABLE_REFRESH_SOURCE_NOT_ALLOWED");
  }
});

async function fixture(mode="success",prior:Record<string,unknown>|null=null){
  vi.useFakeTimers({toFake:["Date"]});
  const now=new Date(Date.now()+(prior?1000:0));vi.setSystemTime(now);
  const workspaceRoot=await mkdtemp(join(tmpdir(),"portable-refresh-runner-"));roots.push(workspaceRoot);
  const expected=deriveCurrentStagedScheduleExpectation(build);
  const plan=expected.plans.find(plan=>plan.source.id==="source-hansoh-social")!;
  const candidate={id:"synthetic-portable-refresh",status:"BUILDING",commitSha:expected.commitSha,rosterHash:expected.rosterSha256,sourcePlanHash:expected.sourcePlanSha256,sourceConfigHash:expected.sourceConfigSha256,adapterBundleHash:expected.adapterBundleSha256,sourceTreeHash:expected.sourceTreeSha256,runtimeTreeHash:expected.runtimeTreeSha256,oracleVersion:"staged-official-source-v1",minimumStableCompanyCount:41};
  const bootstrap={schemaVersion:1,checkedAt:now.toISOString(),candidateRows:[candidate],batchId:prior?"synthetic-hansoh-refresh-next":"synthetic-hansoh-refresh",
    ...(["retainedCapture","currentCapture","independentValidation"].includes(mode)?{[mode]:{path:"unused",sha256:"0".repeat(64)}}:{})};
  const bootstrapPath=join(workspaceRoot,"bootstrap.json"),bytes=JSON.stringify(bootstrap);await writeFile(bootstrapPath,bytes);
  const events:string[]=[],rows=Array.from({length:203},(_,index)=>({Id:`00000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,JobAdId:index+1,JobAdName:`职位${index+1}`,LocNames:["上海市"],Category:"社会招聘",CategoryId:"1",Kind:"全职",Status:1,PostDate:new Date(now.getTime()-86400000).toISOString().replace("Z",""),ChangeDate:"0001-01-01T00:00:00"}));
  const http=vi.fn(async(url:string,init:RequestInit)=>{
    events.push("HTTP");
    if(mode==="transport-failed")return {status:403,url:String(url),headers:new Headers({"content-type":"text/html"}),text:async()=>"Forbidden"};
    const page=JSON.parse(String(init.body)).PageIndex;
    return {status:200,url:String(url),headers:new Headers({"content-type":"application/json"}),text:async()=>JSON.stringify({Code:200,Count:rows.length,Data:rows.slice(page*100,(page+1)*100)})};
  });vi.stubGlobal("fetch",http);
  if(mode==="cloned-acquisition"){
    const original=crawls.runSourceCrawl;
    vi.spyOn(crawls,"runSourceCrawl").mockImplementation(async(...args)=>structuredClone(await original(...args)));
  }
  const admission=vi.spyOn(admissions,"issueSourceQualityAdmission");
  let source:Record<string,unknown>={},terminal:Record<string,unknown>={},publicationSql="",leaseStartedAt:number|undefined;
  const relaySql=vi.spyOn(FilePilotRelay.prototype,"sql").mockImplementation(async(kind,query,deadline)=>{
    events.push(kind);
    if(kind==="LEASE_ACQUIRE"){
      leaseStartedAt=Date.now();
      expect(deadline).toBe(Date.now()+PILOT_BUDGET.controlMs);
      expect(query).toContain("300000 * interval '1 millisecond'");
      expect(http).toHaveBeenCalledTimes(3);
      expect(admission.mock.results).toHaveLength(1);
      expect(await admission.mock.results[0]!.value).toMatchObject({status:"ACCEPTED"});
      return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    }
    if(kind==="LEASE_RENEW"){
      if(mode==="renew-unknown")throw new PilotSqlFailure("UNKNOWN","CONNECTION_LOST");
      return [{holderId:query.match(/'([a-f0-9-]{36})'/)![1]}];
    }
    if(kind==="LEASE_RELEASE")return [{holderId:""}];
    if(kind==="PUBLISH"){
      publicationSql=query;
      const match=query.match(/FROM jsonb_populate_record\(NULL::public\."CrawlBatchSourceResult", E'((?:[^']|'')*)'::jsonb\) AS v/)!;
      terminal=JSON.parse(match[1]!.replaceAll("''","'").replaceAll("\\\\","\\"));
      if(mode==="publish-rolled-back")throw new PilotSqlFailure("ROLLED_BACK","23514");
      return [];
    }
    if(kind==="READ_OUTCOME")return [{row:JSON.parse(JSON.stringify({blockerCode:null,blockerReason:null,failureCategory:null,failureDiagnosticCode:null,failureCode:null,failureReason:null,...source,...(mode==="publish-rolled-back"?{}:terminal)}))}];
    throw Error(`Unexpected SQL: ${kind}`);
  });
  const request=vi.spyOn(FilePilotRelay.prototype,"request").mockImplementation(async(kind,payload,_deadline,parse)=>{
    events.push(kind);
    if(kind==="READ_CONTEXT"){
      const purpose=(payload as {purpose?:string}).purpose;
      if(purpose==="PRE_LOCK_READY"){
        expect(events).not.toContain("LEASE_ACQUIRE");
        expect(_deadline).toBe(now.getTime()+5*60_000);
        if(mode==="pre-lock-timeout")throw Error("RELAY_DEADLINE");
        if(mode==="pre-lock-delayed"||mode==="pre-lock-stale")vi.setSystemTime(now.getTime()+120_000);
        if(mode==="pre-lock-expired")vi.setSystemTime(_deadline);
        if(mode==="pre-lock-wrong-source")return parse({sourceId:"source-novo-nordisk-china-social",sourceConfigSha256:sourcePlanConfigSha256(plan),jobs:[],firstAccepted:prior,latestAccepted:prior,checkedAt:new Date().toISOString()});
        if(mode==="pre-lock-wrong-config")return parse({sourceId:plan.source.id,sourceConfigSha256:"0".repeat(64),jobs:[],firstAccepted:prior,latestAccepted:prior,checkedAt:new Date().toISOString()});
        if(mode==="pre-lock-future")return parse({sourceId:plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(plan),jobs:[],firstAccepted:prior,latestAccepted:prior,checkedAt:new Date(Date.now()+2000).toISOString()});
        if(mode==="pre-lock-stale")return parse({sourceId:plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(plan),jobs:[],firstAccepted:prior,latestAccepted:prior,checkedAt:now.toISOString()});
      }
      if(mode==="expired-after-capture"&&events.includes("CREATE_PENDING"))vi.setSystemTime(now.getTime()+31*60*1000);
      if(mode==="archive-tampered"&&events.includes("CREATE_PENDING"))await writeFile(join(workspaceRoot,`${bootstrap.batchId}.archive.json`),"{}");
      return parse({sourceId:plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(plan),jobs:[],firstAccepted:prior,latestAccepted:prior,checkedAt:new Date().toISOString()});
    }
    if(kind==="CREATE_PENDING"){
      const {planned}=payload as {planned:{batch:Record<string,unknown>;sources:Array<Record<string,unknown>>}};
      source={...planned.sources[0],releaseCandidateId:candidate.id,batchId:bootstrap.batchId,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null};
      return parse(JSON.parse(JSON.stringify({batch:{...planned.batch,status:"RUNNING",finishedAt:null},sourceRows:[source]})));
    }
    throw Error(`Unexpected request: ${kind}`);
  });
  const run=()=>runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:sha256(bytes),workspaceRoot,relayDirectory:join(workspaceRoot,"relay")});
  return {run,now,events,http,admission,relaySql,request,getLeaseStartedAt:()=>leaseStartedAt,getTerminal:()=>terminal,getSql:()=>publicationSql,getPersisted:()=>JSON.parse(JSON.stringify({...source,...terminal})) as Record<string,unknown>};
}

it("refreshes real owned portable evidence before the short lease and compiles exactly one compact publication",async()=>{
  const f=await fixture(),report=await f.run();
  expect(report).toMatchObject({state:"COMMITTED_EXACT",sourceId:"source-hansoh-social",jobCount:203,certificateGrade:"PLAN_BOUND_SOURCE_QUALITY_V1",batchFinalizationRequired:true,archiveRetention:"PENDING",recoveryVerification:"PENDING"});
  expect(f.events).toEqual(["READ_CONTEXT","HTTP","HTTP","HTTP","READ_CONTEXT","LEASE_ACQUIRE","CREATE_PENDING","READ_CONTEXT","LEASE_RENEW","PUBLISH","READ_OUTCOME","LEASE_RELEASE"]);
  expect(f.admission).toHaveBeenCalledTimes(2);
  expect(f.getSql().match(/INSERT INTO public\."Job"/g)).toHaveLength(1);
  expect(f.getSql()).toContain("WITH ORDINALITY");
  expect(f.getTerminal()).toMatchObject({completenessState:"VERIFIED",atomicCommitState:"COMMITTED",dedupeOutputCount:203,completenessCertificate:{policyId:"PLAN_BOUND_SOURCE_QUALITY_V1",schemaVersion:"plan-bound-source-quality-v1",acquisition:{startedAt:f.now.toISOString(),finishedAt:f.now.toISOString()}}});
  expect(f.getTerminal().completenessCertificate).not.toHaveProperty("grade");
  expect(JSON.stringify(f.getTerminal().completenessCertificate)).not.toContain("CURRENT_RUN");
});

it("bounds pre-lock readiness by original acquisition age with the complete publication reserve",()=>{
  const now=Date.parse("2026-10-03T21:00:00.000Z"),end=now-18*60_000;
  expect(portablePreLockReadyDeadline({startedAt:new Date(end-8*60_000).toISOString(),finishedAt:new Date(end).toISOString()},now))
    .toBe(end+30*60_000-PILOT_BUDGET.totalMs);
  expect(portablePreLockReadyDeadline({startedAt:new Date(now-8*60_000).toISOString(),finishedAt:new Date(now).toISOString()},now))
    .toBe(now+5*60_000);
});
it.each([
  ["insufficient reserve",-22*60_000,-21*60_000,"PILOT_PRE_LOCK_BUDGET_EXHAUSTED"],
  ["expired capture",-32*60_000,-31*60_000,"PILOT_PRE_LOCK_BUDGET_EXHAUSTED"],
  ["overlong capture",-31*60_000,0,"PILOT_PRE_LOCK_CAPTURE_TIME_INVALID"],
  ["future capture",0,1000,"PILOT_PRE_LOCK_CAPTURE_TIME_INVALID"]
])("rejects pre-lock %s without changing original capture time",(_label,startOffset,endOffset,code)=>{
  const now=Date.parse("2026-10-03T21:00:00.000Z");
  expect(()=>portablePreLockReadyDeadline({startedAt:new Date(now+Number(startOffset)).toISOString(),finishedAt:new Date(now+Number(endOffset)).toISOString()},now)).toThrow(String(code));
});
it("waits for pre-lock readiness without holding or aging a lease",async()=>{
  const f=await fixture("pre-lock-delayed"),report=await f.run();
  expect(report.state).toBe("COMMITTED_EXACT");
  expect(f.getLeaseStartedAt()).toBe(f.now.getTime()+120_000);
  expect(f.http).toHaveBeenCalledTimes(3);
  expect(f.getTerminal().completenessCertificate).toMatchObject({acquisition:{startedAt:f.now.toISOString(),finishedAt:f.now.toISOString()}});
});
it.each(["pre-lock-timeout","pre-lock-stale","pre-lock-future","pre-lock-expired","pre-lock-wrong-source","pre-lock-wrong-config"])("stops before any lease or pending write for %s",async mode=>{
  const f=await fixture(mode);await expect(f.run()).rejects.toThrow();
  expect(f.events).not.toContain("LEASE_ACQUIRE");expect(f.events).not.toContain("CREATE_PENDING");expect(f.events).not.toContain("PUBLISH");
  expect(f.relaySql).not.toHaveBeenCalled();expect(f.http).toHaveBeenCalledTimes(3);
});

it("refreshes against the original accepted portable receipt without requiring an A/B baseline",async()=>{
  const first=await fixture();await first.run();const prior=first.getPersisted();
  vi.restoreAllMocks();vi.unstubAllGlobals();
  const next=await fixture("success",prior),report=await next.run();
  expect(report.state).toBe("COMMITTED_EXACT");
  expect(next.getTerminal()).toMatchObject({baselinePreviousSourceResultId:prior.id,baselinePreviousJobCount:203,completenessCertificate:{policyId:"PLAN_BOUND_SOURCE_QUALITY_V1"}});
  expect(next.admission.mock.calls[0]![0].result.jobs.every(job=>job.isBaseline===false)).toBe(true);
});

it.each(["retainedCapture","currentCapture","independentValidation"])("rejects %s input before any relay or HTTP request",async mode=>{
  const f=await fixture(mode);await expect(f.run()).rejects.toThrow();expect(f.events).toEqual([]);
});
it.each(["transport-failed","cloned-acquisition"])("rejects %s before acquiring a lease",async mode=>{
  const f=await fixture(mode);await expect(f.run()).rejects.toThrow();expect(f.events).not.toContain("LEASE_ACQUIRE");expect(f.events).not.toContain("PUBLISH");
});
it.each(["expired-after-capture","archive-tampered","renew-unknown"])("does not publish or retry after %s and releases only its own lease",async mode=>{
  const f=await fixture(mode);await expect(f.run()).rejects.toThrow();expect(f.events).not.toContain("PUBLISH");expect(f.events.at(-1)).toBe("LEASE_RELEASE");
});
it("reads back a rolled-back publication once without resending",async()=>{
  const f=await fixture("publish-rolled-back"),report=await f.run();
  expect(report.state).toBe("PENDING");
  expect(f.events.filter(event=>event==="PUBLISH")).toHaveLength(1);
  expect(f.events.slice(-3)).toEqual(["PUBLISH","READ_OUTCOME","LEASE_RELEASE"]);
});
