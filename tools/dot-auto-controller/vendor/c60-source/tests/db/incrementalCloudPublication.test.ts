// @vitest-environment node
// Local PostgreSQL only. Original source acquisition/receipts/archive replay and
// the existing DB-started compiler are real; public HTTP and relay are fixtures.
import {beforeAll,afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {compileDbStartedCloudSourcePublication,deriveDbStartedPublicationExpiry} from '../../src/db/ingestionRepository';
import {compileCloudPilotCandidateSql,compileCloudPilotPublicationContextSql,type CloudPilotPublicationContext} from '../../src/db/cloudPilotSqlControl';
import {CLOUD_PILOT_SQL45} from '../../src/db/cloudPilotSql45Manifest';
import {deriveCurrentStagedScheduleExpectation} from '../../src/crawler/stagedScheduleAuthority';
import {buildPendingRuntimeBatch,bindRuntimeEvidenceArtifactIds} from '../../src/crawler/runtimeAtomicEvidence';
import {hashCanonicalStringSet} from '../../src/crawler/runtimeBatchIdentity';
import {runSourceCrawl,createSourceFetchAttemptTracker} from '../../src/crawler/runSourceCrawl';
import {archiveSourceEvidence} from '../../src/crawler/artifactArchive';
import {FilePilotRelay,PILOT_BUDGET,sha256} from '../../src/crawler/cloudSourcePilotRelay';
import {SOURCE_QUALITY_POLICY_ID,createOwnedSourceQualityFetch,issueSourceQualityAdmission} from '../../src/crawler/sourceQualityAdmission';
import {createIncrementalPglite} from '../helpers/incrementalPglite';
import {JOB_DELTA_MIGRATION_NAME} from '../../src/db/jobProjectionDeltaProfile';
import {inspectPersistedAtomicCommitOutcome} from '../../src/db/ingestionRepository';
import {reviveUtcFields} from '../../src/crawler/cloudSourcePilotRelay';
import {parseJobProjectionDeltaReceipt} from '../../src/domain/jobProjectionDeltaReceipt';

vi.mock('../../src/readiness/buildIdentity',()=>({resolveCurrentBuildIdentity:()=>currentBuild}));
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const base={schemaVersion:2 as const,commitSha:'a'.repeat(40),sourceTreeSha256:'b'.repeat(64),runtimeTreeSha256:'c'.repeat(64)};
const build={...base,contentSha256:digest(JSON.stringify(base))};
let currentBuild=build;
const candidate={id:'synthetic-incremental-db-started',goalId:'jobfinder-portable-required-40',version:50};
const common={projectId:'yiopvxysxrtrnvqxwgbx',build,candidate,databaseIdentity:{migrationVersion:JOB_DELTA_MIGRATION_NAME,schemaHash:'d'.repeat(64),dbSnapshotHash:'e'.repeat(64)}};
const expected=deriveCurrentStagedScheduleExpectation(build),plan=expected.plans.find(p=>p.source.id==='source-hansoh-social')!;
const identity={releaseCandidateId:candidate.id,commitSha:expected.commitSha,rosterSha256:expected.rosterSha256,sourcePlanSha256:expected.sourcePlanSha256,sourceConfigSha256:expected.sourceConfigSha256,adapterBundleSha256:expected.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:'dot-cloud-hansoh-social-pilot',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([plan.source.id])};
const modulePath=process.env.PGLITE_MODULE,dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('uses the original portable acquisition finish cutoff, never the receipt issuance time',()=>{
 const startedAt=new Date('2026-10-04T00:00:00Z'),finishedAt='2026-10-04T00:01:00Z';
 expect(deriveDbStartedPublicationExpiry({startedAt,completenessCertificate:{schemaVersion:'plan-bound-source-quality-v1',acquisition:{finishedAt},issuedAt:'2026-10-04T00:20:00Z'}})).toBe(Date.parse(finishedAt)+30*60_000);
 expect(()=>deriveDbStartedPublicationExpiry({startedAt,completenessCertificate:{schemaVersion:'plan-bound-source-quality-v1'}})).toThrow('PILOT_EVIDENCE_EXPIRY_INVALID');
});

describe.skipIf(!modulePath)('incremental real compiler in in-memory PostgreSQL',()=>{
 let pg:any;
 const generatedFixtures:Record<string,unknown>[]=[];
 async function insert(table:string,row:Record<string,unknown>){const cols=Object.keys(row).map(k=>'"'+k+'"').join(',');await pg.query(`INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`,[JSON.stringify(row)]);}
 async function seedNewDatabase(){
  await insert('ReleaseCandidate',{...CLOUD_PILOT_SQL45.currentCandidate,rosterHash:'0'.repeat(64),sourcePlanHash:'0'.repeat(64),sourceConfigHash:'0'.repeat(64),adapterBundleHash:'0'.repeat(64),sourceTreeHash:'0'.repeat(64),runtimeTreeHash:'0'.repeat(64),oracleVersion:'historical'});
  await insert('Company',{id:plan.company.id,officialChineseName:plan.company.officialChineseName,officialWebsiteUrl:plan.source.officialEntryUrl,pinyinName:'synthetic',inclusionReason:'synthetic only',updatedAt:new Date()});
  await insert('RecruitmentSource',{id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,updatedAt:new Date()});
  await pg.exec(compileCloudPilotCandidateSql({...common,expiresAt:new Date(Date.now()+60_000).toISOString()}));
  await pg.exec(`CREATE TABLE job_write_audit (kind text);CREATE FUNCTION test_job_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO job_write_audit VALUES(TG_OP);RETURN NEW;END$$;CREATE TRIGGER test_job_audit AFTER INSERT OR UPDATE ON \"Job\" FOR EACH ROW EXECUTE FUNCTION test_job_audit();`);
 }
 async function freshDatabase(work:()=>Promise<void>){
  const old=pg;pg=(await createIncrementalPglite({modulePath:modulePath!,allowTestHashShim:true,producerRoot:process.cwd()})).pg;
  try{await seedNewDatabase();await work();}finally{await pg.close();pg=old;}
 }
 beforeAll(async()=>{
  pg=(await createIncrementalPglite({modulePath:modulePath!,allowTestHashShim:true,producerRoot:process.cwd()})).pg;
  await seedNewDatabase();
 },30_000);
 afterAll(async()=>{if(generatedFixtures.length)await writeFile(resolve("../contract/publisher-generated-fixtures.json"),JSON.stringify({syntheticOnly:true,implementation:"actual compiler and in-memory SQL",cryptoMode:"TEST_ONLY_CORE_SHA256_ADAPTER",fixtures:generatedFixtures},null,2));await pg?.close();});
 async function isolated(work:()=>Promise<void>){await pg.exec('BEGIN');try{await work();}finally{await pg.exec('ROLLBACK');}}
 async function context(controlInput:any=common):Promise<CloudPilotPublicationContext>{return (await pg.query(compileCloudPilotPublicationContextSql(controlInput,SOURCE_QUALITY_POLICY_ID))).rows[0].context;}
 function mockHttp(title="职位1",ids=[1],incomplete=false){
  const data=ids.map(n=>({Id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),JobAdId:n,JobAdName:n===1?title:title+'-'+n,LocNames:['上海市'],Category:'社会招聘',CategoryId:'1',Kind:'全职',Status:1,PostDate:'2026-09-20T12:00:00',ChangeDate:'0001-01-01T00:00:00'}));
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>({status:200,url:String(url),headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify({Code:200,Count:data.length+(incomplete?1:0),Data:data})})));
 }
 let captureSequence=0;
 async function fixture(batchId:string,ageMs=20*60_000,title="职位1",ids=[1],incomplete=false,runtime:{common:any;identity:any}={common,identity}){
  const realNow=Date.now(),startedAt=new Date(realNow-ageMs+(captureSequence++)*1000);vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(startedAt);mockHttp(title,ids,incomplete);
  const attemptTracker=createSourceFetchAttemptTracker(),result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false,attemptTracker});
  const planned=buildPendingRuntimeBatch(batchId,[plan],runtime.identity,startedAt),pending=planned.sources[0]!;
  const tuple={releaseCandidateId:runtime.identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
  const workspaceRoot=await mkdtemp(join(tmpdir(),'portable-db-started-'));dirs.push(workspaceRoot);
  const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:'evidence',captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
  const admission=await issueSourceQualityAdmission({plan,result,binding:{...tuple,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},archive:{workspaceRoot,evidenceSubdirectory:'evidence',artifacts:archive.artifacts}});
  if(admission.status!=='ACCEPTED')throw Error(JSON.stringify(admission));
  vi.setSystemTime(realNow);
  return {workspaceRoot,initialCertificate:admission.receipt,control:{...runtime.common,planned,context:await context(runtime.common)},source:{plan,pending,identity:runtime.identity,batchId,result,artifacts:archive.artifacts,attemptTracker,publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1' as const,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission}};
 }
 async function noPublication(){for(const table of ['CrawlBatch','CrawlBatchSourceResult','Job','EvidenceArtifact','PaginationEvidence','CrawlObservation','LifecycleSetEvidenceMember'])expect((await pg.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n).toBe(0);}
 async function rejects(sql:string,re:RegExp){await pg.exec('SAVEPOINT rejected');await expect(pg.exec(sql)).rejects.toThrow(re);await pg.exec('ROLLBACK TO SAVEPOINT rejected');}

 async function captureFixture(label:string){
  const sources=(await pg.query(`SELECT to_jsonb(r)||jsonb_build_object(
   'batch',(SELECT jsonb_build_object('id',b.id,'releaseCandidateId',b."releaseCandidateId",'kind',b.kind,'status',b.status) FROM "CrawlBatch" b WHERE b.id=r."batchId"),
   'observations',(SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM "CrawlObservation" o WHERE o."sourceResultId"=r.id),
   '_count',jsonb_build_object('transportAttempts',(SELECT count(*) FROM "TransportAttemptEvidence" x WHERE x."sourceResultId"=r.id),'evidenceArtifacts',(SELECT count(*) FROM "EvidenceArtifact" x WHERE x."sourceResultId"=r.id),'observations',(SELECT count(*) FROM "CrawlObservation" x WHERE x."sourceResultId"=r.id),'paginationEvidence',(SELECT count(*) FROM "PaginationEvidence" x WHERE x."sourceResultId"=r.id),'lossLedgerEntries',(SELECT count(*) FROM "LossLedgerEntry" x WHERE x."sourceResultId"=r.id),'lifecycleSetMembers',(SELECT count(*) FROM "LifecycleSetEvidenceMember" x WHERE x."sourceResultId"=r.id))) AS row FROM "CrawlBatchSourceResult" r ORDER BY r."finishedAt",r.id`)).rows.map((r:any)=>r.row);
  const members=(await pg.query('SELECT to_jsonb(m) row FROM "LifecycleSetEvidenceMember" m')).rows.map((r:any)=>r.row);
  const jobs=await physical();const latest=sources.at(-1);
  generatedFixtures.push({label,sourceId:plan.source.id,currentTime:new Date(Date.parse(latest.finishedAt+'Z')+60_000).toISOString(),sources,members,jobs});
 }
 const delta=(f:Awaited<ReturnType<typeof fixture>>)=>compileDbStartedCloudSourcePublication({...f,jobProjectionDelta:true});
 async function physical(){return (await pg.query('SELECT to_jsonb(j) AS row FROM "Job" j')).rows.map((x:any)=>x.row);}
 async function audit(){return (await pg.query('SELECT kind,count(*)::int n FROM job_write_audit GROUP BY kind ORDER BY kind')).rows;}
 it('moves legacy SQL48 to v2 with no same-content Job rewrite or fabricated changedAt',async()=>{
  const previousPg=pg,temporary=await createIncrementalPglite({modulePath:modulePath!,allowTestHashShim:true,producerRoot:process.cwd(),includeDelta:false});pg=temporary.pg;
  try{
   const legacyBase={...base,commitSha:'f'.repeat(40),sourceTreeSha256:'1'.repeat(64),runtimeTreeSha256:'2'.repeat(64)},legacyBuild={...legacyBase,contentSha256:digest(JSON.stringify(legacyBase))};
   const legacyExpected=deriveCurrentStagedScheduleExpectation(legacyBuild);currentBuild=legacyBuild;
   const legacyCommon={projectId:common.projectId,build:legacyBuild,candidate:{...candidate,id:'synthetic-legacy-before-v2',version:49}},legacyIdentity={...identity,releaseCandidateId:'synthetic-legacy-before-v2',commitSha:legacyExpected.commitSha,rosterSha256:legacyExpected.rosterSha256,sourcePlanSha256:legacyExpected.sourcePlanSha256,sourceConfigSha256:legacyExpected.sourceConfigSha256,adapterBundleSha256:legacyExpected.adapterBundleSha256};
   await insert('ReleaseCandidate',{...CLOUD_PILOT_SQL45.currentCandidate,rosterHash:'0'.repeat(64),sourcePlanHash:'0'.repeat(64),sourceConfigHash:'0'.repeat(64),adapterBundleHash:'0'.repeat(64),sourceTreeHash:'0'.repeat(64),runtimeTreeHash:'0'.repeat(64),oracleVersion:'historical'});
   await insert('Company',{id:plan.company.id,officialChineseName:plan.company.officialChineseName,officialWebsiteUrl:plan.source.officialEntryUrl,pinyinName:'synthetic',inclusionReason:'synthetic only',updatedAt:new Date()});
   await insert('RecruitmentSource',{id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,updatedAt:new Date()});
   await pg.exec(compileCloudPilotCandidateSql({...legacyCommon,expiresAt:new Date(Date.now()+60_000).toISOString()}));
   const first=await fixture('legacy-seed',20*60_000,'职位1',[1],false,{common:legacyCommon,identity:legacyIdentity});
   await pg.exec((await compileDbStartedCloudSourcePublication(first)).sql);
   currentBuild=build;
   const migration=await readFile('prisma/migrations/'+JOB_DELTA_MIGRATION_NAME+'/migration.sql','utf8');await pg.exec(migration);
   await pg.query('INSERT INTO "_prisma_migrations" VALUES($1,$1,$2,clock_timestamp(),null)',[JOB_DELTA_MIGRATION_NAME,digest(migration)]);
   await pg.exec(compileCloudPilotCandidateSql({...common,expiresAt:new Date(Date.now()+60_000).toISOString()}));
   const before=await physical();expect(before[0].sourceChangedAt).toBeNull();
   const next=await fixture('legacy-to-delta'),packet=await delta(next);expect(packet.sql).not.toContain('INSERT INTO public."Job"');
   await pg.exec(packet.sql);expect(await physical()).toEqual(before);await captureFixture('legacy-to-v2-unchanged');
  }finally{currentBuild=build;await pg.close();pg=previousPg;}
 });
 it('publishes two exact observations while leaving an unchanged physical Job untouched',async()=>isolated(async()=>{
  const first=await fixture('delta-first'),firstPacket=await delta(first);
  await pg.exec(firstPacket.sql);await pg.exec('SET CONSTRAINTS ALL IMMEDIATE');
  const before=await physical();expect(await audit()).toEqual([{kind:'INSERT',n:1}]);
  const second=await fixture('delta-second'),secondPacket=await delta(second);
  expect(second.control.context.latestAccepted!.id).toBe(first.source.pending.id);
  expect(secondPacket.sql).not.toContain('INSERT INTO public."Job"');
  expect(secondPacket.sql).toContain('SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;');
  expect(secondPacket.sql).not.toContain('SET CONSTRAINTS ALL IMMEDIATE;');
  await pg.exec(secondPacket.sql);await pg.exec('SET CONSTRAINTS ALL IMMEDIATE');
  expect(await physical()).toEqual(before);expect(await audit()).toEqual([{kind:'INSERT',n:1}]);
  await captureFixture("second-unchanged-v2");
  const latest=await context();expect(latest.latestAccepted!.id).toBe(second.source.pending.id);
  const receipt=parseJobProjectionDeltaReceipt(latest.latestAccepted!.completenessCertificate,String(latest.latestAccepted!.completenessCertificateSha256));
  expect(receipt.members).toHaveLength(2);expect(receipt.verifiedAt).toBe(secondPacket.commit.sourceResult.finishedAt!.toISOString());
  expect(receipt.members.every(m=>m.lastPresentResultId===second.source.pending.id)).toBe(true);
  expect((await pg.query('SELECT count(*)::int n FROM "CrawlObservation"')).rows[0].n).toBe(2);
  expect((await pg.query('SELECT count(*)::int n FROM "LifecycleSetEvidenceMember"')).rows[0].n).toBe(4);
  const third=await fixture('delta-third'),thirdPacket=await delta(third);
  expect(thirdPacket.sql).not.toContain('INSERT INTO public."Job"');
  await pg.exec(thirdPacket.sql);expect(await physical()).toEqual(before);
  const retained=await pg.query('SELECT "sourceChangedAt","lastSeenAt" FROM "Job"');
  expect(retained.rows[0].sourceChangedAt).toEqual(retained.rows[0].lastSeenAt);
  console.log(JSON.stringify({syntheticOnly:true,firstSqlBytes:Buffer.byteLength(firstPacket.sql),secondSqlBytes:Buffer.byteLength(secondPacket.sql),firstJobInserts:1,secondJobWrites:0,thirdJobWrites:0,secondManifestBytes:Buffer.byteLength(JSON.stringify(receipt.members))}));
 }));
 it('writes exactly one real source change while preserving first-seen and human overlays',async()=>isolated(async()=>{
  const first=await fixture('delta-content-first');await pg.exec((await delta(first)).sql);
  await pg.exec(`UPDATE "Job" SET "humanCorrectedTitle"='人工标题',"humanTitleCorrectionReason"='synthetic test',"humanTitleCorrectedAt"=clock_timestamp(),"auxiliaryChineseTitle"='人工辅助标题'`);
  const before=(await physical())[0];await pg.exec('DELETE FROM job_write_audit');
  const next=await fixture('delta-content-next',20*60_000,'职位真实变更'),packet=await delta(next);
  expect(packet.sql).toContain('existing_job."isNew" IS DISTINCT FROM proposed."isNew"');
  expect(packet.sql).toContain('existing_job."visibleInFrontend" IS DISTINCT FROM proposed."visibleInFrontend"');
  await pg.exec(packet.sql);const after=(await physical())[0];
  expect(await audit()).toEqual([{kind:'UPDATE',n:1}]);expect(after.officialTitle).toBe('职位真实变更');
  expect(after.firstSeenAt).toBe(before.firstSeenAt);expect(after.humanCorrectedTitle).toBe('人工标题');expect(after.auxiliaryChineseTitle).toBe('人工辅助标题');
  expect(after.sourceChangedAt).not.toBe(before.sourceChangedAt);await captureFixture('one-persisted-title-change');
 }));
 it('preserves complete disappearance through GRACE, SUSPECTED_OFFLINE and OFFLINE',async()=>isolated(async()=>{
  const first=await fixture('delta-life-first',20*60_000,'职位1',[1,2]);await pg.exec((await delta(first)).sql);
  const original=(await physical())[0],oldKey=plan.source.id+':legacy-before-floor',offlineKey=plan.source.id+':historical-offline';
  await insert('Job',{...original,id:'synthetic-legacy-before-floor',dedupeKey:oldKey,sourceJobId:'legacy-before-floor',firstSeenAt:'2020-01-01T00:00:00.000Z',lastSeenAt:'2020-01-01T00:00:00.000Z',sourceChangedAt:null});
  await insert('Job',{...original,id:'synthetic-historical-offline',dedupeKey:offlineKey,sourceJobId:'historical-offline',missingSuccessCount:6,lifecycleStatus:'OFFLINE',visibleInFrontend:false,sourceChangedAt:null});
  const legacyBefore=(await physical()).find((row:any)=>row.dedupeKey===oldKey);
  for(const [step,status] of [[1,'ACTIVE'],[2,'SUSPECTED_OFFLINE'],[3,'OFFLINE']] as const){
   const next=await fixture('delta-life-'+step,20*60_000,'职位1',[1]);await pg.exec((await delta(next)).sql);
   const rows=await physical(),missing=rows.find((row:any)=>row.missingSuccessCount===step);
   expect(missing?.lifecycleStatus).toBe(status);
   expect(rows.find((row:any)=>row.dedupeKey===oldKey)).toEqual(legacyBefore);
   expect(rows.find((row:any)=>row.dedupeKey===offlineKey)?.missingSuccessCount).toBe(6+step);
   const committed=await context(),manifest=parseJobProjectionDeltaReceipt(committed.latestAccepted!.completenessCertificate,String(committed.latestAccepted!.completenessCertificateSha256));
   expect(manifest.members.some(m=>m.jobKey===oldKey||m.jobKey===offlineKey)).toBe(false);
   await captureFixture('complete-miss-'+step);
  }
 }));
 it('incomplete declared count cannot update prior stored or published jobs',async()=>isolated(async()=>{
  const first=await fixture('delta-partial-first');await pg.exec((await delta(first)).sql);const before=await physical();
  await expect(fixture('delta-partial-fail',20*60_000,'职位1',[1],true)).rejects.toThrow();
  expect(await physical()).toEqual(before);expect((await pg.query('SELECT count(*)::int n FROM "CrawlBatchSourceResult"')).rows[0].n).toBe(1);
  await captureFixture('incomplete-failure-preserves-prior');
 }));
 it('resolves an UNKNOWN acknowledgement through exact immutable readback without replay',async()=>isolated(async()=>{
  const f=await fixture('delta-unknown'),packet=await delta(f);await pg.exec(packet.sql);
  const row=(await pg.query('SELECT to_jsonb(r) row FROM "CrawlBatchSourceResult" r WHERE id=$1',[packet.commit.sourceResult.id])).rows[0].row;
  const persisted=reviveUtcFields(row,['startedAt','finishedAt']);
  const read={crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>[]}};
  expect(await inspectPersistedAtomicCommitOutcome(packet.commit,read)).toEqual({state:'COMMITTED_EXACT'});
  const bad={...persisted,completenessCertificateSha256:'0'.repeat(64)};
  expect(await inspectPersistedAtomicCommitOutcome(packet.commit,{crawlBatchSourceResult:{findUnique:async()=>bad,findMany:async()=>[]}})).toEqual({state:'CONFLICT'});
  expect(await audit()).toEqual([{kind:'INSERT',n:1}]);
  await rejects(packet.sql,/PILOT_REQUEST_ALREADY_APPLIED|PILOT_CONTEXT_CHANGED/);
  expect(await audit()).toEqual([{kind:'INSERT',n:1}]);
 }));
 it('rolls back a same-transaction tail Job change at actual COMMIT',async()=>freshDatabase(async()=>{
  const f=await fixture('delta-tail-write'),packet=await delta(f);
  await pg.exec('BEGIN');await pg.exec(packet.sql);
  await pg.exec(`UPDATE "Job" SET "officialTitle"='uncommitted tail corruption'`);
  await expect(pg.exec('COMMIT')).rejects.toThrow(/JOB_DELTA_COMMIT/);
  await pg.exec('ROLLBACK');
  for(const table of ['Job','CrawlBatch','CrawlBatchSourceResult','CrawlObservation','LifecycleSetEvidenceMember'])expect((await pg.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n).toBe(0);
 }));
 it('allows subsequent committed batches and retains an exact historical receipt',async()=>freshDatabase(async()=>{
  const first=await fixture('delta-real-commit-one'),firstPacket=await delta(first);await pg.exec(firstPacket.sql);
  const oldPhysical=await physical();
  const second=await fixture('delta-real-commit-two'),secondPacket=await delta(second);await pg.exec(secondPacket.sql);expect(await physical()).toEqual(oldPhysical);
  const third=await fixture('delta-real-commit-three',20*60_000,'独立新批次真实变更'),thirdPacket=await delta(third);await pg.exec(thirdPacket.sql);
  expect((await physical())[0].officialTitle).toBe('独立新批次真实变更');
  const row=(await pg.query('SELECT to_jsonb(r) row FROM "CrawlBatchSourceResult" r WHERE id=$1',[firstPacket.commit.sourceResult.id])).rows[0].row;
  expect(await inspectPersistedAtomicCommitOutcome(firstPacket.commit,{crawlBatchSourceResult:{findUnique:async()=>reviveUtcFields(row,['startedAt','finishedAt']),findMany:async()=>[]}})).toEqual({state:'COMMITTED_EXACT'});
  expect(await audit()).toEqual([{kind:'INSERT',n:1},{kind:'UPDATE',n:1}]);
 }));
 it('rejects stale physical context and all partial writes atomically',async()=>isolated(async()=>{
  const first=await fixture('delta-context-first');await pg.exec((await delta(first)).sql);
  const next=await fixture('delta-context-next'),packet=await delta(next);
  await pg.exec('UPDATE "Job" SET "visibleInFrontend"=false');
  await rejects(packet.sql,/PILOT_CONTEXT_CHANGED/);
  expect((await pg.query('SELECT count(*)::int n FROM "CrawlBatchSourceResult" WHERE id=$1',[next.source.pending.id])).rows[0].n).toBe(0);
  expect((await pg.query('SELECT count(*)::int n FROM "CrawlObservation"')).rows[0].n).toBe(1);
 }));
});
