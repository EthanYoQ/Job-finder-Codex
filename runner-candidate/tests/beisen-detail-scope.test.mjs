import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {acquireBeisenDetailDates,replayBeisenDetailDates} from '../src/crawler/beisenDetailDates.ts';
import {persistentOfficialJsonJobId,irreversibleOfficialJsonEvidenceId} from '../src/crawler/officialJsonEvidence.ts';
import {beisenZhiyeDetailUrl,citiesFromBeisenLocation} from '../src/crawler/officialJsonSourceFetch.ts';
import {officialJsonAdapter} from '../src/crawler/adapters/officialJson.ts';

test('a campus detail cannot pass a social list; other employment labels remain optional',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-cttq-social');
 const at='2026-11-04T15:00:00.000Z',id='11111111-1111-4111-8111-111111111111';
 const row={Id:id,JobAdName:'Synthetic social role',LocNames:['江苏省·淮安市'],Category:'社会招聘',CategoryId:'1'};
 const listBody=JSON.stringify({Code:200,Count:1,PageIndex:0,Data:[row]});
 for(const Kind of ['校园招聘','campus',undefined,'Part-time']){
  const sourceJobId=persistentOfficialJsonJobId(id);
  const payloadJob={sourceJobId,title:row.JobAdName,officialUrl:beisenZhiyeDetailUrl(plan.source.officialEntryUrl,'social/detail',id),locationRaw:row.LocNames.join(' / '),cities:citiesFromBeisenLocation(row.LocNames)};
  const fetched={ok:true,capturedAt:at,payload:{jobs:[payloadJob]},paginationEvaluation:{safeCompleteness:true},fetchEvidence:{
   artifacts:[{id:'beisen-page-0000',logicalKey:'beisen-page-0000',httpStatus:200,bodyRepresentation:'EXACT',body:listBody}],
   pages:[{sequence:0,artifactLogicalKey:'beisen-page-0000',requestedPage:0,returnedPage:0,requestedPageSize:plan.officialJsonFetch.pageSize??100,declaredTotal:1,nextPageSignalBefore:null,nextPageSignalAfter:null,termination:'NEXT_ABSENT',responseFingerprintSha256:createHash('sha256').update(listBody).digest('hex'),rawJobIds:[irreversibleOfficialJsonEvidenceId(id)],validJobIds:[irreversibleOfficialJsonEvidenceId(sourceJobId)]}],
   fetchCounts:{rawCount:1,parsedCount:1,validCount:1,parseDiscardCount:0,validationDiscardCount:0},fetchLosses:[],declaredCompleteness:{kind:'OFFICIAL_TOTAL_COUNT',value:1,scope:'SOURCE',artifactLogicalKey:'beisen-page-0000'}
  }};
  const enriched=await acquireBeisenDetailDates(plan,fetched,async({url})=>({status:200,finalUrl:url,contentType:'application/json',capturedAt:'2026-11-04T15:00:01.000Z',body:JSON.stringify({Code:200,Data:{...row,Kind,Status:1,Duty:'Synthetic duties',PostDate:'2026-11-04T09:00:00',PostDateInt:Date.parse('2026-11-04T09:00:00+08:00')}}) }),()=>new Date(at));
  const extracted=officialJsonAdapter.extract({company:plan.company,source:plan.source,json:plan.json,capturedAt:at,isBaseline:false,payload:enriched.payload});
  assert.equal(extracted.status,'SUCCESS');
  if(Kind==='校园招聘'||Kind==='campus'){
   assert.equal(enriched.payload.jobs[0].officialPublishedAt,undefined);
   assert.throws(()=>replayBeisenDetailDates(plan,enriched.fetchEvidence,extracted.jobs,at),/BEISEN_DETAIL_DATE_IDENTITY_INVALID/);
  }else{
   assert.equal(enriched.payload.jobs[0].officialPublishedAt,'2026-11-04T01:00:00.000Z');
   assert.doesNotThrow(()=>replayBeisenDetailDates(plan,enriched.fetchEvidence,extracted.jobs,at));
  }
 }
});
