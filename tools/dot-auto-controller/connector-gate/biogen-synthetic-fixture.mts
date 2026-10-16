/** Synthetic isolated fixtures only. Does not connect to any website/database. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
type BiogenReviewInput = any;
import {readFileSync} from 'node:fs';
import {createBuildIdentity} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION} from '../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts';
import {buildPendingRuntimeBatch,bindRuntimeEvidenceArtifactIds} from '../vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts';
import {hashCanonicalStringSet} from '../vendor/c60-source/src/crawler/runtimeBatchIdentity.ts';
import {runSourceCrawl,createSourceFetchAttemptTracker} from '../vendor/c60-source/src/crawler/runSourceCrawl.ts';
import {archiveSourceEvidence} from '../vendor/c60-source/src/crawler/artifactArchive.ts';
import {makeArchiveBundle,restoreArchiveBundle,PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {createOwnedSourceQualityFetch,issueSourceQualityAdmission,SOURCE_QUALITY_POLICY_ID} from '../vendor/c60-source/src/crawler/sourceQualityAdmission.ts';
import {JOB_DELTA_MIGRATION_NAME} from '../vendor/c60-source/src/db/jobProjectionDeltaProfile.ts';
import {executeIngestionCommands} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {fromPrismaJobCategory} from '../vendor/c60-source/src/db/prismaMappers.ts';
export const digest=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
export const ROOT=resolve('vendor/c60-source'),BASE='d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f',NOW='2026-10-11T10:00:00.000Z',dirs:string[]=[];
let build:ReturnType<typeof createBuildIdentity>;
export function initialize(){build=createBuildIdentity(ROOT,BASE);return build;}
const candidate={id:'synthetic-offline-gate',goalId:'jobfinder-portable-required-40',version:100};
let setClock=(at:string)=>{if(Math.abs(Date.now()-Date.parse(at))>1000)throw Error('TEST_ONLY_REAL_CLOCK_REQUIRED');};
let installFetch=(fn:Function)=>{globalThis.fetch=fn as typeof fetch;};
let phase=(label:string)=>{};
export function configureSyntheticFixtureRuntime(hooks:{setClock:(at:string)=>void;installFetch:(fn:Function)=>void;phase?:(label:string)=>void}){setClock=hooks.setClock;installFetch=hooks.installFetch;phase=hooks.phase??(()=>{});}
export async function fixture({at=NOW,ids=['10001','10002'],prior=null as any,incomplete=false,changedTitle=false,pageSize=1,paddingBytes=0,syntheticBatchId='',syntheticOuterDeadline=0}={}){
 setClock(at);
 const expected=deriveCurrentStagedScheduleExpectation(build),plan=structuredClone(expected.plans.find(p=>p.source.id==='source-biogen-china-social')!);
 const identity={releaseCandidateId:candidate.id,commitSha:expected.commitSha,rosterSha256:expected.rosterSha256,sourcePlanSha256:expected.sourcePlanSha256,sourceConfigSha256:expected.sourceConfigSha256,adapterBundleSha256:expected.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:'dot-cloud-biogen-china-social-pilot',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([plan.source.id])};
 const databaseIdentity={migrationVersion:'20261014141000_v75_retired_candidate_fence',schemaHash:'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7',dbSnapshotHash:'e'.repeat(64)};
 const registration={...candidate,commitSha:build.commitSha,...databaseIdentity,rosterHash:expected.rosterSha256,sourcePlanHash:expected.sourcePlanSha256,sourceConfigHash:expected.sourceConfigSha256,adapterBundleHash:expected.adapterBundleSha256,sourceTreeHash:build.sourceTreeSha256,runtimeTreeHash:build.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:41,status:'BUILDING'};
 let calls=0;
 const body=JSON.parse(readFileSync(resolve('test/fixtures/biogen-synthetic.json'),'utf8'));if(incomplete)body.total++;
 installFetch(async(url:string,request:any)=>{calls++;if(String(url)!=='https://biibhr.wd3.myworkdayjobs.com/wday/cxs/biibhr/external/jobs'||request.method!=='POST')throw Error('BIOGEN_SYNTHETIC_REQUEST');return {status:200,url:String(url),headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify(body)};});
 phase('SYNTHETIC_FETCH_ADAPTER_START');
 const captureStartedAt=new Date();
 const attemptTracker=createSourceFetchAttemptTracker(),result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:prior===null,attemptTracker});
 phase('SYNTHETIC_FETCH_ADAPTER_DONE');
 if(result.status!=='SUCCESS')throw Error('SYNTHETIC_CAPTURE_REJECTED:'+JSON.stringify(result));
 const batchId=syntheticBatchId||'synthetic-'+randomUUID(),planned=buildPendingRuntimeBatch(batchId,[plan],identity,captureStartedAt),pending=planned.sources[0]!;
 const tuple={releaseCandidateId:candidate.id,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
 const originalRoot=await mkdtemp(join(tmpdir(),'biogen-gate-original-'));dirs.push(originalRoot);const evidenceSubdirectory='offline-evidence';
 phase('SYNTHETIC_ARCHIVE_START');
 const stored=await archiveSourceEvidence({workspaceRoot:originalRoot,...tuple,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
 const bundle=await makeArchiveBundle({workspaceRoot:originalRoot,...tuple,evidenceSubdirectory,artifacts:stored.artifacts});
 const bytes=JSON.stringify(bundle,null,2),bundlePath=join(originalRoot,'bundle.json');await writeFile(bundlePath,bytes,{flag:'wx',mode:0o600});
 const restoredRoot=await mkdtemp(join(tmpdir(),'biogen-gate-restored-'));dirs.push(restoredRoot);const artifacts=await restoreArchiveBundle(bundle,restoredRoot);
 phase('SYNTHETIC_RESTORE_DONE_ADMISSION_START');
 const admission=await issueSourceQualityAdmission({plan,result,binding:{releaseCandidateId:candidate.id,batchId,sourceResultId:pending.id,sourceConfigSha256:pending.sourceConfigHash,adapterVersion:pending.adapterVersion},archive:{workspaceRoot:restoredRoot,evidenceSubdirectory,artifacts}});
 phase('SYNTHETIC_ADMISSION_DONE');
 if(admission.status!=='ACCEPTED')throw Error('SYNTHETIC_ADMISSION_REJECTED:'+JSON.stringify(admission));
 const sourceRow={id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl};
 const context={checkedAt:new Date().toISOString(),sourceId:plan.source.id,sourceConfigSha256:pending.sourceConfigHash,jobs:prior?.jobs??[],latestAccepted:prior?.latestAccepted??null,firstAccepted:prior?.firstAccepted??null,candidateRow:registration,sourceRow,companyRow:{id:plan.company.id,officialChineseName:plan.company.officialChineseName}};
 const input:BiogenReviewInput={publication:{control:{projectId:'yiopvxysxrtrnvqxwgbx',build,candidate,databaseIdentity,planned,context},source:{plan,pending,identity,batchId,result,artifacts,attemptTracker,publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission},publicationDeadline:syntheticOuterDeadline?syntheticOuterDeadline-2*PILOT_BUDGET.controlMs:Date.now()+20*60_000,jobProjectionDelta:true},scope:{producerRoot:ROOT,build,registration},archive:{originalRoot,restoredRoot,bundlePath,bundleSha256:digest(bytes),bundleByteCount:Buffer.byteLength(bytes),evidenceSubdirectory},contextRead:{requestedAt:Date.now(),receivedAt:Date.now()},outerDeadline:syntheticOuterDeadline||Date.now()+22*60_000};
 return {input,httpCalls:()=>calls};
}
export function request(packet:any){const body={schemaVersion:1 as const,requestId:randomUUID(),kind:'PUBLISH' as const,expiresAt:packet.expiresAt,payload:{projectId:'yiopvxysxrtrnvqxwgbx' as const,sql:packet.sql,dispatchBefore:new Date(Date.parse(packet.expiresAt)-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs).toISOString()}};return {...body,requestSha256:digest(JSON.stringify(body))};}
export function rehash(r:any){const {requestSha256,...body}=r;r.requestSha256=digest(JSON.stringify(body));return r;}
export async function priorFrom(f:any,packet:any){
 const jobs:any[]=[];
 await executeIngestionCommands(packet.commit.commands.filter((c:any)=>c.type==='UPSERT_JOB'),{batchId:f.input.publication.source.batchId},{
  $transaction:async(fn:any)=>fn({job:{upsert:async(args:any)=>{jobs.push({...args.create,category:fromPrismaJobCategory(args.create.category),source:f.input.publication.control.context.sourceRow,company:f.input.publication.control.context.companyRow});}},crawlObservation:{create:async()=>{throw Error('NOT_REQUESTED');}}})
 } as any);
 const observation=packet.commit.commands.find((c:any)=>c.type==='UPSERT_CRAWL_OBSERVATION').observation;
 const row=JSON.parse(JSON.stringify({...packet.commit.sourceResult,observations:[{...observation,...packet.commit.observationProvenance}]}));
 return {jobs:JSON.parse(JSON.stringify(jobs)),latestAccepted:row,firstAccepted:f.input.publication.control.context.firstAccepted??row};
}
