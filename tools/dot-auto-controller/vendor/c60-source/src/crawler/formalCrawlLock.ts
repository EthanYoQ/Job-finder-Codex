import {createHash} from "node:crypto";
import {mkdir,open,readFile,rename,type FileHandle} from "node:fs/promises";
import {basename,dirname,join} from "node:path";

export const FORMAL_CRAWL_LOCK_PATH="/app/outputs/.formal-full-release.lock";
export const STALE_CANDIDATE_AGE_MS=24*60*60*1000;

export async function acquireFormalCrawlLock(lockPath=FORMAL_CRAWL_LOCK_PATH):Promise<FileHandle>{
  const handle=await open(lockPath,"wx",0o600);
  await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  await handle.sync();
  return handle;
}

export interface FormalRecoveryIdentity {releaseCandidateId:string;commitSha:string;rosterSha256:string;sourcePlanSha256:string;sourceConfigSha256:string;adapterBundleSha256:string}
export interface FormalRecoveryDb {crawlBatch:{findMany(args:Record<string,unknown>):Promise<readonly {id:string;startedAt:Date;ownerId:string}[]>}}

export async function recoverFormalCrawlLockAfterDbCheck(input:{db:FormalRecoveryDb;identity:FormalRecoveryIdentity;lockPath?:string;expectedSha256:string;operatorId:string;reason:string;now?:Date}):Promise<{quarantine:string;auditPath:string}>{
  const pending=await input.db.crawlBatch.findMany({where:{kind:"FULL_RELEASE",status:"PENDING",releaseCandidateId:input.identity.releaseCandidateId,
    commitSha:input.identity.commitSha,rosterSha256:input.identity.rosterSha256,sourcePlanSha256:input.identity.sourcePlanSha256,
    sourceConfigSha256:input.identity.sourceConfigSha256,adapterBundleSha256:input.identity.adapterBundleSha256},
    select:{id:true,startedAt:true,ownerId:true},orderBy:{startedAt:"desc"}});
  if(pending.length)throw new Error(`Active current-identity PENDING batches block recovery: ${pending.map(x=>`${x.id}@${x.startedAt.toISOString()} owner=${x.ownerId}`).join(", ")}`);
  return recoverCheckedFormalCrawlLock(input);
}

async function recoverCheckedFormalCrawlLock(input:{identity:FormalRecoveryIdentity;lockPath?:string;expectedSha256:string;operatorId:string;reason:string;now?:Date}):Promise<{quarantine:string;auditPath:string}>{
  if(!/^[A-Za-z0-9._@-]{3,128}$/.test(input.operatorId))throw new Error("Explicit operatorId is invalid");
  if(!input.reason.trim()||input.reason.length>500||/[\u0000-\u001f\u007f]/.test(input.reason)||/(password|passwd|token|secret|bearer|api[_ -]?key)\s*[:=]/i.test(input.reason))throw new Error("Explicit recovery reason is invalid or resembles credentials");
  if(!/^[0-9a-f]{64}$/.test(input.expectedSha256))throw new Error("Expected lock SHA-256 is invalid");
  const lockPath=input.lockPath??FORMAL_CRAWL_LOCK_PATH;
  const bytes=await readFile(lockPath);
  const actual=createHash("sha256").update(bytes).digest("hex");
  if(actual!==input.expectedSha256)throw new Error("Lock SHA-256 mismatch; refusing recovery");
  const record=JSON.parse(bytes.toString("utf8")) as {startedAt?:unknown};
  const startedAt=typeof record.startedAt==="string"?new Date(record.startedAt).getTime():Number.NaN;
  const now=(input.now??new Date()).getTime();
  if(!Number.isFinite(startedAt)||now-startedAt<=STALE_CANDIDATE_AGE_MS)throw new Error("Lock is not an aged stale candidate; refusing recovery");
  const quarantine=`${lockPath}.quarantine-${new Date(now).toISOString().replace(/[:.]/g,"-")}`;
  await rename(lockPath,quarantine);
  const auditDirectory=join(dirname(lockPath),"recovery-audit");
  await mkdir(auditDirectory,{recursive:true,mode:0o700});
  const identityDigest=createHash("sha256").update(JSON.stringify(input.identity)).digest("hex");
  const auditPath=join(auditDirectory,`${new Date(now).toISOString().replace(/[:.]/g,"-")}-${actual.slice(0,16)}.json`);
  try{
    const audit=await open(auditPath,"wx",0o600);
    try{await audit.writeFile(JSON.stringify({schemaVersion:1,event:"FORMAL_CRAWL_LOCK_QUARANTINED",lockBasename:basename(lockPath),quarantineBasename:basename(quarantine),oldLockSha256:actual,operatorId:input.operatorId,operatorReasonUntrusted:input.reason,recoveredAt:new Date(now).toISOString(),currentIdentitySha256:identityDigest})+"\n");await audit.sync();}finally{await audit.close();}
  }catch(error){
    try{
      await rename(quarantine,lockPath);
      const restored=createHash("sha256").update(await readFile(lockPath)).digest("hex");
      if(restored!==actual)throw new Error("restored lock hash mismatch");
    }catch(rollbackError){
      throw new AggregateError([error,rollbackError],"CRITICAL: recovery audit failed and lock rollback could not be verified; quarantine may remain");
    }
    throw new Error("Recovery audit wx write failed; lock rollback was verified",{cause:error});
  }
  return {quarantine,auditPath};
}
