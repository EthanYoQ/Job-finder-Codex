import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile, rename } from "node:fs/promises";
import { deepStrictEqual } from "node:assert";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installSavedSnapshot, validateSavedSnapshot } from "../web-candidate/src/server/savedPublicSnapshot";
import { searchPortableSnapshot, coverageFromPortableSnapshot } from "../web-candidate/src/server/portablePublicationApi";
import { slotAt, timerBelongsToSlot, isNoonSlot, stableThreeDays } from "./frequency.mjs";
import { startActivityLease } from "./activity-lease.mjs";

const exec = promisify(execFile);
const machine = "m_agqzacofwxyhtea4rr7b6tvbba";
const slot = String(slotAt());
const temporary = await mkdtemp(join(tmpdir(), "jobfinder-refresh-"));
const cli = process.env.INSTABOX_CLI ?? "instabox";
const target = process.env.JOBFINDER_PUBLIC_SNAPSHOT_FILE;
let phase = "INITIALIZE";
let releaseActivityLease: (() => Promise<void>) | undefined;
type Receipt = {slot:string;complete:boolean;quarantinedJobCount?:number;snapshotFile:string;sha256:string;generatedAt:string;lastUpdatedAt:string|null;totalJobs:number;capturedSources:{sourceId:string;batchId:string}[]};
async function command(args:string[], timeout=120_000) {
  try {return await exec(cli,args,{timeout,maxBuffer:2*1024*1024,env:process.env});}
  catch(error) {
    const failure=error as {code?:string|number;signal?:string;stderr?:string};
    const message=String(failure.stderr??"");
    console.error(JSON.stringify({status:"CLOUD_COMMAND_FAILED",operation:args[0],exitCode:failure.code,
      signal:failure.signal,homePresent:!!process.env.HOME,homeError:/home|user lookup/i.test(message)}));
    throw error;
  }
}
async function latest():Promise<Receipt|null> {
  try {
    const file=join(temporary,"latest.json");
    await command(["pull",machine,"/data/job-finder/snapshots/latest.json",file,"--json"]);
    const receipt=JSON.parse(await readFile(file,"utf8"));
    if(receipt.slot!==slot)return null;
    if(!/^[a-f0-9]{64}$/.test(receipt.sha256)||receipt.snapshotFile!==`/data/job-finder/snapshots/public-${receipt.sha256}.json`)throw Error("INVALID_SNAPSHOT_RECEIPT");
    return receipt;
  } catch {return null;}
}
async function refresh() {
  if(!target||!process.env.INSTABOX_API_KEY||!process.env.JOBFINDER_VERIFY_BASE_URL)throw Error("SNAPSHOT_PATH_KEY_AND_VERIFY_URL_REQUIRED");
  const stateFile=process.env.JOBFINDER_SCHEDULE_STATE_FILE??resolve(target)+".schedule.json";
  let state:{dailySince?:string;qualifyingDays?:string[];timerSlots:string[];records:unknown[]}={timerSlots:[],records:[]};
  try {state=JSON.parse(await readFile(stateFile,"utf8"));}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const saveState=async()=>{await writeFile(stateFile+".tmp",JSON.stringify(state)+"\n",{mode:0o600});await rename(stateFile+".tmp",stateFile);};
  if(process.env.INVOCATION_ID)try {
    const trigger=await exec("systemctl",["show","jobfinder-refresh.timer","--property=LastTriggerUSec","--value"],{timeout:5000,env:{...process.env,LC_ALL:"C",TZ:"UTC"}});
    const triggeredAt=Date.parse(trigger.stdout.trim());
    if(timerBelongsToSlot(triggeredAt,slot)&&!state.timerSlots.includes(slot)){
      state.timerSlots.push(slot);await saveState();
    }
  }catch{/* A manual/unverified trigger cannot count toward stable days. */}
  let recovery=null;
  if(process.env.JOBFINDER_RECOVERY_EVIDENCE)try{recovery=JSON.parse(await readFile(process.env.JOBFINDER_RECOVERY_EVIDENCE,"utf8"));}catch{}
  const sourceIds=JSON.parse(await readFile(new URL("../runner-candidate/sources.json",import.meta.url),"utf8")).rows.map((row:{sourceId:string})=>row.sourceId);
  const days=stableThreeDays(state.records,Date.now(),sourceIds,recovery);
  if(!state.dailySince&&days){state.dailySince=new Date().toISOString();state.qualifyingDays=days;await saveState();}
  if(state.dailySince&&isNoonSlot(slot)){console.log(JSON.stringify({status:"NOON_SKIPPED_AFTER_THREE_STABLE_DAYS",days:state.qualifyingDays}));return;}
  // wake respects a manual stop/pause; it does not change lifetime/security settings.
  phase = "WAKE";
  await command(["wake",machine,"--json"]);
  phase = "ACTIVITY_LEASE";
  releaseActivityLease = await startActivityLease(machine,process.env.INSTABOX_API_KEY);
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
  const incoming=join(temporary,"public.json");
  await command(["pull",machine,receipt.snapshotFile,incoming,"--json"]);
  await installSavedSnapshot(incoming,resolve(target),receipt.sha256);
  const snapshot=validateSavedSnapshot(JSON.parse(await readFile(incoming,"utf8")));
  const search=searchPortableSnapshot({city:"全部城市",province:"全部地区",sort:"COMPANY_PINYIN_ASC"},snapshot);
  const coverage=coverageFromPortableSnapshot({keyword:"",offset:0,limit:60},snapshot);
  phase = "WEBSITE_READBACK";
  for(const [path,expected] of [
    ["/api/search?city="+encodeURIComponent("全部城市")+"&sort=COMPANY_PINYIN_ASC&limit=50&offset=0&province="+encodeURIComponent("全部地区"),{...search,snapshotStorage:"SAVED"}],
    ["/api/coverage?keyword=&offset=0&limit=60",{...coverage,snapshotStorage:"SAVED"}]
  ] as const){
    const response=await fetch(new URL(path,process.env.JOBFINDER_VERIFY_BASE_URL),{headers:{"x-job-search-consent":"accepted"},signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error("WEBSITE_READBACK_HTTP_FAILED");
    try{deepStrictEqual(await response.json(),expected);}catch{throw Error("WEBSITE_READBACK_MISMATCH");}
  }
  state.records=state.records.filter((row)=>Number((row as {slot:string}).slot)>Number(slot)-8*24*3600_000&&(row as {slot:string}).slot!==slot);
  phase = "SAVE_STATE";
  state.records.push({slot,kind:"live",trigger:state.timerSlots.includes(slot)?"timer":"manual",complete:receipt.complete,
    quarantinedJobCount:receipt.quarantinedJobCount,
    webReadback:true,capturedSourceIds:receipt.capturedSources.map(row=>row.sourceId),sha256:receipt.sha256,verifiedAt:new Date().toISOString()});
  state.timerSlots=state.timerSlots.filter(value=>Number(value)>Number(slot)-8*24*3600_000);
  await saveState();
  console.log(JSON.stringify({status:"WEBSITE_SNAPSHOT_INSTALLED",slot,sha256:receipt.sha256,
    complete:receipt.complete,lastUpdatedAt:receipt.lastUpdatedAt,totalJobs:receipt.totalJobs}));
  // The native service retries a failed/partial attempt; source window dedupe retains successes.
  process.exitCode=receipt.complete?0:75;
}
try {await refresh();} catch (error) {
  const code=error instanceof Error&&/^[A-Z][A-Z_]+$/.test(error.message)?error.message:"REFRESH_FAILED";
  console.error(JSON.stringify({status:code,phase}));
  process.exitCode=75;
} finally {
  await releaseActivityLease?.();
  await rm(temporary,{recursive:true,force:true});
}
