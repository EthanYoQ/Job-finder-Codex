import { hasExactFosunMainlandGeography, mainlandDisplayCities } from "./fosunScopeGeography";
import { load } from "cheerio";
import {isDeepStrictEqual} from "node:util";
import {jobQuarantineLoss,jobQuarantineLossesMatch,JOB_QUARANTINE_PAGINATION,type JobQuarantine} from "./jobQuarantine";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchResult } from "./runSourceCrawl";
import type { NormalizedJobRecord } from "./normalizedJob";
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";

export const KELUN_MAINLAND_POLICY = "KELUN_CATEGORY_MAINLAND_V1" as const;
export const KELUN_CONFIG_SHA256 = "9fe0cb0d7c308567f6010aa6181f36c595b97df739ecd528cab97070f47572cb";
export const KELUN_ENTRY = "https://kelun.zhiye.com/social?r=&p=1%5E2&c=&d=&k=";
export function exactKelunMainlandPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "html-table" && plan.executionAuthority === "STAGED" &&
    plan.source.id === "source-kelun-social" && plan.company.id === "company-kelun" &&
    plan.source.companyId === "company-kelun" && plan.source.officialEntryUrl === KELUN_ENTRY &&
    sourcePlanConfigSha256(plan) === KELUN_CONFIG_SHA256;
}
export type KelunScopeDecision = "MAINLAND" | "EXPLICIT_OUTSIDE" | "UNKNOWN";
// Source-local vocabulary copied from the reviewed repository CNSTAFF/Fosun
// province/prefecture identities. No job IDs, live counts or network lookup.
const OUTSIDE = new Set([
  "香港", "香港特别行政区", "香港特別行政區", "hong kong", "hong kong sar", "hong kong sar china",
  "澳门", "澳門", "澳门特别行政区", "澳門特別行政區", "macau", "macao",
  "台湾", "台灣", "taiwan", "美国", "united states", "usa", "英国", "united kingdom",
  "日本", "japan", "新加坡", "singapore", "德国", "germany", "法国", "france",
  "澳大利亚", "australia", "加拿大", "canada", "韩国", "south korea"
]);
const COUNTRY = new Set(["中国", "china", "cn", "中华人民共和国"]);
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const key = (value: string) => clean(value.normalize("NFKC")).toLowerCase();
function mainlandHierarchy(value: string): boolean {
  return hasExactFosunMainlandGeography({LocNames:[value.replaceAll("-", "·")]});
}
function outsideHierarchy(value: string): boolean {
  if (OUTSIDE.has(key(value))) return true;
  const parts = value.split(/[-·・]/u).map(key);
  return parts.length === 2 && COUNTRY.has(parts[0]!) && OUTSIDE.has(parts[1]!);
}
export function classifyKelunLocation(locationRaw: string): KelunScopeDecision {
  const alternatives = locationRaw.normalize("NFKC").split(/[,;、/|\n]/u).map(clean);
  if (!alternatives.length || alternatives.some(value => !value)) return "UNKNOWN";
  if (alternatives.every(mainlandHierarchy)) return "MAINLAND";
  if (alternatives.every(outsideHierarchy)) return "EXPLICIT_OUTSIDE";
  return "UNKNOWN";
}

function validDetailContext(url: URL, pageSequence: number): boolean {
  if (!url.search) return true;
  const canonical = (params: URLSearchParams) => JSON.stringify([...params].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)));
  const entry = new URL(KELUN_ENTRY).searchParams;
  const page = new URLSearchParams({p: "1^2", PageIndex: String(pageSequence + 1)});
  const fullPage = new URLSearchParams(entry);
  fullPage.set("PageIndex", String(pageSequence + 1));
  return canonical(url.searchParams) === canonical(entry) || pageSequence > 0 &&
    (canonical(url.searchParams) === canonical(page) || canonical(url.searchParams) === canonical(fullPage));
}
export interface KelunScopeRow {
  pageSequence: number; recordIndex: number; artifactLogicalKey: string;
  sourceJobId: string; officialUrl: string; title: string; locationRaw: string;
  rawHtml: string; rawId: string; decision: KelunScopeDecision;
}
/** Re-select original rows at their original page and row positions. This does
 * not trust fetch counts, projected payloads, loss claims or normalized jobs. */
export function inspectKelunScopeRows(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence): KelunScopeRow[] {
  if (!exactKelunMainlandPlan(plan)) throw Error("KELUN_SCOPE_BINDING_INVALID");
  const rows: KelunScopeRow[] = [], seen = new Set<string>();
  if (evidence.pages.length !== evidence.artifacts.length) throw Error("KELUN_SCOPE_ARTIFACT_SET");
  for (const page of evidence.pages) {
    const artifact = evidence.artifacts.find(item => item.logicalKey === page.artifactLogicalKey);
    if (!artifact || artifact.bodyRepresentation !== "EXACT" || typeof artifact.body !== "string" ||
      page.responseFingerprintSha256 !== sha256Bytes(Buffer.from(artifact.body)).sha256) throw Error("KELUN_SCOPE_ORIGINAL_REQUIRED");
    const $ = load(artifact.body);
    const selected = $(".jobsTable tr:not(.title)").toArray();
    const pageRows = selected.map((element, recordIndex): KelunScopeRow => {
      const row = $(element), link = row.find("td:nth-child(1) a"), location = row.find("td:nth-child(5)");
      let url:URL|undefined;try{url=new URL(link.attr('href')??'',KELUN_ENTRY);}catch{/* malformed job link is isolated below */}
      const match = /^\/job_show\/([1-9][0-9]*)$/u.exec(url?.pathname??'');
      const validIdentity=link.length===1&&url&&match&&url.origin==='https://kelun.zhiye.com'&&validDetailContext(url,page.sequence)&&!url.hash&&!url.username&&!url.password;
      if(validIdentity){if(seen.has(match[1]!))throw Error('KELUN_DUPLICATE_OFFICIAL_ID');seen.add(match[1]!);}
      const rawHtml = $.html(element), locationRaw = clean(location.attr("title") ?? "");
      const visible = key(location.text()), full = key(locationRaw);
      const clipped = /(?:\.{3}|…)$/.test(visible) && full.startsWith(visible.replace(/(?:\.{3}|…)$/u, ""));
      const decision = !validIdentity||location.length!==1||!clean(link.text())||visible && visible !== full && !clipped ? "UNKNOWN" : classifyKelunLocation(locationRaw);
      return { pageSequence: page.sequence, recordIndex, artifactLogicalKey: artifact.logicalKey,
        sourceJobId: validIdentity?match[1]!:"", officialUrl: validIdentity?url!.toString():"", title: clean(link.text()), locationRaw,
        rawHtml, rawId: `html-row:sha256:${sha256Bytes(Buffer.from(rawHtml)).sha256}`, decision };
    });
    if (JSON.stringify(pageRows.map(row => row.rawId)) !== JSON.stringify(page.rawJobIds)) throw Error("KELUN_SCOPE_RAW_ROWS_MISMATCH");
    rows.push(...pageRows);
  }
  if (rows.length !== evidence.fetchCounts.rawCount || rows.length !== evidence.fetchCounts.parsedCount)
    throw Error("KELUN_SCOPE_RAW_COUNTS_MISMATCH");
  return rows;
}
export function kelunScopeCounts(rows: readonly KelunScopeRow[]) {
  return { rawCount: rows.length, mainlandCount: rows.filter(row => row.decision === "MAINLAND").length,
    outsideCount: rows.filter(row => row.decision === "EXPLICIT_OUTSIDE").length,
    unknownCount: rows.filter(row => row.decision === "UNKNOWN").length };
}
export function kelunScopeLoss(row: KelunScopeRow, capturedAt: string): PersistentSourceFetchEvidence["fetchLosses"][number] {
  const code = row.decision === "EXPLICIT_OUTSIDE" ? "KELUN_EXPLICIT_OUTSIDE_MAINLAND" : "KELUN_GEOGRAPHY_UNKNOWN";
  return { stage: "VALIDATION", reason: code,
    rawLocator: `${row.artifactLogicalKey}#row:${row.recordIndex};id:${row.sourceJobId};${row.rawId}`,
    details: { code, field: "locationRaw", pageSequence: row.pageSequence, recordIndex: row.recordIndex,
      noteCode: KELUN_MAINLAND_POLICY }, recordedAt: capturedAt };
}
function kelunJobQuarantine(row:KelunScopeRow):JobQuarantine{
 return {pageSequence:row.pageSequence,recordIndex:row.recordIndex,rawLocator:`${row.artifactLogicalKey}#row:${row.recordIndex}`,validJobId:row.rawId,code:'KELUN_JOB_ROW_UNVERIFIED',
  ...(row.sourceJobId?{sourceJobId:row.sourceJobId}:{}),...(row.officialUrl?{officialUrl:row.officialUrl}:{})};
}
/** The exact archived bodies and every raw row remain unchanged. Only the
 * adapter-facing payload and valid set are projected. No new requests. */
export function projectKelunMainlandFetch(plan: SourceCrawlPlan, result: SourceFetchResult): SourceFetchResult {
  if (plan.source.id !== "source-kelun-social" || !result.ok) return result;
  const hold = (failureReason: string, fetchEvidence = result.fetchEvidence): SourceFetchResult => ({
    ok: false, capturedAt: result.capturedAt, failureReason,
    ...(fetchEvidence ? { fetchEvidence } : {})
  });
  try {
    if (!exactKelunMainlandPlan(plan) || !result.fetchEvidence || !("html" in result)) return hold("KELUN_SCOPE_BINDING_INVALID");
    const original = parsePersistentSourceFetchEvidence(result.fetchEvidence);
    if (original.fetchLosses.length || original.fetchCounts.rawCount !== original.fetchCounts.validCount ||
      original.fetchCounts.parseDiscardCount || original.fetchCounts.validationDiscardCount) return hold("KELUN_SCOPE_ORIGINAL_LOSS");
    const rows = inspectKelunScopeRows(plan, original), counts = kelunScopeCounts(rows);
    if (!rows.length) return hold("KELUN_OFFICIAL_ZERO_UNPROVEN");
    const projected = structuredClone(original);
    for (const page of projected.pages) page.validJobIds = rows.filter(row => row.pageSequence === page.sequence && row.decision === "MAINLAND").map(row => row.rawId);
    projected.fetchCounts.validCount = counts.mainlandCount;
    projected.fetchCounts.validationDiscardCount = counts.outsideCount + counts.unknownCount;
    projected.fetchLosses = rows.filter(row => row.decision !== "MAINLAND").map(row =>
      row.decision==='UNKNOWN'?jobQuarantineLoss(kelunJobQuarantine(row),projected.artifacts.find(a=>a.logicalKey===row.artifactLogicalKey)!.capturedAt):kelunScopeLoss(row, projected.artifacts.find(a => a.logicalKey === row.artifactLogicalKey)!.capturedAt));
    if(counts.unknownCount)projected.jobQuarantines=rows.filter(row=>row.decision==='UNKNOWN').map(kelunJobQuarantine);
    const options = { expectedChannelIds: [], filteredOutput: true, allowMissingReturnedPage: true,...JOB_QUARANTINE_PAGINATION };
    const evidence = deriveCanonicalPaginationEvidence({ evidence: projected, ...options });
    return { ...result, html: `<table class="jobsTable">${rows.filter(row => row.decision === "MAINLAND").map(row => row.rawHtml).join("\n")}</table>`,
      fetchEvidence: evidence, paginationEvaluation: evaluatePaginationEvidence({ evidence, ...options }) };
  } catch { return hold("KELUN_SCOPE_REPLAY_REQUIRED"); }
}
/** Strict replay derives both exhaustive sets from archived originals. The
 * lossless evidence view is only for the unchanged generic HTML page gate. */
export function replayKelunMainlandScope(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence,
  jobs?: readonly NormalizedJobRecord[]): { rawEvidence: PersistentSourceFetchEvidence; rows: KelunScopeRow[] } | undefined {
  try {
    const rows = inspectKelunScopeRows(plan, evidence), counts = kelunScopeCounts(rows);
    if (!rows.length || evidence.fetchCounts.parseDiscardCount !== 0 ||
      evidence.fetchCounts.validCount !== counts.mainlandCount || evidence.fetchCounts.validationDiscardCount !== counts.outsideCount+counts.unknownCount) return;
    const quarantines=rows.filter(row=>row.decision==='UNKNOWN').map(kelunJobQuarantine);
    if(!isDeepStrictEqual(evidence.jobQuarantines??[],quarantines)||quarantines.length&&!jobQuarantineLossesMatch(evidence))return;
    const expectedLosses = rows.filter(row => row.decision !== "MAINLAND").map(row =>
      row.decision==='UNKNOWN'?jobQuarantineLoss(kelunJobQuarantine(row),evidence.artifacts.find(a=>a.logicalKey===row.artifactLogicalKey)!.capturedAt):kelunScopeLoss(row, evidence.artifacts.find(a => a.logicalKey === row.artifactLogicalKey)!.capturedAt));
    if (!isDeepStrictEqual(evidence.fetchLosses,expectedLosses)) return;
    for (const page of evidence.pages) if (JSON.stringify(page.validJobIds) !== JSON.stringify(rows.filter(row =>
      row.pageSequence === page.sequence && row.decision === "MAINLAND").map(row => row.rawId))) return;
    const mainland = rows.filter(row => row.decision === "MAINLAND");
    if (jobs !== undefined && (jobs.length !== mainland.length || jobs.some((job, index) => {
      const row = mainland[index]!;
      return job.companyId !== plan.company.id || job.sourceId !== plan.source.id || job.sourceJobId !== row.sourceJobId ||
        job.officialUrl !== row.officialUrl || job.officialTitle !== row.title || job.locationRaw !== row.locationRaw ||
        JSON.stringify(job.cities) !== JSON.stringify(mainlandDisplayCities([row.locationRaw.replaceAll("-", "·")]));
    }))) return;
    const rawEvidence = structuredClone(evidence);
    rawEvidence.fetchCounts.validCount = counts.rawCount; rawEvidence.fetchCounts.validationDiscardCount = 0;
    rawEvidence.fetchLosses = [];delete rawEvidence.jobQuarantines;
    rawEvidence.pages.forEach(page => { page.validJobIds = [...page.rawJobIds]; });
    return { rawEvidence, rows };
  } catch { return; }
}
