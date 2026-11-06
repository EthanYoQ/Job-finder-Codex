import {jobQuarantineLoss,type JobQuarantine} from './jobQuarantine';
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchResult } from "./runSourceCrawl";
import type { WorkdaySourceFetchDeps, WorkdayHttpResponse } from "./workdaySourceFetch";
import type { NormalizedJobRecord } from "./normalizedJob";
import { officialJsonAdapter } from "./adapters/officialJson";
import { fetchWithOfficialTimeout, currentOfficialSourceAttemptSignal } from "./officialHttpRuntimeLimits";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { irreversibleOfficialJsonEvidenceId, officialJsonNetworkArtifact, finalizeOfficialJsonSupportingFailureEvidence } from "./officialJsonEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft, type SourceFetchPageTrace } from "./sourceFetchEvidence";
import { WORKDAY_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { PFIZER_OFFICIAL_LOCALITIES } from "./pfizerOfficialLocalities";
import { CITY_PENDING } from "../domain/jobLocation";
export const PFIZER_TRAVERSAL_POLICY = "PFIZER_COUNTRY_DETAIL_COMPLETE_TRAVERSAL_V1";
export const PFIZER_ENTRY = "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers";
export const PFIZER_API = "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers";
export const PFIZER_CHINA = "6cb77610a8a543aea2d6bc10457e35d4";
export const PFIZER_CHANNEL = "source:source-pfizer-china-social:default";
export const PFIZER_PAGINATION_POLICY = { allowLaterZeroDeclaredTotalAfterExactReconciliation: true, allowAuditedTraversalScopeExclusions: true } as const;
export function isPfizerWorkdayTraversalPlan(plan: SourceCrawlPlan): boolean {
    if (plan.adapterId !== "official-json" || plan.workday?.traversalScopePolicy !== PFIZER_TRAVERSAL_POLICY)
        return false;
    const { traversalScopePolicy: _, ...config } = plan.workday;
    return plan.company.id === "company-pfizer-china" && plan.source.companyId === plan.company.id &&
        plan.source.id === "source-pfizer-china-social" && plan.source.kind === "SOCIAL" && plan.source.atsKind === "WORKDAY" &&
        plan.source.officialEntryUrl === PFIZER_ENTRY && plan.source.officialChainEvidenceUrl === "https://www.pfizer.com/about/careers/search-results" &&
        plan.source.status === "VERIFIED_SCRAPABLE" &&
        isDeepStrictEqual(plan.json, { ...WORKDAY_JSON_CONFIG, fields: { ...WORKDAY_JSON_CONFIG.fields, officialPublishedAt: "officialPublishedAt" } }) &&
        plan.executionAuthority === "STAGED" && isDeepStrictEqual(config, { tenant: "pfizer", site: "PfizerCareers", laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION", appliedFacets: { Location_Country: [PFIZER_CHINA] }, pageSize: 20, maxPages: 20 }) &&
        isDeepStrictEqual(plan.expectedChannels, [{ channelId: PFIZER_CHANNEL, kind: "SOCIAL" }]);
}
// Only an exact ID-only official row is quarantined; other malformed shapes still stop traversal.
export const PFIZER_LIST_ROW_UNKNOWN = "PFIZER_LIST_ROW_UNKNOWN";
export function pfizerQuarantinedRowId(raw: unknown): string | undefined {
    const id = (raw as {bulletFields?: unknown[]} | null)?.bulletFields?.[0];
    return typeof id === "string" && /^\d{7}$/u.test(id) && isDeepStrictEqual(raw, { bulletFields: [id] }) ? id : undefined;
}
export function pfizerQuarantinedEvidenceKey(id: string): string { return `pfizer-unresolved:${id}`; }
function quarantineLoss(id: string, pageSequence: number, recordIndex: number, capturedAt: string | undefined) {
    return { stage: "VALIDATION" as const, reason: "Official Pfizer list row has only its ID; prior job requires review",
        rawLocator: `pfizer-page-${pageSequence}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId(id)}`,
        details: { code: PFIZER_LIST_ROW_UNKNOWN, pageSequence, recordIndex, noteCode: "NO_OMISSION_NOT_VERIFIED" }, recordedAt: capturedAt };
}
/** Read the current raw pages, never a previous posting or an issuer-supplied allowlist. Full replay remains the caller's admission boundary. */
export function pfizerQuarantinedOfficialIds(evidence: PersistentSourceFetchEvidence): string[] {
    return evidence.pages.flatMap(page => parse(evidence.artifacts.find(a => a.logicalKey === page.artifactLogicalKey)!.body).jobPostings
        .flatMap((raw: unknown) => { const id = pfizerQuarantinedRowId(raw); return id ? [id] : []; }));
}
export function pfizerSourceJobId(externalPath: string): string {
    return `workday:sha256:${createHash("sha256").update(externalPath).digest("hex")}`;
}
function record(value: unknown): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Pfizer expected an object");
    return value as Record<string, any>;
}
function parse(body: unknown): Record<string, any> {
    if (typeof body !== "string" || !hasUniqueJsonObjectKeys(body))
        throw Error("Pfizer invalid or duplicate-key JSON");
    return record(JSON.parse(body));
}
function identity(raw: unknown) {
    const row = record(raw);
    if (typeof row.title !== "string" || !row.title.trim() || !Array.isArray(row.bulletFields) || row.bulletFields.length < 1 ||
        typeof row.bulletFields[0] !== "string" || !/^\d{7}$/u.test(row.bulletFields[0]) ||
        typeof row.externalPath !== "string" || !/^\/job\/[^?#]+$/u.test(row.externalPath) ||
        !new RegExp(`_${row.bulletFields[0]}(?:-\\d+)?$`, "u").test(row.externalPath) ||
        new URL(row.externalPath, PFIZER_ENTRY).origin !== new URL(PFIZER_ENTRY).origin)
        throw Error("Pfizer list identity is invalid");
    return { row, id: row.bulletFields[0] as string, path: row.externalPath as string };
}
// Main path uses the native Workday country objects, not the browser's JSON-LD classifier.
export function projectPfizerDetail(raw: unknown, detailBody: string) {
    const { id, path } = identity(raw), root = parse(detailBody), info = record(root.jobPostingInfo);
    const country = record(info.country), requisition = record(record(info.jobRequisitionLocation).country);
    if (info.jobReqId !== id || typeof info.title !== "string" || !info.title.trim() || info.jobPostingSiteId !== "PfizerCareers" ||
        info.externalUrl !== PFIZER_ENTRY + path || info.posted !== true || info.canApply !== true ||
        typeof info.jobDescription !== "string" || !info.jobDescription.replace(/<[^>]*>/gu, "").trim() ||
        typeof info.location !== "string" || !info.location.trim() ||
        (info.additionalLocations !== undefined && (!Array.isArray(info.additionalLocations) || info.additionalLocations.some((v: unknown) => typeof v !== "string" || !v.trim()))))
        throw Error("Pfizer detail identity, activity or locations are unresolved");
    const locations: string[] = [info.location, ...(info.additionalLocations ?? [])];
    if (new Set(locations).size !== locations.length)
        throw Error("Pfizer duplicate detail locations");
    const mainland = locations.filter(v => /^(?:China|CHN) - [A-Za-z][A-Za-z '\-]+(?: - [A-Za-z][A-Za-z '\-]+)?$/u.test(v) && !/Hong Kong|Macau|Macao|Taiwan/iu.test(v));
    const included = country.descriptor === "China" && country.id === PFIZER_CHINA && requisition.descriptor === "China" && requisition.alpha2Code === "CN" && mainland.length > 0;
    const excluded = country.descriptor === "India" && country.id === "c4f78be1a8f14da0ab49ce1162348a5e" && requisition.descriptor === "India" && requisition.alpha2Code === "IN" &&
        /^India - /u.test(info.location) && locations.every(v => /^India - [A-Za-z ]+$/u.test(v) || ["APAC - Any Pfizer Site", "Europe - Any Pfizer Site", "IDM - Any Pfizer Site"].includes(v));
    if (!included && !excluded)
        throw Error("Pfizer country evidence is unknown or conflicting");
    const date = info.startDate;
    const officialPublishedAt = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? `${date}T00:00:00.000Z` : undefined;
    const cities = mainland.map(location => PFIZER_OFFICIAL_LOCALITIES[location] ?? CITY_PENDING);
    return { id, path, excluded, locations, job: { sourceJobId: pfizerSourceJobId(path), title: info.title.replace(/\s+/gu," ").trim(), officialUrl: info.externalUrl,
            locationRaw: locations.join(" | "), cities: cities.includes(CITY_PENDING) ? [CITY_PENDING] : [...new Set(cities)], ...(officialPublishedAt === undefined ? {} : {officialPublishedAt}) } };
}
function requestBody(offset: number) { return { appliedFacets: { Location_Country: [PFIZER_CHINA] }, limit: 20, offset, searchText: "" }; }
function artifact(key: string, url: string, response: WorkdayHttpResponse, request: unknown): SourceFetchArtifactDraft {
    if (response.status !== 200 || response.finalUrl !== url || !/^application\/json(?:;|$)/iu.test(response.contentType ?? "") || !response.capturedAt || !Number.isFinite(Date.parse(response.capturedAt)))
        throw Error("Pfizer response metadata is invalid");
    if (Buffer.byteLength(response.body) > 2000000)
        throw Error("Pfizer response body budget exceeded");
    return officialJsonNetworkArtifact({ id: key, logicalKey: key, kind: key.startsWith("pfizer-page-") ? "PAGINATION_PAGE" : "ATS_API_RESPONSE", requestedUrl: url, response, extractorLocator: JSON.stringify(request), bodyRepresentation: "EXACT" });
}
async function http(request: {
    url: string;
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
}): Promise<WorkdayHttpResponse> {
    const response = await fetchWithOfficialTimeout(request.url, { method: request.method, headers: { ...request.headers, "User-Agent": "job-search-crawler/0.1" }, ...(request.body ? { body: request.body } : {}) });
    return { status: response.status, body: await response.text(), finalUrl: response.url, contentType: response.headers.get("content-type") ?? "", capturedAt: new Date().toISOString() };
}
// The official CXS endpoint resets a beyond-end offset to its first page. Keep
// that response as an auxiliary artifact, never as an empty or additional page.
function terminalBoundaryMatches(first: Record<string, any>, end: Record<string, any>, total: number, lastCount: number): boolean {
    if (!Array.isArray(end.jobPostings)) return false;
    if (end.jobPostings.length === 0) return end.total === 0 || end.total === total;
    return lastCount > 0 && lastCount < 20 && lastCount === total % 20 && first.total === total && end.total === total &&
        Array.isArray(first.jobPostings) && first.jobPostings.length === Math.min(total, 20) &&
        isDeepStrictEqual(end.jobPostings, first.jobPostings);
}

function slot(raw:unknown,pageSequence:number,recordIndex:number){
  const row=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,any>:undefined;
  const nativeId=typeof row?.bulletFields?.[0]==='string'&&/^\d{7}$/u.test(row.bulletFields[0])?row.bulletFields[0] as string:undefined;
  let bound:ReturnType<typeof identity>|undefined;try{bound=identity(raw);}catch{/* Slot stays unknown, never an absent job. */}
  const rawId=irreversibleOfficialJsonEvidenceId(nativeId??[pageSequence,recordIndex,raw]);
  const quarantine:JobQuarantine={pageSequence,recordIndex,rawLocator:`pfizer-page-${pageSequence}#record:${recordIndex}#${rawId}`,validJobId:bound?irreversibleOfficialJsonEvidenceId(pfizerSourceJobId(bound.path)):rawId,code:'PFIZER_JOB_UNVERIFIED',
    ...(bound?{sourceJobId:pfizerSourceJobId(bound.path),officialUrl:PFIZER_ENTRY+bound.path}:{})};
  return {bound,rawId,quarantine};
}
function projectSlots(pages:readonly SourceFetchPageTrace[],artifacts:readonly SourceFetchArtifactDraft[],legacy=false){
  const jobs:ReturnType<typeof projectPfizerDetail>['job'][]=[],losses:PersistentSourceFetchEvidence['fetchLosses']=[],quarantines:JobQuarantine[]=[],used=new Set<string>();
  const projectedPages=pages.map((page,pageSequence)=>{
    const original=artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!;
    const rawRows=parse(original.body).jobPostings as unknown[],validJobIds:string[]=[];
    rawRows.forEach((raw,recordIndex)=>{
      const current=slot(raw,pageSequence,recordIndex);
      if(legacy&&pfizerQuarantinedRowId(raw)){losses.push(quarantineLoss(pfizerQuarantinedRowId(raw)!,pageSequence,recordIndex,original.capturedAt));return;}
      try{
        if(!current.bound)throw Error('Pfizer list job unresolved');
        const {id,path}=current.bound,key=`pfizer-detail-${id}`,url=PFIZER_API+path,a=artifacts.find(a=>a.logicalKey===key);
        if(a)used.add(key);
        if(!a)throw Error('Pfizer detail unavailable');
        const checked=artifact(key,url,{status:a.httpStatus!,body:String(a.body),finalUrl:a.finalUrl!,contentType:a.contentType??"",capturedAt:a.capturedAt},{method:'GET',url,officialId:id});
        if(!isDeepStrictEqual({...a,id:checked.id},checked))throw Error('Pfizer detail binding mismatch');
        const r=projectPfizerDetail(raw,String(a.body));
        if(r.excluded)losses.push({stage:'VALIDATION',reason:'Official detail establishes India and no explicit mainland posting location',rawLocator:`${page.artifactLogicalKey}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId(id)}`,details:{code:'PFIZER_VERIFIED_INDIA_SCOPE',pageSequence,recordIndex},recordedAt:a.capturedAt});
        else{jobs.push(r.job);validJobIds.push(irreversibleOfficialJsonEvidenceId(r.job.sourceJobId));}
      }catch{
        quarantines.push(current.quarantine);losses.push(jobQuarantineLoss(current.quarantine,pages[0]!.capturedAt));
      }
    });
    return {...page,validJobIds};
  });
  return {jobs,losses,quarantines,pages:projectedPages,used};
}
export async function fetchPfizerWorkdayTraversal(plan:SourceCrawlPlan,deps:WorkdaySourceFetchDeps):Promise<SourceFetchResult>{
 const started=(deps.now?.()??new Date()).toISOString(),artifacts:SourceFetchArtifactDraft[]=[],pages:SourceFetchPageTrace[]=[];
 try{
  if(!isPfizerWorkdayTraversalPlan(plan))throw Error('Pfizer traversal source plan mismatch');
  const listHttp=deps.http??http,detailHttp=deps.detailHttp??(deps.http?undefined:http);if(!detailHttp)throw Error('Pfizer detail transport required');
  const seen=new Set<string>();let total:number|undefined,bytes=0,closed=false;
  for(let index=0;index<20;index++){
    currentOfficialSourceAttemptSignal()?.throwIfAborted();
    const url=PFIZER_API+'/jobs',offset=index*20,body=requestBody(offset),key=`pfizer-page-${index}`;
    const response=await listHttp({url,method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Referer:PFIZER_ENTRY},body:JSON.stringify(body)});
    const a=artifact(key,url,response,{method:'POST',url,body});artifacts.push(a);bytes+=Buffer.byteLength(response.body);
    const root=parse(response.body);total??=root.total;
    if(!Number.isSafeInteger(total)||!total||!Array.isArray(root.jobPostings)||root.jobPostings.length<1||root.jobPostings.length>20||root.total!==total&&!(index>0&&root.total===0))throw Error('Pfizer list total or continuation changed');
    const slots=(root.jobPostings as unknown[]).map((raw,n)=>slot(raw,index,n));
    for(const row of slots){if(seen.has(row.rawId))throw Error('Pfizer duplicate official ID');seen.add(row.rawId);}
    if(seen.size>total||seen.size<total&&slots.length!==20)throw Error('Pfizer incomplete page before declared end');
    const done=seen.size===total;
    pages.push({sequence:index,artifactLogicalKey:key,requestedOffset:offset,returnedOffset:offset,requestedPage:index,returnedPage:index,requestedPageSize:20,rawJobIds:slots.map(row=>row.rawId),validJobIds:[],declaredTotal:root.total,declaredPages:root.total===0?0:Math.ceil(total!/20),nextPageSignalBefore:index===0?null:String(offset),nextPageSignalAfter:done?null:String(offset+20),termination:done?'NEXT_ABSENT':'CONTINUE',anomalyCodes:[],capturedAt:a.capturedAt,responseFingerprintSha256:sha256Bytes(Buffer.from(response.body)).sha256});
    if(!done)continue;
    const terminalBody=requestBody(offset+20),end=await listHttp({url,method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Referer:PFIZER_ENTRY},body:JSON.stringify(terminalBody)});
    artifacts.push(artifact('pfizer-terminal',url,end,{method:'POST',url,body:terminalBody}));
    if(!terminalBoundaryMatches(parse(artifacts[0]!.body),parse(end.body),total!,slots.length))throw Error('Pfizer terminal boundary invalid');
    closed=true;break;
  }
  if(!closed)throw Error('Pfizer reached resource page budget without terminal proof');
  let accessStopped=false;
  for(const [pageSequence,page] of pages.entries())for(const [recordIndex,raw] of (parse(artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!.body).jobPostings as unknown[]).entries()){
    const row=slot(raw,pageSequence,recordIndex);if(!row.bound||accessStopped)continue;
    currentOfficialSourceAttemptSignal()?.throwIfAborted();
    try{const {id,path}=row.bound,url=PFIZER_API+path,key=`pfizer-detail-${id}`;
      const response=await detailHttp({url,method:'GET',headers:{Accept:'application/json',Referer:PFIZER_ENTRY}});
      if(response.status===403||response.status===429)accessStopped=true;
      bytes+=Buffer.byteLength(response.body);if(bytes>35000000){accessStopped=true;continue;}
      artifacts.push(officialJsonNetworkArtifact({id:key,logicalKey:key,kind:'ATS_API_RESPONSE',requestedUrl:url,response,extractorLocator:JSON.stringify({method:'GET',url,officialId:id}),bodyRepresentation:'EXACT'}));
    }catch{currentOfficialSourceAttemptSignal()?.throwIfAborted();}
  }
  const projected=projectSlots(pages,artifacts),terminal=artifacts.find(a=>a.logicalKey==='pfizer-terminal')!;
  let evidence=parsePersistentSourceFetchEvidence({captureTool:{name:'pfizer-workday-full-traversal',version:'1'},artifacts,pages:projected.pages,...(projected.quarantines.length?{jobQuarantines:projected.quarantines}:{}),declaredCompleteness:{kind:'COMPLETE_PAGE_TRAVERSAL',scope:'SOURCE',value:pages.length,artifactLogicalKey:'pfizer-terminal',extractorLocator:terminal.extractorLocator},fetchCounts:{rawCount:seen.size,parsedCount:seen.size,validCount:projected.jobs.length,parseDiscardCount:0,validationDiscardCount:projected.losses.length},fetchLosses:projected.losses});
  evidence=deriveCanonicalPaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true,...PFIZER_PAGINATION_POLICY});
  const paginationEvaluation=evaluatePaginationEvidence({evidence,expectedChannelIds:[],filteredOutput:true,...PFIZER_PAGINATION_POLICY});
  if(!paginationEvaluation.verifiedEligible)throw Error('Pfizer traversal has pagination anomalies');
  return {ok:true,capturedAt:artifacts[0]!.capturedAt,payload:{jobPostings:projected.jobs},fetchEvidence:evidence,paginationEvaluation,completeness:{completenessStatus:'NEEDS_MANUAL_COMPLETENESS_REVIEW',completenessEvidenceKind:'COMPLETE_PAGE_TRAVERSAL',completenessEvidenceUrl:PFIZER_ENTRY,pagesVisited:pages.length,totalPages:pages.length,pageSize:20,completenessBlockerReason:'Independent current-run UI comparison required'}};
 }catch(error){return {ok:false,capturedAt:started,failureReason:error instanceof Error?error.message:String(error),...(artifacts.length?{fetchEvidence:finalizeOfficialJsonSupportingFailureEvidence({artifacts:artifacts.map(a=>({...a,kind:a.kind==='PAGINATION_PAGE'?'ATS_API_RESPONSE':a.kind})),code:'PFIZER_TRAVERSAL_UNVERIFIED'})}:{})};}
}
/** Rebuild every raw list slot, detail, quarantine and proven exclusion before comparing output. */
export function replayPfizerWorkdayTraversal(plan:SourceCrawlPlan,evidence:PersistentSourceFetchEvidence,output:readonly NormalizedJobRecord[],now?:Date):boolean{
 try{
  if(!isPfizerWorkdayTraversalPlan(plan)||plan.adapterId!=='official-json'||evidence.supportingArtifactOnlyFailure||evidence.pages.length<1||evidence.pages.length>20)return false;
  const map=new Map(evidence.artifacts.map(a=>[a.logicalKey,a]));if(map.size!==evidence.artifacts.length)return false;
  const first=Date.parse(map.get('pfizer-page-0')?.capturedAt??''),last=Math.max(...evidence.artifacts.map(a=>Date.parse(a.capturedAt)));
  if(!Number.isFinite(first)||!Number.isFinite(last)||last-first>3600000||evidence.artifacts.some(a=>Date.parse(a.capturedAt)<first)||now&&(last>now.getTime()||now.getTime()-first>3600000))return false;
  const used=new Set<string>(),seen=new Set<string>();let total=0;
  const get=(key:string,url:string,request:unknown)=>{const a=map.get(key);if(!a)throw Error('Pfizer original missing');const regenerated=artifact(key,url,{status:a.httpStatus!,body:String(a.body),finalUrl:a.finalUrl!,contentType:a.contentType??"",capturedAt:a.capturedAt},request);if(!isDeepStrictEqual({...a,id:regenerated.id},regenerated))throw Error('Pfizer original binding invalid');used.add(key);return a;};
  for(const [index,p] of evidence.pages.entries()){
    const key=`pfizer-page-${index}`,url=PFIZER_API+'/jobs',a=get(key,url,{method:'POST',url,body:requestBody(index*20)}),root=parse(a.body);
    if(index===0)total=root.total;
    if(!Number.isSafeInteger(total)||total<1||!Array.isArray(root.jobPostings)||root.jobPostings.length<1||root.jobPostings.length>20||root.total!==total&&!(index>0&&root.total===0))return false;
    const rows=(root.jobPostings as unknown[]).map((raw,n)=>slot(raw,index,n));for(const row of rows){if(seen.has(row.rawId))return false;seen.add(row.rawId);}
    const done=index===evidence.pages.length-1;
    if(p.sequence!==index||p.artifactLogicalKey!==key||p.channelId!==undefined||p.requestedOffset!==index*20||p.returnedOffset!==index*20||p.requestedPage!==index||p.returnedPage!==index||p.requestedPageSize!==20||p.declaredTotal!==root.total||p.declaredPages!==(root.total===0?0:Math.ceil(total/20))||p.termination!==(done?'NEXT_ABSENT':'CONTINUE')||p.nextPageSignalBefore!==(index===0?null:String(index*20))||p.nextPageSignalAfter!==(done?null:String((index+1)*20))||!isDeepStrictEqual(p.rawJobIds,rows.map(r=>r.rawId))||p.capturedAt!==a.capturedAt||p.responseFingerprintSha256!==sha256Bytes(Buffer.from(String(a.body))).sha256||!done&&rows.length!==20)return false;
  }
  const url=PFIZER_API+'/jobs',terminal=get('pfizer-terminal',url,{method:'POST',url,body:requestBody(evidence.pages.length*20)});
  if(!terminalBoundaryMatches(parse(map.get('pfizer-page-0')!.body),parse(terminal.body),total,evidence.pages.at(-1)!.rawJobIds.length)||seen.size!==total)return false;
  const projected=projectSlots(evidence.pages,evidence.artifacts,evidence.jobQuarantines===undefined);
  for(const key of projected.used)used.add(key);
  if(used.size!==map.size||!isDeepStrictEqual(projected.pages,evidence.pages)||!isDeepStrictEqual(projected.quarantines,evidence.jobQuarantines??[])||!isDeepStrictEqual(projected.losses,evidence.fetchLosses)||!isDeepStrictEqual(evidence.fetchCounts,{rawCount:total,parsedCount:total,validCount:projected.jobs.length,parseDiscardCount:0,validationDiscardCount:projected.losses.length}))return false;
  const declared=evidence.declaredCompleteness;if(!declared||declared.kind!=='COMPLETE_PAGE_TRAVERSAL'||declared.scope!=='SOURCE'||declared.value!==evidence.pages.length||declared.artifactLogicalKey!=='pfizer-terminal'||declared.extractorLocator!==terminal.extractorLocator)return false;
  const result=officialJsonAdapter.extract({company:plan.company,source:plan.source,json:plan.json,capturedAt:evidence.artifacts[0]!.capturedAt,isBaseline:output[0]?.isBaseline??true,payload:{jobPostings:projected.jobs}});
  return result.status==='SUCCESS'&&isDeepStrictEqual(result.jobs,output);
 }catch{return false;}
}

/** Call only after strict main replay; preserve native paths for excluded identities as well. */
export function pfizerMainSourceJobIds(evidence: PersistentSourceFetchEvidence): string[] {
  return evidence.pages.flatMap(page => parse(evidence.artifacts.find(a => a.logicalKey === page.artifactLogicalKey)!.body).jobPostings
    .map((raw: unknown) => { const id = pfizerQuarantinedRowId(raw); return id ? pfizerQuarantinedEvidenceKey(id) : pfizerSourceJobId(identity(raw).path); }));
}
