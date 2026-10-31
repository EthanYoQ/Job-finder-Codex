import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { runDirectRound } from "../runner-candidate/scripts/direct-round";
import { describePortableRuntimeError } from "../runner-candidate/src/crawler/portableRuntimeDiagnostics";
import { readPortablePublicSnapshot } from "../web-candidate/src/db/portablePublicSnapshotRepository";
import { validateSavedSnapshot } from "../web-candidate/src/server/savedPublicSnapshot";
import { savePublicSnapshot } from "../web-candidate/src/server/public-snapshot-file.mjs";

const run = promisify(execFile);
const stateRoot = resolve(process.env.JOBFINDER_STATE_ROOT ?? "/data/job-finder");
const candidateId = process.env.JOBFINDER_CANDIDATE_ID;
let db: PrismaClient | undefined, leaseDb: PrismaClient | undefined;
try {
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
  const results = await runDirectRound({db, leaseDb, candidateId, workspaceRoot:stateRoot});
  // Read the original transactional public projection, even when some sources failed.
  // It retains each source's last accepted publication and original observation times.
  const snapshot = validateSavedSnapshot(await readPortablePublicSnapshot(db as never));
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const snapshots = join(stateRoot, "snapshots");
  await mkdir(snapshots, {recursive:true, mode:0o700});
  const snapshotFile = join(snapshots, `public-${sha256}.json`);
  await savePublicSnapshot(snapshotFile, snapshot);
  const slot = process.env.JOBFINDER_SLOT ?? null;
  // The DB retains accepted captures even if the worker died before writing latest.json.
  const accepted = slot ? await db.crawlBatchSourceResult.findMany({where:{
    releaseCandidateId:candidateId,sourceId:{in:results.map(row=>row.sourceId)},
    atomicCommitState:"COMMITTED",completenessState:"VERIFIED",
    finishedAt:{gte:new Date(Number(slot)),lt:new Date(Number(slot)+12*3600_000)},
    batch:{is:{kind:"SCHEDULED",ownerId:"direct-scheduler"}}
  },select:{sourceId:true,batchId:true},orderBy:{finishedAt:"asc"}}) : [];
  const captured = new Map(accepted.map(row=>[row.sourceId,row.batchId]));
  const complete = results.every(row => captured.has(row.sourceId) && row.status !== "FAILED" &&
    (!("failedSourceCount" in row) || row.failedSourceCount === 0 && row.blockedSourceCount === 0));
  const receipt = {status:"SNAPSHOT_SAVED", slot, complete, snapshotFile, sha256, bytes:bytes.length,
    generatedAt:snapshot.generatedAt, lastUpdatedAt:snapshot.lastUpdatedAt, totalJobs:snapshot.totalJobs,
    capturedSources:[...captured].map(([sourceId,batchId])=>({sourceId,batchId})),
    sources:results.map(row=>({sourceId:row.sourceId,status:row.status}))};
  const temporary = join(snapshots, `latest-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {await handle.writeFile(JSON.stringify(receipt)+"\n"); await handle.sync();} finally {await handle.close();}
    await rename(temporary, join(snapshots, "latest.json"));
    const directory = await open(snapshots, "r");
    try {await directory.sync();} finally {await directory.close();}
  } finally {await rm(temporary,{force:true});}
  console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(JSON.stringify({status:"ROUND_FAILED",diagnostic:describePortableRuntimeError(error)}));
  process.exitCode=1;
} finally {
  await Promise.allSettled([db?.$disconnect(),leaseDb?.$disconnect()]);
}
