import {retryableHttpTransportFailure,retryableTransportFailureFromError,type SourceTransportFailure} from "./sourceFetchFailure";
import {explicitlyForeignOrNonMainlandLocation} from "./officialJsonEvidence";
import {isDeepStrictEqual as same} from "node:util";
import {load} from "cheerio";
import {createHttpHtmlSourceFetch,type HttpHtmlClient,type HttpHtmlSourceFetchDeps} from "./httpHtmlSourceFetch";
import {htmlTableAdapter} from "./adapters/htmlTable";
import {validateStrictHtmlCompletenessProof} from "./strictHtmlCompletenessProof";
import {fetchWithOfficialTimeout} from "./officialHttpRuntimeLimits";
import {parsePersistentSourceFetchEvidence,sanitizeEvidenceHttpUrl,type PersistentSourceFetchEvidence,type SourceFetchArtifactDraft} from "./sourceFetchEvidence";
import {hasUniqueJsonObjectKeys} from "./strictJsonObjectKeys";
import {requestContractV2Locator} from "./strictPageRequestContract";
import type {SourceCrawlPlan} from "./sourcePlan";
import type {SourceFetchFunction,SourceFetchResult} from "./runSourceCrawl";
import type {NormalizedJobRecord} from "./normalizedJob";
import {CITY_PENDING} from "../domain/jobLocation";

export const SANOFI_CHINESE_ENTRY="https://jobs.sanofi.cn/%e6%b1%82%e8%81%8c/%E4%B8%AD%E5%9B%BD/2649/2/1814991/35/105/50/2";
const ENGLISH="https://jobs.sanofi.com/en/location/china-country-jobs/2649/1814991/2";
const POLICY="SANOFI_EN_CN_NATIVE_CHAIN_V1";
const CN_PREFIX="sanofi-cn-list-";
const rec=(v:unknown):Record<string,unknown>|undefined=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
const text=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const norm=(v:string)=>v.trim().replace(/\s+/gu," ");
const body=(a:SourceFetchArtifactDraft)=>typeof a.body==="string"?a.body:Buffer.from(a.body).toString("utf8");
const assert=(v:unknown):void=>{if(!v)throw Error("SANOFI_NATIVE_CHAIN_INVALID");};
const setEqual=(a:string[],b:string[])=>same([...new Set(a)].sort(),[...new Set(b)].sort());
const absolute=(value:string,base:string)=>new URL(value,base).toString();
export function hasSanofiNativePolicy(plan:SourceCrawlPlan):boolean{return plan.adapterId==="html-table"&&plan.table.sanofiNativePolicy!==undefined;}
function exactPlan(plan:SourceCrawlPlan):plan is Extract<SourceCrawlPlan,{adapterId:"html-table"}>{return plan.adapterId==="html-table"&&plan.company.id==="company-sanofi-china"&&plan.company.officialChineseName==="赛诺菲中国"&&plan.source.id==="source-sanofi-china-social"&&plan.source.companyId===plan.company.id&&plan.source.kind==="SOCIAL"&&plan.source.atsKind==="OFFICIAL_HTML"&&plan.source.officialEntryUrl===ENGLISH&&plan.source.officialChainEvidenceUrl==="https://jobs.sanofi.cn/"&&plan.table.sanofiNativePolicy===POLICY&&plan.table.sanofiChineseEntryUrl===SANOFI_CHINESE_ENTRY;}
function listPlan(plan:Extract<SourceCrawlPlan,{adapterId:"html-table"}>,cn=false){const table=structuredClone(plan.table);delete table.sanofiNativePolicy;delete table.sanofiChineseEntryUrl;if(cn)table.fields.officialUrl={selector:"a[data-job-id]",attribute:"href"};return {...plan,source:{...plan.source,officialEntryUrl:cn?SANOFI_CHINESE_ENTRY:ENGLISH},table};}
function json(value:string):Record<string,unknown>{assert(hasUniqueJsonObjectKeys(value));const parsed=rec(JSON.parse(value));assert(parsed);return parsed!;}
function listRows(plan:Extract<SourceCrawlPlan,{adapterId:"html-table"}>,evidence:PersistentSourceFetchEvidence):NormalizedJobRecord[]{
 const html=evidence.pages.map(p=>{const a=evidence.artifacts.find(a=>a.logicalKey===p.artifactLogicalKey)!;const raw=json(body(a));assert(text(raw.results));return raw.results as string;}).join("\n");
 const result=htmlTableAdapter.extract({company:plan.company,source:plan.source,table:plan.table,html,capturedAt:evidence.artifacts[0]!.capturedAt,isBaseline:true});
 assert(result.status==="SUCCESS"&&result.reconciliation?.adapterLosses.length===0&&result.jobs.length===evidence.fetchCounts.rawCount&&new Set(result.jobs.map(j=>j.sourceJobId)).size===result.jobs.length);return result.jobs;
}
export type SanofiDetail={reqId:string;sourceJobId:string;title:string;url:string;scope:"MAINLAND"|"OUTSIDE";applyUrl:string;datePosted:unknown;descriptionText:string;};
export function parseSanofiDetail(html:string,url:string,id:string):SanofiDetail|undefined{
 try{
  const parsed=new URL(url);if(!["jobs.sanofi.com","jobs.sanofi.cn"].includes(parsed.hostname)||parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.hash||parsed.search||!parsed.pathname.endsWith(`/${id}`))return undefined;
  const $=load(html),schemas:Record<string,unknown>[]=[];
  for(const node of $('script[type="application/ld+json"]').toArray()){const raw=$(node).html()??"";if(!hasUniqueJsonObjectKeys(raw))return undefined;const value=JSON.parse(raw);for(const item of Array.isArray(value)?value:[value])if(rec(item)?.["@type"]==="JobPosting")schemas.push(item);}
  if(schemas.length!==1)return undefined;const data=schemas[0]!,reqId=rec(data.identifier)?.value;
  if(!text(reqId)||!/^R\d+$/u.test(reqId)||!text(data.title)||data.url!==url||!(parsed.hostname==="jobs.sanofi.cn"?["Sanofi","General Medicines","Manufacturing and Supply","Vaccines","Corporate Functions","Specialty Care","Research and Development"]:["Sanofi"]).includes(rec(data.hiringOrganization)?.name as string)||!text(data.description)||!load(data.description).text().trim()||!Array.isArray(data.jobLocation)||!data.jobLocation.length)return undefined;
  const countries=data.jobLocation.map(v=>rec(rec(v)?.address)?.addressCountry);if(!countries.every(text))return undefined;
  const mainland=countries.some(v=>v==="China"||v==="中国");
  if(!countries.every(v=>["China","中国","Taiwan","中国香港","Hong Kong","Macau","Macao"].includes(v)))return undefined;
  const links=$('[data-selector-name="job-apply-link"]').map((_,node)=>$(node).attr("href")).get().map(href=>absolute(href,url));
  // Some official pages retain a neighbour's footer link. Only an exact current identity is usable.
  const ownLinks=links.filter(link=>{const u=new URL(link);return link===tupuUrl(reqId)||
    (u.origin==="https://www.ajinga.com"&&u.pathname===`/ats/job-detail-new/13537/${reqId}/c/`)||
    (u.origin===parsed.origin&&u.pathname===`/sys/apply/job/application/2649/${id}`);});
  if(new Set(ownLinks).size>1||(ownLinks.length===0&&parsed.hostname!=="jobs.sanofi.com"))return undefined;
  return {reqId,sourceJobId:id,title:norm(data.title),url,scope:mainland?"MAINLAND":"OUTSIDE",applyUrl:ownLinks[0]??"",datePosted:data.datePosted,descriptionText:load(data.description).text().replace(/\s+/gu,"").normalize("NFKC")};
 }catch{return undefined;}
}
function nativeCities(raw:string):string[]{assert(!explicitlyForeignOrNonMainlandLocation(raw));const parts=raw.split(/[、,，;；]/u).map(v=>v.trim().split("-").at(-1)!.trim()).filter(Boolean);return parts.length&&parts.every(v=>/^[\u4e00-\u9fff]{2,12}$/u.test(v)&&!/(?:香港|澳门|台湾|台北|高雄)/u.test(v))?[...new Set(parts.map(v=>v.replace(/市$/u,"")))]:[CITY_PENDING];}
function tupuProjection(html:string,official:SanofiDetail):{locationRaw:string;cities:string[]}|undefined{
 const $=load(html),status=$("#positionStatus").attr("value"),locationRaw=norm($(".position-extend .city").text());
 if(status!=="PUBLISHING"){assert(status==="CLOSED"||$(".card-body").text().includes("该职位已下线"));return undefined;}
 assert($("#positionId").attr("value")&&$("#positionName").attr("value")&&text($(".position-description").text())&&
  ["SOCIALRECRUITMENT","INTERNSHIPRECRUITMENT"].includes($("#recruitmentType").attr("value")??"")&&locationRaw);
 const nativeTitle=norm($("#positionName").attr("value")!);
 const aliases:Record<string,string>={"DBU Regional Manager HZ":"Regional Manager","Access Strategy Project Manager":"Market Access-(Sr.) Access Strategy Project Manager-Shanghai"};
 assert($("#positionStatus").length===1&&$("#positionName").length===1&&$("#positionId").length===1&&/^[a-f0-9]{24}$/u.test($("#positionId").attr("value")!)&&
  (nativeTitle===official.title||aliases[official.title]===nativeTitle)&&
  $(".position-description").text().replace(/\s+/gu,"").normalize("NFKC")===official.descriptionText);
 return {locationRaw,cities:nativeCities(locationRaw)};
}
const tupuUrl=(id:string)=>`https://careersite.tupu360.com/sanofi/position/detail?exid=${id}`;
function ajingaRoute(detail:SanofiDetail):boolean{try{const url=new URL(detail.applyUrl);return url.origin==="https://www.ajinga.com"&&url.pathname===`/ats/job-detail-new/13537/${detail.reqId}/c/`&&url.searchParams.get("aj_source")==="sanofi_careersite"&&url.searchParams.get("aj_code")==="radancyjoblist"&&!url.username&&!url.password&&!url.hash;}catch{return false;}}
function ajingaId(a:SourceFetchArtifactDraft):string|undefined{try{const u=new URL(a.finalUrl!);return u.origin==="https://www.ajinga.com"?/^\/recruiting\/company\/13537\/job\/(\d+)\/job-detail$/u.exec(u.pathname)?.[1]:undefined;}catch{return undefined;}}
const ajingaInfoUrl=(id:string)=>`https://www.ajinga.com/django_rest/job-detail/info/${id}/?job_id=${id}&company_id=13537&aj_source=sanofi_careersite&aj_code=radancyjoblist`;
const ajingaStatusUrl=(short:string)=>`https://www.ajinga.com/django_rest/job-detail/apply-status/?short_id=${short}`;
function ajingaProjection(info:Record<string,unknown>,application:Record<string,unknown>,id:string,req:string){const data=rec(rec(info.data)?.data),job=rec(data?.job),company=rec(data?.company),status=rec(application.data);if(info.code!==200||application.code!==200||data?.is_in_china!==true||job?.id!==Number(id)||job.root_company_id!==13537||rec(company?.root_company)?.id!==13537||rec(job.company)?.id!==company?.id||!text(job.i18n_name)||!job.i18n_name.startsWith(`${req} `)||!text(job.description)||!load(job.description).text().trim()||!["E","IE"].includes(job.job_visibility as string)||status?.show_apply!==1||status.normal_share_url!==`https://www.ajinga.com/recruiting/company/${company?.id}/job/${id}/job-detail`||!Array.isArray(job.job_locations))return undefined;const names=job.job_locations.map(v=>rec(rec(v)?.city)?.cn_name);if(!names.length||!names.every(text))return undefined;const locationRaw=[...new Set(names)].join("、");return {locationRaw,cities:nativeCities(locationRaw)};}
function locator(role:string,url:string,id:string){return requestContractV2Locator(`sanofi-native-${role}-v1`,{family:"html",role:`sanofi-${role}`,method:"GET",url,body:null,coordinate:{id}});}
function validSupplement(a:SourceFetchArtifactDraft|undefined,url:string,role:string,id:string,start:string,jsonMime=false,redirect=false):a is SourceFetchArtifactDraft{if(!a)return false;const time=Date.parse(a.capturedAt),begin=Date.parse(start);return a.httpStatus===200&&a.bodyRepresentation==="EXACT"&&a.requestedUrl===sanitizeEvidenceHttpUrl(url)&&
 (redirect?!!ajingaId(a):a.finalUrl===sanitizeEvidenceHttpUrl(url))&&(jsonMime?/^application\/json(?:;|$)/iu:/^text\/html(?:;|$)/iu).test(a.contentType??"")&&a.kind===(jsonMime?"ATS_API_RESPONSE":"ATS_PAGE")&&Number.isFinite(time)&&time>=begin&&time<=begin+30*60_000&&a.extractorLocator===locator(role,url,id);}
function listWindow(evidence:PersistentSourceFetchEvidence,start:string){const begin=Date.parse(start);return evidence.artifacts.every(a=>a.httpStatus===200&&a.bodyRepresentation!=="REDACTED"&&Date.parse(a.capturedAt)>=begin&&Date.parse(a.capturedAt)<=begin+30*60_000)&&evidence.pages.every(p=>p.capturedAt===evidence.artifacts.find(a=>a.logicalKey===p.artifactLogicalKey)?.capturedAt);}
function comparisonPacket(evidence:PersistentSourceFetchEvidence){const {artifacts,...rest}=evidence;return {rest,artifacts:artifacts.map(a=>({...a,id:CN_PREFIX+a.id,logicalKey:CN_PREFIX+a.logicalKey}))};}
function unpack(plan:Extract<SourceCrawlPlan,{adapterId:"html-table"}>,evidence:PersistentSourceFetchEvidence){
 const primary=parsePersistentSourceFetchEvidence({...evidence,captureTool:{name:"official-html-http",version:"1"},artifacts:evidence.artifacts.filter(a=>a.logicalKey.startsWith("official-html-"))});
 const trace=evidence.artifacts.find(a=>a.logicalKey==="sanofi-cn-trace");assert(trace?.kind==="ORACLE_RESULT");
 const cn=parsePersistentSourceFetchEvidence({...json(body(trace!)),artifacts:evidence.artifacts.filter(a=>a.logicalKey.startsWith(CN_PREFIX)).map(a=>({...a,id:a.id.slice(CN_PREFIX.length),logicalKey:a.logicalKey.slice(CN_PREFIX.length)}))});
 assert(validateStrictHtmlCompletenessProof(listPlan(plan),primary)&&validateStrictHtmlCompletenessProof(listPlan(plan,true),cn));
 const start=primary.artifacts[0]!.capturedAt;assert(trace!.bodyRepresentation==="EXACT"&&trace!.extractorLocator==="sanofi-chinese-complete-list-trace-v1"&&trace!.capturedAt===cn.artifacts.at(-1)!.capturedAt&&listWindow(primary,start)&&listWindow(cn,start));
 return {primary,cn,start,enRows:listRows(listPlan(plan),primary),cnRows:listRows(listPlan(plan,true),cn)};
}
export function replaySanofiNativeQuality(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence):{primary:PersistentSourceFetchEvidence;projections:Map<string,{officialTitle:string;officialUrl:string;locationRaw:string;cities:string[]}>;start:string}|undefined{
 try{
  if(!exactPlan(plan))return undefined;const checked=parsePersistentSourceFetchEvidence(evidence),all=new Map(checked.artifacts.map(a=>[a.logicalKey,a]));if(all.size!==checked.artifacts.length||checked.fetchLosses.length)return undefined;
  const {primary,cn,start,enRows,cnRows}=unpack(plan,checked),used=new Set([...primary.artifacts.map(a=>a.logicalKey),...cn.artifacts.map(a=>CN_PREFIX+a.logicalKey),"sanofi-cn-trace"]);
  const readDetail=(row:NormalizedJobRecord,language:"en"|"cn")=>{const key=`sanofi-${language}-detail-${row.sourceJobId}`,a=all.get(key);assert(validSupplement(a,row.officialUrl,`${language}-detail`,row.sourceJobId!,start));used.add(key);const data=parseSanofiDetail(body(a!),row.officialUrl,row.sourceJobId!);assert(data&&data.title===row.officialTitle);return data!;};
  const enDetails=enRows.map(r=>readDetail(r,"en")),cnDetails=cnRows.map(r=>readDetail(r,"cn"));
  assert(new Set(enDetails.map(d=>d.reqId)).size===enDetails.length&&new Set(cnDetails.map(d=>d.reqId)).size===cnDetails.length&&enDetails.every(d=>d.scope==="MAINLAND")&&setEqual(enDetails.map(d=>d.reqId),cnDetails.filter(d=>d.scope==="MAINLAND").map(d=>d.reqId)));
  const projections=new Map<string,{officialTitle:string;officialUrl:string;locationRaw:string;cities:string[]}>();
  for(const en of enDetails){const cn=cnDetails.find(d=>d.reqId===en.reqId)!;assert(cn.applyUrl===tupuUrl(en.reqId));
   const tKey=`sanofi-tupu-${en.reqId}`,t=all.get(tKey);assert(validSupplement(t,cn.applyUrl,"tupu",en.reqId,start));used.add(tKey);
   let projected=tupuProjection(body(t!),cn),officialUrl=cn.applyUrl;
   if(!projected){assert(ajingaRoute(en));const key=`sanofi-ajinga-entry-${en.reqId}`,entry=all.get(key);assert(validSupplement(entry,en.applyUrl,"ajinga-entry",en.reqId,start,false,true));used.add(key);const id=ajingaId(entry!)!,iKey=`sanofi-ajinga-info-${en.reqId}`,info=all.get(iKey);assert(validSupplement(info,ajingaInfoUrl(id),"ajinga-info",en.reqId,start,true));used.add(iKey);
    const parsed=json(body(info!)),job=rec(rec(rec(parsed.data)?.data)?.job),short=job?.short_unique_id;assert(text(short)&&/^[A-Za-z0-9]+$/u.test(short));const aKey=`sanofi-ajinga-status-${en.reqId}`,a=all.get(aKey);assert(validSupplement(a,ajingaStatusUrl(short as string),"ajinga-status",en.reqId,start,true));used.add(aKey);projected=ajingaProjection(parsed,json(body(a!)),id,en.reqId);officialUrl=`https://www.ajinga.com/recruiting/company/13537/job/${id}/job-detail`;
   }
   assert(projected);projections.set(en.sourceJobId,{officialTitle:en.title,officialUrl,...projected!});
  }
  assert(used.size===all.size&&[...all.keys()].every(key=>used.has(key)));return {primary,projections,start};
 }catch{return undefined;}
}
export function applySanofiNativeProjection(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence|undefined,jobs:NormalizedJobRecord[]):void{
 if(!hasSanofiNativePolicy(plan)||!evidence)return;const proof=replaySanofiNativeQuality(plan,evidence);if(!proof)return;
 for(const job of jobs){const value=job.sourceJobId&&proof.projections.get(job.sourceJobId);if(value)Object.assign(job,value);}
}
export function validateSanofiNativeQuality(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,jobs:readonly NormalizedJobRecord[]|undefined):boolean{
 const proof=replaySanofiNativeQuality(plan,evidence);return !!proof&&!!jobs&&jobs.length===proof.projections.size&&new Set(jobs.map(j=>j.sourceJobId)).size===jobs.length&&jobs.every(job=>{const expected=job.sourceJobId&&proof.projections.get(job.sourceJobId);return !!expected&&typeof job.isBaseline==="boolean"&&same(job,{companyId:plan.company.id,sourceId:plan.source.id,sourceKind:"SOCIAL",atsKind:"OFFICIAL_HTML",officialChineseCompanyName:plan.company.officialChineseName,sourceJobId:job.sourceJobId,listUrl:ENGLISH,...expected,category:"其他",isBaseline:job.isBaseline,evidence:{officialEntryUrl:ENGLISH,officialChainEvidenceUrl:"https://jobs.sanofi.cn/",capturedAt:proof.start}});});
}
const defaultHttp:HttpHtmlClient=async request=>{const r=await fetchWithOfficialTimeout(request.url,{method:request.method??"GET",headers:request.headers,redirect:"follow"});return {status:r.status,body:await r.text(),finalUrl:r.url,contentType:r.headers.get("content-type")??"",capturedAt:new Date().toISOString()};};
export function createSanofiNativeSourceFetch(deps:HttpHtmlSourceFetchDeps={}):SourceFetchFunction{
 return async plan=>{
  let capturedAt=(deps.now?.()??new Date()).toISOString(),primary:PersistentSourceFetchEvidence|undefined,base:SourceFetchResult|undefined;const artifacts:SourceFetchArtifactDraft[]=[];let transportFailure:SourceTransportFailure|undefined;
  if(!exactPlan(plan))return {ok:false,capturedAt,failureReason:"SANOFI_NATIVE_PLAN_INVALID"};const http=deps.http??defaultHttp;
  const get=async(url:string,key:string,role:string,id:string,jsonMime=false,redirect=false)=>{let response;try{response=await http({url,method:"GET",headers:{Accept:jsonMime?"application/json":"text/html","User-Agent":"job-search-crawler/0.1"}});}catch(error){transportFailure=retryableTransportFailureFromError(error)??transportFailure;throw error;}
   transportFailure=retryableHttpTransportFailure(response.status)??transportFailure;const a:SourceFetchArtifactDraft={id:key,logicalKey:key,kind:jsonMime?"ATS_API_RESPONSE":"ATS_PAGE",requestedUrl:sanitizeEvidenceHttpUrl(url),finalUrl:response.finalUrl?sanitizeEvidenceHttpUrl(response.finalUrl):undefined,httpStatus:response.status,contentType:response.contentType,capturedAt:response.capturedAt??"",body:response.body,bodyRepresentation:"EXACT",extractorLocator:locator(role,url,id)};artifacts.push(a);assert(validSupplement(a,url,role,id,capturedAt,jsonMime,redirect));return a;};
  try{
   const fetcher=createHttpHtmlSourceFetch(deps);base=await fetcher(listPlan(plan));if(!base.ok){const retry=base.transportFailure??retryableHttpTransportFailure(base.fetchEvidence?.artifacts.at(-1)?.httpStatus??0);return {...base,...(retry?{transportFailure:retry}:{})};}assert("html"in base&&base.fetchEvidence);primary=base.fetchEvidence!;capturedAt=primary.artifacts[0]!.capturedAt;artifacts.push(...primary.artifacts);
   const chinese=await fetcher(listPlan(plan,true));if(!chinese.ok){transportFailure=chinese.transportFailure??retryableHttpTransportFailure(chinese.fetchEvidence?.artifacts.at(-1)?.httpStatus??0);if(chinese.fetchEvidence)artifacts.push(...comparisonPacket(chinese.fetchEvidence).artifacts);throw Error("SANOFI_CHINESE_LIST_FAILED");}assert(chinese.fetchEvidence);const cn=chinese.fetchEvidence!,packet=comparisonPacket(cn);artifacts.push(...packet.artifacts,{id:"sanofi-cn-trace",logicalKey:"sanofi-cn-trace",kind:"ORACLE_RESULT",capturedAt:cn.artifacts.at(-1)!.capturedAt,body:JSON.stringify(packet.rest),bodyRepresentation:"EXACT",extractorLocator:"sanofi-chinese-complete-list-trace-v1"});
   const enRows=listRows(listPlan(plan),primary),cnRows=listRows(listPlan(plan,true),cn),details:{language:"en"|"cn";value:SanofiDetail}[]=[];
   const targets=[...enRows.map(row=>({row,language:"en"as const})),...cnRows.map(row=>({row,language:"cn"as const}))];
   for(let offset=0;offset<targets.length;offset+=6)details.push(...await Promise.all(targets.slice(offset,offset+6).map(async({row,language})=>{const a=await get(row.officialUrl,`sanofi-${language}-detail-${row.sourceJobId}`,`${language}-detail`,row.sourceJobId!);const value=parseSanofiDetail(body(a),row.officialUrl,row.sourceJobId!);assert(value);return {language,value:value!};})));
   const en=details.filter(d=>d.language==="en").map(d=>d.value),cnMainland=details.filter(d=>d.language==="cn"&&d.value.scope==="MAINLAND").map(d=>d.value);assert(en.every(d=>d.scope==="MAINLAND")&&setEqual(en.map(d=>d.reqId),cnMainland.map(d=>d.reqId)));
   for(let offset=0;offset<en.length;offset+=4)await Promise.all(en.slice(offset,offset+4).map(async detail=>{const chinese=cnMainland.find(d=>d.reqId===detail.reqId)!;assert(chinese.applyUrl===tupuUrl(detail.reqId));const t=await get(chinese.applyUrl,`sanofi-tupu-${detail.reqId}`,"tupu",detail.reqId);if(tupuProjection(body(t),chinese))return;
    assert(ajingaRoute(detail));const entry=await get(detail.applyUrl,`sanofi-ajinga-entry-${detail.reqId}`,"ajinga-entry",detail.reqId,false,true),id=ajingaId(entry)!,info=await get(ajingaInfoUrl(id),`sanofi-ajinga-info-${detail.reqId}`,"ajinga-info",detail.reqId,true),parsed=json(body(info)),short=rec(rec(rec(parsed.data)?.data)?.job)?.short_unique_id;assert(text(short)&&/^[A-Za-z0-9]+$/u.test(short));await get(ajingaStatusUrl(short as string),`sanofi-ajinga-status-${detail.reqId}`,"ajinga-status",detail.reqId,true);
   }));
   const evidence=parsePersistentSourceFetchEvidence({...primary,captureTool:{name:"sanofi-native-chain-http",version:"1"},artifacts});assert(replaySanofiNativeQuality(plan,evidence));
   return {...base,capturedAt,fetchEvidence:evidence};
  }catch{return {ok:false,capturedAt,failureReason:"SANOFI_NATIVE_CHAIN_INVALID",...(transportFailure?{transportFailure}:{}),...(primary?{fetchEvidence:{...primary,artifacts}}:{}),...(base?.paginationEvaluation?{paginationEvaluation:base.paginationEvaluation}:{})};}
 };
}
