// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
const selectedSourceBeforeTest = vi.hoisted(() => {
  const previous = process.env.JOBFINDER_CLOUD_SOURCE_ID;
  process.env.JOBFINDER_CLOUD_SOURCE_ID = "source-qilu-social";
  return previous;
});
afterAll(() => {
  if (selectedSourceBeforeTest === undefined) delete process.env.JOBFINDER_CLOUD_SOURCE_ID;
  else process.env.JOBFINDER_CLOUD_SOURCE_ID = selectedSourceBeforeTest;
});
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { qiluPilotHttpFixture } from "../helpers/cloudQiluPilotFixture";
import { makeArchiveBundle, restoreArchiveBundle, prepareCloudPilotRenewalSql } from "../../src/crawler/cloudSourcePilotRelay";
import { compileCloudPilotCandidateSql, compileCloudPilotCreatePendingSql, compileCloudPilotFinalizeSql } from "../../src/db/cloudPilotSqlControl";
import { CLOUD_PILOT_SQL45 } from "../../src/db/cloudPilotSql45Manifest";
import { deriveCurrentStagedScheduleExpectation } from "../../src/crawler/stagedScheduleAuthority";
import { buildPendingRuntimeBatch, buildAtomicRuntimeCommit, bindRuntimeEvidenceArtifactIds } from "../../src/crawler/runtimeAtomicEvidence";
import { hashCanonicalStringSet, hashCanonicalJobKeySet } from "../../src/crawler/runtimeBatchIdentity";
import { tmpdir } from "node:os";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { acquirePortableCrawlLease, releasePortableCrawlLease, type PortableLeaseDatabase } from "../../src/crawler/portableCrawlLease";
import { compilePortableAtomicSourceEvidenceSql, inspectPersistedAtomicCommitOutcome } from "../../src/db/ingestionRepository";
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
const base={schemaVersion:2 as const,commitSha:"a".repeat(40),sourceTreeSha256:"b".repeat(64),runtimeTreeSha256:"c".repeat(64)};
const build={...base,contentSha256:digest(JSON.stringify(base))},candidate={id:"synthetic-new-pilot",goalId:"jobfinder-portable-required-40",version:10};
const expectation=deriveCurrentStagedScheduleExpectation(build),sourceId="source-qilu-social",plan=expectation.plans.find(p=>p.source.id===sourceId)!;
const holderId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function input(startedAt=new Date()){return {projectId:"yiopvxysxrtrnvqxwgbx",build,candidate,expiresAt:new Date(Date.now()+60000).toISOString(),holderId,
 planned:buildPendingRuntimeBatch("synthetic-qilu-batch",[plan],{releaseCandidateId:candidate.id,commitSha:expectation.commitSha,rosterSha256:expectation.rosterSha256,sourcePlanSha256:expectation.sourcePlanSha256,sourceConfigSha256:expectation.sourceConfigSha256,adapterBundleSha256:expectation.adapterBundleSha256,batchKind:"SCHEDULED",ownerId:"dot-cloud-qilu-social-pilot",expectedPlannedSourceIds:[sourceId],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([sourceId])},startedAt)};}
function candidateInput(){const {projectId,build,candidate,expiresAt}=input();return {projectId,build,candidate,expiresAt};}
it("rejects changed projects, build digests and unknown pending fields before SQL generation",()=>{
 expect(()=>compileCloudPilotCandidateSql({...candidateInput(),projectId:"other"})).toThrow();
 expect(()=>compileCloudPilotCandidateSql({...candidateInput(),build:{...build,contentSha256:"0".repeat(64)}})).toThrow();
 const i=input(); expect(()=>compileCloudPilotCreatePendingSql({...i,planned:{...i.planned,extra:true} as never})).toThrow();
 expect(()=>compileCloudPilotCreatePendingSql({...i,planned:{...i.planned,sources:[...i.planned.sources,...i.planned.sources]}})).toThrow();
 expect(()=>compileCloudPilotCreatePendingSql({...i,holderId:"staged-scheduler"})).toThrow();
});
it("accepts only the exact Qilu single-source projection and rejects every other canonical source",()=>{
 const i=input();
 expect(()=>compileCloudPilotCreatePendingSql(i)).not.toThrow();
 expect(i.planned.sources[0]!.sourceConfigHash).toBe("0ca38d0cd6550e9567cc3e7ca6772d3b91497f5a59530f5359f823a6c62d5773");
 for(const other of expectation.plans.filter(p=>p.source.id!==sourceId)){
  const identity={releaseCandidateId:candidate.id,commitSha:expectation.commitSha,rosterSha256:expectation.rosterSha256,sourcePlanSha256:expectation.sourcePlanSha256,sourceConfigSha256:expectation.sourceConfigSha256,adapterBundleSha256:expectation.adapterBundleSha256,batchKind:"SCHEDULED" as const,ownerId:"dot-cloud-qilu-social-pilot",expectedPlannedSourceIds:[other.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([other.source.id])};
  const planned=buildPendingRuntimeBatch(i.planned.batch.id,[other],identity,i.planned.batch.startedAt);
  expect(()=>compileCloudPilotCreatePendingSql({...i,planned})).toThrow(/PILOT_EXACT_PLANNED_PROJECTION_REQUIRED/);
 }
 expect(()=>compileCloudPilotCreatePendingSql({...i,planned:{...i.planned,batch:{...i.planned.batch,ownerId:"dot-cloud-novo-nordisk-china-social-pilot"}}})).toThrow(/PILOT_EXACT_PLANNED_PROJECTION_REQUIRED/);
 expect(()=>compileCloudPilotCreatePendingSql({...i,planned:{...i.planned,sources:[{...i.planned.sources[0]!,sourceConfigHash:"0".repeat(64)}]}})).toThrow(/PILOT_EXACT_PLANNED_PROJECTION_REQUIRED/);
});
const modulePath=process.env.PGLITE_MODULE;
describe.skipIf(!modulePath)("fixed SQL45 local controls, not concurrency evidence",()=>{
 let pg:any;
 beforeAll(async()=>{
  const {PGlite}=await import(/* @vite-ignore */ pathToFileURL(resolve(modulePath!)).href);
  const {pgcrypto}=await import(/* @vite-ignore */ pathToFileURL(resolve(modulePath!,"../contrib/pgcrypto.js")).href);
  pg=await PGlite.create({extensions:{pgcrypto}});
  for(const name of (await readdir("prisma/migrations")).sort()){
   if(name==="migration_lock.toml"||name==="20260927120000_p0_launch_cohort_41_companies")continue;
   await pg.exec(await readFile(`prisma/migrations/${name}/migration.sql`,"utf8"));
  }
  await pg.exec('CREATE TABLE "_prisma_migrations" (id text, migration_name text, checksum text, finished_at timestamptz, rolled_back_at timestamptz)');
  for(const m of CLOUD_PILOT_SQL45.migrations)await pg.query('INSERT INTO "_prisma_migrations" VALUES ($1,$1,$2,clock_timestamp(),null)',[m.migrationName,m.checksum]);
  await insert("ReleaseCandidate",{...CLOUD_PILOT_SQL45.currentCandidate,rosterHash:"0".repeat(64),sourcePlanHash:"0".repeat(64),sourceConfigHash:"0".repeat(64),adapterBundleHash:"0".repeat(64),sourceTreeHash:"0".repeat(64),runtimeTreeHash:"0".repeat(64),oracleVersion:"historical"});
  await insert("Company",{id:plan.company.id,officialChineseName:plan.company.officialChineseName,officialWebsiteUrl:plan.source.officialEntryUrl,pinyinName:"synthetic",inclusionReason:"synthetic",updatedAt:new Date()});
  await insert("RecruitmentSource",{id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,updatedAt:new Date()});
 },30000);
 afterAll(async()=>{await pg?.close();});
 async function insert(table:string,row:Record<string,unknown>){const cols=Object.keys(row).map(k=>`"${k}"`).join(',');await pg.query(`INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`,[JSON.stringify(row)]);}
 async function isolated(work:()=>Promise<void>){await pg.exec('BEGIN');try{await work();}finally{await pg.exec('ROLLBACK');}}
 // Remove only outer transaction delimiters to run each real generated packet inside a rollback-only fixture.
 const body=(sql:string)=>sql.replace(/^BEGIN;\n/,'').replace(/\nCOMMIT;$/,'');
 async function rejects(sql:string,re:RegExp){await pg.exec('SAVEPOINT rejected');await expect(pg.exec(body(sql))).rejects.toThrow(re);await pg.exec('ROLLBACK TO SAVEPOINT rejected');}
 async function ready(){const i=input();await pg.exec(body(compileCloudPilotCandidateSql(candidateInput())));await pg.query('UPDATE "CrawlCoordinatorLock" SET "holderId"=$1,"heartbeatAt"=clock_timestamp()',[holderId]);return i;}
 it("pins every local migration checksum and the schema-only snapshot provenance",async()=>{
  expect(CLOUD_PILOT_SQL45.migrations).toHaveLength(45);
  for(const m of CLOUD_PILOT_SQL45.migrations)expect(digest(await readFile(`prisma/migrations/${m.migrationName}/migration.sql`,"utf8"))).toBe(m.checksum);
 });
 it.each(["unknown","unfinished","rolled-back","checksum"])("rejects %s migration history with no candidate write",async(condition)=>isolated(async()=>{
  if(condition==="unknown")await pg.exec(`UPDATE "_prisma_migrations" SET migration_name='20990101000000_unknown' WHERE id=(SELECT id FROM "_prisma_migrations" LIMIT 1)`);
  if(condition==="unfinished")await pg.exec('UPDATE "_prisma_migrations" SET finished_at=null WHERE id=(SELECT id FROM "_prisma_migrations" LIMIT 1)');
  if(condition==="rolled-back")await pg.exec('UPDATE "_prisma_migrations" SET rolled_back_at=clock_timestamp() WHERE id=(SELECT id FROM "_prisma_migrations" LIMIT 1)');
  if(condition==="checksum")await pg.exec(`UPDATE "_prisma_migrations" SET checksum=repeat('0',64) WHERE id=(SELECT id FROM "_prisma_migrations" LIMIT 1)`);
  await rejects(compileCloudPilotCandidateSql(candidateInput()),/MIGRATION_HISTORY/);
  expect((await pg.query('SELECT count(*)::int n FROM "ReleaseCandidate" WHERE id=$1',[candidate.id])).rows[0].n).toBe(0);
 }));
 it("rejects changed guard, provenance, expired request and all candidate conflict keys",async()=>isolated(async()=>{
  const ci=candidateInput();
  await rejects(compileCloudPilotCandidateSql({...ci,expiresAt:new Date(0).toISOString()}),/REQUEST_EXPIRED/);
  await pg.exec('SAVEPOINT drift');await pg.exec('ALTER FUNCTION public.enforce_source_result_state_machine() COST 123');
  await rejects(compileCloudPilotCandidateSql(ci),/GUARD_DRIFT/);await pg.exec('ROLLBACK TO SAVEPOINT drift');
  await pg.exec(`UPDATE "ReleaseCandidate" SET status='INVALIDATED' WHERE id='${CLOUD_PILOT_SQL45.currentCandidate.id}'`);
  await rejects(compileCloudPilotCandidateSql(ci),/PROVENANCE_DRIFT/);await pg.exec('ROLLBACK TO SAVEPOINT drift');
  await pg.exec(body(compileCloudPilotCandidateSql(ci)));
  await rejects(compileCloudPilotCandidateSql({...ci,candidate:{...candidate,id:"conflict-goal"}}),/CANDIDATE_CONFLICT/);
  await rejects(compileCloudPilotCandidateSql({...ci,candidate:{...candidate,id:"conflict-identity",version:11}}),/CANDIDATE_CONFLICT/);
 }));
 it("creates honest candidate once and refuses conflicts, unknown or duplicate migration history",async()=>isolated(async()=>{
  const sql=compileCloudPilotCandidateSql(candidateInput());await pg.exec(body(sql));
  const row=(await pg.query('SELECT * FROM "ReleaseCandidate" WHERE id=$1',[candidate.id])).rows[0];expect(row).toMatchObject({...candidate,status:"BUILDING",commitSha:build.commitSha,sourceTreeHash:build.sourceTreeSha256,runtimeTreeHash:build.runtimeTreeSha256,dbSnapshotHash:CLOUD_PILOT_SQL45.currentCandidate.dbSnapshotHash,schemaHash:CLOUD_PILOT_SQL45.currentCandidate.schemaHash});
  await rejects(sql,/CANDIDATE_CONFLICT/);
  await pg.exec('INSERT INTO "_prisma_migrations" SELECT * FROM "_prisma_migrations" LIMIT 1');
  await rejects(compileCloudPilotCandidateSql({...candidateInput(),candidate:{...candidate,id:"other",version:11}}),/MIGRATION_HISTORY/);
 }));
 it("creates actual defaulted PENDING rows and duplicate creation rolls back its heartbeat",async()=>isolated(async()=>{
  const i=await ready(),sql=compileCloudPilotCreatePendingSql(i);const result=await pg.exec(body(sql));
  const returned=result.flatMap((x:any)=>x.rows??[]).find((x:any)=>x.result)?.result;
  expect(returned.batch).toMatchObject({id:i.planned.batch.id,status:"RUNNING",kind:"SCHEDULED",plannedSourceCount:1,atomicCommittedCount:0});
  expect(returned.sourceRows).toHaveLength(1);expect(returned.sourceRows[0]).toMatchObject({id:i.planned.sources[0]!.id,atomicCommitState:"PENDING",rawCount:0,retryReasonCodes:[],createdAt:expect.any(String)});
  const before=(await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows;
  await rejects(sql,/duplicate key/);expect((await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows).toEqual(before);
  expect((await pg.query('SELECT count(*)::int n FROM "Job"')).rows[0].n).toBe(0);
 }));
 it("keeps the original sixty-second pending timestamp guard despite longer control pickup",async()=>isolated(async()=>{
  await ready();const old=input(new Date(Date.now()-61000));
  await rejects(compileCloudPilotCreatePendingSql(old),/PILOT_PENDING_TIME_DRIFT/);
  expect((await pg.query('SELECT count(*)::int n FROM "CrawlBatch"')).rows[0].n).toBe(0);
 }));
 it.each(["expired","replaced","missing"])("rejects %s lease before pending writes",async(condition)=>isolated(async()=>{
  const i=await ready();
  if(condition==="expired")await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "heartbeatAt"=clock_timestamp()-interval '301 seconds'`);
  if(condition==="replaced")await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "holderId"='someone-else'`);
  if(condition==="missing")await pg.exec('DELETE FROM "CrawlCoordinatorLock"');
  await rejects(compileCloudPilotCreatePendingSql(i),/CRAWL_LEASE_LOST/);
  expect((await pg.query('SELECT count(*)::int n FROM "CrawlBatch"')).rows[0].n).toBe(0);
 }));
 it("cannot claim SUCCESS for a source still PENDING",async()=>isolated(async()=>{
  const i=await ready();await pg.exec(body(compileCloudPilotCreatePendingSql(i)));
  const sourceRow=(await pg.query('SELECT to_jsonb(r) row FROM "CrawlBatchSourceResult" r')).rows[0].row;
  expect(()=>compileCloudPilotFinalizeSql({...i,outcome:"COMMITTED_EXACT",sourceRow})).toThrow(/COMMITTED_EXACT/);
  expect((await pg.query('SELECT status FROM "CrawlBatch"')).rows[0].status).toBe("RUNNING");
 }));
 it.each(["expired","replaced","missing"])("renewal rejects %s holder with no revived lease",async condition=>isolated(async()=>{
  const leaseDb:PortableLeaseDatabase={$transaction:work=>work({$queryRawUnsafe:async<T>(sql:string,...values:unknown[])=>(await pg.query(sql,values)).rows as T})};
  const lease=await acquirePortableCrawlLease(leaseDb);
  try{
   if(condition==="expired")await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "heartbeatAt"=clock_timestamp()-interval '301 seconds'`);
   if(condition==="replaced")await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "holderId"='new-owner'`);
   if(condition==="missing")await pg.exec('DELETE FROM "CrawlCoordinatorLock"');
   const before=(await pg.query('SELECT * FROM "CrawlCoordinatorLock"')).rows;
   await rejects(prepareCloudPilotRenewalSql(lease,Date.now()+30000),/CRAWL_LEASE_LOST/);
   expect((await pg.query('SELECT * FROM "CrawlCoordinatorLock"')).rows).toEqual(before);
  }finally{await releasePortableCrawlLease(leaseDb,lease);}
 }));
 it(`finalizes an actual compiler-committed Qilu row (${process.env.QILU_RETAINED_ARTIFACT_ROOT?227:2} jobs) using persisted compact CURRENT tuples`,async()=>{
  // Mocked official HTTP, real owned admission and local SQL45 publication; no live acquisition.
  const workspaceRoot=await mkdtemp(join(tmpdir(),"pilot-control-"));
  const leaseDb:PortableLeaseDatabase={$transaction:work=>pg.transaction((tx:any)=>work({$queryRawUnsafe:async<T>(sql:string,...values:unknown[])=>(await tx.query(sql,values)).rows as T}))};
  const lease=await acquirePortableCrawlLease(leaseDb);
  try{
   const i={...input(),holderId:lease.holderId};
   await pg.exec(compileCloudPilotCandidateSql(candidateInput()));
   await pg.exec(compileCloudPilotCreatePendingSql(i));
   const fixture=await qiluPilotHttpFixture(process.env.QILU_RETAINED_ARTIFACT_ROOT);
   vi.stubGlobal("fetch",fixture.fetch);
   const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
   vi.unstubAllGlobals();
   const pending=i.planned.sources[0]!,b=i.planned.batch,evidenceSubdirectory="synthetic/runtime-evidence";
   const binding={releaseCandidateId:candidate.id,batchId:b.id,sourceId,sourceResultId:pending.id,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion};
   const archived=(await archiveSourceEvidence({workspaceRoot,...binding,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,artifacts:result.fetchEvidence!.artifacts})})).artifacts;
   const bundle=await makeArchiveBundle({workspaceRoot,...binding,evidenceSubdirectory,artifacts:archived});
   const bundleBytes=JSON.stringify(bundle,null,2),restoredRoot=await mkdtemp(join(workspaceRoot,"restore-"));
   const artifacts=await restoreArchiveBundle(JSON.parse(bundleBytes),restoredRoot);
   const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot:restoredRoot,evidenceSubdirectory,artifacts}});
   expect(result.jobs).toHaveLength(fixture.jobCount);
   expect(result.paginationEvaluation?.visitedChannelIds).toEqual(["qilu-marketing","qilu-non-marketing"]);
   expect(admission.status).toBe("ACCEPTED");
   const identity={releaseCandidateId:candidate.id,commitSha:b.commitSha,rosterSha256:b.rosterSha256,sourcePlanSha256:b.sourcePlanSha256,sourceConfigSha256:b.sourceConfigSha256,adapterBundleSha256:b.adapterBundleSha256,batchKind:"SCHEDULED" as const,ownerId:b.ownerId,expectedPlannedSourceIds:b.plannedSourceIds,expectedPlannedSourceSetSha256:b.plannedSourceSetSha256,expectedPlannedSourceCount:1};
   const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId:b.id,result,previousJobs:[],baselineCompletedBeforeCrawl:false,artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
   const publicationSql=await compilePortableAtomicSourceEvidenceSql(commit,lease);
   await pg.exec(prepareCloudPilotRenewalSql(lease,Date.now()+60000));
   for(const condition of ["expired","replaced"]){
    await isolated(async()=>{
     if(condition==="expired")await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "heartbeatAt"=clock_timestamp()-interval '301 seconds'`);
     else await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "holderId"='new-owner'`);
     await rejects(publicationSql,/CRAWL_LEASE_LOST/);
     expect((await pg.query('SELECT count(*)::int n FROM "Job"')).rows[0].n).toBe(0);
    });
   }
   if(process.env.QILU_RETAINED_ARTIFACT_ROOT)console.info("OFFLINE_QILU_SQL45_BYTES",JSON.stringify({jobs:fixture.jobCount,sqlBytes:Buffer.byteLength(publicationSql),archiveBytes:Buffer.byteLength(bundleBytes),retainedResponseBytes:fixture.responseBytes}));
   await pg.exec("BEGIN;"+publicationSql+";COMMIT;");
   const sourceRow=(await pg.query('SELECT to_jsonb(r) row FROM "CrawlBatchSourceResult" r WHERE id=$1',[pending.id])).rows[0].row;
   const revived={...sourceRow,startedAt:new Date(sourceRow.startedAt+"Z"),finishedAt:new Date(sourceRow.finishedAt+"Z")};
   const outcome=await inspectPersistedAtomicCommitOutcome(commit,{crawlBatchSourceResult:{findUnique:async()=>revived,findMany:async()=>[]}});
   expect(outcome.state).toBe("COMMITTED_EXACT");
   const f={...i,outcome:"COMMITTED_EXACT" as const,sourceRow},sql=compileCloudPilotFinalizeSql(f);
   const jobsBefore=(await pg.query('SELECT to_jsonb(j) row FROM "Job" j ORDER BY id')).rows;
   await isolated(async()=>{
    await rejects(compileCloudPilotFinalizeSql({...f,holderId}),/CRAWL_LEASE_LOST/);
    await rejects(compileCloudPilotFinalizeSql({...f,sourceRow:{...sourceRow,rawCount:sourceRow.rawCount+1}}),/COMMITTED_EXACT/);
    await pg.exec(`UPDATE "CrawlBatch" SET "ownerId"='changed' WHERE id='${b.id}'`);
    await rejects(sql,/BATCH_DRIFT/);
   });
   await isolated(async()=>{
    // An extra real row from another source must block the one-source denominator.
    await insert("RecruitmentSource",{id:"extra-source",companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,updatedAt:new Date()});
    const pendingData={...sourceRow,id:"extra-result",sourceId:"extra-source",transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",finishedAt:null,completenessCertificate:null,completenessCertificateSha256:null,baselinePreviousSourceResultId:null,baselinePreviousJobCount:null,baselineChangeReason:null};
    await pg.exec("SAVEPOINT extra_source");
    await expect(insert("CrawlBatchSourceResult",pendingData)).rejects.toThrow(/outside the parent planned set/);
    await pg.exec("ROLLBACK TO SAVEPOINT extra_source");
   });
   const rows=await pg.exec(sql),batch=rows.flatMap((r:any)=>r.rows??[]).find((r:any)=>r.batch)?.batch;
   const members=(await pg.query(`SELECT "sourceId","jobKey" FROM "LifecycleSetEvidenceMember" WHERE "sourceResultId"=$1 AND "setKind"='CURRENT'`,[pending.id])).rows;
   expect(batch).toMatchObject({status:"SUCCESS",atomicCommittedCount:1,completenessVerifiedCount:1,failedSourceCount:0,aggregateJobSetSha256:hashCanonicalJobKeySet(members)});
   expect(batch.finishedAt).not.toBeNull();expect(members).toHaveLength(fixture.jobCount);
   expect((await pg.query('SELECT to_jsonb(j) row FROM "Job" j ORDER BY id')).rows).toEqual(jobsBefore);
   await isolated(async()=>{await rejects(sql,/BATCH_DRIFT/);});
  }finally{vi.unstubAllGlobals();await pg.exec("ROLLBACK");await releasePortableCrawlLease(leaseDb,lease);await rm(workspaceRoot,{recursive:true,force:true});}
 });

});
