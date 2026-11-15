import test from 'node:test';
import assert from 'node:assert/strict';
import {pages,listing,detail,apply} from './novo-synthetic-pages.ts';
import {NOVO_CHINA_ENDPOINT,parseNovoChinaResponse} from '../src/crawler/novoChinaQuality.ts';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {createOwnedSourceQualityFetch} from '../src/crawler/sourceQualityAdmission.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

test('Novo closes its complete list before isolating individual list, detail and apply failures',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-novo-nordisk-china-social').plan,oldFetch=globalThis.fetch;
 try{for(const mode of ['good','title','two-unbound','detail-transport','detail-503','detail-429','apply-missing','apply-unknown','foreign','duplicate','missing-list-row']){
  const raw=JSON.parse(listing),calls=[];
  if(mode==='title')raw.data.jobs[1].jobTitle='';if(mode==='two-unbound')raw.data.jobs.splice(1,2,null,null);
  if(mode==='foreign')raw.data.jobs[1].jobCountry={label:'Japan',value:'Japan'};
  if(mode==='duplicate')raw.data.jobs[1]=raw.data.jobs[0];if(mode==='missing-list-row')raw.data.jobs.pop();
  globalThis.fetch=async value=>{const url=String(value);calls.push(url);const page=pages.get(url);assert.ok(page,`Unexpected request ${url}`);
   if(mode==='detail-transport'&&url===detail(2))throw Error('synthetic connection failed');
   const status=url===detail(2)&&mode==='detail-503'?503:url===detail(2)&&mode==='detail-429'?429:200;
   const body=url===NOVO_CHINA_ENDPOINT?JSON.stringify(raw):url===detail(2)&&mode==='apply-missing'?page.body.replace(/<a href=.*?<\/a>/,''):url===apply(2)&&mode==='apply-unknown'?'<html>Unavailable</html>':page.body;
   return {status,url:page.finalUrl,headers:new Headers({'content-type':page.contentType,...(status===429?{'retry-after':'120'}:{})}),text:async()=>body};
  };
  const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
  if(['duplicate','missing-list-row'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);assert.equal(calls.length,1);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  assert.equal(result.jobs.length,mode==='good'?2:1,mode);
  if(mode!=='good'){
   const e=structuredClone(result.fetchEvidence);assert.equal(e.jobQuarantines.length,mode==='two-unbound'||mode==='detail-429'?2:1,mode);
   e.jobQuarantines[0].sourceJobId='incorrect';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:e,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:result.observation.crawledAt.toISOString()}),false);
  }
  if(mode==='detail-429')assert.equal(calls.includes(detail(3)),false);
 }}finally{globalThis.fetch=oldFetch;}
});

test('Novo isolates conflicting application redirects and keeps a corroborated opaque posting',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-novo-nordisk-china-social').plan;
 const oldFetch=globalThis.fetch,postingId='1234567890';
 try {
  for(const [target,opaque] of [[1,false],[3,false],[1,true],[3,true],[2,true]]){
   globalThis.fetch=async value=>{
    const url=String(value),page=pages.get(url===apply(2)?apply(target):url);
    assert.ok(page,url);
    if(opaque&&url===apply(2)){
     const id=new URL(page.finalUrl).pathname.split('/').at(-2);
     return {status:200,url:page.finalUrl.replace(id,postingId),headers:new Headers({'content-type':page.contentType}),
      text:async()=>page.body.replace(id,postingId)};
    }
    return {status:200,url:page.finalUrl,headers:new Headers({'content-type':page.contentType}),text:async()=>page.body};
   };
   const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
   const sameJob=target===2, label=`target=${target}, opaque=${opaque}`;
   assert.equal(result.truth.completenessVerified,true,label);
   assert.deepEqual(result.jobs.map(job=>job.officialUrl),sameJob?[detail(1),detail(2)]:[detail(1)],label);
   assert.deepEqual(result.fetchEvidence.jobQuarantines?.map(job=>job.officialUrl)??[],sameJob?[]:[detail(2)],label);
   assert.deepEqual(result.fetchEvidence.fetchLosses.map(loss=>loss.details.code),
    sameJob?['OFFICIAL_APPLICATION_CLOSED']:['JOB_QUARANTINED','OFFICIAL_APPLICATION_CLOSED'],label);
  }
 }finally{globalThis.fetch=oldFetch;}
});
