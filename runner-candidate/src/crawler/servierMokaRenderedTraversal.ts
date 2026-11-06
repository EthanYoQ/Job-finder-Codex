import { currentOfficialSourceAttemptSignal } from './officialHttpRuntimeLimits';
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { load } from "cheerio";
import type { OfficialJsonRenderedPageCapture, OfficialJsonRenderedReplay } from "./officialJsonRenderedTraversalValidator";
import { createDefaultMokaHttpClient, type MokaHttpClient } from "./mokaSourceFetch";
import { decodeServierArtifact, servierIndependentDetailScope, SERVIER_MOKA_CAMPAIGN, SERVIER_MOKA_DETAIL, SERVIER_MOKA_ENTRY } from "./servierMokaScope";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export const SERVIER_HYBRID_RETRIEVAL_PATH = "CUA_DOM_LIST_PLUS_INDEPENDENT_HTTP_DETAILS";
const CHANNEL_ID = "source:source-servier-china-social:default";
const RUN_WINDOW_MS = 60 * 60_000;
export interface ServierDomRow { href: string; titleHtml: string; publishedHtml: string }
export interface ServierDomPage {
  url: string; capturedAt: string; summaryText: string; pageNumber: number; pageSize: number;
  nextDisabled: boolean; selectedFilters: string[]; paginationHtml: string; rows: ServierDomRow[];
}
export interface ServierDomCapture { schemaVersion: "servier-cua-dom-list-v1"; observedAt: string; pages: ServierDomPage[] }
interface HttpReceipt {
  method: "GET" | "POST"; url: string; requestBody?: Record<string, unknown>; finalUrl: string;
  status: number; body: string; bodySha256: string; capturedAt: string;
}

/** The native, unfiltered DOM enumerates the set; separate fresh HTTP details prove each row's scope and open state. */
export async function captureServierIndependentDetails(input: {
  dom: ServierDomCapture; http?: MokaHttpClient; now?: () => Date; signal?:AbortSignal;
  onReceipt?: (receipt: HttpReceipt, sequence: number) => Promise<void>;
}): Promise<{ observedAt: string; pages: OfficialJsonRenderedPageCapture[] }> {
  const now = input.now ?? (() => new Date()), http = input.http ?? createDefaultMokaHttpClient(now);
  const total = validateServierDomCapture(input.dom), startedAt = now().getTime();
  const lastDomTime = input.dom.pages.at(-1)!.capturedAt;
  if (!Number.isFinite(startedAt) || Date.parse(lastDomTime) > startedAt || startedAt - Date.parse(input.dom.observedAt) > RUN_WINDOW_MS) {
    throw new Error("Servier independent DOM capture is not from the current one-hour run");
  }
  let sequence = 0;
  const request = async (url: string, body?: Record<string, unknown>): Promise<HttpReceipt> => {
    input.signal?.throwIfAborted();currentOfficialSourceAttemptSignal()?.throwIfAborted();
    const method = body ? "POST" : "GET";
    let response;
    try{response=await http({ url, method, ...(body ? { body, headers: {
      "Content-Type": "application/json;charset=UTF-8", Origin: "https://app.mokahr.com", Referer: SERVIER_MOKA_ENTRY.split("#")[0]!
    } } : {}) });}catch(error){throw Object.assign(error instanceof Error?error:Error("Independent HTTP transport failed"),{independentTransportFailure:true});}
    input.signal?.throwIfAborted();currentOfficialSourceAttemptSignal()?.throwIfAborted();
    const receipt: HttpReceipt = { method, url, ...(body ? { requestBody: body } : {}), status: response.status,
      finalUrl: response.finalUrl ?? "", body: response.body, bodySha256: hash(response.body), capturedAt: response.capturedAt ?? now().toISOString() };
    await input.onReceipt?.(receipt, sequence++);
    input.signal?.throwIfAborted();currentOfficialSourceAttemptSignal()?.throwIfAborted();
    return receipt;
  };
  const entry = await request(SERVIER_MOKA_ENTRY.split("#")[0]!);
  validateReceipt(entry,SERVIER_MOKA_ENTRY.split("#")[0]!,input.dom.observedAt,lastDomTime);
  const iv=entryIv(entry);
  const pages: OfficialJsonRenderedPageCapture[] = [];
  let first = true;
  for (const captured of input.dom.pages) {
    const { rows, ...domPage } = captured;
    const rawRows: OfficialJsonRenderedPageCapture["rawRows"][number][] = [];
    for (let recordIndex = 0; recordIndex < rows.length; recordIndex++) {
      const domRow = rows[recordIndex]!, identity = domIdentity(domRow,captured.pageNumber-1,recordIndex);
      let detailResponse:HttpReceipt|undefined,detailUnavailable:{code:'CAPTURE_FAILED';capturedAt:string}|undefined;
      try{if(identity.known)detailResponse=await request(SERVIER_MOKA_DETAIL,detailRequest(identity.id));}
      catch(error){input.signal?.throwIfAborted();currentOfficialSourceAttemptSignal()?.throwIfAborted();if(!(error as {independentTransportFailure?:boolean})?.independentTransportFailure)throw error;detailUnavailable={code:'CAPTURE_FAILED',capturedAt:now().toISOString()};}
      if(!identity.known)detailUnavailable={code:'CAPTURE_FAILED',capturedAt:now().toISOString()};
      // A website access restriction stops this source; do not send the next request.
      if(detailResponse&&[403,429].includes(detailResponse.status))throw Error('Servier independent access restricted');
      const outcome=projectDetail(identity,detailResponse,detailUnavailable,iv,input.dom.observedAt);
      const sourceJobId=evidenceId(identity.id);
      rawRows.push({sourceJobId,rawEvidenceId:sourceJobId,recordIndex,scopeMarker:outcome.marker,scopeDecision:outcome.decision,
        rawPayload:{captureMethod:SERVIER_HYBRID_RETRIEVAL_PATH,domPage,domRow,...(detailResponse?{detailResponse}:{detailUnavailable}),
          ...(first?{entry}:{}),entrySha256:entry.bodySha256}});
      first = false;
    }
    pages.push({ channelId: CHANNEL_ID, pageNumber: captured.pageNumber, declaredTotalPages: input.dom.pages.length,
      declaredTotalJobs: total, uiRequestCandidateIds: [], rawRows, nextControlPresent: !captured.nextDisabled });
  }
  replayServierHybridTraversal(pages);
  return { observedAt: servierHybridObservedAt(pages), pages };
}

/** Replays original bodies and timestamps. EXCLUDED_AUDITED here only means absent from the positively verified China set. */
export function replayServierHybridTraversal(pages: readonly OfficialJsonRenderedPageCapture[]): OfficialJsonRenderedReplay {
  const entry = pages[0]?.rawRows[0]?.rawPayload.entry as HttpReceipt | undefined;
  if (!entry || pages.length < 1 || pages.length > 100) throw new Error("Servier independent entry or pages are missing");
  const observedAt = servierHybridObservedAt(pages), domPages: ServierDomPage[] = [];
  validateReceipt(entry, SERVIER_MOKA_ENTRY.split("#")[0]!, observedAt, observedAt);
  const iv = entryIv(entry);
  const rawSourceJobIds: string[] = [], matchKeys: string[] = [], excludedSourceJobIds: string[] = [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    const first = page.rawRows[0]?.rawPayload.domPage as Omit<ServierDomPage, "rows"> | undefined;
    if (!first || page.pageNumber !== index + 1 || page.declaredTotalPages !== pages.length || page.uiRequestCandidateIds.length ||
        page.nextControlPresent !== (index < pages.length - 1) || page.channelId !== CHANNEL_ID) {
      throw new Error("Servier independent page contract mismatch");
    }
    const rows: ServierDomRow[] = [];
    for (let recordIndex = 0; recordIndex < page.rawRows.length; recordIndex++) {
      const row = page.rawRows[recordIndex]!, payload = row.rawPayload;
      if (payload.captureMethod !== SERVIER_HYBRID_RETRIEVAL_PATH || payload.entrySha256 !== entry.bodySha256 ||
          row.recordIndex !== recordIndex || !isDeepStrictEqual(payload.domPage, first) ||
          (index !== 0 || recordIndex !== 0) && payload.entry !== undefined) throw new Error("Servier independent row provenance mismatch");
      const domRow=payload.domRow as ServierDomRow,identity=domIdentity(domRow,index,recordIndex),id=evidenceId(identity.id);
      const outcome=projectDetail(identity,payload.detailResponse as HttpReceipt|undefined,payload.detailUnavailable as {code:string;capturedAt:string}|undefined,iv,observedAt!);
      if(row.sourceJobId!==id||row.rawEvidenceId!==id||row.scopeMarker!==outcome.marker||row.scopeDecision!==outcome.decision)
        throw Error('Servier independent row outcome mismatch');
      rows.push(domRow);rawSourceJobIds.push(id);
      (outcome.decision==='INCLUDED_MAINLAND'?matchKeys:excludedSourceJobIds).push(id);
    }
    domPages.push({ ...first, rows });
  }
  const total = validateServierDomCapture({ schemaVersion: "servier-cua-dom-list-v1", observedAt, pages: domPages });
  if (Date.parse(entry.capturedAt) < Date.parse(domPages.at(-1)!.capturedAt) ||
      Date.parse(servierHybridFinishedAt(pages)) - Date.parse(observedAt) > RUN_WINDOW_MS) {
    throw new Error("Servier independent DOM and HTTP receipts do not bind to one run");
  }
  if (pages.some(p => p.declaredTotalJobs !== total) || total !== rawSourceJobIds.length || new Set(rawSourceJobIds).size !== total ||
      matchKeys.length + excludedSourceJobIds.length !== total) throw new Error("Servier independent raw sets do not reconcile");
  const canonical = (values: string[]) => values.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return { matchKeys: canonical(matchKeys), rawSourceJobIds: canonical(rawSourceJobIds), rawEvidenceIds: canonical([...rawSourceJobIds]),
    excludedSourceJobIds: canonical(excludedSourceJobIds), rawCount: total, excludedCount: excludedSourceJobIds.length };
}

export function servierHybridObservedAt(pages: readonly OfficialJsonRenderedPageCapture[]): string {
  const time = (pages[0]?.rawRows[0]?.rawPayload.domPage as ServierDomPage | undefined)?.capturedAt;
  if (!time || !validTime(time)) throw new Error("Servier independent first DOM capture time is missing");
  return time;
}
export function servierHybridFinishedAt(pages: readonly OfficialJsonRenderedPageCapture[]): string {
  const times = pages.flatMap(p => p.rawRows.map(r => (r.rawPayload.detailResponse as HttpReceipt)?.capturedAt ?? (r.rawPayload.detailUnavailable as {capturedAt?:string}|undefined)?.capturedAt));
  if (!times.length || times.some(t => !validTime(t))) throw new Error("Servier independent completion time is missing");
  return times.sort().at(-1)!;
}

export function validateServierDomCapture(capture: ServierDomCapture): number {
  if (!capture || capture.schemaVersion !== "servier-cua-dom-list-v1" || !validTime(capture.observedAt) ||
      !Array.isArray(capture.pages) || !capture.pages.length || capture.pages.length > 100 || capture.observedAt !== capture.pages[0]?.capturedAt) {
    throw new Error("Servier independent DOM capture is missing");
  }
  let total: number | undefined, previousAt = capture.observedAt;
  const ids = new Set<string>();
  for (let index = 0; index < capture.pages.length; index++) {
    const p = capture.pages[index]!, u = new URL(p.url), params = new URLSearchParams(u.hash.split("?")[1]);
    const summary = /^已选\s*0\s*条件\s*\|\s*(\d+)\s*结果$/u.exec(p.summaryText.replace(/\s+/gu, " ").trim());
    const n = summary ? Number(summary[1]) : NaN;
    total ??= n;
    const allowed = ["page", "pageSize", "anchorName", "keyword"];
    if (`${u.origin}${u.pathname}` !== SERVIER_MOKA_CAMPAIGN || u.username || u.password ||
        !["", "?locale=zh-CN"].includes(u.search) || !/^#\/jobs(?:\?[^?]*)?$/u.test(u.hash) ||
        [...params.keys()].some(k => !allowed.includes(k)) || new Set(params.keys()).size !== [...params.keys()].length ||
        (params.get("page") ?? (index === 0 ? "1" : "")) !== String(index + 1) ||
        (params.has("keyword") && params.get("keyword") !== "") ||
        (params.has("pageSize") && params.get("pageSize") !== "30") || (params.has("anchorName") && params.get("anchorName") !== "jobsList") ||
        !isDeepStrictEqual(p.selectedFilters, []) || !validTime(p.capturedAt) || Date.parse(p.capturedAt) < Date.parse(previousAt) ||
        Date.parse(p.capturedAt) - Date.parse(capture.observedAt) > RUN_WINDOW_MS || !Number.isSafeInteger(n) || n < 1 || n !== total ||
        p.pageNumber !== index + 1 || p.pageSize !== 30 || p.nextDisabled !== (index === capture.pages.length - 1) ||
        !Array.isArray(p.rows) || p.rows.length !== Math.min(30, total - index * 30) || typeof p.paginationHtml !== "string") {
      throw new Error("Servier independent DOM scope/pagination mismatch");
    }
    previousAt = p.capturedAt;
    const $ = load(p.paginationHtml), next = $('button[class*="Pagination-forward"]'), active = $('button[class*="Pagination-is-active"]');
    if (next.length !== 1 || next.is("[disabled]") !== p.nextDisabled || active.length !== 1 || active.text().trim() !== String(p.pageNumber)) {
      throw new Error("Servier independent DOM terminal control mismatch");
    }
    for (const [recordIndex,row] of p.rows.entries()) { const id = domIdentity(row,index,recordIndex).id; if (ids.has(id)) throw new Error("Servier independent DOM duplicate ID"); ids.add(id); }
  }
  if (ids.size !== total || capture.pages.length !== Math.ceil(total! / 30)) throw new Error("Servier independent DOM total mismatch");
  return total!;
}

function domIdentity(row:ServierDomRow,pageSequence:number,recordIndex:number):{id:string;known:boolean}{
 const id=typeof row?.href==='string'?/^#\/job\/([0-9a-f-]{36})$/u.exec(row.href)?.[1]:undefined;
 return {id:id??`unidentified:${hash(JSON.stringify([pageSequence,recordIndex,row]))}`,known:!!id};
}
function projectDetail(identity:{id:string;known:boolean},receipt:HttpReceipt|undefined,unavailable:{code:string;capturedAt:string}|undefined,iv:string,observedAt:string):{marker:string;decision:'INCLUDED_MAINLAND'|'EXCLUDED_AUDITED'}{
 if(!receipt){if(unavailable?.code!=='CAPTURE_FAILED'||!validTime(unavailable.capturedAt)||Date.parse(unavailable.capturedAt)<Date.parse(observedAt))throw Error('Servier independent unavailable capture invalid');return {marker:identity.known?'UNKNOWN_JOB':'UNKNOWN_IDENTITY',decision:'EXCLUDED_AUDITED'};}
 if(unavailable)throw Error('Servier independent duplicate detail outcome');
 try{
  validateReceipt(receipt,SERVIER_MOKA_DETAIL,observedAt,observedAt,detailRequest(identity.id));
  const detail=detailData(receipt,iv),scope=servierIndependentDetailScope({id:identity.id,title:String(detail.title??'')},detail);
  return {marker:scope.unknownGeography?'UNKNOWN_GEOGRAPHY':String(detail.status),decision:scope.unknownGeography?'EXCLUDED_AUDITED':'INCLUDED_MAINLAND'};
 }catch{return {marker:'UNKNOWN_JOB',decision:'EXCLUDED_AUDITED'};}
}
function entryIv(entry: HttpReceipt): string {
  const nodes = load(entry.body)("#init-data"), text = nodes.attr("value") ?? "null";
  if (nodes.length !== 1 || !hasUniqueJsonObjectKeys(text)) throw new Error("Servier independent HTTP bootstrap is ambiguous");
  const init = JSON.parse(text);
  if (init?.org?.id !== "shiweiya" || String(init.siteId ?? init.org.siteId) !== "47734" ||
      init.org.siteId !== undefined && String(init.org.siteId) !== "47734" || init.mode !== "social" ||
      typeof init.aesIv !== "string" || Buffer.byteLength(init.aesIv) !== 16) throw new Error("Servier independent HTTP bootstrap identity mismatch");
  return init.aesIv;
}
function detailData(receipt: HttpReceipt, iv: string): Record<string, unknown> {
  const root = decodeServierArtifact(receipt, iv);
  const detail = record(root?.data);
  if (root?.success !== true || !detail) throw new Error("Servier independent detail envelope mismatch");
  return detail;
}
function detailRequest(id: string): Record<string, unknown> { return { orgId: "shiweiya", siteId: "47734", jobId: id, locale: "zh-CN" }; }
function validateReceipt(receipt: HttpReceipt, url: string, observedAt: string, after: string, body?: Record<string, unknown>): void {
  if (!receipt || receipt.method !== (body ? "POST" : "GET") || receipt.url !== url || receipt.finalUrl !== url || receipt.status !== 200 ||
      !isDeepStrictEqual(receipt.requestBody, body) || typeof receipt.body !== "string" || receipt.bodySha256 !== hash(receipt.body) ||
      !validTime(receipt.capturedAt) || Date.parse(receipt.capturedAt) < Date.parse(after) ||
      Date.parse(receipt.capturedAt) - Date.parse(observedAt) > RUN_WINDOW_MS) throw new Error("Servier independent HTTP original receipt mismatch");
}
function hash(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function evidenceId(id: string): string { return `sha256:${hash(JSON.stringify(id))}`; }
function validTime(s: string): boolean {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) &&
    Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
}
function record(v: unknown): Record<string, unknown> | undefined { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined; }
