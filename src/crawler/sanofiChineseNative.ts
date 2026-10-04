import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { load } from "cheerio";
import { createHttpHtmlSourceFetch, defaultHttpHtmlClient, type HttpHtmlClient, type HttpHtmlRequest, type HttpHtmlResponse, type HttpHtmlSourceFetchDeps } from "./httpHtmlSourceFetch";
import { parseSanofiDetail } from "./sanofiNativeQuality";
import { fetchWithOfficialTimeout } from "./officialHttpRuntimeLimits";
import { retryableHttpTransportFailure, retryableTransportFailureFromError, type SourceTransportFailure } from "./sourceFetchFailure";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { evaluatePaginationEvidence } from "./paginationEvidence";
import { validateStrictHtmlCompletenessProof } from "./strictHtmlCompletenessProof";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { isHengruiMainlandLocation } from "./hengruiMainlandGeography";
import { SANOFI_LEGACY_IDENTITY_SHA256, sanofiPersistentJobId } from "./sanofiLegacyIdentity";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";
import type { NormalizedJobRecord } from "./normalizedJob";
import { CITY_PENDING } from "../domain/jobLocation";

export const SANOFI_CN_ENTRY = "https://jobs.sanofi.cn/%e6%b1%82%e8%81%8c/%E4%B8%AD%E5%9B%BD/2649/2/1814991/35/105/50/2";
export const SANOFI_CN_POLICY = "SANOFI_CN_NATIVE_APPLICATION_V2";
export const SANOFI_CN_SOURCE = "source-sanofi-china-social";
export const SANOFI_CN_CHANNEL = `source:${SANOFI_CN_SOURCE}:default`;
export const SANOFI_CN_CAPTURE = { name: "sanofi-chinese-native-traversal", version: "2" };
export const SANOFI_CN_PAGINATION_POLICY = { allowIndependentlyVerifiedProfileBoundExclusions: true } as const;
const TRACE = "sanofi-cn-list-trace-v2", ANOMALIES = "sanofi-cn-module-anomalies-v2";
const clean = (s:string) => s.replace(/\s+/gu," ").trim();
export const sanofiDescription = (s:string) => s.replace(/\s+/gu,"").normalize("NFKC");
export const sanofiHash = (s:string) => createHash("sha256").update(s).digest("hex");
export const sanofiRawEvidenceId = (id:string) => `sha256:${sanofiHash(JSON.stringify(id))}`;
const body = (a:Pick<SourceFetchArtifactDraft,"body">) => typeof a.body === "string" ? a.body : Buffer.from(a.body).toString("utf8");
const rec = (v:unknown):Record<string,unknown>|undefined => v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
const text = (v:unknown):v is string => typeof v==="string"&&v.trim().length>0;
const requireValue = (v:unknown, code="SANOFI_CN_NATIVE_CHAIN_INVALID"):void => { if(!v)throw Error(code); };
const parseJson = (s:string):Record<string,unknown> => { requireValue(hasUniqueJsonObjectKeys(s));const v=rec(JSON.parse(s));requireValue(v);return v!; };
export function isSanofiChinesePlan(plan:SourceCrawlPlan):plan is Extract<SourceCrawlPlan,{adapterId:"html-table"}> & {table:{sanofiNativePolicy:typeof SANOFI_CN_POLICY}} {
  return plan.adapterId==="html-table"&&plan.table.sanofiNativePolicy===SANOFI_CN_POLICY;
}
function exactPlan(plan:SourceCrawlPlan):plan is Extract<SourceCrawlPlan,{adapterId:"html-table"}> {
  return isSanofiChinesePlan(plan)&&plan.executionAuthority==="STAGED"&&plan.company.id==="company-sanofi-china"&&
    plan.source.id===SANOFI_CN_SOURCE&&plan.source.companyId===plan.company.id&&plan.source.kind==="SOCIAL"&&
    plan.source.atsKind==="OFFICIAL_HTML"&&plan.source.officialEntryUrl===SANOFI_CN_ENTRY&&plan.source.officialChainEvidenceUrl==="https://jobs.sanofi.cn/"&&
    plan.table.sanofiChineseEntryUrl===SANOFI_CN_ENTRY&&plan.table.sanofiLegacyIdentitySha256===SANOFI_LEGACY_IDENTITY_SHA256;
}
function listPlan(plan:Extract<SourceCrawlPlan,{adapterId:"html-table"}>){
  const p=structuredClone(plan);delete p.table.sanofiNativePolicy;delete p.table.sanofiChineseEntryUrl;delete p.table.sanofiLegacyIdentitySha256;return p;
}
export interface SanofiChineseRow { id:string; title:string; url:string; listLocation:string }
export interface SanofiModuleAnomaly { code:"SANOFI_CN_FOREIGN_MAIN_MODULE"; id:string; reqId:string; foreignId:string; foreignReq:string|null; foreignApplyUrl:string; mainDescriptionSha256:string }
export interface SanofiDescriptionAnomaly {
  code:"SANOFI_CN_REPLACEMENT_CHARACTER_NATIVE_AUTHORITY"; id:string; reqId:string; nativePositionId:string; applyUrl:string;
  nativeLocationRaw:string; nativeCities:string[];
  chineseDescriptionSha256:string; nativeDescriptionSha256:string; normalizedUtf16Offset:number; replacementCharacterCount:3; nativeCharacterCount:1
}
export interface SanofiChineseDetail extends SanofiChineseRow {
  reqId:string; countryScope:"MAINLAND"|"OUTSIDE"; applyUrl:string; description:string; anomaly?:SanofiModuleAnomaly;
  descriptionReplacementOffset?:number
}

/** Header identity comes solely from the Chinese page. A conflicting module is
 * retained explicitly; it is never relabelled as a coherent description. */
export function parseSanofiChineseDetail(html:string,row:SanofiChineseRow):SanofiChineseDetail {
  const u=new URL(row.url);requireValue(u.origin==="https://jobs.sanofi.cn"&&!u.username&&!u.password&&!u.hash&&!u.search&&u.pathname.endsWith(`/3036/${row.id}`));
  const $=load(html),schemas:Record<string,unknown>[]=[];
  for(const n of $('script[type="application/ld+json"]').toArray()){
    const raw=$(n).html()??"";requireValue(hasUniqueJsonObjectKeys(raw));const v=JSON.parse(raw);
    for(const item of Array.isArray(v)?v:[v])if(rec(item)?.["@type"]==="JobPosting")schemas.push(item);
  }
  requireValue(schemas.length===1);const s=schemas[0]!,reqId=rec(s.identifier)?.value;
  requireValue(text(reqId)&&/^R\d+$/u.test(reqId)&&s.url===row.url&&text(s.title)&&clean(s.title)===row.title&&
    ["Sanofi","General Medicines","Manufacturing and Supply","Vaccines","Corporate Functions","Specialty Care","Research and Development"].includes(rec(s.hiringOrganization)?.name as string));
  const main=$("main#content"),header=main.find(".job-description.section7-title, #ajd-header"),titles=header.find("h1, .ajd__jobheader-title h2"),meta=$('meta[name="job-ats-req-id"]');
  requireValue(main.length===1&&header.length===1&&titles.length===1&&clean(titles.text())===row.title&&meta.length===1&&meta.attr("content")===reqId);
  const links=header.find('[data-selector-name="job-apply-link"]');requireValue(links.length>0);
  const urls=links.toArray().map(n=>{const a=$(n),href=a.attr("href");requireValue(a.attr("data-job-id")===row.id&&text(href));const url=new URL(href!,row.url).toString();requireValue(a.attr("data-apply-url")===undefined||new URL(a.attr("data-apply-url")!,row.url).toString()===url);return url;});
  requireValue(new Set(urls).size===1);const applyUrl=urls[0]!;
  requireValue(text(s.description));const description=sanofiDescription(load(s.description as string).text());requireValue(description.length>0);
  requireValue(Array.isArray(s.jobLocation)&&s.jobLocation.length>0);const countries=(s.jobLocation as unknown[]).map(v=>rec(rec(v)?.address)?.addressCountry);
  const mainland=countries.every(v=>v==="China"||v==="中国"),outside=countries.every(v=>["Taiwan","中国台湾","中国香港","Hong Kong","Macau","Macao"].includes(v as string));
  requireValue(mainland||outside,"SANOFI_CN_GEOGRAPHY_UNKNOWN");
  const tupu=`https://careersite.tupu360.com/sanofi/position/detail?exid=${reqId}`;
  requireValue(applyUrl===tupu||outside&&applyUrl===`https://jobs.sanofi.cn/sys/apply/job/application/2649/${row.id}`);
  let anomaly:SanofiModuleAnomaly|undefined;
  if(!parseSanofiDetail(html,row.url,row.id)){
    const detail=main.find(".job-description.section7-details"),jd=detail.find(".ats-description"),foreignId=detail.attr("data-job-id"),bottom=detail.find('[data-selector-name="job-apply-link"]');
    requireValue(detail.length===1&&jd.length===1&&text(jd.text())&&foreignId!==row.id&&/^\d+$/u.test(foreignId??"")&&bottom.length===1,"SANOFI_CN_UNEXPLAINED_MAIN_MODULE");
    const bottomHref=bottom.attr("href")??"",foreignReq=/^https:\/\/careersite\.tupu360\.com\/sanofi\/position\/detail\?exid=(R\d+)$/u.exec(bottomHref)?.[1];
    const foreignChineseApply=bottomHref===`https://jobs.sanofi.cn/sys/apply/job/application/2649/${foreignId}`;
    requireValue(bottom.attr("data-job-id")===foreignId&&(foreignChineseApply||foreignReq&&foreignReq!==reqId)&&
      (bottom.attr("data-apply-url")===undefined||bottom.attr("data-apply-url")===bottomHref),"SANOFI_CN_UNEXPLAINED_MAIN_MODULE");
    anomaly={code:"SANOFI_CN_FOREIGN_MAIN_MODULE",id:row.id,reqId:reqId as string,foreignId:foreignId!,foreignReq:foreignReq??null,foreignApplyUrl:bottomHref,mainDescriptionSha256:sanofiHash(sanofiDescription(jd.text()))};
  }
  // Exception eligibility requires the Chinese schema and visible JD to agree,
  // including the local module identity. A foreign module cannot corroborate it.
  const replacement=/^[^\uFFFD]*\uFFFD{3}[^\uFFFD]*$/u.test(description),module=main.find(".job-description.section7-details");
  const descriptionReplacementOffset=replacement&&!anomaly&&module.attr("data-job-id")===row.id&&
    sanofiDescription(module.find(".ats-description").text())===description?description.indexOf("\uFFFD"):undefined;
  return {...row,reqId:reqId as string,countryScope:mainland?"MAINLAND":"OUTSIDE",applyUrl,description,...(anomaly?{anomaly}:{}),
    ...(descriptionReplacementOffset===undefined?{}:{descriptionReplacementOffset})};
}
export function sanofiChineseLocation(raw:string):{locationRaw:string;cities:string[]} {
  const locationRaw=clean(raw),parts=locationRaw.split(/[、,，;；]/u).map(clean).filter(Boolean);requireValue(parts.length>0,"SANOFI_CN_GEOGRAPHY_UNKNOWN");
  const cities=parts.map(part=>{
    if(["中国","中国大陆","全国"].includes(part))return CITY_PENDING;
    const tokens=part.split("-").map(clean);if(tokens[0]==="中国")tokens.shift();requireValue(tokens.length>0&&tokens.length<=2,"SANOFI_CN_GEOGRAPHY_UNKNOWN");
    const city=tokens.at(-1)!,province=tokens.length===2?tokens[0]:undefined;
    requireValue(isHengruiMainlandLocation({country:"中国",cityName:city,...(province?{provinceName:province}:{})}),"SANOFI_CN_GEOGRAPHY_UNKNOWN");
    return city.replace(/市$/u,"");
  });return {locationRaw,cities:[...new Set(cities)]};
}
export function parseSanofiChineseNative(html:string,detail:SanofiChineseDetail):{state:"PUBLISHING"|"CLOSED";locationRaw?:string;cities?:string[];descriptionAnomaly?:SanofiDescriptionAnomaly} {
  const $=load(html),status=$("#positionStatus").attr("value"),title=$("#positionName").attr("value"),id=$("#positionId").attr("value");
  requireValue($('meta[name="description"]').length===1&&$('meta[name="description"]').attr("content")==="赛诺菲（中国）投资有限公司上海分公司");
  // Observed native tombstone: the already-bound, exact requisition URL returns
  // only this branded status card. An error page or absent fields alone is not closure.
  if($(".card-body").length===1&&clean($(".card-body").text())==="该职位已下线"&&
    $("#positionStatus,#positionName,#positionId,.position-description").length===0)return {state:"CLOSED"};
  requireValue($("#positionStatus").length===1&&(status==="PUBLISHING"||status==="CLOSED"),"SANOFI_CN_NATIVE_STATUS_UNKNOWN");
  requireValue($("#positionName").length===1&&$("#positionId").length===1&&/^[a-f0-9]{24}$/u.test(id??"")&&text(title)&&
    $('meta[name="description"]').length===1&&$('meta[name="description"]').attr("content")==="赛诺菲（中国）投资有限公司上海分公司");
  const aliases:Record<string,string>={"DBU Regional Manager HZ":"Regional Manager","Access Strategy Project Manager":"Market Access-(Sr.) Access Strategy Project Manager-Shanghai"};
  requireValue(clean(title!)===detail.title||aliases[detail.title]===clean(title!));
  requireValue($(".position-description").length===1);const nativeDescription=sanofiDescription($(".position-description").text());
  requireValue(nativeDescription.length>0);let descriptionAnomaly:SanofiDescriptionAnomaly|undefined;
  if(nativeDescription!==detail.description){
    const offset=detail.descriptionReplacementOffset,prefix=offset===undefined?"":detail.description.slice(0,offset),suffix=offset===undefined?"":detail.description.slice(offset+3);
    const nativeIds=$("script").toArray().flatMap(node=>[...($(node).html()??"").matchAll(/\bvar\s+prevPositionId\s*=\s*["']([a-f0-9]{24})["']\s*;/gu)].map(match=>match[1]));
    // This describes an observed display discrepancy, not its unknown byte-level
    // cause. Only one triplet can correspond to one native Han character; every
    // other normalized character must match. No text is synthesized or replaced.
    requireValue(offset!==undefined&&!detail.anomaly&&detail.countryScope==="MAINLAND"&&status==="PUBLISHING"&&
      clean(title!)===detail.title&&detail.applyUrl===`https://careersite.tupu360.com/sanofi/position/detail?exid=${detail.reqId}`&&
      $("#recruitmentType").length===1&&$("#recruitmentType").attr("value")==="SOCIALRECRUITMENT"&&
      nativeIds.length===1&&nativeIds[0]===id&&/^[^\uFFFD]*\uFFFD{3}[^\uFFFD]*$/u.test(detail.description)&&
      /[\u3400-\u4dbf\u4e00-\u9fff]$/u.test(prefix)&&/^[\u3400-\u4dbf\u4e00-\u9fff]/u.test(suffix)&&
      !nativeDescription.includes("\uFFFD")&&nativeDescription.length===prefix.length+1+suffix.length&&
      nativeDescription.startsWith(prefix)&&nativeDescription.endsWith(suffix)&&/[\u3400-\u4dbf\u4e00-\u9fff]/u.test(nativeDescription.charAt(prefix.length)),
      "SANOFI_CN_DESCRIPTION_CONFLICT");
    const nativeLocation=sanofiChineseLocation($(".position-extend .city").text());
    descriptionAnomaly={nativeLocationRaw:nativeLocation.locationRaw,nativeCities:nativeLocation.cities,code:"SANOFI_CN_REPLACEMENT_CHARACTER_NATIVE_AUTHORITY",id:detail.id,reqId:detail.reqId,nativePositionId:id!,applyUrl:detail.applyUrl,
      chineseDescriptionSha256:sanofiHash(detail.description),nativeDescriptionSha256:sanofiHash(nativeDescription),normalizedUtf16Offset:offset!,replacementCharacterCount:3,nativeCharacterCount:1};
  }
  requireValue(["SOCIALRECRUITMENT","INTERNSHIPRECRUITMENT"].includes($("#recruitmentType").attr("value")??""));
  if(status==="CLOSED")return {state:"CLOSED"};
  return {state:"PUBLISHING",...sanofiChineseLocation($(".position-extend .city").text()),...(descriptionAnomaly?{descriptionAnomaly}:{})};
}

export const sanofiChineseHttp:HttpHtmlClient=async request=>{
  return fetchWithOfficialTimeout(request.url,{method:"GET",headers:request.headers,redirect:"follow"},{
    consumeResponse:async r=>({status:r.status,body:await r.text(),finalUrl:r.url,contentType:r.headers.get("content-type")??"",capturedAt:new Date().toISOString()})
  });
};
function locator(role:string,url:string,id:string){return requestContractV2Locator(`sanofi-cn-${role}-v2`,{family:"html",role:`sanofi-cn-${role}`,method:"GET",url,body:null,coordinate:{id}});}
function exactArtifact(a:SourceFetchArtifactDraft|undefined,url:string,role:string,id:string,start:string):a is SourceFetchArtifactDraft {
  return !!a&&a.kind==="ATS_PAGE"&&a.httpStatus===200&&a.bodyRepresentation==="EXACT"&&/^text\/html(?:;|$)/iu.test(a.contentType??"")&&
    a.requestedUrl===sanitizeEvidenceHttpUrl(url)&&a.finalUrl===sanitizeEvidenceHttpUrl(url)&&a.extractorLocator===locator(role,url,id)&&
    Date.parse(a.capturedAt)>=Date.parse(start)&&Date.parse(a.capturedAt)<=Date.parse(start)+30*60_000;
}
function listRows(primary:PersistentSourceFetchEvidence):Array<SanofiChineseRow&{pageSequence:number;recordIndex:number;rawLocator:string}> {
  const rows:Array<SanofiChineseRow&{pageSequence:number;recordIndex:number;rawLocator:string}>=[];
  for(const p of primary.pages){const a=primary.artifacts.find(a=>a.logicalKey===p.artifactLogicalKey)!,$=load(String(parseJson(body(a)).results));
    for(const [recordIndex,n] of $('#search-results-list li:has(button.js-save-job-btn)').toArray().entries()){
      const row=$(n),button=row.find("button.js-save-job-btn"),link=row.find("a[data-job-id]"),id=button.attr("data-job-id"),href=link.attr("href"),title=clean(row.find("h2").text());
      requireValue(button.length===1&&link.length===1&&/^\d+$/u.test(id??"")&&link.attr("data-job-id")===id&&text(href)&&title);
      const url=new URL(href!,SANOFI_CN_ENTRY).toString();requireValue(new URL(url).origin==="https://jobs.sanofi.cn"&&new URL(url).pathname.endsWith(`/3036/${id}`));
      rows.push({id:id!,title,url,listLocation:clean(row.find("span.job-location").text()),pageSequence:p.sequence,recordIndex,
        rawLocator:`${a.logicalKey}#page-${p.sequence}#record-${recordIndex}#sha256:${sanofiHash($.html(n))}`});
    }
    const next=$("#search-results a.next:not(.disabled)");requireValue(p.sequence===primary.pages.length-1?next.length===0:next.length===1,"SANOFI_CN_TERMINAL_CONTROL_INVALID");
  }
  requireValue(rows.length>0&&new Set(rows.map(r=>r.id)).size===rows.length&&rows.length===primary.fetchCounts.rawCount);return rows;
}
function loadPrimary(plan:Extract<SourceCrawlPlan,{adapterId:"html-table"}>,evidence:PersistentSourceFetchEvidence){
  const trace=evidence.artifacts.find(a=>a.logicalKey===TRACE);requireValue(trace?.kind==="ORACLE_RESULT"&&trace.bodyRepresentation==="EXACT"&&trace.extractorLocator===TRACE);
  const primary=parsePersistentSourceFetchEvidence({...parseJson(body(trace!)),artifacts:evidence.artifacts.filter(a=>a.logicalKey.startsWith("official-html-"))});
  requireValue(validateStrictHtmlCompletenessProof(listPlan(plan),primary));
  const begin=Date.parse(primary.artifacts[0]!.capturedAt);
  requireValue(primary.artifacts.every(a=>Date.parse(a.capturedAt)>=begin&&Date.parse(a.capturedAt)<=begin+30*60_000)&&
    trace!.capturedAt===primary.artifacts.at(-1)!.capturedAt);return primary;
}
function project(plan:Extract<SourceCrawlPlan,{adapterId:"html-table"}>,primary:PersistentSourceFetchEvidence,artifacts:SourceFetchArtifactDraft[],isBaseline:boolean){
  const rows=listRows(primary),map=new Map(artifacts.map(a=>[a.logicalKey,a])),start=primary.artifacts[0]!.capturedAt,used=new Set(primary.artifacts.map(a=>a.logicalKey));
  used.add(TRACE);used.add(ANOMALIES);const jobs:NormalizedJobRecord[]=[],losses:PersistentSourceFetchEvidence["fetchLosses"]=[],anomalies:Array<SanofiModuleAnomaly|SanofiDescriptionAnomaly>=[],seenReq=new Set<string>(),included=new Set<string>(),closedIds=new Set<string>(),excludedIds=new Set<string>();
  const decisions:Array<{id:string;reqId:string;sourceJobId:string;state:string}>=[];
  for(const row of rows){const key=`sanofi-cn-detail-${row.id}`,a=map.get(key);requireValue(exactArtifact(a,row.url,"detail",row.id,start));used.add(key);
    const detail=parseSanofiChineseDetail(body(a!),row);requireValue(!seenReq.has(detail.reqId));seenReq.add(detail.reqId);if(detail.anomaly)anomalies.push(detail.anomaly);
    let excluded:string|undefined,reason:string|undefined,location:{locationRaw:string;cities:string[]}|undefined;
    if(detail.countryScope==="OUTSIDE"){excluded="SANOFI_CN_OFFICIAL_OUTSIDE_MAINLAND";reason="Sanofi Chinese official detail explicitly places the job outside mainland China";}
    else {const tKey=`sanofi-cn-tupu-${detail.reqId}`,t=map.get(tKey);requireValue(exactArtifact(t,detail.applyUrl,"native",detail.reqId,start));used.add(tKey);
      const native=parseSanofiChineseNative(body(t!),detail);if(native.descriptionAnomaly)anomalies.push(native.descriptionAnomaly);if(native.state==="CLOSED"){excluded="SANOFI_CN_NATIVE_CLOSED";reason="Sanofi Chinese native application explicitly closes this requisition";closedIds.add(sanofiPersistentJobId(detail.reqId));}
      else location={locationRaw:native.locationRaw!,cities:native.cities!};
    }
    decisions.push({id:row.id,reqId:detail.reqId,sourceJobId:sanofiPersistentJobId(detail.reqId),state:detail.countryScope==="OUTSIDE"?"OUTSIDE":excluded?"CLOSED":"PUBLISHING"});
    if(excluded){excludedIds.add(sanofiPersistentJobId(detail.reqId));losses.push({stage:"VALIDATION",reason:reason!,rawLocator:row.rawLocator,details:{code:excluded,pageSequence:row.pageSequence,recordIndex:row.recordIndex},recordedAt:a!.capturedAt});continue;}
    requireValue(location);included.add(row.id);jobs.push({companyId:plan.company.id,sourceId:plan.source.id,sourceKind:"SOCIAL",atsKind:"OFFICIAL_HTML",officialChineseCompanyName:plan.company.officialChineseName,
      sourceJobId:sanofiPersistentJobId(detail.reqId),officialTitle:detail.title,officialUrl:detail.applyUrl,listUrl:SANOFI_CN_ENTRY,...location!,category:"其他",isBaseline,
      evidence:{officialEntryUrl:SANOFI_CN_ENTRY,officialChainEvidenceUrl:"https://jobs.sanofi.cn/",capturedAt:start}});
  }
  requireValue(new Set(jobs.map(j=>j.sourceJobId)).size===jobs.length&&used.size===map.size&&artifacts.length===map.size);
  const pages=primary.pages.map(p=>{const own=rows.filter(r=>r.pageSequence===p.sequence);return {...p,rawJobIds:own.map(r=>sanofiRawEvidenceId(r.id)),validJobIds:own.filter(r=>included.has(r.id)).map(r=>sanofiRawEvidenceId(r.id)),termination:p.sequence===primary.pages.length-1?"NEXT_ABSENT" as const:"CONTINUE" as const};});
  return {jobs,losses,anomalies,pages,closedIds,excludedIds,decisions:decisions.sort((a,b)=>a.id.localeCompare(b.id)),rawIds:rows.map(r=>r.id),rawPersistentIds:decisions.map(d=>d.sourceJobId),counts:{rawCount:rows.length,parsedCount:rows.length,validCount:jobs.length,parseDiscardCount:0,validationDiscardCount:losses.length}};
}
export function replaySanofiChineseNative(plan:SourceCrawlPlan,input:PersistentSourceFetchEvidence,isBaseline=true){
  requireValue(exactPlan(plan));const p=plan as Extract<SourceCrawlPlan,{adapterId:"html-table"}>,e=parsePersistentSourceFetchEvidence(input);requireValue(same(e.captureTool,SANOFI_CN_CAPTURE));
  const primary=loadPrimary(p,e),result=project(p,primary,e.artifacts,isBaseline),anomaly=e.artifacts.find(a=>a.logicalKey===ANOMALIES);
  requireValue(anomaly?.kind==="ORACLE_RESULT"&&anomaly.bodyRepresentation==="EXACT"&&anomaly.extractorLocator===ANOMALIES&&
    anomaly.capturedAt===e.artifacts.filter(a=>a.kind==="ATS_PAGE").at(-1)!.capturedAt&&same(parseJson(body(anomaly)),{schemaVersion:2,entries:result.anomalies}));
  requireValue(same(e.pages,result.pages)&&same(e.fetchCounts,result.counts)&&same(e.fetchLosses,result.losses)&&
    same(e.declaredCompleteness,{...primary.declaredCompleteness,kind:"COMPLETE_PAGE_TRAVERSAL",value:primary.pages.length}));return result;
}
export interface SanofiChineseSourceFetchDeps extends HttpHtmlSourceFetchDeps {
  /** Complete originals are persisted before status, content or parser validation. */
  onResponse?:(request:HttpHtmlRequest,response:HttpHtmlResponse,requestedAt:string)=>Promise<void>;
}
export function createSanofiChineseSourceFetch(deps:SanofiChineseSourceFetchDeps={}):SourceFetchFunction {
  return async plan=>{
    let capturedAt=(deps.now?.()??new Date()).toISOString(),base:SourceFetchResult|undefined,primary:PersistentSourceFetchEvidence|undefined,transportFailure:SourceTransportFailure|undefined;const artifacts:SourceFetchArtifactDraft[]=[];
    if(!exactPlan(plan))return {ok:false,capturedAt,failureReason:"SANOFI_CN_PLAN_INVALID"};
    const retain=(client:HttpHtmlClient):HttpHtmlClient=>async request=>{
      const requestedAt=new Date().toISOString(),response=await client(request);
      await deps.onResponse?.(request,response,requestedAt);return response;
    };
    const http=retain(deps.http??sanofiChineseHttp);
    const get=async(url:string,key:string,role:string,id:string)=>{let r;try{r=await http({url,method:"GET",headers:{Accept:"text/html","User-Agent":"job-search-crawler/0.1"}});}catch(error){transportFailure=retryableTransportFailureFromError(error);throw error;}
      transportFailure=retryableHttpTransportFailure(r.status)??transportFailure;const a:SourceFetchArtifactDraft={id:key,logicalKey:key,kind:"ATS_PAGE",requestedUrl:sanitizeEvidenceHttpUrl(url),finalUrl:r.finalUrl?sanitizeEvidenceHttpUrl(r.finalUrl):undefined,httpStatus:r.status,contentType:r.contentType,capturedAt:r.capturedAt??"",body:r.body,bodyRepresentation:"EXACT",extractorLocator:locator(role,url,id)};
      artifacts.push(a);requireValue(exactArtifact(a,url,role,id,capturedAt));return a;};
    // Preserve the list client's existing certificate fallback and detail client's
    // existing policy while retaining both kinds of original before validation.
    try {base=await createHttpHtmlSourceFetch({...deps,http:retain(deps.http??defaultHttpHtmlClient)})(listPlan(plan));if(!base.ok)return base;requireValue(base.fetchEvidence&&"html"in base);primary=base.fetchEvidence!;capturedAt=primary.artifacts[0]!.capturedAt;
      requireValue(validateStrictHtmlCompletenessProof(listPlan(plan),primary));artifacts.push(...primary.artifacts);const {artifacts:_raw,...trace}=primary;
      artifacts.push({id:TRACE,logicalKey:TRACE,kind:"ORACLE_RESULT",capturedAt:primary.artifacts.at(-1)!.capturedAt,body:JSON.stringify(trace),bodyRepresentation:"EXACT",extractorLocator:TRACE});
      // Settle the bounded group so every in-flight original is retained on failure.
      const rows=listRows(primary);
      for(let offset=0;offset<rows.length;offset+=4){const results=await Promise.allSettled(rows.slice(offset,offset+4).map(async row=>{
        const a=await get(row.url,`sanofi-cn-detail-${row.id}`,"detail",row.id),detail=parseSanofiChineseDetail(body(a),row);
        if(detail.countryScope==="MAINLAND"){const native=await get(detail.applyUrl,`sanofi-cn-tupu-${detail.reqId}`,"native",detail.reqId);parseSanofiChineseNative(body(native),detail);}
      }));const failed=results.find((r):r is PromiseRejectedResult=>r.status==="rejected");if(failed)throw failed.reason;}
      const last=artifacts.at(-1)!.capturedAt;artifacts.push({id:ANOMALIES,logicalKey:ANOMALIES,kind:"ORACLE_RESULT",capturedAt:last,body:"{}",bodyRepresentation:"EXACT",extractorLocator:ANOMALIES});
      const projected=project(plan,primary,artifacts,true);artifacts.at(-1)!.body=JSON.stringify({schemaVersion:2,entries:projected.anomalies});
      const evidence=parsePersistentSourceFetchEvidence({...primary,captureTool:SANOFI_CN_CAPTURE,artifacts,pages:projected.pages,fetchCounts:projected.counts,fetchLosses:projected.losses,
        declaredCompleteness:{...primary.declaredCompleteness!,kind:"COMPLETE_PAGE_TRAVERSAL",value:primary.pages.length}});
      replaySanofiChineseNative(plan,evidence);const paginationEvaluation=evaluatePaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true,...SANOFI_CN_PAGINATION_POLICY});
      requireValue(paginationEvaluation.safeCompleteness&&paginationEvaluation.verifiedEligible);return {...base,capturedAt,fetchEvidence:evidence,paginationEvaluation};
    } catch(error) {return {ok:false,capturedAt,failureReason:error instanceof Error&&/^SANOFI_CN_[A-Z_]+$/u.test(error.message)?error.message:"SANOFI_CN_NATIVE_CHAIN_INVALID",
      ...(transportFailure?{transportFailure}:{}),...(primary?{fetchEvidence:{...primary,artifacts}}:{}),...(base?.paginationEvaluation?{paginationEvaluation:base.paginationEvaluation}:{})};}
  };
}
