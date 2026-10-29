// @vitest-environment node
import { describe,it,expect,vi } from "vitest";
import { createHash } from "node:crypto";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans,sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createSanofiChineseSourceFetch,parseSanofiChineseDetail,parseSanofiChineseNative,replaySanofiChineseNative,SANOFI_CN_ENTRY,sanofiChineseLocation,sanofiHash,sanofiDescription } from "../../src/crawler/sanofiChineseNative";
import { captureSanofiChineseIndependent,replaySanofiChineseIndependent,type SanofiChineseDomCapture } from "../../src/crawler/sanofiChineseRenderedTraversal";
import { SANOFI_LEGACY_IDENTITY,sanofiPersistentJobId } from "../../src/crawler/sanofiLegacyIdentity";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,readReusableBGradeTraversalValidation,verifyBGradeTraversalCertificateReceipt } from "../../src/crawler/traversalCertificate";
import { requiresAGradeCertificateSourceId } from "../../src/crawler/completenessCertificate";
import type { HttpHtmlClient } from "../../src/crawler/httpHtmlSourceFetch";
import { applyCrawlObservation } from "../../src/crawler/lifecycle";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import { executeAtomicSourceEvidenceCommit, executePortableAtomicSourceEvidenceCommit, compilePortableAtomicSourceEvidenceSql, compileDbStartedCloudSourcePublication, type PrismaAtomicSourceEvidenceDb } from "../../src/db/ingestionRepository";
import { acquirePortableCrawlLease, releasePortableCrawlLease, type PortableLeaseDatabase } from "../../src/crawler/portableCrawlLease";
import { CLOUD_PILOT_SQL45 } from "../../src/db/cloudPilotSql45Manifest";
import { deriveCurrentStagedScheduleExpectation } from "../../src/crawler/stagedScheduleAuthority";

// The optional existing PGlite harness exercises actual SQL freshness gates.
const localSqlModule=process.env.PGLITE_MODULE;
const AT=localSqlModule?new Date(Date.now()-120_000).toISOString():"2026-10-04T03:00:00.000Z";
const LATER=new Date(Date.parse(AT)+60_000).toISOString(),EXPIRES=new Date(Date.parse(AT)+30*60_000).toISOString();
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
// Public synthetic copy only; no production JD or saved HTTP body is committed.
const encodingNativeDescription="职责：协调内外部客户需求，完成地区团队的日常服务和信息沟通。要求：准确记录并核对客户反馈。";
const encodingChineseDescription=encodingNativeDescription.replace("内外部","内���部");
function encodingDetail(){return detail(1).replaceAll(description(1),encodingChineseDescription);}
function encodingNative(){return native(1).replace(description(1),encodingNativeDescription)+`<script>var prevPositionId = "${String(1).padStart(24,"0")}";</script>`;}
const canonicalTestJson=(value:unknown):string=>value===null||typeof value!=="object"?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonicalTestJson).join(",")}]`:`{${Object.entries(value).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([k,v])=>`${JSON.stringify(k)}:${canonicalTestJson(v)}`).join(",")}}`;
const encodingResponse=(url:string,body:string)=>url.endsWith("/101")?encodingDetail():url.endsWith("exid=R9000001")?encodingNative():body;
describe("Sanofi Chinese-only native source contract",()=>{
  it("accepts literal and escaped JSON-LD TABs without changing description values or raw bodies",()=>{
    const original=detail(1),expected=parseSanofiChineseDetail(original,row(1));
    for(const encoded of ["\t","\\t"]){
      const raw=original.replace(`"description":"${description(1)}"`,`"description":"中文职责${encoded}和要求1"`);
      expect(parseSanofiChineseDetail(raw,row(1))).toEqual(expected);
      expect(raw).toContain(`"description":"中文职责${encoded}和要求1"`);
    }
  });
  it.each(["\\\t","\n","\r","\u0000"])("rejects malformed JSON-LD string control %j",control=>{
    const raw=detail(1).replace(`"description":"${description(1)}"`,`"description":"中文职责${control}和要求1"`);
    expect(()=>parseSanofiChineseDetail(raw,row(1))).toThrow();
  });
  it("retains duplicate-key and title guards after TAB compatibility",()=>{
    const raw=detail(1).replace(`"description":"${description(1)}"`,`"description":"中文职责\t和要求1"`);
    expect(()=>parseSanofiChineseDetail(raw.replace('"@type":"JobPosting"','"@type":"JobPosting","@type":"JobPosting"'),row(1))).toThrow();
    expect(()=>parseSanofiChineseDetail(raw.replace(`"title":"${title(1)}"`,'"title":"其他岗位"'),row(1))).toThrow();
  });
  it("replays a single Chinese display replacement triplet using the unchanged same-Req native authority through the B reader",async()=>{
    const {p,result,http}=await collect(encodingResponse);
    expect(result.status).toBe("SUCCESS");expect(result.truth.completenessVerified).toBe(true);
    const main=replaySanofiChineseNative(p,result.fetchEvidence!,false);
    expect(main.anomalies).toEqual([{code:"SANOFI_CN_REPLACEMENT_CHARACTER_NATIVE_AUTHORITY",id:"101",reqId:req(1),nativePositionId:String(1).padStart(24,"0"),
      applyUrl:`https://careersite.tupu360.com/sanofi/position/detail?exid=${req(1)}`,nativeLocationRaw:"广西壮族自治区-南宁",nativeCities:["南宁"],chineseDescriptionSha256:sanofiHash(sanofiDescription(encodingChineseDescription)),
      nativeDescriptionSha256:sanofiHash(sanofiDescription(encodingNativeDescription)),normalizedUtf16Offset:encodingChineseDescription.indexOf("�"),replacementCharacterCount:3,nativeCharacterCount:1}]);
    expect(result.fetchEvidence!.artifacts.find(a=>a.logicalKey==="sanofi-cn-detail-101")!.body).toBe(encodingDetail());
    expect(result.fetchEvidence!.artifacts.find(a=>a.logicalKey==="sanofi-cn-tupu-R9000001")!.body).toBe(encodingNative());
    const captured=await captureSanofiChineseIndependent({dom:dom(),http:async r=>({...await http(r),capturedAt:LATER}),now:()=>new Date(LATER)});
    expect(replaySanofiChineseIndependent(captured.pages).descriptionAnomalies).toEqual(main.anomalies);
    const validationInput={sourceId:p.source.id as "source-sanofi-china-social",companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:captured.pages,observedAt:AT,expiresAt:EXPIRES};
    const validation=createOfficialJsonRenderedTraversalValidation(validationInput);
    const input={plan:p,binding:{releaseCandidateId:"test-sanofi",batchId:"test-batch",sourceResultId:"test-result",sourceConfigSha256:sourcePlanConfigSha256(p)},transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,independentValidation:validation,validationExecution:"CURRENT_RUN" as const,trigger:"INITIAL_QUALIFICATION" as const,now:new Date(LATER)};
    const issued=issueBGradeTraversalCertificate(input);expect(issued.status).toBe("CERTIFIED");if(issued.status!=="CERTIFIED")throw Error("Expected synthetic B receipt");
    const readerInput={certificate:issued.certificate,certificateSha256:issued.certificateSha256,expected:{...input.binding,sourceId:p.source.id,companyId:p.company.id,surfaceIds:validationInput.surfaceIds,channelIds:validationInput.channelIds,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(replaySanofiChineseIndependent(captured.pages).rawEvidenceIds),sanofiArtifacts:result.fetchEvidence!.artifacts.map(a=>({...input.binding,sourceId:p.source.id,kind:a.kind,extractorLocator:a.extractorLocator,sha256:sanofiHash(String(a.body))}))},now:new Date(LATER)};
    expect(verifyBGradeTraversalCertificateReceipt(readerInput)).toMatchObject({status:"PASS",grade:"B",finalUniqueJobCount:1});
    for(const kind of ["missing","offset","nativeId","hash","extra"]){
      const evidence=structuredClone(result.fetchEvidence!),a=evidence.artifacts.find(a=>a.logicalKey==="sanofi-cn-module-anomalies-v2")!,ledger=JSON.parse(String(a.body));
      if(kind==="missing")ledger.entries=[];if(kind==="offset")ledger.entries[0].normalizedUtf16Offset++;if(kind==="nativeId")ledger.entries[0].nativePositionId="f".repeat(24);if(kind==="hash")ledger.entries[0].nativeDescriptionSha256="f".repeat(64);if(kind==="extra")ledger.entries.push({...ledger.entries[0]});
      a.body=JSON.stringify(ledger);expect(()=>replaySanofiChineseNative(p,evidence,false),kind).toThrow();
      const pages=structuredClone(captured.pages) as any,payload=pages[0].rawRows[0].rawPayload;
      if(kind==="missing")delete payload.descriptionAnomaly;if(kind==="offset")payload.descriptionAnomaly.normalizedUtf16Offset++;if(kind==="nativeId")payload.descriptionAnomaly.nativePositionId="f".repeat(24);if(kind==="hash")payload.descriptionAnomaly.nativeDescriptionSha256="f".repeat(64);if(kind==="extra")payload.descriptionAnomaly.extra=true;
      expect(()=>replaySanofiChineseIndependent(pages),kind).toThrow();
      expect(()=>createOfficialJsonRenderedTraversalValidation({...validationInput,pages}),kind).toThrow();
      const certificate=structuredClone(issued.certificate) as any,v=certificate.independentValidation;v.pages=v.pages.map((page:any,i:number)=>({...page,rawRows:pages[i].rawRows}));
      v.artifactSha256=sanofiHash(canonicalTestJson({sourceId:v.sourceId,retrievalPath:v.retrievalPath,matchKeyKind:v.matchKeyKind,pages:v.pages,observedAt:v.observedAt}));
      expect(()=>verifyBGradeTraversalCertificateReceipt({...readerInput,certificate,certificateSha256:sanofiHash(canonicalTestJson(certificate))}),kind).toThrow("SANOFI_CN_INDEPENDENT_EVIDENCE_INVALID");
    }
    const wrongUrl=structuredClone(captured.pages) as any;wrongUrl[0].rawRows[0].rawPayload.nativeResponse.url=`https://careersite.tupu360.com/sanofi/position/detail?exid=${req(2)}`;
    expect(()=>replaySanofiChineseIndependent(wrongUrl)).toThrow();
    // Even two individually valid native pages cannot silently disagree on native identity.
    const drift=structuredClone(captured.pages) as any,payload=drift[0].rawRows[0].rawPayload;
    payload.nativeResponse.body=payload.nativeResponse.body.replaceAll(String(1).padStart(24,"0"),"f".repeat(24));payload.nativeResponse.bodySha256=sanofiHash(payload.nativeResponse.body);payload.descriptionAnomaly.nativePositionId="f".repeat(24);
    const driftValidation=createOfficialJsonRenderedTraversalValidation({...validationInput,pages:drift});
    expect(issueBGradeTraversalCertificate({...input,independentValidation:driftValidation})).toMatchObject({status:"REJECTED",blockerCodes:expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"])});
    const cityDrift=structuredClone(captured.pages) as any,cityPayload=cityDrift[0].rawRows[0].rawPayload;
    cityPayload.nativeResponse.body=cityPayload.nativeResponse.body.replace("广西壮族自治区-南宁","辽宁省-沈阳");cityPayload.nativeResponse.bodySha256=sanofiHash(cityPayload.nativeResponse.body);
    cityPayload.descriptionAnomaly.nativeLocationRaw="辽宁省-沈阳";cityPayload.descriptionAnomaly.nativeCities=["沈阳"];
    const cityValidation=createOfficialJsonRenderedTraversalValidation({...validationInput,pages:cityDrift});
    expect(issueBGradeTraversalCertificate({...input,independentValidation:cityValidation})).toMatchObject({status:"REJECTED",blockerCodes:expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"])});
  });
  it.each(["normal-conflict","additional-conflict","two-runs","one-replacement","four-replacements","english-replacement","non-han-symbol","two-native-characters","native-corrupt","missing-schema-JD","missing-visible-JD","missing-native-JD","foreign-module","wrong-top-id","wrong-module-id","wrong-req","wrong-native-id","malformed-native-id","duplicate-native-id","missing-native-id-binding","wrong-title","outside-city","outside-country","closed","internship"])("rejects %s instead of broadening the encoding exception",async kind=>{
    const change=(url:string,body:string)=>{
      let changed=encodingResponse(url,body);
      if(url.endsWith("/101")){
        if(kind==="normal-conflict")changed=changed.replaceAll("���","另");
        if(kind==="two-runs")changed=changed.replaceAll("地区","地���");
        if(kind==="one-replacement")changed=changed.replaceAll("���","�");
        if(kind==="four-replacements")changed=changed.replaceAll("���","����");
        if(kind==="missing-schema-JD")changed=changed.replace(`"description":"${encodingChineseDescription}"`,'"description":""');
        if(kind==="missing-visible-JD")changed=changed.replace(`<div class="ats-description">${encodingChineseDescription}</div>`,'<div class="ats-description"></div>');
        if(kind==="foreign-module")changed=detail(1,"China",true).replaceAll(description(1),encodingChineseDescription);
        if(kind==="wrong-top-id")changed=changed.replace('data-job-id="101"','data-job-id="102"');
        if(kind==="wrong-module-id")changed=changed.replace('section7-details" data-job-id="101"','section7-details" data-job-id="102"');
        if(kind==="wrong-req")changed=changed.replace('content="R9000001"','content="R9000002"');
        if(kind==="outside-country")changed=changed.replace('"addressCountry":"China"','"addressCountry":"Unknown"');
      }
      if(url.endsWith("exid=R9000001")){
        if(kind==="additional-conflict")changed=changed.replace("日常服务","销售管理");
        if(kind==="english-replacement")changed=changed.replace("内外部","内A部");
        if(kind==="non-han-symbol")changed=changed.replace("内外部","内䷀部");
        if(kind==="two-native-characters")changed=changed.replace("内外部","内外外部");
        if(kind==="native-corrupt")changed=changed.replace("内外部","内�部");
        if(kind==="missing-native-JD")changed=changed.replace(encodingNativeDescription,"");
        if(kind==="wrong-native-id")changed=changed.replace(`id="positionId" value="${String(1).padStart(24,"0")}"`,'id="positionId" value="ffffffffffffffffffffffff"');
        if(kind==="malformed-native-id")changed=changed.replace(`id="positionId" value="${String(1).padStart(24,"0")}"`,'id="positionId" value="wrong"');
        if(kind==="duplicate-native-id")changed+='<input id="positionId" value="ffffffffffffffffffffffff">';
        if(kind==="missing-native-id-binding")changed=changed.replace(/<script>.*<\/script>/u,"");
        if(kind==="wrong-title")changed=changed.replace(title(1),title(2));
        if(kind==="outside-city")changed=changed.replace("广西壮族自治区-南宁","中国台湾-台北");
        if(kind==="closed")changed=changed.replace("PUBLISHING","CLOSED");
        if(kind==="internship")changed=changed.replace("SOCIALRECRUITMENT","INTERNSHIPRECRUITMENT");
      }
      return changed;
    };
    const {result,http}=await collect(change);expect(result.status,kind).toBe("FAILED");expect(result.jobs).toEqual([]);expect(result.truth.completenessVerified).toBe(false);
    await expect(captureSanofiChineseIndependent({dom:dom(),http:async r=>({...await http(r),capturedAt:LATER}),now:()=>new Date(LATER)}),kind).rejects.toThrow();
  });

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
  it.each(["贵州省-黔南州","贵州省-黔东南州","贵州省-黔西南州","青海省-海南州","广东省-广州市","江苏省-苏州"])("accepts reviewed same-province native label %s without losing its raw spelling",raw=>{
    const city=raw.split("-").at(-1)!.replace(/市$/u,"");
    expect(sanofiChineseLocation(raw)).toEqual({locationRaw:raw,cities:[city]});
  });
  it.each(["广东省-黔南州","贵州省-神秘州","贵州省-黔南州州","香港-九龙州","台湾-台北州","日本-东京州"])("rejects unknown or conflicting native label %s",raw=>{
    expect(()=>sanofiChineseLocation(raw)).toThrow("SANOFI_CN_GEOGRAPHY_UNKNOWN");
  });
  it("does not infer mainland scope from an unfamiliar Chinese locality",()=>{expect(()=>sanofiChineseLocation("神秘市")).toThrow();expect(sanofiChineseLocation("中国")).toEqual({locationRaw:"中国",cities:["城市待核"]});});
  it("admits a Chinese B atomic bundle and rejects one missing, changed or extra persisted loss in both SQL routes",async()=>{
    const {p,result,http}=await collect(),batchId="synthetic-sanofi-cn-atomic",sourceIds=[p.source.id];
    const buildBase={schemaVersion:2 as const,commitSha:"a".repeat(40),sourceTreeSha256:"b".repeat(64),runtimeTreeSha256:"c".repeat(64)};
    const build={...buildBase,contentSha256:createHash("sha256").update(JSON.stringify(buildBase)).digest("hex")};
    const expectation=deriveCurrentStagedScheduleExpectation(build);
    const candidate={id:"synthetic-sanofi-cn",goalId:"jobfinder-portable-required-40",version:10};
    const common={projectId:"yiopvxysxrtrnvqxwgbx",build,candidate};
    const identity={releaseCandidateId:candidate.id,commitSha:expectation.commitSha,rosterSha256:expectation.rosterSha256,sourcePlanSha256:expectation.sourcePlanSha256,sourceConfigSha256:expectation.sourceConfigSha256,adapterBundleSha256:expectation.adapterBundleSha256,batchKind:"SCHEDULED" as const,ownerId:"dot-cloud-sanofi-china-social-pilot",expectedPlannedSourceIds:sourceIds,expectedPlannedSourceSetSha256:canonicalStringSetSha256(sourceIds),expectedPlannedSourceCount:1};
    const planned=buildPendingRuntimeBatch(batchId,[p],identity,new Date(AT)),pending=planned.sources[0]!;
    const tuple={releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:p.source.id,sourceResultId:pending.id};
    const workspaceRoot=await mkdtemp(join(tmpdir(),"sanofi-cn-atomic-"));
    try {
      const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:"evidence",captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
      const captured=await captureSanofiChineseIndependent({dom:dom(),http:async r=>({...await http(r),capturedAt:LATER}),now:()=>new Date(LATER)});
      const independentValidation=createOfficialJsonRenderedTraversalValidation({sourceId:"source-sanofi-china-social",companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:captured.pages,observedAt:AT,expiresAt:EXPIRES});
      const input={plan:p,pending,identity,batchId,result,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archive.artifacts,completedAt:new Date(LATER),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1" as const};
      const uncertified=buildAtomicRuntimeCommit(input);
      expect(uncertified.sourceResult).toMatchObject({completenessState:"NEEDS_MANUAL_COMPLETENESS_REVIEW",completenessCertificate:null,blockerCode:"B_GRADE_CERTIFICATE_NOT_ISSUED"});
      expect(uncertified.commands.filter(c=>c.type==="UPSERT_JOB")).toEqual([]);
      const commit=buildAtomicRuntimeCommit({...input,independentTraversalValidation:independentValidation,independentTraversalValidationExecution:"CURRENT_RUN",independentTraversalValidationTrigger:"INITIAL_QUALIFICATION"});
      expect(commit.sourceResult).toMatchObject({completenessState:"VERIFIED",expectedJobCount:null,expectedEvidenceKind:"COMPLETE_PAGE_TRAVERSAL",rawCount:3,parsedCount:3,validationDiscardCount:2,dedupeOutputCount:1,completenessCertificate:{grade:"B",counts:{validationDiscardCount:2,finalUniqueJobCount:1}}});
      const written:string[]=[];let holder="";
      const lease=await acquirePortableCrawlLease({$transaction:async work=>work({$queryRawUnsafe:async <T>(_sql:string,...values:unknown[])=>{holder=String(values[1]);return [{holderId:holder}] as T;}})});
      const tx={$queryRawUnsafe:async(sql:string)=>sql.startsWith("SELECT")?[{id:"formal-crawl"}]:[{holderId:holder}],evidenceArtifact:{create:async()=>undefined},paginationEvidence:{create:async()=>undefined},lossLedgerEntry:{create:async()=>undefined},transportAttemptEvidence:{create:async()=>undefined},transportAttemptArtifact:{create:async()=>undefined},crawlObservation:{create:async()=>undefined},job:{upsert:async({create}:any)=>{written.push(create.sourceJobId);}},lifecycleSetEvidenceMember:{create:async()=>undefined},crawlBatchSourceResult:{updateMany:async()=>({count:1})}};
      const db:PrismaAtomicSourceEvidenceDb={$transaction:async work=>work(tx as never)};
      await expect(executeAtomicSourceEvidenceCommit(commit,db)).rejects.toThrow("PORTABLE_PUBLICATION_LEASE_REQUIRED");
      expect(written).toEqual([]);
      await expect(executePortableAtomicSourceEvidenceCommit(commit,lease,db)).resolves.toBeUndefined();
      expect(written).toEqual(["sanofi-req:R9000001"]);
      if(localSqlModule){
        const {PGlite}=await import(/* @vite-ignore */ pathToFileURL(resolve(localSqlModule)).href);
        const {pgcrypto}=await import(/* @vite-ignore */ pathToFileURL(resolve(localSqlModule,"../contrib/pgcrypto.js")).href);
        const pg=await PGlite.create({extensions:{pgcrypto}});
        try {
          expect(CLOUD_PILOT_SQL45.migrations).toHaveLength(48);
          for(const migration of CLOUD_PILOT_SQL45.migrations){
            // The existing local SQL harness omits this data-only historical roster repair.
            if(migration.migrationName==="20260927120000_p0_launch_cohort_41_companies")continue;
            await pg.exec(await readFile(`prisma/migrations/${migration.migrationName}/migration.sql`,"utf8"));
          }
          expect((await pg.query("SELECT md5(pg_get_functiondef(to_regprocedure('public.enforce_source_result_state_machine()'))) AS hash")).rows).toEqual([{hash:CLOUD_PILOT_SQL45.sourceResultGuardMd5}]);
          vi.stubEnv("JOBFINDER_CLOUD_SOURCE_ID",p.source.id);
          const {compileCloudPilotCandidateSql,compileCloudPilotPublicationContextSql}=await import("../../src/db/cloudPilotSqlControl");
          const insert=async(table:string,data:Record<string,unknown>)=>{const columns=Object.keys(data).map(k=>`"${k}"`).join(", ");await pg.query(`INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::"${table}", $1::jsonb)`,[JSON.stringify(data)]);};
          await pg.exec('CREATE TABLE "_prisma_migrations" (id text,migration_name text,checksum text,finished_at timestamptz,rolled_back_at timestamptz)');
          for(const migration of CLOUD_PILOT_SQL45.migrations)await pg.query('INSERT INTO "_prisma_migrations" VALUES($1,$1,$2,clock_timestamp(),null)',[migration.migrationName,migration.checksum]);
          await insert("ReleaseCandidate",{...CLOUD_PILOT_SQL45.currentCandidate,rosterHash:"0".repeat(64),sourcePlanHash:"0".repeat(64),sourceConfigHash:"0".repeat(64),adapterBundleHash:"0".repeat(64),sourceTreeHash:"0".repeat(64),runtimeTreeHash:"0".repeat(64),oracleVersion:"historical"});
          await insert("Company",{id:p.company.id,officialChineseName:p.company.officialChineseName,officialWebsiteUrl:p.source.officialEntryUrl,pinyinName:"synthetic",inclusionReason:"synthetic only",updatedAt:new Date()});
          await insert("RecruitmentSource",{id:p.source.id,companyId:p.company.id,kind:p.source.kind,atsKind:p.source.atsKind,status:p.source.status,officialEntryUrl:p.source.officialEntryUrl,officialChainEvidenceUrl:p.source.officialChainEvidenceUrl,updatedAt:new Date()});
          await pg.exec(compileCloudPilotCandidateSql({...common,expiresAt:EXPIRES}));
          const checkSql=async(sql:string,mode:"portable"|"db-started")=>{
            expect(sql.match(/DO \$atomic_/g)).toHaveLength(1);
            expect(sql.match(/B_GRADE_PERSISTED_LOSS_MISMATCH/g)).toHaveLength(1);
            // Evaluate the actual generated INSERT payload before mutating it:
            // adjacent losses are batched, so deleting its statement is not a one-row test.
            const lossStart=sql.indexOf('INSERT INTO public."LossLedgerEntry"'),lossEnd=sql.indexOf(";\n",lossStart)+2;
            expect(lossStart).toBeGreaterThan(-1);expect(lossEnd).toBeGreaterThan(lossStart);
            const statement=sql.slice(lossStart,lossEnd),marker='NULL::public."LossLedgerEntry", ';
            const expression=statement.slice(statement.indexOf(marker)+marker.length).replace(/\);\s*$/u,"");
            const rows=(await pg.query(`SELECT ${expression} AS rows`)).rows[0].rows as Record<string,any>[];
            expect(rows).toHaveLength(2);expect(new Set(rows.map(row=>row.id)).size).toBe(2);
            await pg.exec("SAVEPOINT seeded_source");
            const leaseBefore=(await pg.query('SELECT to_jsonb(l) AS row FROM "CrawlCoordinatorLock" l')).rows;
            await pg.exec(sql);await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
            expect((await pg.query('SELECT "rawCount", "dedupeOutputCount", "validationDiscardCount", "expectedJobCount", "expectedEvidenceKind", "atomicCommitState" FROM "CrawlBatchSourceResult"')).rows).toEqual([{rawCount:3,dedupeOutputCount:1,validationDiscardCount:2,expectedJobCount:null,expectedEvidenceKind:"COMPLETE_PAGE_TRAVERSAL",atomicCommitState:"COMMITTED"}]);
            expect((await pg.query('SELECT "sourceJobId", "city" FROM "Job"')).rows).toEqual([{sourceJobId:"sanofi-req:R9000001",city:"南宁"}]);
            expect((await pg.query('SELECT "details"->>\'code\' AS code FROM "LossLedgerEntry" ORDER BY code')).rows).toEqual([{code:"SANOFI_CN_NATIVE_CLOSED"},{code:"SANOFI_CN_OFFICIAL_OUTSIDE_MAINLAND"}]);
            expect((await pg.query('SELECT "setKind" FROM "LifecycleSetEvidenceMember" ORDER BY "setKind"')).rows).toEqual([{setKind:"CURRENT"},{setKind:"VISIBLE"}]);
            if(mode==="db-started")expect((await pg.query('SELECT status FROM "CrawlBatch"')).rows).toEqual([{status:"SUCCESS"}]);
            await pg.exec("ROLLBACK TO SAVEPOINT seeded_source");
            for(const mutation of ["one-missing","details-changed","stage-changed","locator-changed","id-replaced","one-extra"] as const){
              const changed=structuredClone(rows);
              if(mutation==="one-missing")changed.splice(0,1);
              if(mutation==="details-changed")changed[0]!.details.code="WRONG_AUDIT_CODE";
              if(mutation==="stage-changed")changed[0]!.stage="PARSE";
              if(mutation==="locator-changed")changed[0]!.rawLocator+="#changed";
              if(mutation==="id-replaced")changed[0]!.id="synthetic-replaced-loss";
              if(mutation==="one-extra")changed.push({...structuredClone(rows[0]!),id:"synthetic-extra-loss"});
              const json=`E'${JSON.stringify(changed).replaceAll("\\","\\\\").replaceAll("'","''")}'::jsonb`;
              const expectedCount=mutation==="one-missing"?1:mutation==="one-extra"?3:2;
              expect((await pg.query(`SELECT jsonb_array_length(${json}) AS n`)).rows).toEqual([{n:expectedCount}]);
              if(mutation==="one-missing")expect(changed).toEqual(rows.slice(1));
              const mutant=sql.slice(0,lossStart)+statement.replace(expression,json)+sql.slice(lossEnd);
              await pg.exec("SAVEPOINT rejected_loss");
              await expect(pg.exec(mutant),`${mode}: ${mutation}`).rejects.toThrow("B_GRADE_PERSISTED_LOSS_MISMATCH");
              await pg.exec("ROLLBACK TO SAVEPOINT rejected_loss");
              for(const table of ["Job","EvidenceArtifact","PaginationEvidence","LossLedgerEntry","CrawlObservation","LifecycleSetEvidenceMember"]){
                expect((await pg.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows,`${mode}: ${mutation}: ${table}`).toEqual([{n:0}]);
              }
              expect((await pg.query('SELECT "atomicCommitState" FROM "CrawlBatchSourceResult"')).rows).toEqual(mode==="portable"?[{atomicCommitState:"PENDING"}]:[]);
              expect((await pg.query('SELECT to_jsonb(l) AS row FROM "CrawlCoordinatorLock" l')).rows).toEqual(leaseBefore);
              console.info("SYNTHETIC_B_LOSS_REJECTED",JSON.stringify({mode,mutation,originalRows:rows.length,mutantRows:expectedCount}));
            }
          };
          const sqlDb:PortableLeaseDatabase={$transaction:work=>pg.transaction((sqlTx:any)=>work({$queryRawUnsafe:async <T>(sql:string,...values:unknown[])=>(await sqlTx.query(sql,values)).rows as T}))};
          const sqlLease=await acquirePortableCrawlLease(sqlDb);
          try {
            const sql=await compilePortableAtomicSourceEvidenceSql(commit,sqlLease);
            await pg.exec("BEGIN");
            const batch=buildPendingRuntimeBatch(batchId,[p],identity,pending.startedAt).batch;
            const batchCounts=Object.fromEntries(["transportSucceeded","transportFailed","adapterSucceeded","adapterFailed","completenessVerified","completenessIncomplete","atomicCommitted","atomicFailed","failedSource","blockedSource","skippedSource"].map(k=>[k+"Count",0]));
            await insert("CrawlBatch",{...batch,...batchCounts,status:"RUNNING"});
            const counts=Object.fromEntries(["raw","parsed","valid","normalized","dedupeInput","dedupeOutput","parseDiscard","validationDiscard","normalizationDiscard","dedupeDiscard","collision","discard"].map(k=>[k+"Count",0]));
            await insert("CrawlBatchSourceResult",{...pending,...counts,releaseCandidateId:identity.releaseCandidateId,batchId,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING"});
            await checkSql(sql,"portable");
          } finally {await pg.exec("ROLLBACK");await releasePortableCrawlLease(sqlDb,sqlLease);}
          const context=(await pg.query(compileCloudPilotPublicationContextSql(common))).rows[0].context;
          const packet=await compileDbStartedCloudSourcePublication({control:{...common,planned,context},source:{...input,independentTraversalValidation:independentValidation,independentTraversalValidationExecution:"CURRENT_RUN",independentTraversalValidationTrigger:"INITIAL_QUALIFICATION"}});
          await pg.exec("BEGIN");
          try {await checkSql(packet.sql,"db-started");} finally {await pg.exec("ROLLBACK");}
        } finally {vi.unstubAllEnvs();await pg.close();}
      }
    } finally { await rm(workspaceRoot,{recursive:true,force:true}); }
  });
  it("recognizes only the exact branded native offline card and rejects missing/error ambiguity",()=>{
    const d=parseSanofiChineseDetail(detail(1),row(1)),company='<meta name="description" content="赛诺菲（中国）投资有限公司上海分公司">';
    expect(parseSanofiChineseNative(company+'<div class="card-body">该职位已下线</div>',d)).toEqual({state:"CLOSED"});
    for(const html of [company,company+'<div class="card-body">未知错误</div>',company+'<div class="card-body">该职位已下线，可能需要登录</div>',company+'<div class="card-body">该职位已下线</div><input id="positionStatus" value="PUBLISHING">'])expect(()=>parseSanofiChineseNative(html,d)).toThrow();
  });
});

// New official Ajinga chain uses the existing exact identity/status projection.
describe("Sanofi Chinese Ajinga compatibility",()=>{
 it("captures and replays both existing Chinese paths without pretending JSON is Tupu HTML",async()=>{
  const apply=(i:number)=>`https://www.ajinga.com/ats/job-detail-new/13537/${req(i)}/c/?show_policy_popup=1&aj_source=sanofi_careersite&aj_code=radancyjoblist`;
  const http:HttpHtmlClient=async r=>{
   const u=new URL(r.url);let body:string,finalUrl=r.url,contentType="text/html";
   if(r.url===SANOFI_CN_ENTRY)body='<section id="search-results" data-ajax-url="/search-results" data-total-pages="1" data-total-job-results="3" data-records-per-page="15" data-active-facet-id="0"></section><div id="search-filters"></div>';
   else if(u.pathname==="/search-results"){body=JSON.stringify({results:results(),filters:'<section id="search-filters"><input class="filter-checkbox"></section>',hasJobs:true,hasContent:false});contentType="application/json";}
   else if(u.hostname==="jobs.sanofi.cn"){const i=Number(u.pathname.split('/').at(-1))-100;body=detail(i).replaceAll(`https://careersite.tupu360.com/sanofi/position/detail?exid=${req(i)}`,apply(i));}
   else if(u.pathname.startsWith("/ats/")){const i=Number(/R900000(\d)/u.exec(r.url)![1]);body="<html>Official SPA</html>";finalUrl=`https://www.ajinga.com/recruiting/company/13537/job/${1000+i}/job-detail`;}
   else if(u.pathname.includes("/info/")){const id=Number(u.searchParams.get("job_id")),i=id-1000;body=JSON.stringify({code:200,data:{data:{is_in_china:true,company:{id:13965,root_company:{id:13537}},job:{id,root_company_id:13537,company:{id:13965},i18n_name:`${req(i)} ${title(i)}`,description:description(i),job_visibility:"IE",short_unique_id:`s${i}`,job_locations:[{city:{cn_name:"嘉兴市"}}]}}}});contentType="application/json";}
   else if(u.pathname.endsWith("/apply-status/")){const id=1000+Number(u.searchParams.get("short_id")!.slice(1));body=JSON.stringify({code:200,data:{show_apply:1,normal_share_url:`https://www.ajinga.com/recruiting/company/13965/job/${id}/job-detail`}});contentType="application/json";}
   else throw Error("unexpected fixture URL");return {status:200,body,finalUrl,contentType,capturedAt:AT};
  };
  const p=plan(),fetched=await createSanofiChineseSourceFetch({http,now:()=>new Date(AT)})(p);expect(fetched.ok).toBe(true);
  const result=await runSourceCrawl(p,{fetch:()=>fetched,isBaseline:false});expect(result.jobs).toHaveLength(3);
  const replay=replaySanofiChineseNative(p,result.fetchEvidence!,false);expect(replay.jobs).toHaveLength(3);
  const independent=await captureSanofiChineseIndependent({dom:dom(),http,now:()=>new Date(AT)});
  expect(replaySanofiChineseIndependent(independent.pages).decisions).toEqual(replay.decisions);
  expect(independent.pages[0]!.rawRows.every(r=>r.rawPayload.ajingaArtifacts&&!r.rawPayload.nativeResponse)).toBe(true);
 });
});
