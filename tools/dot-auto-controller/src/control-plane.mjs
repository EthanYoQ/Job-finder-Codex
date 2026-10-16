/** Fixed control-plane client. The private database functions and the public
 * reader-identity endpoint must be deployed under separate reviewed approval.
 * Missing functions/endpoint are hard blockers; config flags cannot create proof.
 */
import {validateLedgerOriginal,validateCommittedResolution} from '../transport/ledger-contract.mjs';
import {randomUUID} from 'node:crypto';
import {canonical,sha} from './journal.mjs';
import {withinDeadline} from './deadline.mjs';
const PROJECT='yiopvxysxrtrnvqxwgbx';
export const CONTROL_SQL=Object.freeze({
 begin:'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
 unresolved:'SELECT jobfinder_control.read_unresolved_v1($1,$2) AS snapshot',
 inventory:`SELECT clock_timestamp() AS "checkedAt", (SELECT to_jsonb(l) FROM public."CrawlCoordinatorLock" l WHERE id='formal-crawl') AS lock, coalesce((SELECT jsonb_agg(jsonb_build_object('sourceId',r."sourceId",'sourceResultId',r.id,'batchId',r."batchId")) FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE r."atomicCommitState"='PENDING' OR b.status='RUNNING'),'[]'::jsonb) AS pending`,
 rollback:'ROLLBACK',
 claim:'SELECT jobfinder_control.claim_dispatch_v1($1::jsonb) AS intent',
 resolve:'SELECT jobfinder_control.resolve_committed_v1($1,$2,$3) AS resolution',
 dispatch:'SELECT jobfinder_control.read_dispatch_v1($1,$2,$3) AS intent'
});
const same=(a,b)=>canonical(a)===canonical(b);
const roles=v=>v&&Object.keys(v).sort().join(',')==='fallback,main';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
async function boundedJson(response){const reader=response.body?.getReader();if(!reader)throw Error('READER_BODY_REQUIRED');const chunks=[];let bytes=0;try{for(;;){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>65536)throw Error('READER_BODY_TOO_LARGE');chunks.push(Buffer.from(r.value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
export function createControlPlane({openConnection,readerFilePins,onMutationAttempt=()=>{},assertScope=()=>{},fetchImpl=fetch,now=Date.now}){
 const tokens=new WeakMap();
 const fresh=(at,started,ended,canonicalTime=false)=>{const value=at instanceof Date?at.getTime():Date.parse(at);if(!Number.isFinite(value)||canonicalTime&&(typeof at!=='string'||new Date(value).toISOString()!==at)||value<started-1000||value>ended+1000||ended-value>60000)throw Error('CURRENT_CONTROL_PROOF_REQUIRED');};
 async function dbSnapshot(sourceId,{reconcile=false}={}){
  const started=now(),deadline=started+60000;let c;
  try{c=await withinDeadline(()=>openConnection({deadline:deadline-25000,kind:'READ_CONTEXT'}),deadline,{now});
   await withinDeadline(()=>c.query({text:CONTROL_SQL.begin}),deadline,{now});
   const ledger=await withinDeadline(()=>c.query({text:CONTROL_SQL.unresolved,values:[PROJECT,sourceId]}),deadline,{now});
   const db=await withinDeadline(()=>c.query({text:CONTROL_SQL.inventory}),deadline,{now});
   await withinDeadline(()=>c.query({text:CONTROL_SQL.rollback}),deadline,{now});
   if(ledger.rows?.length!==1||db.rows?.length!==1)throw Error('CONTROL_SNAPSHOT_ROW_COUNT');
   const l=ledger.rows[0].snapshot,d=db.rows[0];fresh(l.checkedAt,started,now());fresh(d.checkedAt,started,now());
   if(l.schemaVersion!==1||l.projectId!==PROJECT||l.sourceId!==sourceId||l.ledgerVersion!=='dispatch-intent-v1'||!Array.isArray(l.unresolved)||!Array.isArray(d.pending))throw Error('PERSISTENT_LEDGER_REQUIRED');
   if(!reconcile&&(l.unresolved.length||d.pending.length||d.lock?.holderId))throw Error('PRIOR_UNKNOWN_OR_WRITER_HELD');
   return {ledger:l,database:d,readStartedAt:started,readFinishedAt:now()};
  }finally{if(c)await withinDeadline(()=>c.close(),Math.min(deadline,now()+1000),{now}).catch(()=>{});}
 }
 async function readerIdentity(expected){
  if(!expected||expected.schemaVersion!==1||!roles(expected.readers))throw Error('EXPECTED_READER_IDENTITY_REQUIRED');
  for(const role of ['main','fallback']){if(!readerFilePins?.[role]||!same(expected.readers[role].readerFileHashes,readerFilePins[role])||expected.readers[role].role!==role)throw Error('REPLAY_READER_PIN_BINDING_REQUIRED');}
  const started=now(),nonce=randomUUID(),deadline=started+45000;
  const response=await withinDeadline(()=>fetchImpl('https://job.orz.md/.well-known/jobfinder-reader-identity.json?nonce='+nonce,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(45000)}),deadline,{now});
  if(!response.ok)throw Error('CURRENT_READER_IDENTITY_UNAVAILABLE');
  if(!(response.headers?.get('cache-control')??'').toLowerCase().split(',').map(v=>v.trim()).includes('no-store'))throw Error('READER_IDENTITY_CACHE_FORBIDDEN');
  if(response.redirected||!(response.headers?.get('content-type')??'').toLowerCase().startsWith('application/json'))throw Error('READER_RESPONSE_SHAPE');
  const body=await withinDeadline(()=>boundedJson(response),deadline,{now});fresh(body.checkedAt,started,now(),true);
  if(!roles(body.observedAt)||!roles(body.processes)||body.nonce!==nonce||body.projectId!==PROJECT||body.schemaVersion!==1||!same(body.readers,expected.readers))throw Error('CURRENT_READER_IDENTITY_MISMATCH');
  for(const role of ['main','fallback']){fresh(body.observedAt?.[role],started,now(),true);const p=body.processes?.[role];if(!p||!uuid(p.instanceId)||!Number.isFinite(Date.parse(p.startedAt))||new Date(Date.parse(p.startedAt)).toISOString()!==p.startedAt||Date.parse(p.startedAt)>now())throw Error('READER_PROCESS_PROOF_REQUIRED');}
  return {schemaVersion:1,projectId:PROJECT,readers:body.readers,processes:body.processes,checkedAt: new Date(Math.min(Date.parse(body.checkedAt),...Object.values(body.observedAt).map(v=>Date.parse(v)))).toISOString()};
 }
 async function verifyStartup(sourceId,expectedReader,{reconcile=false}={}){
  const database=await dbSnapshot(sourceId,{reconcile}),reader=await readerIdentity(expectedReader),token=Object.freeze({});
  tokens.set(token,{sourceId,reconcile,database,reader,expiresAt:Math.min(Date.parse(database.ledger.checkedAt)+60000,Date.parse(database.database.checkedAt)+60000,Date.parse(reader.checkedAt)+60000)});return token;
 }
 function accept(token,sourceId,{reconcile=false}={}){const p=tokens.get(token);if(!p||p.sourceId!==sourceId||p.reconcile!==reconcile||now()>=p.expiresAt)throw Error('LIVE_CONTROL_PROOF_REQUIRED');return structuredClone(p);}
 function wrapJournal(localJournal){return Object.freeze({prepare:a=>localJournal.prepare(a),finish:(a,r)=>localJournal.finish(a,r),claim:async artifact=>{
  if(artifact.request.kind!=='PUBLISH')return localJournal.claim(artifact);
  // Synchronous, before any possible remote mutation or await.
  onMutationAttempt();
  const b=artifact.binding,deadline=b.dispatchBefore;
  const expected={schemaVersion:1,projectId:b.projectId,candidateId:b.candidateId,sourceId:b.sourceId,sourceConfigSha256:b.sourceConfigSha256,batchId:b.batchId,sourceResultId:b.sourceResultId,requestId:artifact.request.requestId,requestSha256:artifact.request.requestSha256,sqlSha256:artifact.sqlSha256,holderId:artifact.packet?.holderId,dispatchBefore:b.dispatchBefore,expiresAt:b.expiresAt,overallDeadline:b.overallDeadline,expectedBatch:artifact.packet?.expectedBatch,expectedSourceResult:artifact.packet?.commit?.sourceResult};
  validateLedgerOriginal(JSON.parse(JSON.stringify(expected)),{now:now()});
  if(!expected.holderId||!expected.expectedSourceResult||!expected.expectedBatch)throw Error('NATIVE_EXPECTED_TERMINAL_REQUIRED');let c;
  try{c=await withinDeadline(()=>openConnection({deadline,kind:'READ_CONTEXT'}),deadline,{now});const r=await withinDeadline(()=>{assertScope();return c.query({text:CONTROL_SQL.claim,values:[JSON.stringify(expected)]});},deadline,{now});
   if(r.rows?.length!==1||r.rows[0].intent?.state!=='MAY_HAVE_BEEN_SENT'||!same(r.rows[0].intent.original,JSON.parse(JSON.stringify(expected))))throw Error('DURABLE_CLAIM_NOT_EXACT');
   await localJournal.claim(artifact);
  }finally{if(c)await withinDeadline(()=>c.close(),Math.min(deadline,now()+1000),{now}).catch(()=>{});}
 }});}
 async function readDispatch(requestId,requestSha256){const deadline=now()+60000;let c;try{c=await withinDeadline(()=>openConnection({deadline,kind:'READ_OUTCOME'}),deadline,{now});const r=await withinDeadline(()=>c.query({text:CONTROL_SQL.dispatch,values:[PROJECT,requestId,requestSha256]}),deadline,{now});if(r.rows?.length!==1)throw Error('ORIGINAL_REMOTE_INTENT_REQUIRED');return r.rows[0].intent;}finally{if(c)await withinDeadline(()=>c.close(),Math.min(deadline,now()+1000),{now}).catch(()=>{});}}
 async function resolveCommitted(requestId,requestSha256,{deadline:originalDeadline=now()+60000}={}){const deadline=Math.min(originalDeadline,now()+60000);onMutationAttempt();let c;try{c=await withinDeadline(()=>openConnection({deadline,kind:'READ_OUTCOME'}),deadline,{now});const r=await withinDeadline(()=>{assertScope();return c.query({text:CONTROL_SQL.resolve,values:[PROJECT,requestId,requestSha256]});},deadline,{now});const v=r.rows?.length===1?r.rows[0].resolution:null;if(v?.state!=='COMMITTED_EXACT'||v.requestId!==requestId||v.requestSha256!==requestSha256)throw Error('REMOTE_COMMITTED_RESOLUTION_HELD');validateCommittedResolution(v,{requestId,requestSha256});return v;}finally{if(c)await withinDeadline(()=>c.close(),Math.min(deadline,now()+1000),{now}).catch(()=>{});}}
 return Object.freeze({verifyStartup,accept,readerIdentity,dbSnapshot,wrapJournal,readDispatch,resolveCommitted,markMutationAttempt:()=>onMutationAttempt()});
}
