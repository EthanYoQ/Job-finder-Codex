/** Review-only orchestration. Cannot dispatch PUBLISH or resolve/release UNKNOWN.
 * Genuine acquisition remains disabled until a separately qualified host wires
 * this source. Offline tests inject HTTP at the process boundary, not here.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {captureBiogenNative,BIOGEN_SOURCE_ID,BIOGEN_CONFIG_SHA256} from './biogen-native-capture.mts';
import {compilerForBiogen} from './biogen-compiler.mts';
import {reviewBiogenPacket} from './biogen-packet-gate.mts';
import {replayBiogenReaders} from './biogen-reader-gate.mts';
import {projectBiogenApi} from './biogen-api-gate.mts';
import {withinDeadline} from '../src/deadline.mjs';
import {sha} from '../src/journal.mjs';
import {deriveDbStartedPublicationExpiry} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
/** A qualified host must provide original source-scoped fresh read contexts.
 * The packet gate additionally requires an existing fixed supervisor authority.
 * Transport is deliberately restricted to prepare: there is no dispatch port.
 * This function is not registered with any production launcher or scheduler.
 */
export async function prepareBiogenNativeReview(input:any){
 if(input.mode!=='OFFLINE_REVIEW_ONLY')throw Error('BIOGEN_REVIEW_ONLY_NO_ACTIVATION');
 const {route,runDir,outerDeadline,beforePublic}=input;
 if(route.sourceId!==BIOGEN_SOURCE_ID||route.sourceConfigSha256!==BIOGEN_CONFIG_SHA256||route.route!=='PORTABLE')throw Error('BIOGEN_FIXED_SOURCE_REQUIRED');
 if(typeof input.prepare!=='function'||typeof input.readPublicationBefore!=='function'||typeof input.relay?.request!=='function')throw Error('BIOGEN_NATIVE_PREPARATION_PORTS_REQUIRED');
 const {control}=await withinDeadline(()=>compilerForBiogen(route),outerDeadline);
 const artifacts=path.join(runDir,'artifacts'),out=path.join(runDir,'review');
 const capture=await withinDeadline(()=>captureBiogenNative({bootstrapPath:path.join(runDir,'bootstrap.json'),reviewedSha256:sha(fs.readFileSync(path.join(runDir,'bootstrap.json'))),workspaceRoot:artifacts,relayDirectory:path.join(runDir,'relay'),dbStartedControlPath:path.join(route.hostReference,'control-base.json'),overallDeadline:outerDeadline,relay:input.relay,signal:input.signal}),outerDeadline);
 const publicationBefore=await withinDeadline(()=>input.readPublicationBefore(),outerDeadline);
 const evidenceExpiry=deriveDbStartedPublicationExpiry({startedAt:capture.source.pending.startedAt,completenessCertificate:capture.initialCertificate});
 const expiresAt=Math.min(evidenceExpiry,outerDeadline-2*PILOT_BUDGET.controlMs);
 const batchId=capture.source.batchId;
 const prepared=await input.prepare('PUBLISH',{source:capture.source,control:{...control,planned:capture.planned,context:publicationBefore.publicationContext},publicationDeadline:expiresAt,jobProjectionDelta:true},{projectId:route.projectId,sourceId:BIOGEN_SOURCE_ID,sourceConfigSha256:BIOGEN_CONFIG_SHA256,candidateId:route.candidate.id,batchId,sourceResultId:capture.source.pending.id,overallDeadline:outerDeadline,expiresAt,dispatchBefore:expiresAt-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs});
 const request=prepared.request;if(!/^[a-f0-9-]{36}$/.test(request.requestId))throw Error('BIOGEN_REQUEST_ID_REQUIRED');
 const file=path.join(runDir,'relay',request.requestId+'.request.json');fs.writeFileSync(file,JSON.stringify(request),{flag:'wx',mode:0o600});fs.writeFileSync(file+'.sql',request.payload.sql,{flag:'wx',mode:0o600});
 const packet=await withinDeadline(()=>reviewBiogenPacket(runDir,request.requestId,path.join(out,'packet-review.json'),{originalOuterDeadline:outerDeadline}),outerDeadline);
 const readers=await withinDeadline(()=>replayBiogenReaders({run:runDir,outputDirectory:out,before:publicationBefore,packet}),outerDeadline);
 assert.deepEqual(readers.main,readers.fallback,'COMPLETE_DUAL_READER_ALL_FIELDS');
 const api=await withinDeadline(()=>projectBiogenApi(beforePublic,out,batchId),outerDeadline);
 return {status:'OFFLINE_BIOGEN_REVIEW_PREPARED_NOT_PUBLISHED',activation:false,dispatchAuthorized:false,capture,request,packet,readers,api,originalEvidenceExpiry:evidenceExpiry};
}
