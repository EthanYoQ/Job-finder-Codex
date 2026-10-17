import {loadCatalog} from '../src/hengrui-catalog.mjs';
import {loadDeployment,assertDeploymentBinding,deploymentBindingSha256} from '../src/hengrui-deployment.mjs';
/** Original PORTABLE native vertical slice, run only by fixed supervisor.
 * All source/SQL/reader operations are programmatic; no plugin tool is hidden.
 * This deployment candidate is inert until an independently reviewed secure
 * setup supplies the fixed activation, authority and restricted pg connection.
 */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRestrictedTransport} from '../transport/restricted-transport.mjs';
import {createFileJournal} from '../transport/file-journal.mjs';
import {createPgConnectionFactory} from '../transport/pg-connection.mjs';
import {compilerForHengrui} from './hengrui-compiler.mts';
import {captureHengruiNative} from './hengrui-native-capture.mts';
import {reviewHengruiPacket} from './hengrui-packet-gate.mts';
import {replayHengruiReaders} from './hengrui-reader-gate.mts';
import {projectHengruiApi} from './hengrui-api-gate.mts';
import {currentPublicRound} from './hengrui-current-public.mjs';
import {Journal,canonical,sha} from '../src/journal.mjs';
import {requireAuthority} from '../src/hengrui-authority.mjs';
import {dueFromObservation,equal} from '../src/gates.mjs';
import {withinDeadline} from '../src/deadline.mjs';
import {deriveDbStartedPublicationExpiry,inspectPersistedAtomicCommitOutcome} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {PILOT_BUDGET,reviveUtcFields} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {requireDbStartedOuterDeadline} from '../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts';
const ROOT=path.resolve(import.meta.dirname,'..');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p:string,v:any)=>{const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(v,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const fields=['id','goalId','status','version','commitSha','rosterHash','schemaHash','oracleVersion','dbSnapshotHash','sourcePlanHash','sourceTreeHash','runtimeTreeHash','migrationVersion','sourceConfigHash','adapterBundleHash','minimumStableCompanyCount'];
export async function runNativeHengruiCycle({controlPlane,startupToken}:any){
 const deployment=loadDeployment(),route=loadCatalog().sources.hengrui;
 const authority=requireAuthority(deployment,route),journal=new Journal(authority.directory+'/controller');
 if(route.enabled!==true)throw Error('HENGRUI_ROUTE_DISABLED');
 const batchId=process.env.JOBFINDER_AUTO_BATCH_ID;if(!batchId||!/^auto-hengrui-[a-f0-9-]{36}$/.test(batchId))throw Error('SUPERVISOR_BATCH_REQUIRED');
 const run=journal.get(batchId,'00-run'),claim=journal.get(batchId,'01-source-claim');if(!run||run.deploymentBindingSha256!==deploymentBindingSha256()||claim?.sourceId!==route.sourceId)throw Error('SUPERVISOR_AUTHORITY_CLAIM_REQUIRED');
 const outerDeadline=Math.min(Number(process.env.P0_PILOT_OUTER_DEADLINE_MS),run.outerDeadline);requireDbStartedOuterDeadline(outerDeadline);
 const startup=controlPlane.accept(startupToken,route.sourceId);
 const runDir=path.join(authority.directory,'hengrui',batchId),artifacts=path.join(runDir,'artifacts'),out=path.join(runDir,'review');
 for(const d of [artifacts,out,runDir+'/relay'])fs.mkdirSync(d,{recursive:false,mode:0o700});
 const {compiler,control}=await compilerForHengrui(route);
 const pg=await import(pathToFileURL(route.producer+'/node_modules/pg/lib/index.js').href);
 const openConnection=createPgConnectionFactory({Client:pg.default.Client,config:deployment.pg,passwordProvider:async()=>{const v=process.env.JOBFINDER_PG_PASSWORD;if(!v)throw Error('SECURE_SECRET_NOT_PROVISIONED');return v;}});
 const transport=createRestrictedTransport({compiler,journal:controlPlane.wrapJournal(await createFileJournal(authority.directory+'/transport',{expectedAuthorityId:authority.identity.authorityId})),openConnection,activated:true});
 const binding=(expires:number)=>({projectId:route.projectId,sourceId:route.sourceId,sourceConfigSha256:route.sourceConfigSha256,candidateId:route.candidate.id,batchId,sourceResultId:batchId+'--'+route.sourceId,overallDeadline:outerDeadline,expiresAt:expires,dispatchBefore:expires-25000});
 const assertScope=()=>{assertDeploymentBinding();equal(loadDeployment(),deployment,'DEPLOYMENT_CHANGED');equal(loadCatalog().sources.hengrui,route,'ROUTE_CHANGED');requireAuthority(deployment,route);if(Date.now()>=outerDeadline)throw Error('OUTER_DEADLINE');return true;};
 const query=async(kind:string,input:any,expires=Math.min(outerDeadline,Date.now()+PILOT_BUDGET.controlMs))=>{const p=await transport.prepare(kind,input,binding(expires));const r:any=await transport.dispatch(p.ticket,{assertScope});if(r.status!=='SUCCEEDED')throw Error(kind+':'+r.outcome+':'+r.code);return r.rows;};
 const reader=async()=>{const requestedAt=Date.now(),rows=await query('READ_READER_CONTEXT',null);if(rows.length!==1)throw Error('READER_ROW_COUNT');const value=rows[0].reader_before;if(Date.parse(value.checkedAt)<requestedAt-1000||Date.now()-Date.parse(value.checkedAt)>60000)throw Error('READER_NOT_FRESH');return value;};
 const before=await reader();const context=before.publicationContext;
 equal(Object.fromEntries(fields.map(k=>[k,context.candidateRow[k]])),route.registration,'CURRENT_16_FIELD_REGISTRATION');
 if(before.writerInventory.some((w:any)=>w.atomicCommitState==='PENDING'||w.batchKind!=='MANUAL_SOURCE'&&w.finishedAt===null))throw Error('UNFINISHED_DATABASE_WRITER');
 const old=read(deployment.originalPublisherStateFile);if(old.active||old.pendingReadOnlyTerminalSources?.length)throw Error('ORIGINAL_PUBLISHER_OR_UNKNOWN_REMAINS');
 const latest=context.latestAccepted,observation=latest?.observations?.[0];if(latest?.observations?.length!==1||observation.sourceId!==route.sourceId||observation.sourceResultId!==latest.id||observation.successful!==true||observation.atomicCommitSucceeded!==true)throw Error('REAL_ACCEPTED_OBSERVATION_REQUIRED');
 const due=dueFromObservation(route,{lastAcceptedObservation:{...observation,observationId:observation.id,basis:'CrawlObservation.crawledAt'}},Date.now());journal.put(batchId,'10-native-preflight',{before,due});if(!due.due){journal.put(batchId,'88-prepared',{status:'PREPARED_NOT_DUE',batchId,nextEligibleAt:due.nextEligibleAt});return;}
 const beforePublic=await currentPublicRound();write(runDir+'/before-public.json',beforePublic);
 const fresh=await reader();equal(Object.fromEntries(fields.map(k=>[k,fresh.publicationContext.candidateRow[k]])),route.registration,'FRESH_BOOTSTRAP_IDENTITY');
 const bootstrap={schemaVersion:1,checkedAt:new Date(fresh.checkedAt).toISOString(),candidateRows:[fresh.publicationContext.candidateRow],batchId};write(runDir+'/bootstrap.json',bootstrap);
 const relay={request:async(kind:string,_payload:any,deadline:number,parse:Function)=>{if(kind!=='READ_CONTEXT')throw Error('UNEXPECTED_NATIVE_CAPTURE_RELAY_KIND');const rows=await query('READ_CONTEXT',{control,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1'},deadline);assert.equal(rows.length,1);return parse({...rows[0].context,checkedAt:new Date(rows[0].context.checkedAt).toISOString()});}};
 const captured=await withinDeadline(()=>captureHengruiNative({bootstrapPath:runDir+'/bootstrap.json',reviewedSha256:sha(fs.readFileSync(runDir+'/bootstrap.json')),workspaceRoot:artifacts,relayDirectory:runDir+'/relay',dbStartedControlPath:route.hostReference+'/control-base.json',overallDeadline:outerDeadline,relay:relay as any,signal:AbortSignal.timeout(Math.max(1,outerDeadline-Date.now()))}),outerDeadline);
 const publicationBefore=await reader();const evidenceExpiry=deriveDbStartedPublicationExpiry({startedAt:captured.source.pending.startedAt,completenessCertificate:captured.initialCertificate});
 const publicationDeadline=Math.min(evidenceExpiry,outerDeadline-2*PILOT_BUDGET.controlMs);
 const p=await transport.prepare('PUBLISH',{source:captured.source,control:{...control,planned:captured.planned,context:publicationBefore.publicationContext},publicationDeadline,jobProjectionDelta:true},{...binding(publicationDeadline),dispatchBefore:publicationDeadline-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs});
 write(runDir+'/relay/'+p.request.requestId+'.request.json',p.request);fs.writeFileSync(runDir+'/relay/'+p.request.requestId+'.request.json.sql',p.request.payload.sql,{flag:'wx',mode:0o600});
 const packet=await reviewHengruiPacket(runDir,p.request.requestId,out+'/packet-review.json',{originalOuterDeadline:outerDeadline,publicationContext:publicationBefore.publicationContext});
 const readerProof=await replayHengruiReaders({run:runDir,outputDirectory:out,before:publicationBefore,packet});assert.deepEqual(readerProof.main,readerProof.fallback,'COMPLETE_DUAL_READER_ALL_FIELDS');
 const api=await projectHengruiApi(beforePublic,out,batchId);
 journal.put(batchId,'30-native-ready',{request:p.request,packetReview:packet.review,readerProof:readerProof.result,apiProof:api.result,expectedApi:api.expected,packet:JSON.parse(JSON.stringify(p.packet)),deadline:publicationDeadline});
 journal.put(batchId,'40-dispatch-intent',{requestId:p.request.requestId,requestSha256:p.request.requestSha256,outcome:'UNKNOWN',retryAuthorized:false});
 controlPlane.markMutationAttempt();
 const response:any=await transport.dispatch(p.ticket,{assertScope,verifyPublicationReady:async()=>{await controlPlane.readerIdentity(deployment.deployedReaderIdentity);const current=await reader();const omit=(x:any)=>Object.fromEntries(Object.entries(x).filter(([k])=>k!=='checkedAt'));equal(omit(current.publicationContext),omit(publicationBefore.publicationContext),'NATIVE_CONTEXT_DRIFT');equal(current.inventory,publicationBefore.inventory,'READER_INVENTORY_DRIFT');assertScope();return true;}});
 journal.put(batchId,'50-transport',{response,responseExpired:Date.now()>=Date.parse(p.request.expiresAt)});
 if(response.status!=='SUCCEEDED'&&response.outcome==='UNKNOWN'&&Date.now()<Date.parse(p.request.expiresAt)){await withinDeadline(()=>new Promise(resolve=>setTimeout(resolve,Date.parse(p.request.expiresAt)-Date.now())),outerDeadline);}
 const rows=await query('READ_OUTCOME',null);if(rows.length!==1)throw Error('EXACT_READBACK_COUNT');
 const persisted=rows[0].row?reviveUtcFields(rows[0].row,['startedAt','finishedAt']):null;
 const outcome=await inspectPersistedAtomicCommitOutcome(p.packet.commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error('NO_UNSCOPED_READ');}}} as any);
 journal.put(batchId,'62-native-db-outcome',{outcome,rows});if(outcome.state!=='COMMITTED_EXACT')throw Error('READONLY_RECONCILIATION_REQUIRED:'+outcome.state);
 const b=rows[0].batch;assert.equal(b.id,batchId);assert.equal(b.status,'SUCCESS');assert.equal(b.atomicCommittedCount,1);assert.equal(b.completenessVerifiedCount,1);assert.notEqual(rows[0].holderId,p.packet.holderId);
 const afterPublic=await currentPublicRound({expected:api.expected});journal.put(batchId,'70-current-public',afterPublic);
 const restored=fs.readFileSync(captured.bundlePath);assert.equal(sha(restored),captured.bundleSha256);assert.equal(restored.length,captured.bundleByteCount);
 journal.put(batchId,'80-recovery',{archiveSha256:captured.bundleSha256,archivePath:captured.bundlePath,manifest:packet.review.archive.files,requestSha256:p.request.requestSha256,sqlSha256:sha(p.request.payload.sql),readerProofSha256:sha(canonical(readerProof)),originalDeadline:outerDeadline});
 // This is NOT completion. The owning supervisor must observe real wrapper and
 // child exit, then reread all records before it can release the source claim.
 journal.put(batchId,'88-prepared',{status:'PREPARED_COMPLETE',batchId,sourceId:route.sourceId,requestSha256:p.request.requestSha256,dbState:outcome.state,publicState:afterPublic.status});
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){try{throw Error('PURE_VERIFIED_BOOTSTRAP_REQUIRED');}catch(error:any){console.error(JSON.stringify({status:'HELD',code:error?.code??error?.message??'NATIVE_WORKER_FAILED',retryAuthorized:false}));process.exitCode=1;}}
