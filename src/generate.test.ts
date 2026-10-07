// NEW SYNTHETIC DATA ONLY. Never reads an old packet, source artifact, binding or database.
import {it,expect,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {astraMock,amgenMock} from './mock-http';
import {deriveCurrentStagedScheduleExpectation} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/stagedScheduleAuthority';
import {sourcePlanConfigSha256} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/sourcePlan';
import {buildPendingRuntimeBatch,bindRuntimeEvidenceArtifactIds} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/runtimeAtomicEvidence';
import {hashCanonicalStringSet} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/runtimeBatchIdentity';
import {runSourceCrawl,createSourceFetchAttemptTracker} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/runSourceCrawl';
import {createHttpHtmlSourceFetch} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/httpHtmlSourceFetch';
import {acquireAstraZenecaDetails,replayAstraZenecaList} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/astraZenecaDetailAcquisition';
import {createAmgenManualWorkdaySourceFetch} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/amgenManualWorkdaySourceFetch';
import {archiveSourceEvidence} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/artifactArchive';
import {makeArchiveBundle,restoreArchiveBundle} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/cloudSourcePilotRelay';
import {issueAGradeOfficialTotalCertificate} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/crawler/completenessCertificate';
import {createIncrementalPglite} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/tests/helpers/incrementalPglite';
import {CLOUD_PILOT_SQL45} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/db/cloudPilotSql45Manifest';
import {JOB_DELTA_MIGRATION_NAME} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/db/jobProjectionDeltaProfile';
import {compileCloudPilotCandidateSql,compileCloudPilotPublicationContextSql} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/db/cloudPilotSqlControl';
import {compileDbStartedCloudSourcePublication} from '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/db/ingestionRepository';

const randomState=vi.hoisted(()=>({counter:0}));
vi.mock('node:crypto',async original=>{const real=await original<any>();return {...real,randomUUID:()=>{
 const seed='deterministic-true-a-reviewer-v1|'+process.env.JOBFINDER_CLOUD_SOURCE_ID+'|'+randomState.counter++;
 const bytes=real.createHash('sha256').update(seed).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.toString('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}};});
vi.mock('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/src/readiness/buildIdentity',()=>({resolveCurrentBuildIdentity:()=>build}));
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const producer='/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer';
const sourceId=process.env.JOBFINDER_CLOUD_SOURCE_ID!,key=sourceId==='source-astrazeneca-social'?'astra':'amgen';
const T0=Date.parse('2026-10-07T13:45:00.000Z'),T1=T0+11000,T2=T0+30000;
const base={schemaVersion:2 as const,commitSha:createHash('sha1').update('NEW SYNTHETIC BUILD ONLY v1').digest('hex'),sourceTreeSha256:digest('NEW SYNTHETIC SOURCE TREE v1'),runtimeTreeSha256:digest('NEW SYNTHETIC RUNTIME TREE v1')};
const build={...base,contentSha256:digest(JSON.stringify(base))};
const candidate={id:'synthetic-deterministic-true-a-reviewer-v1',goalId:'jobfinder-portable-required-40',version:900001};
const common={projectId:'yiopvxysxrtrnvqxwgbx',build,candidate,databaseIdentity:{migrationVersion:JOB_DELTA_MIGRATION_NAME,schemaHash:digest('NEW SYNTHETIC SCHEMA IDENTITY v1'),dbSnapshotHash:digest('NEW SYNTHETIC DATABASE SNAPSHOT v1')}};
const expectation=deriveCurrentStagedScheduleExpectation(build),plan=expectation.plans.find(p=>p.source.id===sourceId)!;

it('generates new deterministic pure mock A inputs, validates originals and commits only in local memory PostgreSQL',async()=>{
 expect(['source-astrazeneca-social','source-amgen-china-social']).toContain(sourceId);
 expect(process.env.FIXTURE_PAYLOAD_ROOT).toBeTruthy();expect(process.env.FIXTURE_WORK_ROOT).toBeTruthy();expect(process.env.PGLITE_MODULE).toBeTruthy();
 const payload=join(process.env.FIXTURE_PAYLOAD_ROOT!,key),work=join(process.env.FIXTURE_WORK_ROOT!,key);await mkdir(payload,{recursive:false});await mkdir(work,{recursive:false});
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(T2);
 const memory=await createIncrementalPglite({modulePath:process.env.PGLITE_MODULE!,allowTestHashShim:true,producerRoot:producer});const pg=memory.pg;
 try{
  // Verify the WASM database clock itself, rather than assuming JS fake time suffices.
  const clock=(await pg.query<any>('SELECT (extract(epoch from clock_timestamp())*1000)::text AS wall_ms,(extract(epoch from CURRENT_TIMESTAMP)*1000)::text AS transaction_ms')).rows[0];
  expect(Number(clock.wall_ms)).toBe(T2);expect(Number(clock.transaction_ms)).toBe(T2);
  const insert=async(table:string,row:Record<string,unknown>)=>{const columns=Object.keys(row).map(k=>'"'+k+'"').join(',');await pg.query('INSERT INTO "'+table+'" ('+columns+') SELECT '+columns+' FROM jsonb_populate_record(NULL::"'+table+'",$1::jsonb)',[JSON.stringify(row)]);};
  // This code-defined predecessor is required only to exercise original candidate creation locally.
  // It is not read from any connected database and is not exported as a fixture identity.
  await insert('ReleaseCandidate',{...CLOUD_PILOT_SQL45.currentCandidate,rosterHash:'0'.repeat(64),sourcePlanHash:'0'.repeat(64),sourceConfigHash:'0'.repeat(64),adapterBundleHash:'0'.repeat(64),sourceTreeHash:'0'.repeat(64),runtimeTreeHash:'0'.repeat(64),oracleVersion:'synthetic-predecessor'});
  await insert('Company',{id:plan.company.id,officialChineseName:plan.company.officialChineseName,officialWebsiteUrl:plan.source.officialEntryUrl,pinyinName:'synthetic-only',inclusionReason:'NEW DETERMINISTIC SYNTHETIC FIXTURE ONLY',updatedAt:new Date(T2)});
  await insert('RecruitmentSource',{id:sourceId,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,updatedAt:new Date(T2)});
  await pg.exec(compileCloudPilotCandidateSql({...common,expiresAt:new Date(T2+60000).toISOString()}));
  const before=(await pg.query<any>('SELECT count(*)::int AS n FROM "Job"')).rows[0].n;expect(before).toBe(0);
  const attemptTracker=createSourceFetchAttemptTracker();let calls=0;
  vi.setSystemTime(T0);
  const result=await runSourceCrawl(plan,{isBaseline:false,attemptTracker,fetch:async()=>{
   vi.setSystemTime(T1);
   if(key==='astra'){
    const mock=astraMock(2);
    const list=await createHttpHtmlSourceFetch({now:()=>new Date(T0),http:async request=>{calls++;const p=Number(new URL(request.url).searchParams.get('p'));expect(p).toBe(1);return{status:200,body:mock.list(p),finalUrl:request.url,contentType:'text/html; charset=utf-8',capturedAt:new Date(T1).toISOString()};}})(plan);
    replayAstraZenecaList(plan,list.fetchEvidence!,new Date(T1).toISOString(),false);
    vi.stubGlobal('fetch',async(url:string)=>{calls++;const row=mock.rows.find(r=>r.url===String(url));if(!row)throw Error('MOCK_DETAIL_URL_NOT_DECLARED');const response=new Response(mock.detail(row),{status:200,headers:{'content-type':'text/html; charset=utf-8'}});Object.defineProperty(response,'url',{value:String(url)});return response;});
    return acquireAstraZenecaDetails(plan,list);
   }
   const mock=amgenMock(2);return createAmgenManualWorkdaySourceFetch({now:()=>new Date(T0),http:async request=>{calls++;return{...await mock.http(request),capturedAt:new Date(T1).toISOString()};}})(plan);
  }});
  if(!result.truth.completenessVerified)await writeFile(join(work,'failed-synthetic-result.json'),JSON.stringify(result,(_key,v)=>v instanceof Uint8Array?{syntheticBytes:Buffer.from(v).toString('base64')}:v,null,2));
  expect(result.status).toBe('SUCCESS');expect(result.truth.completenessVerified).toBe(true);expect(result.jobs).toHaveLength(2);
  expect(result.jobs.every(j=>j.officialTitle.startsWith('SYNTHETIC FIXTURE ROLE '))).toBe(true);
  const batchId='synthetic-deterministic-'+key+'-v1';
  const identity={releaseCandidateId:candidate.id,commitSha:expectation.commitSha,rosterSha256:expectation.rosterSha256,sourcePlanSha256:expectation.sourcePlanSha256,sourceConfigSha256:expectation.sourceConfigSha256,adapterBundleSha256:expectation.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:`dot-cloud-${sourceId.slice(7)}-pilot`,expectedPlannedSourceIds:[sourceId],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([sourceId])};
  const planned=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(T0)),pending=planned.sources[0]!,tuple={releaseCandidateId:candidate.id,batchId,sourceId,sourceResultId:pending.id};
  const archive=await archiveSourceEvidence({workspaceRoot:work,...tuple,evidenceSubdirectory:'synthetic-fixture',captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
  const certificate=issueAGradeOfficialTotalCertificate({plan,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,binding:{...tuple,sourceConfigSha256:pending.sourceConfigHash},officialArtifactSha256:archive.artifacts.find(a=>a.logicalKey===result.fetchEvidence!.declaredCompleteness?.artifactLogicalKey)?.sha256});
  expect(certificate.status).toBe('CERTIFIED');if(certificate.status!=='CERTIFIED')throw Error('SYNTHETIC_A_ISSUER_REJECTED');
  const bundle=await makeArchiveBundle({workspaceRoot:work,...tuple,evidenceSubdirectory:'synthetic-fixture',artifacts:archive.artifacts});
  const restored=join(work,'restored');await mkdir(restored);const restoredArtifacts=await restoreArchiveBundle(bundle,restored);expect(restoredArtifacts).toHaveLength(archive.artifacts.length);
  vi.setSystemTime(T2);
  const context=(await pg.query<any>(compileCloudPilotPublicationContextSql(common))).rows[0].context;
  randomState.counter=0;
  const packet=await compileDbStartedCloudSourcePublication({control:{...common,planned,context},source:{plan,pending,identity,batchId,result,attemptTracker,artifacts:archive.artifacts,completedAt:new Date(T2),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1'},jobProjectionDelta:true});
  const uuidCount=randomState.counter;
  await pg.exec(packet.sql);await pg.exec('SET CONSTRAINTS ALL IMMEDIATE');
  const terminal=(await pg.query<any>('SELECT "atomicCommitState","completenessState","dedupeOutputCount","completenessCertificate" FROM "CrawlBatchSourceResult" WHERE id=$1',[pending.id])).rows[0];
  expect(terminal.atomicCommitState).toBe('COMMITTED');expect(terminal.completenessState).toBe('VERIFIED');expect(terminal.dedupeOutputCount).toBe(2);
  const physicalJobCount=(await pg.query<any>('SELECT count(*)::int AS n FROM "Job" WHERE "sourceId"=$1',[sourceId])).rows[0].n;expect(physicalJobCount).toBe(2);
  const outer=terminal.completenessCertificate;expect(outer.legacyCertificate.grade).toBe('A');
  if(key==='astra')expect(outer.observedAt).not.toBe(outer.legacyCertificate.observedAt);
  else expect(outer.observedAt).toBe(outer.legacyCertificate.observedAt);
  expect((await pg.query<any>('SELECT "holderId" FROM "CrawlCoordinatorLock" WHERE id=$1',['formal-crawl'])).rows[0].holderId).toBe('');
  const requestId=randomUUID(),body={schemaVersion:1,requestId,kind:'PUBLISH',expiresAt:packet.expiresAt,payload:{projectId:common.projectId,sql:packet.sql,dispatchBefore:new Date(Date.parse(packet.expiresAt)-165000).toISOString()}};
  const request={...body,requestSha256:digest(JSON.stringify(body))};
  const meta={schemaVersion:'deterministic-true-a-reviewer-fixture-v1',classification:'NEW_SYNTHETIC_CODE_AND_SEED_ONLY',sourceKey:key,sourceId,seed:'deterministic-true-a-reviewer-v1',clock:{sourceStartedAt:new Date(T0).toISOString(),officialObservationAt:new Date(T1).toISOString(),compileAndDatabaseAt:new Date(T2).toISOString()},logicalWorkspaceRoot:'synthetic-fixture://true-a-reviewer-v1/'+key,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),syntheticControl:common,requestId,compilerUuidCount:uuidCount,artifacts:bundle.files.length,mockHttpResponseCount:calls,localSqlResult:{atomicCommitState:terminal.atomicCommitState,completenessState:terminal.completenessState,dedupeOutputCount:terminal.dedupeOutputCount,physicalJobCount,lockReleased:true},observations:{outer:outer.observedAt,inner:outer.legacyCertificate.observedAt},schemaContractConstantsAreNotLiveAuthority:true,originalRestrictedPacketRead:false};
  const put=(name:string,value:unknown)=>writeFile(join(payload,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await put('fixture.json',meta);await put('publish-request.json',request);await put('archive.json',bundle);
  await put('generation-verification.json',{classification:meta.classification,sourceKey:key,mockHttpOnly:true,nodeNetworkApisGuarded:true,operatingSystemNetworkIsolationClaimed:false,inMemoryPostgresOnly:true,databaseClockVerified:new Date(T2).toISOString(),archiveBytesAndMetadataRoundtripVerified:true,compiledOriginalSqlExecutedOnlyInMemory:true,localSqlResult:meta.localSqlResult,cryptoMode:memory.cryptoMode,limitations:memory.limitations,appliedMigrations:memory.appliedMigrations});
 }finally{await pg.close();vi.unstubAllGlobals();vi.useRealTimers();}
});
