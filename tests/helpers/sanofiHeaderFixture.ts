import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans,sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createSanofiChineseSourceFetch,bindSanofiChineseIndependentArtifact,SANOFI_CN_ENTRY } from "../../src/crawler/sanofiChineseNative";
import { captureSanofiChineseIndependent,type SanofiChineseDomCapture } from "../../src/crawler/sanofiChineseRenderedTraversal";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import type { HttpHtmlClient } from "../../src/crawler/httpHtmlSourceFetch";
export const AT="2026-10-04T17:00:00.000Z",LATER="2026-10-04T17:01:00.000Z";
export const row=(i=1)=>({id:String(100+i),title:`中文岗位${i}`,url:`https://jobs.sanofi.cn/job/role/3036/${100+i}`,listLocation:"中国"});
export const req=(i=1)=>`R900000${i}`,apply=(i=1)=>`https://careersite.tupu360.com/sanofi/position/detail?exid=${req(i)}`;
export const jd=(i=1)=>`完整职责和要求${i}`,nativeId=(i=1)=>String(i).padStart(24,"0");
export function detail(i=1,fallback=false){const r=row(i),foreign=fallback?2:i;
 return `<meta name="job-ats-req-id" content="${req(i)}"><meta name="search-job-apply-url" content="${apply(i)}"><script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",identifier:{value:req(i)},title:r.title,url:r.url,hiringOrganization:{name:"Sanofi"},description:jd(i),jobLocation:[{address:{addressCountry:"China"}}]})}</script><main id="content"><div class="job-description section7-title" data-job-id="${row(foreign).id}"><h1>${row(foreign).title}</h1><a data-job-id="${row(foreign).id}" data-selector-name="job-apply-link" href="${apply(foreign)}">立即申请</a></div><div class="job-description section7-details" data-job-id="${row(foreign).id}"><div class="ats-description">${jd(foreign)}</div><a data-job-id="${row(foreign).id}" data-selector-name="job-apply-link" href="${apply(foreign)}">立即申请</a></div></main>`;
}
export function native(i=1){return `<meta name="description" content="赛诺菲（中国）投资有限公司上海分公司"><input id="positionStatus" value="PUBLISHING"><input id="positionName" value="${row(i).title}"><input id="positionId" value="${nativeId(i)}"><input id="recruitmentType" value="SOCIALRECRUITMENT"><div class="position-header"><h4 class="name">${row(i).title}</h4></div><div class="position-extend"><span class="city">北京</span></div><div class="position-description">${jd(i)}</div><script>var prevPositionId = "${nativeId(i)}";</script>`;}
const results=()=>`<section id="search-results" data-location="中国" data-keywords="" data-location-path="1814991" data-organization-ids="2649" data-current-page="1" data-total-pages="1" data-total-job-results="2" data-records-per-page="15"><ul id="search-results-list">${[1,2].map(i=>`<li><button class="js-save-job-btn" data-job-id="${row(i).id}"></button><a data-job-id="${row(i).id}" href="${row(i).url}"><h2>${row(i).title}</h2><span class="job-location">中国</span></a></li>`).join("")}</ul><input class="pagination-current" value="1" max="1"><a class="next disabled">下一页</a></section>`;
export function dom():SanofiChineseDomCapture{return {schemaVersion:"sanofi-cn-cua-dom-list-v1",observedAt:AT,pages:[{url:SANOFI_CN_ENTRY,capturedAt:AT,searchResultsHtml:results()}]};}
export function http(fallback=false,change?:(url:string,body:string)=>string,redirect=false):HttpHtmlClient {return async r=>{const u=new URL(r.url);let body:string;
 if(r.url===SANOFI_CN_ENTRY)body='<section id="search-results" data-ajax-url="/search-results" data-total-pages="1" data-total-job-results="2" data-records-per-page="15" data-active-facet-id="0"></section><div id="search-filters"></div>';
 else if(u.pathname==="/search-results")body=JSON.stringify({results:results(),filters:'<section id="search-filters"><input class="filter-checkbox"></section>',hasJobs:true,hasContent:false});
 else if(u.hostname==="jobs.sanofi.cn"){const i=Number(u.pathname.split('/').at(-1))-100;body=detail(i,fallback&&i===1);}
 else if(u.hostname==="careersite.tupu360.com")body=native(Number(u.searchParams.get("exid")?.at(-1)));
 else throw Error("UNEXPECTED_TEST_URL");
 return {status:200,body:change?change(r.url,body):body,finalUrl:redirect&&r.url===apply(1)?apply(2):r.url,contentType:u.pathname==="/search-results"?"application/json":"text/html",capturedAt:AT};};}
export async function collect(change?:(url:string,body:string)=>string,redirect=false){
 const p=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-sanofi-china-social")!,client=http(true,change,redirect);
 const fetched=await createSanofiChineseSourceFetch({http:client,now:()=>new Date(AT)})(p),result=await runSourceCrawl(p,{fetch:()=>fetched,isBaseline:false});
 return {p,fetched,result};
}
export async function certificateFixture(){const {p,result}=await collect(),independent=http();
 const captured=await captureSanofiChineseIndependent({dom:dom(),http:async r=>({...await independent(r),capturedAt:LATER}),now:()=>new Date(LATER)});
 const validationInput={sourceId:"source-sanofi-china-social" as const,companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:captured.pages,observedAt:AT,expiresAt:"2026-10-04T17:30:00.000Z"};
 const validation=createOfficialJsonRenderedTraversalValidation(validationInput);
 result.fetchEvidence=bindSanofiChineseIndependentArtifact(p,result.fetchEvidence!,validation.artifactSha256);
 const input={plan:p,binding:{releaseCandidateId:"test-sanofi",batchId:"test-batch",sourceResultId:"test-result",sourceConfigSha256:sourcePlanConfigSha256(p)},transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,independentValidation:validation,validationExecution:"CURRENT_RUN" as const,trigger:"INITIAL_QUALIFICATION" as const,now:new Date(LATER)};
 return {p,result,captured,validationInput,validation,input,issued:issueBGradeTraversalCertificate(input)};
}
