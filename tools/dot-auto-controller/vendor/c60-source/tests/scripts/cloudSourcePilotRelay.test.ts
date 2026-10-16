import {readyRequestNames} from "../../ops/cloud-pilot-host/relay-request-ready.mjs";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilePilotRelay, PilotSqlFailure, sha256, reviveUtcFields, prepareLeaseStatement,
  acquireCloudPilotLease, prepareCloudPilotRenewalSql, makeArchiveBundle, restoreArchiveBundle } from "../../src/crawler/cloudSourcePilotRelay";
import { ownedPortableFixture } from "../db/helpers/ownedPortableCommit";
const dirs:string[]=[];
async function dir(){const p=await mkdtemp(join(tmpdir(),"cloud-pilot-test-"));dirs.push(p);return p;}
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function requestFile(root:string){
  for(let i=0;i<100;i++){const names=await readdir(root),name=readyRequestNames(names).find(n=>!names.includes(n.replace(".request.",".response.")));if(name)return {name,value:JSON.parse(await readFile(join(root,name),"utf8"))};await new Promise(r=>setTimeout(r,5));}
  throw Error("No request");
}
async function reply(root:string,req:Awaited<ReturnType<typeof requestFile>>,result:unknown,hash=req.value.requestSha256){
  await writeFile(join(root,req.name.replace(".request.",".response.")),JSON.stringify({schemaVersion:1,requestId:req.value.requestId,requestSha256:hash,kind:req.value.kind,result}));
}
describe("bounded tool relay",()=>{
  it("hash-binds the exact request and accepts only its typed response",async()=>{
    const root=await dir(),relay=new FilePilotRelay(root);const pending=relay.sql("READ_OUTCOME","SELECT 1",Date.now()+60000);
    const req=await requestFile(root),{requestSha256,...body}=req.value;
    expect(sha256(JSON.stringify(body))).toBe(requestSha256);expect(body.expiresAt).toMatch(/Z$/);
    await reply(root,req,{status:"SUCCEEDED",rows:[{n:1}]});expect(await pending).toEqual([{n:1}]);
  });
  it("rejects an old response, unknown result shape, timeout and cancellation",async()=>{
    const root=await dir(),relay=new FilePilotRelay(root);const pending=relay.sql("READ_OUTCOME","SELECT 1",Date.now()+60000);
    const failed=expect(pending).rejects.toThrow(/RELAY_RESPONSE_BINDING/);const req=await requestFile(root);
    await reply(root,req,{status:"SUCCEEDED",rows:[]},"0".repeat(64));await failed;
    const timed=relay.request("ARCHIVE_STORE",{},Date.now()+15,value=>value);await expect(timed).rejects.toThrow(/RELAY_DEADLINE/);
    const controller=new AbortController();controller.abort();
    await expect(relay.sql("READ_OUTCOME","SELECT 3",Date.now()+60000,controller.signal)).rejects.toThrow();
  });
  it("creates real owned lease only from the exact returned holder row and releases conditionally",async()=>{
    const root=await dir(),relay=new FilePilotRelay(root),end=Date.now()+40000;
    const acquired=acquireCloudPilotLease(relay,end);const req=await requestFile(root);
    expect(req.value.kind).toBe("LEASE_ACQUIRE");
    const holder=req.value.payload.sql.match(/'([a-f0-9-]{36})'/)[1];
    await reply(root,req,{status:"SUCCEEDED",rows:[{holderId:holder}]});
    const lease=await acquired;expect(lease.handle.holderId).toBe(holder);
    const releasing=lease.release();const release=await requestFile(root);
    expect(release.value.kind).toBe("LEASE_RELEASE");expect(release.value.payload.sql).toContain(holder);
    await reply(root,release,{status:"SUCCEEDED",rows:[{holderId:""}]});await releasing;
  });
  it("rejects fence SELECT and multi-statement strings before dispatch",()=>{
    expect(()=>prepareLeaseStatement('SELECT "id" FROM "CrawlCoordinatorLock" WHERE "id" = $1 FOR UPDATE',["formal-crawl"])).toThrow(/LEASE_SQL_NOT_ALLOWED/);
    expect(()=>prepareLeaseStatement('UPDATE "CrawlCoordinatorLock" SET "holderId" = \'\'; SELECT 1',[])).toThrow(/LEASE_SQL_NOT_ALLOWED/);
  });
});
describe("archive and persisted timestamps",()=>{
  it("restores every original relative path, byte, sidecar and timestamp in a fresh directory",async()=>{
    const f=await ownedPortableFixture(),a=f.input.archive;
    const verify={...a,...f.input.binding,sourceId:f.input.plan.source.id,artifacts:a.artifacts};
    const bundle=await makeArchiveBundle(verify),fresh=await dir();
    await restoreArchiveBundle(bundle,fresh);
    for(const artifact of a.artifacts)expect(await readFile(join(fresh,artifact.path))).toEqual(await readFile(join(a.workspaceRoot,artifact.path)));
    expect(bundle.sidecar.artifacts[0]!.capturedAt).toBe(a.artifacts[0]!.capturedAt.toISOString());
    const changed=structuredClone(bundle);changed.files[0]!.chunks[0]="dGFtcGVyZWQ=";
    await expect(restoreArchiveBundle(changed,await dir())).rejects.toThrow();
  });
  it("revives database UTC timestamps explicitly while preserving receipt strings",()=>{
    const row=reviveUtcFields({startedAt:"2026-10-02T02:16:57.216",finishedAt:"2026-10-02T02:16:58.216Z",completenessCertificate:{issuedAt:"2026-10-02T02:16:58.216Z"}},["startedAt","finishedAt"]);
    expect(row.startedAt.toISOString()).toBe("2026-10-02T02:16:57.216Z");
    expect(row.completenessCertificate.issuedAt).toBeTypeOf("string");
    expect(()=>reviveUtcFields({finishedAt:"2026-10-02 02:16:57+08"},["finishedAt"])).toThrow(/UTC_TIMESTAMP/);
  });
});

it("uses the absolute remaining publish review window, reserving 165 seconds after dispatch",async()=>{
  const relay=new FilePilotRelay("unused"),deadline=Date.now()+270000;
  const request=vi.spyOn(relay,"request").mockImplementation(async(_kind,_payload,_deadline,parse)=>parse({status:"SUCCEEDED",rows:[]}));
  await relay.sql("PUBLISH","SET LOCAL; DO",deadline);
  expect(request.mock.calls[0]![2]).toBe(deadline);
  expect((request.mock.calls[0]![1] as {dispatchBefore:string}).dispatchBefore).toBe(new Date(deadline-165000).toISOString());
});
it.each([
  [{status:"FAILED",outcome:"ROLLED_BACK",code:"57014"},"ROLLED_BACK"],
  [{status:"FAILED",outcome:"NOT_DISPATCHED",code:"EXPIRED"},"NOT_DISPATCHED"],
  [{status:"FAILED",outcome:"UNKNOWN",code:"IO_ERROR"},"UNKNOWN"],
  [{status:"FAILED",outcome:"ROLLED_BACK",code:"08007"},"UNKNOWN"],
  [{status:"FAILED",outcome:"ROLLED_BACK",code:"40003"},"UNKNOWN"],
  [{status:"FAILED",outcome:"ROLLED_BACK",code:"arbitrary error"},"UNKNOWN"]
])("classifies a relay failure conservatively: %j",async(response,outcome)=>{
  const relay=new FilePilotRelay("unused");vi.spyOn(relay,"request").mockImplementation(async(_k,_p,_d,parse)=>parse(response));
  await expect(relay.sql("PUBLISH","SQL",Date.now()+270000)).rejects.toMatchObject({outcome});
});

it.each([15000,30000,34999])("accepts actual lease pickup after %sms with a bounded sixty-second control wait",async pickup=>{
  vi.useFakeTimers({toFake:["Date"]});const started=Date.now();
  const root=await dir(),relay=new FilePilotRelay(root),pending=acquireCloudPilotLease(relay,started+290000),req=await requestFile(root);
  expect(Date.parse(req.value.expiresAt)).toBe(started+60000);
  expect(Date.parse(req.value.payload.dispatchBefore)).toBe(started+35000);
  const holder=req.value.payload.sql.match(/'([a-f0-9-]{36})'/)[1];
  expect(started+pickup).toBeLessThan(Date.parse(req.value.payload.dispatchBefore));
  vi.setSystemTime(started+pickup+10000);await reply(root,req,{status:"SUCCEEDED",rows:[{holderId:holder}]});
  expect((await pending).handle.holderId).toBe(holder);
});
it.each(["READ_OUTCOME","PUBLISH"] as const)("rejects %s at the last safe dispatch instant before emitting a request",kind=>{
  vi.useFakeTimers({toFake:["Date"]});const started=Date.now(),relay=new FilePilotRelay("unused"),deadline=started+(kind==="PUBLISH"?250000:60000);
  const request=vi.spyOn(relay,"request").mockResolvedValue([]);vi.setSystemTime(deadline-(kind==="PUBLISH"?165000:25000));
  expect(()=>relay.sql(kind,"SQL",deadline)).toThrow("RELAY_DISPATCH_BUDGET");expect(request).not.toHaveBeenCalled();
});

async function syntheticOwnedLease(renew?: (holder:string)=>Promise<Record<string,unknown>[]>){
  const relay=new FilePilotRelay("unused"),started=Date.now();let holder="";
  const sql=vi.spyOn(relay,"sql").mockImplementation(async(kind,query)=>{
    if(kind==="LEASE_ACQUIRE"){holder=query.match(/'([a-f0-9-]{36})'/)![1]!;return [{holderId:holder}];}
    if(kind==="LEASE_RENEW")return renew?await renew(holder):[{holderId:holder}];
    if(kind==="LEASE_RELEASE")return [{holderId:""}];
    throw Error("Unexpected SQL");
  });
  return {relay,sql,started,owned:await acquireCloudPilotLease(relay,started+290000)};
}
it("renews the same owned handle exactly once, anchors budget to request start, and can release after the original deadline",async()=>{
  vi.useFakeTimers({toFake:["Date"]});const started=Date.now();
  const f=await syntheticOwnedLease(async holder=>{vi.setSystemTime(started+229000);return [{holderId:holder}];});
  vi.setSystemTime(started+200000);const handle=f.owned.handle;
  expect(await f.owned.renewOnce()).toBe(started+490000);expect(f.owned.handle).toBe(handle);
  const renewal=f.sql.mock.calls.find(call=>call[0]==="LEASE_RENEW")!;
  expect(renewal[2]).toBe(started+260000);
  expect(renewal[1]).toContain("SET LOCAL statement_timeout = '8000ms'");
  expect(renewal[1]).toContain("SET LOCAL lock_timeout = '1000ms'");
  expect(renewal[1].indexOf("FOR UPDATE")).toBeLessThan(renewal[1].indexOf('UPDATE public."CrawlCoordinatorLock"'));
  expect(renewal[1]).toContain(`"heartbeatAt" > clock_timestamp() - interval '300 seconds'`);
  await expect(f.owned.renewOnce()).rejects.toThrow("PILOT_RENEWAL_ALREADY_USED");
  vi.setSystemTime(started+330000);await f.owned.release();
  expect(f.sql.mock.calls.map(call=>call[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE"]);
  expect(f.sql.mock.calls.at(-1)![2]).toBe(started+390000);
  expect(handle.signal.aborted).toBe(true);
});
it.each(["unknown","wrong-holder","late"])("a %s renewal permits only bounded conditional cleanup and never allows renewal retry",async mode=>{
  vi.useFakeTimers({toFake:["Date"]});const started=Date.now();
  const f=await syntheticOwnedLease(async holder=>{
    if(mode==="unknown")throw new PilotSqlFailure("UNKNOWN","CONNECTION_LOST");
    if(mode==="late")vi.setSystemTime(started+160000);
    return [{holderId:mode==="wrong-holder"?"other":holder}];
  });
  vi.setSystemTime(started+100000);await expect(f.owned.renewOnce()).rejects.toThrow();
  await expect(f.owned.renewOnce()).rejects.toThrow("PILOT_RENEWAL_ALREADY_USED");
  vi.setSystemTime(started+280000);await f.owned.release();
  expect(f.sql.mock.calls.at(-1)![2]).toBe(started+340000);
  expect(f.sql.mock.calls.filter(call=>call[0]==="LEASE_RENEW")).toHaveLength(1);
});
it("rejects renewal at the original 230-second cutoff and rejects forged or released handles before SQL generation",async()=>{
  vi.useFakeTimers({toFake:["Date"]});const f=await syntheticOwnedLease();
  expect(()=>prepareCloudPilotRenewalSql({...f.owned.handle},Date.now()+30000)).toThrow("CRAWL_LEASE_NOT_OWNED");
  vi.setSystemTime(f.started+230000);await expect(f.owned.renewOnce()).rejects.toThrow("PILOT_RENEWAL_BUDGET_EXHAUSTED");
  expect(f.sql.mock.calls.map(call=>call[0])).toEqual(["LEASE_ACQUIRE"]);
  await f.owned.release();expect(()=>prepareCloudPilotRenewalSql(f.owned.handle,Date.now()+30000)).toThrow("CRAWL_LEASE_LOST");
});
it("reserves 25 seconds after renewal dispatch and emits no request at the last safe instant",async()=>{
  vi.useFakeTimers({toFake:["Date"]});const relay=new FilePilotRelay("unused"),started=Date.now();
  const request=vi.spyOn(relay,"request").mockImplementation(async(_kind,_payload,_deadline,parse)=>parse({status:"SUCCEEDED",rows:[]}));
  await relay.sql("LEASE_RENEW","SQL",started+60000);
  expect((request.mock.calls[0]![1] as {dispatchBefore:string}).dispatchBefore).toBe(new Date(started+35000).toISOString());
  vi.setSystemTime(started+35000);expect(()=>relay.sql("LEASE_RENEW","SQL",started+60000)).toThrow("RELAY_DISPATCH_BUDGET");
  expect(request).toHaveBeenCalledTimes(1);
});

it("allows at most sixty seconds of conditional cleanup after the latest unknown renewal, within the whole-run cap",async()=>{
  vi.useFakeTimers({toFake:["Date"]});const started=Date.now();
  const failure=new PilotSqlFailure("UNKNOWN","CONNECTION_LOST");
  const f=await syntheticOwnedLease(async()=>{vi.setSystemTime(started+289000);throw failure;});
  vi.setSystemTime(started+229000);await expect(f.owned.renewOnce()).rejects.toBe(failure);
  await f.owned.release();
  expect(f.sql.mock.calls.map(call=>call[0])).toEqual(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE"]);
  expect(f.sql.mock.calls.at(-1)![2]).toBe(started+349000);
  expect(f.sql.mock.calls.at(-1)![1]).toContain(`AND "holderId" = '${f.owned.handle.holderId}'`);
  const capped=await syntheticOwnedLease();vi.setSystemTime(capped.started+531000);await capped.owned.release();
  expect(capped.sql.mock.calls.at(-1)![2]).toBe(capped.started+550000);
});

it.each(["CREATE_PENDING","READ_CONTEXT"] as const)("%s includes a hash-bound control dispatch deadline and accepts slow pickup",async kind=>{
  vi.useFakeTimers({toFake:["Date"]});const root=await dir(),relay=new FilePilotRelay(root),started=Date.now();
  const pending=relay.request(kind,{projectId:"yiopvxysxrtrnvqxwgbx"},started+60000,value=>value);
  const req=await requestFile(root),{requestSha256,...body}=req.value;
  expect(sha256(JSON.stringify(body))).toBe(requestSha256);
  expect(Date.parse(req.value.payload.dispatchBefore)).toBe(started+35000);
  vi.setSystemTime(started+45000);await reply(root,req,{result:"actual response"});
  expect(await pending).toEqual({result:"actual response"});
});
it.each(["CREATE_PENDING","READ_CONTEXT"] as const)("%s refuses a control packet without its full completion reserve",async kind=>{
  const root=await dir(),relay=new FilePilotRelay(root);
  await expect(relay.request(kind,{},Date.now()+25000,value=>value)).rejects.toThrow("RELAY_DISPATCH_BUDGET");
  expect(await readdir(root)).toEqual([]);
});


it("binds one ARCHIVE_STORE request and rejects an upload acknowledgement arriving at its absolute deadline",async()=>{
  vi.useFakeTimers({toFake:["Date"]});const root=await dir(),relay=new FilePilotRelay(root),started=Date.now();
  const payload={bundlePath:"/synthetic/bundle.json",bundleSha256:"a".repeat(64),byteCount:123};
  const pending=relay.request("ARCHIVE_STORE",payload,started+230000,value=>value);
  const failed=expect(pending).rejects.toThrow("RELAY_DEADLINE"),req=await requestFile(root),{requestSha256,...body}=req.value;
  expect(sha256(JSON.stringify(body))).toBe(requestSha256);expect(body.payload).toEqual(payload);
  vi.setSystemTime(started+230000);await reply(root,req,{stored:true,recoveryVerification:"PENDING"});await failed;
  expect((await readdir(root)).filter(name=>name.endsWith(".request.json"))).toHaveLength(1);
});
