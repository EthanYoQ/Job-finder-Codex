import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { requiresAGradeCertificateSourceId, verifyAGradeCompletenessCertificateReceipt } from "../../src/crawler/completenessCertificate";
import { SANOFI_HISTORICAL_PUBLIC_RECEIPT as pin } from "../../src/crawler/sanofiHistoricalPublicReceipt";
import { SANOFI_HISTORICAL_PUBLIC_PLAN } from "../../src/domain/sanofiHistoricalPublicPlan";
import { selectPortableSourceSnapshots } from "../../src/domain/portablePublicSnapshot";
import { readPortablePublicSnapshot, type PortableSourceResultRow, type PortableSnapshotDb } from "../../src/db/portablePublicSnapshotRepository";
import { PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_TABLES } from "../../src/db/portableSnapshotCache";
import { searchPortableSnapshot, coverageFromPortableSnapshot } from "../../src/server/portablePublicationApi";
import { chineseBFixture, plan, LATER } from "../helpers/sanofiChinesePublicFixture";

const NOW = new Date("2026-10-04T10:10:00.000Z");
function historical() {
  const context=JSON.parse(readFileSync(new URL("../fixtures/sanofi-historical-public-context.json",import.meta.url),"utf8"));
  const revive=(record:any,fields:string[])=>{for(const key of fields)if(record[key]!==null&&record[key]!==undefined)record[key]=new Date(record[key]+(/Z$|[+-]\d\d:\d\d$/.test(record[key])?"":"Z"));};
  for(const row of context.historicalRows){revive(row,["startedAt","finishedAt"]);revive(row.batch,["startedAt","finishedAt"]);for(const observation of row.observations)revive(observation,["observedFrom","observedTo","crawledAt"]);}
  for(const row of context.jobs)revive(row,["lastSeenAt","officialPublishedAt"]);
  // SQL context uses the public label; the reader receives the Prisma enum.
  for(const row of context.jobs)row.category="OTHER";
  return {result:context.historicalRows[0] as PortableSourceResultRow,members:context.members,jobs:context.jobs};
}
const select=(rows:PortableSourceResultRow[],at=NOW,p=plan())=>selectPortableSourceSnapshots([p],rows,{currentTime:at})[0]!;
function dbFixture(rows:PortableSourceResultRow[],members:any[],jobs:any[]) {
  const versions=PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation=>({relation,epoch:"0",count:"1",digest:"a".repeat(64)}));
  const tx={
    $queryRawUnsafe:vi.fn(async()=>structuredClone(versions)),
    crawlBatchSourceResult:{findMany:vi.fn(async()=>rows)},
    evidenceArtifact:{findMany:vi.fn(async()=>rows.flatMap(r=>r.sanofiArtifacts??[]))},
    lifecycleSetEvidenceMember:{findMany:vi.fn(async(args:any)=>members.filter(m=>args.where.sourceResultId.in.includes(m.sourceResultId)))},
    job:{findMany:vi.fn(async(args:any)=>jobs.filter(j=>args.where.OR.some((q:any)=>q.sourceId===j.sourceId&&q.dedupeKey.in.includes(j.dedupeKey)&&j.lastSeenAt>=q.lastSeenAt.gte&&j.lastSeenAt<=q.lastSeenAt.lte)))}
  };
  const db={$transaction:async(work:any)=>work(tx)} as PortableSnapshotDb;
  return {db,tx,versions};
}
function failed(running=false):PortableSourceResultRow {
  return {...historical().result,id:"cn-attempt",sourceConfigHash:sourcePlanConfigSha256(plan()),startedAt:new Date("2026-10-04T10:05:00Z"),
    finishedAt:running?null:new Date("2026-10-04T10:06:00Z"),transportState:"FAILED",adapterState:"SKIPPED",completenessState:"FAILED",atomicCommitState:"NOT_ATTEMPTED",
    completenessCertificate:null,completenessCertificateSha256:null,failureCode:"FETCH_FAILED"};
}
const read=(f:ReturnType<typeof dbFixture>,time=NOW,cache?:PortableSnapshotCache,refresh?:()=>void)=>readPortablePublicSnapshot(f.db,{currentTime:time},[plan()],cache,refresh);

describe("Sanofi pinned historical A to Chinese B public transition",()=>{
  it("binds the exact approved Chinese plan while keeping Sanofi out of the A issuer",()=>{
    expect(sourcePlanConfigSha256(plan())).toBe(pin.currentChineseConfigSha256);
    expect(sourcePlanConfigSha256(SANOFI_HISTORICAL_PUBLIC_PLAN)).toBe(pin.binding.sourceConfigSha256);
    expect(requiresAGradeCertificateSourceId(pin.binding.sourceId)).toBe(false);
    const old=historical().result;
    expect(()=>verifyAGradeCompletenessCertificateReceipt({certificate:old.completenessCertificate,certificateSha256:pin.certificateSha256,
      expected:{...pin.binding,companyId:pin.companyId}})).toThrow();
    const changed=structuredClone(plan());changed.source.officialEntryUrl+="?changed=1";
    expect(select([old],NOW,changed)).toMatchObject({state:"HOLD",selectedSourceResultId:null,policyId:null});
  });
  it("retains actual old 88 current jobs and original observation time beyond 30 hours",async()=>{
    const a=historical(),f=dbFixture([a.result],a.members,a.jobs),s=await read(f,new Date("2026-10-05T10:10:00Z"));
    expect(s.totalJobs).toBe(88);expect(s.lastUpdatedAt).toBe(pin.observedAt);
    expect(s.sources[0]).toMatchObject({state:"PUBLISHING",freshness:"STALE",selectedSourceResultId:pin.binding.sourceResultId,lastAcceptedAt:pin.finishedAt,
      lastSuccessAt:pin.observedAt,visibleJobCount:88,staleJobCount:88});
    expect(s.sources[0]!.jobs.every(j=>j.lastSeenAt===pin.finishedAt&&!j.inGrace)).toBe(true);
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{OR:[{sourceId:pin.binding.sourceId}],batch:{is:{kind:"SCHEDULED"}}}}));
    expect(f.tx.lifecycleSetEvidenceMember.findMany.mock.calls[0]![0].where.sourceResultId.in).toEqual([pin.binding.sourceResultId]);
    expect(searchPortableSnapshot({city:s.sources[0]!.jobs[0]!.city},s).companies[0]!.sourceScopeNote).toContain("上一版已核验快照");
    expect(coverageFromPortableSnapshot({keyword:""},s).companies.find(c=>c.id===pin.companyId)!.sourceScopeNote).toContain("英文官网中国范围");
  });
  it.each([false,true])("keeps historical jobs when a CN attempt is running/failed (%s)",async running=>{
    const a=historical(),s=await read(dbFixture([a.result,failed(running)],a.members,a.jobs));
    expect(s.sources[0]).toMatchObject({state:"PUBLISHING",health:"DEGRADED",selectedSourceResultId:pin.binding.sourceResultId,visibleJobCount:88,lastSuccessAt:pin.observedAt,
      reasons:expect.arrayContaining([running?"LATEST_ATTEMPT_RUNNING":"LATEST_ATTEMPT_FAILED"])});
  });
  it.each(["member-hash","missing-member","missing-job","job-time","job-source"])("holds historical projection %s drift",async kind=>{
    const a=historical();
    if(kind==="member-hash")a.members[0].jobKeySha256="f".repeat(64);
    if(kind==="missing-member")a.members.pop();
    if(kind==="missing-job")a.jobs.pop();
    if(kind==="job-time")a.jobs[0].lastSeenAt=new Date(a.jobs[0].lastSeenAt.getTime()+1);
    if(kind==="job-source")a.jobs[0].sourceId="other-source";
    expect((await read(dbFixture([a.result],a.members,a.jobs))).sources[0]).toMatchObject({state:"HOLD",visibleJobCount:null});
  });
  it.each(["hash","config","id","batchId","releaseCandidateId","adapterVersion","startedAt","finishedAt","output","batchCommit","batchRoster","batchPlan","batchConfig","batchAdapter","batchTime","count"])("rejects historical %s drift",kind=>{
    const row:any=historical().result;
    if(kind==="hash")row.completenessCertificateSha256="f".repeat(64);
    if(kind==="config")row.sourceConfigHash="f".repeat(64);
    if(kind==="id")row.id+="-changed";
    if(kind==="batchId")row.batchId+="-changed";
    if(kind==="releaseCandidateId")row.releaseCandidateId+="-changed";
    if(kind==="adapterVersion")row.adapterVersion="f".repeat(64);
    if(kind==="startedAt"||kind==="finishedAt")row[kind]=new Date(row[kind].getTime()+1);
    if(kind==="output")row.canonicalOutputSetSha256="f".repeat(64);
    if(kind==="batchCommit")row.batch.commitSha="f".repeat(40);
    if(kind==="batchRoster")row.batch.rosterSha256="f".repeat(64);
    if(kind==="batchPlan")row.batch.sourcePlanSha256="f".repeat(64);
    if(kind==="batchConfig")row.batch.sourceConfigSha256="f".repeat(64);
    if(kind==="batchAdapter")row.batch.adapterBundleSha256="f".repeat(64);
    if(kind==="batchTime")row.batch.finishedAt=new Date(row.batch.finishedAt.getTime()+1);
    if(kind==="count")row.dedupeOutputCount++;
    expect(select([row]).state).toBe("HOLD");
  });
  it.each(["current-invalid","unknown-config","unknown-receipt","unverified-commit"])("blocks old fallback after a %s writer",async kind=>{
    const a=historical(),writer:any={...failed(),atomicCommitState:"COMMITTED",completenessState:"VERIFIED"};
    if(kind==="unknown-config")writer.sourceConfigHash="e".repeat(64);
    if(kind==="unknown-receipt")writer.completenessCertificate={schemaVersion:"unknown"};
    if(kind==="unverified-commit")writer.completenessState="FAILED";
    const s=await read(dbFixture([a.result,writer],a.members,a.jobs));
    expect(s.sources[0]).toMatchObject({state:"HOLD",visibleJobCount:null,reasons:["RECEIPT_INTEGRITY_HOLD"]});expect(s.totalJobs).toBe(0);
  });
  it("selects issued B, current members and Chinese scope after commit",async()=>{
    const a=historical(),b=await chineseBFixture(),f=dbFixture([a.result,b.result],[...a.members,...b.members],[...a.jobs,...b.jobs]),s=await read(f);
    expect(s.sources[0]).toMatchObject({state:"PUBLISHING",selectedSourceResultId:b.result.id,visibleJobCount:1,lastSuccessAt:LATER,visibilityFloor:LATER});
    expect(s.totalJobs).toBe(1);expect(s.sources[0]!.jobs[0]!.inGrace).toBe(false);
    expect(f.tx.lifecycleSetEvidenceMember.findMany.mock.calls[0]![0].where.sourceResultId.in).toEqual([b.result.id]);
    expect(searchPortableSnapshot({city:s.sources[0]!.jobs[0]!.city},s).companies[0]!.sourceScopeNote).toContain("中文官网指定入口的完整岗位清单");
    expect(coverageFromPortableSnapshot({keyword:""},s).companies.find(c=>c.id===pin.companyId)!.sourceScopeNote).not.toContain("上一版");
  });
  it.each(["missing","corrupt","unknown-old-writer"])("allows later good B independently of %s A history",async kind=>{
    const a=historical(),b=await chineseBFixture();a.result.completenessCertificateSha256="f".repeat(64);
    if(kind==="unknown-old-writer"){a.result.id="unknown-old-writer";a.result.sourceConfigHash="e".repeat(64);a.result.completenessCertificate=null;}
    const s=await read(dbFixture(kind==="missing"?[b.result]:[a.result,b.result],b.members,b.jobs));
    expect(s.sources[0]).toMatchObject({state:"PUBLISHING",selectedSourceResultId:b.result.id,visibleJobCount:1});
  });
  it.each(["invalid","expired"])("holds committed %s B without republishing A",async kind=>{
    const a=historical(),b=await chineseBFixture();if(kind==="invalid")b.result.completenessCertificateSha256="f".repeat(64);
    const s=await read(dbFixture([a.result,b.result],[...a.members,...b.members],[...a.jobs,...b.jobs]),kind==="expired"?new Date("2026-10-04T11:00:00Z"):NOW);
    expect(s.sources[0]).toMatchObject({state:"HOLD",visibleJobCount:null});expect(s.totalJobs).toBe(0);
  });
  it("holds a later unknown writer after a valid B",async()=>{
    const b=await chineseBFixture(),writer={...failed(),atomicCommitState:"COMMITTED" as const,sourceConfigHash:"f".repeat(64)};
    expect((await read(dbFixture([b.result,writer],b.members,b.jobs))).sources[0]).toMatchObject({state:"HOLD",visibleJobCount:null});
  });
  it.each([false,true])("holds B after a failed/running successor (%s), without falling back to A",async running=>{
    const a=historical(),b=await chineseBFixture(),s=await read(dbFixture([a.result,b.result,failed(running)],[...a.members,...b.members],[...a.jobs,...b.jobs]));
    expect(s.sources[0]).toMatchObject({state:"HOLD",selectedSourceResultId:b.result.id,visibleJobCount:null,
      reasons:expect.arrayContaining([running?"LATEST_ATTEMPT_RUNNING":"LATEST_ATTEMPT_FAILED"])});
  });
  it("rejects another committed A result even when it uses the old configuration",async()=>{
    const a=historical(),other={...structuredClone(a.result),id:"another-old-config-a",startedAt:new Date("2026-10-04T10:05:00Z"),finishedAt:new Date("2026-10-04T10:06:00Z")};
    expect((await read(dbFixture([a.result,other],a.members,a.jobs))).sources[0]).toMatchObject({state:"HOLD",visibleJobCount:null});
  });
  it("holds an unknown committed writer with no trustworthy completion time",async()=>{
    const b=await chineseBFixture(),unknown={...failed(true),atomicCommitState:"COMMITTED" as const,sourceConfigHash:"f".repeat(64)};
    expect((await read(dbFixture([b.result,unknown],b.members,b.jobs))).sources[0]).toMatchObject({state:"HOLD",visibleJobCount:null});
  });
  it("retains original cache time during the existing background swap then publishes B",async()=>{
    const a=historical(),b=await chineseBFixture(),f=dbFixture([a.result],a.members,a.jobs),cache=new PortableSnapshotCache(),refresh=vi.fn();
    const first=await read(f,NOW,cache,refresh);expect(first.totalJobs).toBe(88);
    f.versions[0]!.digest="b".repeat(64);f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([a.result,b.result]);
    f.tx.evidenceArtifact.findMany.mockResolvedValue([...(b.result.sanofiArtifacts??[])]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockImplementation(async(args:any)=>b.members.filter(m=>args.where.sourceResultId.in.includes(m.sourceResultId)));
    f.tx.job.findMany.mockResolvedValue(b.jobs);
    expect(await read(f,new Date(NOW.getTime()+1000),cache,refresh)).toEqual(first);expect(refresh).toHaveBeenCalledOnce();
    const rebuilt=await read(f,new Date(NOW.getTime()+2000),cache);expect(rebuilt.totalJobs).toBe(1);expect(rebuilt.lastUpdatedAt).toBe(LATER);
    expect((await read(f,new Date(NOW.getTime()+3000),cache,refresh)).lastUpdatedAt).toBe(LATER);
  });
  it.each(["sha256","sourceResultId","kind","extractorLocator","missing"])("rechecks unchanged certificates when persisted Sanofi artifact %s changes",async field=>{
    const b=await chineseBFixture(),f=dbFixture([b.result],b.members,b.jobs),cache=new PortableSnapshotCache();
    expect((await read(f,NOW,cache)).totalJobs).toBe(1);
    expect((await read(f,new Date(NOW.getTime()+1000),cache)).totalJobs).toBe(1);
    expect(f.tx.evidenceArtifact.findMany).toHaveBeenCalledTimes(1);
    const changed=structuredClone([...b.result.sanofiArtifacts!]);
    const oracle=changed.find(a=>a.extractorLocator==="sanofi-cn-module-anomalies-v2")!;
    if(field==="missing")changed.splice(changed.indexOf(oracle),1);
    else (oracle as unknown as Record<string,string>)[field]=field==="sha256"?"f".repeat(64):"changed";
    f.tx.evidenceArtifact.findMany.mockResolvedValue(changed);
    // PostgreSQL UPDATE/DELETE changes EvidenceArtifact's physical tuple digest;
    // neither certificate bytes nor any other table version changes here.
    f.versions.find(v=>v.relation==="EvidenceArtifact")!.digest="c".repeat(64);
    const next=await read(f,new Date(NOW.getTime()+2000),cache);
    expect(next.totalJobs).toBe(0);expect(next.sources[0]).toMatchObject({state:"HOLD"});
    expect(f.tx.evidenceArtifact.findMany).toHaveBeenCalledTimes(2);
  });
  it("atomically replaces the old cached display with HOLD after invalid B commit",async()=>{
    const a=historical(),b=await chineseBFixture(),f=dbFixture([a.result],a.members,a.jobs),cache=new PortableSnapshotCache(),refresh=vi.fn();
    const first=await read(f,NOW,cache,refresh);
    b.result.completenessCertificateSha256="f".repeat(64);
    f.versions[0]!.digest="b".repeat(64);f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([a.result,b.result]);
    f.tx.evidenceArtifact.findMany.mockResolvedValue([...(b.result.sanofiArtifacts??[])]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(b.members);f.tx.job.findMany.mockResolvedValue(b.jobs);
    expect(await read(f,new Date(NOW.getTime()+1000),cache,refresh)).toEqual(first);
    expect((await read(f,new Date(NOW.getTime()+2000),cache)).totalJobs).toBe(0);
    expect((await read(f,new Date(NOW.getTime()+3000),cache,refresh)).sources[0]).toMatchObject({state:"HOLD",visibleJobCount:null});
  });
});
