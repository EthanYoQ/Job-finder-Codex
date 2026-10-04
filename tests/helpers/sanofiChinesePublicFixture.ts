import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createSanofiChineseSourceFetch, SANOFI_CN_ENTRY } from "../../src/crawler/sanofiChineseNative";
import { captureSanofiChineseIndependent, type SanofiChineseDomCapture } from "../../src/crawler/sanofiChineseRenderedTraversal";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOfficialJsonRenderedTraversalValidation, issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import type { HttpHtmlClient } from "../../src/crawler/httpHtmlSourceFetch";
import { accepted, job } from "./portablePublicSnapshotFixture";
import { canonicalPageTraceSha256, canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
export const AT="2026-10-04T10:00:00.000Z", LATER="2026-10-04T10:01:00.000Z", EXPIRES="2026-10-04T10:30:00.000Z";
export const plan=()=>buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-sanofi-china-social")!;
const req=(i:number)=>`R900000${i}`;
const url=(i:number)=>`https://jobs.sanofi.cn/%e5%b7%a5%e4%bd%9c/role/3036/${100+i}`;
const title=(i:number)=>`中文岗位${i}`;
const description=(i:number)=>`中文职责和要求${i}`;
const row=(i:number)=>({id:String(100+i),title:title(i),url:url(i),listLocation:"中国"});
function detail(i:number,country="China",mixed=false){const id=String(100+i),r=req(i),foreign=mixed?"999":id;
  return `<meta name="job-ats-req-id" content="${r}"><script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",identifier:{value:r},title:title(i),url:url(i),hiringOrganization:{name:"General Medicines"},description:description(i),jobLocation:[{address:{addressCountry:country}}]})}</script><main id="content"><div class="job-description section7-title"><h1>${title(i)}</h1><a data-job-id="${id}" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=${r}">立即申请</a></div><div class="job-description section7-details" data-job-id="${foreign}"><div class="ats-description">${mixed?"其他岗位九江":description(i)}</div><a data-job-id="${foreign}" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=${mixed?"R9999999":r}">立即申请</a></div></main>`;
}
function native(i:number,state="PUBLISHING",city="广西壮族自治区-南宁") {return `<meta name="description" content="赛诺菲（中国）投资有限公司上海分公司"><input id="positionStatus" value="${state}"><input id="positionName" value="${title(i)}"><input id="positionId" value="${String(i).padStart(24,"0")}"><input id="recruitmentType" value="SOCIALRECRUITMENT"><div class="position-extend"><span class="city">${city}</span></div><div class="position-description">${description(i)}</div>`;}
function results(){return `<section id="search-results" data-location="中国" data-keywords="" data-location-path="1814991" data-organization-ids="2649" data-current-page="1" data-total-pages="1" data-total-job-results="3" data-records-per-page="15"><ul id="search-results-list">${[1,2,3].map(i=>`<li><button class="js-save-job-btn" data-job-id="${100+i}"></button><a data-job-id="${100+i}" href="${url(i)}"><h2>${title(i)}</h2><span class="job-location">中国</span></a></li>`).join("")}</ul><input class="pagination-current" value="1" max="1"><a class="next disabled">下一页</a></section>`;}
function dom():SanofiChineseDomCapture{return {schemaVersion:"sanofi-cn-cua-dom-list-v1",observedAt:AT,pages:[{url:SANOFI_CN_ENTRY,capturedAt:AT,searchResultsHtml:results()}]};}
async function collect(change?:(url:string,body:string)=>string){
  const requests:string[]=[];const http:HttpHtmlClient=async r=>{requests.push(r.url);const u=new URL(r.url);let body:string;
    if(r.url===SANOFI_CN_ENTRY)body='<section id="search-results" data-ajax-url="/search-results" data-total-pages="1" data-total-job-results="3" data-records-per-page="15" data-active-facet-id="0"></section><div id="search-filters"></div>';
    else if(u.pathname==="/search-results")body=JSON.stringify({results:results(),filters:'<section id="search-filters"><input class="filter-checkbox"></section>',hasJobs:true,hasContent:false});
    else if(u.hostname==="jobs.sanofi.cn"){const i=Number(u.pathname.split('/').at(-1))-100;body=detail(i,i===2?"Taiwan":"China",i===1);}
    else if(u.hostname==="careersite.tupu360.com"){const i=Number(u.searchParams.get("exid")?.at(-1));body=native(i,i===3?"CLOSED":"PUBLISHING");}
    else throw Error("NON_CHINESE_AUTHORITY_REQUEST");
    return {status:200,body:change?change(r.url,body):body,finalUrl:r.url,contentType:u.pathname==="/search-results"?"application/json":"text/html",capturedAt:AT};
  };
  const p=plan(),fetched=await createSanofiChineseSourceFetch({http,now:()=>new Date(AT)})(p),result=await runSourceCrawl(p,{fetch:()=>fetched,isBaseline:false});return {p,fetched,result,http,requests};
}

export async function chineseBFixture() {
  const {p, result: crawl, http} = await collect();
  const captured = await captureSanofiChineseIndependent({dom: dom(), http: async r=>({...await http(r), capturedAt: LATER}), now:()=>new Date(LATER)});
  const independentValidation = createOfficialJsonRenderedTraversalValidation({sourceId:"source-sanofi-china-social",companyId:p.company.id,
    sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),
    pages:captured.pages,observedAt:AT,expiresAt:EXPIRES});
  const f = accepted(LATER,crawl.jobs.map(row=>row.sourceJobId!),["historical-grace"],p);
  const issued=issueBGradeTraversalCertificate({plan:p,binding:{releaseCandidateId:f.result.releaseCandidateId,batchId:f.result.batchId,
    sourceResultId:f.result.id,sourceConfigSha256:sourcePlanConfigSha256(p)},transportSuccess:true,adapterSuccess:true,evidence:crawl.fetchEvidence!,
    paginationEvaluation:crawl.paginationEvaluation!,reconciliation:crawl.reconciliation!,jobs:crawl.jobs,independentValidation,
    validationExecution:"CURRENT_RUN",trigger:"INITIAL_QUALIFICATION",now:new Date(LATER)});
  if(issued.status!=="CERTIFIED")throw Error(JSON.stringify(issued));
  const receipt=issued.certificate,counts=crawl.fetchEvidence!.fetchCounts,ledger=crawl.reconciliation!;
  Object.assign(f.result,{completenessCertificate:receipt,completenessCertificateSha256:issued.certificateSha256,...counts,
    normalizedCount:ledger.validBeforeDedupeCount,dedupeInputCount:ledger.dedupeInputCount,validationDiscardCount:counts.validationDiscardCount,
    discardCount:counts.validationDiscardCount,adapterInputCount:ledger.rawInputCount,adapterOutputCount:ledger.dedupeOutputCount,adapterLossCount:0,
    expectedJobCount:null,expectedEvidenceKind:"COMPLETE_PAGE_TRAVERSAL",adapterReconciliationSha256:receipt.output.adapterReconciliationSha256,
    collisionLedgerSha256:receipt.output.collisionLedgerSha256,expectedSurfaceSha256:canonicalStringSetSha256(receipt.scope.surfaceIds),
    visitedSurfaceSha256:canonicalStringSetSha256(receipt.scope.surfaceIds),expectedChannelSha256:canonicalStringSetSha256(receipt.scope.channelIds),
    visitedChannelSha256:canonicalStringSetSha256(receipt.scope.channelIds),
    observations:[{sourceId:p.source.id,batchId:f.result.batchId,releaseCandidateId:f.result.releaseCandidateId,sourceResultId:f.result.id,
      sourceConfigSha256:sourcePlanConfigSha256(p),adapterVersion:f.result.adapterVersion,observedFrom:new Date(LATER),observedTo:new Date(LATER),
      crawledAt:new Date(LATER),successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true,
      canonicalRawSha256:canonicalStringSetSha256(crawl.fetchEvidence!.pages.flatMap(p=>p.rawJobIds)),
      canonicalOutputSha256:receipt.output.canonicalJobSetSha256,paginationTraceSha256:canonicalPageTraceSha256(crawl.fetchEvidence!.pages)}]});
  const jobs=crawl.jobs.map(row=>({...job(row.sourceJobId!,LATER),sourceId:p.source.id,companyId:p.company.id,
    dedupeKey:`${p.source.id}:${row.sourceJobId}`,officialTitle:row.officialTitle,officialUrl:row.officialUrl,cities:row.cities,city:row.cities[0]!,locationRaw:row.locationRaw}));
  return {...f,jobs,plan:p,crawl,receipt};
}
