import { hasNovartisPartitionEvidence, replayNovartisNativePartitions } from "./novartisNativePartitions";
import { load } from "cheerio";
import { isDeepStrictEqual } from "node:util";
import type { HttpHtmlClient } from "./httpHtmlSourceFetch";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchResult } from "./runSourceCrawl";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl, sha256Bytes,
  type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";

const ORIGIN = "https://www.novartis.com.cn";
export const NOVARTIS_DEFAULT_ENTRY = ORIGIN + "/careers/career-search?search_api_fulltext=&country%5B%5D=LOC_CN&op=Submit&field_job_posted_date=All";
const PREFIX = "novartis-presence-", AUDIT = PREFIX + "audit";
export const NOVARTIS_PRESENCE_UNKNOWN = "NOVARTIS_OFFICIAL_PRESENCE_UNKNOWN_PRESERVE_LAST_GOOD";
const clean = (text: string) => text.replace(/\s+/gu, " ").trim();
const body = (artifact: SourceFetchArtifactDraft) => typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8");

export function hasNovartisOfficialPresencePlan(plan: SourceCrawlPlan): boolean {
  return plan.source.id === "source-novartis-social" && plan.company.id === "company-novartis" &&
    plan.adapterId === "html-table" && plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "NOVARTIS_CHINA_SLIDING_WINDOW_V1";
}

function detailIdentity(value: string): string {
  const url = new URL(value);
  const match = /^\/careers\/career-search\/job\/details\/(req-\d+)(?:-[^/]+)?$/iu.exec(url.pathname);
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || !match) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  return match[1]!.toUpperCase();
}

function rows(html: string): Map<string, string> {
  const $ = load(html), result = new Map<string, string>();
  const nodes = $("table.views-table tbody tr").toArray();
  if (!nodes.length) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  for (const node of nodes) {
    const link = $(node).find("td.views-field-field-job-title a");
    if (link.length !== 1 || !clean(link.text()) || !link.attr("href")) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
    const url = new URL(link.attr("href")!, ORIGIN).href, id = detailIdentity(url);
    if (result.has(id)) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
    result.set(id, url);
  }
  return result;
}

function defaultUrl(value: string, page: number): boolean {
  const url = new URL(value), params = [...url.searchParams];
  // Evidence URLs hash query values; native Next hrefs retain their actual values.
  const matches = (actual:string|null, expected:string) => actual === expected ||
    actual === `sha256:${sha256Bytes(Buffer.from(expected)).sha256}`;
  const expected: Record<string, string> = {search_api_fulltext:"", op:"Submit", field_job_posted_date:"All",
    ...(page ? {page:String(page)} : {})};
  const country = params.filter(([key]) => key === "country[]" || key === "country[0]");
  return url.origin === ORIGIN && url.pathname === "/careers/career-search" && !url.username && !url.password && !url.hash &&
    country.length === 1 && matches(country[0]![1],"LOC_CN") && params.length === Object.keys(expected).length + 1 &&
    Object.entries(expected).every(([key, val]) => url.searchParams.getAll(key).length === 1 && matches(url.searchParams.get(key),val));
}

function defaultPage(artifact: SourceFetchArtifactDraft, page: number) {
  if (!defaultUrl(artifact.requestedUrl!, page) || !defaultUrl(artifact.finalUrl!, page) || artifact.httpStatus !== 200 ||
      !/^text\/html(?:;|$)/iu.test(artifact.contentType ?? "")) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  const $ = load(body(artifact));
  if ($("table.views-table tbody tr").length > 10) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  const active = $(".pagination .active .page-link[title]");
  const activeMatch = /^page\s+(\d+)\s+.*out of\s+(\d+)\s+pages$/iu.exec(clean(active.attr("title") ?? ""));
  const next = $(".pagination a[rel=next]");
  if (active.length !== 1 || !activeMatch || Number(activeMatch[1]) !== page + 1 || Number(activeMatch[2]) < page + 1 ||
      next.length !== 1) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  const disabled = next.hasClass("disabled") || next.parent().hasClass("disabled") || next.attr("aria-disabled") === "true";
  const href = next.attr("href");
  if (disabled && href || !disabled && !href) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  const nextUrl = disabled ? null : new URL(href!, artifact.finalUrl).href;
  if (nextUrl && !defaultUrl(nextUrl, page + 1) || disabled && Number(activeMatch[2]) !== page + 1) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  const totals = $(".view-header").toArray().map(node => clean($(node).text())).filter(text => /^Showing\b/iu.test(text));
  if (totals.length !== 1 || !/^Showing\s+[1-9]\d*\s+results$/iu.test(totals[0]!)) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  return {rows:rows(body(artifact)), nextUrl, reportedTotal:Number(totals[0]!.match(/\d+/u)![0])};
}

// Only a same-REQ official detail can establish explicit closure. A missing page,
// stale job body, apply button or downstream 404 cannot establish recruitment status.
function explicitlyClosed(artifact: SourceFetchArtifactDraft, id: string, url: string): boolean {
  if (artifact.requestedUrl !== sanitizeEvidenceHttpUrl(url) || artifact.finalUrl !== sanitizeEvidenceHttpUrl(url) ||
      artifact.httpStatus !== 200 || !/^text\/html(?:;|$)/iu.test(artifact.contentType ?? "")) return false;
  const $ = load(body(artifact));
  $("script,style,noscript,[hidden],[aria-hidden=true],.hidden,.d-none,.sr-only").remove();
  $("[style]").filter((_index,node)=>/(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test($(node).attr("style") ?? "")).remove();
  const article = $("article");
  article.find("p,div,li,section,br,h2,h3").before(" ").after(" ");
  const text = clean(article.text());
  const ids = [...new Set(text.match(/REQ-\d+/giu)?.map(value => value.toUpperCase()) ?? [])];
  const closed = /\b(?:this (?:job|position) is no longer available|we are no longer accepting applications for this (?:job|position))\b/iu.test(text) ||
    /(?:该|此|本)职位(?:已关闭|已停止招聘|已结束招聘)/u.test(text);
  const hasApply = article.find("a[href]").toArray().some(node => /^(?:Apply(?: to Job| now)?|立即申请|申请职位)$/iu.test(clean($(node).text())));
  return article.length === 1 && ids.length === 1 && ids[0] === id && closed && !hasApply;
}

function auditEvidence(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence) {
  if (!hasNovartisOfficialPresencePlan(plan)) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  const primary = evidence.artifacts.filter(a => !a.logicalKey.startsWith(PREFIX));
  const supplements = evidence.artifacts.filter(a => a.logicalKey.startsWith(PREFIX) && a.logicalKey !== AUDIT);
  const sorted = new Map<string, string>();
  for (const page of evidence.pages) {
    const artifact = primary.find(a => a.logicalKey === page.artifactLogicalKey);
    if (!artifact) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
    for (const [id,url] of rows(body(artifact))) sorted.set(id,url);
  }
  const defaults = new Map<string,string>(), totals: number[] = [], used: string[] = [];
  let expected = NOVARTIS_DEFAULT_ENTRY, terminal = false;
  for (let page = 0; page < (plan.adapterId === "html-table" ? plan.table.pagination?.maxPages ?? 0 : 0); page++) {
    const artifact = supplements.find(a => a.logicalKey === `${PREFIX}default-${page}`);
    if (!artifact || artifact.kind !== "OFFICIAL_COMPANY_PAGE" || artifact.requestedUrl !== sanitizeEvidenceHttpUrl(expected) ||
        artifact.extractorLocator !== "novartis-default-native-page-v1") throw Error(NOVARTIS_PRESENCE_UNKNOWN);
    const parsed = defaultPage(artifact, page);
    for (const [id,url] of parsed.rows) {
      if (defaults.has(id) && defaults.get(id) !== url) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
      defaults.set(id,url);
    }
    used.push(artifact.logicalKey); totals.push(parsed.reportedTotal);
    if (parsed.nextUrl === null) { terminal = true; break; }
    expected = parsed.nextUrl;
  }
  if (!terminal) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  const differences = [...defaults].filter(([id]) => !sorted.has(id)).sort(([a],[b]) => a.localeCompare(b));
  const details = differences.map(([id,url]) => {
    const artifact = supplements.find(a => a.logicalKey === `${PREFIX}detail-${id}`);
    if (!artifact || artifact.kind !== "ATS_PAGE" || artifact.requestedUrl !== sanitizeEvidenceHttpUrl(url) ||
        artifact.extractorLocator !== "novartis-same-id-official-detail-v1") throw Error(NOVARTIS_PRESENCE_UNKNOWN);
    used.push(artifact.logicalKey);
    return {officialId:id, officialUrl:url, status:explicitlyClosed(artifact,id,url) ? "EXPLICITLY_CLOSED" : "UNKNOWN"};
  });
  if (used.length !== supplements.length || supplements.some(a => a.bodyRepresentation === "REDACTED" || a.rawBodySha256 || a.redactionDescriptors) ||
      supplements.some(a => Date.parse(a.capturedAt) < Math.max(...primary.map(a => Date.parse(a.capturedAt))))) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  return {status:details.some(d => d.status === "UNKNOWN") ? "UNKNOWN" : "CONSISTENT",
    sortedUniqueCount:sorted.size, defaultObservedUniqueCount:defaults.size,
    defaultReportedTotals:totals, defaultCompletenessClaim:false, differences:details,
    originals:supplements.map(a => ({logicalKey:a.logicalKey,sha256:sha256Bytes(Buffer.from(body(a))).sha256}))};
}

/** Replay original bodies, never trust a precomputed allow-list or the ledger alone. */
export function replayNovartisOfficialPresence(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence) {
  if (hasNovartisPartitionEvidence(evidence)) return {listEvidence:evidence,closedUrls:replayNovartisNativePartitions(plan,evidence).closedUrls};
  const audit = auditEvidence(plan,evidence), ledger = evidence.artifacts.filter(a => a.logicalKey === AUDIT);
  if (ledger.length !== 1 || ledger[0]!.kind !== "COMMAND_OUTPUT" ||
      ledger[0]!.extractorLocator !== "novartis-official-presence-v1" || !isDeepStrictEqual(JSON.parse(body(ledger[0]!)),audit) || audit.status !== "CONSISTENT") {
    throw Error(NOVARTIS_PRESENCE_UNKNOWN);
  }
  return {listEvidence:{...evidence,artifacts:evidence.artifacts.filter(a => !a.logicalKey.startsWith(PREFIX))},
    closedUrls:new Set(audit.differences.filter(d => d.status === "EXPLICITLY_CLOSED").map(d => d.officialUrl))};
}

export function hasNovartisPresenceArtifacts(evidence: PersistentSourceFetchEvidence): boolean {
  return evidence.artifacts.some(a => a.logicalKey.startsWith(PREFIX));
}

/** Bounded positive-presence check. Default pagination never replaces or changes
 * the sorted list, its total, primary traces, normalization or lifecycle counts. */
export async function acquireNovartisOfficialPresence(plan: SourceCrawlPlan, fetched: SourceFetchResult, http: HttpHtmlClient): Promise<SourceFetchResult> {
  if (!hasNovartisOfficialPresencePlan(plan) || !fetched.ok || !fetched.fetchEvidence) return fetched;
  const evidence = structuredClone(fetched.fetchEvidence);
  let at = evidence.artifacts.at(-1)!.capturedAt;
  const capture = async (url:string, logicalKey:string, kind:"OFFICIAL_COMPANY_PAGE"|"ATS_PAGE", extractorLocator:string) => {
    const response = await http({url,headers:{Accept:"text/html", "User-Agent":"job-search-crawler/0.1"}});
    if (!response.capturedAt || !Number.isFinite(Date.parse(response.capturedAt)) || Date.parse(response.capturedAt) < Date.parse(at)) throw Error(NOVARTIS_PRESENCE_UNKNOWN);
    at = response.capturedAt;
    const artifact: SourceFetchArtifactDraft = {id:logicalKey,logicalKey,kind,requestedUrl:sanitizeEvidenceHttpUrl(url),
      finalUrl:sanitizeEvidenceHttpUrl(response.finalUrl ?? url),httpStatus:response.status,contentType:response.contentType ?? "application/octet-stream",
      capturedAt:at,body:response.body,extractorLocator};
    evidence.artifacts.push(artifact); return artifact;
  };
  try {
    let url = NOVARTIS_DEFAULT_ENTRY;
    const defaults = new Map<string,string>(), sorted = new Set(evidence.pages.flatMap(page => [...rows(body(evidence.artifacts.find(a => a.logicalKey === page.artifactLogicalKey)!)).keys()]));
    const max = plan.adapterId === "html-table" ? plan.table.pagination?.maxPages ?? 0 : 0;
    for (let page = 0; page < max; page++) {
      const artifact = await capture(url,`${PREFIX}default-${page}`,"OFFICIAL_COMPANY_PAGE","novartis-default-native-page-v1");
      const parsed = defaultPage(artifact,page);
      for (const [id,detailUrl] of parsed.rows) defaults.set(id,detailUrl);
      if (!parsed.nextUrl) break;
      url = parsed.nextUrl;
    }
    for (const [id,detailUrl] of [...defaults].filter(([id]) => !sorted.has(id)).sort(([a],[b]) => a.localeCompare(b))) {
      await capture(detailUrl,`${PREFIX}detail-${id}`,"ATS_PAGE","novartis-same-id-official-detail-v1");
    }
    const audit = auditEvidence(plan,evidence);
    evidence.artifacts.push({id:AUDIT,logicalKey:AUDIT,kind:"COMMAND_OUTPUT",capturedAt:at,body:JSON.stringify(audit),extractorLocator:"novartis-official-presence-v1"});
    if (audit.status !== "CONSISTENT") throw Error(NOVARTIS_PRESENCE_UNKNOWN);
    replayNovartisOfficialPresence(plan,evidence);
    return {...fetched,fetchEvidence:parsePersistentSourceFetchEvidence(evidence)};
  } catch {
    // Retain every obtained raw response and the conflict ledger. No accepted
    // source observation means no missing-count advance or last-good replacement.
    return {ok:false,capturedAt:fetched.capturedAt,failureReason:NOVARTIS_PRESENCE_UNKNOWN,
      fetchEvidence:parsePersistentSourceFetchEvidence(evidence),...(fetched.paginationEvaluation ? {paginationEvaluation:fetched.paginationEvaluation} : {})};
  }
}
