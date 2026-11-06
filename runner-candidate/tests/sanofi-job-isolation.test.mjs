import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {createSanofiChineseSourceFetch,SANOFI_CN_ENTRY,replaySanofiChineseNative} from '../src/crawler/sanofiChineseNative.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
const at='2026-11-06T04:00:00.000Z',title=n=>`中文岗位${n}`,url=n=>new URL(`https://jobs.sanofi.cn/工作/role/3036/${100+n}`).href,req=n=>`R900000${n}`,apply=n=>`https://careersite.tupu360.com/sanofi/position/detail?exid=${req(n)}`;
const detail=n=>`<meta name="job-ats-req-id" content="${req(n)}"><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:{value:req(n)},title:title(n),url:url(n),hiringOrganization:{name:'General Medicines'},description:'中文职责和要求',jobLocation:[{address:{addressCountry:'China'}}]})}</script><main id="content"><div class="job-description section7-title"><h1>${title(n)}</h1><a data-job-id="${100+n}" data-selector-name="job-apply-link" href="${apply(n)}">立即申请</a></div><div class="job-description section7-details" data-job-id="${100+n}"><div class="ats-description">中文职责和要求</div><a data-job-id="${100+n}" data-selector-name="job-apply-link" href="${apply(n)}">立即申请</a></div></main>`;
const native=n=>`<meta name="description" content="赛诺菲（中国）投资有限公司上海分公司"><input id="positionStatus" value="PUBLISHING"><input id="positionName" value="${title(n)}"><input id="positionId" value="${String(n).padStart(24,'0')}"><input id="recruitmentType" value="SOCIALRECRUITMENT"><div class="position-extend"><span class="city">广西壮族自治区-南宁</span></div><div class="position-description">中文职责和要求</div>`;
test('Sanofi complete China list isolates individual list, detail and native application failures',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-sanofi-china-social').plan;
 for(const mode of ['good','title','missing-button','bad-link','detail-503','detail-transport','native-unknown','native-503','detail-429','duplicate','missing-page']){
  const calls=[],count=mode==='detail-429'?9:3,bad=mode==='detail-429'?6:2;
  const rows=Array.from({length:count},(_,i)=>i+1).map(n=>`<li>${mode==='missing-button'&&n===bad?'':`<button class="js-save-job-btn" data-job-id="${mode==='duplicate'&&n===bad?101:100+n}"></button>`}<a data-job-id="${100+n}" href="${mode==='bad-link'&&n===bad?'https://[':url(n)}"><h2>${mode==='title'&&n===bad?'':title(n)}</h2><span class="job-location">中国南宁</span></a></li>`).join('');
  const list=`<section id="search-results" data-location="中国" data-keywords="" data-location-path="1814991" data-organization-ids="2649" data-current-page="1" data-total-pages="1" data-total-job-results="${mode==='missing-page'?count+1:count}" data-records-per-page="15"><ul id="search-results-list">${rows}</ul></section>`;
  const http=async request=>{calls.push(request);let body,contentType='text/html',status=200;
   if(request.url===SANOFI_CN_ENTRY)body=`<section id="search-results" data-ajax-url="/search-results" data-total-pages="1" data-total-job-results="${mode==='missing-page'?count+1:count}" data-records-per-page="15" data-active-facet-id="0"></section><div id="search-filters"></div>`;
   else if(new URL(request.url).pathname==='/search-results'){contentType='application/json';body=JSON.stringify({results:list,filters:'<section id="search-filters"><input class="filter-checkbox"></section>',hasJobs:true,hasContent:false});}
   else{const own=request.url.startsWith('https://jobs.sanofi.cn'),n=own?Number(request.url.split('/').pop())-100:Number(new URL(request.url).searchParams.get('exid').slice(-1));
    if(n===bad&&own&&mode==='detail-transport')throw Error('Synthetic transport failure');
    if(n===bad&&own&&mode==='detail-503'||n===bad&&!own&&mode==='native-503')status=503;
    if(n===bad&&own&&mode==='detail-429')status=429;
    body=own?detail(n):n===bad&&mode==='native-unknown'?'<html>Unavailable</html>':native(n);
   }
   return {status,body,contentType,finalUrl:request.url,capturedAt:at};
  };
  const result=await runSourceCrawl(plan,{fetch:createSanofiChineseSourceFetch({http,now:()=>new Date(at)}),isBaseline:false});
  if(['duplicate','missing-page'].includes(mode)){assert.equal(result.truth.completenessVerified,false,mode);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  assert.equal(result.jobs.length,mode==='good'?3:mode==='detail-429'?4:2,mode);
  assert.equal(replaySanofiChineseNative(plan,result.fetchEvidence,false).jobs.length,result.jobs.length);
  if(mode==='detail-429')assert.equal(calls.some(c=>c.url===url(9)),false);
  if(mode!=='good'){const e=structuredClone(result.fetchEvidence);e.jobQuarantines[0].sourceJobId='incorrect';assert.throws(()=>replaySanofiChineseNative(plan,e,false));}
 }
});
