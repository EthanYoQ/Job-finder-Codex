/** Pure cadence data checks. No runtime identity or producer mocking. */
import {expect,it} from 'vitest';
import {evaluateViatrisSourceDue,assertViatrisSourceDue} from './viatris-due-policy.mts';
import {hashProjectionJson} from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
const SOURCE='source-viatris-social',NOW=Date.parse('2026-10-11T10:00:00.000Z');
function row(at=NOW-12*3600000){
 const observedAt=new Date(at).toISOString(),binding={releaseCandidateId:'synthetic-candidate',batchId:'synthetic-prior',sourceId:SOURCE,sourceResultId:'synthetic-result'};
 const receipt={schemaVersion:'job-projection-delta-receipt-v1',projectionSchemaVersion:'job-persisted-projection-v1',binding,verifiedAt:observedAt,observedAt,legacyCertificate:{},legacyCertificateSha256:'0'.repeat(64),detailEvidenceState:'UNKNOWN',members:[],manifestSha256:hashProjectionJson([])};
 return {id:binding.sourceResultId,batchId:binding.batchId,releaseCandidateId:binding.releaseCandidateId,sourceId:SOURCE,completenessCertificate:receipt,completenessCertificateSha256:hashProjectionJson(receipt),observations:[{...binding,crawledAt:observedAt,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true}]};
}
it('returns exact immutable observation and next due from original receipt',()=>{const x=evaluateViatrisSourceDue(row(),NOW);expect(x).toEqual({due:true,observedAt:'2026-10-10T22:00:00.000Z',nextDueAt:'2026-10-11T10:00:00.000Z'});expect(Object.isFrozen(x)).toBe(true);});
it('12h minus 1ms is not due; the predicate exposes data without granting authority',()=>{expect(evaluateViatrisSourceDue(row(NOW-12*3600000+1),NOW)).toEqual({due:false,observedAt:'2026-10-10T22:00:00.001Z',nextDueAt:'2026-10-11T10:00:00.001Z'});expect(()=>assertViatrisSourceDue(row(NOW-12*3600000+1),NOW)).toThrow('REVIEW_SOURCE_NOT_DUE');});
it('null baseline is due',()=>expect(assertViatrisSourceDue(null,NOW)).toEqual({due:true,observedAt:null,nextDueAt:null}));
it('preserves original DB UTC without Z',()=>{const x=row();x.observations[0]!.crawledAt=x.observations[0]!.crawledAt.slice(0,-1);expect(assertViatrisSourceDue(x,NOW).due).toBe(true);});
it('future observation is invalid, never an ordinary not-due skip',()=>expect(()=>assertViatrisSourceDue(row(NOW+1),NOW)).toThrow('REVIEW_LAST_ACCEPTED_OBSERVATION_FUTURE'));
it.each(['missing','duplicate','null','timestamp','success','observationTuple','receiptHash','receiptTuple','receiptObservedAt','missingRow'])('rejects malformed original evidence %s',kind=>{
 const x:any=row();
 if(kind==='missing')delete x.observations;if(kind==='duplicate')x.observations.push({...x.observations[0]});if(kind==='null')x.observations=[null];if(kind==='timestamp')x.observations[0].crawledAt='not-a-date';if(kind==='success')x.observations[0].atomicCommitSucceeded=false;
 if(kind==='observationTuple')x.observations[0].batchId='other';if(kind==='receiptHash')x.completenessCertificateSha256='f'.repeat(64);
 if(kind==='receiptTuple'){x.completenessCertificate.binding.sourceId='other';x.completenessCertificateSha256=hashProjectionJson(x.completenessCertificate);}
 if(kind==='receiptObservedAt'){x.completenessCertificate.observedAt=new Date(NOW-13*3600000).toISOString();x.completenessCertificateSha256=hashProjectionJson(x.completenessCertificate);}
 expect(()=>assertViatrisSourceDue(kind==='missingRow'?undefined:x,NOW)).toThrow();
});
it.each([NaN,Infinity,1.5])('rejects invalid capture time %s',at=>expect(()=>assertViatrisSourceDue(null,at)).toThrow('REVIEW_CAPTURE_START_INVALID'));
