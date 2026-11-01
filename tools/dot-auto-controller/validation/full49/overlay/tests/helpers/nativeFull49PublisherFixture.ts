/** Synthetic live fixture for the REAL compiler. No connection or writes on import.
 * Materialize beside nativeFull49Db.ts in vendor/c60-source/tests/helpers.
 * Set JOBFINDER_CLOUD_SOURCE_ID=source-hansoh-social BEFORE importing this module.
 * Public HTTP alone is replaced. DB, archive verification, admission and SQL gates remain real.
 */
import {createHash,randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {NativeFull49Db} from './nativeFull49Db';
import {prepareDbStartedCloudPublicationReplay} from '../../src/db/ingestionRepository';
import {CLOUD_PILOT_SOURCE,compileCloudPilotCandidateSql,compileCloudPilotPublicationContextSql,type CloudPilotPublicationContext} from '../../src/db/cloudPilotSqlControl';
import {CLOUD_PILOT_SQL45} from '../../src/db/cloudPilotSql45Manifest';
import {JOB_DELTA_MIGRATION_NAME} from '../../src/db/jobProjectionDeltaProfile';
import {deriveCurrentStagedScheduleExpectation} from '../../src/crawler/stagedScheduleAuthority';
import {buildPendingRuntimeBatch,bindRuntimeEvidenceArtifactIds} from '../../src/crawler/runtimeAtomicEvidence';
import {hashCanonicalStringSet} from '../../src/crawler/runtimeBatchIdentity';
import {runSourceCrawl,createSourceFetchAttemptTracker} from '../../src/crawler/runSourceCrawl';
import {archiveSourceEvidence} from '../../src/crawler/artifactArchive';
import {SOURCE_QUALITY_POLICY_ID,createOwnedSourceQualityFetch,issueSourceQualityAdmission} from '../../src/crawler/sourceQualityAdmission';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const TARGET='dot-cloud-native-d02f4f5-20261011';
const COMMIT='d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f';
const MANIFEST49='91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a';
let generating=false;
const seeded=new WeakMap<NativeFull49Db,{build:{schemaVersion:2;commitSha:string;sourceTreeSha256:string;runtimeTreeSha256:string;contentSha256:string};snapshot:string}>();
async function insert(db:NativeFull49Db,table:'ReleaseCandidate'|'Company'|'RecruitmentSource',row:Record<string,unknown>){
 const keys=Object.keys(row);if(keys.some(k=>!/^[_A-Za-z][_A-Za-z0-9]*$/.test(k)))throw Error('FIXTURE_COLUMN');
 const cols=keys.map(k=>'"'+k+'"').join(',');
 await db.query(`INSERT INTO public."${table}" (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::public."${table}",$1::jsonb)`,[JSON.stringify(row)]);
}
export async function createNativeFull49PublisherFixture(db:NativeFull49Db){
 if(!(db instanceof NativeFull49Db))throw Error('NATIVE_ADAPTER_REQUIRED');db.assertReplayDone();
 if(CLOUD_PILOT_SOURCE.id!=='source-hansoh-social')throw Error('SET_CANONICAL_SOURCE_BEFORE_IMPORT');
 if(generating)throw Error('NO_CONCURRENT_SYNTHETIC_HTTP_OVERRIDE');generating=true;
 const originalFetch=globalThis.fetch;
 try{
  const runId=randomUUID(),root=join(db.outputRoot,'live-publisher-'+runId);await mkdir(root,{mode:0o700});
  const base={schemaVersion:2 as const,commitSha:COMMIT,sourceTreeSha256:digest('synthetic-full49-source:'+runId),runtimeTreeSha256:digest('synthetic-full49-runtime:'+runId)};
  // Synthetic identity obeys field/hash rules; never claims this is a deployed build.
  const previous=seeded.get(db);
  const build=previous?.build??{...base,contentSha256:digest(JSON.stringify(base))};
  const snapshot=previous?.snapshot??digest('synthetic-full49-db:'+runId);
  const candidate={id:TARGET,goalId:'jobfinder-portable-required-40' as const,version:75};
  const common={projectId:'yiopvxysxrtrnvqxwgbx',build,candidate,databaseIdentity:{migrationVersion:JOB_DELTA_MIGRATION_NAME,schemaHash:MANIFEST49,dbSnapshotHash:snapshot}};
  const expected=deriveCurrentStagedScheduleExpectation(build),plan=expected.plans.find(p=>p.source.id===CLOUD_PILOT_SOURCE.id);
  if(!plan||expected.plans.length!==41)throw Error('CANONICAL_PLAN_REQUIRED');
  const identity={releaseCandidateId:TARGET,commitSha:expected.commitSha,rosterSha256:expected.rosterSha256,sourcePlanSha256:expected.sourcePlanSha256,sourceConfigSha256:expected.sourceConfigSha256,adapterBundleSha256:expected.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:CLOUD_PILOT_SOURCE.ownerId,expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([plan.source.id])};
  // Repeated captures retain the same live seeded candidate/build after a baseline commit.
  if(!previous){
  // Exact historical provenance row required by the unmodified candidate compiler.
  await insert(db,'ReleaseCandidate',{...CLOUD_PILOT_SQL45.currentCandidate,rosterHash:'0'.repeat(64),sourcePlanHash:'0'.repeat(64),sourceConfigHash:'0'.repeat(64),adapterBundleHash:'0'.repeat(64),sourceTreeHash:'0'.repeat(64),runtimeTreeHash:'0'.repeat(64),oracleVersion:'historical'});
  await insert(db,'Company',{id:plan.company.id,officialChineseName:plan.company.officialChineseName,officialWebsiteUrl:plan.source.officialEntryUrl,pinyinName:'synthetic',inclusionReason:'synthetic native full49 test only',updatedAt:new Date()});
  await insert(db,'RecruitmentSource',{id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl,updatedAt:new Date()});
  await db.execute(compileCloudPilotCandidateSql({...common,expiresAt:new Date(Date.now()+60_000).toISOString()}),'real-compiler-synthetic-v75-candidate');
  seeded.set(db,{build,snapshot});
  }
  const expectedCandidate=(await db.query<{candidate:Record<string,unknown>}>('SELECT to_jsonb(r) AS candidate FROM public."ReleaseCandidate" r WHERE id=$1',[TARGET])).rows[0]?.candidate;
  if(!expectedCandidate||Object.keys(expectedCandidate).length!==19||expectedCandidate.status!=='BUILDING'||expectedCandidate.version!==75||expectedCandidate.commitSha!==COMMIT)throw Error('EXACT19_SYNTHETIC_CANDIDATE_REQUIRED');
  await writeFile(join(root,'expected-candidate.json'),JSON.stringify(expectedCandidate,null,2)+'\n',{flag:'wx',mode:0o600});
  const startedAt=new Date(),batchId='full49-native-'+runId;
  const httpLog:Array<{url:string;method:string;responseSha256:string}>=[];
  const syntheticPostDate=new Date(startedAt.getTime()-86_400_000).toISOString().replace(/\.\d{3}Z$/,'');
  const body=JSON.stringify({Code:200,Count:1,Data:[{Id:'00000000-0000-4000-8000-000000000001',JobAdId:1,JobAdName:'Synthetic native full49 role '+runId,LocNames:['上海市'],Category:'社会招聘',CategoryId:'1',Kind:'全职',Status:1,PostDate:syntheticPostDate,ChangeDate:'0001-01-01T00:00:00'}]});
  const allowedHosts=new Set(['hspharm.zhiye.com']);
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
   const u=new URL(url);if(u.protocol!=='https:'||!allowedHosts.has(u.hostname))throw Error('UNEXPECTED_SYNTHETIC_HTTP_TARGET:'+u.hostname);
   httpLog.push({url,method:init?.method??'GET',responseSha256:digest(body)});
   // Do not invoke originalFetch under any condition.
   return {status:200,url,headers:new Headers({'content-type':'application/json'}),text:async()=>body} as Response;
  }) as typeof fetch;
  const attemptTracker=createSourceFetchAttemptTracker();
  const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false,attemptTracker});
  if(!result.truth.transportSuccess||!result.truth.adapterSuccess||!result.truth.completenessVerified||result.jobs.length!==1||!result.fetchEvidence)throw Error('SYNTHETIC_ACQUISITION_NOT_CERTIFIED');
  const planned=buildPendingRuntimeBatch(batchId,[plan],identity,startedAt),pending=planned.sources[0];if(!pending)throw Error('PENDING_SOURCE_REQUIRED');
  const tuple={releaseCandidateId:TARGET,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
  const archive=await archiveSourceEvidence({workspaceRoot:root,...tuple,evidenceSubdirectory:'evidence',captureTool:result.fetchEvidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence.artifacts})});
  const admission=await issueSourceQualityAdmission({plan,result,binding:{...tuple,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},archive:{workspaceRoot:root,evidenceSubdirectory:'evidence',artifacts:archive.artifacts}});
  if(admission.status!=='ACCEPTED')throw Error('REAL_ADMISSION_REJECTED:'+JSON.stringify(admission));
  // Current context is read from this same native DB AFTER all seed writes.
  const ctx=(await db.query<{context:CloudPilotPublicationContext}>(compileCloudPilotPublicationContextSql(common,SOURCE_QUALITY_POLICY_ID))).rows[0]?.context;
  if(!ctx||ctx.candidateRow.id!==TARGET)throw Error('CURRENT_NATIVE_CONTEXT_REQUIRED');
  const input={workspaceRoot:root,initialCertificate:admission.receipt,control:{...common,planned,context:ctx},source:{plan,pending,identity,batchId,result,artifacts:archive.artifacts,attemptTracker,publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1' as const,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission},jobProjectionDelta:true as const};
  const replay=await prepareDbStartedCloudPublicationReplay(input);
  const packet=await replay.recompile(); // same live objects, full-byte equality, same UUID tape
  if(Date.now()>=Date.parse(packet.expiresAt))throw Error('PUBLISHER_ALREADY_EXPIRED');
  const wrappedSql='BEGIN ISOLATION LEVEL READ COMMITTED;\n'+packet.sql+'\nCOMMIT;\n';
  await writeFile(join(root,'publisher.compiler.sql'),packet.sql,{flag:'wx',mode:0o600});
  await writeFile(join(root,'publisher.transaction.sql'),wrappedSql,{flag:'wx',mode:0o600});
  await writeFile(join(root,'publisher-manifest.json'),JSON.stringify({synthetic:true,syntheticBuildIdentity:true,productionQualified:false,dbName:db.database,runId,candidate,build,expectedCandidateSha256:digest(JSON.stringify(expectedCandidate,null,2)+'\n'),schema49:MANIFEST49,publisherCompilerSha256:digest(packet.sql),publisherTransactionSha256:digest(wrappedSql),holderId:packet.holderId,expiresAt:packet.expiresAt,batchId,sourceResultId:pending.id,httpLog,admissionStatus:admission.status,fullRecompileByteMatched:true,publisherDispatched:false},null,2)+'\n',{flag:'wx',mode:0o600});
  // Keep the real admission and tracker alive; do not substitute saved JSON later.
  return {root,packet,wrappedSql,expectedCandidate,recompile:replay.recompile,liveInput:input};
 }finally{globalThis.fetch=originalFetch;generating=false;}
}
