import test from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createMokaSourceFetch} from '../src/crawler/mokaSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';

const iv='0123456789abcdef',at='2026-11-06T00:00:00.000Z';
const encrypt=data=>{const cipher=createCipheriv('aes-128-cbc',Buffer.from(iv),Buffer.from(iv));return JSON.stringify({necromancer:iv,data:Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]).toString('base64')});};
const locations=[{country:'中国',cityName:'上海',provinceName:'上海',cityId:310100,provinceId:310000}];
for(const sourceId of ['source-bayer-healthcare-social','source-gsk-china-social','source-hengrui-social','source-servier-china-social'])test(`${sourceId}: one bad Moka job cannot block complete verified jobs`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId),org=plan.moka.expectedOrgId,site=plan.moka.expectedSiteId;
 const customFields={'283170':{name:'Division',value:'Pharmaceuticals'},'290891':{name:'国家',value:'China'}};
 const raw=n=>({id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,orgId:org,siteId:site,title:`Role ${n}`,status:'open',showIsCampus:false,publishedAt:'2026-11-06T08:00:00',locations:[]});
 for(const mode of ['good','title','two-unbound','detail-503','detail-transport','detail-429','foreign','unresolved-country','duplicate','missing-page',...(org==='gsk'?['two-pages']:[])]){
  const rows=mode==='two-pages'?Array.from({length:51},(_,i)=>raw(i+1)):[raw(1),raw(2),raw(3)],calls=[];
  if(mode==='title')rows[1].title='';if(mode==='two-unbound')rows.push(null,null);if(mode==='duplicate')rows[1]=raw(1);
  const fetch=createMokaSourceFetch({now:()=>new Date(at),http:async request=>{
   calls.push(request);let body,status=200;
   if(request.method==='GET')body=`<input id="init-data" value='${JSON.stringify({org:{id:org},siteId:site,mode:'social',aesIv:iv,jobCustomFields:[{id:283170,name:'Division',type:'select_info',detail:['Pharmaceuticals','Consumer Health']},{id:273744,name:'Req status',type:'select_info',detail:['Open']}]})}'>`;
   else if(request.url.endsWith('/jobs/v2'))body=encrypt({success:true,data:{offset:request.body.offset,jobs:rows.slice(request.body.offset,request.body.offset+50),jobStats:{total:rows.length+(mode==='missing-page'?1:0),orgId:org}}});
   else {
    const current=rows.find(r=>r?.id===request.body.jobId);assert(current);
    if(mode==='detail-transport'&&current.id===raw(2).id)throw Error('Synthetic transport failure');
    status=current.id===raw(2).id?(['detail-503','two-pages'].includes(mode)?503:mode==='detail-429'?429:200):200;
    const detail={...current,locations:mode==='foreign'&&current.id===raw(2).id?[{country:'Japan',cityName:'Tokyo'}]:mode==='unresolved-country'&&current.id===raw(2).id?[{cityName:'Unknown City'}]:locations,jobDescription:'A substantive current official job description.',customFields};
    body=encrypt({success:true,data:detail});
   }
   return {status,body,finalUrl:request.url,contentType:request.method==='GET'?'text/html':'application/json',capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(['duplicate','missing-page'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);assert.equal(calls.filter(r=>r.url.endsWith('/job')).length,0);assert(result.fetchEvidence?.artifacts.length>=2);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation,losses:result.fetchEvidence?.fetchLosses})}`);
  assert.equal(result.jobs.length,mode==='two-pages'?50:mode==='detail-429'?1:['title','detail-503','detail-transport','foreign','unresolved-country'].includes(mode)?2:3,mode);
  if(mode==='two-pages')assert.deepEqual(calls.slice(0,3).map(r=>r.method==='GET'?'entry':r.url.endsWith('/jobs/v2')?'list':'detail'),['entry','list','list']);
  if(mode==='detail-429')assert.equal(calls.filter(r=>r.url.endsWith('/job')).length,2);
  if(mode!=='good'){
   const evidence=structuredClone(result.fetchEvidence);assert.equal(evidence.jobQuarantines.length,['two-unbound','detail-429'].includes(mode)?2:1);
   evidence.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});

test('Servier preserves corroborated district cities through live fetch and evidence replay',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-servier-china-social');
 const places=[
  {country:'中国',cityName:'朝阳区',cityId:110105,provinceName:'北京市',provinceId:110000},
  {country:'中国',cityName:'朝阳区',cityId:110105,provinceId:110000},
  {country:'中国',cityName:'朝阳区'},
  {country:'中国',cityName:'朝阳区',cityId:110105,provinceName:'辽宁',provinceId:210000},
  {country:'中国',cityName:'下城区（旧）',cityId:330103,provinceName:'浙江',provinceId:330000}
 ];
 const rows=places.map((_,index)=>({id:`00000000-0000-0000-0000-${String(index+1).padStart(12,'0')}`,orgId:'shiweiya',siteId:'47734',title:`Role ${index+1}`,status:'open',showIsCampus:false,publishedAt:'2026-11-06T08:00:00',locations:[]}));
 const fetch=createMokaSourceFetch({now:()=>new Date(at),http:async request=>{
  let body;
  if(request.method==='GET')body=`<input id="init-data" value='${JSON.stringify({org:{id:'shiweiya'},siteId:'47734',mode:'social',aesIv:iv})}'>`;
  else if(request.url.endsWith('/jobs/v2'))body=encrypt({success:true,data:{offset:0,jobs:rows,jobStats:{total:rows.length,orgId:'shiweiya'}}});
  else {
   const index=rows.findIndex(row=>row.id===request.body.jobId);assert(index>=0);
   body=encrypt({success:true,data:{...rows[index],locations:[places[index]],jobDescription:'A substantive current official job description.'}});
  }
  return {status:200,body,finalUrl:request.url,contentType:request.method==='GET'?'text/html':'application/json',capturedAt:at};
 }});
 const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
 assert.equal(result.truth.completenessVerified,true,JSON.stringify(result.observation));
 assert.equal(result.jobs.length,places.length);
 assert.deepEqual(result.jobs.map(job=>job.cities),[['北京'],['北京'],[CITY_PENDING],[CITY_PENDING],['杭州']]);
 assert.deepEqual(result.jobs.map(job=>job.locationRaw),places.map(place=>place.cityName));
 const replay=jobs=>replayStrictSourceQualityEvidence({plan,evidence:result.fetchEvidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs,capturedAt:at});
 assert.equal(replay(result.jobs),true);
 assert.equal(replay(result.jobs.map((job,index)=>index===0?{...job,cities:['朝阳区']}:job)),false);
});
