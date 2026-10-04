// @vitest-environment node
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
import {createOfficialJsonSourceFetch} from '../../src/crawler/officialJsonSourceFetch';
import {runSourceCrawl} from '../../src/crawler/runSourceCrawl';
import {archiveSourceEvidence} from '../../src/crawler/artifactArchive';
import {runDbStartedCloudPublication} from '../../src/crawler/cloudDbStartedPilot';
import {FilePilotRelay,PilotSqlFailure,PILOT_BUDGET} from '../../src/crawler/cloudSourcePilotRelay';
import {issueAGradeOfficialTotalCertificate} from '../../src/crawler/completenessCertificate';
import {assertAdapterReconciliation} from '../../src/crawler/adapters/reconciliation';
import type {BGradeTraversalCertificate} from '../../src/crawler/traversalCertificate';

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const base={schemaVersion:2 as const,commitSha:'a'.repeat(40),sourceTreeSha256:'b'.repeat(64),runtimeTreeSha256:'c'.repeat(64)};
const build={...base,contentSha256:digest(JSON.stringify(base))};
const candidate={id:'synthetic-db-started-candidate',goalId:'jobfinder-portable-required-40',version:10};
const common={projectId:'yiopvxysxrtrnvqxwgbx',build,candidate};
const expected=deriveCurrentStagedScheduleExpectation(build),plan=expected.plans.find(p=>p.source.id==='source-cttq-social')!;
const identity={releaseCandidateId:candidate.id,commitSha:expected.commitSha,rosterSha256:expected.rosterSha256,sourcePlanSha256:expected.sourcePlanSha256,sourceConfigSha256:expected.sourceConfigSha256,adapterBundleSha256:expected.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:'dot-cloud-cttq-social-pilot',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([plan.source.id])};
const modulePath=process.env.PGLITE_MODULE;
const dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('bounds CURRENT_RUN B waiting by its original one-hour observation limit as well as capture and declared expiry',()=>{
 const now=Date.now(),certificate={schemaVersion:'b-grade-independent-traversal-v2',independentValidation:{observedAt:new Date(now-55*60_000).toISOString(),expiresAt:new Date(now+7*86400_000).toISOString()},validationPolicy:{execution:'CURRENT_RUN'}};
 const expiry=deriveDbStartedPublicationExpiry({startedAt:new Date(now),completenessCertificate:certificate});
 expect(expiry).toBe(now+5*60_000);expect(now+20*60_000).toBeGreaterThan(expiry);
 certificate.independentValidation.expiresAt=new Date(now+60_000).toISOString();
 expect(deriveDbStartedPublicationExpiry({startedAt:new Date(now),completenessCertificate:certificate})).toBe(now+60_000);
});

describe.skipIf(!modulePath)('DB-started publication, actual local PostgreSQL single-session semantics',()=>{
 let pg:any;
 beforeAll(async()=>{
  const {PGlite}=await import(/* @vite-ignore */ pathToFileURL(resolve(modulePath!)).href);
  const {pgcrypto}=await import(/* @vite-ignore */ pathToFileURL(resolve(modulePath!,'../contrib/pgcrypto.js')).href);
  pg=await PGlite.create({extensions:{pgcrypto}});
  for(const m of CLOUD_PILOT_SQL45.migrations)if(m.migrationName!=='20260927120000_p0_launch_cohort_41_companies')await pg.exec(await readFile('prisma/migrations/'+m.migrationName+'/migration.sql','utf8'));
  await pg.exec('CREATE TABLE "_prisma_migrations" (id text,migration_name text,checksum text,finished_at timestamptz,rolled_back_at timestamptz)');
  for(const m of CLOUD_PILOT_SQL45.migrations)await pg.query('INSERT INTO "_prisma_migrations" VALUES($1,$1,$2,clock_timestamp(),null)',[m.migrationName,m.checksum]);
  await insert('ReleaseCandidate',{...CLOUD_PILOT_SQL45.currentCandidate,rosterHash:'0'.repeat(64),sourcePlanHash:'0'.repeat(64),sourceConfigHash:'0'.repeat(64),adapterBundleHash:'0'.repeat(64),sourceTreeHash:'0'.repeat(64),runtimeTreeHash:'0'.repeat(64),oracleVersion:'historical'});
  await insert('Company',{id:plan.company.id,officialChineseName:plan.company.officialChineseName,officialWebsiteUrl:plan.source.officialEntryUrl,pinyinName:'synthetic',inclusionReason:'synthetic only',updatedAt:new Date()});
  await insert('RecruitmentSource',{id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,updatedAt:new Date()});
  await pg.exec(compileCloudPilotCandidateSql({...common,expiresAt:new Date(Date.now()+60000).toISOString()}));
 },30000);
 afterAll(async()=>{await pg?.close();});
 async function insert(table:string,row:Record<string,unknown>){const cols=Object.keys(row).map(k=>'"'+k+'"').join(',');await pg.query(`INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`,[JSON.stringify(row)]);}
 async function isolated(work:()=>Promise<void>){await pg.exec('BEGIN');try{await work();}finally{await pg.exec('ROLLBACK');}}
 async function context():Promise<CloudPilotPublicationContext>{return (await pg.query(compileCloudPilotPublicationContextSql(common))).rows[0].context;}
 async function fixture(batchId:string,ageMs=20*60_000,snapshot?:CloudPilotPublicationContext){
  const capturedAt=new Date(Date.now()-ageMs).toISOString(),startedAt=new Date(capturedAt);
  const row={Id:'996c5ddb-d458-46fb-8c20-51a866aab785',JobAdName:'灌装工(J12634)',Category:'社会招聘',CategoryId:'1',Kind:'全职',Status:1,LocNames:['上海市·闵行区'],Duty:'生产操作',Require:'大专学历',PostDate:'2020-01-02T11:04:07',PostDateInt:1577934247000};
  const fetched=await createOfficialJsonSourceFetch({now:()=>startedAt,allowBrowserFallback:false,http:async request=>({status:200,finalUrl:request.url,contentType:'application/json',capturedAt,body:JSON.stringify(request.url.includes('GetJobAdInfo')?{Code:200,Data:row}:{Code:200,Count:1,Data:[{...row,PostDate:'0001-01-01T00:00:00',PostDateInt:0}]})})})(plan);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
  expect(result.truth.transportSuccess&&result.truth.adapterSuccess&&result.truth.completenessVerified).toBe(true);
  const planned=buildPendingRuntimeBatch(batchId,[plan],identity,startedAt),pending=planned.sources[0]!;
  const tuple={releaseCandidateId:candidate.id,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
  const workspaceRoot=await mkdtemp(join(tmpdir(),'db-started-cttq-'));dirs.push(workspaceRoot);
  const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:'evidence',captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
  const certificate=issueAGradeOfficialTotalCertificate({plan,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:assertAdapterReconciliation(result),jobs:result.jobs,binding:{...tuple,sourceConfigSha256:pending.sourceConfigHash},officialArtifactSha256:archive.artifacts.find(a=>a.logicalKey===result.fetchEvidence!.declaredCompleteness?.artifactLogicalKey)?.sha256});
  if(certificate.status!=='CERTIFIED')throw Error('FIXTURE_CERTIFICATE_REJECTED');
  return {initialCertificate:certificate.certificate,control:{...common,planned,context:snapshot??await context()},source:{plan,pending,identity,batchId,result,artifacts:archive.artifacts,completedAt:new Date(startedAt.getTime()+1000),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1' as const}};
 }
 async function prepare(batchId:string,ageMs=20*60_000,snapshot?:CloudPilotPublicationContext){
  const input=await fixture(batchId,ageMs,snapshot),preparedAt=input.source.completedAt.getTime();
  // Model preparation in the past, then execute against real current DB time.
  // No time elapses artificially inside PostgreSQL and no lease is pre-acquired.
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(preparedAt);
  try{return await compileDbStartedCloudSourcePublication({...input,control:{...input.control,context:{...input.control.context,checkedAt:new Date(preparedAt).toISOString()}}});}
  finally{vi.useRealTimers();}
 }
 async function rejects(sql:string,re:RegExp){await pg.exec('SAVEPOINT rejected');await expect(pg.exec(sql)).rejects.toThrow(re);await pg.exec('ROLLBACK TO SAVEPOINT rejected');}
 async function lock(){return (await pg.query('SELECT to_jsonb(l) AS row FROM "CrawlCoordinatorLock" l')).rows;}
 async function noPublication(){
  for(const table of ['CrawlBatch','CrawlBatchSourceResult','EvidenceArtifact','PaginationEvidence','CrawlObservation','LifecycleSetEvidenceMember'])expect((await pg.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n).toBe(0);
 }
 async function oldJob(id='retained-job'){
  await insert('Job',{id,companyId:plan.company.id,sourceId:plan.source.id,sourceJobId:id,dedupeKey:id,officialTitle:'Retained job',officialUrl:'https://cttq.zhiye.com/social/detail?jobAdId='+id,locationRaw:'上海市',city:'上海市',cities:['上海市'],category:'其他',firstSeenAt:'2025-01-01T00:00:00Z',lastSeenAt:'2025-01-01T00:00:00Z',missingSuccessCount:0,lifecycleStatus:'ACTIVE'});
 }
 it('publishes a genuine A certificate with capture/preparation 20 minutes before DB acquisition, then releases in the same transaction',async()=>isolated(async()=>{
  const packet=await prepare('delayed-valid');
  expect(packet.sql).toContain('source_result_data jsonb :=');
  expect(packet.expiresAt).toBe(new Date(packet.commit.sourceResult.startedAt.getTime()+30*60_000).toISOString());
  await pg.exec(packet.sql);
  await pg.exec('SET CONSTRAINTS ALL IMMEDIATE');
  expect((await pg.query('SELECT "completenessCertificate" FROM "CrawlBatchSourceResult"')).rows[0].completenessCertificate).toEqual(JSON.parse(JSON.stringify(packet.commit.sourceResult.completenessCertificate)));
  expect((await pg.query('SELECT "atomicCommitState", "completenessCertificate"->>\'grade\' AS grade FROM "CrawlBatchSourceResult"')).rows).toEqual([{atomicCommitState:'COMMITTED',grade:'A'}]);
  expect((await pg.query('SELECT status FROM "CrawlBatch"')).rows).toEqual([{status:'SUCCESS'}]);
  expect((await pg.query('SELECT count(*)::int n FROM "Job"')).rows[0].n).toBe(1);
  expect((await pg.query('SELECT "holderId",metadata FROM "CrawlCoordinatorLock"')).rows).toEqual([{holderId:'',metadata:'portable-quality-sync-v1:released'}]);
  await rejects(packet.sql,/PILOT_CONTEXT_CHANGED|PILOT_REQUEST_ALREADY_APPLIED/);
  expect((await pg.query('SELECT count(*)::int n FROM "Job"')).rows[0].n).toBe(1);
 }));
 it.each(['acknowledged','unknown','queued-20-minutes'] as const)('uses the opt-in relay path with %s result, no pre-acquired lease, and exactly one publication',async mode=>isolated(async()=>{
  const f=await fixture('relay-'+mode),dir=await mkdtemp(join(tmpdir(),'db-started-control-'));dirs.push(dir);
  const controlPath=join(dir,'control.json');await writeFile(controlPath,JSON.stringify(common));
  const relay=new FilePilotRelay('unused'),calls:string[]=[];
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(f.source.completedAt);
  const spy=vi.spyOn(relay,'sql').mockImplementation(async(kind,sql,deadline)=>{
   calls.push(kind);
   if(kind==='READ_PUBLICATION_CONTEXT'){
    expect(deadline).toBe(f.source.pending.startedAt.getTime()+30*60_000-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs);
    if(mode==='queued-20-minutes')vi.setSystemTime(f.source.completedAt.getTime()+20*60_000);
    expect(Date.now()+PILOT_BUDGET.controlCompletionMs).toBeLessThan(deadline);
    const rows=(await pg.query(sql)).rows;
    if(mode!=='queued-20-minutes')rows[0].context.checkedAt=new Date().toISOString();
    return rows;
   }
   if(kind==='PUBLISH'){
    expect((await pg.query('SELECT "holderId" FROM "CrawlCoordinatorLock"')).rows[0].holderId).toBe('');
    await pg.exec(sql);
    if(mode==='unknown'){vi.setSystemTime(f.source.pending.startedAt.getTime()+30*60_000+1);throw new PilotSqlFailure('UNKNOWN','CONNECTION_LOST');}
    return [];
   }
   if(kind==='READ_OUTCOME')return (await pg.query(sql)).rows;
   throw Error('UNEXPECTED_LEASE_OR_CONTROL_REQUEST');
  });
  try{
   const result=await runDbStartedCloudPublication({relay,controlPath,planned:f.control.planned,source:f.source,initialCertificate:f.initialCertificate});
   expect(result).toMatchObject({state:'COMMITTED_EXACT',publishAcknowledged:mode!=='unknown',batchFinalizationRequired:false,publicationMode:'DB_STARTED_OWNER_V1'});
   expect(calls).toEqual(['READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME']);
   expect((await pg.query('SELECT "holderId" FROM "CrawlCoordinatorLock"')).rows[0].holderId).toBe('');
 }finally{spy.mockRestore();vi.useRealTimers();}
 }));
 it.each(['stale-response','pre-request-response','expired-proof','exhausted-before-read','insufficient-read-reserve'] as const)('does not publish with %s while waiting for pre-lock context',async mode=>isolated(async()=>{
  const f=await fixture('read-refusal-'+mode),dir=await mkdtemp(join(tmpdir(),'db-started-control-'));dirs.push(dir);
  const controlPath=join(dir,'control.json');await writeFile(controlPath,JSON.stringify(common));
  const relay=new FilePilotRelay('unused'),calls:string[]=[],originalNow=f.source.completedAt.getTime();
  const proofExpiry=f.source.pending.startedAt.getTime()+30*60_000;
  const contextDeadline=proofExpiry-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs;
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(mode==='exhausted-before-read'?proofExpiry:mode==='insufficient-read-reserve'?contextDeadline-PILOT_BUDGET.controlCompletionMs:originalNow);
  const spy=vi.spyOn(relay,'sql').mockImplementation(async(kind,sql)=>{
   calls.push(kind);if(kind!=='READ_PUBLICATION_CONTEXT')throw Error('UNEXPECTED_PUBLICATION');
   const rows=(await pg.query(sql)).rows;
   vi.setSystemTime(mode==='expired-proof'?proofExpiry:originalNow+20*60_000);
   rows[0].context.checkedAt=new Date(mode==='pre-request-response'?originalNow-1001:mode==='stale-response'?Date.now()-PILOT_BUDGET.controlMs-1001:Date.now()).toISOString();
   return rows;
  });
  try{
   await expect(runDbStartedCloudPublication({relay,controlPath,planned:f.control.planned,source:f.source,initialCertificate:f.initialCertificate})).rejects.toThrow(mode==='stale-response'||mode==='pre-request-response'?'PILOT_CONTEXT_FRESH_READ_REQUIRED':'PILOT_PUBLICATION_BUDGET_EXHAUSTED');
   expect(calls).toEqual(mode==='exhausted-before-read'||mode==='insufficient-read-reserve'?[]:['READ_PUBLICATION_CONTEXT']);
   await noPublication();
  }finally{spy.mockRestore();vi.useRealTimers();}
 }));
 it.each(['observation','declared-expiry'] as const)('uses the original B %s cutoff for the pre-lock read budget',async bound=>isolated(async()=>{
  const f=await fixture('b-read-budget-'+bound),dir=await mkdtemp(join(tmpdir(),'db-started-control-'));dirs.push(dir);
  const controlPath=join(dir,'control.json');await writeFile(controlPath,JSON.stringify(common));
  const now=f.source.completedAt.getTime(),expectedExpiry=now+5*60_000;
  // Deadline arithmetic only: this synthetic certificate never reaches the
  // compiler and cannot authorize a B publication for the A-grade fixture.
  const initialCertificate={schemaVersion:'b-grade-independent-traversal-v2',independentValidation:{observedAt:new Date(now-55*60_000).toISOString(),expiresAt:new Date(bound==='observation'?now+7*86400_000:now+4*60_000).toISOString()},validationPolicy:{execution:'CURRENT_RUN'}} as BGradeTraversalCertificate;
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);
  const relay=new FilePilotRelay('unused'),spy=vi.spyOn(relay,'sql').mockImplementation(async(kind,_sql,deadline)=>{
   expect(kind).toBe('READ_PUBLICATION_CONTEXT');
   expect(deadline).toBe((bound==='observation'?expectedExpiry:now+4*60_000)-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs);
   throw new PilotSqlFailure('NOT_DISPATCHED','TEST_READ_STOP');
  });
  try{
   await expect(runDbStartedCloudPublication({relay,controlPath,planned:f.control.planned,source:f.source,initialCertificate})).rejects.toThrow('TEST_READ_STOP');
   expect(spy).toHaveBeenCalledTimes(1);await noPublication();
  }finally{spy.mockRestore();vi.useRealTimers();}
 }));
 it('rejects original capture that expired while the prepared packet waited, before ownership or publication',async()=>isolated(async()=>{
  const packet=await prepare('expired-wait',31*60_000),before=await lock();
  await rejects(packet.sql,/PILOT_REQUEST_EXPIRED/);
  await noPublication();expect(await lock()).toEqual(before);
 }));
 it('rejects original timestamps ahead of the database clock even if the preparing clock accepted them',async()=>isolated(async()=>{
  const packet=await prepare('future-original',-60_000),before=await lock();
  await rejects(packet.sql,/PILOT_ORIGINAL_TIMES_AHEAD/);await noPublication();expect(await lock()).toEqual(before);
 }));
 it('requires READ COMMITTED instead of relying on a stale transaction snapshot',async()=>isolated(async()=>{
  await pg.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const packet=await prepare('wrong-isolation'),before=await lock();
  await rejects(packet.sql,/PILOT_READ_COMMITTED_REQUIRED/);await noPublication();expect(await lock()).toEqual(before);
 }));
 it('stores actual finalization time as UTC even when the connection starts in another timezone',async()=>isolated(async()=>{
  await pg.exec("SET LOCAL TIME ZONE 'Asia/Shanghai'");
  const packet=await prepare('timezone-safe');await pg.exec(packet.sql);
  const age=(await pg.query(`SELECT abs(extract(epoch FROM ((clock_timestamp() AT TIME ZONE 'UTC')-"finishedAt")))::float AS age FROM "CrawlBatch"`)).rows[0].age;
  expect(age).toBeLessThan(3);
 }));
 it('rejects already-noncanonical source status at preparation, even if it would compare equal later',async()=>isolated(async()=>{
  await pg.exec(`UPDATE "RecruitmentSource" SET status='TEMP_UNSCRAPABLE'`);
  await expect(prepare('noncanonical-source')).rejects.toThrow(/PILOT_SOURCE_CONFIG_DRIFT/);await noPublication();
 }));
 it.each(['live-other','expired-same'] as const)('rejects %s ownership rather than reviving or overriding it',async mode=>isolated(async()=>{
  const packet=await prepare('owner-refusal');
  await pg.query('UPDATE "CrawlCoordinatorLock" SET "holderId"=$1,"heartbeatAt"=clock_timestamp()-($2::int * interval \'1 second\')',[mode==='expired-same'?packet.holderId:'another-live-owner',mode==='expired-same'?301:0]);
  const before=await lock();
  await rejects(packet.sql,mode==='expired-same'?/PILOT_REQUEST_OWNER_REUSED/:/CRAWL_LEASE_BUSY/);
  await noPublication();expect(await lock()).toEqual(before);
 }));
 it('may take an expired different owner only as a new holder, with final release',async()=>isolated(async()=>{
  const packet=await prepare('expired-different-owner');
  await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "holderId"='expired-previous-owner',"heartbeatAt"=clock_timestamp()-interval '301 seconds'`);
  await pg.exec(packet.sql);
  expect((await pg.query('SELECT "holderId" FROM "CrawlCoordinatorLock"')).rows[0].holderId).toBe('');
  expect((await pg.query('SELECT status FROM "CrawlBatch"')).rows[0].status).toBe('SUCCESS');
 }));
 it.each(['job-change','job-add','job-remove','source-config','company-config','candidate'] as const)('rejects %s drift and preserves the actual last-good rows',async mode=>isolated(async()=>{
  await oldJob();const packet=await prepare('context-refusal');
  if(mode==='job-change')await pg.exec(`UPDATE "Job" SET "officialTitle"='A later edit'`);
  if(mode==='job-add')await oldJob('later-added-job');
  if(mode==='job-remove')await pg.exec('DELETE FROM "Job"');
  if(mode==='source-config')await pg.exec(`UPDATE "RecruitmentSource" SET status='TEMP_UNSCRAPABLE'`);
  if(mode==='company-config')await pg.exec(`UPDATE "Company" SET "officialChineseName"='Changed company'`);
  if(mode==='candidate')await pg.query(`UPDATE "ReleaseCandidate" SET status='INVALIDATED' WHERE id=$1`,[candidate.id]);
  const jobs=(await pg.query('SELECT to_jsonb(j) AS row FROM "Job" j ORDER BY id')).rows,before=await lock();
  await rejects(packet.sql,/PILOT_CONTEXT_CHANGED|PILOT_CANDIDATE_DRIFT|PILOT_SOURCE_CONFIG_DRIFT/);
  await noPublication();expect(await lock()).toEqual(before);
  expect((await pg.query('SELECT to_jsonb(j) AS row FROM "Job" j ORDER BY id')).rows).toEqual(jobs);
 }));
 it('refuses a competing prepared request when a null baseline becomes committed',async()=>isolated(async()=>{
  const snapshot=await context(),first=await prepare('first-request',20*60_000,snapshot),second=await prepare('second-request',20*60_000,snapshot);
  expect(snapshot.firstAccepted).toBeNull();expect(snapshot.latestAccepted).toBeNull();
  await pg.exec(first.sql);
  await rejects(second.sql,/PILOT_CONTEXT_CHANGED/);
  expect((await pg.query('SELECT id FROM "CrawlBatch" ORDER BY id')).rows).toEqual([{id:'first-request'}]);
  expect((await pg.query('SELECT "holderId" FROM "CrawlCoordinatorLock"')).rows[0].holderId).toBe('');
 }));
 it('refuses a changed latest baseline while the first baseline remains the same',async()=>isolated(async()=>{
  await pg.exec((await prepare('baseline-first',25*60_000)).sql);
  const snapshot=await context(),pending=await prepare('baseline-pending',20*60_000,snapshot),winner=await prepare('baseline-winner',19*60_000,snapshot);
  await pg.exec(winner.sql);
  const current=await context();expect(current.firstAccepted!.id).toBe(snapshot.firstAccepted!.id);expect(current.latestAccepted!.id).not.toBe(snapshot.latestAccepted!.id);
  await rejects(pending.sql,/PILOT_CONTEXT_CHANGED/);
  expect((await pg.query('SELECT id FROM "CrawlBatch" ORDER BY id')).rows).toEqual([{id:'baseline-first'},{id:'baseline-winner'}]);
  const wrongFirst=await prepare('wrong-first-baseline',10*60_000,{...current,firstAccepted:current.latestAccepted});
  await rejects(wrongFirst.sql,/PILOT_CONTEXT_CHANGED/);
 }));
 it.each(['lifecycle','release'] as const)('rolls back the entire publication and new ownership if %s fails',async mode=>isolated(async()=>{
  const packet=await prepare('atomic-rollback'),before=await lock();
  if(mode==='lifecycle')await pg.exec(`CREATE FUNCTION synthetic_fail_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_LIFECYCLE_FAILURE'; END $$;
   CREATE TRIGGER synthetic_fail_lifecycle BEFORE INSERT ON "LifecycleSetEvidenceMember" FOR EACH ROW EXECUTE FUNCTION synthetic_fail_lifecycle();`);
  else await pg.exec(`CREATE FUNCTION synthetic_skip_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."holderId"='' AND OLD."holderId"<>'' THEN RETURN NULL; END IF; RETURN NEW; END $$;
   CREATE TRIGGER synthetic_skip_release BEFORE UPDATE ON "CrawlCoordinatorLock" FOR EACH ROW EXECUTE FUNCTION synthetic_skip_release();`);
  await rejects(packet.sql,mode==='lifecycle'?/SYNTHETIC_LIFECYCLE_FAILURE/:/CRAWL_LEASE_LOST/);
  await noPublication();expect(await lock()).toEqual(before);
  expect((await pg.query('SELECT count(*)::int n FROM "Job"')).rows[0].n).toBe(0);
 }));
});
