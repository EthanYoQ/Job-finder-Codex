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
import {runCloudPortableSourcePilot} from '../../scripts/p0-cloud-portable-source-pilot';

vi.mock('../../src/readiness/buildIdentity',()=>({resolveCurrentBuildIdentity:()=>build}));
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const base={schemaVersion:2 as const,commitSha:'a'.repeat(40),sourceTreeSha256:'b'.repeat(64),runtimeTreeSha256:'c'.repeat(64)};
const build={...base,contentSha256:digest(JSON.stringify(base))};
const candidate={id:'synthetic-portable-db-started',goalId:'jobfinder-portable-required-40',version:10};
const common={projectId:'yiopvxysxrtrnvqxwgbx',build,candidate};
const expected=deriveCurrentStagedScheduleExpectation(build),plan=expected.plans.find(p=>p.source.id==='source-hansoh-social')!;
const identity={releaseCandidateId:candidate.id,commitSha:expected.commitSha,rosterSha256:expected.rosterSha256,sourcePlanSha256:expected.sourcePlanSha256,sourceConfigSha256:expected.sourceConfigSha256,adapterBundleSha256:expected.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:'dot-cloud-hansoh-social-pilot',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([plan.source.id])};
const modulePath=process.env.PGLITE_MODULE,dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('uses the original portable acquisition finish cutoff, never the receipt issuance time',()=>{
 const startedAt=new Date('2026-10-04T00:00:00Z'),finishedAt='2026-10-04T00:01:00Z';
 expect(deriveDbStartedPublicationExpiry({startedAt,completenessCertificate:{schemaVersion:'plan-bound-source-quality-v1',acquisition:{finishedAt},issuedAt:'2026-10-04T00:20:00Z'}})).toBe(Date.parse(finishedAt)+30*60_000);
 expect(()=>deriveDbStartedPublicationExpiry({startedAt,completenessCertificate:{schemaVersion:'plan-bound-source-quality-v1'}})).toThrow('PILOT_EVIDENCE_EXPIRY_INVALID');
});

describe.skipIf(!modulePath)('portable DB-started publication in local PostgreSQL',()=>{
 let pg:any;
 async function insert(table:string,row:Record<string,unknown>){const cols=Object.keys(row).map(k=>'"'+k+'"').join(',');await pg.query(`INSERT INTO "${table}" (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::"${table}",$1::jsonb)`,[JSON.stringify(row)]);}
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
  await pg.exec(compileCloudPilotCandidateSql({...common,expiresAt:new Date(Date.now()+60_000).toISOString()}));
 },30_000);
 afterAll(async()=>{await pg?.close();});
 async function isolated(work:()=>Promise<void>){await pg.exec('BEGIN');try{await work();}finally{await pg.exec('ROLLBACK');}}
 async function context():Promise<CloudPilotPublicationContext>{return (await pg.query(compileCloudPilotPublicationContextSql(common,SOURCE_QUALITY_POLICY_ID))).rows[0].context;}
 function mockHttp(){vi.stubGlobal('fetch',vi.fn(async(url:string)=>({status:200,url:String(url),headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify({Code:200,Count:1,Data:[{Id:'00000000-0000-4000-8000-000000000001',JobAdId:1,JobAdName:'职位1',LocNames:['上海市'],Category:'社会招聘',CategoryId:'1',Kind:'全职',Status:1,PostDate:'2026-09-20T12:00:00',ChangeDate:'0001-01-01T00:00:00'}]})})));}
 async function fixture(batchId:string,ageMs=20*60_000){
  const realNow=Date.now(),startedAt=new Date(realNow-ageMs);vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(startedAt);mockHttp();
  const attemptTracker=createSourceFetchAttemptTracker(),result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false,attemptTracker});
  const planned=buildPendingRuntimeBatch(batchId,[plan],identity,startedAt),pending=planned.sources[0]!;
  const tuple={releaseCandidateId:candidate.id,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
  const workspaceRoot=await mkdtemp(join(tmpdir(),'portable-db-started-'));dirs.push(workspaceRoot);
  const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:'evidence',captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
  const admission=await issueSourceQualityAdmission({plan,result,binding:{...tuple,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},archive:{workspaceRoot,evidenceSubdirectory:'evidence',artifacts:archive.artifacts}});
  if(admission.status!=='ACCEPTED')throw Error(JSON.stringify(admission));
  vi.setSystemTime(realNow);
  return {workspaceRoot,initialCertificate:admission.receipt,control:{...common,planned,context:await context()},source:{plan,pending,identity,batchId,result,artifacts:archive.artifacts,attemptTracker,publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1' as const,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission}};
 }
 async function noPublication(){for(const table of ['CrawlBatch','CrawlBatchSourceResult','Job','EvidenceArtifact','PaginationEvidence','CrawlObservation','LifecycleSetEvidenceMember'])expect((await pg.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n).toBe(0);}
 async function rejects(sql:string,re:RegExp){await pg.exec('SAVEPOINT rejected');await expect(pg.exec(sql)).rejects.toThrow(re);await pg.exec('ROLLBACK TO SAVEPOINT rejected');}
 it('commits the original gradeless receipt after a 20-minute review and releases ownership atomically',async()=>isolated(async()=>{
  const f=await fixture('portable-delayed'),packet=await compileDbStartedCloudSourcePublication(f);
  expect(packet.expiresAt).toBe(new Date(Date.parse(f.initialCertificate.acquisition.finishedAt)+30*60_000).toISOString());
  expect(packet.sql.match(/DO \$atomic_/g)).toHaveLength(1);
  await pg.exec(packet.sql);await pg.exec('SET CONSTRAINTS ALL IMMEDIATE');
  expect((await pg.query('SELECT "completenessCertificate" FROM "CrawlBatchSourceResult"')).rows[0].completenessCertificate).toEqual(JSON.parse(JSON.stringify(f.initialCertificate)));
  expect((await pg.query('SELECT status,"atomicCommittedCount","completenessVerifiedCount" FROM "CrawlBatch"')).rows).toEqual([{status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1}]);
  expect((await pg.query('SELECT count(*)::int n FROM "Job"')).rows[0].n).toBe(1);
  expect((await pg.query('SELECT "holderId" FROM "CrawlCoordinatorLock"')).rows).toEqual([{holderId:''}]);
  const latest=await context();expect(latest.latestAccepted!.id).toBe(f.source.pending.id);expect(latest.firstAccepted!.id).toBe(f.source.pending.id);
  await rejects(packet.sql,/PILOT_CONTEXT_CHANGED|PILOT_REQUEST_ALREADY_APPLIED/);
 }));
 it.each(['source','config','receipt-clone','receipt-hash','raw','output','expired'] as const)('refuses %s changes before producing a publication',async mode=>isolated(async()=>{
  const f=await fixture('portable-refuse-'+mode);
  if(mode==='source')f.control.context.sourceId='source-hengrui-social';
  if(mode==='config')f.control.context.sourceConfigSha256='0'.repeat(64);
  if(mode==='receipt-clone')f.source.sourceQualityAdmission=structuredClone(f.source.sourceQualityAdmission);
  if(mode==='receipt-hash')f.source.sourceQualityAdmission={...f.source.sourceQualityAdmission,receiptSha256:'0'.repeat(64)};
  if(mode==='raw')f.source.result.fetchEvidence!.artifacts[0]!.body='changed';
  if(mode==='output')f.source.result.jobs[0]!.officialTitle='changed';
  if(mode==='expired')vi.setSystemTime(Date.parse(f.initialCertificate.acquisition.finishedAt)+30*60_000);
  await expect(compileDbStartedCloudSourcePublication(f)).rejects.toThrow();await noPublication();
 }));
 it('preserves portable baseline lineage and rejects a competing stale context',async()=>isolated(async()=>{
  const first=await fixture('portable-first');await pg.exec((await compileDbStartedCloudSourcePublication(first)).sql);
  const second=await fixture('portable-second',15*60_000),pending=await fixture('portable-competing',14*60_000);
  const winner=await compileDbStartedCloudSourcePublication(second),stale=await compileDbStartedCloudSourcePublication(pending);
  expect(winner.commit.sourceResult.baselinePreviousSourceResultId).toBe(first.source.pending.id);
  expect(winner.commit.sourceResult.baselinePreviousJobCount).toBe(1);
  await pg.exec(winner.sql);await rejects(stale.sql,/PILOT_CONTEXT_CHANGED/);
  const current=await context();expect(current.firstAccepted!.id).toBe(first.source.pending.id);expect(current.latestAccepted!.id).toBe(second.source.pending.id);
  expect((await pg.query('SELECT count(*)::int n FROM "CrawlBatch"')).rows[0].n).toBe(2);
  expect((await pg.query('SELECT "holderId" FROM "CrawlCoordinatorLock"')).rows).toEqual([{holderId:''}]);
 }));
 it.each(['live-owner','expired-proof','context-drift'] as const)('rolls back all writes and ownership on %s at DB entry',async mode=>isolated(async()=>{
  const f=await fixture('portable-sql-'+mode),packet=await compileDbStartedCloudSourcePublication(f);
  if(mode==='live-owner')await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "holderId"='other-owner',"heartbeatAt"=clock_timestamp()`);
  if(mode==='context-drift')await pg.exec(`UPDATE "RecruitmentSource" SET status='TEMP_UNSCRAPABLE'`);
  const before=(await pg.query('SELECT to_jsonb(l) row FROM "CrawlCoordinatorLock" l')).rows;
  const sql=mode==='expired-proof'?packet.sql.replaceAll(packet.expiresAt,new Date(Date.now()-1000).toISOString()):packet.sql;
  await rejects(sql,mode==='live-owner'?/CRAWL_LEASE_BUSY/:mode==='context-drift'?/PILOT_SOURCE_CONFIG_DRIFT/:/PILOT_REQUEST_EXPIRED/);
  await noPublication();expect((await pg.query('SELECT to_jsonb(l) row FROM "CrawlCoordinatorLock" l')).rows).toEqual(before);
 }));
 it('uses only read context, one PUBLISH and read outcome in the fresh portable runner',async()=>isolated(async()=>{
  const now=Date.now(),captureAt=now-20*60_000;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(captureAt);mockHttp();
  const workspaceRoot=await mkdtemp(join(tmpdir(),'portable-runner-db-started-'));dirs.push(workspaceRoot);
  const candidateRows=(await pg.query('SELECT * FROM "ReleaseCandidate" WHERE id=$1',[candidate.id])).rows;
  const bootstrapPath=join(workspaceRoot,'bootstrap.json'),controlPath=join(workspaceRoot,'control.json'),bytes=JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows,batchId:'portable-runner'});
  await writeFile(bootstrapPath,bytes);await writeFile(controlPath,JSON.stringify(common));const calls:string[]=[];
  vi.spyOn(FilePilotRelay.prototype,'request').mockImplementation(async(kind,_payload,_deadline,parse)=>{calls.push(kind);expect(kind).toBe('READ_CONTEXT');const c=await context();return parse({...c,checkedAt:new Date().toISOString()});});
  vi.spyOn(FilePilotRelay.prototype,'sql').mockImplementation(async(kind,sql,deadline)=>{
   calls.push(kind);
   if(kind==='READ_PUBLICATION_CONTEXT'){
    expect(deadline).toBe(captureAt+30*60_000-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs);
    expect((await pg.query('SELECT "holderId" FROM "CrawlCoordinatorLock"')).rows).toEqual([{holderId:''}]);
    vi.setSystemTime(now);return (await pg.query(sql)).rows;
   }
   if(kind==='PUBLISH'){await pg.exec(sql);return [];}
   if(kind==='READ_OUTCOME')return (await pg.query(sql)).rows;
   throw Error('UNEXPECTED_PRE_ACQUIRED_LEASE');
  });
  const report=await runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:sha256(bytes),workspaceRoot,relayDirectory:join(workspaceRoot,'relay'),dbStartedControlPath:controlPath});
  expect(report).toMatchObject({state:'COMMITTED_EXACT',publicationMode:'DB_STARTED_OWNER_V1',batchFinalizationRequired:false,jobCount:1});
  expect(calls).toEqual(['READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME']);
 }));
});
