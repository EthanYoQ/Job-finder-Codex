import {describe, expect, it} from "vitest";
import {setImmediate as yieldToEventLoop} from "node:timers/promises";
import {readPortablePublicSnapshot, type PortableSnapshotDb} from "../../src/db/portablePublicSnapshotRepository";
import {PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_TABLES} from "../../src/db/portableSnapshotCache";
import {accepted, job, plan, NOW} from "../helpers/portablePublicSnapshotFixture";

function fixture() {
  const evidence=accepted(), jobs=[job()];
  let version="a", ended=false;
  const db: PortableSnapshotDb={$transaction:async work=>{
    ended=false;
    const result=await work({
      $queryRawUnsafe:async <T>()=>PORTABLE_SNAPSHOT_VERSION_TABLES.map(relation=>({relation,epoch:"0",count:"1",digest:version.repeat(64)})) as T,
      crawlBatchSourceResult:{findMany:async()=>[evidence.result]},
      lifecycleSetEvidenceMember:{findMany:async()=>evidence.members}, job:{findMany:async()=>jobs}
    });
    ended=true;return result;
  }};
  return {db,evidence,jobs,ended:()=>ended,change:()=>{version="b";}};
}

describe("cooperative portable projection",()=>{
  it("matches the full synchronous projection exactly and yields outside its completed transaction",async()=>{
    const f=fixture(), options={currentTime:NOW};
    const synchronous=await readPortablePublicSnapshot(f.db,options);
    let yields=0;
    const cooperative=await readPortablePublicSnapshot(f.db,options,undefined,undefined,undefined,async()=>{
      expect(f.ended()).toBe(true);yields++;await yieldToEventLoop();
    });
    expect(JSON.stringify(cooperative)).toBe(JSON.stringify(synchronous));
    expect(yields).toBe(80);
  });

  it("keeps the old verified snapshot unchanged until every source completes",async()=>{
    const f=fixture(),cache=new PortableSnapshotCache();
    const old=await readPortablePublicSnapshot(f.db,{currentTime:NOW},undefined,cache);
    f.change();f.jobs[0]!.humanCorrectedTitle="new committed title";
    let observed=false;
    const updated=await readPortablePublicSnapshot(f.db,{currentTime:new Date(NOW.getTime()+1000)},undefined,cache,undefined,async()=>{
      observed=true;
      expect(cache.getDuringRefresh(NOW.getTime()+1000)).toEqual(old);
      // A caller changing the original arrays cannot alter the captured rows.
      f.jobs[0]!.humanCorrectedTitle="later mutable value";
      await yieldToEventLoop();
    });
    expect(observed).toBe(true);
    expect(updated.sources.find(source=>source.sourceId===plan.source.id)!.jobs[0]!.title).toBe("new committed title");
    expect(updated.generatedAt).toBe(new Date(NOW.getTime()+1000).toISOString());
    expect(cache.getDuringRefresh(NOW.getTime()+1000)).toEqual(updated);
  });

  it("leaves the last good cache intact if cooperation fails and still rejects duplicate plans before reads",async()=>{
    const f=fixture(),cache=new PortableSnapshotCache();
    const old=await readPortablePublicSnapshot(f.db,{currentTime:NOW},[plan],cache);f.change();
    await expect(readPortablePublicSnapshot(f.db,{currentTime:NOW},[plan],cache,undefined,async()=>{throw new Error("yield failed");})).rejects.toThrow("yield failed");
    expect(cache.getDuringRefresh(NOW.getTime())).toEqual(old);
    await expect(readPortablePublicSnapshot(f.db,{currentTime:NOW},[plan,plan],undefined,undefined,yieldToEventLoop)).rejects.toThrow("INVALID_PORTABLE_PUBLICATION_PLAN_SET");
  });
});
