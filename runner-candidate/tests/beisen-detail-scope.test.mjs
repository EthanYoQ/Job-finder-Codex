import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {persistentOfficialJsonJobId} from '../src/crawler/officialJsonEvidence.ts';
import {replayBeisenDetailDates} from '../src/crawler/beisenDetailDates.ts';

for(const sourceId of ['source-cttq-social','source-shanghai-pharma-social'])test(`${sourceId}: optional dates cannot block valid jobs; native campus conflicts are isolated`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId);
 const at='2026-11-06T00:00:00.000Z';
 const rows=[1,2].map(index=>({Id:`${index}1111111-1111-4111-8111-111111111111`,JobAdName:`Synthetic social role ${index}`,LocNames:['江苏省·淮安市'],Category:'社会招聘',CategoryId:'1'}));
 for(const mode of ['campus','foreign-location','foreign-country','domestic-location-change','part-time','transport','bad-date','wrong-detail-id']){
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url,method})=>{
   if(method==='POST')return {status:200,finalUrl:url,contentType:'application/json',capturedAt:at,body:JSON.stringify({Code:200,Count:2,PageIndex:0,Data:rows})};
   const row=rows.find(row=>new URL(url).searchParams.get('jobAdId')===row.Id);assert.ok(row,'unexpected synthetic request');
   if(mode==='transport'&&row===rows[1])throw Error('synthetic optional date unavailable');
   const bad=row===rows[1];
   return {status:200,finalUrl:url,contentType:'application/json',capturedAt:at,body:JSON.stringify({Code:200,Data:{...row,
    ...(bad&&mode==='wrong-detail-id'?{Id:rows[0].Id}:{}),Kind:bad&&mode==='campus'?'校园招聘':'Part-time',Status:1,Duty:'Synthetic duties',
    ...(bad&&mode==='foreign-location'?{LocNames:['Boston, United States']}:{}),...(bad&&mode==='foreign-country'?{Country:'United States'}:{}),...(bad&&mode==='domestic-location-change'?{LocNames:['北京市·朝阳区']}:{}),
    PostDate:bad&&mode==='bad-date'?'unknown':'2026-11-05T09:00:00',PostDateInt:Date.parse('2026-11-05T09:00:00+08:00')}})};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.doesNotThrow(()=>replayBeisenDetailDates(plan,result.fetchEvidence,result.jobs,at),mode);
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.truth)}`);
  const isolated=['campus','foreign-location','foreign-country'].includes(mode);
  assert.equal(result.jobs.length,isolated?1:2,mode);
  const second=result.jobs.find(job=>job.sourceJobId===persistentOfficialJsonJobId(rows[1].Id));
  if(isolated)assert.equal(result.fetchEvidence.jobQuarantines[0].sourceJobId,persistentOfficialJsonJobId(rows[1].Id));
  else assert.equal(second.officialPublishedAt,mode==='part-time'?'2026-11-05T01:00:00.000Z':undefined,mode);
 }
});

test('Shanghai Pharma keeps an open job when list and detail name the same sibling districts', async () => {
 const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === 'source-shanghai-pharma-social');
 const at = '2026-11-06T00:00:00.000Z';
 const row = {
  Id: '11111111-1111-4111-8111-111111111111', JobAdName: 'Synthetic social role',
  LocNames: ['上海市·长宁区', '青浦区'], Category: '社会招聘', CategoryId: '1'
 };
 const fetch = createOfficialJsonSourceFetch({now: () => new Date(at), http: async ({url, method}) => {
  const body = method === 'POST'
   ? {Code: 200, Count: 1, PageIndex: 0, Data: [row]}
   : {Code: 200, Data: {...row, Status: 1, Duty: 'Synthetic duties',
    PostDate: '2026-11-05T09:00:00', PostDateInt: Date.parse('2026-11-05T09:00:00+08:00')}};
  return {status: 200, finalUrl: url, contentType: 'application/json', capturedAt: at, body: JSON.stringify(body)};
 }});
 const result = await runSourceCrawl(plan, {fetch, isBaseline: false});
 assert.deepEqual(result.jobs.map(job => [job.sourceJobId, job.officialPublishedAt]), [
  [persistentOfficialJsonJobId(row.Id), '2026-11-05T01:00:00.000Z']
 ]);
 assert.equal(result.truth.completenessVerified, true);
});
