import { load } from "cheerio";
import { isDeepStrictEqual as same } from "node:util";
import { hasNovartisOfficialPresencePlan, NOVARTIS_DEFAULT_ENTRY } from "./novartisOfficialPresence";
import type { HttpHtmlClient } from "./httpHtmlSourceFetch";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchResult } from "./runSourceCrawl";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl, sha256Bytes,
  type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft, type SourceFetchPageTrace } from "./sourceFetchEvidence";
import { evaluatePaginationEvidence } from "./paginationEvidence";
import { retryableHttpTransportFailure, retryableTransportFailureFromError, type SourceTransportFailure } from "./sourceFetchFailure";

const ORIGIN = "https://www.novartis.com.cn", PATH = "/careers/career-search";
export const NOVARTIS_PARTITION_CAPTURE = { name:"novartis-native-functional-partitions", version:"1" };
export const NOVARTIS_PARTITION_PAGINATION = { allowCompleteTraversalOfEmptyFirstPage:true } as const;
const FAIL = "NOVARTIS_NATIVE_PARTITIONS_INCOMPLETE", AUDIT = "novartis-partitions-audit";
const FIELDS = ["FN","BS","CM","CA","DD","FA","HR","IT","NN","LI","MA","MM","OT","PR","QA","RD","SA","TO","EE","ZZ"].map(s=>`FCT_${s}`);
const clean = (s:string) => s.replace(/\s+/gu," ").trim();
const body = (a:SourceFetchArtifactDraft) => typeof a.body === "string" ? a.body : Buffer.from(a.body).toString("utf8");
const hash = (s:string) => sha256Bytes(Buffer.from(s)).sha256;
function requireValue(v:unknown, reason=FAIL):asserts v { if (!v) throw Error(reason); }
interface Row { id:string; url:string; html:string; title:string }
function identity(url:string):string {
  const u=new URL(url),m=/^\/careers\/career-search\/job\/details\/(req-\d+)(?:-[^/]+)?$/iu.exec(u.pathname);
  requireValue(u.origin===ORIGIN&&!u.username&&!u.password&&!u.search&&!u.hash&&m);return m[1]!.toUpperCase();
}
function listRows(html:string):Row[] {
  const $=load(html),out:Row[]=[];
  for(const n of $("table.views-table tbody tr").toArray()) {
    if($(n).find("td.empty.message").length===1&&clean($(n).text())==="No content has been found."){requireValue(total(html)===0&&$("table.views-table tbody tr").length===1);continue;}
    const a=$(n).find("td.views-field-field-job-title a"),country=$(n).find("td.views-field-field-job-country");
    requireValue(a.length===1&&clean(a.text())&&a.attr("href")&&country.length===1);
    country.find(".alternative-locations").remove();requireValue(clean(country.text())==="China");
    const url=new URL(a.attr("href")!,ORIGIN).href;
    out.push({id:identity(url),url,html:$.html(n),title:clean(a.text())});
  }
  requireValue(new Set(out.map(r=>r.id)).size===out.length);return out;
}
function total(html:string):number {
  const $=load(html),t=$(".view-header").toArray().map(n=>clean($(n).text())).filter(t=>/^Showing\b/iu.test(t));
  requireValue(t.length===1&&/^Showing\s+\d+\s+results$/iu.test(t[0]!));return Number(t[0]!.match(/\d+/u)![0]);
}
function partitionUrl(field:string,page=0):string {
  const u=new URL(NOVARTIS_DEFAULT_ENTRY);u.searchParams.delete("country[]");u.searchParams.set("country[0]","LOC_CN");
  u.searchParams.set("functional_area[0]",field);u.searchParams.set("sort","asc");
  u.searchParams.set("order",field==="FCT_SA"?"发布日期":"职位名称");if(page)u.searchParams.set("page",String(page));return u.href;
}
// Query order and [] versus [0] are equivalent native Drupal form encodings.
function sameUrl(actual:string,expected:string):boolean {
  const key=(s:string)=>{const u=new URL(s);return {origin:u.origin,path:u.pathname,user:u.username,password:u.password,hash:u.hash,
    query:[...u.searchParams].map(([k,v])=>[k.replace(/\[\]/gu,"[0]"),v]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))};};
  return same(key(sanitizeEvidenceHttpUrl(actual)),key(sanitizeEvidenceHttpUrl(expected)));
}
function artifactOk(a:SourceFetchArtifactDraft,url:string,role:string) {
  requireValue(a.requestedUrl&&a.finalUrl&&sameUrl(a.requestedUrl,url)&&sameUrl(a.finalUrl,url)&&a.httpStatus===200&&
    /^text\/html(?:;|$)/iu.test(a.contentType??"")&&a.extractorLocator===role&&a.bodyRepresentation!=="REDACTED"&&!a.rawBodySha256&&!a.redactionDescriptors);
}
function parsedPage(a:SourceFetchArtifactDraft,url:string,page:number,role:string) {
  artifactOk(a,url,role);const html=body(a),$=load(html),rs=listRows(html),count=total(html);
  requireValue(rs.length<=10&&(count===0||rs.length>0));
  const active=$(".pagination .active .page-link[title]"),next=$(".pagination a[rel=next]");
  if(count<=10&&!$(".pagination").length){requireValue(page===0&&rs.length===count);return {rows:rs,count,pages:1,next:null as string|null};}
  const m=/^page\s+(\d+)\s+.*out of\s+(\d+)\s+pages$/iu.exec(clean(active.attr("title")??""));
  requireValue(active.length===1&&m&&Number(m[1])===page+1&&next.length===1);
  const pages=Number(m[2]);requireValue(page<pages);
  const discovery=role==="novartis-partition-default-discovery-v1";
  if(!discovery)requireValue(pages===Math.max(1,Math.ceil(count/10)));
  const disabled=next.hasClass("disabled")||next.parent().hasClass("disabled")||next.attr("aria-disabled")==="true";
  const href=next.attr("href"),target=href?new URL(href,url).href:null;
  if(!discovery)requireValue(rs.length===Math.min(10,Math.max(0,count-page*10)));
  if(page+1===pages){requireValue(disabled&&(!target||sameUrl(target,url)));return {rows:rs,count,pages,next:null as string|null};}
  requireValue(!disabled&&target);const expected=new URL(url);expected.searchParams.set("page",String(page+1));requireValue(sameUrl(target,expected.href));
  return {rows:rs,count,pages,next:target};
}
function detailStatus(a:SourceFetchArtifactDraft,row:Row):"OBSERVED_PRESENT"|"EXPLICITLY_CLOSED"|"UNKNOWN" {
  artifactOk(a,row.url,"novartis-partition-same-id-detail-v1");const $=load(body(a));
  $("script,style,noscript,[hidden],[aria-hidden=true],.hidden,.d-none,.sr-only").remove();
  $("[style]").filter((_i,n)=>/(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test($(n).attr("style")??"")).remove();
  const article=$("article"),h1=$("h1");article.find("p,div,li,section,br,h2,h3").before(" ").after(" ");
  const text=clean(article.text()),ids=[...new Set(text.match(/REQ-\d+/giu)?.map(s=>s.toUpperCase())??[])];
  if(article.length!==1||ids.length!==1||ids[0]!==row.id)return "UNKNOWN";
  const closed=/\b(?:this (?:job|position) is no longer available|we are no longer accepting applications for this (?:job|position))\b/iu.test(text)||/(?:该|此|本)职位(?:已关闭|已停止招聘|已结束招聘)/u.test(text);
  const links=article.find("a[href]").toArray().filter(n=>/^(?:Apply(?: to Job| now)?|立即申请|申请职位)$/iu.test(clean($(n).text())));
  if(closed)return links.length?"UNKNOWN":"EXPLICITLY_CLOSED";
  const validApply=links.length>0&&links.every(n=>{const u=new URL($(n).attr("href")!,row.url);return u.origin==="https://platform.moseeker.com"&&u.pathname==="/m/customize/page/novartis"&&!u.username&&!u.password&&!u.hash&&[...u.searchParams].length===1&&u.searchParams.get("job_number")===row.id;});
  return validApply&&h1.length===1&&clean(h1.text())===row.title&&article.find("p").toArray().some(n=>clean($(n).text()).length>0)?"OBSERVED_PRESENT":"UNKNOWN";
}
function counts(n:number) {return {rawCount:n,parsedCount:n,validCount:n,parseDiscardCount:0,validationDiscardCount:0};}
function readRoot(plan:SourceCrawlPlan,root:SourceFetchArtifactDraft):number {
  artifactOk(root,plan.source.officialEntryUrl,"novartis-native-partition-root-v1");const $=load(body(root));
  const fields=$("select[name='functional_area[]'] option").toArray().map(n=>$(n).attr("value"));
  requireValue(same([...fields].sort(),[...FIELDS].sort())&&$("select[name='country[]'] option[selected]").length===1&&$("select[name='country[]'] option[selected]").attr("value")==="LOC_CN"&&
    $("select[name='field_job_posted_date'] option[selected]").attr("value")==="All");
  return total(body(root));
}
function projection(plan:SourceCrawlPlan,artifacts:SourceFetchArtifactDraft[]) {
  requireValue(hasNovartisOfficialPresencePlan(plan));const approved=new URL(partitionUrl("FCT_QA"));approved.searchParams.delete("functional_area[0]");requireValue(sameUrl(plan.source.officialEntryUrl,approved.href));const used=new Set<string>();let last=-Infinity;
  const take=(key:string,url:string,role:string)=>{const found=artifacts.filter(a=>a.logicalKey===key);requireValue(found.length===1);const a=found[0]!;
    requireValue(Number.isFinite(Date.parse(a.capturedAt))&&Date.parse(a.capturedAt)>=last);last=Date.parse(a.capturedAt);used.add(key);artifactOk(a,url,role);return a;};
  const root=take("novartis-partitions-root",plan.source.officialEntryUrl,"novartis-native-partition-root-v1");
  const indexTotal=readRoot(plan,root),rows:Row[]=[],pages:SourceFetchPageTrace[]=[],partitionAudit:unknown[]=[];
  const addPage=(a:SourceFetchArtifactDraft,rs:Row[],channelId:string,page:number|null,count:number|null,declaredPages:number|null,next:string|null)=>{
    requireValue(a.channelId===channelId);pages.push({sequence:pages.length,artifactLogicalKey:a.logicalKey,channelId,requestedPage:page,returnedPage:page,
      rawJobIds:rs.map(r=>r.id),validJobIds:rs.map(r=>r.id),declaredTotal:count===0?null:count,declaredPages,
      nextPageSignalBefore:page===1?"initial":page===null?null:a.requestedUrl,nextPageSignalAfter:next?sanitizeEvidenceHttpUrl(next):null,termination:next?"CONTINUE":rs.length?"NEXT_ABSENT":"EMPTY_PAGE",
      responseFingerprintSha256:hash(body(a)),capturedAt:a.capturedAt,anomalyCodes:[]});};
  for(const field of FIELDS){const own:Row[]=[];let url=partitionUrl(field),declared:number|undefined,terminal=false;
    for(let p=0;p<100;p++){const a=take(`novartis-partition-${field}-${p}`,url,"novartis-native-functional-page-v1");const parsed=parsedPage(a,url,p,"novartis-native-functional-page-v1");
      requireValue(declared===undefined||declared===parsed.count);declared=parsed.count;own.push(...parsed.rows);
      addPage(a,parsed.rows,`novartis:${field}`,p+1,parsed.count,parsed.pages,parsed.next);
      if(!parsed.next){terminal=true;break;}url=parsed.next;}
    requireValue(terminal&&own.length===declared&&new Set(own.map(r=>r.id)).size===declared);
    partitionAudit.push({field,declaredTotal:declared,uniqueCount:own.length});rows.push(...own);
  }
  requireValue(rows.length===indexTotal&&new Set(rows.map(r=>r.id)).size===indexTotal);
  const primaryIds=new Set(rows.map(r=>r.id)),defaults=new Map<string,Row>(),defaultTotals:number[]=[];let url=NOVARTIS_DEFAULT_ENTRY,terminal=false;
  // Default is discovery only. Its varying totals and repeated rows never certify a missing job.
  for(let p=0;p<100;p++){const a=take(`novartis-partitions-default-${p}`,url,"novartis-partition-default-discovery-v1");
    const parsed=parsedPage(a,url,p,"novartis-partition-default-discovery-v1");defaultTotals.push(parsed.count);
    for(const row of parsed.rows){const prev=defaults.get(row.id);requireValue(!prev||prev.url===row.url);defaults.set(row.id,row);}
    if(!parsed.next){terminal=true;break;}url=parsed.next;}
  requireValue(terminal);const differences:Array<{officialId:string;officialUrl:string;status:"OBSERVED_PRESENT"|"EXPLICITLY_CLOSED"}>=[];
  for(const row of [...defaults.values()].filter(r=>!primaryIds.has(r.id)).sort((a,b)=>a.id.localeCompare(b.id))){
    const a=take(`novartis-partitions-detail-${row.id}`,row.url,"novartis-partition-same-id-detail-v1"),status=detailStatus(a,row);
    requireValue(status!=="UNKNOWN","NOVARTIS_OFFICIAL_PRESENCE_UNKNOWN_PRESERVE_LAST_GOOD");differences.push({officialId:row.id,officialUrl:row.url,status});
    if(status==="OBSERVED_PRESENT"){rows.push(row);addPage(a,[row],`novartis:presence:${row.id}`,null,null,null,null);}
  }
  requireValue(artifacts.every(a=>used.has(a.logicalKey)||a.logicalKey===AUDIT));
  const audit={indexDeclaredTotal:indexTotal,primaryUniqueCount:primaryIds.size,partitions:partitionAudit,
    defaultObservedUniqueCount:defaults.size,defaultReportedTotals:defaultTotals,defaultCompletenessClaim:false,
    differences,observedUniqueCount:rows.length};
  return {html:`<table class="views-table"><tbody>${rows.map(r=>r.html).join("")}</tbody></table>`,pages,counts:counts(rows.length),audit,closedUrls:new Set(differences.filter(d=>d.status==="EXPLICITLY_CLOSED").map(d=>d.officialUrl))};
}
export function hasNovartisPartitionEvidence(e:PersistentSourceFetchEvidence):boolean {return e.captureTool.name===NOVARTIS_PARTITION_CAPTURE.name;}
export function replayNovartisNativePartitions(plan:SourceCrawlPlan,e:PersistentSourceFetchEvidence) {
  requireValue(same(e.captureTool,NOVARTIS_PARTITION_CAPTURE));const projected=projection(plan,e.artifacts),audit=e.artifacts.filter(a=>a.logicalKey===AUDIT);
  requireValue(audit.length===1&&audit[0]!.kind==="COMMAND_OUTPUT"&&audit[0]!.extractorLocator===AUDIT&&same(JSON.parse(body(audit[0]!)),projected.audit)&&
    same(e.pages,projected.pages)&&same(e.fetchCounts,projected.counts)&&e.fetchLosses.length===0&&same(e.declaredCompleteness,{kind:"COMPLETE_PAGE_TRAVERSAL",value:projected.pages.length,
      scope:"SOURCE",artifactLogicalKey:"novartis-partitions-root",extractorLocator:"novartis-native-partition-root-v1"}));
  return projected;
}
export async function acquireNovartisNativePartitions(plan:SourceCrawlPlan,http:HttpHtmlClient):Promise<SourceFetchResult> {
  const artifacts:SourceFetchArtifactDraft[]=[];let capturedAt=new Date().toISOString(),transportFailure:SourceTransportFailure|undefined;
  const capture=async(url:string,key:string,role:string,channelId?:string)=>{let r;try{r=await http({url,headers:{Accept:"text/html","User-Agent":"job-search-crawler/0.1"}});}catch(e){transportFailure=retryableTransportFailureFromError(e);throw e;}
    transportFailure=retryableHttpTransportFailure(r.status)??transportFailure;const a:SourceFetchArtifactDraft={id:key,logicalKey:key,kind:"OFFICIAL_COMPANY_PAGE",requestedUrl:sanitizeEvidenceHttpUrl(url),finalUrl:sanitizeEvidenceHttpUrl(r.finalUrl??url),httpStatus:r.status,
      contentType:r.contentType??"application/octet-stream",capturedAt:r.capturedAt??"",body:r.body,bodyRepresentation:"EXACT",extractorLocator:role,...(channelId?{channelId}:{})};artifacts.push(a);artifactOk(a,url,role);if(artifacts.length===1)capturedAt=a.capturedAt;return a;};
  try{requireValue(hasNovartisOfficialPresencePlan(plan));readRoot(plan,await capture(plan.source.officialEntryUrl,"novartis-partitions-root","novartis-native-partition-root-v1"));const primary=new Set<string>();
    for(const field of FIELDS){let url=partitionUrl(field);for(let p=0;p<100;p++){const a=await capture(url,`novartis-partition-${field}-${p}`,"novartis-native-functional-page-v1",`novartis:${field}`),parsed=parsedPage(a,url,p,"novartis-native-functional-page-v1");for(const row of parsed.rows)primary.add(row.id);if(!parsed.next)break;url=parsed.next;}}
    const defaults=new Map<string,Row>();let url=NOVARTIS_DEFAULT_ENTRY;
    for(let p=0;p<100;p++){const a=await capture(url,`novartis-partitions-default-${p}`,"novartis-partition-default-discovery-v1"),parsed=parsedPage(a,url,p,"novartis-partition-default-discovery-v1");for(const row of parsed.rows)defaults.set(row.id,row);if(!parsed.next)break;url=parsed.next;}
    for(const row of [...defaults.values()].filter(r=>!primary.has(r.id)).sort((a,b)=>a.id.localeCompare(b.id)))await capture(row.url,`novartis-partitions-detail-${row.id}`,"novartis-partition-same-id-detail-v1",`novartis:presence:${row.id}`);
    const projected=projection(plan,artifacts);artifacts.push({id:AUDIT,logicalKey:AUDIT,kind:"COMMAND_OUTPUT",capturedAt:artifacts.at(-1)!.capturedAt,body:JSON.stringify(projected.audit),bodyRepresentation:"EXACT",extractorLocator:AUDIT});
    const evidence=parsePersistentSourceFetchEvidence({captureTool:NOVARTIS_PARTITION_CAPTURE,artifacts,pages:projected.pages,fetchCounts:projected.counts,fetchLosses:[],declaredCompleteness:{kind:"COMPLETE_PAGE_TRAVERSAL",value:projected.pages.length,scope:"SOURCE",artifactLogicalKey:"novartis-partitions-root",extractorLocator:"novartis-native-partition-root-v1"}});
    const paginationEvaluation=evaluatePaginationEvidence({evidence,expectedChannelIds:[...new Set(projected.pages.map(p=>p.channelId!))],filteredOutput:true,...NOVARTIS_PARTITION_PAGINATION});requireValue(paginationEvaluation.safeCompleteness&&paginationEvaluation.verifiedEligible);
    return {ok:true,capturedAt,html:projected.html,fetchEvidence:evidence,paginationEvaluation};
  }catch(e){return {ok:false,capturedAt,failureReason:e instanceof Error&&/^NOVARTIS_[A-Z_]+$/u.test(e.message)?e.message:FAIL,...(transportFailure?{transportFailure}:{}),
    ...(artifacts.length?{fetchEvidence:{captureTool:NOVARTIS_PARTITION_CAPTURE,artifacts,pages:[],supportingArtifactOnlyFailure:{code:"SOURCE_FETCH_FAILED"},fetchCounts:counts(0),fetchLosses:[]}}:{})};}
}
