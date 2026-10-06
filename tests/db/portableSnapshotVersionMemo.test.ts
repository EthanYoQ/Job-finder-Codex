import {describe, expect, it, vi} from "vitest";
import {PORTABLE_MVCC_TOKEN_SQL, PortableSnapshotVersionMemo} from "../../src/db/portableSnapshotVersionMemo";
import {PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_SQL, PORTABLE_SNAPSHOT_VERSION_TABLES, portableSnapshotVersion} from "../../src/db/portableSnapshotCache";
import {readPortablePublicSnapshot, type PortableSnapshotDb, type PortableSnapshotTransactionDb} from "../../src/db/portablePublicSnapshotRepository";
import {searchPortableSnapshot, coverageFromPortableSnapshot} from "../../src/server/portablePublicationApi";
import {accepted, failed, job, plan, NOW, FIRST, SECOND} from "../helpers/portablePublicSnapshotFixture";
const token = () => ({snapshot:"100:100:", own_xid:null, server_started:"2026-10-01 00:00:00+00", server_address:"127.0.0.1", server_port:"5432", backend_pid:"42", backend_started:"2026-10-01 01:00:00+00", recovery:false, database_name:"postgres", database_oid:"5", role_name:"postgres", search_path:'"$user", public', isolation:"repeatable read", bypass_rls:true});
const versions = () => PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation=>({relation,epoch:"0",count:"1",digest:"a".repeat(64)}));
function fixture(enabled = true) {
  const evidence = accepted(), row = token(), versionRows = versions();
  const tx = {
    $queryRawUnsafe:vi.fn(async (sql:string)=>structuredClone(sql===PORTABLE_MVCC_TOKEN_SQL?[row]:versionRows)),
    crawlBatchSourceResult:{findMany:vi.fn(async()=>[evidence.result])},
    lifecycleSetEvidenceMember:{findMany:vi.fn(async()=>evidence.members)},
    job:{findMany:vi.fn(async()=>[job()])}
  };
  const transaction=vi.fn(async(work:(tx:PortableSnapshotTransactionDb)=>Promise<unknown>)=>work(tx as PortableSnapshotTransactionDb));
  const db={$transaction:transaction} as PortableSnapshotDb;
  const cache=new PortableSnapshotCache(undefined,{reuseIdenticalMvccSnapshot:enabled});
  const read=(now=NOW)=>readPortablePublicSnapshot(db,{currentTime:now},[plan],cache);
  const change=(table:string)=>{row.snapshot="101:101:";versionRows.find(r=>r.relation===table)!.digest="b".repeat(64);};
  const full=()=>tx.$queryRawUnsafe.mock.calls.filter(([sql])=>sql===PORTABLE_SNAPSHOT_VERSION_SQL).length;
  return {tx,row,versionRows,transaction,read,change,full};
}
describe("conservative same-MVCC-token memo",()=>{
  it("does not allocate an xid and preserves all nine fingerprint dependencies",()=>{
    expect(PORTABLE_MVCC_TOKEN_SQL).toContain("pg_current_xact_id_if_assigned()");
    expect(PORTABLE_MVCC_TOKEN_SQL).not.toMatch(/pg_current_xact_id\(\)|txid_current\(\)/);
    expect(PORTABLE_SNAPSHOT_VERSION_TABLES).toHaveLength(9);
  });
  it("keeps the default route unchanged unless explicitly enabled",async()=>{
    const f=fixture(false);await f.read();await f.read();expect(f.full()).toBe(2);expect(f.tx.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });
  it("turns 100 serial unchanged requests into 100 token checks plus one full fingerprint",async()=>{
    const f=fixture();const first=await f.read();for(let i=1;i<100;i++)expect(await f.read(new Date(NOW.getTime()+i))).toEqual(first);
    expect(f.full()).toBe(1);expect(f.tx.$queryRawUnsafe).toHaveBeenCalledTimes(101);expect(f.transaction).toHaveBeenCalledTimes(100);
    expect(f.tx.job.findMany).toHaveBeenCalledOnce();
    expect(f.transaction).toHaveBeenLastCalledWith(expect.any(Function),{isolationLevel:"RepeatableRead",maxWait:5000,timeout:10000});
  });
  it.each(PORTABLE_SNAPSHOT_VERSION_TABLES)("checks original fingerprint immediately for committed %s changes",async table=>{
    const f=fixture();await f.read();f.change(table);await f.read();expect(f.full()).toBe(2);expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
  });
  it("detects same-count corrections, equal-count ID replacement and later failed receipts",async()=>{
    const f=fixture();await f.read();f.change("Job");f.tx.job.findMany.mockResolvedValue([{...job(),humanCorrectedTitle:"修正标题"}]);
    expect((await f.read()).sources[0]!.jobs[0]!.title).toBe("修正标题");
    const newer=accepted(SECOND,["job-2"]);f.row.snapshot="102:102:";f.versionRows[0]!.digest="c".repeat(64);
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result,newer.result]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockResolvedValue(newer.members);f.tx.job.findMany.mockResolvedValue([job("job-2",SECOND)]);
    expect((await f.read()).sources[0]!.jobs.map(j=>j.id)).toEqual(["job-2"]);
    f.row.snapshot="103:103:";f.versionRows[0]!.digest="d".repeat(64);
    f.tx.crawlBatchSourceResult.findMany.mockResolvedValue([accepted().result,newer.result,failed("2026-10-01T11:30:00Z")]);
    expect((await f.read()).sources[0]).toMatchObject({health:"DEGRADED",reasons:["LATEST_ATTEMPT_FAILED"]});
  });
  it.each(["server_started","server_address","server_port","backend_pid","backend_started","database_name","database_oid","role_name","search_path"] as const)("invalidates on %s identity/generation changes",async key=>{
    const f=fixture();await f.read();f.row[key]+="-changed";await f.read();expect(f.full()).toBe(2);
  });
  it.each([{own_xid:"100"},{recovery:true},{bypass_rls:false},{isolation:"read committed"},{snapshot:"101:100:"},{snapshot:"100:103:102,101"},{snapshot:"100:101:101"}])("falls back on unsupported token %j",async mutation=>{
    const f=fixture();await f.read();Object.assign(f.row,mutation);await f.read();await f.read();expect(f.full()).toBe(3);
  });
  it("fails closed on token-query errors instead of serving an old success",async()=>{
    const f=fixture();await f.read();f.tx.$queryRawUnsafe.mockRejectedValueOnce(new Error("offline"));await expect(f.read()).rejects.toThrow("offline");expect(f.full()).toBe(1);
  });
  it("does not cache a failed or malformed fingerprint",async()=>{
    const memo=new PortableSnapshotVersionMemo(), rows=versions();let current=token();
    const query=vi.fn(async(sql:string):Promise<unknown>=>sql===PORTABLE_MVCC_TOKEN_SQL?[current]:rows);
    await memo.read(query,PORTABLE_SNAPSHOT_VERSION_SQL,portableSnapshotVersion);current={...current,snapshot:"101:101:"};rows.pop();
    await expect(memo.read(query,PORTABLE_SNAPSHOT_VERSION_SQL,portableSnapshotVersion)).rejects.toThrow("INVALID_PORTABLE_SNAPSHOT_VERSION");
    await expect(memo.read(query,PORTABLE_SNAPSHOT_VERSION_SQL,portableSnapshotVersion)).rejects.toThrow("INVALID_PORTABLE_SNAPSHOT_VERSION");
    expect(query.mock.calls.filter(([sql])=>sql===PORTABLE_SNAPSHOT_VERSION_SQL)).toHaveLength(3);
  });
  it("keeps exact freshness-boundary recomputation with the identical MVCC token",async()=>{
    const f=fixture(), boundary=Date.parse(FIRST)+30*60*60_000;
    expect((await f.read(new Date(boundary-1))).sources[0]!.freshness).toBe("FRESH");
    expect((await f.read(new Date(boundary))).sources[0]).toMatchObject({freshness:"STALE",staleJobCount:1,visibleJobCount:1});
    expect(f.full()).toBe(1);expect(f.tx.job.findMany).toHaveBeenCalledTimes(2);
  });
  it("preserves snapshots, filters, facets, source URLs, timestamps and caller ownership",async()=>{
    const original=fixture(false),candidate=fixture();const base=await original.read(),fast=await candidate.read();expect(fast).toEqual(base);
    const requests=[{city:"上海"},{city:"北京"},{city:"全国"},{city:"城市待核实"},{city:"上海",province:"上海"},{city:"上海",keyword:"销售"},{city:"上海",companyIds:[plan.company.id]},{city:"上海",companyIds:["excluded"]},{city:"上海",categories:["销售"],sort:"LATEST_POSTED"}];
    for(const request of requests)expect(searchPortableSnapshot(request,fast)).toEqual(searchPortableSnapshot(request,base));
    expect(coverageFromPortableSnapshot({keyword:""},fast)).toEqual(coverageFromPortableSnapshot({keyword:""},base));
    fast.sources[0]!.jobs[0]!.title="caller mutation";expect(await candidate.read()).toEqual(base);
  });
  it("isolates independent reader instances",async()=>{
    const a=fixture(),b=fixture();await a.read();await b.read();expect(a.full()).toBe(1);expect(b.full()).toBe(1);
  });
});
