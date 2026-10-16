/** Offline candidate only. No connector, credentials, dispatch, or automatic mode.
 * The returned capability is meaningful only in this module instance. A file,
 * checksum, JSON receipt, or IPC message cannot recreate it in another process.
 */
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {prepareDbStartedCloudPublicationReplay,type DbStartedCloudPublicationInput} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {createBuildIdentity,type BuildIdentityArtifact} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {CLOUD_PILOT_SOURCE} from '../vendor/c60-source/src/db/cloudPilotSqlControl.ts';
import {requireReviewDatabaseProfile,type ReviewDatabaseProfile} from './schema-profile.mts';
import {SOURCE_QUALITY_POLICY_ID,assertIssuedSourceQualityAdmission,issueSourceQualityAdmission} from '../vendor/c60-source/src/crawler/sourceQualityAdmission.ts';
import {makeArchiveBundle,PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {sourcePlanConfigSha256} from '../vendor/c60-source/src/crawler/sourcePlan.ts';
import {assertBiogenSourceDue} from './biogen-due-policy.mts';
import {verifyNodeRuntimeProfile} from '../vendor/c60-source/scripts/verify-node-runtime-profile.ts';
import {REGISTRATION_FIELDS} from '../src/deployment.mjs';

const PROJECT='yiopvxysxrtrnvqxwgbx',SOURCE='source-biogen-china-social';
const CONFIG='47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348';
const OWNER='dot-cloud-biogen-china-social-pilot';
const PRODUCER=resolve(fileURLToPath(new URL('../vendor/c60-source/',import.meta.url)));
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const exact=(a:unknown,b:unknown,code:string)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(code);};
const sameRecord=(a:Record<string,unknown>,b:Record<string,unknown>,code:string)=>{
 if(Object.keys(a).sort().join(',')!==Object.keys(b).sort().join(',')||Object.entries(a).some(([k,v])=>JSON.stringify(v)!==JSON.stringify(b[k])))throw Error(code);
};
const iso=z.string().datetime(),hash=z.string().regex(/^[a-f0-9]{64}$/u);
const requestSchema=z.object({schemaVersion:z.literal(1),requestId:z.string().uuid(),kind:z.literal('PUBLISH'),expiresAt:iso,
 payload:z.object({projectId:z.literal(PROJECT),sql:z.string().min(1),dispatchBefore:iso}).strict(),requestSha256:hash}).strict();
export type ConnectorPublishRequest=z.infer<typeof requestSchema>;
export interface BiogenReviewInput {
 publication:DbStartedCloudPublicationInput;
 scope:{producerRoot:string;build:BuildIdentityArtifact;registration:Record<string,unknown>;databaseProfile?:Extract<ReviewDatabaseProfile,'SCHEMA50'>};
 archive:{originalRoot:string;restoredRoot:string;bundlePath:string;bundleSha256:string;bundleByteCount:number;evidenceSubdirectory:string};
 contextRead:{requestedAt:number;receivedAt:number};
 outerDeadline:number;
}
const capabilities=new WeakMap<object,{request:string;consume:()=>Promise<ConsumedReview>}>();
export interface ConsumedReview {request:ConnectorPublishRequest;dispatchBefore:number;expiresAt:number;outerDeadline:number;buildContentSha256:string;
 tuple:{releaseCandidateId:string;batchId:string;sourceId:string;sourceResultId:string};mode:'OFFLINE_REVIEW_ONLY'}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

/** Performs only local verification. scope/contextRead still need the existing
 * trusted host's provenance checks; this is not pre-import remote attestation.
 * The live host route is intentionally NOT wired in this candidate.
 */
export async function prepareBiogenConnectorPublicationReview(input:BiogenReviewInput){
 // Keep original owned objects. Snapshot all values before the first await;
 // rechecks reject caller mutation, including valid-but-different contexts.
 const original=JSON.stringify(input),publication=input.publication;
 const {source,control}=publication,scope=structuredClone(input.scope),archive=structuredClone(input.archive);
 const contextRead=structuredClone(input.contextRead),outerDeadline=input.outerDeadline;
 const unchanged=()=>{if(JSON.stringify(input)!==original)throw Error('REVIEW_INPUT_CHANGED');};
 const tuple=freeze({releaseCandidateId:control.candidate.id,batchId:source.batchId,sourceId:SOURCE,sourceResultId:source.pending.id});
 const checkScope=()=>{
  unchanged();
  if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==SOURCE||CLOUD_PILOT_SOURCE.id!==SOURCE||CLOUD_PILOT_SOURCE.sourceConfigSha256!==CONFIG||CLOUD_PILOT_SOURCE.ownerId!==OWNER||
    source.plan.source.id!==SOURCE||sourcePlanConfigSha256(source.plan)!==CONFIG||source.pending.sourceId!==SOURCE||source.pending.sourceConfigHash!==CONFIG||source.identity.ownerId!==OWNER||control.projectId!==PROJECT)
   throw Error('REVIEW_EXACT_BIOGEN_SOURCE_REQUIRED');
  if(scope.databaseProfile!==undefined&&scope.databaseProfile!=='SCHEMA50')throw Error('REVIEW_EXACT_50_PROFILE_REQUIRED');
  requireReviewDatabaseProfile(control.databaseIdentity,publication.jobProjectionDelta,'SCHEMA50');
  if(source.sourceAdmissionPolicy!==SOURCE_QUALITY_POLICY_ID||!source.sourceQualityAdmission)throw Error('REVIEW_LIVE_ADMISSION_REQUIRED');
  assertIssuedSourceQualityAdmission(source.sourceQualityAdmission,source.result,source.plan);
  // A reviewed retained capture is a separate workflow. No relabelled saved
  // capture can satisfy this fresh automatic Biogen seam.
  if(source.sourceQualityAdmission.receipt.acquisition.origin!==undefined)throw Error('REVIEW_FRESH_OWNED_HTTP_REQUIRED');
  sameRecord(scope.build as unknown as Record<string,unknown>,control.build as unknown as Record<string,unknown>,'REVIEW_RUNTIME_BUILD_MIXED');
  if(Object.keys(scope.registration).sort().join(',')!==[...REGISTRATION_FIELDS].sort().join(','))throw Error('REVIEW_EXACT_REGISTRATION_16_REQUIRED');
  for(const key of REGISTRATION_FIELDS)if(JSON.stringify(control.context.candidateRow[key])!==JSON.stringify(scope.registration[key]))throw Error('REVIEW_CANDIDATE_REGISTRATION_CHANGED');
  if(source.pending.id!==control.planned.sources[0]?.id||source.batchId!==control.planned.batch.id||source.identity.releaseCandidateId!==control.candidate.id)throw Error('REVIEW_SOURCE_TUPLE_CHANGED');
 };
 const checkTime=()=>{
  const now=Date.now(),checked=Date.parse(control.context.checkedAt),cutoff=publication.publicationDeadline;
  if(!Number.isSafeInteger(outerDeadline)||!Number.isSafeInteger(cutoff)||cutoff!>outerDeadline-2*PILOT_BUDGET.controlMs||
    !Number.isSafeInteger(contextRead.requestedAt)||!Number.isSafeInteger(contextRead.receivedAt)||contextRead.requestedAt>contextRead.receivedAt||contextRead.receivedAt>now+1000||
    !Number.isFinite(checked)||checked<Math.max(contextRead.requestedAt,contextRead.receivedAt-PILOT_BUDGET.controlMs)-1000||checked>contextRead.receivedAt+1000)
   throw Error('REVIEW_FRESH_CONTEXT_REQUIRED');
  const dispatchBefore=cutoff!-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs;
  if(now>=dispatchBefore||now>=outerDeadline||contextRead.receivedAt>=dispatchBefore)throw Error('REVIEW_DEADLINE_EXHAUSTED');
 };
 const checkRuntime=async()=>{
  await verifyNodeRuntimeProfile();
  if(resolve(scope.producerRoot)!==PRODUCER||await realpath(scope.producerRoot)!==PRODUCER)throw Error('REVIEW_RUNTIME_ROOT_MIXED');
  // Reuses original byte-tree algorithm; does not requalify/register this local
  // derivative or claim the unmodified runtime has these bytes.
  exact(createBuildIdentity(PRODUCER,scope.build.commitSha),scope.build,'REVIEW_RUNTIME_BYTES_CHANGED');
 };
 const checkDue=()=>assertBiogenSourceDue(control.context.latestAccepted,source.pending.startedAt.getTime());
 const checkArchive=async()=>{
  if(archive.originalRoot===archive.restoredRoot||resolve(archive.originalRoot)!==await realpath(archive.originalRoot)||resolve(archive.restoredRoot)!==await realpath(archive.restoredRoot))throw Error('REVIEW_DISTINCT_REAL_ARCHIVE_ROOTS_REQUIRED');
  const relativeBundle=relative(archive.originalRoot,archive.bundlePath),stat=await lstat(archive.bundlePath);
  if(!relativeBundle||relativeBundle.startsWith('..')||isAbsolute(relativeBundle)||!stat.isFile()||stat.isSymbolicLink()||await realpath(archive.bundlePath)!==resolve(archive.bundlePath))throw Error('REVIEW_ARCHIVE_BUNDLE_SCOPE');
  const bytes=await readFile(archive.bundlePath);
  if(!hash.safeParse(archive.bundleSha256).success||bytes.length!==archive.bundleByteCount||sha(bytes)!==archive.bundleSha256)throw Error('REVIEW_ARCHIVE_BUNDLE_CHANGED');
  const saved=JSON.parse(bytes.toString('utf8'));
  for(const workspaceRoot of [archive.originalRoot,archive.restoredRoot]){
   const request={workspaceRoot,...tuple,evidenceSubdirectory:archive.evidenceSubdirectory,artifacts:[...source.artifacts]};
   exact(await makeArchiveBundle(request),saved,'REVIEW_ARCHIVE_EXACT_BUNDLE_MISMATCH');
   const admission=await issueSourceQualityAdmission({plan:source.plan,result:source.result,
    binding:{releaseCandidateId:tuple.releaseCandidateId,batchId:tuple.batchId,sourceResultId:tuple.sourceResultId,sourceConfigSha256:source.pending.sourceConfigHash,adapterVersion:source.pending.adapterVersion},
    archive:{workspaceRoot,evidenceSubdirectory:archive.evidenceSubdirectory,artifacts:source.artifacts}});
   if(admission!==source.sourceQualityAdmission)throw Error('REVIEW_OWNED_ARCHIVE_REPLAY_FAILED');
  }
  unchanged();
 };
 checkScope();checkTime();checkDue();await checkRuntime();await checkArchive();checkScope();checkTime();
 const compiler=await prepareDbStartedCloudPublicationReplay(publication),sealed=JSON.stringify(compiler.packet);
 checkScope();checkTime();
 const packet=freeze(structuredClone(compiler.packet));let reviewStarted=false;
 async function verifyAgain(request:ConnectorPublishRequest){
  checkScope();checkTime();await checkRuntime();await checkArchive();
  const regenerated=await compiler.recompile();
  if(JSON.stringify(regenerated)!==sealed||request.payload.sql!==regenerated.sql||request.expiresAt!==regenerated.expiresAt||
    Date.parse(request.payload.dispatchBefore)!==Date.parse(regenerated.expiresAt)-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs)throw Error('REVIEW_FULL_PACKET_MISMATCH');
  checkScope();checkTime();
 }
 return Object.freeze({packet,mode:'OFFLINE_REVIEW_ONLY' as const,async review(value:unknown){
  if(reviewStarted)throw Error('REVIEW_ALREADY_ATTEMPTED');reviewStarted=true;
  const request=requestSchema.parse(value),{requestSha256,...body}=value as ConnectorPublishRequest;
  if(sha(JSON.stringify(body))!==requestSha256)throw Error('REVIEW_REQUEST_HASH');
  const requestBytes=JSON.stringify(request);
  await verifyAgain(request);
  if(JSON.stringify(requestSchema.parse(value))!==requestBytes)throw Error('REVIEW_REQUEST_CHANGED');
  const frozenRequest=freeze(structuredClone(request)),token=Object.freeze({});
  capabilities.set(token,{request:requestBytes,consume:async()=>{await verifyAgain(frozenRequest);return freeze({request:frozenRequest,
    dispatchBefore:Date.parse(frozenRequest.payload.dispatchBefore),expiresAt:Date.parse(frozenRequest.expiresAt),outerDeadline,buildContentSha256:scope.build.contentSha256,tuple,mode:'OFFLINE_REVIEW_ONLY' as const});}});
  return token;
 }});
}

/** Consumed BEFORE asynchronous checks. A failure is not a retry invitation. */
export async function consumeReviewedBiogenPublication(token:object,value:unknown):Promise<ConsumedReview>{
 const owned=capabilities.get(token);if(!owned)throw Error('REVIEW_SAME_PROCESS_CAPABILITY_REQUIRED');
 capabilities.delete(token);
 const request=requestSchema.parse(value);if(JSON.stringify(request)!==owned.request)throw Error('REVIEW_REQUEST_CHANGED');
 return owned.consume();
}
