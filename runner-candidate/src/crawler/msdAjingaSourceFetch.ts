import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { mainlandDisplayCities } from "./fosunScopeGeography";
import {retryableHttpTransportFailure,retryableTransportFailureFromError,type SourceTransportFailure} from "./sourceFetchFailure";
import {isDeepStrictEqual as same} from "node:util";
import {load} from "cheerio";
import type {SourceCrawlPlan} from "./sourcePlan";
import type {SourceFetchFunction} from "./runSourceCrawl";
import type {NormalizedJobRecord} from "./normalizedJob";
import {fetchWithOfficialTimeout} from "./officialHttpRuntimeLimits";
import {deriveCanonicalPaginationEvidence,evaluatePaginationEvidence} from "./paginationEvidence";
import {parsePersistentSourceFetchEvidence,sanitizeEvidenceHttpUrl,sha256Bytes,type PersistentSourceFetchEvidence,type SourceFetchArtifactDraft,type SourceFetchPageTrace} from "./sourceFetchEvidence";
import {hasUniqueJsonObjectKeys} from "./strictJsonObjectKeys";
import {requestContractV2Locator} from "./strictPageRequestContract";
import type {StrictProfileBoundSourcePolicy} from "./profileBoundSourceEvidence";

export const MSD_AJINGA_CONFIG=Object.freeze({entryUrl:"https://www.ajinga.com/msdchina/professionals",companyId:13471,pageSize:30,maxPages:20});
export type MsdAjingaConfig=typeof MSD_AJINGA_CONFIG;
const ORIGIN="https://www.ajinga.com";
const rec=(v:unknown):Record<string,unknown>|undefined=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:undefined;
const text=(v:unknown):v is string=>typeof v==="string"&&v.trim().length>0;
const positive=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>0;
const norm=(v:string)=>v.trim().replace(/\s+/gu," ");
const unique=(values:string[])=>[...new Set(values)];
const setEqual=(a:string[],b:string[])=>same(unique(a).sort(),unique(b).sort());
const rawBody=(a:SourceFetchArtifactDraft)=>typeof a.body==="string"?a.body:Buffer.from(a.body).toString("utf8");
function json(a:SourceFetchArtifactDraft):Record<string,unknown>{const body=rawBody(a);if(!hasUniqueJsonObjectKeys(body))throw Error("MSD_AJINGA_JSON_INVALID");const data=rec(JSON.parse(body));if(!data)throw Error("MSD_AJINGA_JSON_INVALID");return data;}
function failUnless(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
function exactPlan(plan:SourceCrawlPlan):boolean{
 return plan.adapterId==="official-json"&&plan.company.id==="company-msd-china"&&plan.company.officialChineseName==="默沙东中国"&&
  plan.company.category==="FOREIGN_PHARMA"&&plan.source.id==="source-msd-china-social"&&plan.source.companyId===plan.company.id&&
  plan.source.kind==="SOCIAL"&&plan.source.atsKind==="OFFICIAL_JSON"&&plan.source.status==="VERIFIED_SCRAPABLE"&&
  plan.source.officialEntryUrl===MSD_AJINGA_CONFIG.entryUrl&&plan.source.officialChainEvidenceUrl===MSD_AJINGA_CONFIG.entryUrl&&
  plan.profileBoundSource?.kind==="msd-ajinga"&&same(plan.profileBoundSource.config,MSD_AJINGA_CONFIG)&&
  !plan.officialJsonFetch&&!plan.workday&&!plan.moka&&!plan.hotjob&&!plan.hotjobLegacy&&same(plan.json,{jobsPath:"jobs",fields:{
   sourceJobId:"sourceJobId",officialTitle:"title",officialUrl:"officialUrl",locationRaw:"locationRaw",cities:"cities"},defaultCategory:"其他"});
}
const listUrl=(page:number)=>`${ORIGIN}/django_rest/job-list/?company_id=13471&page=${page}`;
function urls(row:Record<string,unknown>){
 const company=rec(row.company);
 failUnless(positive(row.pk)&&positive(company?.pk)&&text(row.short_unique_id)&&/^[A-Za-z0-9]{1,64}$/u.test(row.short_unique_id),"MSD_AJINGA_ID_INVALID");
 return {detail:`${ORIGIN}/django_rest/job-detail/info/${row.short_unique_id}/?company_id=${company.pk}`,
  apply:`${ORIGIN}/django_rest/job-detail/apply-status/?short_id=${row.short_unique_id}`};
}
function scriptUrl(entry:SourceFetchArtifactDraft):string{
 const $=load(rawBody(entry));
 const matches=$("script[src]").map((_,e)=>$(e).attr("src")).get().filter(v=>/^https:\/\/static-c\.ajinga\.com\/v-prod\/js\/app\.[a-f0-9]+\.js$/u.test(v));
 failUnless(matches.length===1,"MSD_AJINGA_BOOTSTRAP_INVALID");return matches[0]!;
}
function scriptValid(script:SourceFetchArtifactDraft):boolean{const body=rawBody(script);return /\bMSD\s*:\s*13471\b/u.test(body)&&body.includes("professionals")&&body.includes("/django_rest/job-list/");}
function pageData(artifact:SourceFetchArtifactDraft,page:number){
 const root=json(artifact),data=rec(root.data);
 failUnless(root.code===200&&data&&Number.isSafeInteger(data.count)&&(data.count as number)>=0&&Array.isArray(data.list)&&
  data.list.every(rec)&&typeof data.isLastPage==="boolean"&&data.cant_applied===false,"MSD_AJINGA_LIST_INVALID");
 const total=data.count as number,rows=data.list as Record<string,unknown>[];
 failUnless(page<=Math.max(1,Math.ceil(total/30))&&rows.length===Math.min(30,Math.max(0,total-(page-1)*30))&&
  data.isLastPage===(page===Math.max(1,Math.ceil(total/30))),"MSD_AJINGA_PAGINATION_DRIFT");
 return {total,rows,last:data.isLastPage};
}
export function projectMsdAjingaJob(row:Record<string,unknown>,detailInput:unknown,applyInput:unknown):
 {sourceJobId:string;title:string;officialUrl:string;locationRaw:string;cities:string[]}|undefined{
 const company=rec(row.company),root=rec(detailInput),data=rec(rec(root?.data)?.data),job=rec(data?.job),detailCompany=rec(data?.company),
  application=rec(applyInput),apply=rec(application?.data);
 if(!positive(row.pk)||!text(row.short_unique_id)||!text(row.title)||!positive(company?.pk)||company.root_pk!==13471||
  !["E","IE"].includes(row.job_visibility as string)||row.show_apply!==1||row.finish_apply!==false||row.cant_applied!==false||row.is_overseas!==false||
  row.url!==`/job-detail-new/${row.pk}/c/`||row.apply_url!==`/apply-job-process/${row.pk}/?company_id=${company.pk}`||
  root?.code!==200||data?.is_in_china!==true||detailCompany?.id!==company.pk||rec(detailCompany?.root_company)?.id!==13471||
  job?.id!==row.pk||job.root_company_id!==13471||rec(job.company)?.id!==company.pk||job.short_unique_id!==row.short_unique_id||
  !text(job.i18n_name)||norm(job.i18n_name)!==norm(row.title)||!["E","IE"].includes(job.job_visibility as string)||
  !text(job.description)||!load(job.description).text().trim()||application?.code!==200||apply?.show_apply!==1||
  apply.normal_share_url!==`${ORIGIN}/recruiting/company/${company.pk}/job/${row.pk}/job-detail`||!Array.isArray(row.cities)||
  !row.cities.length||!row.cities.every(text)||!Array.isArray(job.job_locations)||!job.job_locations.length)return undefined;
 // Ajinga localizes list cities. Bind each label only to the bilingual city object
 // on this exact job's native detail; an external translation table cannot prove it.
 const locations=job.job_locations.map(v=>rec(rec(v)?.city));
 if(locations.some(city=>!text(city?.cn_name)||explicitlyForeignOrNonMainlandLocation(city.cn_name)||
  /(?:香港|澳门|台湾|臺灣|台北|臺北|新北|高雄|台中|臺中|台南|臺南|桃园|桃園)/u.test(city.cn_name)))return undefined;
 const rawCities=unique(row.cities as string[]),cities:string[]=[];
 for(const label of rawCities){
  const matches=unique(locations.filter(city=>city!.cn_name===label||city!.name===label).map(city=>city!.cn_name as string));
  if(matches.length!==1)return undefined;cities.push(matches[0]!);
 }
 if(!setEqual(cities,locations.map(city=>city!.cn_name as string)))return undefined;
 return {sourceJobId:`ajinga:${row.pk}`,title:norm(row.title),officialUrl:ORIGIN+row.url,locationRaw:rawCities.join("、"),cities:mainlandDisplayCities(unique(cities))};
}
function locator(role:string,url:string,coordinate:unknown){return requestContractV2Locator(`msd-ajinga-${role}-v1`,{family:"msd-ajinga",role,method:"GET",url,body:null,coordinate});}
function trace(artifact:SourceFetchArtifactDraft,page:number,total:number,rows:Record<string,unknown>[]):SourceFetchPageTrace{
 const last=(page-1)*30+rows.length===total;
 return {sequence:page-1,artifactLogicalKey:artifact.logicalKey,requestedCursor:null,returnedCursor:null,requestedOffset:null,returnedOffset:null,
  requestedPage:page,returnedPage:null,requestedPageSize:null,returnedPageSize:null,rawJobIds:rows.map(row=>String(row.pk)),validJobIds:rows.map(row=>`ajinga:${row.pk}`),
  declaredTotal:total,declaredCount:null,declaredPages:null,nextPageSignalBefore:page===1?null:`page:${page}`,nextPageSignalAfter:last?null:`page:${page+1}`,
  responseFingerprintSha256:sha256Bytes(Buffer.from(rawBody(artifact))).sha256,termination:total===0?"EMPTY_PAGE":last?"DECLARED_TOTAL_REACHED":"CONTINUE",anomalyCodes:[],capturedAt:artifact.capturedAt};
}
const evaluationOptions={expectedChannelIds:[] as string[],filteredOutput:true,allowMissingReturnedPage:true,allowPositiveOfficialTotalCountAfterAdapterReconciliation:true};
function evidenceFor(artifacts:SourceFetchArtifactDraft[],pages:SourceFetchPageTrace[],total:number|undefined){
 const count=pages.reduce((sum,p)=>sum+p.rawJobIds.length,0),first=artifacts.find(a=>a.logicalKey==="msd-ajinga-page-1");
 const raw=parsePersistentSourceFetchEvidence({captureTool:{name:"msd-ajinga-http",version:"1"},artifacts,pages,
  ...(pages.length&&total!==undefined&&first?{declaredCompleteness:{kind:"OFFICIAL_TOTAL_COUNT",value:total,scope:"SOURCE",artifactLogicalKey:first.logicalKey,extractorLocator:first.extractorLocator}}:
  {supportingArtifactOnlyFailure:{code:"MSD_AJINGA_INCOMPLETE"}}),
  fetchCounts:{rawCount:count,parsedCount:count,validCount:count,parseDiscardCount:0,validationDiscardCount:0},fetchLosses:[]});
 const evidence=deriveCanonicalPaginationEvidence({...evaluationOptions,evidence:raw});
 return {evidence,evaluation:evaluatePaginationEvidence({...evaluationOptions,evidence})};
}
export interface MsdAjingaHttpResponse{status:number;body:string;finalUrl:string;contentType:string;capturedAt:string;}
type Http=(url:string)=>Promise<MsdAjingaHttpResponse>;
async function defaultHttp(url:string):Promise<MsdAjingaHttpResponse>{const response=await fetchWithOfficialTimeout(url,{redirect:"follow",headers:{Accept:"application/json,text/html,application/javascript","User-Agent":"job-search-crawler/0.1"}});return {status:response.status,body:await response.text(),finalUrl:response.url,contentType:response.headers.get("content-type")??"",capturedAt:new Date().toISOString()};}
function validArtifact(a:SourceFetchArtifactDraft|undefined,url:string,role:string,coordinate:unknown,start:string,mime:RegExp):a is SourceFetchArtifactDraft{
 const time=a&&Date.parse(a.capturedAt),begin=Date.parse(start);
 return !!a&&a.requestedUrl===sanitizeEvidenceHttpUrl(url)&&a.finalUrl===sanitizeEvidenceHttpUrl(url)&&a.httpStatus===200&&a.bodyRepresentation==="EXACT"&&mime.test(a.contentType??"")&&
  Number.isFinite(time)&&time!>=begin&&time!<=begin+30*60_000&&a.extractorLocator===locator(role,url,coordinate);
}
export function createMsdAjingaSourceFetch(deps:{http?:Http;now?:()=>Date}={}):SourceFetchFunction{
 return async plan=>{
  const now=deps.now??(()=>new Date()),http=deps.http??defaultHttp;let capturedAt=now().toISOString();
  if(!exactPlan(plan))return {ok:false,capturedAt,failureReason:"MSD_AJINGA_PLAN_INVALID"};
  const artifacts:SourceFetchArtifactDraft[]=[],pages:SourceFetchPageTrace[]=[];let total:number|undefined,transportFailure:SourceTransportFailure|undefined;
  const get=async(url:string,key:string,role:string,coordinate:unknown,mime:RegExp)=>{
   let response;try{response=await http(url);}catch(error){transportFailure=retryableTransportFailureFromError(error)??transportFailure;throw error;}
   transportFailure=retryableHttpTransportFailure(response.status)??transportFailure;
   const a:SourceFetchArtifactDraft={id:key,logicalKey:key,kind:role==="entry"||role==="script"?"OFFICIAL_COMPANY_PAGE":role==="list"?"PAGINATION_PAGE":"ATS_API_RESPONSE",
    requestedUrl:sanitizeEvidenceHttpUrl(url),finalUrl:sanitizeEvidenceHttpUrl(response.finalUrl),httpStatus:response.status,contentType:response.contentType,capturedAt:response.capturedAt,body:response.body,bodyRepresentation:"EXACT",extractorLocator:locator(role,url,coordinate)};
   artifacts.push(a);failUnless(validArtifact(a,url,role,coordinate,capturedAt,mime),"MSD_AJINGA_RESPONSE_INVALID");return a;
  };
  try{
   const entry=await get(MSD_AJINGA_CONFIG.entryUrl,"msd-ajinga-entry","entry",null,/^text\/html(?:;|$)/iu);capturedAt=entry.capturedAt;
   const script=await get(scriptUrl(entry),"msd-ajinga-script","script",null,/^(?:application|text)\/javascript(?:;|$)/iu);failUnless(scriptValid(script),"MSD_AJINGA_BOOTSTRAP_INVALID");
   const rows:Record<string,unknown>[]=[];
   for(let page=1;page<=MSD_AJINGA_CONFIG.maxPages;page++){
    const a=await get(listUrl(page),`msd-ajinga-page-${page}`,"list",{page},/^application\/json(?:;|$)/iu),data=pageData(a,page);
    if(total===undefined)total=data.total;failUnless(data.total===total,"MSD_AJINGA_TOTAL_DRIFT");
    rows.push(...data.rows);pages.push(trace(a,page,total,data.rows));if(data.last)break;
   }
   failUnless(rows.length===total&&new Set(rows.map(r=>r.pk)).size===total&&new Set(rows.map(r=>r.short_unique_id)).size===total,"MSD_AJINGA_SET_NOT_CLOSED");
   const jobs:Array<NonNullable<ReturnType<typeof projectMsdAjingaJob>>>=[];
   for(let offset=0;offset<rows.length;offset+=4){
    const group=await Promise.all(rows.slice(offset,offset+4).map(async row=>{
     const u=urls(row),coordinate={id:row.pk,shortId:row.short_unique_id,companyId:rec(row.company)!.pk};
     const [detail,apply]=await Promise.all([get(u.detail,`msd-ajinga-detail-${row.pk}`,"detail",coordinate,/^application\/json(?:;|$)/iu),get(u.apply,`msd-ajinga-apply-${row.pk}`,"apply",coordinate,/^application\/json(?:;|$)/iu)]);
     const job=projectMsdAjingaJob(row,json(detail),json(apply));failUnless(job,"MSD_AJINGA_RECORD_INVALID");return job;
    }));jobs.push(...group);
   }
   const result=evidenceFor(artifacts,pages,total);
   return {ok:true,capturedAt,payload:{jobs},fetchEvidence:result.evidence,paginationEvaluation:result.evaluation,
    completeness:{completenessStatus:"NEEDS_MANUAL_COMPLETENESS_REVIEW",expectedJobCount:total,completenessEvidenceKind:"OFFICIAL_TOTAL_COUNT",completenessEvidenceUrl:MSD_AJINGA_CONFIG.entryUrl}};
  }catch(error){
   let retained;try{if(artifacts.length)retained=evidenceFor(artifacts,pages,total);}catch{}
   return {ok:false,capturedAt,failureReason:error instanceof Error&&/^MSD_AJINGA_[A-Z_]+$/u.test(error.message)?error.message:"MSD_AJINGA_FETCH_FAILED",
    ...(transportFailure?{transportFailure}:{}),...(retained?{fetchEvidence:retained.evidence,paginationEvaluation:retained.evaluation}:{})};
  }
 };
}
export function getStrictMsdAjingaPolicy(plan:SourceCrawlPlan):StrictProfileBoundSourcePolicy|undefined{
 if(!exactPlan(plan))return undefined;
 return {allowMissingReturnedPage:true,allowPositiveOfficialTotalCountAfterAdapterReconciliation:true,urlRules:[
  {id:"msd-ajinga-entry",url:MSD_AJINGA_CONFIG.entryUrl,match:"EXACT"},{id:"msd-ajinga-script",url:"https://static-c.ajinga.com/v-prod/js/",match:"PATH_PREFIX"},
  ...Array.from({length:20},(_,i)=>({id:`msd-ajinga-list-${i+1}`,url:listUrl(i+1),match:"EXACT" as const,allowsPagination:true as const,
   ...(i===0?{allowsDeclaration:true as const,allowsPositiveTotalDeclaration:true as const}:{})}))]};
}
export function validateStrictMsdAjingaEvidence(plan:SourceCrawlPlan,input:PersistentSourceFetchEvidence,jobs:readonly NormalizedJobRecord[]):boolean{
 try{
  if(!exactPlan(plan))return false;const evidence=parsePersistentSourceFetchEvidence(input),artifacts=new Map(evidence.artifacts.map(a=>[a.logicalKey,a]));
  if(artifacts.size!==evidence.artifacts.length||evidence.fetchLosses.length)return false;
  const entry=artifacts.get("msd-ajinga-entry"),start=entry?.capturedAt??"";
  if(!validArtifact(entry,MSD_AJINGA_CONFIG.entryUrl,"entry",null,start,/^text\/html(?:;|$)/iu))return false;
  const script=artifacts.get("msd-ajinga-script");
  if(!validArtifact(script,scriptUrl(entry),"script",null,start,/^(?:application|text)\/javascript(?:;|$)/iu)||!scriptValid(script))return false;
  const rows:Record<string,unknown>[]=[];let total:number|undefined;
  for(let i=0;i<evidence.pages.length;i++){
   const page=i+1,a=artifacts.get(`msd-ajinga-page-${page}`);
   if(page>20||!validArtifact(a,listUrl(page),"list",{page},start,/^application\/json(?:;|$)/iu))return false;
   const data=pageData(a,page);if(total===undefined)total=data.total;
   if(data.total!==total||!same(evidence.pages[i],trace(a,page,total,data.rows)))return false;rows.push(...data.rows);
  }
  if(total===undefined||rows.length!==total||new Set(rows.map(r=>r.pk)).size!==total||new Set(rows.map(r=>r.short_unique_id)).size!==total||
   evidence.artifacts.length!==2+evidence.pages.length+2*total||!same(evidence.fetchCounts,{rawCount:total,parsedCount:total,validCount:total,parseDiscardCount:0,validationDiscardCount:0}))return false;
  const first=artifacts.get("msd-ajinga-page-1")!;
  if(!same(evidence.declaredCompleteness,{kind:"OFFICIAL_TOTAL_COUNT",value:total,scope:"SOURCE",artifactLogicalKey:first.logicalKey,extractorLocator:first.extractorLocator}))return false;
  const expected=new Map<string,ReturnType<typeof projectMsdAjingaJob>>();
  for(const row of rows){const u=urls(row),coordinate={id:row.pk,shortId:row.short_unique_id,companyId:rec(row.company)!.pk};
   const detail=artifacts.get(`msd-ajinga-detail-${row.pk}`),apply=artifacts.get(`msd-ajinga-apply-${row.pk}`);
   if(!validArtifact(detail,u.detail,"detail",coordinate,start,/^application\/json(?:;|$)/iu)||!validArtifact(apply,u.apply,"apply",coordinate,start,/^application\/json(?:;|$)/iu))return false;
   const output=projectMsdAjingaJob(row,json(detail),json(apply));if(!output)return false;expected.set(output.sourceJobId,output);
  }
  return jobs.length===total&&new Set(jobs.map(j=>j.sourceJobId)).size===total&&jobs.every(job=>{const row=job.sourceJobId&&expected.get(job.sourceJobId);
   return !!row&&typeof job.isBaseline==="boolean"&&same(job,{companyId:plan.company.id,sourceId:plan.source.id,sourceKind:"SOCIAL",atsKind:"OFFICIAL_JSON",
    officialChineseCompanyName:plan.company.officialChineseName,officialTitle:row.title,officialUrl:row.officialUrl,listUrl:MSD_AJINGA_CONFIG.entryUrl,
    sourceJobId:row.sourceJobId,locationRaw:row.locationRaw,cities:row.cities,category:"其他",isBaseline:job.isBaseline,
    evidence:{officialEntryUrl:MSD_AJINGA_CONFIG.entryUrl,officialChainEvidenceUrl:MSD_AJINGA_CONFIG.entryUrl,capturedAt:start}});});
 }catch{return false;}
}
