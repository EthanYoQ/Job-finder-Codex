import {mokaRawJobId,mokaRawObservationId,mokaQuarantineAt,mokaQuarantinedDetailKey} from './mokaJobQuarantine';
import {jobQuarantineLossesMatch} from './jobQuarantine';
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { sanitizeEvidenceHttpUrl } from "./sourceFetchEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { hasMainlandCountryLocation, mokaDisplayCities } from "./hengruiMainlandGeography";
import { MOKA_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { decryptBayerArtifact } from "./bayerMokaScope";

export const SERVIER_MOKA_CAMPAIGN = "https://app.mokahr.com/social-recruitment/shiweiya/47734";
export const SERVIER_MOKA_ENTRY = SERVIER_MOKA_CAMPAIGN;
export const SERVIER_MOKA_LIST = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
export const SERVIER_MOKA_DETAIL = "https://app.mokahr.com/api/outer/ats-apply/website/job";
export const SERVIER_SCOPE_POLICY = "SERVIER_OPEN_PORTAL_UNKNOWN_GEOGRAPHY_V1";
export const SERVIER_UNKNOWN_CODE = "SERVIER_WORKPLACE_COUNTRY_UNKNOWN";

export function isServierTraversalPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.source.id === "source-servier-china-social" &&
    plan.company.id === "company-servier-china" && plan.source.companyId === plan.company.id &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "MOKA" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.executionAuthority === "STAGED" && isDeepStrictEqual(plan.expectedChannels, [{channelId: "source:source-servier-china-social:default", kind: "SOCIAL"}]) &&
    plan.source.officialEntryUrl === SERVIER_MOKA_ENTRY &&
    plan.source.officialChainEvidenceUrl === "https://www.servier.com.cn/social-recruitment/shiweiya/47734" &&
    isDeepStrictEqual(plan.json, MOKA_JSON_CONFIG) && isDeepStrictEqual(plan.moka, {
      expectedOrgId: "shiweiya", expectedSiteId: "47734", expectedMode: "social", campaignUrl: SERVIER_MOKA_CAMPAIGN,
      allowedEntryRedirect: { origin: "https://app.mokahr.com", pathname: "/social-recruitment/shiweiya/47734" },
      hydrateMissingLocationsFromDetail: true, allowDetailSiteIdOmission: true, scopeExclusionProof: SERVIER_SCOPE_POLICY
    });
}

export function servierDetailScope(raw: Record<string, unknown>, detail: Record<string, unknown>) {
  if (typeof raw.id !== "string" || raw.orgId !== "shiweiya" || raw.title !== detail.title || raw.status !== detail.status ||
      raw.publishedAt !== detail.publishedAt || raw.showIsCampus !== false ||
      raw.locations != null && (!Array.isArray(raw.locations) || raw.locations.length > 0 && !isDeepStrictEqual(raw.locations, detail.locations))) throw Error("Servier list/detail identity mismatch");
  for (const field of ["openedAt", "closedAt"] as const) {
    // The list may omit activity fields. A supplied value must agree with the detail,
    // including an explicit null; minute and zero-second native representations agree.
    if (raw[field] === undefined) continue;
    if (raw[field] === null ? detail[field] != null :
      servierActivityTime(raw[field]) === undefined || servierActivityTime(raw[field]) !== servierActivityTime(detail[field])) {
      throw Error("Servier list/detail activity mismatch");
    }
  }
  return servierIndependentDetailScope({ id: raw.id, title: String(raw.title) }, detail);
}

/** Only explicit country/locality evidence enters the mainland projection.
 * Empty official locations are a preserved open posting, not an overseas/closed finding.
 * Detail showIsCampus is not used: the native 47734 social request and list bind recruitment scope. */
export function servierIndependentDetailScope(identity: { id: string; title: string }, detail: Record<string, unknown>): {
  locations: Record<string, unknown>[]; unknownGeography: boolean;
} {
  if (detail.id !== identity.id || !/^[0-9a-f-]{36}$/u.test(identity.id) || detail.orgId !== "shiweiya" ||
      detail.siteId !== undefined && String(detail.siteId) !== "47734" || typeof detail.title !== "string" ||
      clean(detail.title) !== clean(identity.title) || !clean(identity.title) || detail.status !== "open" ||
      typeof detail.jobDescription !== "string" || !load(detail.jobDescription).text().trim() ||
      !Array.isArray(detail.locations)) throw Error("Servier detail identity, activity or body is unresolved");
  assertServierOpenActivity(detail);
  const locations = detail.locations;
  if (locations.length === 0) {
    if (!Array.isArray(detail.locDepCampusList) || detail.locDepCampusList.some(candidate => {
      const item = record(candidate); return !item || !Array.isArray(item.locationIds) || item.locationIds.length !== 0;
    })) throw Error("Servier empty locations conflict with native location IDs");
    const custom = record(detail.customFields);
    if (custom && Object.values(custom).some(candidate => {
      const field = record(candidate); return field && typeof field.name === "string" &&
        /国家|工作地|城市|country|location|city/iu.test(field.name) && field.value != null && String(field.value).trim() !== "";
    })) throw Error("Servier workplace has an unreviewed custom location field");
    return { locations: [], unknownGeography: true };
  }
  if (!locations.every(candidate => {
    const location = record(candidate);
    if (!location || location.country !== "中国" || location.countryDescription !== undefined && location.countryDescription !== "中国") return false;
    // Two official district tuples are still mainland locations. Preserve their original labels.
    const district = location.cityName === "朝阳区" && location.cityId === 110105 && location.provinceName === "北京市" &&
      (location.provinceId === undefined || location.provinceId === 110000) ||
      location.cityName === "下城区（旧）" && location.cityId === 330103 && location.provinceName === "浙江" &&
      (location.provinceId === undefined || location.provinceId === 330000);
    return hasMainlandCountryLocation(location) || district;
  })) throw Error("Servier detail has unreviewed or conflicting mainland geography");
  return { locations: locations as Record<string, unknown>[], unknownGeography: false };
}

export function decodeServierArtifact(artifact: Pick<SourceFetchArtifactDraft, "body">, iv: string): Record<string, unknown> {
  const text = textBody(artifact);
  if (!hasUniqueJsonObjectKeys(text)) throw Error("Servier response contains duplicate JSON keys");
  const value = JSON.parse(text);
  return typeof value?.necromancer === "string" ? decryptBayerArtifact(artifact, iv) : record(value) ?? (() => {throw Error("Servier response is not an object");})();
}

/** Replays original encrypted request-bound records, losses, pagination and output. */
export function replayServierTraversal(
  plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, outputJobs?: readonly NormalizedJobRecord[]
): { excludedCount: number; unknownOfficialIds: string[] } | undefined {
  try {
    if (!isServierTraversalPlan(plan) || plan.executionAuthority !== "STAGED" || evidence.supportingArtifactOnlyFailure ||
        !evidence.pages.length) return undefined;
    if(evidence.jobQuarantines?.length&&!jobQuarantineLossesMatch(evidence))return;
    const artifacts = new Map(evidence.artifacts.map(a => [a.logicalKey, a]));
    const entry = artifacts.get("moka-entry-0000");
    if (artifacts.size !== evidence.artifacts.length || !entry || !exactArtifact(entry, SERVIER_MOKA_CAMPAIGN, "OFFICIAL_COMPANY_PAGE")) return undefined;
    const entryText = textBody(entry);
    const init = JSON.parse(load(entryText)("#init-data").attr("value") ?? "null");
    if (init?.org?.id !== "shiweiya" || String(init?.siteId ?? init?.org?.siteId) !== "47734" || init.mode !== "social") return undefined;
    const declaration = evidence.declaredCompleteness;
    if (declaration?.kind !== "COMPLETE_PAGE_TRAVERSAL" || declaration.value !== evidence.pages.length || declaration.scope !== "SOURCE" ||
        declaration.artifactLogicalKey !== evidence.pages[0]?.artifactLogicalKey || declaration.channelId !== undefined) return undefined;
    const seen = new Set<string>(), used = new Set([entry.logicalKey]);
    const expected = new Map<string, { raw: Record<string, unknown>; locations: Record<string, unknown>[] }>();
    const losses = new Map(evidence.fetchLosses.map(l => [l.rawLocator, l]));
    if (losses.size !== evidence.fetchLosses.length) return undefined;
    let excludedCount = 0, rawCount = 0, officialTotal: number | undefined;
    const unknownOfficialIds: string[] = [];
    for (let sequence = 0; sequence < evidence.pages.length; sequence++) {
      const page = evidence.pages[sequence]!, artifact = artifacts.get(page.artifactLogicalKey), offset = sequence * 50;
      if (!artifact || !exactArtifact(artifact, SERVIER_MOKA_LIST, "PAGINATION_PAGE")) return undefined;
      used.add(artifact.logicalKey);
      const root = decodeServierArtifact(artifact, init.aesIv), data = record(root.data);
      const total = record(data?.jobStats)?.total;
      if (root.success !== true || !data || !Array.isArray(data.jobs) || !Number.isSafeInteger(total) || Number(total) < 1 ||
          record(data.jobStats)?.orgId !== "shiweiya") return undefined;
      officialTotal ??= Number(total);
      const locator = requestContractV2Locator(`moka-envelope-v1|raw:${artifact.logicalKey}|request:offset=${offset},limit=50|init:moka-entry-0000|decrypt:aes-128-cbc-v1|json:$.data.jobStats.total`, {
        family: "moka", role: "page", method: "POST", url: SERVIER_MOKA_LIST,
        body: { orgId: "shiweiya", siteId: "47734", limit: 50, offset, needStat: true, isCampusJob: false, site: "social", locale: "zh-CN" },
        coordinate: { sequence, requestedOffset: offset, requestedPage: null, requestedPageSize: 50 }
      });
      if (total !== officialTotal || page.declaredTotal !== total || page.sequence !== sequence || page.requestedOffset !== offset ||
          page.requestedPageSize !== 50 || page.requestedPage != null || page.returnedPage != null || page.returnedPageSize != null ||
          page.channelId != null || page.declaredPages != null || page.declaredCount != null || page.requestedCursor != null || page.returnedCursor != null ||
          (page.returnedOffset ?? undefined) !== data.offset || artifact.extractorLocator !== locator ||
          sequence === 0 && declaration.extractorLocator !== locator || page.capturedAt !== artifact.capturedAt ||
          page.responseFingerprintSha256 !== hash(textBody(artifact))) return undefined;
      const rawIds: string[] = [], validIds: string[] = [];
      for (let i = 0; i < data.jobs.length; i++) {
        const original=data.jobs[i],raw=record(original),id=mokaRawJobId(original);
        if(id){if(seen.has(id))return;seen.add(id);}
        rawIds.push(mokaRawObservationId(original,sequence,i));
        const q=mokaQuarantineAt(evidence,original,sequence,i);
        if(q){const key=mokaQuarantinedDetailKey(evidence,q,id,(plan as Extract<SourceCrawlPlan,{adapterId:'official-json'}>).moka!);if(key)used.add(key);continue;}
        if(!raw||typeof raw.id!=='string')return;
        const evidenceId = `sha256:${hash(JSON.stringify(raw.id))}`;
        const key = `moka-detail-${String(sequence).padStart(4, "0")}-${String(i).padStart(4, "0")}`, detailArtifact = artifacts.get(key);
        const detailLocator = requestContractV2Locator(`moka-detail-v2|request:jobId64=${Buffer.from(raw.id).toString("base64url")}`, {
          family: "moka", role: "detail", method: "POST", url: SERVIER_MOKA_DETAIL,
          body: { orgId: "shiweiya", siteId: "47734", jobId: raw.id, locale: "zh-CN" }, coordinate: { sequence, recordIndex: i }
        });
        if (!detailArtifact || !exactArtifact(detailArtifact, SERVIER_MOKA_DETAIL, "ATS_API_RESPONSE") || detailArtifact.extractorLocator !== detailLocator) return undefined;
        used.add(key);
        const detailRoot = decodeServierArtifact(detailArtifact, init.aesIv), detail = record(detailRoot.data);
        if (detailRoot.success !== true || !detail) return undefined;
        const scope = servierDetailScope(raw, detail);
        const rawLocator = `${artifact.logicalKey}#page-${sequence}#record-${i}#sha256:${hash(JSON.stringify(raw))}`, loss = losses.get(rawLocator);
        if (scope.unknownGeography) {
          if (!loss || loss.stage !== "VALIDATION" || loss.reason !== "Servier official detail leaves workplace country unknown; posting remains open" || loss.recordedAt !== artifact.capturedAt ||
              !isDeepStrictEqual(loss.details, { code: SERVIER_UNKNOWN_CODE, field: "locations", noteCode: "OFFICIAL_STATUS_OPEN_GEOGRAPHY_PENDING", pageSequence: sequence, recordIndex: i })) return undefined;
          excludedCount++; unknownOfficialIds.push(raw.id);
        } else {
          if (loss) return undefined;
          expected.set(evidenceId, { raw, locations: scope.locations }); validIds.push(evidenceId);
        }
      }
      rawCount += data.jobs.length;
      const last = sequence === evidence.pages.length - 1;
      if (!sameSet(page.rawJobIds, rawIds) || !sameSet(page.validJobIds, validIds) || data.jobs.length > 50 ||
          (!last && data.jobs.length !== 50) || page.termination !== (last ? "NEXT_ABSENT" : "CONTINUE") ||
          (page.nextPageSignalBefore ?? null) !== (sequence ? String(offset) : null) ||
          (page.nextPageSignalAfter ?? null) !== (last ? null : String(offset + 50))) return undefined;
    }
    if (used.size !== artifacts.size || rawCount !== officialTotal || rawCount !== seen.size+(evidence.jobQuarantines?.filter(q=>!q.sourceJobId).length??0) || excludedCount+(evidence.jobQuarantines?.length??0) !== losses.size ||
        !isDeepStrictEqual(evidence.fetchCounts, { rawCount, parsedCount: rawCount, validCount: expected.size, parseDiscardCount: 0, validationDiscardCount: excludedCount+(evidence.jobQuarantines?.length??0) })) return undefined;
    if (outputJobs) {
      if (outputJobs.length !== expected.size || new Set(outputJobs.map(j => j.sourceJobId)).size !== outputJobs.length) return undefined;
      for (const job of outputJobs) {
        const item = job.sourceJobId && expected.get(job.sourceJobId);
        if (!item) return undefined;
        const cities = item.locations.map(l => String(l.cityName ?? l.provinceName ?? l.country).replace(/\s+/gu, " ").trim());
        if (job.companyId !== plan.company.id || job.sourceId !== plan.source.id || job.sourceKind !== "SOCIAL" || job.atsKind !== "MOKA" ||
            job.officialChineseCompanyName !== plan.company.officialChineseName || job.category !== "其他" || job.auxiliaryChineseTitle !== undefined ||
            job.officialTitle !== String(item.raw.title).replace(/\s+/gu, " ").trim() || job.officialUrl !== `${SERVIER_MOKA_CAMPAIGN}#/job/${encodeURIComponent(String(item.raw.id))}` ||
            job.locationRaw !== cities.join("、") || !isDeepStrictEqual(job.cities, mokaDisplayCities(item.locations)) || job.officialPublishedAt !== undefined ||
            job.listUrl !== SERVIER_MOKA_CAMPAIGN) return undefined;
      }
    }
    return { excludedCount, unknownOfficialIds };
  } catch { return undefined; }
}

function exactArtifact(a: SourceFetchArtifactDraft, url: string, kind: SourceFetchArtifactDraft["kind"]): boolean {
  return a.kind === kind && a.bodyRepresentation !== "REDACTED" && a.httpStatus === 200 &&
    a.requestedUrl === sanitizeEvidenceHttpUrl(url) && a.finalUrl === sanitizeEvidenceHttpUrl(url) && a.channelId === undefined &&
    (kind === "OFFICIAL_COMPANY_PAGE" ? /^text\/html\b/i : /^(?:application|text)\/json\b/i).test(a.contentType ?? "");
}
function textBody(a: Pick<SourceFetchArtifactDraft, "body">): string { return typeof a.body === "string" ? a.body : Buffer.from(a.body).toString("utf8"); }
function record(v: unknown): Record<string, unknown> | undefined { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined; }
function hash(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function sameSet(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && isDeepStrictEqual([...a].sort(), [...b].sort()); }

function clean(s: string): string { return s.replace(/\s+/gu, " ").trim(); }

/** Moka retains historical closedAt on reopened jobs. Current status must be open;
 * any historical close additionally requires a later, valid native openedAt. */
function assertServierOpenActivity(detail: Record<string, unknown>): void {
  const openedAt = servierActivityTime(detail.openedAt), closedAt = servierActivityTime(detail.closedAt);
  if (detail.status !== "open" || detail.openedAt != null && openedAt === undefined ||
      detail.closedAt != null && (closedAt === undefined || openedAt === undefined || openedAt <= closedAt)) {
    throw Error("Servier open state lacks unambiguous native reopening evidence");
  }
}

/** Reviewed native activity fields use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.
 * Compare their wall-clock values directly; do not infer a timezone or rewrite originals. */
function servierActivityTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
  if (!match) return undefined;
  const canonical = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}.000Z`;
  const time = Date.parse(canonical);
  return Number.isFinite(time) && new Date(time).toISOString() === canonical ? time : undefined;
}

/** Do not convert a previously known job's unresolved geography into a missing/closed job.
 * A source-local hold is safer than changing the global lifecycle contract or guessing country. */
export function assertServierUnknownLifecyclePreserved(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence,
  previousJobs: readonly NormalizedJobRecord[]): void {
  if (plan.source.id !== "source-servier-china-social") return;
  const proof = replayServierTraversal(plan, evidence);
  if (!proof) throw Error("SERVIER_PENDING_GEOGRAPHY_PROOF_REQUIRED");
  const pending = new Set(proof.unknownOfficialIds), hashed = new Set([...pending].map(id => `sha256:${hash(JSON.stringify(id))}`));
  if (previousJobs.some(job => job.sourceId === plan.source.id &&
    (job.sourceJobId !== undefined && (pending.has(job.sourceJobId) || hashed.has(job.sourceJobId)) ||
      pending.has(servierOfficialUrlJobId(job.officialUrl) ?? "")))) {
    throw Error("SERVIER_PREVIOUS_JOB_GEOGRAPHY_UNKNOWN_PRESERVE_LAST_GOOD");
  }
}

function servierOfficialUrlJobId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== "https://app.mokahr.com" || url.pathname !== "/social-recruitment/shiweiya/47734" ||
        url.username || url.password || !["", "?locale=zh-CN"].includes(url.search)) return undefined;
    return /^#\/job\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(url.hash)?.[1];
  } catch { return undefined; }
}
