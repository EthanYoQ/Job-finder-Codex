// @vitest-environment node
import { describe,it,expect,vi } from "vitest";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans,sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createSanofiChineseSourceFetch,parseSanofiChineseDetail,parseSanofiChineseNative,replaySanofiChineseNative,SANOFI_CN_ENTRY,sanofiChineseLocation,sanofiHash } from "../../src/crawler/sanofiChineseNative";
import { captureSanofiChineseIndependent,replaySanofiChineseIndependent,type SanofiChineseDomCapture } from "../../src/crawler/sanofiChineseRenderedTraversal";
import { SANOFI_LEGACY_IDENTITY,sanofiPersistentJobId } from "../../src/crawler/sanofiLegacyIdentity";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,readReusableBGradeTraversalValidation } from "../../src/crawler/traversalCertificate";
import { requiresAGradeCertificateSourceId } from "../../src/crawler/completenessCertificate";
import type { HttpHtmlClient } from "../../src/crawler/httpHtmlSourceFetch";
import { applyCrawlObservation } from "../../src/crawler/lifecycle";
const AT="2026-10-04T03:00:00.000Z",LATER="2026-10-04T03:01:00.000Z",EXPIRES="2026-10-04T03:30:00.000Z";
const plan=()=>buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-sanofi-china-social")!;
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
describe("Sanofi Chinese-only native source contract",()=>{
  it("keeps the Chinese original universe and audits foreign/closed rows without rewriting the total",async()=>{
    const {result,requests}=await collect();expect(result.status,JSON.stringify(result)).toBe("SUCCESS");expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(1);expect(result.jobs[0]).toMatchObject({sourceJobId:"sanofi-req:R9000001",cities:["南宁"],listUrl:SANOFI_CN_ENTRY});
    expect(result.fetchEvidence?.fetchCounts).toEqual({rawCount:3,parsedCount:3,validCount:1,parseDiscardCount:0,validationDiscardCount:2});
    expect(result.fetchEvidence?.pages[0]?.declaredTotal).toBe(3);expect(result.fetchEvidence?.declaredCompleteness).toMatchObject({kind:"COMPLETE_PAGE_TRAVERSAL",value:1});
    expect(result.observation.expectedJobCount).toBeUndefined();expect(result.fetchEvidence?.fetchLosses.map(l=>l.details.code)).toEqual(["SANOFI_CN_OFFICIAL_OUTSIDE_MAINLAND","SANOFI_CN_NATIVE_CLOSED"]);
    const anomalies=JSON.parse(String(result.fetchEvidence?.artifacts.find(a=>a.logicalKey==="sanofi-cn-module-anomalies-v2")?.body));expect(anomalies.entries).toMatchObject([{id:"101",foreignId:"999",foreignReq:"R9999999"}]);
    expect(requests.every(u=>new URL(u).hostname!=="jobs.sanofi.com"&&new URL(u).hostname!=="www.ajinga.com")).toBe(true);
    expect(requiresAGradeCertificateSourceId("source-sanofi-china-social")).toBe(false);
  });
  it("requires current independently enumerated Chinese UI and new native requests for a real B receipt",async()=>{
    const {p,result,http,requests}=await collect();const before=requests.length;
    const captured=await captureSanofiChineseIndependent({dom:dom(),http:async r=>({...await http(r),capturedAt:LATER}),now:()=>new Date(LATER)});
    expect(requests.length-before).toBe(5);expect(replaySanofiChineseIndependent(captured.pages)).toMatchObject({rawCount:3,excludedCount:2,matchKeys:["sanofi-req:R9000001"]});
    const validation=createOfficialJsonRenderedTraversalValidation({sourceId:p.source.id as "source-sanofi-china-social",companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:captured.pages,observedAt:AT,expiresAt:EXPIRES});
    const input={plan:p,binding:{releaseCandidateId:"test-sanofi",batchId:"test-batch",sourceResultId:"test-result",sourceConfigSha256:sourcePlanConfigSha256(p)},transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,independentValidation:validation,validationExecution:"CURRENT_RUN" as const,trigger:"INITIAL_QUALIFICATION" as const,now:new Date(LATER)};
    const issued=issueBGradeTraversalCertificate(input);expect(issued).toMatchObject({status:"CERTIFIED",certificate:{grade:"B",counts:{validationDiscardCount:2,finalUniqueJobCount:1}}});
    expect(issueBGradeTraversalCertificate({...input,validationExecution:"REUSED"})).toMatchObject({status:"REJECTED"});
    if(issued.status==="CERTIFIED")expect(()=>readReusableBGradeTraversalValidation({certificate:issued.certificate,certificateSha256:issued.certificateSha256,sourceConfigSha256:sourcePlanConfigSha256(p),now:new Date(LATER)})).toThrow();
    // Same raw Chinese row and output count cannot hide a different excluded Req.
    const drift=structuredClone(captured.pages) as any,changed=drift[0].rawRows[1];
    changed.rawPayload.detailResponse.body=changed.rawPayload.detailResponse.body.replaceAll("R9000002","R9000008");
    changed.rawPayload.detailResponse.bodySha256=sanofiHash(changed.rawPayload.detailResponse.body);changed.sourceJobId="sanofi-req:R9000008";
    const driftValidation=createOfficialJsonRenderedTraversalValidation({sourceId:p.source.id as "source-sanofi-china-social",companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:drift,observedAt:AT,expiresAt:EXPIRES});
    expect(issueBGradeTraversalCertificate({...input,independentValidation:driftValidation})).toMatchObject({status:"REJECTED",blockerCodes:expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"])});
    for(const kind of ["body","req","missing","scope","rawId","terminal"]){const bad=structuredClone(captured.pages) as any;const payload=bad[0].rawRows[0].rawPayload;
      if(kind==="body")payload.nativeResponse.body+=" ";if(kind==="req")payload.detailResponse.url=url(2);if(kind==="missing")bad[0].rawRows.pop();if(kind==="scope")bad[0].rawRows[1].scopeDecision="INCLUDED_MAINLAND";if(kind==="rawId")bad[0].rawRows[0].rawEvidenceId="sha256:"+"a".repeat(64);if(kind==="terminal")payload.domPage.searchResultsHtml=payload.domPage.searchResultsHtml.replace('class="next disabled"','class="next"');
      expect(()=>replaySanofiChineseIndependent(bad),kind).toThrow();}
  });
  it.each(["status","city","company","nativeJD","topId","metaReq","unexplainedJD"])("rejects unknown or conflicting %s without manufacturing closure",async kind=>{
    const {result}=await collect((url,body)=>{if(url.endsWith('/101')){if(kind==="topId")return body.replace('data-job-id="101"','data-job-id="102"');if(kind==="metaReq")return body.replace('content="R9000001"','content="R9000002"');if(kind==="unexplainedJD")return body.replace('data-job-id="999"','data-job-id="101"');}
      if(url.includes('exid=R9000001')){if(kind==="status")return body.replace('PUBLISHING','UNKNOWN');if(kind==="city")return body.replace('广西壮族自治区-南宁','APAC');if(kind==="company")return body.replace('赛诺菲（中国）投资有限公司上海分公司','其他公司');if(kind==="nativeJD")return body.replace(description(1),description(2));}return body;});
    expect(result.status).toBe("FAILED");expect(result.jobs).toEqual([]);expect(result.truth.completenessVerified).toBe(false);
  });
  it("binds every ledger row and anomaly back to original Chinese evidence",async()=>{
    const {p,result}=await collect();for(const kind of ["lossCode","lossIndex","rawCount","missingDetail","anomaly","job"]){const e=structuredClone(result.fetchEvidence!),jobs=structuredClone(result.jobs);
      if(kind==="lossCode")e.fetchLosses[0]!.details.code="OUT_OF_SCOPE";if(kind==="lossIndex")e.fetchLosses[0]!.details.recordIndex=0;if(kind==="rawCount")e.fetchCounts.rawCount++;if(kind==="missingDetail")e.artifacts=e.artifacts.filter(a=>a.logicalKey!=="sanofi-cn-detail-102");if(kind==="anomaly")e.artifacts.find(a=>a.logicalKey==="sanofi-cn-module-anomalies-v2")!.body=JSON.stringify({schemaVersion:2,entries:[]});
      if(kind==="job"){jobs[0]!.cities=["广州"];expect(replaySanofiChineseNative(p,e,false).jobs).not.toEqual(jobs);}else expect(()=>replaySanofiChineseNative(p,e,false),kind).toThrow();}
  });
  it("continues proven historical Req identities and retains original observation times",async()=>{
    expect(SANOFI_LEGACY_IDENTITY.entries).toHaveLength(88);expect(new Set(SANOFI_LEGACY_IDENTITY.entries.map(r=>r.reqId)).size).toBe(88);
    expect(sanofiPersistentJobId("R2872010")).toBe("44967347712");const {result}=await collect();const record={...result.jobs[0]!,sourceJobId:sanofiPersistentJobId("R2872010")},key=`${record.sourceId}:${record.sourceJobId}`;
    const prior={record,dedupeKey:key,lifecycleStatus:"ACTIVE" as const,missingSuccessfulCrawlCount:0,firstSeenAt:"2026-09-27T01:15:57.062Z",lastSeenAt:"2026-10-03T04:47:14.374Z"};
    const rows=applyCrawlObservation([prior],[record],{observedAt:LATER,baselineCompletedBeforeCrawl:true,observation:{disposition:"TRUSTED_COMPLETE",atomicCommitEligible:true}});
    expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({firstSeenAt:prior.firstSeenAt,lastSeenAt:LATER,dedupeKey:key,isNew:false});expect(prior.lastSeenAt).toBe("2026-10-03T04:47:14.374Z");
  });
  it("does not infer mainland scope from an unfamiliar Chinese locality",()=>{expect(()=>sanofiChineseLocation("神秘市")).toThrow();expect(sanofiChineseLocation("中国")).toEqual({locationRaw:"中国",cities:["城市待核"]});});
});
