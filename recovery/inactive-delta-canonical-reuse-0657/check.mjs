import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as old from './count-old.ts';import * as fresh from './count-new.ts';
import * as plainOld from './before.ts';import * as plainNew from './jobProjectionDeltaReceipt.ts';
const sha=x=>createHash('sha256').update(x).digest('hex');
const binding={releaseCandidateId:'candidate',batchId:'batch',sourceId:'source',sourceResultId:'result'};
const observed='2026-10-06T01:00:00.000Z',verified='2026-10-06T01:00:01.000Z';
function fixture(grace){
 const member={...binding,jobKey:'source:job',jobKeySha256:sha('source:job'),lifecycleStatus:'ACTIVE',missingCount:grace?1:0,jobProjectionSha256:'a'.repeat(64),lastConfirmedObservedAt:grace?'2026-10-05T01:00:00.000Z':observed,lifecycleLastSeenAt:grace?'2026-10-05T01:00:01.000Z':verified,lastPresentResultId:grace?'prior-result':'result'};
 const members=old.sortJobProjectionMembers([{...member,setKind:grace?'GRACE':'CURRENT'},{...member,setKind:'VISIBLE'}]);
 const legacyCertificate={schemaVersion:'synthetic-legacy-certificate',issuedAt:verified};
 return {schemaVersion:old.JOB_PROJECTION_DELTA_SCHEMA,projectionSchemaVersion:old.JOB_PERSISTED_PROJECTION_SCHEMA,binding,verifiedAt:verified,observedAt:observed,legacyCertificate,legacyCertificateSha256:old.hashProjectionJson(legacyCertificate),detailEvidenceState:'UNKNOWN',members,manifestSha256:old.hashDeltaManifest(members)};
}
const results=[];
for(const grace of [false,true]){
 const f=fixture(grace),before=structuredClone(f),hash=old.hashProjectionJson(f);
 globalThis.__memberArraySerializations=0;const a=old.verifyJobProjectionDeltaReceipt(f,hash,binding),oldCalls=globalThis.__memberArraySerializations;
 globalThis.__memberArraySerializations=0;const b=fresh.verifyJobProjectionDeltaReceipt(f,hash,binding),newCalls=globalThis.__memberArraySerializations;
 assert.deepEqual(a,b);assert.deepEqual(plainOld.verifyJobProjectionDeltaReceipt(f,hash,binding),a);assert.deepEqual(plainNew.verifyJobProjectionDeltaReceipt(f,hash,binding),b);assert.deepEqual(f,before);assert.equal(oldCalls,4);assert.equal(newCalls,3);
 for(const m of [old,fresh]){
  assert.throws(()=>m.verifyJobProjectionDeltaReceipt(f,'0'.repeat(64),binding),/JOB_DELTA_RECEIPT_HASH_MISMATCH/);
  const wrong={...f,manifestSha256:'0'.repeat(64)};assert.throws(()=>m.verifyJobProjectionDeltaReceipt(wrong,m.hashProjectionJson(wrong),binding),/JOB_DELTA_MANIFEST_HASH_MISMATCH/);
  assert.throws(()=>m.verifyJobProjectionDeltaReceipt(f,hash,{...binding,sourceResultId:'other'}),/JOB_DELTA_RECEIPT_TUPLE_MISMATCH/);
 }
 results.push({grace,oldMemberArraySerializations:oldCalls,newMemberArraySerializations:newCalls});
}
console.log(JSON.stringify({pass:true,results,inputAndOutputEqual:true,receiptManifestAndBindingRejectionsPreserved:true}));
