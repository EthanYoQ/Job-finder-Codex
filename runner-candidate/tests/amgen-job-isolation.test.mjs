import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createAmgenManualWorkdaySourceFetch} from '../src/crawler/amgenManualWorkdaySourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';

const at='2026-11-06T00:00:00.000Z',origin='https://careers.amgen.com',wd='https://amgen.wd1.myworkdayjobs.com',china='6cb77610a8a543aea2d6bc10457e35d4';
const rows=[1,2,3].map(i=>({id:String(1000+i),title:`Synthetic Role ${i}`,url:`${origin}/en/job/shanghai/role-${i}/87/${1000+i}`,req:`R-${i}`,path:`/job/Shanghai/Role_R-${i}`}));
function entry(){
 const attributes={'location':'China','location-type':'2','location-path':'1814991','organization-ids':'87','keywords':'','total-job-results':'3','total-pages':'1','current-page':'1','records-per-page':'12','ajax-post-url':'/en/search-jobs/resultspost','show-radius':'False','latitude':'35','longitude':'105','sort-direction':'0','facet-type':'0'};
 return `<section id="search-filters" data-radius-unit-type="0"></section><section id="search-results" ${Object.entries(attributes).map(([k,v])=>`data-${k}="${v}"`).join(' ')}><ul id="search-results-jobs">${rows.map(row=>`<li><a data-job-id="${row.id}" href="${row.url}"><h3>${row.title}</h3></a><button class="js-save-job-btn" data-job-id="${row.id}" data-org-id="87"></button></li>`).join('')}</ul><nav class="pagination"><a class="next disabled" data-display-type="Jobs"></a></nav></section>`;
}
function identity(row){return `<link rel="canonical" href="${row.url}"><h1>${row.title}</h1><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:row.req,url:row.url,title:row.title,description:'Synthetic official description with enough complete content.',hiringOrganization:{name:'Amgen'},jobLocation:[{address:{addressCountry:'China',addressLocality:'Shanghai',addressRegion:'Shanghai'}}]})}</script>`;}
function application(row,mode){const country={id:china,descriptor:'China'};return JSON.stringify({userAuthenticated:false,jobPostingInfo:{jobReqId:mode==='wrong-id'&&row===rows[1]?'R-999':row.req,jobPostingId:row.path.split('/').at(-1),jobPostingSiteId:'Careers',externalUrl:`${wd}/Careers${row.path}`,title:row.title,posted:true,canApply:true,country,jobRequisitionLocation:{descriptor:'China - Shanghai',country:{...country,alpha2Code:'CN'}},location:'China - Shanghai',jobDescription:'Synthetic official description with enough complete content.'}});}
test('Amgen retains a complete manual list and isolates individual identity/application failures',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-amgen-china-social');
 for(const mode of ['good','503','429','wrong-id','transport','bad-list-title']){
  const calls=[];
  const fetch=createAmgenManualWorkdaySourceFetch({now:()=>new Date(at),http:async({url})=>{
   calls.push(url);let body,contentType='application/json',status=200;
   if(url===plan.source.officialEntryUrl){body=mode==='bad-list-title'?entry().replace(`<h3>${rows[1].title}</h3>`,'<h3></h3>'):entry();contentType='text/html';}
   else if(url.endsWith('/jobs'))body=JSON.stringify({total:3,jobPostings:rows.map(r=>({title:r.title,externalPath:r.path,locationsText:'China - Shanghai',bulletFields:[r.req]})),facets:[{facetParameter:'LocationCountry',values:[{id:china,descriptor:'China',count:3}]}]});
   else{const row=rows.find(r=>r.url===url||url.endsWith(r.path));assert.ok(row,url);
    if(url===row.url){body=identity(row);contentType='text/html';}
    else{if(row===rows[1]&&mode==='transport')throw Error('Synthetic unavailable');if(row===rows[1]&&['503','429'].includes(mode))status=Number(mode);body=status===200?application(row,mode):'Synthetic unavailable';}
   }
   return {status,body,finalUrl:url,contentType,capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,mode==='good'?3:mode==='429'?1:2,mode);
  if(mode!=='good'){assert.equal(result.fetchEvidence.jobQuarantines.length,mode==='429'?2:1);const changed=structuredClone(result.fetchEvidence);changed.jobQuarantines[0].code='FABRICATED';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:changed,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
  if(mode==='429')assert.equal(calls.some(url=>url===rows[2].url),false);
 }
});
