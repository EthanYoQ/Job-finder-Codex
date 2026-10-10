import type {HttpHtmlClient} from "../../src/crawler/httpHtmlSourceFetch";
import{describe,it,expect}from"vitest";
import{createSanofiNativeSourceFetch,SANOFI_CHINESE_ENTRY,parseSanofiDetail}from"../../src/crawler/sanofiNativeQuality";
import{candidateCompanies}from"../../src/data/companyRegistry";
import{buildStagedSourceCrawlPlans,sourcePlanConfigSha256}from"../../src/crawler/sourcePlan";
import{runSourceCrawl}from"../../src/crawler/runSourceCrawl";
import{issueAGradeOfficialTotalCertificate}from"../../src/crawler/completenessCertificate";
import{sha256Bytes}from"../../src/crawler/sourceFetchEvidence";
const time="2026-10-02T14:00:00.000Z";
const english="https://jobs.sanofi.com/en/location/china-country-jobs/2649/1814991/2";
const detailUrl=(cn:boolean,id:number)=>new URL(`https://jobs.sanofi.${cn?"cn":"com"}/${cn?"工作":"en/job"}/role/${cn?3036:2649}/${id}`).toString();
function detail(cn:boolean,id:number,req:string,country="China"){const url=detailUrl(cn,id);return `<script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",identifier:{value:req},title:`Role ${req}`,url,datePosted:"2026-09-30",hiringOrganization:{name:cn?"General Medicines":"Sanofi"},description:`Role responsibilities ${req}`,jobLocation:[{address:{addressCountry:country,addressLocality:"Beijing"}}]})}</script><main id="content"><div class="job-description section7-title"><h1>Role ${req}</h1><a data-job-id="${id}" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=${req}">Apply</a></div><div class="job-description section7-details"><div class="ats-description">Role responsibilities ${req}</div></div></main>`;}
function entry(total:number){return `<section id="search-results" data-ajax-url="/search-results" data-total-pages="1" data-total-job-results="${total}" data-records-per-page="15" data-active-facet-id="0"></section><div id="search-filters"></div>`;}
function listResult(cn:boolean){const ids=cn?[200,201,202]:[100,101];return JSON.stringify({results:`<section id="search-results" data-current-page="1" data-total-pages="1" data-total-job-results="${ids.length}" data-records-per-page="15"><ul id="search-results-list">${ids.map((id,i)=>`<li><button class="js-save-job-btn" data-job-id="${id}"></button><h2>Role R100000${i}</h2><a data-job-id="${id}" href="${detailUrl(cn,id)}">Role</a><span class="job-location">Beijing, China</span></li>`).join("")}</ul></section>`,filters:'<section id="search-filters"><input class="filter-checkbox"></section>',hasJobs:true,hasContent:false});}
describe("Sanofi same-scope dual official native proof",()=>{
 it("preserves the Chinese larger universe and classifies official foreign locations",()=>{
  expect(parseSanofiDetail(detail(true,202,"R1000002","Taiwan"),detailUrl(true,202),"202")?.scope).toBe("OUTSIDE");
  expect(parseSanofiDetail(detail(true,200,"R1000000"),detailUrl(true,200),"200")?.scope).toBe("MAINLAND");
 });
 it("binds the apply button to its own requisition despite a stale footer link",()=>{
   const html=detail(true,200,"R1000000")+'<a data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=R9999999">Apply</a>';
   expect(parseSanofiDetail(html,detailUrl(true,200),"200")?.applyUrl).toBe("https://careersite.tupu360.com/sanofi/position/detail?exid=R1000000");
 });
 it("rejects an English main apply link belonging to a different requisition",()=>{
   const html=detail(false,100,"R1000000").replace("exid=R1000000","exid=R9999999");
   expect(parseSanofiDetail(html,detailUrl(false,100),"100")).toBeUndefined();
 });
 it.each([
  ["foreign main title",(s:string)=>s.replace('<h1>Role R1000000</h1>','<h1>Other job</h1>')],
  ["foreign main JD",(s:string)=>s.replace('<div class="ats-description">Role responsibilities R1000000</div>','<div class="ats-description">Other job in France</div>')],
  ["wrong apply button ID",(s:string)=>s.replace('data-job-id="100"','data-job-id="999"')],
  ["wrong data apply URL",(s:string)=>s.replace('data-job-id="100"','data-job-id="100" data-apply-url="https://careersite.tupu360.com/sanofi/position/detail?exid=R9999999"')],
  ["duplicate main JD",(s:string)=>s.replace('</main>','<div class="job-description section7-details"><div class="ats-description">Role responsibilities R1000000</div></div></main>')],
  ["conflicting main body apply",(s:string)=>s.replace('</div></div></main>','</div><a data-job-id="999" data-selector-name="job-apply-link" href="https://careersite.tupu360.com/sanofi/position/detail?exid=R9999999">Apply</a></div></main>')]
 ])("rejects %s despite matching JSON-LD",(_name,mutate)=>{
  expect(parseSanofiDetail(mutate(detail(false,100,"R1000000")),detailUrl(false,100),"100")).toBeUndefined();
 });
 it("preserves the primary fetcher's retryable HTTP classification",async()=>{
   const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-sanofi-china-social")!;
   const fetched=await createSanofiNativeSourceFetch({now:()=>new Date(time),http:async request=>({status:503,body:"unavailable",finalUrl:request.url,contentType:"text/html",capturedAt:time})})(plan);
   expect(fetched).toMatchObject({ok:false,transportFailure:{code:"OFFICIAL_HTTP_503",retryable:true}});
 });
 it.each([false,true])("certifies exact Chinese equivalence and native applications, Ajinga fallback=%s",async(fallback)=>{
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-sanofi-china-social")!;
  const http:HttpHtmlClient=async request=>{
    const url=new URL(request.url);let body:string,contentType="text/html",finalUrl=request.url;
    if(request.url===english)body=entry(2);
    else if(request.url===SANOFI_CHINESE_ENTRY)body=entry(3);
    else if(url.pathname==="/search-results"){body=listResult(url.hostname.endsWith(".cn"));contentType="application/json";}
    else if(url.hostname==="careersite.tupu360.com"){body=`<input id="positionStatus" value="${fallback&&url.searchParams.get("exid")==="R1000000"?"CLOSED":"PUBLISHING"}"><input id="positionName" value="Role ${url.searchParams.get("exid")}"><input id="positionId" value="${String(url.searchParams.get("exid")).slice(1).padStart(24,"0")}"><input id="recruitmentType" value="SOCIALRECRUITMENT"><div class="position-extend"><span class="city">北京市</span></div><div class="position-description">Role responsibilities ${url.searchParams.get("exid")}</div>`;}
    else if(url.hostname==="www.ajinga.com") {
      if(url.pathname.startsWith("/ats/")){body="<main>Official application route</main>";finalUrl="https://www.ajinga.com/recruiting/company/13537/job/999/job-detail";}
      else {contentType="application/json";body=JSON.stringify(url.pathname.includes("apply-status")?{code:200,data:{show_apply:1,normal_share_url:"https://www.ajinga.com/recruiting/company/13965/job/999/job-detail"}}:
        {code:200,data:{data:{is_in_china:true,company:{id:13965,root_company:{id:13537}},job:{id:999,root_company_id:13537,company:{id:13965},i18n_name:"R1000000 Role",short_unique_id:"abcd",description:"Active native job",job_visibility:"IE",job_locations:[{city:{cn_name:"北京市"}}]}}}});}
    }
    else {const id=Number(url.pathname.split('/').at(-1)),cn=url.hostname.endsWith(".cn"),index=id-(cn?200:100);body=detail(cn,id,`R100000${index}`,index===2?"Taiwan":"China");if(fallback&&!cn&&index===0)body=body.replace("https://careersite.tupu360.com/sanofi/position/detail?exid=R1000000","https://www.ajinga.com/ats/job-detail-new/13537/R1000000/c/?aj_source=sanofi_careersite&aj_code=radancyjoblist");}
    return {status:200,body,finalUrl,contentType,capturedAt:time};
  };
  const fetched=createSanofiNativeSourceFetch({now:()=>new Date(time),http});
  const result=await runSourceCrawl(plan,{fetch:fetched});
  expect(result.truth).toMatchObject({transportSuccess:true,adapterSuccess:true,completenessVerified:true});
  expect(result.jobs).toHaveLength(2);expect(result.jobs.every(j=>j.officialPublishedAt===undefined)).toBe(true);
  expect(result.fetchEvidence!.fetchCounts).toMatchObject({rawCount:2,validCount:2,validationDiscardCount:0});
  const evidence=result.fetchEvidence!,a=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness!.artifactLogicalKey)!;
  const input={binding:{releaseCandidateId:"rc-sanofi",batchId:"batch-sanofi",sourceResultId:"result-sanofi",sourceConfigSha256:sourcePlanConfigSha256(plan)},plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,officialArtifactSha256:sha256Bytes(typeof a.body==="string"?Buffer.from(a.body):a.body).sha256};
  expect(issueAGradeOfficialTotalCertificate(input)).toMatchObject({status:"CERTIFIED",certificate:{counts:{officialTotal:2,finalUniqueJobCount:2,validationDiscardCount:0}}});
  if(!fallback){
    const swapped=structuredClone(evidence),a=swapped.artifacts.find(a=>a.logicalKey==="sanofi-tupu-R1000000")!,b=swapped.artifacts.find(a=>a.logicalKey==="sanofi-tupu-R1000001")!;
    [a.body,b.body]=[b.body,a.body];
    expect(issueAGradeOfficialTotalCertificate({...input,evidence:swapped})).toMatchObject({status:"REJECTED"});
    const temporary=await createSanofiNativeSourceFetch({now:()=>new Date(time),http:async request=>request.url.startsWith("https://careersite.tupu360.com/")?
      {status:503,body:"unavailable",finalUrl:request.url,contentType:"text/html",capturedAt:time}:http(request)})(plan);
    expect(temporary).toMatchObject({ok:false,transportFailure:{code:"OFFICIAL_HTTP_503",retryable:true}});
  }
  expect(JSON.parse(String(evidence.artifacts.find(a=>a.logicalKey==="sanofi-cn-trace")!.body)).fetchCounts.rawCount).toBe(3);
  for(const mutation of ["foreign becomes mainland","status drift","fake date","mixed English main JD","mixed English main apply"]){
    const changed=structuredClone(evidence),outside=changed.artifacts.find(a=>a.logicalKey==="sanofi-cn-detail-202")!;
    if(mutation==="foreign becomes mainland")outside.body=String(outside.body).replace('"addressCountry":"Taiwan"','"addressCountry":"China"');
    if(mutation==="status drift")outside.httpStatus=503;
    if(mutation==="mixed English main JD"){
      const en=changed.artifacts.find(a=>a.logicalKey==="sanofi-en-detail-100")!;
      en.body=String(en.body).replace('<div class="ats-description">Role responsibilities R1000000</div>','<div class="ats-description">Other job in France</div>');
    }
    if(mutation==="mixed English main apply"){
      const en=changed.artifacts.find(a=>a.logicalKey==="sanofi-en-detail-100")!;
      en.body=String(en.body).replace('data-job-id="100"','data-job-id="999"');
    }
    expect(issueAGradeOfficialTotalCertificate({...input,evidence:changed,...(mutation==="fake date"?{jobs:result.jobs.map(j=>({...j,officialPublishedAt:time}))}:{})})).toMatchObject({status:"REJECTED"});
  }
  if(!fallback){
    const foreign=structuredClone(evidence);
    for(const a of foreign.artifacts.filter(a=>a.logicalKey.startsWith("sanofi-tupu-")))a.body=String(a.body).replace("北京市","香港");
    expect(issueAGradeOfficialTotalCertificate({...input,evidence:foreign,jobs:result.jobs.map(j=>({...j,locationRaw:"香港",cities:["城市待核"]}))})).toMatchObject({status:"REJECTED"});
  }
  const missing=structuredClone(evidence);missing.artifacts=missing.artifacts.filter(a=>a.logicalKey!=="sanofi-cn-detail-202");
  expect(issueAGradeOfficialTotalCertificate({...input,evidence:missing})).toMatchObject({status:"REJECTED"});
  expect(issueAGradeOfficialTotalCertificate({...input,jobs:result.jobs.map(j=>({...j,cities:["上海"]}))})).toMatchObject({status:"REJECTED"});
 });
});
