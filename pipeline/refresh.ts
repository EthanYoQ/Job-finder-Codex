import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, writeFile, rename } from "node:fs/promises";
import { deepStrictEqual } from "node:assert";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { installSavedSnapshot, validateSavedSnapshot } from "../web-candidate/src/server/savedPublicSnapshot";
import { searchPortableSnapshot, coverageFromPortableSnapshot } from "../web-candidate/src/server/portablePublicationApi";
import { dailySlotMs, slotAt } from "./frequency.mjs";
import { startActivityLease } from "./activity-lease.mjs";
import { retryReceiptFields, retrySourcesSchema, roundIdSchema } from "./retry-schedule";

const exec = promisify(execFile);
const machine = "m_agqzacofwxyhtea4rr7b6tvbba";
const infrastructureBackoffMs = 5 * 60_000;
const invalidReceiptCodes = new Set([
  "ROUND_RECEIPT_SOURCE_COVERAGE_MISMATCH", "ROUND_RECEIPT_INVALID_COMPLETION",
  "ROUND_RECEIPT_INVALID_RETRY_SCHEDULE", "ROUND_RECEIPT_SNAPSHOT_METADATA_MISMATCH"
]);
const slotSchema = z.string().regex(/^\d{13}$/);
const dailySlotSchema = slotSchema.refine(value => slotAt(Number(value)) === Number(value));
const shaSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.number().int().nonnegative();
const receiptSchema = z.object({
  ...retryReceiptFields,
  slot: dailySlotSchema, roundId: roundIdSchema, complete: z.boolean(),
  quarantinedJobCount: z.number().int().nonnegative().optional(),
  unresolvedCoverage: z.boolean().optional(),
  manualIntervention: z.boolean().optional(),
  snapshotFile: z.string(), sha256: shaSchema, lastUpdatedAt: z.string().nullable(), totalJobs: z.number().int().nonnegative(),
  capturedSources: z.array(z.object({sourceId:z.string(),batchId:z.string()})),
  retrySources: retrySourcesSchema
}).refine(receipt => receipt.snapshotFile === `/data/job-finder/snapshots/public-${receipt.sha256}.json`);
const sourceCatalogSchema = z.object({rows:z.array(z.object({sourceId:z.string()})).length(36)});
const attemptFields = {
  slot: dailySlotSchema,
  count: z.number().int().min(1).max(3)
};
const scheduleSchema = z.object({
  timerSlots: z.array(slotSchema),
  records: z.array(z.object({slot: slotSchema}).passthrough()),
  progress: z.object({slot:dailySlotSchema,nextRetryAt:timestampSchema.nullable()}).optional(),
  infrastructureRetryAt: timestampSchema.optional(),
  active: z.object({
    slot: dailySlotSchema, roundId: roundIdSchema, trigger: z.enum(["timer","manual"]), jobId: z.string().min(1).optional(),
    waitFailures: z.number().int().nonnegative().optional(), publication: receiptSchema.optional(),
    invalidReceipt: z.boolean().optional()
  }).refine(active => !active.publication ||
    active.publication.slot === active.slot && active.publication.roundId === active.roundId).optional(),
  dailyAttempt: z.discriminatedUnion("status", [
    z.object({...attemptFields, status: z.literal("RESERVED")}).strict(),
    z.object({...attemptFields, status: z.literal("VERIFIED"), complete: z.boolean()}).strict()
  ]).optional()
}).passthrough().refine(state=>{
  const attempt=state.dailyAttempt;
  return !attempt||attempt.status==="RESERVED"||state.records.some(row=>
    row.slot===attempt.slot&&row.kind==="live"&&row.webReadback===true&&row.complete===attempt.complete);
});

export async function runRefresh({env=process.env,now: fixedNow,execute=exec,request=fetch,
  acquireActivityLease=startActivityLease,installSnapshot=installSavedSnapshot}={}) {
const clock = fixedNow === undefined ? Date.now : () => fixedNow;
const now = clock(), currentSlot = String(slotAt(now));
let temporary = "";
const cli = env.INSTABOX_CLI ?? "instabox";
const target = env.JOBFINDER_PUBLIC_SNAPSHOT_FILE;
let phase = "INITIALIZE";
let retryInfrastructure: (() => Promise<void>) | undefined;
let stopInvalidReceipt: (() => Promise<void>) | undefined;
let releaseActivityLease: (() => Promise<void>) | undefined;
type Receipt = z.infer<typeof receiptSchema>;
function validateReceiptCoverage(receipt:Receipt, sourceIds:ReadonlySet<string>) {
  const listed=[...receipt.capturedSources,...receipt.retrySources].map(row=>row.sourceId);
  if(listed.length!==sourceIds.size || new Set(listed).size!==sourceIds.size || listed.some(id=>!sourceIds.has(id)))
    throw Error("ROUND_RECEIPT_SOURCE_COVERAGE_MISMATCH");
  if(receipt.complete) {
    if(receipt.retrySources.length || receipt.nextRetryAt!==undefined)
      throw Error("ROUND_RECEIPT_INVALID_COMPLETION");
  } else if(!receipt.retrySources.length || receipt.nextRetryAt!==Math.min(...receipt.retrySources.map(row=>row.retryAt))) {
    throw Error("ROUND_RECEIPT_INVALID_RETRY_SCHEDULE");
  }
}
async function command(args:string[], timeout=120_000) {
  try {return await execute(cli,args,{timeout,maxBuffer:2*1024*1024,env});}
  catch(error) {
    const failure=error as {code?:string|number;signal?:string;stderr?:string};
    const message=String(failure.stderr??"");
    console.error(JSON.stringify({status:"CLOUD_COMMAND_FAILED",operation:args[0],exitCode:failure.code,
      signal:failure.signal,homePresent:!!env.HOME,homeError:/home|user lookup/i.test(message)}));
    throw error;
  }
}
async function remoteReceipt(slot:string, roundId:string):Promise<Receipt|null> {
  try {
    const file=join(temporary,"round.json");
    await command(["pull",machine,`/data/job-finder/snapshots/round-${roundId}.json`,file,"--json"]);
    const receipt=receiptSchema.safeParse(JSON.parse(await readFile(file,"utf8")));
    return receipt.success && receipt.data.slot === slot && receipt.data.roundId === roundId ? receipt.data : null;
  } catch {return null;}
}
async function connectCollector() {
  if(releaseActivityLease)return;
  // A manually suspended collector requires resume.
  phase = "WAKE";
  try {
    await command(["wake",machine,"--json"]);
  } catch {
    await command(["resume",machine,"--json"]);
  }
  phase = "ACTIVITY_LEASE";
  releaseActivityLease = await acquireActivityLease(machine,env.INSTABOX_API_KEY);
}
async function refresh() {
  if(!target||!env.INSTABOX_API_KEY||!env.JOBFINDER_VERIFY_BASE_URL)throw Error("SNAPSHOT_PATH_KEY_AND_VERIFY_URL_REQUIRED");
  phase = "READ_SCHEDULE_STATE";
  const stateFile=env.JOBFINDER_SCHEDULE_STATE_FILE??resolve(target)+".schedule.json";
  let state:z.infer<typeof scheduleSchema>={timerSlots:[],records:[]};
  try {state=scheduleSchema.parse(JSON.parse(await readFile(stateFile,"utf8")));}
  catch(error){
    if(error instanceof SyntaxError||error instanceof z.ZodError)throw Error("INVALID_SCHEDULE_STATE");
    if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  }
  if([state.active?.slot,state.progress?.slot,state.dailyAttempt?.slot].some(slot=>slot && slot>currentSlot))
    throw Error("SCHEDULE_SLOT_REGRESSION");
  const saveState=async()=>{await writeFile(stateFile+".tmp",JSON.stringify(state)+"\n",{mode:0o600});await rename(stateFile+".tmp",stateFile);};
  if(state.active && state.active.slot!==currentSlot) {
    console.error(JSON.stringify({status:state.active.publication?"OBSOLETE_PUBLICATION_RELEASED":"OBSOLETE_ROUND_RELEASED",
      slot:state.active.slot,roundId:state.active.roundId}));
    delete state.active;
    delete state.infrastructureRetryAt;
    await saveState();
  }
  if(state.active?.invalidReceipt)return 76;
  if(state.infrastructureRetryAt !== undefined && now<state.infrastructureRetryAt)return 0;
  if(!state.active && state.progress?.slot===currentSlot &&
    (state.progress.nextRetryAt===null || now<state.progress.nextRetryAt))return 0;
  if(!state.active && now>=Number(currentSlot)+dailySlotMs-infrastructureBackoffMs)return 0;
  const catalog=sourceCatalogSchema.parse(JSON.parse(await readFile(new URL("../runner-candidate/sources.json",import.meta.url),"utf8")));
  const sourceIds=new Set(catalog.rows.map(row=>row.sourceId));
  if(sourceIds.size!==36)throw Error("EXACT_36_SOURCE_CATALOG_REQUIRED");
  phase = "RESERVE_ROUND";
  const trigger=env.INVOCATION_ID && env.JOBFINDER_REFRESH_ORIGIN==="timer" ? "timer" : "manual";
  const newlyReserved=!state.active;
  if(newlyReserved) {
    state.active={slot:currentSlot,roundId:randomBytes(16).toString("hex"),trigger};
    if(trigger==="timer" && !state.timerSlots.includes(currentSlot))state.timerSlots.push(currentSlot);
    delete state.dailyAttempt;
    await saveState();
  } else if(trigger==="manual" && state.active!.trigger==="timer") {
    state.active!.trigger="manual";
    await saveState();
  }
  const active=state.active!, {slot,roundId}=active;
  retryInfrastructure=async()=>{
    state.infrastructureRetryAt=clock()+infrastructureBackoffMs;
    await saveState();
  };
  stopInvalidReceipt=async()=>{
    active.invalidReceipt=true;
    delete state.infrastructureRetryAt;
    await saveState();
  };
  temporary=await mkdtemp(join(tmpdir(),"jobfinder-refresh-"));
  let receipt=active.publication;
  if(!receipt) {
    await connectCollector();
    if(!newlyReserved) {
      phase = "READ_RECEIPT";
      receipt=(await remoteReceipt(slot,roundId))??undefined;
    }
    if(!receipt) {
      if(!active.jobId) {
        phase = "DISPATCH_ROUND";
        if(slotAt(clock())!==Number(slot)) {
          delete state.active;
          delete state.infrastructureRetryAt;
          await saveState();
          return 0;
        }
        const started=await command(["exec",machine,"--background","--json","--cwd","/data/job-finder/app","--",
          "bash","pipeline/run-slot.sh",slot,roundId]);
        const jobId=z.string().min(1).safeParse(JSON.parse(started.stdout).jobId);
        if(!jobId.success)throw Error("BACKGROUND_JOB_ID_MISSING");
        active.jobId=jobId.data;
        await saveState();
      }
      phase = "WAIT_ROUND";
      try {
        const secondsLeft=Math.floor((Number(slot)+dailySlotMs-clock())/1000);
        if(secondsLeft<=0)return 0;
        const waitSeconds=Math.min(7*3600,secondsLeft);
        await command(["jobs","wait",machine,active.jobId,"--timeout",`${waitSeconds}s`,"--json"],waitSeconds*1000+1000);
        delete active.jobId;
        delete active.waitFailures;
      } catch {
        active.waitFailures=(active.waitFailures??0)+1;
        if(active.waitFailures>=2) {
          delete active.jobId;
          delete active.waitFailures;
        }
      }
      receipt=(await remoteReceipt(slot,roundId))??undefined;
    }
    if(!receipt)throw Error("CURRENT_ROUND_RESULT_NOT_CONFIRMED");
    if(slotAt(clock())!==Number(slot)) {
      console.error(JSON.stringify({status:"OBSOLETE_PUBLICATION_RELEASED",slot,roundId}));
      delete state.active;
      delete state.infrastructureRetryAt;
      await saveState();
      return 0;
    }
  }
  validateReceiptCoverage(receipt,sourceIds);
  if(!active.publication) {
    active.publication=receipt;
    delete state.infrastructureRetryAt;
    await saveState();
  }
  phase = "INSTALL_SNAPSHOT";
  const installed=await readFile(resolve(target)).catch(error=>{
    if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;
    throw error;
  });
  let snapshotBytes:Buffer, incoming:string|undefined;
  if(installed&&createHash("sha256").update(installed).digest("hex")===receipt.sha256){
    snapshotBytes=installed;
  }else{
    await connectCollector();
    phase = "INSTALL_SNAPSHOT";
    incoming=join(temporary,"public.json");
    await command(["pull",machine,receipt.snapshotFile,incoming,"--json"]);
    snapshotBytes=await readFile(incoming);
  }
  const snapshot=validateSavedSnapshot(JSON.parse(snapshotBytes.toString("utf8")));
  if(snapshot.totalJobs!==receipt.totalJobs || snapshot.lastUpdatedAt!==receipt.lastUpdatedAt)
    throw Error("ROUND_RECEIPT_SNAPSHOT_METADATA_MISMATCH");
  if(slotAt(clock())!==Number(slot))return 0;
  if(incoming)await installSnapshot(incoming,resolve(target),receipt.sha256);
  const search=searchPortableSnapshot({city:"全部城市",province:"全部地区",sort:"COMPANY_PINYIN_ASC"},snapshot);
  const coverage=coverageFromPortableSnapshot({keyword:"",offset:0,limit:60},snapshot);
  phase = "WEBSITE_READBACK";
  for(const [path,expected] of [
    ["/api/search?city="+encodeURIComponent("全部城市")+"&sort=COMPANY_PINYIN_ASC&limit=50&offset=0&province="+encodeURIComponent("全部地区"),{...search,snapshotStorage:"SAVED"}],
    ["/api/coverage?keyword=&offset=0&limit=60",{...coverage,snapshotStorage:"SAVED"}]
  ] as const){
    const response:Response=await request(new URL(path,env.JOBFINDER_VERIFY_BASE_URL),{headers:{"x-job-search-consent":"accepted"},signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error("WEBSITE_READBACK_HTTP_FAILED");
    try{deepStrictEqual(await response.json(),expected);}catch{throw Error("WEBSITE_READBACK_MISMATCH");}
  }
  const manualInSlot=receipt.manualIntervention || state.records.some(row=>row.slot===slot && row.trigger==="manual");
  state.records=state.records.filter((row)=>Number(row.slot)>Number(slot)-8*dailySlotMs&&row.slot!==slot);
  phase = "SAVE_STATE";
  const verifiedAt=clock(), complete=receipt.complete && slotAt(verifiedAt)===Number(slot);
  state.records.push({slot,kind:"live",trigger:manualInSlot?"manual":active.trigger,complete,
    quarantinedJobCount:receipt.quarantinedJobCount,unresolvedCoverage:receipt.unresolvedCoverage,
    webReadback:true,capturedSourceIds:receipt.capturedSources.map(row=>row.sourceId),sha256:receipt.sha256,verifiedAt:new Date(verifiedAt).toISOString()});
  state.timerSlots=state.timerSlots.filter(value=>Number(value)>Number(slot)-8*dailySlotMs);
  state.progress={slot,nextRetryAt:receipt.complete?null:receipt.nextRetryAt??(clock()+infrastructureBackoffMs)};
  delete state.active;
  delete state.infrastructureRetryAt;
  await saveState();
  console.log(JSON.stringify({status:"WEBSITE_SNAPSHOT_INSTALLED",slot,sha256:receipt.sha256,
    complete,lastUpdatedAt:receipt.lastUpdatedAt,totalJobs:receipt.totalJobs,nextRetryAt:state.progress.nextRetryAt}));
  return 0;
}
try {
  try {return await refresh();} finally {
    await releaseActivityLease?.();
    if(temporary)await rm(temporary,{recursive:true,force:true});
  }
} catch (error) {
  const code=error instanceof Error&&/^[A-Z][A-Z_]+$/.test(error.message)?error.message:"REFRESH_FAILED";
  let exitCode=76;
  if(retryInfrastructure)try {
    if(invalidReceiptCodes.has(code))await stopInvalidReceipt?.();
    else {
      await retryInfrastructure();
      exitCode=75;
    }
  }catch{/* The next timer invocation rereads the last saved state. */}
  console.error(JSON.stringify({status:code,phase,slot:currentSlot,exitCode}));
  return exitCode;
}
}
if(process.argv[1]&&await realpath(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runRefresh();
