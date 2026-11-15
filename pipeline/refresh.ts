import { createHash } from "node:crypto";
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
import { dailySlotMs, slotAt, timerBelongsToSlot } from "./frequency.mjs";
import { startActivityLease } from "./activity-lease.mjs";

const exec = promisify(execFile);
const machine = "m_agqzacofwxyhtea4rr7b6tvbba";
const maximumAttempts = 3;
const slotSchema = z.string().regex(/^\d{13}$/);
const attemptFields = {
  slot: slotSchema.refine(value => slotAt(Number(value)) === Number(value)),
  count: z.number().int().min(1).max(maximumAttempts)
};
const scheduleSchema = z.object({
  timerSlots: z.array(slotSchema),
  records: z.array(z.object({slot: slotSchema}).passthrough()),
  dailyAttempt: z.discriminatedUnion("status", [
    z.object({...attemptFields, status: z.literal("RESERVED")}).strict(),
    z.object({...attemptFields, status: z.literal("VERIFIED"), complete: z.boolean()}).strict()
  ]).optional()
}).passthrough().refine(state=>{
  const attempt=state.dailyAttempt;
  return !attempt||attempt.status==="RESERVED"||state.records.some(row=>
    row.slot===attempt.slot&&row.kind==="live"&&row.webReadback===true&&row.complete===attempt.complete);
});

export async function runRefresh({env=process.env,now=Date.now(),execute=exec,request=fetch,
  acquireActivityLease=startActivityLease,installSnapshot=installSavedSnapshot}={}) {
const slot = String(slotAt(now));
let temporary = "";
const cli = env.INSTABOX_CLI ?? "instabox";
const target = env.JOBFINDER_PUBLIC_SNAPSHOT_FILE;
let phase = "INITIALIZE";
let attempt: number | undefined;
let releaseActivityLease: (() => Promise<void>) | undefined;
type Receipt = {slot:string;complete:boolean;quarantinedJobCount?:number;unresolvedCoverage?:boolean;snapshotFile:string;sha256:string;generatedAt:string;lastUpdatedAt:string|null;totalJobs:number;capturedSources:{sourceId:string;batchId:string}[]};
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
async function latest():Promise<Receipt|null> {
  try {
    const file=join(temporary,"latest.json");
    await command(["pull",machine,"/data/job-finder/snapshots/latest.json",file,"--json"]);
    const receipt=JSON.parse(await readFile(file,"utf8"));
    if(receipt.slot!==slot)return null;
    if(typeof receipt.complete!=="boolean"||!/^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.snapshotFile!==`/data/job-finder/snapshots/public-${receipt.sha256}.json`)throw Error("INVALID_SNAPSHOT_RECEIPT");
    return receipt;
  } catch {return null;}
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
  const previous=state.dailyAttempt;
  if(previous&&Number(previous.slot)>Number(slot))throw Error("SCHEDULE_SLOT_REGRESSION");
  if(previous?.slot===slot&&previous.count===maximumAttempts){
    if(previous.status!=="VERIFIED")throw Error("DAILY_REFRESH_ATTEMPTS_EXHAUSTED");
    console.log(JSON.stringify({status:"DAILY_REFRESH_ALREADY_VERIFIED",slot,attempt:previous.count,complete:previous.complete}));
    return 0;
  }
  const saveState=async()=>{await writeFile(stateFile+".tmp",JSON.stringify(state)+"\n",{mode:0o600});await rename(stateFile+".tmp",stateFile);};
  if(env.INVOCATION_ID)try {
    const trigger=await execute("systemctl",["show","jobfinder-refresh.timer","--property=LastTriggerUSec","--value"],{timeout:5000,env:{...env,LC_ALL:"C",TZ:"UTC"}});
    const triggeredAt=Date.parse(trigger.stdout.trim());
    const legacyNoonSlot = String(Number(slot) + dailySlotMs / 2);
    const legacyNoonTrigger = state.timerSlots.includes(legacyNoonSlot) && triggeredAt >= Number(legacyNoonSlot);
    if(!legacyNoonTrigger&&timerBelongsToSlot(triggeredAt,slot,now)&&!state.timerSlots.includes(slot)){
      state.timerSlots.push(slot);
    }
  }catch{/* An unverified trigger stays unattributed. */}
  phase = "RESERVE_ATTEMPT";
  state.dailyAttempt={slot,count:previous?.slot===slot?previous.count+1:1,status:"RESERVED"};
  await saveState();
  attempt=state.dailyAttempt.count;
  temporary=await mkdtemp(join(tmpdir(),"jobfinder-refresh-"));
  // wake respects a manual stop/pause; it does not change lifetime/security settings.
  phase = "WAKE";
  await command(["wake",machine,"--json"]);
  phase = "ACTIVITY_LEASE";
  releaseActivityLease = await acquireActivityLease(machine,env.INSTABOX_API_KEY);
  phase = "READ_RECEIPT";
  let receipt=await latest();
  if(!receipt?.complete) {
    phase = "RUN_ROUND";
    let jobId:string|undefined;
    try {
      const started=await command(["exec",machine,"--background","--json","--cwd","/data/job-finder/app","--",
        "bash","pipeline/run-slot.sh",slot]);
      jobId=JSON.parse(started.stdout).jobId;
      if(!jobId)throw Error("BACKGROUND_JOB_ID_MISSING");
      await command(["jobs","wait",machine,jobId,"--timeout","7h","--json"],7*3600_000+60_000);
    } catch {
      // Read durable output after a lost response. Never resend an old publish request.
      console.error(JSON.stringify({status:"REMOTE_RESULT_RECHECK",jobId:jobId??null}));
    }
    receipt=await latest();
  }
  if(!receipt)throw Error("CURRENT_SLOT_RESULT_NOT_CONFIRMED");
  phase = "INSTALL_SNAPSHOT";
  const installed=await readFile(resolve(target)).catch(error=>{
    if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;
    throw error;
  });
  let snapshotBytes:Buffer;
  if(installed&&createHash("sha256").update(installed).digest("hex")===receipt.sha256){
    snapshotBytes=installed;
  }else{
    const incoming=join(temporary,"public.json");
    await command(["pull",machine,receipt.snapshotFile,incoming,"--json"]);
    await installSnapshot(incoming,resolve(target),receipt.sha256);
    snapshotBytes=await readFile(incoming);
  }
  const snapshot=validateSavedSnapshot(JSON.parse(snapshotBytes.toString("utf8")));
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
  state.records=state.records.filter((row)=>Number(row.slot)>Number(slot)-8*24*3600_000&&row.slot!==slot);
  phase = "SAVE_STATE";
  state.records.push({slot,kind:"live",trigger:state.timerSlots.includes(slot)?"timer":"manual",complete:receipt.complete,
    quarantinedJobCount:receipt.quarantinedJobCount,unresolvedCoverage:receipt.unresolvedCoverage,
    webReadback:true,capturedSourceIds:receipt.capturedSources.map(row=>row.sourceId),sha256:receipt.sha256,verifiedAt:new Date().toISOString()});
  state.timerSlots=state.timerSlots.filter(value=>Number(value)>Number(slot)-8*24*3600_000);
  state.dailyAttempt={slot,count:attempt,status:"VERIFIED",complete:receipt.complete};
  await saveState();
  console.log(JSON.stringify({status:"WEBSITE_SNAPSHOT_INSTALLED",slot,sha256:receipt.sha256,
    complete:receipt.complete,lastUpdatedAt:receipt.lastUpdatedAt,totalJobs:receipt.totalJobs,attempt}));
  if(!receipt.complete&&attempt===maximumAttempts){
    console.error(JSON.stringify({status:"DAILY_REFRESH_DEGRADED",slot,attempt,complete:false,webReadback:true}));
    return 0;
  }
  return receipt.complete?0:75;
}
try {
  try {return await refresh();} finally {
    await releaseActivityLease?.();
    if(temporary)await rm(temporary,{recursive:true,force:true});
  }
} catch (error) {
  const code=error instanceof Error&&/^[A-Z][A-Z_]+$/.test(error.message)?error.message:"REFRESH_FAILED";
  const exitCode=attempt!==undefined&&attempt<maximumAttempts?75:76;
  console.error(JSON.stringify({status:code,phase,slot,attempt:attempt??null,exitCode}));
  return exitCode;
}
}
if(process.argv[1]&&await realpath(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runRefresh();
