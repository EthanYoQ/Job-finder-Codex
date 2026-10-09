import {createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it,vi} from "vitest";
import {recoverFormalCrawlLockAfterDbCheck} from "../../src/crawler/formalCrawlLock";
const h="a".repeat(64),identity={releaseCandidateId:"rc",commitSha:h,rosterSha256:h,sourcePlanSha256:h,sourceConfigSha256:h,adapterBundleSha256:h};
describe("formal crawl lock recovery",()=>{
  async function fixture(startedAt:string){const root=await mkdtemp(join(tmpdir(),"formal-lock-"));const lockPath=join(root,"lock");const bytes=Buffer.from(JSON.stringify({startedAt,pid:1}));await writeFile(lockPath,bytes);return{lockPath,bytes,sha:createHash("sha256").update(bytes).digest("hex")};}
  const db=(rows:readonly any[])=>({crawlBatch:{findMany:vi.fn(async()=>rows)}});
  it("rejects a current-identity DB PENDING batch and DB query errors",async()=>{
    const old=await fixture("2026-07-10T00:00:00Z"),base={identity,lockPath:old.lockPath,expectedSha256:old.sha,operatorId:"operator-1",reason:"confirmed crashed container",now:new Date("2026-07-12T00:00:00Z")};
    await expect(recoverFormalCrawlLockAfterDbCheck({...base,db:db([{id:"batch-pending",startedAt:new Date(),ownerId:"scheduler"}])})).rejects.toThrow(/PENDING.*batch-pending/i);
    const failedDb={crawlBatch:{findMany:async()=>{throw new Error("database offline")}}};
    await expect(recoverFormalCrawlLockAfterDbCheck({...base,db:failedDb})).rejects.toThrow(/database offline/i);
  });
  it("requires zero pending, exact hash, age, operator and reason, then writes an append-only wx audit",async()=>{
    const old=await fixture("2026-07-10T00:00:00Z"),now=new Date("2026-07-12T00:00:00Z"),base={db:db([]),identity,lockPath:old.lockPath,expectedSha256:old.sha,operatorId:"operator-1",reason:"confirmed no active batch",now};
    const result=await recoverFormalCrawlLockAfterDbCheck(base);
    expect(await readFile(result.quarantine,"utf8")).toContain("startedAt");
    const audit=JSON.parse(await readFile(result.auditPath,"utf8"));
    expect(audit).toMatchObject({oldLockSha256:old.sha,operatorId:"operator-1",operatorReasonUntrusted:"confirmed no active batch",lockBasename:"lock"});
    await writeFile(old.lockPath,old.bytes);
    await expect(recoverFormalCrawlLockAfterDbCheck(base)).rejects.toThrow(/audit wx/i);
    expect(await readFile(old.lockPath,"utf8")).toContain("startedAt");
  });
  it("rejects wrong hash, insufficient age, missing operator, and missing reason",async()=>{
    const old=await fixture("2026-07-10T00:00:00Z"),fresh=await fixture("2026-07-11T23:30:00Z"),now=new Date("2026-07-12T00:00:00Z"),base={db:db([]),identity,expectedSha256:old.sha,operatorId:"operator-1",reason:"reason",now};
    await expect(recoverFormalCrawlLockAfterDbCheck({...base,lockPath:old.lockPath,expectedSha256:"0".repeat(64)})).rejects.toThrow(/mismatch/i);
    await expect(recoverFormalCrawlLockAfterDbCheck({...base,lockPath:fresh.lockPath,expectedSha256:fresh.sha})).rejects.toThrow(/not.*stale/i);
    await expect(recoverFormalCrawlLockAfterDbCheck({...base,lockPath:old.lockPath,operatorId:""})).rejects.toThrow(/operator/i);
    await expect(recoverFormalCrawlLockAfterDbCheck({...base,lockPath:old.lockPath,reason:""})).rejects.toThrow(/reason/i);
    await expect(recoverFormalCrawlLockAfterDbCheck({...base,lockPath:old.lockPath,reason:"token=do-not-log"})).rejects.toThrow(/credential/i);
  });
});
