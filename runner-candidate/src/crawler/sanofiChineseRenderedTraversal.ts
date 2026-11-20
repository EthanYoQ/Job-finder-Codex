import { currentOfficialSourceAttemptSignal } from './officialHttpRuntimeLimits';
import { ajingaRoute, captureSanofiChineseAjinga, replaySanofiChineseAjinga } from "./sanofiChineseAjinga";
import type { SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { load } from "cheerio";
import { isDeepStrictEqual as same } from "node:util";
import type { HttpHtmlClient } from "./httpHtmlSourceFetch";
import type { OfficialJsonRenderedPageCapture, OfficialJsonRenderedReplay } from "./officialJsonRenderedTraversalValidator";
import { SANOFI_CN_CHANNEL, SANOFI_CN_ENTRY, parseSanofiChineseDetail, parseSanofiChineseNative,
  sanofiChineseDecision, sanofiChineseHttp, sanofiHash, sanofiRawEvidenceId, type SanofiChineseDecision, type SanofiChineseRow, type SanofiDescriptionAnomaly } from "./sanofiChineseNative";
import { sanofiPersistentJobId } from "./sanofiLegacyIdentity";

export const SANOFI_CN_INDEPENDENT_PATH="CUA_CHINESE_DOM_LIST_PLUS_NEW_NATIVE_HTTP";
export interface SanofiChineseDomPage { url:string; capturedAt:string; searchResultsHtml:string }
export interface SanofiChineseDomCapture { schemaVersion:"sanofi-cn-cua-dom-list-v1"; observedAt:string; pages:SanofiChineseDomPage[] }
interface NativeReceipt { method:"GET";url:string;finalUrl:string;status:number;contentType:string;capturedAt:string;body:string;bodySha256:string;redirect?:"error" }
const clean=(s:string)=>s.replace(/\s+/gu," ").trim();
const assert=(v:unknown):void=>{if(!v)throw Error("SANOFI_CN_INDEPENDENT_EVIDENCE_INVALID");};
const time=(s:string)=>typeof s==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(s)&&new Date(s).toISOString()===s;

/** The independent universe is read from actual rendered Chinese UI snapshots.
 * Neither main AJAX rows nor their archived HTTP receipts are accepted inputs. */
export function validateSanofiChineseDom(capture:SanofiChineseDomCapture):{total:number;rows:SanofiChineseRow[][]} {
  assert(capture.schemaVersion==="sanofi-cn-cua-dom-list-v1"&&time(capture.observedAt)&&capture.pages.length>0&&capture.pages[0]?.capturedAt===capture.observedAt);
  const ids=new Set<string>(),pages:SanofiChineseRow[][]=[];let total:number|undefined,prior=capture.observedAt;
  for(const [index,page] of capture.pages.entries()){
    const u=new URL(page.url);assert(u.origin==="https://jobs.sanofi.cn"&&!u.username&&!u.password&&!u.hash&&time(page.capturedAt)&&page.capturedAt>=prior);
    assert(u.pathname.toLowerCase()===new URL(SANOFI_CN_ENTRY).pathname.toLowerCase()||u.pathname.startsWith("/search-jobs/"));prior=page.capturedAt;
    const $=load(page.searchResultsHtml),root=$("#search-results"),n=Number(root.attr("data-total-job-results"));total??=n;
    assert(root.length===1&&root.attr("data-location")==="中国"&&root.attr("data-keywords")===""&&root.attr("data-location-path")==="1814991"&&root.attr("data-organization-ids")==="2649"&&
      Number.isSafeInteger(n)&&n>0&&n===total&&Number(root.attr("data-current-page"))===index+1&&Number(root.attr("data-total-pages"))===capture.pages.length&&root.attr("data-records-per-page")==="15");
    const next=root.find("a.next"),active=root.find("input.pagination-current");assert(next.length===1&&next.hasClass("disabled")===(index===capture.pages.length-1)&&active.length===1&&active.attr("value")===String(index+1)&&active.attr("max")===String(capture.pages.length));
    const rows:SanofiChineseRow[]=[];
    for(const [recordIndex,node] of root.find("#search-results-list > li, #search-results-list > ul > li").toArray().entries()){
      const r=$(node),link=r.find("a[data-job-id]"),candidates=new Set(r.find("button.js-save-job-btn,a[data-job-id]").toArray().map(n=>$(n).attr('data-job-id')));
      const known=candidates.size===1&&/^\d+$/u.test([...candidates][0]??'')?[...candidates][0]:undefined;
      const id=known??`unidentified:${sanofiHash(JSON.stringify([index,recordIndex,$.html(node)]))}`,href=new Set(link.toArray().map(n=>$(n).attr('href'))).size===1?link.attr('href')??'':'';
      assert(!ids.has(id));ids.add(id);
      let url=href;try{url=new URL(href,page.url).toString();}catch{/* The original broken link remains an unverified row. */}
      rows.push({id,title:clean(r.find("h2").text()),url,listLocation:clean(r.find("span.job-location").text())});
    }
    assert(rows.length===Math.min(15,total-index*15));pages.push(rows);
  }
  assert(total===ids.size&&capture.pages.length===Math.ceil(total!/15)&&Date.parse(prior)-Date.parse(capture.observedAt)<=30*60_000);return {total:total!,rows:pages};
}
function validateReceipt(r:NativeReceipt|undefined,url:string,after:string):asserts r is NativeReceipt {
  assert(r&&r.method==="GET"&&r.url===url&&r.finalUrl===url&&r.status===200&&/^text\/html(?:;|$)/iu.test(r.contentType)&&time(r.capturedAt)&&
    Date.parse(r.capturedAt)>=Date.parse(after)&&Date.parse(r.capturedAt)-Date.parse(after)<=30*60_000&&r.bodySha256===sanofiHash(r.body)&&
    (r.redirect===undefined||r.redirect==="error"));
}
function validDomRow(row:SanofiChineseRow):boolean{
 try{const url=new URL(row.url);return !!row.title&&/^\d+$/u.test(row.id)&&url.origin==='https://jobs.sanofi.cn'&&!url.search&&!url.hash&&!url.username&&!url.password&&url.pathname.endsWith(`/3036/${row.id}`);}catch{return false;}
}
function projectRow(payload:Record<string,unknown>,observedAt:string,after:string){
 const row=payload.domRow as SanofiChineseRow,rawEvidenceId=sanofiRawEvidenceId(row.id);
 try{
  assert(validDomRow(row));const response=payload.detailResponse as NativeReceipt|undefined;validateReceipt(response,row.url,after);const detail=parseSanofiChineseDetail(response.body,row);
  const native=payload.nativeResponse as NativeReceipt|undefined,ajinga=payload.ajingaArtifacts as SourceFetchArtifactDraft[]|undefined;let parsed:ReturnType<typeof parseSanofiChineseNative>|undefined;
  if(detail.countryScope==='OUTSIDE')assert(!native&&!ajinga);
  else if(ajingaRoute(detail)){assert(!native&&ajinga);parsed=replaySanofiChineseAjinga(detail,observedAt,ajinga!);}
  else{assert(!ajinga);validateReceipt(native,detail.applyUrl,response.capturedAt);parsed=parseSanofiChineseNative(native.body,detail);}
  const decision=sanofiChineseDecision(detail,parsed);
  return {sourceJobId:decision.sourceJobId,rawEvidenceId,marker:decision.state,decision,descriptionAnomaly:parsed?.descriptionAnomaly};
 }catch{return {sourceJobId:`sanofi-independent-unknown:${row.id}`,rawEvidenceId,marker:'UNKNOWN_JOB',decision:undefined,descriptionAnomaly:undefined};}
}

/** Keeps the original group of four; a failed job cannot stop the next group. */
export async function captureSanofiChineseIndependent(input:{dom:SanofiChineseDomCapture;http?:HttpHtmlClient;now?:()=>Date;signal?:AbortSignal;onReceipt?:(r:NativeReceipt,index:number)=>Promise<void>}):Promise<{observedAt:string;pages:OfficialJsonRenderedPageCapture[]}> {
 const {total,rows}=validateSanofiChineseDom(input.dom),now=input.now??(()=>new Date()),after=input.dom.pages.at(-1)!.capturedAt;
 assert(now().getTime()>=Date.parse(after)&&now().getTime()-Date.parse(input.dom.observedAt)<=30*60_000);
 const base=input.http??sanofiChineseHttp;let ordinal=0,fatalError:unknown;
 const check=()=>{input.signal?.throwIfAborted();currentOfficialSourceAttemptSignal()?.throwIfAborted();if(fatalError)throw fatalError;};
 const pages:OfficialJsonRenderedPageCapture[]=[];
 for(const [pageIndex,own] of rows.entries()){
  const domPage=input.dom.pages[pageIndex]!,rawRows:Array<OfficialJsonRenderedPageCapture['rawRows'][number]>=[];
  const collect=async(row:SanofiChineseRow,recordIndex:number)=>{
   const payload:Record<string,unknown>={captureMethod:SANOFI_CN_INDEPENDENT_PATH,domPage,domRow:row},trail:NativeReceipt[]=[];
   const http:HttpHtmlClient=async request=>{
    check();const response=await base(request);
    const receipt:NativeReceipt={method:'GET',url:request.url,finalUrl:response.finalUrl??'',status:response.status,contentType:response.contentType??'',capturedAt:response.capturedAt??now().toISOString(),body:response.body,bodySha256:sanofiHash(response.body),...(request.redirect==='error'?{redirect:'error'}:{})};
    trail.push(receipt);
    if([403,429].includes(receipt.status))fatalError??=Object.assign(Error('SANOFI_CN_INDEPENDENT_ACCESS_RESTRICTED'),{httpStatus:receipt.status});
    try{await input.onReceipt?.(receipt,ordinal++);}catch(error){fatalError??=error instanceof Error?error:Error('SANOFI_CN_INDEPENDENT_RECEIPT_PERSIST_FAILED');}
    check();return {...response,capturedAt:receipt.capturedAt};
   };
   const get=async(url:string,redirect?:'error')=>{
    await http({url,method:'GET',headers:{Accept:'text/html','User-Agent':'job-search-independent-validator/0.1'},...(redirect?{redirect}:{})});return trail.at(-1)!;
   };
   try{
    check();assert(validDomRow(row));const detailResponse=await get(row.url);payload.detailResponse=detailResponse;validateReceipt(detailResponse,row.url,after);
    const detail=parseSanofiChineseDetail(detailResponse.body,row);
    if(detail.countryScope==='MAINLAND'&&ajingaRoute(detail)){
      const originals:SourceFetchArtifactDraft[]=[];payload.ajingaArtifacts=originals;
      await captureSanofiChineseAjinga(detail,input.dom.observedAt,http,a=>{originals.push(a);},{detailResponse});
    }else if(detail.countryScope==='MAINLAND')payload.nativeResponse=await get(detail.applyUrl,'error');
   }catch{check();payload.jobUnavailable={code:'JOB_CAPTURE_UNAVAILABLE',capturedAt:now().toISOString()};payload.receiptTrail=trail;}
   const outcome=projectRow(payload,input.dom.observedAt,after);
   if(outcome.marker==='UNKNOWN_JOB'){payload.jobUnavailable??={code:'JOB_UNVERIFIED',capturedAt:now().toISOString()};payload.receiptTrail=trail;}
   else if(outcome.descriptionAnomaly)payload.descriptionAnomaly=outcome.descriptionAnomaly;
   return {sourceJobId:outcome.sourceJobId,rawEvidenceId:outcome.rawEvidenceId,recordIndex,scopeMarker:outcome.marker,scopeDecision:outcome.marker==='PUBLISHING'?'INCLUDED_MAINLAND' as const:'EXCLUDED_AUDITED' as const,rawPayload:payload};
  };
  for(let offset=0;offset<own.length;offset+=4){
   check();const settled=await Promise.allSettled(own.slice(offset,offset+4).map((row,i)=>collect(row,offset+i)));check();
   const failed=settled.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failed)throw failed.reason;
   rawRows.push(...settled.map(r=>(r as PromiseFulfilledResult<Awaited<ReturnType<typeof collect>>>).value));
  }
  pages.push({channelId:SANOFI_CN_CHANNEL,pageNumber:pageIndex+1,declaredTotalPages:rows.length,declaredTotalJobs:total,uiRequestCandidateIds:[],rawRows,nextControlPresent:pageIndex<rows.length-1});
 }
 replaySanofiChineseIndependent(pages);return {observedAt:input.dom.observedAt,pages};
}
export function replaySanofiChineseIndependent(pages:readonly OfficialJsonRenderedPageCapture[]):OfficialJsonRenderedReplay&{decisions:SanofiChineseDecision[];descriptionAnomalies:SanofiDescriptionAnomaly[]} {
 assert(pages.length>0);
 const dom:SanofiChineseDomCapture={schemaVersion:'sanofi-cn-cua-dom-list-v1',observedAt:sanofiChineseIndependentObservedAt(pages),pages:pages.map(p=>p.rawRows[0]?.rawPayload.domPage as SanofiChineseDomPage)};
 const checked=validateSanofiChineseDom(dom),after=dom.pages.at(-1)!.capturedAt;
 const rawSourceJobIds:string[]=[],rawEvidenceIds:string[]=[],matchKeys:string[]=[],excludedSourceJobIds:string[]=[],decisions:SanofiChineseDecision[]=[],descriptionAnomalies:SanofiDescriptionAnomaly[]=[];
 for(const [pageIndex,page]of pages.entries()){
  const domPage=dom.pages[pageIndex]!;assert(page.channelId===SANOFI_CN_CHANNEL&&page.pageNumber===pageIndex+1&&page.declaredTotalPages===pages.length&&page.declaredTotalJobs===checked.total&&page.uiRequestCandidateIds.length===0&&page.nextControlPresent===(pageIndex<pages.length-1)&&same(checked.rows[pageIndex],page.rawRows.map(r=>r.rawPayload.domRow)));
  for(const [index,row]of page.rawRows.entries()){
   const payload=row.rawPayload;assert(payload.captureMethod===SANOFI_CN_INDEPENDENT_PATH&&row.recordIndex===index&&same(payload.domPage,domPage));
   const outcome=projectRow(payload,dom.observedAt,after),included=outcome.marker==='PUBLISHING';
   assert(row.sourceJobId===outcome.sourceJobId&&row.rawEvidenceId===outcome.rawEvidenceId&&row.scopeMarker===outcome.marker&&row.scopeDecision===(included?'INCLUDED_MAINLAND':'EXCLUDED_AUDITED')&&same(payload.descriptionAnomaly,outcome.descriptionAnomaly));
   if(outcome.decision)decisions.push(outcome.decision);if(outcome.descriptionAnomaly)descriptionAnomalies.push(outcome.descriptionAnomaly);
   rawSourceJobIds.push(row.sourceJobId);rawEvidenceIds.push(row.rawEvidenceId);(included?matchKeys:excludedSourceJobIds).push(row.sourceJobId);
  }
 }
 assert(rawSourceJobIds.length===checked.total&&new Set(rawSourceJobIds).size===checked.total&&new Set(rawEvidenceIds).size===checked.total&&Date.parse(sanofiChineseIndependentFinishedAt(pages))-Date.parse(dom.observedAt)<=30*60_000);
 const sort=(a:string[])=>a.sort((x,y)=>Buffer.compare(Buffer.from(x),Buffer.from(y)));
 return {matchKeys:sort(matchKeys),rawSourceJobIds:sort(rawSourceJobIds),rawEvidenceIds:sort(rawEvidenceIds),excludedSourceJobIds:sort(excludedSourceJobIds),rawCount:checked.total,excludedCount:excludedSourceJobIds.length,decisions:decisions.sort((a,b)=>a.id.localeCompare(b.id)),descriptionAnomalies};
}
export function sanofiChineseIndependentObservedAt(pages:readonly OfficialJsonRenderedPageCapture[]):string {
 const at=(pages[0]?.rawRows[0]?.rawPayload.domPage as SanofiChineseDomPage|undefined)?.capturedAt;assert(at&&time(at));return at!;
}
export function sanofiChineseIndependentFinishedAt(pages:readonly OfficialJsonRenderedPageCapture[]):string {
 const times=pages.flatMap(p=>p.rawRows.flatMap(r=>[(r.rawPayload.domPage as SanofiChineseDomPage)?.capturedAt,(r.rawPayload.detailResponse as NativeReceipt|undefined)?.capturedAt,(r.rawPayload.nativeResponse as NativeReceipt|undefined)?.capturedAt,
  (r.rawPayload.jobUnavailable as {capturedAt?:string}|undefined)?.capturedAt,...((r.rawPayload.ajingaArtifacts as SourceFetchArtifactDraft[]|undefined)??[]).map(a=>a.capturedAt),...((r.rawPayload.receiptTrail as NativeReceipt[]|undefined)??[]).map(a=>a.capturedAt)]).filter((t):t is string=>t!==undefined));
 assert(times.length>0&&times.every(time));return times.sort().at(-1)!;
}
