import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateBiogenSourceDue,assertBiogenSourceDue} from './biogen-due-policy.mts';
import {hashProjectionJson} from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
import {runCloudPortableSourcePilot} from '../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts';
import {prepareBiogenConnectorPublicationReview} from './biogen-publication-review.mts';
const h=vi.hoisted(()=>({pre:{} as any,captures:0,fetchFactories:0,trackers:0,contextLoads:0,preserves:[] as any[],calls:[] as any[],runtimeChecks:0}));
const SOURCE='source-biogen-china-social',CONFIG='47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348',NOW=Date.parse('2026-10-11T10:00:00.000Z');
vi.mock('../vendor/c60-source/src/db/cloudPilotSqlControl',()=>({CLOUD_PILOT_SOURCE:{id:'source-biogen-china-social',sourceConfigSha256:'47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348',ownerId:'dot-cloud-biogen-china-social-pilot'},compileCloudPilotPublicationContextSql:vi.fn()}));
vi.mock('../vendor/c60-source/src/crawler/cloudSourcePilotRelay',()=>({PILOT_BUDGET:{controlMs:60000,publishDbMs:60000,publishTransportMs:60000,controlCompletionMs:25000},FilePilotRelay:class{async request(kind:any,payload:any){h.calls.push({kind,payload});return h.pre;}},sha256:(b:any)=>createHash('sha256').update(b).digest('hex'),acquireCloudPilotLease:vi.fn(),makeArchiveBundle:vi.fn(),restoreArchiveBundle:vi.fn(),reviveUtcFields:vi.fn()}));
vi.mock('../vendor/c60-source/src/crawler/stagedScheduleAuthority',()=>({resolveCurrentStagedScheduleAuthority:async()=>({plans:Array.from({length:41},(_,i)=>({source:{id:i===0?'source-biogen-china-social':'source-'+i}})),identity:{}})}));
vi.mock('../vendor/c60-source/src/release/portableCoveragePolicy',()=>({getPortableCoverageScope:()=>({historicalSourceIds:Array.from({length:41},(_,i)=>i===0?'source-biogen-china-social':'source-'+i),requiredSourceIds:Array.from({length:40},(_,i)=>i===0?'source-biogen-china-social':'source-'+i)})}));
vi.mock('../vendor/c60-source/src/crawler/sourcePlan',()=>({sourcePlanConfigSha256:()=> '47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348'}));
vi.mock('../vendor/c60-source/src/crawler/sourceQualityAdmission',()=>({SOURCE_QUALITY_POLICY_ID:'PLAN_BOUND_SOURCE_QUALITY_V1',getSourceQualityPolicy:()=> 'PLAN_BOUND_SOURCE_QUALITY_V1',createOwnedSourceQualityFetch:()=>{h.fetchFactories++;return ()=>{throw Error('NO_NETWORK');};},issueSourceQualityAdmission:vi.fn(),assertIssuedSourceQualityAdmission:()=>{}}));
vi.mock('../vendor/c60-source/src/crawler/runSourceCrawl',()=>({createSourceFetchAttemptTracker:()=>{h.trackers++;return {};},runSourceCrawl:async()=>{h.captures++;throw Error('SYNTHETIC_CAPTURE_SENTINEL');}}));
vi.mock('../vendor/c60-source/src/crawler/officialHttpRuntimeLimits',()=>({runWithOfficialSourceAttemptTimeout:(fn:any)=>fn(),runWithOfficialSourceCancellation:(_:any,fn:any)=>fn()}));
vi.mock('../vendor/c60-source/scripts/p0-cloud-source-pilot',()=>({PILOT_SOURCE:'source-biogen-china-social',selectedPilotIdentity:(x:any)=>x,loadPilotContext:async()=>{h.contextLoads++;return {baselineCompletedBeforeCrawl:h.pre.latestAccepted!==null};},preservePilotFailure:async(x:any)=>{h.preserves.push(x);},reconcilePilotPublication:vi.fn()}));
vi.mock('../vendor/c60-source/src/db/ingestionRepository',()=>({compilePortableAtomicSourceEvidenceSql:vi.fn(),prepareDbStartedCloudPublicationReplay:vi.fn()}));
vi.mock('../vendor/c60-source/src/readiness/buildIdentity',()=>({createBuildIdentity:()=>{h.runtimeChecks++;throw Error('TEST_RUNTIME_SENTINEL');}}));
vi.mock('../vendor/c60-source/scripts/verify-node-runtime-profile.ts',()=>({verifyNodeRuntimeProfile:async()=>{}}));
const dirs:string[]=[];
function row(at=NOW-12*3600000){
 const observedAt=new Date(at).toISOString(),binding={releaseCandidateId:'synthetic-candidate',batchId:'synthetic-prior',sourceId:SOURCE,sourceResultId:'synthetic-result'};
 const receipt={schemaVersion:'job-projection-delta-receipt-v1',projectionSchemaVersion:'job-persisted-projection-v1',binding,verifiedAt:observedAt,observedAt,legacyCertificate:{},legacyCertificateSha256:'0'.repeat(64),detailEvidenceState:'UNKNOWN',members:[],manifestSha256:hashProjectionJson([])};
 return {id:binding.sourceResultId,batchId:binding.batchId,releaseCandidateId:binding.releaseCandidateId,sourceId:SOURCE,completenessCertificate:receipt,completenessCertificateSha256:hashProjectionJson(receipt),observations:[{...binding,crawledAt:observedAt,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true}]};
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);vi.stubEnv('JOBFINDER_CLOUD_SOURCE_ID',SOURCE);Object.assign(h,{pre:{checkedAt:new Date(NOW).toISOString(),latestAccepted:row()},captures:0,fetchFactories:0,trackers:0,contextLoads:0,preserves:[],calls:[],runtimeChecks:0});});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllEnvs();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function run(owned=true){const dir=await mkdtemp(join(tmpdir(),'biogen-due-'));dirs.push(dir);const bootstrap=JSON.stringify({schemaVersion:1,checkedAt:new Date(NOW).toISOString(),candidateRows:[],batchId:'synthetic-due'}),file=join(dir,'bootstrap.json');await writeFile(file,bootstrap);return runCloudPortableSourcePilot({bootstrapPath:file,reviewedSha256:createHash('sha256').update(bootstrap).digest('hex'),workspaceRoot:dir,relayDirectory:dir,dbStartedControlPath:'synthetic-unused-control',overallDeadline:NOW+1800000,...(owned?{ownedBiogenPipe:{mode:'BIOGEN_OWNED_PIPE_CANDIDATE_V1' as const,launchChallenge:'a'.repeat(64)}}:{})});}
it('returns exact immutable observation and next due from original receipt',()=>{const x=evaluateBiogenSourceDue(row(),NOW);expect(x).toEqual({due:true,observedAt:'2026-10-10T22:00:00.000Z',nextDueAt:'2026-10-11T10:00:00.000Z'});expect(Object.isFrozen(x)).toBe(true);});
it('12h minus 1ms is not due; the predicate exposes data without granting authority',()=>{expect(evaluateBiogenSourceDue(row(NOW-12*3600000+1),NOW)).toEqual({due:false,observedAt:'2026-10-10T22:00:00.001Z',nextDueAt:'2026-10-11T10:00:00.001Z'});expect(()=>assertBiogenSourceDue(row(NOW-12*3600000+1),NOW)).toThrow('REVIEW_SOURCE_NOT_DUE');});
it('null baseline is due',()=>expect(assertBiogenSourceDue(null,NOW)).toEqual({due:true,observedAt:null,nextDueAt:null}));
it('preserves original DB UTC without Z',()=>{const x=row();x.observations[0]!.crawledAt=x.observations[0]!.crawledAt.slice(0,-1);expect(assertBiogenSourceDue(x,NOW).due).toBe(true);});
it('future observation is invalid, never an ordinary not-due skip',()=>expect(()=>assertBiogenSourceDue(row(NOW+1),NOW)).toThrow('REVIEW_LAST_ACCEPTED_OBSERVATION_FUTURE'));
it.each(['missing','duplicate','null','timestamp','success','observationTuple','receiptHash','receiptTuple','receiptObservedAt','missingRow'])('rejects malformed original evidence %s',kind=>{
 const x:any=row();
 if(kind==='missing')delete x.observations;if(kind==='duplicate')x.observations.push({...x.observations[0]});if(kind==='null')x.observations=[null];if(kind==='timestamp')x.observations[0].crawledAt='not-a-date';if(kind==='success')x.observations[0].atomicCommitSucceeded=false;
 if(kind==='observationTuple')x.observations[0].batchId='other';if(kind==='receiptHash')x.completenessCertificateSha256='f'.repeat(64);
 if(kind==='receiptTuple'){x.completenessCertificate.binding.sourceId='other';x.completenessCertificateSha256=hashProjectionJson(x.completenessCertificate);}
 if(kind==='receiptObservedAt'){x.completenessCertificate.observedAt=new Date(NOW-13*3600000).toISOString();x.completenessCertificateSha256=hashProjectionJson(x.completenessCertificate);}
 expect(()=>assertBiogenSourceDue(kind==='missingRow'?undefined:x,NOW)).toThrow();
});
it.each([NaN,Infinity,1.5])('rejects invalid capture time %s',at=>expect(()=>assertBiogenSourceDue(null,at)).toThrow('REVIEW_CAPTURE_START_INVALID'));
it('owned PRE_CAPTURE not due returns normal skip with zero actual crawl/fetch/tracker calls',async()=>{h.pre.latestAccepted=row(NOW-12*3600000+1);await expect(run()).resolves.toMatchObject({state:'SKIPPED_NOT_DUE',batchId:'synthetic-due',sourceId:SOURCE,observedAt:'2026-10-10T22:00:00.001Z',nextDueAt:'2026-10-11T10:00:00.001Z',captureStarted:false});expect(h.contextLoads).toBe(1);expect(h.captures).toBe(0);expect(h.fetchFactories).toBe(0);expect(h.trackers).toBe(0);expect(h.calls).toHaveLength(1);expect(h.calls[0].payload.purpose).toBe('PRE_CAPTURE');});
it.each(['boundary','baseline'])('owned PRE_CAPTURE %s reaches the actual crawl seam exactly once',async mode=>{h.pre.latestAccepted=mode==='baseline'?null:row();await expect(run()).rejects.toThrow('SYNTHETIC_CAPTURE_SENTINEL');expect(h.captures).toBe(1);expect(h.fetchFactories).toBe(1);expect(h.trackers).toBe(1);});
it('old default runner retains its prior not-due behavior',async()=>{h.pre.latestAccepted=row(NOW-1);await expect(run(false)).rejects.toThrow('SYNTHETIC_CAPTURE_SENTINEL');expect(h.captures).toBe(1);});
it.each(['future','missing','receipt'])('owned PRE_CAPTURE rejects %s before capture',async kind=>{h.pre.latestAccepted=row(kind==='future'?NOW+1:NOW-12*3600000);if(kind==='missing')delete h.pre.latestAccepted.observations;if(kind==='receipt')h.pre.latestAccepted.completenessCertificateSha256='f'.repeat(64);await expect(run()).rejects.not.toThrow('SYNTHETIC_CAPTURE_SENTINEL');expect(h.captures).toBe(0);});
it('publication still rechecks changed fresh context after an earlier due PRE_CAPTURE',async()=>{
 expect(assertBiogenSourceDue(row(),NOW).due).toBe(true);
 const {REGISTRATION_FIELDS}=await import('../src/deployment.mjs');const {JOB_DELTA_MIGRATION_NAME}=await import('../vendor/c60-source/src/db/jobProjectionDeltaProfile.ts');
 const registration=Object.fromEntries(REGISTRATION_FIELDS.map(k=>[k,null])),build={};
 const input:any={publication:{control:{projectId:'yiopvxysxrtrnvqxwgbx',candidate:{id:'synthetic-candidate'},build,databaseIdentity:{migrationVersion:'20261014141000_v75_retired_candidate_fence',schemaHash:'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7'},planned:{sources:[{id:'pending'}],batch:{id:'batch'}},context:{candidateRow:registration,checkedAt:new Date(NOW).toISOString(),latestAccepted:row(NOW-1)}},source:{plan:{source:{id:SOURCE}},pending:{id:'pending',sourceId:SOURCE,sourceConfigHash:CONFIG,startedAt:new Date(NOW)},identity:{ownerId:'dot-cloud-biogen-china-social-pilot',releaseCandidateId:'synthetic-candidate'},batchId:'batch',sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:{receipt:{acquisition:{}}}},jobProjectionDelta:true,publicationDeadline:NOW+1200000},scope:{build,registration},archive:{},contextRead:{requestedAt:NOW,receivedAt:NOW},outerDeadline:NOW+1320000};
 await expect(prepareBiogenConnectorPublicationReview(input)).rejects.toThrow('REVIEW_SOURCE_NOT_DUE');expect(h.runtimeChecks).toBe(0);
});
it.each(['not-due','future'])('original CLI maps owned %s to normal zero or invalid nonzero without capture',async kind=>{
 const dir=await mkdtemp(join(tmpdir(),'biogen-due-cli-'));dirs.push(dir);const bootstrap=JSON.stringify({schemaVersion:1,checkedAt:new Date(NOW).toISOString(),candidateRows:[],batchId:'synthetic-due-cli'}),file=join(dir,'bootstrap.json');await writeFile(file,bootstrap);
 h.pre.latestAccepted=row(kind==='future'?NOW+1:NOW-1);
 const script=new URL('../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts',import.meta.url).pathname;
 const argv=process.argv,exit=process.exitCode,int=process.listeners('SIGINT'),term=process.listeners('SIGTERM');const log=vi.spyOn(console,'log').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{
  process.exitCode=undefined;process.argv=[process.execPath,script,file,createHash('sha256').update(bootstrap).digest('hex'),dir,dir,'--db-started-control','synthetic-unused-control'];
  vi.stubEnv('JOBFINDER_BIOGEN_OWNED_PIPE_MODE','BIOGEN_OWNED_PIPE_CANDIDATE_V1');vi.stubEnv('JOBFINDER_BIOGEN_LAUNCH_CHALLENGE','a'.repeat(64));vi.stubEnv('P0_PILOT_OUTER_DEADLINE_MS',String(NOW+1800000));
  vi.resetModules();await import('../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts');
  expect(h.contextLoads).toBe(1);expect(h.captures).toBe(0);expect(h.fetchFactories).toBe(0);expect(h.trackers).toBe(0);
  if(kind==='not-due'){expect(process.exitCode??0).toBe(0);expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({state:'SKIPPED_NOT_DUE',captureStarted:false});expect(error).not.toHaveBeenCalled();}
  else {expect(process.exitCode).toBe(1);expect(log).not.toHaveBeenCalled();expect(error).toHaveBeenCalled();}
 }finally{
  process.argv=argv;process.exitCode=exit;log.mockRestore();error.mockRestore();
  for(const l of process.listeners('SIGINT'))if(!int.includes(l))process.removeListener('SIGINT',l);
  for(const l of process.listeners('SIGTERM'))if(!term.includes(l))process.removeListener('SIGTERM',l);
 }
});

it('mutually exclusive selection fails before reading bootstrap or asking any relay',async()=>{
 await expect(runCloudPortableSourcePilot({bootstrapPath:'does-not-exist',reviewedSha256:'a'.repeat(64),workspaceRoot:'/tmp',relayDirectory:'/tmp',ownedBiogenPipe:{mode:'BIOGEN_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)},ownedTakedaPipe:{mode:'TAKEDA_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)}})).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');
 expect(h.calls).toHaveLength(0);expect(h.captures).toBe(0);
});
