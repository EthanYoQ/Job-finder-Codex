/** Explicit opt-in to the existing local file relay. No MCP or credentials. */
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {FilePilotRelay,PilotSqlFailure,PILOT_BUDGET,reviveUtcFields} from './cloudSourcePilotRelay';
import {compileCloudPilotPublicationContextSql,type CloudPilotControlInput,type CloudPilotPublicationContext} from '../db/cloudPilotSqlControl';
import {compileDbStartedCloudSourcePublication,deriveDbStartedPublicationExpiry,inspectPersistedAtomicCommitOutcome,type DbStartedCloudSourceInput,type PlannedBatchWithSourcesInput} from '../db/ingestionRepository';
import type {AGradeOfficialTotalCertificate} from './completenessCertificate';
import type {BGradeTraversalCertificate} from './traversalCertificate';

export async function runDbStartedCloudPublication(input:{relay:FilePilotRelay;controlPath:string;planned:PlannedBatchWithSourcesInput;source:DbStartedCloudSourceInput;initialCertificate:AGradeOfficialTotalCertificate|BGradeTraversalCertificate;signal?:AbortSignal}){
 const control=JSON.parse(await readFile(input.controlPath,'utf8')) as Omit<CloudPilotControlInput,'expiresAt'>;
 const requestedAt=Date.now();
 // Queue only within the original proof window, keeping the existing publication
 // reserve. The relay separately reserves 25 seconds to finish the read itself.
 const evidenceExpiry=deriveDbStartedPublicationExpiry({startedAt:input.source.pending.startedAt,completenessCertificate:input.initialCertificate});
 const contextDeadline=evidenceExpiry-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs;
 if(requestedAt+PILOT_BUDGET.controlCompletionMs>=contextDeadline)throw Error('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
 // Compiling this fixed SELECT also checks the control/build/candidate shape.
 const rows=await input.relay.sql('READ_PUBLICATION_CONTEXT',compileCloudPilotPublicationContextSql(control),contextDeadline,input.signal);
 if(rows.length!==1)throw Error('PILOT_CONTEXT_RESPONSE');
 const context=z.record(z.unknown()).parse(rows[0]!.context) as unknown as CloudPilotPublicationContext;
 const checkedAt=Date.parse(context.checkedAt),receivedAt=Date.now();
 if(receivedAt>=contextDeadline)throw Error('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
 // Preserve the original <=60-second response-age limit while allowing the
 // still-undispatched SELECT to queue longer. Earlier snapshots remain invalid.
 if(!Number.isFinite(checkedAt)||checkedAt<Math.max(requestedAt,receivedAt-PILOT_BUDGET.controlMs)-1000||checkedAt>receivedAt+1000)throw Error('PILOT_CONTEXT_FRESH_READ_REQUIRED');
 const packet=await compileDbStartedCloudSourcePublication({control:{...control,planned:input.planned,context},source:input.source});
 const expiresAt=Date.parse(packet.expiresAt);
 if(expiresAt>evidenceExpiry)throw Error('PILOT_EVIDENCE_EXPIRY_CHANGED');
 input.signal?.throwIfAborted();
 if(Date.now()+PILOT_BUDGET.publishDbMs+PILOT_BUDGET.publishTransportMs>=expiresAt)throw Error('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
 let publishAcknowledged=false;
 try{await input.relay.sql('PUBLISH',packet.sql,expiresAt,input.signal);publishAcknowledged=true;}
 catch(error){
  // A stopped response wait does not stop SQL. Its DB entry/terminal gates use
  // this same absolute proof cutoff, so wait before one read-only reconciliation.
  if(!(error instanceof PilotSqlFailure&&error.outcome!=='UNKNOWN'))await delay(Math.max(0,expiresAt-Date.now()));
 }
 const literal=(value:string)=>`E'${value.replaceAll('\\','\\\\').replaceAll("'","''")}'`;
 const resultRows=await input.relay.sql('READ_OUTCOME',`SELECT
 (SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=${literal(packet.commit.sourceResult.id)}) AS row,
 (SELECT to_jsonb(b) FROM public."CrawlBatch" b WHERE id=${literal(packet.commit.sourceResult.batchId)}) AS batch,
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId"`,Date.now()+PILOT_BUDGET.controlMs);
 if(resultRows.length!==1)throw Error('PILOT_OUTCOME_ROW_COUNT');
 const persisted=resultRows[0]!.row===null?null:reviveUtcFields(z.record(z.unknown()).parse(resultRows[0]!.row),['startedAt','finishedAt']);
 const outcome=await inspectPersistedAtomicCommitOutcome(packet.commit,{crawlBatchSourceResult:{findUnique:async()=>persisted,findMany:async()=>{throw Error('PILOT_OUTCOME_FIND_MANY_FORBIDDEN');}}});
 if(outcome.state==='COMMITTED_EXACT'){
  const batch=z.record(z.unknown()).parse(resultRows[0]!.batch);
  if(batch.id!==input.planned.batch.id||batch.releaseCandidateId!==input.planned.batch.releaseCandidateId||batch.status!=='SUCCESS'||batch.atomicCommittedCount!==1||batch.completenessVerifiedCount!==1||resultRows[0]!.holderId===packet.holderId)throw Error('PILOT_DB_STARTED_TERMINAL_NOT_EXACT');
 }
 return {...outcome,publishAcknowledged,batchFinalizationRequired:false,jobCount:packet.commit.sourceResult.dedupeOutputCount,publicationMode:'DB_STARTED_OWNER_V1' as const};
}
