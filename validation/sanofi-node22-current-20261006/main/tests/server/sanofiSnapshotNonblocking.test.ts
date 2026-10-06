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
  const stats={transactions:0,artifactReads:0};
  const db={$transaction:async(work:(tx:PortableSnapshotTransactionDb)=>Promise<unknown>)=>{
    const own=structuredClone(state),version=epoch,gate=blocked,fail=error;blocked=undefined;error=undefined;stats.transactions++;
    return work({$queryRawUnsafe:async()=>PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation=>({relation,epoch:String(relation==="EvidenceArtifact"?version:0),count:"1",digest:"a".repeat(64)})),
      crawlBatchSourceResult:{findMany:async()=>own.rows},evidenceArtifact:{findMany:async()=>{stats.artifactReads++;await gate?.promise;if(fail)throw fail;return own.artifacts;}},
      lifecycleSetEvidenceMember:{findMany:async()=>own.members},job:{findMany:async()=>own.jobs}} as PortableSnapshotTransactionDb);
  }} as PortableSnapshotDb;
  const read=createPortableSnapshotReader(db);readers.push(read);
  return {read,stats,commit(next=chinese()){state=next;epoch++;},holdArtifacts(){blocked=deferred();return blocked;},failArtifacts(){error=new Error("synthetic artifact metadata unavailable");}};
}
async function settle(read:PortableSnapshotReader,state="CURRENT"){
  for(let n=0;n<600&&read.getRefreshStatus().state!==state;n++){await nextTurn();await vi.advanceTimersByTimeAsync(1);}
  expect(read.getRefreshStatus().state).toBe(state);
}
beforeEach(()=>{vi.useFakeTimers({toFake:["Date","setTimeout","clearTimeout"]});vi.setSystemTime(NOW);vi.spyOn(console,"info").mockImplementation(()=>{});vi.spyOn(console,"error").mockImplementation(()=>{});});
afterEach(async()=>{await Promise.all(readers.splice(0).map(r=>r.close()));vi.restoreAllMocks();vi.useRealTimers();});

describe("frozen Chinese publisher contract through nonblocking web reader",()=>{
  it("verifies the independent publisher packet and publishes its complete synthetic current set",async()=>{
    expect(wire.publisherCommit).toBe("46beb14fcca2dd05854f45781abbc1b43da90ea1");
    const b=chinese(),r=b.rows[0]!;
    expect(verifyBGradeTraversalCertificateReceipt({certificate:wire.certificate,certificateSha256:wire.certificateSha256,now:NOW,
      expected:{...wire.certificate.binding,canonicalRawEvidenceIdSetSha256:r.observations[0]!.canonicalRawSha256!,sanofiArtifacts:wire.artifacts}})).toMatchObject({status:"PASS",finalUniqueJobCount:2});
    const f=fixture(b),s=await f.read();expect(s.totalJobs).toBe(2);expect(s.lastUpdatedAt).toBe(wire.observedAt);expect(f.stats.artifactReads).toBe(1);
  });
  it("serves old88 before the response finishes and atomically swaps to the verified new set without changing old times or timing ownership",async()=>{
    const f=fixture(),first=await f.read(),finished=deferred();expect(first.totalJobs).toBe(88);expect(first.lastUpdatedAt).toBe(pin.observedAt);
    f.commit();const gate=f.holdArtifacts(),timing=vi.fn(),display=await f.read.readWithStatus(finished.promise,undefined,timing);
    expect(display.snapshot).toEqual(first);expect(display.snapshotRefresh.state).toBe("UPDATING");const calls=structuredClone(timing.mock.calls);
    await vi.advanceTimersByTimeAsync(0);expect(f.stats.transactions).toBe(1);finished.resolve();await vi.advanceTimersByTimeAsync(0);
    const pending=await f.read.readWithStatus(undefined,display.snapshotRefresh.check);expect(pending.snapshot).toEqual(first);expect(pending.snapshotRefresh.state).toBe("UPDATING");
    gate.resolve();await settle(f.read);const current=await f.read.readWithStatus(undefined,display.snapshotRefresh.check);
    expect(current.snapshot.totalJobs).toBe(2);expect(current.snapshot.lastUpdatedAt).toBe(wire.observedAt);expect(current.snapshotRefresh.state).toBe("CURRENT");
    expect(current.snapshotRefresh.version).not.toBe(display.snapshotRefresh.version);expect(timing.mock.calls).toEqual(calls);
  });
  it("rechecks changed external artifact commitments and replaces the cached Chinese set with HOLD",async()=>{
    const f=fixture(chinese());expect((await f.read()).totalJobs).toBe(2);const bad=chinese();bad.artifacts.find((a:any)=>a.kind==="ORACLE_RESULT"&&a.extractorLocator==="sanofi-cn-module-anomalies-v2").sha256="f".repeat(64);f.commit(bad);
    const display=await f.read.readWithStatus();await vi.advanceTimersByTimeAsync(0);await settle(f.read);
    const current=await f.read.readWithStatus(undefined,display.snapshotRefresh.check);expect(current.snapshot.totalJobs).toBe(0);
    expect(current.snapshot.sources.find(s=>s.sourceId===plan().source.id)).toMatchObject({state:"HOLD",visibleJobCount:null});
  });
  it("keeps the old verified version and times with FAILED when the new metadata query fails",async()=>{
    const f=fixture(),first=await f.read();f.commit();f.failArtifacts();const display=await f.read.readWithStatus();
    await vi.advanceTimersByTimeAsync(0);await settle(f.read,"FAILED");const failed=await f.read.readWithStatus(undefined,display.snapshotRefresh.check);
    expect(failed.snapshot).toEqual(first);expect(failed.snapshotRefresh).toEqual({...display.snapshotRefresh,state:"FAILED"});
  });
});
