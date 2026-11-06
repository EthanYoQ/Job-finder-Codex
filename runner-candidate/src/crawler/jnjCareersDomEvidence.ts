import {jobQuarantineLoss,JOB_QUARANTINE_PAGINATION,type JobQuarantine} from './jobQuarantine';
import { officialJsonAdapter } from "./adapters/officialJson";
import { load } from "cheerio";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { join } from "node:path";
import { savePrivateDomFailure } from "./local-browser/private-dom-failure.mjs";
import { reportSourceFetchFailure } from "./sourceFetchDiagnostics";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceFetchFunction } from "./runSourceCrawl";
import { parseJnjCareersChinaCards, type JnjCareersChinaJobSummary } from "./jnjCareersChinaSourceFetch";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft, type SourceFetchPageTrace } from "./sourceFetchEvidence";
import { JNJ_DOM_CAPTURE_TOOL, JNJ_DOM_COMPANY, JNJ_DOM_CONFIG_SHA256, JNJ_DOM_DETAIL_LOCATOR, JNJ_DOM_LIST_LOCATOR, JNJ_DOM_OBSERVATION_KIND, JNJ_DOM_SOURCE, isJnjDomListArtifact } from "./jnjCareersDomContract";

const ORIGIN = "https://www.careers.jnj.com";
const text = (value: string) => value.replace(/\s+/gu, " ").trim();
const stamp = z.string().datetime({ offset: true });
const base = z.object({ kind: z.literal(JNJ_DOM_OBSERVATION_KIND), url: z.string().url(), observedAt: stamp,
  heading: z.string().min(1), dom: z.string().min(1) });
const listSchema = base.extend({
  fragment: z.object({ html: z.string().min(1), htmlLength: z.number().int().positive(),
    items: z.array(z.object({ text: z.string(), links: z.array(z.object({ title: z.string(), url: z.string() }).strict()) }).strict()) }).strict(),
  filters: z.array(z.object({ id: z.string(), name: z.string(), selectedOptions: z.array(z.object({ text: z.string(), value: z.string() }).strict()) }).strict()),
  pagination: z.array(z.object({ label: z.string(), text: z.string().optional(), url: z.string().url() }).strict()),
  sameIdentityOrderAsEarlier: z.boolean().optional()
}).strict();
const detailSchema = base.extend({ expectedUrl: z.string().url(), expectedTitle: z.string().min(1),
  body: z.object({ html: z.string().min(1), htmlLength: z.number().int().positive(), text: z.string().min(1) }).strict(),
  applyLinks: z.array(z.object({ text: z.string(), href: z.string().url() }).strict()).min(1),
  check: z.record(z.unknown()).optional()
}).strict();
function json(body: string): unknown {
  if (Buffer.byteLength(body) > 2_000_000 || !hasUniqueJsonObjectKeys(body)) throw Error("JNJ_DOM_OBSERVATION_INVALID");
  return JSON.parse(body);
}
function assert(condition: unknown): asserts condition { if (!condition) throw Error("JNJ_DOM_OBSERVATION_INVALID"); }
function auditObservation<T>(body: string, read: () => T, context: {sourcePage?: number; sourceJobId?: string} = {}): T {
  try { return read(); }
  catch (error) {
    throw Object.assign(error instanceof Error ? error : Error("JNJ_DOM_OBSERVATION_INVALID"),
      {sourceFetchStage: "JNJ_DOM_AUDIT", privateObservation: body, ...context});
  }
}
export function isJnjDomPlan(plan: SourceCrawlPlan): boolean {
  return plan.source.id === JNJ_DOM_SOURCE && plan.company.id === JNJ_DOM_COMPANY && plan.source.companyId === JNJ_DOM_COMPANY &&
    plan.executionAuthority === "STAGED" && plan.adapterId === "official-json" && plan.profileBoundSource?.kind === "jnj-careers-china" &&
    sourcePlanConfigSha256(plan) === JNJ_DOM_CONFIG_SHA256;
}
function listUrl(page: number): string {
  return `${ORIGIN}/en/jobs/?${page === 1 ? "" : `page=${page}&`}country=China&origin=global#results`;
}
const listKey = (sequence: number) => `jnj-dom-list-${String(sequence).padStart(4, "0")}`;
const detailKey = (id: string) => `jnj-dom-detail-${id}`;
const evidenceId = (id: string) => `jnj:sha256:${sha256Bytes(Buffer.from(id)).sha256}`;
function parseList(body: string, page: number) {
  const original = listSchema.parse(json(body));
  // Submitting the native empty search form leaves its exact page-one URL in
  // the address bar; the native Page 1 pagination link uses listUrl(1).
  // Admit only these observed aliases, with no nonempty search or extra filter.
  const observedListUrl = original.url === listUrl(page) ||
    (page === 1 && original.url === `${ORIGIN}/en/jobs/?search=&country=China&origin=global`);
  assert(observedListUrl && original.fragment.html.length === original.fragment.htmlLength);
  assert(original.sameIdentityOrderAsEarlier !== false);
  const filters = original.filters;
  assert(filters.filter(f=>f.name==='country').length===1);
  assert(filters.every(f => f.name === "country" ? isDeepStrictEqual(f.selectedOptions, [{ text: "China", value: "China" }]) : f.selectedOptions.length === 0));
  const match = /^Displaying (\d+) to (\d+) of (\d+) matching jobs$/u.exec(original.heading);
  assert(match);
  const [first, last, total] = match.slice(1).map(Number) as [number, number, number];
  assert([first, last, total].every(Number.isSafeInteger) && total > 0 && total <= 400 && page <= Math.ceil(total / 20));
  const $ = load(original.fragment.html);
  assert($("#js-job-search-results").length === 1 && $("#js-job-search-results").attr("data-results") === String(total));
  const elements=$('.PageList-items-item.card-job').toArray(),seen=new Set<string>();
  assert(elements.length===Math.min(20,total-(page-1)*20)&&original.fragment.items.length===elements.length);
  const slots=elements.map((element,index)=>{
    const card=$(element),anchors=card.find('a[href*="/jobs/r-"]'),href=anchors.first().attr('href');
    let candidateUrl:string|undefined,id:string|undefined;
    try{const u=new URL(href??'',ORIGIN),match=/^\/en\/jobs\/(r-[0-9]+)\/[^/?#]+\/$/u.exec(u.pathname);
      if(anchors.length===1&&u.origin===ORIGIN&&!u.search&&!u.hash&&!u.username&&!u.password&&match){candidateUrl=u.href;if(card.attr('data-id')?.toLowerCase()===match[1])id=match[1];}}
    catch{/* Unbound damaged row retains all unobserved prior jobs. */}
    if(id){assert(!seen.has(id));seen.add(id);}
    let job:JnjCareersChinaJobSummary|undefined;
    try{job=parseJnjCareersChinaCards($.html(element),'China')?.[0];
      const item=original.fragment.items[index]!;
      if(!id||!job?.cities.length||item.links.length!==1||text(item.links[0]!.title)!==job.title||item.links[0]!.url!==job.officialUrl)job=undefined;
    }catch{job=undefined;}
    return {job,officialId:id,officialUrl:id?candidateUrl:undefined,candidateUrl,rawId:id?evidenceId(id):`jnj-unidentified:sha256:${sha256Bytes(Buffer.from(JSON.stringify([page,index,$.html(element)]))).sha256}`};
  });
  assert(first===(page-1)*20+1&&last===first+elements.length-1);
  const lastPage = Math.ceil(total / 20), next = original.pagination.filter(a => a.label === "Next page"), previous = original.pagination.filter(a => a.label === "Previous page");
  assert(next.length === (page < lastPage ? 1 : 0) && (!next.length || next[0]!.url === listUrl(page + 1)));
  assert(previous.length === (page > 1 ? 1 : 0) && (!previous.length || previous[0]!.url === listUrl(page - 1)));
  assert(original.pagination.some(a => a.label === `Page ${page}` && a.url === listUrl(page)));
  for (const link of original.pagination) {
    const n = /^Page (\d+)$/u.exec(link.label);
    assert(n ? Number(n[1]) >= 1 && Number(n[1]) <= lastPage && link.url === listUrl(Number(n[1])) : ["Next page", "Previous page"].includes(link.label));
  }
  assert((page < lastPage) === original.dom.includes('link "Next page"'));
  return { original, slots, total };
}
function parseDetail(body: string, job: JnjCareersChinaJobSummary) {
  const original = detailSchema.parse(json(body));
  assert(original.url === job.officialUrl && original.expectedUrl === job.officialUrl &&
    text(original.expectedTitle) === job.title && text(original.heading) === job.title && original.body.html.length === original.body.htmlLength);
  const $ = load(original.body.html), container = $("#js-job-detail"), article = container.find("article.RichTextBody");
  assert(container.length === 1 && container.attr("data-id") === job.officialId && text(container.attr("data-jobtitle") ?? "") === job.title && article.length === 1);
  const metadata = new Map<string, string>();
  article.find(".job-meta > li").each((_, e) => {
    const li = $(e), label = text(li.clone().children().remove().end().text());
    assert(!metadata.has(label)); metadata.set(label, text(li.find("span").text()));
  });
  assert(metadata.get("Job title") === job.title && metadata.get("Requisition number")?.toLowerCase() === job.officialId && metadata.get("Function") === job.functionRaw);
  const locations = metadata.get("Location")?.split(" / ").map(text) ?? [];
  assert(locations.includes("China") && job.locationRaw.split(" / ").every(location => locations.includes(location)));
  assert(article.find("h2").toArray().some(e => text($(e).text()) === "Description"));
  const description = article.clone(); description.find(".job-meta").remove();
  assert(text(description.text()).length >= 200 && /Job Description:/u.test(text(description.text())));
  assert(original.body.text.toLowerCase().includes(job.officialId) && original.dom.toLowerCase().includes(job.officialId));
  assert(!/this (?:job|position) (?:is |has been )?(?:no longer available|closed)|job (?:has expired|is no longer available)/iu.test(original.body.text));
  assert(original.dom.includes('link "Apply now"'));
  const applies = new Set<string>();
  for (const link of original.applyLinks) {
    const url = new URL(link.href), id = job.officialId.toUpperCase();
    assert(text(link.text) === "Apply now" && !applies.has(link.href) && url.protocol === "https:" && !url.username && !url.password && !url.hash);
    const china = url.origin === "https://careers.jnj.com.cn" && url.pathname === "/jnj/apply" &&
      url.searchParams.get("exid") === id && url.searchParams.get("m") === "1" && [...url.searchParams.keys()].sort().join(",") === "exid,m";
    const workday = url.origin === "https://jj.wd5.myworkdayjobs.com" && !url.search &&
      url.pathname.startsWith("/en-US/JJ/job/") && new RegExp(`_${id}(?:-[0-9]+)?/apply$`, "u").test(url.pathname);
    assert((china || workday) && original.dom.includes(link.href)); applies.add(link.href);
  }
  return original;
}
function artifact(key: string, body: string, capturedAt: string, locator: string): SourceFetchArtifactDraft {
  return { id: key, logicalKey: key, kind: "COMMAND_OUTPUT", capturedAt, body, bodyRepresentation: "EXACT", extractorLocator: locator };
}
export function auditJnjCareersDomObservations(lists: readonly string[], details: readonly string[]) {
  assert(lists.length > 0 && lists.length <= 20);
  const parsed = lists.map((body, i) => auditObservation(body, () => parseList(body, i + 1), {sourcePage: i + 1})), total = parsed[0]!.total;
  assert(parsed.every(p => p.total === total) && lists.length === Math.ceil(total / 20));
  const slots=parsed.flatMap((p,pageSequence)=>p.slots.map((slot,recordIndex)=>({...slot,pageSequence,recordIndex})));
  const known=slots.flatMap(slot=>slot.officialId?[slot.officialId]:[]);assert(slots.length===total&&new Set(known).size===known.length);
  const detailMap=new Map<string,{body:string;observedAt:string}>();
  for(const body of details){
    const raw=auditObservation(body,()=>json(body)),value=raw as {expectedUrl?:unknown;observedAt?:unknown}|null;
    const slot=slots.find(slot=>slot.candidateUrl===value?.expectedUrl);
    auditObservation(body,()=>{assert(value&&typeof value.expectedUrl==='string'&&stamp.safeParse(value.observedAt).success&&!detailMap.has(value.expectedUrl));},slot?.officialId?{sourceJobId:slot.officialId}:{});
    detailMap.set(value!.expectedUrl as string,{body,observedAt:value!.observedAt as string});
  }
  const missing=slots.filter(slot=>slot.job&&!detailMap.has(slot.job.officialUrl)),surplusObservations=[...detailMap].filter(([url])=>!slots.some(slot=>slot.candidateUrl===url)).map(([,d])=>d.body);
  if(surplusObservations.length){const slot=missing[0];throw Object.assign(Error(slot?'JNJ_DOM_DETAIL_OBSERVATION_MISSING':'JNJ_DOM_OBSERVATION_INVALID'),{
    ...(slot?{sourceJobId:slot.officialId}:{}),privateObservation:slot?{kind:'MISSING_DETAIL_OBSERVATION',sourceJobId:slot.officialId,expectedUrl:slot.job!.officialUrl,surplusObservations}:{kind:'SURPLUS_DETAIL_OBSERVATIONS',observations:surplusObservations}});}
  const artifacts=parsed.map((p,i)=>artifact(listKey(i),lists[i]!,p.original.observedAt,JNJ_DOM_LIST_LOCATOR)),quarantines:JobQuarantine[]=[],jobs:JnjCareersChinaJobSummary[]=[];
  for(const slot of slots){
    const detail=slot.candidateUrl?detailMap.get(slot.candidateUrl):undefined;
    if(detail)artifacts.push(artifact(detailKey(slot.officialId??`unidentified-${slot.pageSequence}-${slot.recordIndex}`),detail.body,detail.observedAt,JNJ_DOM_DETAIL_LOCATOR));
    let code=slot.job?'JNJ_JOB_DETAIL_UNVERIFIED':'JNJ_JOB_LIST_ROW_UNVERIFIED';
    if(slot.job&&detail){try{parseDetail(detail.body,slot.job);jobs.push(slot.job);continue;}catch{/* Preserve this job's old data; other verified jobs continue. */}}
    if(slot.job&&!detail)code='JNJ_JOB_DETAIL_UNAVAILABLE';
    quarantines.push({pageSequence:slot.pageSequence,recordIndex:slot.recordIndex,rawLocator:`${listKey(slot.pageSequence)}#row:${slot.recordIndex}`,validJobId:slot.rawId,code,
      ...(slot.officialId?{sourceJobId:slot.officialId}:{}),...(slot.officialUrl?{officialUrl:slot.officialUrl}:{})});
  }
  const times=artifacts.map(a=>Date.parse(a.capturedAt)),startedAt=new Date(Math.min(...times)).toISOString(),finishedAt=new Date(Math.max(...times)).toISOString();
  assert(Date.parse(finishedAt)-Date.parse(startedAt)<30*60_000);
  const goodIds=new Set(jobs.map(j=>j.officialId));
  const pages:SourceFetchPageTrace[]=parsed.map((p,sequence)=>({sequence,artifactLogicalKey:listKey(sequence),requestedCursor:null,returnedCursor:null,
    requestedOffset:sequence*20,returnedOffset:sequence*20,requestedPage:sequence+1,returnedPage:sequence+1,requestedPageSize:20,returnedPageSize:20,
    rawJobIds:p.slots.map(s=>s.rawId),validJobIds:p.slots.filter(s=>s.officialId&&goodIds.has(s.officialId)).map(s=>s.rawId),
    declaredTotal:total,declaredCount:total,declaredPages:parsed.length,nextPageSignalBefore:sequence===0?null:listUrl(sequence+1),nextPageSignalAfter:sequence+1===parsed.length?null:listUrl(sequence+2),
    responseFingerprintSha256:sha256Bytes(Buffer.from(lists[sequence]!)).sha256,termination:sequence+1===parsed.length?'DECLARED_TOTAL_REACHED':'CONTINUE',anomalyCodes:[],capturedAt:p.original.observedAt}));
  const options={expectedChannelIds:[],filteredOutput:true,...JOB_QUARANTINE_PAGINATION};
  const evidence=deriveCanonicalPaginationEvidence({evidence:parsePersistentSourceFetchEvidence({captureTool:JNJ_DOM_CAPTURE_TOOL,artifacts,pages,
    declaredCompleteness:{kind:'OFFICIAL_TOTAL_COUNT',value:total,artifactLogicalKey:listKey(0),extractorLocator:JNJ_DOM_LIST_LOCATOR,scope:'SOURCE'},
    ...(quarantines.length?{jobQuarantines:quarantines}:{}),fetchCounts:{rawCount:total,parsedCount:total,validCount:jobs.length,parseDiscardCount:0,validationDiscardCount:quarantines.length},
    fetchLosses:quarantines.map(q=>jobQuarantineLoss(q,parsed[q.pageSequence]!.original.observedAt))}),...options});
  const paginationEvaluation=evaluatePaginationEvidence({evidence,...options});assert(paginationEvaluation.safeCompleteness&&paginationEvaluation.verifiedEligible);
  return {jobs,total,evidence,paginationEvaluation,startedAt,finishedAt};
}
/** Retains the unmodified UI tool JSON bytes. No HTTP envelope is manufactured. */
export function createJnjCareersDomSourceFetch(input: { lists: readonly string[]; details: readonly string[] }): SourceFetchFunction {
  return async plan => {
    if (!isJnjDomPlan(plan)) return { ok: false, capturedAt: new Date().toISOString(), failureReason: "JNJ_PLAN_BINDING_INVALID" };
    try {
      const value = auditJnjCareersDomObservations(input.lists, input.details);
      return { ok: true, capturedAt: value.startedAt, payload: { jobs: value.jobs.map(job => ({ sourceJobId: job.officialId, title: job.title,
        officialUrl: job.officialUrl, locationRaw: job.locationRaw, cities: job.cities })) },
        completeness: { completenessStatus: "VERIFIED", expectedJobCount: value.total, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: plan.source.officialEntryUrl, totalPages: value.evidence.pages.length, pageSize: 20, pagesVisited: value.evidence.pages.length },
        fetchEvidence: value.evidence, paginationEvaluation: value.paginationEvaluation };
    } catch (error) {
      const cause = Object.assign(error instanceof Error ? error : Error("JNJ_DOM_OBSERVATION_INVALID"),
        {sourceFetchStage: "JNJ_DOM_AUDIT"}) as Error & {privateObservation?: unknown; privateCapture?: unknown; privateCaptureUnavailable?: boolean};
      try {
        cause.privateCapture = await savePrivateDomFailure({
          directory: join(process.env.JOBFINDER_STATE_ROOT ?? "/data/job-finder", "diagnostics", "jnj"), filePrefix: "jnj-audit",
          context: {kind: "JNJ_FAILED_AUDIT_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE", errorMessage: cause.message,
            listCount: input.lists.length, detailCount: input.details.length},
          observe: async () => ({lists: input.lists, details: input.details, failedObservation: cause.privateObservation ?? null})});
      } catch { cause.privateCaptureUnavailable = true; }
      reportSourceFetchFailure(plan.source.id, {error: cause});
      return { ok: false, capturedAt: new Date().toISOString(), failureReason: "JNJ_DOM_OBSERVATION_INVALID" };
    }
  };
}
export function replayJnjCareersDomEvidence(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, outputJobs: readonly NormalizedJobRecord[]): boolean {
  try {
    if (!isJnjDomPlan(plan) || !isDeepStrictEqual(evidence.captureTool, JNJ_DOM_CAPTURE_TOOL)) return false;
    const listArtifacts = evidence.artifacts.filter(a => a.logicalKey.startsWith("jnj-dom-list-"));
    if (listArtifacts.length !== evidence.pages.length || !listArtifacts.every(a => isJnjDomListArtifact(evidence.captureTool, a))) return false;
    const details = evidence.artifacts.filter(a => a.logicalKey.startsWith("jnj-dom-detail-"));
    if (listArtifacts.length + details.length !== evidence.artifacts.length || evidence.artifacts.some(a => typeof a.body !== "string")) return false;
    const rebuilt = auditJnjCareersDomObservations(listArtifacts.map(a => a.body as string), details.map(a => a.body as string));
    // Artifact IDs may acquire a batch prefix during archiving; logical identity,
    // bytes and every evidence field must otherwise remain identical.
    const canonical = (e: PersistentSourceFetchEvidence) => ({ ...e, artifacts: e.artifacts.map(a => ({ ...a, id: a.logicalKey })) });
    if (!isDeepStrictEqual(canonical(rebuilt.evidence), canonical(evidence))) return false;
    if (plan.adapterId !== "official-json") return false;
    const adapted = officialJsonAdapter.extract({company:plan.company,source:{...plan.source,officialEntryUrl:"https://www.careers.jnj.com/en/jobs/"},json:plan.json,
      capturedAt:rebuilt.startedAt,isBaseline:outputJobs[0]?.isBaseline ?? true,payload:{jobs:rebuilt.jobs.map(j=>({
        sourceJobId:j.officialId,title:j.title,officialUrl:j.officialUrl,locationRaw:j.locationRaw,cities:j.cities}))}});
    const sorted=(jobs:readonly NormalizedJobRecord[])=>[...jobs].sort((a,b)=>(a.sourceJobId??"").localeCompare(b.sourceJobId??""));
    return adapted.status === "SUCCESS" && isDeepStrictEqual(sorted(adapted.jobs),sorted(outputJobs));
  } catch { return false; }
}
