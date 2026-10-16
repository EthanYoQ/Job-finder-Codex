import {verifyOriginalPublishRequest} from '../src/closure.mjs';
import {loadCatalog} from '../src/hengrui-catalog.mjs';
import {loadDeployment,assertDeploymentBinding,deploymentBindingSha256} from '../src/hengrui-deployment.mjs';
/** Read-only recovery never captures, republishes, or resolves a ledger claim.
 * Only a still-owning supervisor can use this fresh proof for completion. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {createRestrictedTransport} from '../transport/restricted-transport.mjs';
import {createFileJournal} from '../transport/file-journal.mjs';
import {createPgConnectionFactory} from '../transport/pg-connection.mjs';
import {compilerForHengrui} from './hengrui-compiler.mts';import {currentPublicRound} from './hengrui-current-public.mjs';import {requireAuthority} from '../src/hengrui-authority.mjs';import {Journal,sha} from '../src/journal.mjs';
import {inspectPersistedAtomicCommitOutcome} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {reviveUtcFields} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
const ROOT=path.resolve(import.meta.dirname,'..'),read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
export async function reconcileHengrui(batchId:string,{controlPlane,startupToken,allowEarlyRead=false}:any){
 if(!/^auto-hengrui-[a-f0-9-]{36}$/.test(batchId))throw Error('ORIGINAL_BATCH_REQUIRED');
 const deployment=loadDeployment(),route=loadCatalog().sources.hengrui,authority=requireAuthority(deployment,route,{reconcile:true}),journal=new Journal(authority.directory+'/controller');
 controlPlane.accept(startupToken,route.sourceId,{reconcile:true});
 const run=journal.get(batchId,'00-run'),ready=journal.get(batchId,'30-native-ready'),intent=journal.get(batchId,'40-dispatch-intent');if(!run||run.deploymentBindingSha256!==deploymentBindingSha256()||!ready||!intent||intent.requestSha256!==ready.request.requestSha256)throw Error('ORIGINAL_UNKNOWN_RECORD_REQUIRED');
 const request=ready.request,requestSha256=verifyOriginalPublishRequest(request);
 if(!allowEarlyRead&&Date.now()<Date.parse(request.expiresAt))return {status:'WAIT_ORIGINAL_PUBLICATION_CUTOFF',batchId,expiresAt:request.expiresAt,retryAuthorized:false};
 assertDeploymentBinding();
 const remote=await controlPlane.readDispatch(request.requestId,requestSha256);if(!remote||remote.original?.requestId!==request.requestId||remote.original?.requestSha256!==requestSha256||remote.original?.batchId!==batchId||remote.original?.sourceId!==route.sourceId||remote.original?.sqlSha256!==sha(request.payload.sql))throw Error('REMOTE_ORIGINAL_INTENT_MISMATCH');
 const {compiler}=await compilerForHengrui(route),pg=await import(pathToFileURL(route.producer+'/node_modules/pg/lib/index.js').href);
 const openConnection=createPgConnectionFactory({Client:pg.default.Client,config:deployment.pg,passwordProvider:async()=>{const s=process.env.JOBFINDER_PG_PASSWORD;if(!s)throw Error('SECURE_SECRET_NOT_PROVISIONED');return s;}});
 // This separate 60s budget authorizes only an independent read. The original
 // expired request, SQL, dispatch claim and deadline are never changed.
 const readDeadline=Date.now()+60000;const binding={projectId:route.projectId,sourceId:route.sourceId,sourceConfigSha256:route.sourceConfigSha256,candidateId:route.candidate.id,batchId,sourceResultId:batchId+'--'+route.sourceId,overallDeadline:readDeadline,expiresAt:readDeadline,dispatchBefore:readDeadline-25000};
 const readOnlyCompiler=async(kind:string,input:any,b:any)=>{if(kind!=='READ_OUTCOME')throw Error('RECOVERY_READ_ONLY');return compiler(kind,input,b);};
 const transport=createRestrictedTransport({compiler:readOnlyCompiler,journal:await createFileJournal(authority.directory+'/transport',{expectedAuthorityId:authority.identity.authorityId}),openConnection,activated:true});
 const ticket=await transport.prepare('READ_OUTCOME',null,binding);const result:any=await transport.dispatch(ticket.ticket,{assertScope:()=>{assertDeploymentBinding();requireAuthority(deployment,route,{reconcile:true});return true;}});
 const key='recovery-'+randomUUID();journal.put(batchId,key,{originalRequestSha256:requestSha256,originalExpiresAt:request.expiresAt,result});
 if(result.status!=='SUCCEEDED'||result.rows.length!==1)return {status:'HELD_READONLY_RECONCILIATION',batchId,retryAuthorized:false};
 const row=result.rows[0],packet=ready.packet;packet.commit.sourceResult=reviveUtcFields(packet.commit.sourceResult,['startedAt','finishedAt']);
 const persisted=row.row?reviveUtcFields(row.row,['startedAt','finishedAt']):null;
 const outcome=await inspectPersistedAtomicCommitOutcome(packet.commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error('UNSCOPED_RECOVERY_FORBIDDEN');}}} as any);
 if(outcome.state!=='COMMITTED_EXACT')return {status:'HELD_READONLY_RECONCILIATION',batchId,databaseState:outcome.state,retryAuthorized:false};
 assert.equal(row.batch.id,batchId);assert.equal(row.batch.status,'SUCCESS');assert.equal(row.batch.atomicCommittedCount,1);assert.equal(row.batch.completenessVerifiedCount,1);assert.notEqual(row.holderId,packet.holderId);
 const publicResult=await currentPublicRound({expected:ready.expectedApi});journal.put(batchId,key+'-public',publicResult);
 return {status:'DB_AND_CURRENT_PUBLIC_RECONCILED',batchId,requestId:request.requestId,requestSha256,proofRecord:key,retryAuthorized:false,releaseEligible:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){try{console.log(JSON.stringify({status:'BLOCKED_PURE_VERIFIED_BOOTSTRAP_REQUIRED'}));}catch(error:any){console.error(JSON.stringify({status:'HELD_READONLY_RECONCILIATION',code:error?.code??error?.message,retryAuthorized:false}));process.exitCode=1;}}
