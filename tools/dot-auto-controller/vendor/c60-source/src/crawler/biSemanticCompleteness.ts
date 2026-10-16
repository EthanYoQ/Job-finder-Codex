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
// Exact labels from the retained 2026-10-01 capture, reviewed against the existing
// mainland prefecture vocabulary. No prefixes, suffix stripping or runtime extension.
const FULL_MAINLAND_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "上海": "Shanghai", "信阳": "Xinyang", "北京": "Beijing", "南昌": "Nanchang",
  "成都": "Chengdu", "杭州": "Hangzhou", "武汉": "Wuhan", "泰州": "Taizhou",
  "秦皇岛": "Qinhuangdao", "银川": "Yinchuan", "长沙": "Changsha", "驻马店": "Zhumadian"
});
const ROW_FIELDS = "address coid coname ctmid degreefrom divid divname edegreefrom efuntype ejobareaname eworkareaname eworkyearname funtype issuedate jkeyword jobareaname jobid jobname jobnum joborder monthlysalary poscode providesalarname term workareaname workyearname".split(" ");
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

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
  // Privacy-sanitized derivative: BI evidence cannot receive semantic admission.
  // Keep hasBiSemanticPlan so this family cannot fall through another policy.
  return undefined;
}

// Signed 51job request reconstruction is intentionally absent.

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
