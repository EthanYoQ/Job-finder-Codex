import { hasExactFosunMainlandGeography, mainlandDisplayCities } from "./fosunScopeGeography";
import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { reviewedMainlandCityLabel } from "./reviewedMainlandCity";
import { CITY_PENDING } from "../domain/jobLocation";
import { createHash } from "node:crypto";
import type { NormalizedJobRecord } from "./normalizedJob";
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { BI_API_URL, BI_DETAIL_URL, BI_ENTRY_URL, BI_SCRIPT_URL, BI_UI_RECONSTRUCTION_POLICY, replayBiUiSemanticContract } from "./biUiSemanticContract";

const SOURCE = "source-boehringer-ingelheim-china-social";
const COMPANY = "company-boehringer-ingelheim-china";
const CHAIN = "https://www.boehringer-ingelheim.cn/careers/jobs";
const API_LOCATOR = "51job-coapi-v1|jsonp:$.resultbody.joblist|total:$.resultbody.totalnum|ui:sxsPosCode";
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

export function biDisplayCities(raw: Record<string, unknown>): string[] {
  if (raw.workareaname !== undefined && raw.workareaname !== raw.jobareaname ||
    raw.eworkareaname !== undefined && raw.eworkareaname !== raw.ejobareaname) return [CITY_PENDING];
  const cities=mainlandDisplayCities([String(raw.jobareaname)]);
  const english=reviewedMainlandCityLabel(String(raw.ejobareaname),"China");
  return cities.length===1 && cities[0]===english ? cities : [CITY_PENDING];
}

export interface BiSemanticReplay {
  policyId: typeof BI_UI_RECONSTRUCTION_POLICY;
  rawCount: number;
  includedCount: number;
  excludedRecordIndexes: number[];
}

export function hasBiSemanticPlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.executionAuthority !== "STAGED" ||
      plan.company.id !== COMPANY || plan.source.companyId !== COMPANY || plan.source.id !== SOURCE ||
      plan.source.kind !== "SOCIAL" || plan.source.atsKind !== "OFFICIAL_JSON" ||
      plan.source.officialEntryUrl !== BI_ENTRY_URL || plan.source.officialChainEvidenceUrl !== CHAIN) return false;
  const config = plan.officialJsonFetch;
  return !!config && exactKeys(config, ["kind", "ctmid", "uiScriptUrl", "detailBaseUrl", "pageSize"]) &&
    config.kind === "51job-coapi" && config.ctmid === "3479" && config.pageSize === 500 &&
    config.uiScriptUrl === BI_SCRIPT_URL && config.detailBaseUrl === BI_DETAIL_URL;
}

/** Source-semantic replay only. Does not authenticate imported acquisition metadata,
 * issue a capability/certificate, or replace independent B-grade/runtime admission. */
export function replayBiSemanticCompleteness(
  plan: SourceCrawlPlan,
  input: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[],
  capturedAt: string
): BiSemanticReplay | undefined {
  try {
    if (!hasBiSemanticPlan(plan)) return undefined;
    validateExecutablePlanChannelBinding(plan);
    const evidence = parsePersistentSourceFetchEvidence(input);
    if (evidence.artifacts.length !== 2 || evidence.pages.length !== 1 || evidence.supportingArtifactOnlyFailure ||
        !same(evidence.captureTool, { name: "official-json-http", version: "1" })) return undefined;
    const script = evidence.artifacts.find(a => a.logicalKey === "51job-ui-script");
    const api = evidence.artifacts.find(a => a.logicalKey === "51job-page-0001");
    if (!script || !api || !exactArtifact(script, BI_SCRIPT_URL, "OFFICIAL_COMPANY_PAGE", ["application/javascript", "text/javascript"]) ||
        !exactArtifact(api, BI_API_URL, "ATS_API_RESPONSE", ["text/html", "application/javascript", "text/javascript", "application/json"]) ||
        script.extractorLocator !== "javascript:sxsPosCode[code,jobareaname]" ||
        !Number.isFinite(Date.parse(capturedAt)) || Date.parse(capturedAt) > Date.parse(script.capturedAt) ||
        Date.parse(script.capturedAt) > Date.parse(api.capturedAt)) return undefined;
    const ui = replayBiUiSemanticContract(bodyText(script));
    if (!ui || api.extractorLocator !== requestLocator(ui.params)) return undefined;
    const body = bodyText(api);
    const match = /^\s*jsoncallback\((\{[\s\S]*\})\)\s*;?\s*$/u.exec(body);
    if (!match || !boundedJsonDepth(match[1]!) || !hasUniqueJsonObjectKeys(match[1]!)) return undefined;
    const root: unknown = JSON.parse(match[1]!);
    if (!record(root) || !exactKeys(root, ["status", "message", "resultbody"]) || root.status !== "1" ||
        root.message !== "接口调用成功" || !record(root.resultbody) || !exactKeys(root.resultbody, ["totalnum", "joblist"]) ||
        typeof root.resultbody.totalnum !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(root.resultbody.totalnum) ||
        !Array.isArray(root.resultbody.joblist)) return undefined;
    const rows: unknown[] = root.resultbody.joblist;
    const total = Number(root.resultbody.totalnum);
    if (!Number.isSafeInteger(total) || total !== rows.length || total > 500) return undefined;
    const page = evidence.pages[0]!;
    if (page.sequence !== 0 || page.artifactLogicalKey !== api.logicalKey || page.channelId !== undefined ||
        page.requestedCursor != null || page.returnedCursor != null || page.requestedOffset != null || page.returnedOffset != null ||
        page.requestedPage !== 1 || page.returnedPage !== 1 || page.requestedPageSize !== 500 ||
        page.returnedPageSize != null || page.declaredTotal !== total || page.declaredCount !== total ||
        page.declaredPages !== 1 || page.nextPageSignalBefore !== null || page.nextPageSignalAfter !== null ||
        page.termination !== "NEXT_ABSENT" || page.anomalyCodes.length !== 0 || page.capturedAt !== api.capturedAt ||
        page.responseFingerprintSha256 !== hash(body)) return undefined;
    if (!same(evidence.declaredCompleteness, { kind: "OFFICIAL_TOTAL_COUNT", value: total,
      artifactLogicalKey: api.logicalKey, extractorLocator: api.extractorLocator, scope: "SOURCE" })) return undefined;
    const rawIds: string[] = [], validIds: string[] = [], excludedRecordIndexes: number[] = [];
    const expected = new Map<string, { title: string; location: string; cities: string[]; url: string }>();
    const seen = new Set<string>();
    const losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!record(row) ||
          row.ctmid !== "3479" || !text(row.jobname) || !id(row.jobid) || !id(row.coid) || !text(row.coname) ||
          seen.has(row.jobid as string)) return undefined;
      const location = row.jobareaname as string;
      if (!hasExactFosunMainlandGeography({LocNames:[location]}) ||
        [row.workareaname,row.ejobareaname,row.eworkareaname].some(value =>
          typeof value === "string" && explicitlyForeignOrNonMainlandLocation(value))) return undefined;
      const jobId = row.jobid as string;
      seen.add(jobId); rawIds.push(`sha256:${hash(JSON.stringify(jobId))}`);
      if (ui.exclusions.some(rule => (row.jobname as string).includes(rule.code) && location.includes(rule.jobareaname))) {
        excludedRecordIndexes.push(index);
        losses.push({ stage: "VALIDATION", reason: "51job record excluded by official recruitment UI",
          rawLocator: `official-json-page-0000#record:${index}#sha256:${hash("0")}`,
          details: { code: "OFFICIAL_UI_EXCLUSION", recordIndex: index } });
      } else {
        const sourceId = `official-json:sha256:${hash(JSON.stringify(jobId))}`;
        validIds.push(`sha256:${hash(JSON.stringify(sourceId))}`);
        const url = new URL(BI_DETAIL_URL); url.searchParams.set("jobId", jobId);
        expected.set(sourceId, { title: clean(row.jobname as string), location, cities:biDisplayCities(row), url: url.toString() });
      }
    }
    if (!sameSet(rawIds, page.rawJobIds) || !sameSet(validIds, page.validJobIds) ||
        !same(evidence.fetchCounts, { rawCount: total, parsedCount: total, validCount: expected.size,
          parseDiscardCount: 0, validationDiscardCount: excludedRecordIndexes.length }) ||
        !same(losses, evidence.fetchLosses) || outputJobs.length !== expected.size ||
        new Set(outputJobs.map(j => j.sourceJobId)).size !== expected.size) return undefined;
    for (const job of outputJobs) {
      const target = job.sourceJobId && expected.get(job.sourceJobId);
      if (!target || !same(job, {
        companyId: COMPANY, sourceId: SOURCE, sourceKind: "SOCIAL", atsKind: "OFFICIAL_JSON",
        officialChineseCompanyName: plan.company.officialChineseName, officialTitle: target.title,
        officialUrl: target.url, listUrl: BI_ENTRY_URL, sourceJobId: job.sourceJobId,
        locationRaw: target.location, cities: target.cities, category: "其他", isBaseline: job.isBaseline,
        evidence: { officialEntryUrl: BI_ENTRY_URL, officialChainEvidenceUrl: CHAIN, capturedAt }
      }) || typeof job.isBaseline !== "boolean") return undefined;
    }
    return { policyId: BI_UI_RECONSTRUCTION_POLICY, rawCount: total, includedCount: expected.size, excludedRecordIndexes };
  } catch { return undefined; }
}

function requestLocator(params: Record<string, string | number | null>): string {
  // Business scope is replayable; the transient signed transport URL is intentionally absent.
  return `${API_LOCATOR}|business-request-v1|${JSON.stringify({ method: "GET", baseUrl: BI_API_URL, params, jsoncallback: "jsoncallback" })}`;
}

function exactArtifact(a: SourceFetchArtifactDraft, url: string, kind: SourceFetchArtifactDraft["kind"], mime: string[]): boolean {
  return a.id === a.logicalKey && a.kind === kind && a.httpStatus === 200 && a.channelId === undefined &&
    a.bodyRepresentation !== "REDACTED" && a.rawBodySha256 === undefined && a.redactionDescriptors === undefined &&
    a.requestedUrl === sanitizeEvidenceHttpUrl(url) && a.finalUrl === sanitizeEvidenceHttpUrl(url) &&
    mime.includes(a.contentType?.split(";", 1)[0]!.trim().toLowerCase() ?? "") &&
    Buffer.byteLength(bodyText(a), "utf8") <= MAX_ARTIFACT_BYTES;
}
function bodyText(a: SourceFetchArtifactDraft): string { return typeof a.body === "string" ? a.body : new TextDecoder("utf-8", { fatal: true }).decode(a.body); }
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
function exactKeys(v: object, keys: readonly string[]): boolean { return same(Object.keys(v).sort(), [...keys].sort()); }
function id(v: unknown): boolean { return typeof v === "string" && /^[1-9][0-9]{0,19}$/u.test(v); }
function text(v: unknown): boolean { return typeof v === "string" && v.trim().length > 0; }
function clean(v: string): string { return v.replace(/\s+/gu, " ").trim(); }
function hash(v: string): string { return createHash("sha256").update(v, "utf8").digest("hex"); }
function canonical(v: unknown): unknown { return Array.isArray(v) ? v.map(canonical) : record(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v; }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function sameSet(left: readonly string[], right: readonly string[]): boolean { return same([...left].sort(), [...right].sort()); }
function boundedJsonDepth(json: string): boolean {
  let depth = 0, quoted = false, escaped = false;
  for (const char of json) {
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") { if (++depth > 32) return false; }
    else if (char === "}" || char === "]") { if (--depth < 0) return false; }
  }
  return depth === 0 && !quoted;
}
