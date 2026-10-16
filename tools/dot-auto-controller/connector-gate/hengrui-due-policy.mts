/** Pure fixed-Hengrui cadence check. JSON evidence is data, never authority.
 * Caller must first verify the original fresh context/source contract. */
import {parseJobProjectionDeltaReceipt} from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
const SOURCE='source-hengrui-social',INTERVAL_MS=12*60*60_000;
export interface HengruiDueDecision {readonly due:boolean;readonly observedAt:string|null;readonly nextDueAt:string|null}
export function evaluateHengruiSourceDue(latestAccepted:unknown,captureStartedAtMs:number):Readonly<HengruiDueDecision>{
 if(!Number.isSafeInteger(captureStartedAtMs)||!Number.isFinite(new Date(captureStartedAtMs).getTime()))throw Error('REVIEW_CAPTURE_START_INVALID');
 if(latestAccepted===null)return Object.freeze({due:true,observedAt:null,nextDueAt:null});
 if(!latestAccepted||typeof latestAccepted!=='object'||Array.isArray(latestAccepted))throw Error('REVIEW_LAST_ACCEPTED_OBSERVATION_REQUIRED');
 const row=latestAccepted as Record<string,unknown>;
 const receipt=parseJobProjectionDeltaReceipt(row.completenessCertificate,String(row.completenessCertificateSha256));
 if(receipt.binding.sourceId!==SOURCE||receipt.binding.sourceResultId!==row.id||receipt.binding.batchId!==row.batchId||receipt.binding.releaseCandidateId!==row.releaseCandidateId||
   !Array.isArray(row.observations)||row.observations.length!==1)throw Error('REVIEW_LAST_ACCEPTED_OBSERVATION_REQUIRED');
 const observation=row.observations[0];
 if(!observation||typeof observation!=='object'||Array.isArray(observation))throw Error('REVIEW_LAST_ACCEPTED_OBSERVATION_REQUIRED');
 const o=observation as Record<string,unknown>;
 // Preserve the original DB UTC acceptance (with/without Z) and actual observedAt.
 const raw=String(o.crawledAt),at=Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(raw)?raw:raw+'Z');
 if(!Number.isFinite(at)||at!==Date.parse(receipt.observedAt)||['successful','transportSucceeded','adapterSucceeded','completenessVerified','atomicCommitSucceeded'].some(k=>o[k]!==true)||
   o.sourceResultId!==row.id||o.sourceId!==SOURCE||o.batchId!==row.batchId||o.releaseCandidateId!==row.releaseCandidateId)
   throw Error('REVIEW_LAST_ACCEPTED_OBSERVATION_REQUIRED');
 if(at>captureStartedAtMs)throw Error('REVIEW_LAST_ACCEPTED_OBSERVATION_FUTURE');
 const next=at+INTERVAL_MS;
 if(!Number.isSafeInteger(next)||!Number.isFinite(new Date(next).getTime()))throw Error('REVIEW_LAST_ACCEPTED_OBSERVATION_REQUIRED');
 return Object.freeze({due:captureStartedAtMs>=next,observedAt:receipt.observedAt,nextDueAt:new Date(next).toISOString()});
}
export function assertHengruiSourceDue(latestAccepted:unknown,captureStartedAtMs:number):Readonly<HengruiDueDecision>{
 const decision=evaluateHengruiSourceDue(latestAccepted,captureStartedAtMs);
 if(!decision.due)throw Error('REVIEW_SOURCE_NOT_DUE');
 return decision;
}
