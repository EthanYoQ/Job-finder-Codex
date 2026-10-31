import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { load } from "cheerio";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { savePrivateDomFailure } from "./local-browser/private-dom-failure.mjs";
import { ajingaRoute, ajingaId, ajingaInfoUrl, ajingaStatusUrl, ajingaProjection, validSupplement, locator } from "./sanofiNativeQuality";
import { sanitizeEvidenceHttpUrl, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import type { HttpHtmlClient } from "./httpHtmlSourceFetch";
import type { SanofiChineseDetail, SanofiChineseNativeResult } from "./sanofiChineseNative";
export { ajingaRoute };
const assert=(v:unknown,stage?:string):void=>{if(!v)throw Object.assign(Error("SANOFI_CN_AJINGA_CHAIN_INVALID"),stage?{sourceFetchStage:stage}:{});};
const body=(a:SourceFetchArtifactDraft)=>typeof a.body==="string"?a.body:Buffer.from(a.body).toString("utf8");
const json=(s:string)=>{assert(hasUniqueJsonObjectKeys(s));return JSON.parse(s);};
const keys=(req:string)=>["entry","info","status"].map(role=>`sanofi-ajinga-${role}-${req}`);
export const sanofiAjingaKeys=keys;
export function replaySanofiChineseAjinga(detail:SanofiChineseDetail,start:string,artifacts:SourceFetchArtifactDraft[]):SanofiChineseNativeResult {
  assert(ajingaRoute(detail)&&!detail.headerAnomaly&&!detail.anomaly&&detail.countryScope==="MAINLAND"&&artifacts.length===3);
  const [entry,info,status]=artifacts,expected=keys(detail.reqId);assert(artifacts.every((a,i)=>a.id===expected[i]&&a.logicalKey===expected[i]));
  assert(validSupplement(entry,detail.applyUrl,"ajinga-entry",detail.reqId,start,false,true),"SANOFI_AJINGA_ENTRY");
  const id=ajingaId(entry!)!;assert(validSupplement(info,ajingaInfoUrl(id),"ajinga-info",detail.reqId,entry!.capturedAt,true),"SANOFI_AJINGA_INFO");
  const data=json(body(info!)),job=data?.data?.data?.job,short=job?.short_unique_id;assert(typeof short==="string"&&/^[A-Za-z0-9]+$/u.test(short),"SANOFI_AJINGA_INFO");
  assert(validSupplement(status,ajingaStatusUrl(short),"ajinga-status",detail.reqId,info!.capturedAt,true),"SANOFI_AJINGA_STATUS");
  assert(Date.parse(status!.capturedAt)-Date.parse(start)<=30*60_000);
  const projection=ajingaProjection(data,json(body(status!)),id,detail.reqId);assert(projection,"SANOFI_AJINGA_PROJECTION");
  const description=load(job.description).text().replace(/\s+/gu,"").normalize("NFKC");
  assert(job.i18n_name.replace(/\s+/gu," ").trim()===`${detail.reqId} ${detail.title}`,"SANOFI_AJINGA_TITLE_MATCH");
  assert(description===detail.description,"SANOFI_AJINGA_DESCRIPTION_MATCH");
  return {state:"PUBLISHING",nativePositionId:id,nativeDescriptionSha256:createHash("sha256").update(description).digest("hex"),...projection!};
}
export async function captureSanofiChineseAjinga(detail:SanofiChineseDetail,start:string,http:HttpHtmlClient,onArtifact:(a:SourceFetchArtifactDraft)=>Promise<void>|void,
  diagnostic:{detailResponse?:unknown;failureDirectory?:string}={}):Promise<SourceFetchArtifactDraft[]> {
  const artifacts:SourceFetchArtifactDraft[]=[];
  let stage="SANOFI_AJINGA_ROUTE";
  try {
  assert(ajingaRoute(detail));
  const get=async(url:string,role:string,json=false)=>{const r=await http({url,method:"GET",headers:{Accept:json?"application/json":"text/html","User-Agent":"job-search-crawler/0.1"}});const key=`sanofi-${role}-${detail.reqId}`;
    const a:SourceFetchArtifactDraft={id:key,logicalKey:key,kind:json?"ATS_API_RESPONSE":"ATS_PAGE",requestedUrl:sanitizeEvidenceHttpUrl(url),finalUrl:r.finalUrl?sanitizeEvidenceHttpUrl(r.finalUrl):undefined,httpStatus:r.status,contentType:r.contentType,capturedAt:r.capturedAt??"",body:r.body,bodyRepresentation:"EXACT",extractorLocator:locator(role,url,detail.reqId)};
    artifacts.push(a);await onArtifact(a);return a;};
  stage="SANOFI_AJINGA_ENTRY";
  const entry=await get(detail.applyUrl,"ajinga-entry");assert(validSupplement(entry,detail.applyUrl,"ajinga-entry",detail.reqId,start,false,true));const id=ajingaId(entry)!;
  stage="SANOFI_AJINGA_INFO";
  const info=await get(ajingaInfoUrl(id),"ajinga-info",true);assert(validSupplement(info,ajingaInfoUrl(id),"ajinga-info",detail.reqId,entry.capturedAt,true));
  const short=json(body(info))?.data?.data?.job?.short_unique_id;assert(typeof short==="string"&&/^[A-Za-z0-9]+$/u.test(short));
  stage="SANOFI_AJINGA_STATUS";await get(ajingaStatusUrl(short),"ajinga-status",true);
  stage="SANOFI_AJINGA_REPLAY";
  replaySanofiChineseAjinga(detail,start,artifacts);return artifacts;
  } catch(error) {
    const cause=error instanceof Error?error:Error("SANOFI_CN_AJINGA_CHAIN_INVALID");
    const tagged=Object.assign(cause,{sourceFetchStage:(cause as Error & {sourceFetchStage?:string}).sourceFetchStage??stage,sourceJobId:detail.reqId,
      privateCapture:undefined as {file:string;sha256:string}|undefined,privateCaptureUnavailable:false});
    const reqId=/^R[0-9]{1,20}$/.test(detail.reqId)?detail.reqId:"invalid";
    try {tagged.privateCapture=await savePrivateDomFailure({
      directory:diagnostic.failureDirectory??join(process.env.JOBFINDER_STATE_ROOT??"/data/job-finder","diagnostics","sanofi"),
      filePrefix:`sanofi-ajinga-${reqId}`,
      context:{kind:"SANOFI_AJINGA_FAILURE_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE",stage:tagged.sourceFetchStage,reqId,start},
      observe:async()=>({detail,detailResponse:diagnostic.detailResponse,artifacts})
    });} catch {tagged.privateCaptureUnavailable=true;}
    throw tagged;
  }
}
