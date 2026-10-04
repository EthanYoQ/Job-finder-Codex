/** Local one-shot transport. This module never calls MCP, Library or a database. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { acquirePortableCrawlLease, releasePortableCrawlLease, assertPortableCrawlLeaseOwned, type PortableCrawlLease, type PortableLeaseDatabase } from "./portableCrawlLease";
import { verifyArchivedSourceEvidence, type VerifyArchivedEvidenceRequest } from "./artifactArchive";
export const sha256=(bytes:string|Buffer)=>createHash("sha256").update(bytes).digest("hex");
export const PILOT_BUDGET=Object.freeze({initialMs:290000,totalMs:550000,controlMs:60000,controlCompletionMs:25000,publishDbMs:120000,publishTransportMs:45000,leaseReserveMs:40000});
const SHA=z.string().regex(/^[a-f0-9]{64}$/);
const sqlResult=z.discriminatedUnion("status",[
  z.object({status:z.literal("SUCCEEDED"),rows:z.array(z.record(z.unknown()))}).strict(),
  z.object({status:z.literal("FAILED"),code:z.string().min(1),outcome:z.enum(["ROLLED_BACK","NOT_DISPATCHED","UNKNOWN"])}).strict()
]);
export class PilotSqlFailure extends Error {
  readonly outcome:"ROLLED_BACK"|"NOT_DISPATCHED"|"UNKNOWN";
  constructor(outcome:PilotSqlFailure["outcome"],readonly code:string){
    super(`RELAY_SQL_FAILED:${code}`);this.name="PilotSqlFailure";
    // Only a database-reported, known rollback SQLSTATE establishes rollback.
    // Connection/statement-completion ambiguity remains UNKNOWN even if mislabeled.
    this.outcome=outcome==="ROLLED_BACK"&&(!/^(?:(?:22|23|25|40|42|44|53|54|55|P0)[A-Z0-9]{3}|57014)$/.test(code)||code==="40003")?"UNKNOWN":outcome;
  }
}
export type PilotRequestKind="LEASE_ACQUIRE"|"LEASE_RENEW"|"LEASE_RELEASE"|"CREATE_PENDING"|"READ_CONTEXT"|"READ_PUBLICATION_CONTEXT"|"ARCHIVE_STORE"|"PUBLISH"|"READ_OUTCOME";
export class FilePilotRelay {
  constructor(readonly directory:string){}
  async request<T>(kind:PilotRequestKind,payload:unknown,deadline:number,parse:(v:unknown)=>T,signal?:AbortSignal):Promise<T>{
    signal?.throwIfAborted();if(Date.now()>=deadline)throw Error("RELAY_DEADLINE");
    if(kind==="CREATE_PENDING"||kind==="READ_CONTEXT"){
      const dispatchBefore=deadline-PILOT_BUDGET.controlCompletionMs;
      if(dispatchBefore<=Date.now())throw Error("RELAY_DISPATCH_BUDGET");
      payload={...z.record(z.unknown()).parse(payload),dispatchBefore:new Date(dispatchBefore).toISOString()};
    }
    await mkdir(this.directory,{recursive:true});
    const requestId=randomUUID(),body={schemaVersion:1,requestId,kind,expiresAt:new Date(deadline).toISOString(),payload};
    const requestSha256=sha256(JSON.stringify(body)),base=join(this.directory,requestId);
    await writeFile(base+".request.json",JSON.stringify({...body,requestSha256}),{flag:"wx",mode:0o600});
    while(Date.now()<deadline){
      signal?.throwIfAborted();
      try{
        const raw=await readFile(base+".response.json","utf8");
        const response=z.object({schemaVersion:z.literal(1),requestId:z.literal(requestId),requestSha256:z.literal(requestSha256),kind:z.literal(kind),result:z.unknown()}).strict().safeParse(JSON.parse(raw));
        if(!response.success)throw Error("RELAY_RESPONSE_BINDING");
        if(Date.now()>=deadline)throw Error("RELAY_DEADLINE");
        return parse(response.data.result);
      }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      await delay(Math.min(25,Math.max(1,deadline-Date.now())),undefined,signal?{signal}:{});
    }
    throw Error("RELAY_DEADLINE");
  }
  sql(kind:Exclude<PilotRequestKind,"ARCHIVE_STORE"|"READ_CONTEXT"|"CREATE_PENDING">,sql:string,deadline:number,signal?:AbortSignal){
    const dispatchBefore=kind==="PUBLISH"?deadline-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs:deadline-PILOT_BUDGET.controlCompletionMs;
    if(dispatchBefore<=Date.now())throw Error("RELAY_DISPATCH_BUDGET");
    return this.request(kind,{projectId:"yiopvxysxrtrnvqxwgbx",sql,dispatchBefore:new Date(dispatchBefore).toISOString()},deadline,value=>{
      const result=sqlResult.parse(value);if(result.status==="FAILED")throw new PilotSqlFailure(result.outcome,result.code);return result.rows;
    },signal);
  }
}
const normalize=(s:string)=>s.replace(/\s+/g," ").trim();
const ACQUIRE=normalize(`INSERT INTO "CrawlCoordinatorLock" ("id", "holderId", "acquiredAt", "heartbeatAt", "metadata")
 VALUES ($1, $2, clock_timestamp(), clock_timestamp(), 'portable-quality-sync-v1')
 ON CONFLICT ("id") DO UPDATE SET "holderId" = EXCLUDED."holderId",
 "acquiredAt" = clock_timestamp(), "heartbeatAt" = clock_timestamp(), "metadata" = EXCLUDED."metadata"
 WHERE "CrawlCoordinatorLock"."holderId" = '' OR "CrawlCoordinatorLock"."heartbeatAt" <= clock_timestamp() - ($3 * interval '1 millisecond') RETURNING "holderId"`);
const RELEASE=normalize(`UPDATE "CrawlCoordinatorLock" SET "holderId" = '', "heartbeatAt" = clock_timestamp(),
 "metadata" = 'portable-quality-sync-v1:released' WHERE "id" = $1 AND "holderId" = $2 RETURNING "holderId"`);
/** Pure whitelist seam; the transaction adapter itself remains private. */
export function prepareLeaseStatement(query:string,values:unknown[]){
  const text=normalize(query),kind=text===ACQUIRE?"LEASE_ACQUIRE":text===RELEASE?"LEASE_RELEASE":null;
  if(!kind||values.length!==(kind==="LEASE_ACQUIRE"?3:2)||values[0]!=="formal-crawl"||
    typeof values[1]!=="string"||!z.string().uuid().safeParse(values[1]).success||
    (kind==="LEASE_ACQUIRE"&&values[2]!==300000))throw Error("LEASE_SQL_NOT_ALLOWED");
  return {kind,sql:text.replace(/\$(\d)/g,(_,n:string)=>Number(n)===1?"'formal-crawl'":Number(n)===2?`'${values[1]}'`:"300000")} as const;
}
/** One fixed transaction, never an arbitrary multi-query adapter. The second
 * statement checks fresh DB time after the row lock, so an expired owner cannot revive. */
export function prepareCloudPilotRenewalSql(lease:PortableCrawlLease,deadline:number):string{
  assertPortableCrawlLeaseOwned(lease);
  const holder=z.string().uuid().parse(lease.holderId),expiresAt=new Date(deadline).toISOString();
  return `BEGIN;
SET LOCAL statement_timeout = '8000ms';
SET LOCAL lock_timeout = '1000ms';
DO $pilot_renew$
DECLARE affected bigint;
BEGIN
  IF clock_timestamp() >= '${expiresAt}'::timestamptz THEN RAISE EXCEPTION 'PILOT_REQUEST_EXPIRED'; END IF;
  PERFORM 1 FROM public."CrawlCoordinatorLock" WHERE "id" = 'formal-crawl' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRAWL_LEASE_LOST'; END IF;
  UPDATE public."CrawlCoordinatorLock" SET "heartbeatAt" = clock_timestamp()
    WHERE "id" = 'formal-crawl' AND "holderId" = '${holder}'
      AND "heartbeatAt" > clock_timestamp() - interval '300 seconds';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'CRAWL_LEASE_LOST'; END IF;
  IF clock_timestamp() >= '${expiresAt}'::timestamptz THEN RAISE EXCEPTION 'PILOT_REQUEST_EXPIRED'; END IF;
END;
$pilot_renew$;
SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE "id" = 'formal-crawl' AND "holderId" = '${holder}';
COMMIT;`;
}
export async function acquireCloudPilotLease(relay:FilePilotRelay,deadline:number,signal?:AbortSignal){
  const overallDeadline=deadline-PILOT_BUDGET.initialMs+PILOT_BUDGET.totalMs;
  let renewalUsed=false;
  const db:PortableLeaseDatabase={$transaction:async<T>(work:Parameters<PortableLeaseDatabase["$transaction"]>[0])=>{
    const calls:Array<ReturnType<typeof prepareLeaseStatement>>=[];
    const marker=Object.freeze({});
    // Preflight the private callbacks without dispatching anything. Only a
    // callback returning its sole query unchanged is a supported transaction.
    const result=await work({$queryRawUnsafe:async<R>(query:string,...values:unknown[])=>{
      calls.push(prepareLeaseStatement(query,values));return marker as R;
    }});
    if(calls.length!==1||result!==marker)throw Error("LEASE_SINGLE_QUERY_REQUIRED");
    // Cleanup alone gets a fresh <=60s wait, even after an unknown renewal.
    // Its unchanged exact-holder UPDATE cannot revive ownership or clear a newer owner.
    const call=calls[0]!,rows=await relay.sql(call.kind,call.sql,Math.min(call.kind==="LEASE_RELEASE"?overallDeadline:deadline,Date.now()+PILOT_BUDGET.controlMs),
      call.kind==="LEASE_ACQUIRE"?signal:undefined);
    return z.array(z.object({holderId:z.string()}).strict()).max(1).parse(rows) as T;
  }};
  const handle=await acquirePortableCrawlLease(db);
  return {handle,release:()=>releasePortableCrawlLease(db,handle),renewOnce:async(renewalSignal?:AbortSignal)=>{
    if(renewalUsed)throw Error("PILOT_RENEWAL_ALREADY_USED");
    renewalUsed=true;assertPortableCrawlLeaseOwned(handle);renewalSignal?.throwIfAborted();
    const started=Date.now();
    if(started>=deadline-PILOT_BUDGET.controlMs)throw Error("PILOT_RENEWAL_BUDGET_EXHAUSTED");
    const renewalDeadline=started+PILOT_BUDGET.controlMs;
    const rows=await relay.sql("LEASE_RENEW",prepareCloudPilotRenewalSql(handle,renewalDeadline),renewalDeadline,renewalSignal);
    if(Date.now()>=renewalDeadline)throw Error("RELAY_DEADLINE");
    renewalSignal?.throwIfAborted();assertPortableCrawlLeaseOwned(handle);
    z.array(z.object({holderId:z.literal(handle.holderId)}).strict()).length(1).parse(rows);
    // Only this exact successful acknowledgement extends the local budget.
    // Anchor to request START, never to a delayed acknowledgement or DB clock conversion.
    return Math.min(overallDeadline,started+PILOT_BUDGET.initialMs);
  }};
}
/** PostgreSQL timestamp-without-time-zone is explicitly interpreted as UTC.
 * Only selected top-level DB fields are revived; nested receipt JSON is untouched. */
export function reviveUtcFields<T extends object,K extends keyof T>(row:T,keys:readonly K[]):Omit<T,K>&Record<K,Date>{
  const out={...row} as Record<keyof T,unknown>;
  for(const key of keys){const value=out[key];if(value===null)continue;
    if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?$/.test(value))throw Error("UTC_TIMESTAMP_REQUIRED");
    const date=new Date(value.endsWith("Z")?value:value+"Z");if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==value.slice(0,19))throw Error("UTC_TIMESTAMP_INVALID");out[key]=date;
  }
  return out as Omit<T,K>&Record<K,Date>;
}
const fileSchema=z.object({path:z.string(),sha256:SHA,byteCount:z.number().int().nonnegative(),chunks:z.array(z.string()).min(1)}).strict();
const bundleSchema=z.object({schemaVersion:z.literal(1),sidecar:z.object({releaseCandidateId:z.string(),batchId:z.string(),sourceId:z.string(),sourceResultId:z.string(),evidenceSubdirectory:z.string(),artifacts:z.array(z.record(z.unknown()))}).strict(),files:z.array(fileSchema).min(1)}).strict();
export type ArchiveBundle=z.infer<typeof bundleSchema>;
export async function makeArchiveBundle(request:VerifyArchivedEvidenceRequest):Promise<ArchiveBundle>{
  const artifacts=await verifyArchivedSourceEvidence(request);
  const files=await Promise.all(artifacts.map(async artifact=>{
    const bytes=await readFile(join(request.workspaceRoot,artifact.path)),chunks:string[]=[];
    for(let n=0;n<bytes.length;n+=576)chunks.push(bytes.subarray(n,n+576).toString("base64"));
    return {path:artifact.path,sha256:sha256(bytes),byteCount:bytes.length,chunks:chunks.length?chunks:[""]};
  }));
  const {releaseCandidateId,batchId,sourceId,sourceResultId,evidenceSubdirectory}=request;
  return bundleSchema.parse({schemaVersion:1,sidecar:{releaseCandidateId,batchId,sourceId,sourceResultId,evidenceSubdirectory,artifacts:JSON.parse(JSON.stringify(artifacts))},files});
}
/** The caller must supply a newly created empty directory. Never overwrites. */
export async function restoreArchiveBundle(value:unknown,workspaceRoot:string){
  const bundle=bundleSchema.parse(value);
  if((await lstat(workspaceRoot)).isSymbolicLink()||(await readdir(workspaceRoot)).length)throw Error("ARCHIVE_RESTORE_NOT_FRESH");
  if(bundle.files.length!==bundle.sidecar.artifacts.length||new Set(bundle.files.map(f=>f.path)).size!==bundle.files.length)throw Error("ARCHIVE_FILE_SET_MISMATCH");
  for(const file of bundle.files){
    if(isAbsolute(file.path)||file.path.split(/[\\/]/).some(p=>!p||p===".."||p==="."))throw Error("ARCHIVE_PATH_INVALID");
    const bytes=Buffer.concat(file.chunks.map(chunk=>{const b=Buffer.from(chunk,"base64");if(b.toString("base64")!==chunk)throw Error("ARCHIVE_BASE64_INVALID");return b;}));
    if(bytes.length!==file.byteCount||sha256(bytes)!==file.sha256)throw Error("ARCHIVE_BYTES_MISMATCH");
    const artifact=bundle.sidecar.artifacts.find(a=>a.path===file.path);
    if(artifact?.sha256!==file.sha256||artifact?.byteCount!==file.byteCount)throw Error("ARCHIVE_SIDECAR_MISMATCH");
    const target=resolve(workspaceRoot,file.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:"wx",mode:0o600});
  }
  const artifacts=bundle.sidecar.artifacts.map(a=>reviveUtcFields(a,["capturedAt"]));
  return verifyArchivedSourceEvidence({...bundle.sidecar,workspaceRoot,artifacts} as unknown as VerifyArchivedEvidenceRequest);
}
