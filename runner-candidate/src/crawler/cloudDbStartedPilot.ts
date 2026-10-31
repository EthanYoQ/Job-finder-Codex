/** Explicit opt-in to the existing local file relay. No MCP or credentials. */
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {FilePilotRelay,PilotSqlFailure,PILOT_BUDGET,reviveUtcFields,type TakedaOwnedPipeSelection,type OwnedTakedaPublication,type BiogenOwnedPipeSelection,type OwnedBiogenPublication,type HengruiOwnedPipeSelection,type OwnedHengruiPublication,type UcbOwnedPipeSelection,type OwnedUcbPublication,type ViatrisOwnedPipeSelection,type OwnedViatrisPublication} from './cloudSourcePilotRelay';
import {compileCloudPilotPublicationContextSql,type CloudPilotControlInput,type CloudPilotPublicationContext} from '../db/cloudPilotSqlControl';
import {compileDbStartedCloudSourcePublication,deriveDbStartedPublicationExpiry,inspectPersistedAtomicCommitOutcome,type DbStartedCloudSourceInput,type PlannedBatchWithSourcesInput} from '../db/ingestionRepository';
import type {AGradeOfficialTotalCertificate} from './completenessCertificate';
import type {BGradeTraversalCertificate} from './traversalCertificate';
import type {SourceQualityReceipt} from './sourceQualityAdmission';

/** The wrapper owns this absolute budget. Missing/stale values cannot fall back
 * to a fresh timer at TypeScript startup or to the later evidence expiry. */
export function requireDbStartedOuterDeadline(deadline:number|undefined):number{
 if(typeof deadline!=='number'||!Number.isSafeInteger(deadline))throw Error('PILOT_OUTER_DEADLINE_REQUIRED');
 const minimumMs=2*PILOT_BUDGET.controlMs+PILOT_BUDGET.publishDbMs+PILOT_BUDGET.publishTransportMs+PILOT_BUDGET.controlCompletionMs;
 if(Date.now()+minimumMs>=deadline)throw Error('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
 return deadline;
}

export async function runDbStartedCloudPublication(input:{relay:FilePilotRelay;controlPath:string;planned:PlannedBatchWithSourcesInput;source:DbStartedCloudSourceInput;initialCertificate:AGradeOfficialTotalCertificate|BGradeTraversalCertificate|SourceQualityReceipt;overallDeadline:number;signal?:AbortSignal;ownedTakedaPipe?:{selection:TakedaOwnedPipeSelection;archive:import("../../../../connector-gate/takeda-publication-review.mts").TakedaReviewInput["archive"];producerRoot:string};ownedBiogenPipe?:{selection:BiogenOwnedPipeSelection;archive:import("../../../../connector-gate/biogen-publication-review.mts").BiogenReviewInput["archive"];producerRoot:string};ownedHengruiPipe?:{selection:HengruiOwnedPipeSelection;archive:import("../../../../connector-gate/hengrui-publication-review.mts").HengruiReviewInput["archive"];producerRoot:string};ownedUcbPipe?:{selection:UcbOwnedPipeSelection;archive:import("../../../../connector-gate/ucb-publication-review.mts").UcbReviewInput["archive"];producerRoot:string};ownedViatrisPipe?:{selection:ViatrisOwnedPipeSelection;archive:import("../../../../connector-gate/viatris-publication-review.mts").ViatrisReviewInput["archive"];producerRoot:string}}){
 if([input.ownedTakedaPipe,input.ownedBiogenPipe,input.ownedHengruiPipe,input.ownedUcbPipe,input.ownedViatrisPipe].filter(Boolean).length>1)throw Error("PILOT_OWNED_PIPE_SELECTION_CONFLICT");
 const overallDeadline=requireDbStartedOuterDeadline(input.overallDeadline);
 const control=JSON.parse(await readFile(input.controlPath,'utf8')) as Omit<CloudPilotControlInput,'expiresAt'>;
 const requestedAt=Date.now();
 // Queue only within the original proof window, keeping the existing publication
 // reserve. The relay separately reserves 25 seconds to finish the read itself.
 const evidenceExpiry=deriveDbStartedPublicationExpiry({startedAt:input.source.pending.startedAt,completenessCertificate:input.initialCertificate});
 // Keep one complete final-read window and one local-report/exit window inside
 // the original wrapper deadline, including when evidence outlives the worker.
 const publicationDeadline=Math.min(evidenceExpiry,overallDeadline-2*PILOT_BUDGET.controlMs);
 const contextDeadline=publicationDeadline-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs;
 if(requestedAt+PILOT_BUDGET.controlCompletionMs>=contextDeadline)throw Error('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
 // Compiling this fixed SELECT also checks the control/build/candidate shape.
 const rows=await input.relay.sql('READ_PUBLICATION_CONTEXT',compileCloudPilotPublicationContextSql(control,input.source.sourceAdmissionPolicy),contextDeadline,input.signal);
 if(rows.length!==1)throw Error('PILOT_CONTEXT_RESPONSE');
 const context=z.record(z.unknown()).parse(rows[0]!.context) as unknown as CloudPilotPublicationContext;
 const checkedAt=Date.parse(context.checkedAt),receivedAt=Date.now();
 if(receivedAt>=contextDeadline)throw Error('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
 // Preserve the original <=60-second response-age limit while allowing the
 // still-undispatched SELECT to queue longer. Earlier snapshots remain invalid.
 if(!Number.isFinite(checkedAt)||checkedAt<Math.max(requestedAt,receivedAt-PILOT_BUDGET.controlMs)-1000||checkedAt>receivedAt+1000)throw Error('PILOT_CONTEXT_FRESH_READ_REQUIRED');
 const publication={control:{...control,planned:input.planned,context},source:input.source,publicationDeadline,...(control.databaseIdentity?{jobProjectionDelta:true as const}:{})};
 let reviewed:OwnedTakedaPublication|undefined,reviewedBiogen:OwnedBiogenPublication|undefined,reviewedHengrui:OwnedHengruiPublication|undefined,reviewedUcb:OwnedUcbPublication|undefined,reviewedViatris:OwnedViatrisPublication|undefined;
 if(input.ownedTakedaPipe){
  const {REGISTRATION_FIELDS}=await import("../../../../src/deployment.mjs");
  const registration=Object.fromEntries(REGISTRATION_FIELDS.map(key=>[key,context.candidateRow[key]]));
  reviewed=await input.relay.prepareOwnedTakedaPublish({publication,scope:{producerRoot:input.ownedTakedaPipe.producerRoot,build:control.build,registration},
   archive:input.ownedTakedaPipe.archive,contextRead:{requestedAt,receivedAt},outerDeadline:overallDeadline},input.ownedTakedaPipe.selection);
 }
 if(input.ownedBiogenPipe){
  const {REGISTRATION_FIELDS}=await import("../../../../src/deployment.mjs");
  const registration=Object.fromEntries(REGISTRATION_FIELDS.map(key=>[key,context.candidateRow[key]]));
  reviewedBiogen=await input.relay.prepareOwnedBiogenPublish({publication,scope:{producerRoot:input.ownedBiogenPipe.producerRoot,build:control.build,registration,databaseProfile:'SCHEMA50'},
   archive:input.ownedBiogenPipe.archive,contextRead:{requestedAt,receivedAt},outerDeadline:overallDeadline},input.ownedBiogenPipe.selection);
 }
 if(input.ownedHengruiPipe){
  const {REGISTRATION_FIELDS}=await import("../../../../src/deployment.mjs");
  const registration=Object.fromEntries(REGISTRATION_FIELDS.map(key=>[key,context.candidateRow[key]]));
  reviewedHengrui=await input.relay.prepareOwnedHengruiPublish({publication,scope:{producerRoot:input.ownedHengruiPipe.producerRoot,build:control.build,registration,databaseProfile:'SCHEMA50'},
   archive:input.ownedHengruiPipe.archive,contextRead:{requestedAt,receivedAt},outerDeadline:overallDeadline},input.ownedHengruiPipe.selection);
 }
 if(input.ownedUcbPipe){
  const {REGISTRATION_FIELDS}=await import("../../../../src/deployment.mjs");
  const registration=Object.fromEntries(REGISTRATION_FIELDS.map(key=>[key,context.candidateRow[key]]));
  reviewedUcb=await input.relay.prepareOwnedUcbPublish({publication,scope:{producerRoot:input.ownedUcbPipe.producerRoot,build:control.build,registration,databaseProfile:'SCHEMA50'},
   archive:input.ownedUcbPipe.archive,contextRead:{requestedAt,receivedAt},outerDeadline:overallDeadline},input.ownedUcbPipe.selection);
 }
 if(input.ownedViatrisPipe){
  const {REGISTRATION_FIELDS}=await import("../../../../src/deployment.mjs");
  const registration=Object.fromEntries(REGISTRATION_FIELDS.map(key=>[key,context.candidateRow[key]]));
  reviewedViatris=await input.relay.prepareOwnedViatrisPublish({publication,scope:{producerRoot:input.ownedViatrisPipe.producerRoot,build:control.build,registration,databaseProfile:'SCHEMA50'},
   archive:input.ownedViatrisPipe.archive,contextRead:{requestedAt,receivedAt},outerDeadline:overallDeadline},input.ownedViatrisPipe.selection);
 }
 const packet=reviewed?.packet??reviewedBiogen?.packet??reviewedHengrui?.packet??reviewedUcb?.packet??reviewedViatris?.packet??await compileDbStartedCloudSourcePublication(publication);
 const expiresAt=Date.parse(packet.expiresAt);
 if(!Number.isFinite(expiresAt)||expiresAt>publicationDeadline)throw Error('PILOT_EVIDENCE_EXPIRY_CHANGED');
 input.signal?.throwIfAborted();
 if(Date.now()+PILOT_BUDGET.publishDbMs+PILOT_BUDGET.publishTransportMs>=expiresAt)throw Error('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
 let publishAcknowledged=false;
 try{if(reviewed)await input.relay.publishOwnedTakeda(reviewed,input.signal);else if(reviewedBiogen)await input.relay.publishOwnedBiogen(reviewedBiogen,input.signal);else if(reviewedHengrui)await input.relay.publishOwnedHengrui(reviewedHengrui,input.signal);else if(reviewedUcb)await input.relay.publishOwnedUcb(reviewedUcb,input.signal);else if(reviewedViatris)await input.relay.publishOwnedViatris(reviewedViatris,input.signal);else await input.relay.sql('PUBLISH',packet.sql,expiresAt,input.signal);publishAcknowledged=true;}
 catch(error){
  // A stopped response wait does not stop SQL. Its DB entry/terminal gates use
  // this same absolute proof cutoff, so wait before one read-only reconciliation.
  if(!(error instanceof PilotSqlFailure&&error.outcome!=='UNKNOWN')&&Date.now()<expiresAt)await delay(expiresAt-Date.now());
 }
 const literal=(value:string)=>`E'${value.replaceAll('\\','\\\\').replaceAll("'","''")}'`;
 const outcomeDeadline=Math.min(overallDeadline-PILOT_BUDGET.controlMs,Date.now()+PILOT_BUDGET.controlMs);
 // A delayed event loop/response may consume the reserve. Never report absence
 // as a resolved outcome without a completed final read, or restart the budget.
 if(Date.now()+PILOT_BUDGET.controlCompletionMs>=outcomeDeadline)throw Error('PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION');
 if(reviewed){
  const outcome=await input.relay.readAndVerifyOwnedTakedaOutcome(reviewed,outcomeDeadline,AbortSignal.timeout(Math.max(1,outcomeDeadline-Date.now())));
  return {...outcome,publishAcknowledged,batchFinalizationRequired:false,jobCount:packet.commit.sourceResult.dedupeOutputCount,publicationMode:control.databaseIdentity?'DB_STARTED_JOB_PROJECTION_DELTA_V1' as const:'DB_STARTED_OWNER_V1' as const};
 }
 if(reviewedBiogen){
  const outcome=await input.relay.readAndVerifyOwnedBiogenOutcome(reviewedBiogen,outcomeDeadline,AbortSignal.timeout(Math.max(1,outcomeDeadline-Date.now())));
  return {...outcome,publishAcknowledged,batchFinalizationRequired:false,jobCount:packet.commit.sourceResult.dedupeOutputCount,publicationMode:control.databaseIdentity?'DB_STARTED_JOB_PROJECTION_DELTA_V1' as const:'DB_STARTED_OWNER_V1' as const};
 }
 if(reviewedHengrui){
  const outcome=await input.relay.readAndVerifyOwnedHengruiOutcome(reviewedHengrui,outcomeDeadline,AbortSignal.timeout(Math.max(1,outcomeDeadline-Date.now())));
  return {...outcome,publishAcknowledged,batchFinalizationRequired:false,jobCount:packet.commit.sourceResult.dedupeOutputCount,publicationMode:control.databaseIdentity?'DB_STARTED_JOB_PROJECTION_DELTA_V1' as const:'DB_STARTED_OWNER_V1' as const};
 }
 if(reviewedUcb){
  const outcome=await input.relay.readAndVerifyOwnedUcbOutcome(reviewedUcb,outcomeDeadline,AbortSignal.timeout(Math.max(1,outcomeDeadline-Date.now())));
  return {...outcome,publishAcknowledged,batchFinalizationRequired:false,jobCount:packet.commit.sourceResult.dedupeOutputCount,publicationMode:control.databaseIdentity?'DB_STARTED_JOB_PROJECTION_DELTA_V1' as const:'DB_STARTED_OWNER_V1' as const};
 }
 if(reviewedViatris){
  const outcome=await input.relay.readAndVerifyOwnedViatrisOutcome(reviewedViatris,outcomeDeadline,AbortSignal.timeout(Math.max(1,outcomeDeadline-Date.now())));
  return {...outcome,publishAcknowledged,batchFinalizationRequired:false,jobCount:packet.commit.sourceResult.dedupeOutputCount,publicationMode:control.databaseIdentity?'DB_STARTED_JOB_PROJECTION_DELTA_V1' as const:'DB_STARTED_OWNER_V1' as const};
 }
 let resultRows:Record<string,unknown>[];
 try{resultRows=await input.relay.sql('READ_OUTCOME',`SELECT
 (SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=${literal(packet.commit.sourceResult.id)}) AS row,
 (SELECT to_jsonb(b) FROM public."CrawlBatch" b WHERE id=${literal(packet.commit.sourceResult.batchId)}) AS batch,
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId"`,outcomeDeadline,AbortSignal.timeout(Math.max(1,outcomeDeadline-Date.now())));
 if(Date.now()>=outcomeDeadline)throw Error('RELAY_DEADLINE');
 }catch(cause){throw new Error('PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION',{cause});}
 if(resultRows.length!==1)throw Error('PILOT_OUTCOME_ROW_COUNT');
 const persisted=resultRows[0]!.row===null?null:reviveUtcFields(z.record(z.unknown()).parse(resultRows[0]!.row),['startedAt','finishedAt']);
 const outcome=await inspectPersistedAtomicCommitOutcome(packet.commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error('PILOT_OUTCOME_FIND_MANY_FORBIDDEN');}}});
 if(outcome.state==='COMMITTED_EXACT'){
  const batch=z.record(z.unknown()).parse(resultRows[0]!.batch);
  if(batch.id!==input.planned.batch.id||batch.releaseCandidateId!==input.planned.batch.releaseCandidateId||batch.status!=='SUCCESS'||batch.atomicCommittedCount!==1||batch.completenessVerifiedCount!==1||resultRows[0]!.holderId===packet.holderId)throw Error('PILOT_DB_STARTED_TERMINAL_NOT_EXACT');
 }
 return {...outcome,publishAcknowledged,batchFinalizationRequired:false,jobCount:packet.commit.sourceResult.dedupeOutputCount,publicationMode:control.databaseIdentity?'DB_STARTED_JOB_PROJECTION_DELTA_V1' as const:'DB_STARTED_OWNER_V1' as const};
}
