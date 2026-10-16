/** Wire contract for the private ledger. Pure validation, never SQL execution.
 * Offline checks do NOT verify PostgreSQL transactions, privileges, or triggers.
 * Keep SQL's native composite comparisons as the server authority.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const fields=JSON.parse(readFileSync(new URL('./ledger-contract-fields.json',import.meta.url),'utf8'));
export const NATIVE_SOURCE_FIELDS=Object.freeze(fields.nativeSourceFields);
export const PLANNED_BATCH_FIELDS=Object.freeze(fields.plannedBatchFields);
export const ORIGINAL_FIELDS=Object.freeze(fields.originalFields);
export const LEDGER_SQL=Object.freeze({
 claim:'SELECT jobfinder_control.claim_dispatch_v1($1::jsonb) AS intent',
 unresolved:'SELECT jobfinder_control.read_unresolved_v1($1,$2) AS snapshot',
 read:'SELECT jobfinder_control.read_dispatch_v1($1,$2,$3) AS intent',
 resolve:'SELECT jobfinder_control.resolve_committed_v1($1,$2,$3) AS resolution'
});
const sha=v=>createHash('sha256').update(v).digest('hex');
const project='yiopvxysxrtrnvqxwgbx';
const id=/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const same=(a,b)=>canonical(a)===canonical(b);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function demand(ok,code){if(!ok)throw Error(code);}
function date(v){return typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function keys(value,allowed,required=allowed){demand(object(value)&&Object.keys(value).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'LEDGER_KEYS');}
const requiredCounts=['rawCount','parsedCount','validCount','normalizedCount','dedupeInputCount','dedupeOutputCount','parseDiscardCount','validationDiscardCount','normalizationDiscardCount','dedupeDiscardCount','collisionCount','discardCount'];
const arrays=['officialSurfaceIds','officialChannelIds','retryReasonCodes'];
const numberFields=NATIVE_SOURCE_FIELDS.filter(k=>k.endsWith('Count'));
/** Accept only JSON serialization of the original first compiled packet. This
 * rejects dates-as-objects so caller must serialize once and persist exact data.
 * It never rewrites values, supplies new deadlines, or creates an intent/ticket.
 */
export function validateLedgerOriginal(p,{now=Date.now()}={}){
 keys(p,ORIGINAL_FIELDS);
 demand(p.schemaVersion===1&&p.projectId===project,'LEDGER_PROJECT');
 demand(Buffer.byteLength(JSON.stringify(p))<=16777216,'LEDGER_SIZE');
 for(const k of ['candidateId','sourceId','batchId','sourceResultId'])demand(typeof p[k]==='string'&&id.test(p[k]),'LEDGER_ID');
 for(const k of ['requestId','holderId'])demand(typeof p[k]==='string'&&uuid.test(p[k]),'LEDGER_UUID');
 for(const k of ['sourceConfigSha256','requestSha256','sqlSha256'])demand(typeof p[k]==='string'&&hash.test(p[k]),'LEDGER_SHA');
 for(const k of ['dispatchBefore','expiresAt','overallDeadline'])demand(Number.isSafeInteger(p[k])&&p[k]>=0,'LEDGER_DEADLINE');
 demand(p.dispatchBefore<p.expiresAt&&p.expiresAt<=p.overallDeadline&&now<p.dispatchBefore,'LEDGER_EXPIRED');
 demand(p.sourceResultId===p.batchId+'--'+p.sourceId,'LEDGER_TUPLE');
 const s=p.expectedSourceResult,b=p.expectedBatch;
 keys(s,NATIVE_SOURCE_FIELDS,['id','releaseCandidateId','batchId','sourceId','sourceConfigHash','adapterVersion','transportState','adapterState','completenessState','atomicCommitState','startedAt','finishedAt',...requiredCounts,...arrays]);
 keys(b,PLANNED_BATCH_FIELDS,PLANNED_BATCH_FIELDS.filter(k=>k!=='manualCrawlRequestId'));
 for(const k of NATIVE_SOURCE_FIELDS){
  const v=s[k]; if(v==null)continue;
  if(arrays.includes(k))demand(Array.isArray(v)&&v.every(x=>typeof x==='string'),'LEDGER_SOURCE_ARRAY');
  else if(numberFields.includes(k))demand(Number.isInteger(v)&&v>=0&&v<=2147483647,'LEDGER_SOURCE_INTEGER');
  else if(k==='completenessCertificate')demand(object(v),'LEDGER_SOURCE_JSON');
  else demand(typeof v==='string','LEDGER_SOURCE_STRING');
 }
 for(const k of requiredCounts)demand(Number.isInteger(s[k])&&s[k]>=0&&s[k]<=2147483647,'LEDGER_SOURCE_REQUIRED');
 for(const k of arrays)demand(Array.isArray(s[k]),'LEDGER_SOURCE_REQUIRED');
 demand(typeof s.adapterVersion==='string'&&s.adapterVersion.length>0,'LEDGER_SOURCE_REQUIRED');
 demand(s.id===p.sourceResultId&&s.releaseCandidateId===p.candidateId&&s.batchId===p.batchId&&s.sourceId===p.sourceId&&s.sourceConfigHash===p.sourceConfigSha256,'LEDGER_SOURCE_TUPLE');
 demand(s.transportState==='SUCCEEDED'&&s.adapterState==='SUCCEEDED'&&s.completenessState==='VERIFIED'&&s.atomicCommitState==='COMMITTED'&&s.failureCode==null,'LEDGER_SOURCE_TERMINAL');
 demand(date(s.startedAt)&&date(s.finishedAt)&&Date.parse(s.startedAt)<=Date.parse(s.finishedAt)&&Date.parse(s.finishedAt)<=p.expiresAt,'LEDGER_SOURCE_TIME');
 demand(b.id===p.batchId&&b.releaseCandidateId===p.candidateId&&b.kind==='SCHEDULED'&&b.manualCrawlRequestId==null,'LEDGER_BATCH_TUPLE');
 demand(b.plannedSourceCount===1&&same(b.plannedSourceIds,[p.sourceId])&&b.plannedSourceSetSha256===sha(JSON.stringify([p.sourceId])),'LEDGER_PLANNED_SET');
 demand(b.startedAt===s.startedAt&&b.heartbeatAt===b.startedAt&&date(b.startedAt),'LEDGER_BATCH_TIME');
 demand(typeof b.commitSha==='string'&&/^[a-f0-9]{40}$/.test(b.commitSha)&&typeof b.ownerId==='string'&&b.ownerId.length>0,'LEDGER_BATCH_IDENTITY');
 for(const k of ['rosterSha256','sourcePlanSha256','sourceConfigSha256','adapterBundleSha256'])demand(typeof b[k]==='string'&&hash.test(b[k]),'LEDGER_BATCH_SHA');
 return true;
}
/** Validate the identity-bound server reply; HOLD is never success. */
export function validateCommittedResolution(reply,original){
 demand(object(reply)&&reply.state==='COMMITTED_EXACT'&&reply.requestId===original.requestId&&reply.requestSha256===original.requestSha256&&typeof reply.resolvedAt==='string'&&Number.isFinite(Date.parse(reply.resolvedAt)),'LEDGER_COMMITTED_RESOLUTION');
 return true;
}
