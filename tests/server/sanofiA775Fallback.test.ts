// @vitest-environment node
import {readFileSync} from "node:fs";
import {setImmediate as nextTurn} from "node:timers/promises";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createPortableSnapshotReader,type PortableSnapshotReader} from "../../src/server/httpServer";
import {PORTABLE_SNAPSHOT_VERSION_TABLES} from "../../src/db/portableSnapshotCache";
import type {PortableSnapshotDb,PortableSnapshotTransactionDb,PortableSourceResultRow} from "../../src/db/portablePublicSnapshotRepository";
import {canonicalPageTraceSha256,canonicalStringSetSha256} from "../../src/crawler/sourceFetchEvidence";
import {verifyBGradeTraversalCertificateReceipt} from "../../src/crawler/traversalCertificate";
import {SANOFI_HISTORICAL_PUBLIC_RECEIPT as pin} from "../../src/crawler/sanofiHistoricalPublicReceipt";
import {sourcePlanConfigSha256} from "../../src/crawler/sourcePlan";
import {accepted,job} from "../helpers/portablePublicSnapshotFixture";
import {plan} from "../helpers/sanofiChinesePublicFixture";

// Generated offline by the actual frozen paired publisher. All jobs and HTTP
// bodies in this packet are synthetic; it is never publication authority.
const wire=JSON.parse(readFileSync(new URL("../fixtures/sanofi-publisher-contract.json",import.meta.url),"utf8"));
const NOW=new Date("2026-10-04T17:02:00.000Z");
function chinese(){
  const p=plan(),at=wire.observedAt,receipt=wire.certificate,binding=receipt.binding;
  const f=accepted(at,wire.jobs.map((r:any)=>r.sourceJobId),[],p),counts=wire.fetchCounts,ledger=wire.reconciliation;
  Object.assign(f.result,{id:binding.sourceResultId,releaseCandidateId:binding.releaseCandidateId,batchId:binding.batchId,
    sanofiArtifacts:wire.artifacts,completenessCertificate:receipt,completenessCertificateSha256:wire.certificateSha256,...counts,
    normalizedCount:ledger.validBeforeDedupeCount,dedupeInputCount:ledger.dedupeInputCount,discardCount:counts.validationDiscardCount,
    adapterInputCount:ledger.rawInputCount,adapterOutputCount:ledger.dedupeOutputCount,adapterLossCount:0,
    expectedJobCount:null,expectedEvidenceKind:"COMPLETE_PAGE_TRAVERSAL",adapterReconciliationSha256:receipt.output.adapterReconciliationSha256,
    collisionLedgerSha256:receipt.output.collisionLedgerSha256,expectedSurfaceSha256:canonicalStringSetSha256(receipt.scope.surfaceIds),
    visitedSurfaceSha256:canonicalStringSetSha256(receipt.scope.surfaceIds),expectedChannelSha256:canonicalStringSetSha256(receipt.scope.channelIds),
    visitedChannelSha256:canonicalStringSetSha256(receipt.scope.channelIds),
    observations:[{sourceId:p.source.id,batchId:binding.batchId,releaseCandidateId:binding.releaseCandidateId,sourceResultId:binding.sourceResultId,
      sourceConfigSha256:sourcePlanConfigSha256(p),adapterVersion:f.result.adapterVersion,observedFrom:new Date(at),observedTo:new Date(at),crawledAt:new Date(at),
      successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true,
      canonicalRawSha256:canonicalStringSetSha256(wire.pages.flatMap((page:any)=>page.rawJobIds)),canonicalOutputSha256:receipt.output.canonicalJobSetSha256,
      paginationTraceSha256:canonicalPageTraceSha256(wire.pages)}]});
  Object.assign(f.result.batch,{id:binding.batchId,releaseCandidateId:binding.releaseCandidateId});
  for(const member of f.members)Object.assign(member,{releaseCandidateId:binding.releaseCandidateId,batchId:binding.batchId,sourceResultId:binding.sourceResultId});
  const jobs=wire.jobs.map((r:any)=>({...job(r.sourceJobId,at),sourceId:p.source.id,companyId:p.company.id,dedupeKey:`${p.source.id}:${r.sourceJobId}`,
    officialTitle:r.officialTitle,officialUrl:r.officialUrl,cities:r.cities,city:r.cities[0],locationRaw:r.locationRaw}));
  return {rows:[f.result],members:f.members,jobs,artifacts:structuredClone(wire.artifacts)};
}
function historical(){
  const a=JSON.parse(readFileSync(new URL("../fixtures/sanofi-historical-public-context.json",import.meta.url),"utf8"));
  const dates=(r:any,fields:string[])=>{for(const k of fields)if(r[k]!=null)r[k]=new Date(r[k]+(/Z$|[+-]\d\d:\d\d$/.test(r[k])?"":"Z"));};
  for(const r of a.historicalRows){dates(r,["startedAt","finishedAt"]);dates(r.batch,["startedAt","finishedAt"]);for(const o of r.observations)dates(o,["observedFrom","observedTo","crawledAt"]);}
  for(const j of a.jobs){dates(j,["lastSeenAt","officialPublishedAt"]);j.category="OTHER";}
  return {rows:a.historicalRows as PortableSourceResultRow[],members:a.members,jobs:a.jobs,artifacts:[] as any[]};
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
const readers:PortableSnapshotReader[]=[];
function fixture(initial=historical()){
  let state=initial,epoch=0,blocked:ReturnType<typeof deferred>|undefined,error:Error|undefined;
  let versionGate:ReturnType<typeof deferred>|undefined,versionError:Error|undefined;
  const stats={transactions:0,artifactReads:0,versionQueries:0};
  const db={$transaction:async(work:(tx:PortableSnapshotTransactionDb)=>Promise<unknown>)=>{
    const own=structuredClone(state),version=epoch,gate=blocked,fail=error,queryGate=versionGate,queryError=versionError;
    blocked=undefined;error=undefined;versionGate=undefined;versionError=undefined;stats.transactions++;
    return work({$queryRawUnsafe:async()=>{stats.versionQueries++;await queryGate?.promise;if(queryError)throw queryError;
        return PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation=>({relation,epoch:String(relation==="EvidenceArtifact"?version:0),count:"1",digest:"a".repeat(64)}));},
      crawlBatchSourceResult:{findMany:async()=>own.rows},evidenceArtifact:{findMany:async()=>{stats.artifactReads++;await gate?.promise;if(fail)throw fail;return own.artifacts;}},
      lifecycleSetEvidenceMember:{findMany:async()=>own.members},job:{findMany:async()=>own.jobs}} as PortableSnapshotTransactionDb);
  }} as PortableSnapshotDb;
  const read=createPortableSnapshotReader(db);readers.push(read);
  return {read,stats,commit(next=chinese()){state=next;epoch++;},holdArtifacts(){blocked=deferred();return blocked;},failArtifacts(){error=new Error("synthetic artifact metadata unavailable");},
    holdVersion(){versionGate=deferred();return versionGate;},failVersion(){versionError=new Error("synthetic version unavailable");}};
}
async function settle(read:PortableSnapshotReader,state="CURRENT"){
  for(let n=0;n<600&&read.getRefreshStatus().state!==state;n++){await nextTurn();await vi.advanceTimersByTimeAsync(1);}
  expect(read.getRefreshStatus().state).toBe(state);
}
beforeEach(()=>{vi.useFakeTimers({toFake:["Date","setTimeout","clearTimeout"]});vi.setSystemTime(NOW);vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"error").mockImplementation(()=>{});});
afterEach(async()=>{await Promise.all(readers.splice(0).map(r=>r.close()));vi.restoreAllMocks();vi.useRealTimers();});

describe("a775 fallback reader with final Chinese publisher contract",()=>{
  it("verifies the final publisher synthetic B and retains the pinned historical 88 with original times",async()=>{
    expect(wire.publisherCommit).toBe("46beb14fcca2dd05854f45781abbc1b43da90ea1");
    const b=chinese(),r=b.rows[0]!;
    expect(verifyBGradeTraversalCertificateReceipt({certificate:wire.certificate,certificateSha256:wire.certificateSha256,now:NOW,
      expected:{...wire.certificate.binding,canonicalRawEvidenceIdSetSha256:r.observations[0]!.canonicalRawSha256!,sanofiArtifacts:wire.artifacts}})).toMatchObject({status:"PASS",finalUniqueJobCount:2});
    const current=fixture(b),s=await current.read();expect(s.totalJobs).toBe(2);expect(s.lastUpdatedAt).toBe(wire.observedAt);
    const old=await fixture().read();expect(old.totalJobs).toBe(88);expect(old.lastUpdatedAt).toBe(pin.observedAt);
  });
  it("preserves the a775 foreground version check even on an unchanged warm cache",async()=>{
    const f=fixture(),first=await f.read(),gate=f.holdVersion(),timing=vi.fn();let settled=false;
    const pending=f.read.readWithStatus(undefined,timing).then(r=>{settled=true;return r;});await nextTurn();
    expect(settled).toBe(false);expect(f.stats.transactions).toBe(2);expect(f.stats.versionQueries).toBe(2);
    gate.resolve();const current=await pending;expect(current.snapshot).toEqual(first);expect(current.snapshotRefresh.state).toBe("CURRENT");
    expect(current.snapshotRefresh).not.toHaveProperty("check");
    expect(timing.mock.calls.map(([phase])=>phase)).toEqual(["planPrep","txAcquire","versionSQL","cacheClone","tx","clone"]);
  });
  it("checks the changed version before returning old88, then waits for the original response before rebuilding",async()=>{
    const f=fixture(),first=await f.read(),finished=deferred(),timing=vi.fn();f.commit();
    const display=await f.read.readWithStatus(finished.promise,timing);expect(display.snapshot).toEqual(first);expect(display.snapshotRefresh.state).toBe("UPDATING");
    expect(display.snapshotRefresh).not.toHaveProperty("check");expect(f.stats.transactions).toBe(2);expect(f.stats.artifactReads).toBe(0);
    const calls=structuredClone(timing.mock.calls);await vi.advanceTimersByTimeAsync(0);expect(f.stats.transactions).toBe(2);
    const gate=f.holdArtifacts();finished.resolve();await vi.advanceTimersByTimeAsync(0);expect(f.stats.transactions).toBe(3);
    const backgroundTiming=vi.fn(),pending=await f.read.readWithStatus(undefined,backgroundTiming);
    expect(pending.snapshot).toEqual(first);expect(backgroundTiming.mock.calls.map(([phase])=>phase)).toEqual(["backgroundClone"]);
    gate.resolve();await settle(f.read);const current=await f.read.readWithStatus();
    expect(current.snapshot.totalJobs).toBe(2);expect(current.snapshot.lastUpdatedAt).toBe(wire.observedAt);expect(current.snapshotRefresh.state).toBe("CURRENT");
    expect(current.snapshotRefresh.version).not.toBe(display.snapshotRefresh.version);expect(timing.mock.calls).toEqual(calls);
  });
  it("keeps strict foreground version-query failures instead of inventing e4cd-style immediate display success",async()=>{
    const f=fixture(),first=await f.read();f.failVersion();await expect(f.read.readWithStatus()).rejects.toThrow("synthetic version unavailable");
    expect((await f.read.readWithStatus()).snapshot).toEqual(first);
  });
  it("rechecks persisted metadata changes and replaces a previously verified Chinese set with HOLD",async()=>{
    const f=fixture(chinese());expect((await f.read()).totalJobs).toBe(2);const bad=chinese();
    bad.artifacts.find((a:any)=>a.kind==="ORACLE_RESULT"&&a.extractorLocator==="sanofi-cn-module-anomalies-v2").sha256="f".repeat(64);f.commit(bad);
    const old=await f.read.readWithStatus();expect(old.snapshot.totalJobs).toBe(2);await vi.advanceTimersByTimeAsync(0);await settle(f.read);
    const current=await f.read.readWithStatus();expect(current.snapshot.totalJobs).toBe(0);
    expect(current.snapshot.sources.find(s=>s.sourceId===plan().source.id)).toMatchObject({state:"HOLD",visibleJobCount:null});
  });
  it("retains old88 and original times with FAILED on a background metadata-read failure",async()=>{
    const f=fixture(),first=await f.read(),finished=deferred();f.commit();const display=await f.read.readWithStatus(finished.promise);
    f.failArtifacts();finished.resolve();await vi.advanceTimersByTimeAsync(0);await settle(f.read,"FAILED");const failed=await f.read.readWithStatus();
    expect(failed.snapshot).toEqual(first);expect(failed.snapshotRefresh).toEqual({...display.snapshotRefresh,state:"FAILED"});
  });
});
