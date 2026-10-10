import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { load } from "cheerio";
import type { OfficialJsonRenderedPageCapture, OfficialJsonRenderedReplay } from "./officialJsonRenderedTraversalValidator";
import { createDefaultMokaHttpClient, type MokaHttpClient } from "./mokaSourceFetch";
import { bayerIndependentDetailScope, BAYER_MOKA_DETAIL, BAYER_MOKA_ENTRY, decryptBayerArtifact } from "./bayerMokaScope";

export const BAYER_HYBRID_RETRIEVAL_PATH = "CUA_DOM_LIST_PLUS_INDEPENDENT_HTTP_DETAILS";
export interface BayerDomRow { href: string; titleHtml: string; publishedHtml: string }
export interface BayerDomPage {
  url: string; capturedAt: string; summaryText: string; pageNumber: number; pageSize: number;
  nextDisabled: boolean; selectedDivisions: string[]; paginationHtml: string; rows: BayerDomRow[];
}
export interface BayerDomCapture { schemaVersion: "bayer-cua-dom-list-v1"; observedAt: string; pages: BayerDomPage[] }
interface HttpReceipt { method: "GET" | "POST"; url: string; requestBody?: Record<string, unknown>; finalUrl: string;
  status: number; body: string; bodySha256: string; capturedAt: string }

/** The DOM enumerates the set. Fresh, separately requested HTTP details establish status; no main capture is accepted. */
export async function captureBayerIndependentDetails(input: {
  dom: BayerDomCapture; http?: MokaHttpClient; now?: () => Date;
  onReceipt?: (receipt: HttpReceipt, sequence: number) => Promise<void>;
}): Promise<{ observedAt: string; pages: OfficialJsonRenderedPageCapture[] }> {
  const now = input.now ?? (() => new Date()), http = input.http ?? createDefaultMokaHttpClient(now);
  const total = validateDomCapture(input.dom);
  if (Date.parse(input.dom.observedAt) > now().getTime() || now().getTime() - Date.parse(input.dom.observedAt) > 60 * 60_000) {
    throw new Error("Bayer independent DOM capture is not from the current one-hour run");
  }
  let sequence = 0;
  const request = async (url: string, body?: Record<string, unknown>): Promise<HttpReceipt> => {
    const method = body ? "POST" : "GET";
    const response = await http({ url, method, ...(body ? { body, headers: { "Content-Type": "application/json;charset=UTF-8",
      Origin: "https://app.mokahr.com", Referer: BAYER_MOKA_ENTRY.split("#")[0]! } } : {}) });
    const receipt: HttpReceipt = { method, url, ...(body ? { requestBody: body } : {}), status: response.status,
      finalUrl: response.finalUrl ?? "", body: response.body, bodySha256: hash(response.body), capturedAt: response.capturedAt ?? "" };
    await input.onReceipt?.(receipt, sequence++);
    validateReceipt(receipt, url, input.dom.observedAt, body);
    return receipt;
  };
  const entry = await request(BAYER_MOKA_ENTRY.split("#")[0]!);
  const iv = entryIv(entry);
  const pages: OfficialJsonRenderedPageCapture[] = [];
  let first = true;
  for (const captured of input.dom.pages) {
    const { rows, ...domPage } = captured;
    const rawRows: OfficialJsonRenderedPageCapture["rawRows"][number][] = [];
    for (let recordIndex = 0; recordIndex < rows.length; recordIndex++) {
      const domRow = rows[recordIndex]!, identity = domIdentity(domRow);
      const detailResponse = await request(BAYER_MOKA_DETAIL, { orgId: "bayer", siteId: "148387", jobId: identity.id, locale: "zh-CN" });
      const root = decryptBayerArtifact(detailResponse, iv), detail = record(root.data);
      if (root.success !== true || !detail) throw new Error("Bayer independent HTTP detail failed");
      const scope = bayerIndependentDetailScope(identity, detail), sourceJobId = evidenceId(identity.id);
      if (String(detail.publishedAt).slice(0, 10) !== identity.publishedDate) throw new Error("Bayer independent DOM/detail date mismatch");
      rawRows.push({ sourceJobId, rawEvidenceId: sourceJobId, recordIndex, scopeMarker: String(detail.status),
        scopeDecision: scope.paused ? "EXCLUDED_AUDITED" : "INCLUDED_MAINLAND",
        rawPayload: { captureMethod: BAYER_HYBRID_RETRIEVAL_PATH, domPage, domRow, detailResponse,
          ...(first ? { entry } : {}), entrySha256: entry.bodySha256 } });
      first = false;
    }
    pages.push({ channelId: "source:source-bayer-healthcare-social:default", pageNumber: captured.pageNumber,
      declaredTotalPages: input.dom.pages.length, declaredTotalJobs: total, uiRequestCandidateIds: [], rawRows,
      nextControlPresent: !captured.nextDisabled });
  }
  replayBayerHybridTraversal(pages);
  return { observedAt: bayerHybridObservedAt(pages), pages };
}

export function replayBayerHybridTraversal(pages: readonly OfficialJsonRenderedPageCapture[]): OfficialJsonRenderedReplay {
  const entry = pages[0]?.rawRows[0]?.rawPayload.entry as HttpReceipt | undefined;
  if (!entry || pages.length < 1 || pages.length > 100) throw new Error("Bayer independent entry or pages are missing");
  const observedAt = bayerHybridObservedAt(pages);
  // Every row binds this same original entry; validate and parse it once per replay.
  validateReceipt(entry, BAYER_MOKA_ENTRY.split("#")[0]!, observedAt);
  const iv = entryIv(entry);
  const domPages: BayerDomPage[] = [];
  const rawSourceJobIds: string[] = [], matchKeys: string[] = [], excludedSourceJobIds: string[] = [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index]!;
    const first = page.rawRows[0]?.rawPayload.domPage as Omit<BayerDomPage, "rows"> | undefined;
    if (!first || page.pageNumber !== index + 1 || page.declaredTotalPages !== pages.length || page.uiRequestCandidateIds.length ||
        page.nextControlPresent !== (index < pages.length - 1) || page.channelId !== "source:source-bayer-healthcare-social:default") {
      throw new Error("Bayer independent page contract mismatch");
    }
    const rows: BayerDomRow[] = [];
    for (let recordIndex = 0; recordIndex < page.rawRows.length; recordIndex++) {
      const row = page.rawRows[recordIndex]!, payload = row.rawPayload;
      if (payload.captureMethod !== BAYER_HYBRID_RETRIEVAL_PATH || payload.entrySha256 !== entry.bodySha256 ||
          row.recordIndex !== recordIndex || !isDeepStrictEqual(payload.domPage, first) ||
          (index !== 0 || recordIndex !== 0) && payload.entry !== undefined) throw new Error("Bayer independent row provenance mismatch");
      const domRow = payload.domRow as BayerDomRow, identity = domIdentity(domRow), receipt = payload.detailResponse as HttpReceipt;
      validateReceipt(receipt, BAYER_MOKA_DETAIL, entry.capturedAt,
        { orgId: "bayer", siteId: "148387", jobId: identity.id, locale: "zh-CN" });
      const root = decryptBayerArtifact(receipt, iv), detail = record(root.data);
      if (root.success !== true || !detail) throw new Error("Bayer independent detail envelope mismatch");
      const scope = bayerIndependentDetailScope(identity, detail), id = evidenceId(identity.id);
      if (String(detail.publishedAt).slice(0, 10) !== identity.publishedDate || row.sourceJobId !== id || row.rawEvidenceId !== id ||
          row.scopeMarker !== detail.status || row.scopeDecision !== (scope.paused ? "EXCLUDED_AUDITED" : "INCLUDED_MAINLAND")) {
        throw new Error("Bayer independent raw/status/date commitment mismatch");
      }
      rows.push(domRow); rawSourceJobIds.push(id);
      (scope.paused ? excludedSourceJobIds : matchKeys).push(id);
    }
    domPages.push({ ...first, rows });
  }
  const total = validateDomCapture({ schemaVersion: "bayer-cua-dom-list-v1", observedAt, pages: domPages });
  if (Date.parse(bayerHybridFinishedAt(pages)) - Date.parse(observedAt) > 60 * 60_000) throw new Error("Bayer independent capture exceeds one hour");
  if (pages.some(p => p.declaredTotalJobs !== total) || total !== rawSourceJobIds.length || new Set(rawSourceJobIds).size !== total) {
    throw new Error("Bayer independent raw sets do not reconcile");
  }
  const canonical = (values: string[]) => values.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return { matchKeys: canonical(matchKeys), rawSourceJobIds: canonical(rawSourceJobIds), rawEvidenceIds: canonical([...rawSourceJobIds]),
    excludedSourceJobIds: canonical(excludedSourceJobIds), rawCount: total, excludedCount: excludedSourceJobIds.length };
}

export function bayerHybridObservedAt(pages: readonly OfficialJsonRenderedPageCapture[]): string {
  const time = (pages[0]?.rawRows[0]?.rawPayload.domPage as BayerDomPage | undefined)?.capturedAt;
  if (!time || !validTime(time)) throw new Error("Bayer independent first DOM capture time is missing");
  return time;
}
export function bayerHybridFinishedAt(pages: readonly OfficialJsonRenderedPageCapture[]): string {
  const times = pages.flatMap(p => p.rawRows.map(r => (r.rawPayload.detailResponse as HttpReceipt)?.capturedAt));
  if (!times.length || times.some(t => !validTime(t))) throw new Error("Bayer independent completion time is missing");
  return times.sort().at(-1)!;
}

export function validateDomCapture(capture: BayerDomCapture): number {
  if (capture.schemaVersion !== "bayer-cua-dom-list-v1" || !validTime(capture.observedAt) || !Array.isArray(capture.pages) || !capture.pages.length || capture.observedAt !== capture.pages[0]?.capturedAt) {
    throw new Error("Bayer independent DOM capture is missing");
  }
  let total: number | undefined; const ids = new Set<string>();
  for (let index = 0; index < capture.pages.length; index++) {
    const p = capture.pages[index]!, u = new URL(p.url), params = new URLSearchParams(u.hash.split("?")[1]);
    const summary = /已选\s*1\s*条件\s*\|\s*(\d+)\s*结果/u.exec(p.summaryText.replace(/\s+/gu, " "));
    const n = summary ? Number(summary[1]) : NaN;
    total ??= n;
    const allowed = ["283170[0]", "283170[1]", "page", "pageSize", "anchorName"];
    if (u.origin !== "https://app.mokahr.com" || u.pathname !== "/social-recruitment/bayer/148387" || u.search !== "?locale=zh-CN" ||
        !u.hash.startsWith("#/jobs?") || params.get("283170[0]") !== "Pharmaceuticals" || params.get("283170[1]") !== "Consumer Health" ||
        [...params.keys()].some(k => !allowed.includes(k)) || new Set(params.keys()).size !== [...params.keys()].length || params.get("page") !== String(index + 1) ||
        (params.has("pageSize") && params.get("pageSize") !== "30") || (params.has("anchorName") && params.get("anchorName") !== "jobsList") ||
        !isDeepStrictEqual(p.selectedDivisions, ["Pharmaceuticals", "Consumer Health"]) || !validTime(p.capturedAt) ||
        Date.parse(p.capturedAt) < Date.parse(capture.observedAt) || !Number.isSafeInteger(n) || n < 1 || n !== total ||
        p.pageNumber !== index + 1 || p.pageSize !== 30 || p.nextDisabled !== (index === capture.pages.length - 1) ||
        !Array.isArray(p.rows) || p.rows.length !== Math.min(30, total - index * 30)) throw new Error("Bayer independent DOM scope/pagination mismatch");
    const $ = load(p.paginationHtml), next = $('button[class*="Pagination-forward"]'), active = $('button[class*="Pagination-is-active"]');
    if (next.length !== 1 || next.is("[disabled]") !== p.nextDisabled || active.length !== 1 || active.text().trim() !== String(p.pageNumber)) {
      throw new Error("Bayer independent DOM terminal control mismatch");
    }
    for (const row of p.rows) { const id = domIdentity(row).id; if (ids.has(id)) throw new Error("Bayer independent DOM duplicate ID"); ids.add(id); }
  }
  if (ids.size !== total || capture.pages.length !== Math.ceil(total! / 30)) throw new Error("Bayer independent DOM total mismatch");
  return total!;
}
function domIdentity(row: BayerDomRow): { id: string; title: string; publishedDate: string } {
  if (!row || typeof row.href !== "string" || typeof row.titleHtml !== "string" || typeof row.publishedHtml !== "string") throw new Error("Bayer DOM row is missing");
  const id = /^#\/job\/([0-9a-f-]{36})$/u.exec(row.href)?.[1], title = load(row.titleHtml).text().replace(/\s+/gu, " ").trim();
  const publishedDate = /^发布于\s*(\d{4}-\d{2}-\d{2})$/u.exec(load(row.publishedHtml).text().trim())?.[1];
  if (!id || !title || !publishedDate) throw new Error("Bayer DOM row identity/date is invalid");
  return { id, title, publishedDate };
}
function entryIv(entry: HttpReceipt): string {
  const init = JSON.parse(load(entry.body)("#init-data").attr("value") ?? "null");
  if (init?.org?.id !== "bayer" || String(init.siteId ?? init.org.siteId) !== "148387" || init.mode !== "social" || typeof init.aesIv !== "string") {
    throw new Error("Bayer independent HTTP bootstrap identity mismatch");
  }
  return init.aesIv;
}
function validateReceipt(receipt: HttpReceipt, url: string, after: string, body?: Record<string, unknown>): void {
  if (!receipt || receipt.method !== (body ? "POST" : "GET") || receipt.url !== url || receipt.finalUrl !== url || receipt.status !== 200 ||
      !isDeepStrictEqual(receipt.requestBody, body) || typeof receipt.body !== "string" || receipt.bodySha256 !== hash(receipt.body) ||
      !validTime(receipt.capturedAt) || Date.parse(receipt.capturedAt) < Date.parse(after) ||
      Date.parse(receipt.capturedAt) - Date.parse(after) > 60 * 60_000) throw new Error("Bayer independent HTTP original receipt mismatch");
}
function hash(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function evidenceId(id: string): string { return `sha256:${hash(JSON.stringify(id))}`; }
function validTime(s: string): boolean { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)); }
function record(v: unknown): Record<string, unknown> | undefined { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined; }
