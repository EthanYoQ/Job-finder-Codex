import test from 'node:test';
import assert from 'node:assert/strict';
import {buildJobProjectionDeltaReceipt} from '../src/db/jobProjectionDeltaCompiler.ts';
import {jobPersistedProjectionForCommand} from '../src/db/ingestionRepository.ts';
import {buildJobDedupeKey} from '../src/crawler/normalizedJob.ts';
import {hashProjectionJson} from '../src/domain/jobProjectionDeltaReceipt.ts';

test('any admitted company can retain a failed job through successive GRACE receipts without advancing its original sighting',()=>{
 const sourceId='source-abbvie-china-social',oldSeen='2026-11-05T00:01:00.000Z',firstObserved='2026-11-05T00:00:00.000Z';
 const record={companyId:'company-abbvie-china',sourceId,sourceKind:'SOCIAL',atsKind:'OFFICIAL_HTML',officialChineseCompanyName:'艾伯维',sourceJobId:'2',officialTitle:'Original role',officialUrl:'https://careers.abbvie.com/zh-hans/job/role-jid-2',locationRaw:'Shanghai, China',cities:['上海'],category:'其他',isBaseline:false,evidence:{officialEntryUrl:'https://careers.abbvie.com/zh-hans/jobs',capturedAt:firstObserved}};
 const legacy={syntheticProjectionFixture:true},certificateSha256=hashProjectionJson(legacy);let previous=null;
 for(const [index,observedAt,verifiedAt] of [[0,firstObserved,oldSeen],[1,'2026-11-05T12:00:00.000Z','2026-11-05T12:01:00.000Z'],[2,'2026-11-06T00:00:00.000Z','2026-11-06T00:01:00.000Z']]){
  const source={id:`result-${index}`,releaseCandidateId:'candidate',batchId:`batch-${index}`,sourceId,finishedAt:new Date(verifiedAt),completenessCertificate:legacy,completenessCertificateSha256:certificateSha256};
  const command={type:'UPSERT_JOB',dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:'ACTIVE',missingSuccessfulCrawlCount:index?1:0,visibleInFrontend:true,isNew:false,firstSeenAt:oldSeen,lastSeenAt:oldSeen};
  const delta=buildJobProjectionDeltaReceipt({sourceResult:source,previousAccepted:previous,commands:[command,{type:'UPSERT_CRAWL_OBSERVATION',observation:{crawledAt:new Date(observedAt)}}],projectionForCommand:jobPersistedProjectionForCommand});
  const member=delta.receipt.members.find(m=>m.setKind==='VISIBLE');
  assert.equal(member.lastConfirmedObservedAt,firstObserved);assert.equal(member.lifecycleLastSeenAt,oldSeen);assert.equal(member.lastPresentResultId,'result-0');
  previous={...source,completenessCertificate:delta.receipt,completenessCertificateSha256:delta.sha256};
 }
});
