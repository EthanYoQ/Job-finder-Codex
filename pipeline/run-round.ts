import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { loadDirectPlans, runDirectRound, selectDirectRoutes } from "../runner-candidate/scripts/direct-round";
import { MANUAL_RECOVERY_INSTANCE } from "../runner-candidate/scripts/manual-request";
import { readRoundCoverage, readSourceCompletion } from "./round-coverage";
import { enrichSanofiPublicationClassification } from "./sanofi-publication-classification";
import { describePortableRuntimeError } from "../runner-candidate/src/crawler/portableRuntimeDiagnostics";
import type { SourceTransportObservation } from "../runner-candidate/src/crawler/sourceFetchFailure";
import { readPortablePublicSnapshot } from "../web-candidate/src/db/portablePublicSnapshotRepository";
import { validateSavedSnapshot } from "../web-candidate/src/server/savedPublicSnapshot";
import { savePublicSnapshot } from "../web-candidate/src/server/public-snapshot-file.mjs";
import { archiveInactiveSnapshots, selectRoundSnapshotHandle } from "./snapshot-handle";
import { buildRetrySchedule, mergeRetrySources, readRetryCheckpoint, readRetrySources, roundIdSchema, roundManualIntervention, saveRetryCheckpoint,
  selectDueSourceIds, shouldCountRoundRetryAttempt, type RetryOutcome } from "./retry-schedule";

const run = promisify(execFile);
const stateRoot = resolve(process.env.JOBFINDER_STATE_ROOT ?? "/data/job-finder");
const candidateId = process.env.JOBFINDER_CANDIDATE_ID;
const onlySourceIds = process.env.JOBFINDER_ONLY_SOURCE_IDS?.split(",").map(id=>id.trim());
let db: PrismaClient | undefined, leaseDb: PrismaClient | undefined;
try {
  const roundId = process.env.JOBFINDER_ROUND_ID === undefined ? undefined : roundIdSchema.parse(process.env.JOBFINDER_ROUND_ID);
  if (!candidateId || !process.env.POSTGRES_PASSWORD) throw Error("REGISTERED_CANDIDATE_AND_POSTGRES_PASSWORD_REQUIRED");
  process.chdir(fileURLToPath(new URL("../runner-candidate",import.meta.url)));
  const { stdout } = await run("docker", ["inspect", "--format", "{{.NetworkSettings.Networks.bridge.IPAddress}}", "jobfinder-postgres"]);
  const address = stdout.trim();
  if (isIP(address) !== 4) throw Error("POSTGRES_CONTAINER_ADDRESS_UNAVAILABLE");
  const url = new URL(`postgresql://jobfinder@${address}:5432/jobfinder`);
  url.password = process.env.POSTGRES_PASSWORD;
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("connect_timeout", "10");
  url.searchParams.set("pool_timeout", "10");
  db = new PrismaClient({datasources:{db:{url:url.href}}});
  leaseDb = new PrismaClient({datasources:{db:{url:url.href}}});
  const slot = process.env.JOBFINDER_SLOT ?? null;
  if (roundId && slot === null) throw Error("SCHEDULED_ROUND_SLOT_REQUIRED");
  const routes = await loadDirectPlans(), sourceIds = routes.map(row=>row.sourceId);
  const sourceConfigHashes = new Map(routes.map(row=>[row.sourceId,row.sourceConfigSha256]));
  const selected = selectDirectRoutes(routes, onlySourceIds).map(row=>row.sourceId);
  const snapshots = join(stateRoot, "snapshots");
  let previousReceipt: unknown;
  try { previousReceipt = JSON.parse(await readFile(join(snapshots,"latest.json"),"utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const checkpointFile=join(stateRoot,"source-retry-checkpoint.json");
  let checkpoint=readRetryCheckpoint(checkpointFile,sourceConfigHashes);
  const previous = mergeRetrySources(readRetrySources(previousReceipt,sourceConfigHashes),checkpoint);
  const completedBefore = roundId ? await readSourceCompletion(db,candidateId,slot,sourceIds,sourceConfigHashes) : [];
  const due = roundId ? selectDueSourceIds(selected,new Set(completedBefore.filter(row=>row.complete).map(row=>row.sourceId)),previous,Date.now()) : selected;
  const outcomes: RetryOutcome[] = [];
  const results = await runDirectRound({db, leaseDb, candidateId, workspaceRoot:stateRoot, slot,
    onlySourceIds:due,...(roundId ? {prioritizeSelectedSources:true,stopAtSlotEnd:true,allowEmptySelection:true,
      onSourceTransportObservation:(observation: SourceTransportObservation)=>{
        const old=outcomes.find(row=>row.sourceId===observation.sourceId);
        const outcome:RetryOutcome=old??{sourceId:observation.sourceId};
        outcome.observedActualHttp=!!outcome.observedActualHttp||observation.observedActualHttp;
        outcome.locallyDeferred=!!outcome.locallyDeferred||observation.locallyDeferred;
        if(observation.observedActualHttp && observation.actualHttpStatuses.some(status=>status===403||status===429))
          outcome.challenged=true;
        if(observation.retryAt!==undefined)outcome.retryAt=Math.max(outcome.retryAt??0,observation.retryAt);
        if(observation.observedActualHttp&&observation.lastActualRequestAt!==undefined)
          outcome.lastActualRequestAt=Math.max(outcome.lastActualRequestAt??0,observation.lastActualRequestAt);
        if(!old)outcomes.push(outcome);
        // Each notification describes the same acquisition. Count it against the pre-wave state.
        const observed=buildRetrySchedule({sourceConfigHashes,
          completeSourceIds:new Set(sourceIds.filter(id=>id!==observation.sourceId)),previous,
          attemptedSourceIds:new Set([observation.sourceId]),outcomes:[outcome],now:Date.now(),slot});
        checkpoint=mergeRetrySources(checkpoint,observed.retrySources);
        saveRetryCheckpoint(checkpointFile,checkpoint);
      }} : {})});
  // Read the original transactional public projection, even when some sources failed.
  // It retains each source's last accepted publication and original observation times.
  const snapshot = validateSavedSnapshot(await readPortablePublicSnapshot(db as never));
  const sanofiClassified = await enrichSanofiPublicationClassification(db, stateRoot, snapshot);
  if (sanofiClassified) console.error(JSON.stringify({status:"SANOFI_SNAPSHOT_CLASSIFIED",count:sanofiClassified}));
  await mkdir(snapshots, {recursive:true, mode:0o700});
  const handle = await selectRoundSnapshotHandle(snapshots, slot, snapshot);
  if (!handle.snapshotReused) await savePublicSnapshot(handle.snapshotFile, snapshot);
  // The DB retains accepted captures even if the worker died before writing latest.json.
  const {complete,quarantinedJobCount,unresolvedCoverage,capturedSources} = await readRoundCoverage(db,candidateId,slot,sourceIds,results,sourceConfigHashes);
  const attemptedSourceIds = new Set(results.filter(row=>row.status!=="SKIPPED_ALREADY_COMMITTED_IN_WINDOW").map(row=>row.sourceId));
  const capturedSet = new Set(capturedSources.map(row=>row.sourceId));
  const outcomeBySource = new Map<string, RetryOutcome>(outcomes.map(row => [row.sourceId, row.observedActualHttp ? { ...row, actualRequestCount: 1 } : row]));
  for (const row of results) {
    if (row.status !== "SKIPPED_ALREADY_COMMITTED_IN_WINDOW" && !capturedSet.has(row.sourceId) &&
      !outcomeBySource.has(row.sourceId) && shouldCountRoundRetryAttempt(row)) {
      outcomeBySource.set(row.sourceId, { sourceId: row.sourceId, actualRequestCount: 1 });
    }
  }
  const finalOutcomes = [...outcomeBySource.values()];
  const retrySchedule = slot !== null ? buildRetrySchedule({sourceConfigHashes,
    completeSourceIds:capturedSet,
    previous,attemptedSourceIds,outcomes:finalOutcomes,now:Date.now(),slot}) : previous.length ? {
      retrySources:previous,nextRetryAt:Math.min(...previous.map(row=>row.retryAt))
    } : undefined;
  const receipt = {status:"SNAPSHOT_SAVED", slot, complete, quarantinedJobCount, unresolvedCoverage, ...handle,
    manualIntervention:roundManualIntervention(slot,roundId,previousReceipt,snapshots),
    ...retrySchedule,...(roundId ? {roundId} : {}),
    capturedSources,
    sources:results.map(row=>({sourceId:row.sourceId,status:row.status}))};
  const temporary = join(snapshots, `latest-${randomUUID()}.tmp`);
  try {
    const fileHandle = await open(temporary, "wx", 0o600);
    try {await fileHandle.writeFile(JSON.stringify(receipt)+"\n"); await fileHandle.sync();} finally {await fileHandle.close();}
    await rename(temporary, join(snapshots, "latest.json"));
    const directory = await open(snapshots, "r");
    try {await directory.sync();} finally {await directory.close();}
    // latest owns retry deadlines. A crash before the immutable receipt is repaired by run-slot.
    if (roundId) {
      const roundFile = join(snapshots,`round-${roundId}.json`);
      const roundTemporary = roundFile + ".tmp";
      const roundHandle = await open(roundTemporary,"w",0o600);
      try {await roundHandle.writeFile(JSON.stringify(receipt)+"\n"); await roundHandle.sync();} finally {await roundHandle.close();}
      await rename(roundTemporary,roundFile);
      const directory = await open(snapshots,"r");
      try {await directory.sync();} finally {await directory.close();}
    }
  } finally {await rm(temporary,{force:true});}
  if (retrySchedule) saveRetryCheckpoint(checkpointFile, retrySchedule.retrySources);
  try {
    await archiveInactiveSnapshots(snapshots, handle.snapshotFile);
  } catch (error) {
    console.error(JSON.stringify({status:"SNAPSHOT_ARCHIVE_FAILED",diagnostic:describePortableRuntimeError(error)}));
  }
  if (roundId) {
    // The newest 512 wave receipts suffice for dispatch recovery; also age out old days.
    const rounds = await Promise.all((await readdir(snapshots)).filter(name=>/^round-[a-f0-9]{32}\.json$/.test(name))
      .map(async name=>({name,modifiedAt:(await stat(join(snapshots,name))).mtimeMs})));
    rounds.sort((left,right)=>right.modifiedAt-left.modifiedAt);
    for (const [index,row] of rounds.entries()) if (row.name!==`round-${roundId}.json` &&
      (index>=512 || row.modifiedAt<Date.now()-8*24*3600_000)) await rm(join(snapshots,row.name),{force:true});
  }
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({status:"ROUND_FAILED",diagnostic:describePortableRuntimeError(error)}));
  process.exitCode=1;
} finally {
  if (db) try {
    await run("sudo", ["-n", "systemctl", "start", "--no-block", `jobfinder-manual@${MANUAL_RECOVERY_INSTANCE}.service`],
      { timeout: 2_000, killSignal: "SIGKILL" });
  } catch (error) {
    console.error(JSON.stringify({status:"MANUAL_QUEUE_RECOVERY_START_FAILED",diagnostic:describePortableRuntimeError(error)}));
  }
  await Promise.allSettled([db?.$disconnect(),leaseDb?.$disconnect()]);
}
