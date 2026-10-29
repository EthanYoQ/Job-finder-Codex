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
  assert(capture.schemaVersion==="sanofi-cn-cua-dom-list-v1"&&time(capture.observedAt)&&capture.pages.length>0&&capture.pages.length<=25&&capture.pages[0]?.capturedAt===capture.observedAt);
  const ids=new Set<string>(),pages:SanofiChineseRow[][]=[];let total:number|undefined,prior=capture.observedAt;
  for(const [index,page] of capture.pages.entries()){
    const u=new URL(page.url);assert(u.origin==="https://jobs.sanofi.cn"&&!u.username&&!u.password&&!u.hash&&time(page.capturedAt)&&page.capturedAt>=prior);
    assert(u.pathname.toLowerCase()===new URL(SANOFI_CN_ENTRY).pathname.toLowerCase()||u.pathname.startsWith("/search-jobs/"));prior=page.capturedAt;
    const $=load(page.searchResultsHtml),root=$("#search-results"),n=Number(root.attr("data-total-job-results"));total??=n;
    assert(root.length===1&&root.attr("data-location")==="中国"&&root.attr("data-keywords")===""&&root.attr("data-location-path")==="1814991"&&root.attr("data-organization-ids")==="2649"&&
      Number.isSafeInteger(n)&&n>0&&n===total&&Number(root.attr("data-current-page"))===index+1&&Number(root.attr("data-total-pages"))===capture.pages.length&&root.attr("data-records-per-page")==="15");
    const next=root.find("a.next"),active=root.find("input.pagination-current");assert(next.length===1&&next.hasClass("disabled")===(index===capture.pages.length-1)&&active.length===1&&active.attr("value")===String(index+1)&&active.attr("max")===String(capture.pages.length));
    const rows:SanofiChineseRow[]=[];
    for(const node of root.find("#search-results-list li:has(button.js-save-job-btn)").toArray()){
      const r=$(node),button=r.find("button.js-save-job-btn"),link=r.find("a[data-job-id]"),id=button.attr("data-job-id"),href=link.attr("href"),title=clean(r.find("h2").text());
      assert(button.length===1&&link.length===1&&/^\d+$/u.test(id??"")&&link.attr("data-job-id")===id&&href&&title&&!ids.has(id!));ids.add(id!);
      const url=new URL(href!,page.url).toString(),v=new URL(url);assert(v.origin==="https://jobs.sanofi.cn"&&!v.search&&!v.hash&&v.pathname.endsWith(`/3036/${id}`));
      rows.push({id:id!,title,url,listLocation:clean(r.find("span.job-location").text())});
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
export async function captureSanofiChineseIndependent(input:{dom:SanofiChineseDomCapture;http?:HttpHtmlClient;now?:()=>Date;onReceipt?:(r:NativeReceipt,index:number)=>Promise<void>}):Promise<{observedAt:string;pages:OfficialJsonRenderedPageCapture[]}> {
  const {total,rows}=validateSanofiChineseDom(input.dom),now=input.now?.()??new Date();assert(now.getTime()>=Date.parse(input.dom.pages.at(-1)!.capturedAt)&&now.getTime()-Date.parse(input.dom.observedAt)<=30*60_000);
  const http=input.http??sanofiChineseHttp;let ordinal=0;
  const get=async(url:string,after:string,redirect?:"error")=>{const r=await http({url,method:"GET",headers:{Accept:"text/html","User-Agent":"job-search-independent-validator/0.1"},...(redirect?{redirect}:{})});
    const receipt:NativeReceipt={method:"GET",url,finalUrl:r.finalUrl??"",status:r.status,contentType:r.contentType??"",capturedAt:r.capturedAt??"",body:r.body,bodySha256:sanofiHash(r.body),...(redirect?{redirect}:{})};
    await input.onReceipt?.(receipt,ordinal++);validateReceipt(receipt,url,after);return receipt;};
  const pages:OfficialJsonRenderedPageCapture[]=[];
  for(const [pageIndex,own] of rows.entries()){
    const domPage=input.dom.pages[pageIndex]!,rawRows:OfficialJsonRenderedPageCapture["rawRows"][number][]=[];
    const collect=async(row:SanofiChineseRow,recordIndex:number)=>{
      const detailResponse=await get(row.url,input.dom.pages.at(-1)!.capturedAt),detail=parseSanofiChineseDetail(detailResponse.body,row);
      const ajingaArtifacts=detail.countryScope==="MAINLAND"&&ajingaRoute(detail)?await captureSanofiChineseAjinga(detail,input.dom.observedAt,http,async a=>{await input.onReceipt?.({method:"GET",url:a.requestedUrl!,finalUrl:a.finalUrl??"",status:a.httpStatus!,contentType:a.contentType??"",capturedAt:a.capturedAt,body:String(a.body),bodySha256:sanofiHash(String(a.body))},ordinal++);}):undefined;
      const nativeResponse=detail.countryScope==="MAINLAND"&&!ajingaArtifacts?await get(detail.applyUrl,detailResponse.capturedAt,"error"):undefined;
      const native=ajingaArtifacts?replaySanofiChineseAjinga(detail,input.dom.observedAt,ajingaArtifacts):nativeResponse?parseSanofiChineseNative(nativeResponse.body,detail):undefined,state=native?.state??"OUTSIDE",id=sanofiPersistentJobId(detail.reqId);
      return {sourceJobId:id,rawEvidenceId:sanofiRawEvidenceId(row.id),recordIndex,scopeMarker:state,scopeDecision:state==="PUBLISHING"?"INCLUDED_MAINLAND" as const:"EXCLUDED_AUDITED" as const,
        rawPayload:{captureMethod:SANOFI_CN_INDEPENDENT_PATH,domPage,domRow:row,detailResponse,...(nativeResponse?{nativeResponse}:{}),...(ajingaArtifacts?{ajingaArtifacts}:{}),...(native?.descriptionAnomaly?{descriptionAnomaly:native.descriptionAnomaly}:{})}};
    };
    for(let offset=0;offset<own.length;offset+=4){const settled=await Promise.allSettled(own.slice(offset,offset+4).map((row,i)=>collect(row,offset+i)));
      const failed=settled.find((r):r is PromiseRejectedResult=>r.status==="rejected");if(failed)throw failed.reason;
      rawRows.push(...settled.map(r=>(r as PromiseFulfilledResult<Awaited<ReturnType<typeof collect>>>).value));}
    pages.push({channelId:SANOFI_CN_CHANNEL,pageNumber:pageIndex+1,declaredTotalPages:rows.length,declaredTotalJobs:total,uiRequestCandidateIds:[],rawRows,nextControlPresent:pageIndex<rows.length-1});
  }
  replaySanofiChineseIndependent(pages);return {observedAt:input.dom.observedAt,pages};
}
export function replaySanofiChineseIndependent(pages:readonly OfficialJsonRenderedPageCapture[]):OfficialJsonRenderedReplay&{decisions:SanofiChineseDecision[];descriptionAnomalies:SanofiDescriptionAnomaly[]} {
  assert(pages.length>0&&pages.length<=25);const dom:SanofiChineseDomCapture={schemaVersion:"sanofi-cn-cua-dom-list-v1",observedAt:sanofiChineseIndependentObservedAt(pages),pages:[]};
  const rawSourceJobIds:string[]=[],rawEvidenceIds:string[]=[],matchKeys:string[]=[],excludedSourceJobIds:string[]=[];
  const decisions:SanofiChineseDecision[]=[],descriptionAnomalies:SanofiDescriptionAnomaly[]=[];
  for(const [pageIndex,page] of pages.entries()){
    const domPage=page.rawRows[0]?.rawPayload.domPage as SanofiChineseDomPage;assert(domPage&&page.channelId===SANOFI_CN_CHANNEL&&page.pageNumber===pageIndex+1&&page.declaredTotalPages===pages.length&&page.uiRequestCandidateIds.length===0&&page.nextControlPresent===(pageIndex<pages.length-1));dom.pages.push(domPage);
    for(const [index,r] of page.rawRows.entries()){
      const v=r.rawPayload,row=v.domRow as SanofiChineseRow;assert(v.captureMethod===SANOFI_CN_INDEPENDENT_PATH&&r.recordIndex===index&&same(v.domPage,domPage));
      const detailResponse=v.detailResponse as NativeReceipt;validateReceipt(detailResponse,row.url,domPage.capturedAt);const detail=parseSanofiChineseDetail(detailResponse.body,row);
      const native=v.nativeResponse as NativeReceipt|undefined;let parsed:ReturnType<typeof parseSanofiChineseNative>|undefined;
      const ajingaArtifacts=v.ajingaArtifacts as SourceFetchArtifactDraft[]|undefined;
      if(detail.countryScope==="OUTSIDE"){assert(native===undefined&&ajingaArtifacts===undefined);}else if(ajingaRoute(detail)){assert(native===undefined&&ajingaArtifacts);parsed=replaySanofiChineseAjinga(detail,dom.observedAt,ajingaArtifacts!);}else{assert(ajingaArtifacts===undefined);validateReceipt(native,detail.applyUrl,detailResponse.capturedAt);parsed=parseSanofiChineseNative(native.body,detail);}
      const decision=sanofiChineseDecision(detail,parsed),state=decision.state,descriptionAnomaly=parsed?.descriptionAnomaly;
      assert(same(v.descriptionAnomaly,descriptionAnomaly));if(descriptionAnomaly)descriptionAnomalies.push(descriptionAnomaly);
      const id=sanofiPersistentJobId(detail.reqId),rawId=sanofiRawEvidenceId(row.id),included=state==="PUBLISHING";
      assert(r.sourceJobId===id&&r.rawEvidenceId===rawId&&r.scopeMarker===state&&r.scopeDecision===(included?"INCLUDED_MAINLAND":"EXCLUDED_AUDITED"));
      decisions.push(decision);
      rawSourceJobIds.push(id);rawEvidenceIds.push(rawId);(included?matchKeys:excludedSourceJobIds).push(id);
    }
  }
  const checked=validateSanofiChineseDom(dom);assert(pages.every(p=>p.declaredTotalJobs===checked.total));
  for(const [i,rows] of checked.rows.entries())assert(same(rows,pages[i]!.rawRows.map(r=>r.rawPayload.domRow)));
  assert(rawSourceJobIds.length===checked.total&&new Set(rawSourceJobIds).size===checked.total&&new Set(rawEvidenceIds).size===checked.total&&Date.parse(sanofiChineseIndependentFinishedAt(pages))-Date.parse(dom.observedAt)<=30*60_000);
  const sort=(a:string[])=>a.sort((x,y)=>Buffer.compare(Buffer.from(x),Buffer.from(y)));
  return {matchKeys:sort(matchKeys),rawSourceJobIds:sort(rawSourceJobIds),rawEvidenceIds:sort(rawEvidenceIds),excludedSourceJobIds:sort(excludedSourceJobIds),rawCount:checked.total,excludedCount:excludedSourceJobIds.length,decisions:decisions.sort((a,b)=>a.id.localeCompare(b.id)),descriptionAnomalies};
}
export function sanofiChineseIndependentObservedAt(pages:readonly OfficialJsonRenderedPageCapture[]):string {
  const at=(pages[0]?.rawRows[0]?.rawPayload.domPage as SanofiChineseDomPage|undefined)?.capturedAt;assert(at&&time(at));return at!;
}
export function sanofiChineseIndependentFinishedAt(pages:readonly OfficialJsonRenderedPageCapture[]):string {
  const times=pages.flatMap(p=>p.rawRows.flatMap(r=>[(r.rawPayload.detailResponse as NativeReceipt)?.capturedAt,...(r.rawPayload.nativeResponse?[(r.rawPayload.nativeResponse as NativeReceipt).capturedAt]:[]),...((r.rawPayload.ajingaArtifacts as SourceFetchArtifactDraft[]|undefined)??[]).map(a=>a.capturedAt)]));assert(times.length>0&&times.every(time));return times.sort().at(-1)!;
}
