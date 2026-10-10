import { createDecipheriv, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { load } from "cheerio";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { sanitizeEvidenceHttpUrl } from "./sourceFetchEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { isHengruiMainlandLocation } from "./hengruiMainlandGeography";
import { MOKA_RECENT_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export const BAYER_MOKA_CAMPAIGN = "https://app.mokahr.com/social-recruitment/bayer/148387";
export const BAYER_MOKA_ENTRY = `${BAYER_MOKA_CAMPAIGN}?locale=zh-CN#/jobs`;
export const BAYER_MOKA_LIST = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
export const BAYER_MOKA_DETAIL = "https://app.mokahr.com/api/outer/ats-apply/website/job";
export const BAYER_DIVISION_FILTER = { customFields: { "283170": { values: ["Pharmaceuticals", "Consumer Health"] } } };
export const BAYER_SCOPE_POLICY = "BAYER_MEDICAL_OPEN_REQUISITIONS_V1";

export function isBayerMedicalTraversalPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.source.id === "source-bayer-healthcare-social" &&
    plan.company.id === "company-bayer-healthcare" && plan.source.companyId === plan.company.id &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "MOKA" && plan.source.officialEntryUrl === BAYER_MOKA_ENTRY &&
    plan.source.officialChainEvidenceUrl === "https://www.bayer.com.cn/zh-hans/zhaoxiannashi" &&
    isDeepStrictEqual(plan.json, MOKA_RECENT_JSON_CONFIG) && isDeepStrictEqual(plan.moka, {
      expectedOrgId: "bayer", expectedSiteId: "148387", expectedMode: "social", campaignUrl: BAYER_MOKA_CAMPAIGN,
      hydrateMissingLocationsFromDetail: true, allowDetailSiteIdOmission: true, scopeExclusionProof: BAYER_SCOPE_POLICY
    });
}

export function bayerNativeDivisionScope(plan: SourceCrawlPlan, entryHtml: string): Record<string, unknown> {
  if (!isBayerMedicalTraversalPlan(plan)) throw new Error("Bayer medical traversal requires its exact reviewed plan");
  const init = JSON.parse(load(entryHtml)("#init-data").attr("value") ?? "null");
  const fields = Array.isArray(init?.jobCustomFields) ? init.jobCustomFields.filter((f: any) => f?.id === 283170) : [];
  if (fields.length !== 1 || fields[0].name !== "Division" || fields[0].type !== "select_info" ||
      !Array.isArray(fields[0].detail) || !["Pharmaceuticals", "Consumer Health"].every(v => fields[0].detail.includes(v))) {
    throw new Error("Bayer public native Division scope definition is missing");
  }
  return structuredClone(BAYER_DIVISION_FILTER);
}

/** Resolve only official medical division, requisition state and positive mainland evidence. */
export function bayerDetailScope(raw: Record<string, unknown>, detail: Record<string, unknown>): {
  locations: Record<string, unknown>[]; paused: boolean;
} {
  if (typeof raw.id !== "string" || !raw.id || raw.id !== detail.id || raw.orgId !== "bayer" || detail.orgId !== "bayer" ||
      (detail.siteId !== undefined && String(detail.siteId) !== "148387") || raw.title !== detail.title ||
      typeof raw.title !== "string" || !raw.title.trim() || raw.status !== detail.status ||
      raw.publishedAt !== detail.publishedAt || raw.showIsCampus !== false) throw new Error("Bayer list/detail identity mismatch");
  return bayerIndependentDetailScope({ id: String(raw.id), title: String(raw.title) }, detail);
}

export function bayerIndependentDetailScope(dom: { id: string; title: string }, detail: Record<string, unknown>): {
  locations: Record<string, unknown>[]; paused: boolean;
} {
  if (detail.id !== dom.id || detail.orgId !== "bayer" || (detail.siteId !== undefined && String(detail.siteId) !== "148387") ||
      typeof detail.title !== "string" || clean(detail.title) !== clean(dom.title)) throw new Error("Bayer independent DOM/detail identity mismatch");
  const fields = record(detail.customFields);
  const value = (id: string, name: string): string | undefined => {
    const f = record(fields?.[id]);
    if (!f) return undefined;
    if (f.name !== name || typeof f.value !== "string") throw new Error("Bayer custom field identity mismatch");
    return f.value;
  };
  if (!["Pharmaceuticals", "Consumer Health"].includes(value("283170", "Division") ?? "") ||
      value("290891", "国家") !== "China") throw new Error("Bayer detail is outside the selected medical mainland scope");
  const pauseStart = value("291952", "职位暂停开始时间"), pauseEnd = value("298038", "职位暂停结束时间");
  const paused = detail.status === "pause";
  if (paused ? !pauseStart || !/^\d{4}-\d{2}-\d{2}$/.test(pauseStart) || !Number.isFinite(Date.parse(`${pauseStart}T00:00:00Z`)) ||
      new Date(`${pauseStart}T00:00:00Z`).toISOString().slice(0, 10) !== pauseStart || pauseEnd !== ""
    : detail.status !== "open" || !!pauseStart && !pauseEnd) throw new Error("Bayer requisition status is not unambiguous");
  let locations: unknown = detail.locations;
  if (Array.isArray(locations) && locations.length === 0) {
    const city = value("289157", "城市");
    const aliases: Record<string, string> = { BeiJing: "北京", NanTong: "南通" };
    if (!city || !aliases[city]) throw new Error("Bayer missing location lacks a reviewed official city field");
    locations = [{ cityName: aliases[city], country: "中国" }];
  }
  if (!Array.isArray(locations) || !locations.length || !locations.every(l => {
    const loc = record(l);
    return loc && (loc.countryDescription === undefined || loc.countryDescription === "中国") &&
      (isHengruiMainlandLocation(loc) || loc.country === "中国" && loc.cityName === "启东市" &&
        loc.cityId === 320681 && loc.provinceName === "江苏");
  })) throw new Error("Bayer detail has unreviewed or conflicting mainland location evidence");
  return { locations: locations as Record<string, unknown>[], paused };
}

/** Replays original encrypted request-bound records, losses, pagination and output. */
export function replayBayerMedicalTraversal(
  plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, outputJobs?: readonly NormalizedJobRecord[]
): { excludedCount: number } | undefined {
  try {
    if (!isBayerMedicalTraversalPlan(plan) || plan.executionAuthority !== "STAGED" || evidence.supportingArtifactOnlyFailure ||
        !evidence.pages.length) return undefined;
    const artifacts = new Map(evidence.artifacts.map(a => [a.logicalKey, a]));
    const entry = artifacts.get("moka-entry-0000");
    if (artifacts.size !== evidence.artifacts.length || !entry || !exactArtifact(entry, BAYER_MOKA_CAMPAIGN, "OFFICIAL_COMPANY_PAGE")) return undefined;
    const entryText = textBody(entry);
    bayerNativeDivisionScope(plan, entryText);
    const init = JSON.parse(load(entryText)("#init-data").attr("value") ?? "null");
    if (init?.org?.id !== "bayer" || String(init?.siteId ?? init?.org?.siteId) !== "148387" || init.mode !== "social") return undefined;
    const declaration = evidence.declaredCompleteness;
    if (declaration?.kind !== "COMPLETE_PAGE_TRAVERSAL" || declaration.value !== evidence.pages.length || declaration.scope !== "SOURCE" ||
        declaration.artifactLogicalKey !== evidence.pages[0]?.artifactLogicalKey || declaration.channelId !== undefined) return undefined;
    const seen = new Set<string>(), used = new Set([entry.logicalKey]);
    const expected = new Map<string, { raw: Record<string, unknown>; locations: Record<string, unknown>[] }>();
    const losses = new Map(evidence.fetchLosses.map(l => [l.rawLocator, l]));
    if (losses.size !== evidence.fetchLosses.length) return undefined;
    let excludedCount = 0, rawCount = 0, officialTotal: number | undefined;
    for (let sequence = 0; sequence < evidence.pages.length; sequence++) {
      const page = evidence.pages[sequence]!, artifact = artifacts.get(page.artifactLogicalKey), offset = sequence * 50;
      if (!artifact || !exactArtifact(artifact, BAYER_MOKA_LIST, "PAGINATION_PAGE")) return undefined;
      used.add(artifact.logicalKey);
      const root = decryptBayerArtifact(artifact, init.aesIv), data = record(root.data);
      const total = record(data?.jobStats)?.total;
      if (root.success !== true || !data || !Array.isArray(data.jobs) || !Number.isSafeInteger(total) || Number(total) < 1 ||
          record(data.jobStats)?.orgId !== "bayer") return undefined;
      officialTotal ??= Number(total);
      const locator = requestContractV2Locator(`moka-envelope-v1|raw:${artifact.logicalKey}|request:offset=${offset},limit=50|init:moka-entry-0000|decrypt:aes-128-cbc-v1|json:$.data.jobStats.total`, {
        family: "moka", role: "page", method: "POST", url: BAYER_MOKA_LIST,
        body: { orgId: "bayer", siteId: "148387", limit: 50, offset, needStat: true, isCampusJob: false, site: "social", locale: "zh-CN", ...BAYER_DIVISION_FILTER },
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
        const raw = record(data.jobs[i]);
        if (!raw || typeof raw.id !== "string" || seen.has(raw.id)) return undefined;
        seen.add(raw.id);
        const evidenceId = `sha256:${hash(JSON.stringify(raw.id))}`; rawIds.push(evidenceId);
        const key = `moka-detail-${String(sequence).padStart(4, "0")}-${String(i).padStart(4, "0")}`, detailArtifact = artifacts.get(key);
        const detailLocator = requestContractV2Locator(`moka-detail-v2|request:jobId64=${Buffer.from(raw.id).toString("base64url")}`, {
          family: "moka", role: "detail", method: "POST", url: BAYER_MOKA_DETAIL,
          body: { orgId: "bayer", siteId: "148387", jobId: raw.id, locale: "zh-CN" }, coordinate: { sequence, recordIndex: i }
        });
        if (!detailArtifact || !exactArtifact(detailArtifact, BAYER_MOKA_DETAIL, "ATS_API_RESPONSE") || detailArtifact.extractorLocator !== detailLocator) return undefined;
        used.add(key);
        const detailRoot = decryptBayerArtifact(detailArtifact, init.aesIv), detail = record(detailRoot.data);
        if (detailRoot.success !== true || !detail) return undefined;
        const scope = bayerDetailScope(raw, detail);
        const rawLocator = `${artifact.logicalKey}#page-${sequence}#record-${i}#sha256:${hash(JSON.stringify(raw))}`, loss = losses.get(rawLocator);
        if (scope.paused) {
          if (!loss || loss.stage !== "VALIDATION" || loss.reason !== "Bayer official requisition is paused" || loss.recordedAt !== artifact.capturedAt ||
              !isDeepStrictEqual(loss.details, { code: "BAYER_OFFICIAL_PAUSED", pageSequence: sequence, recordIndex: i })) return undefined;
          excludedCount++;
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
    if (used.size !== artifacts.size || rawCount !== officialTotal || rawCount !== seen.size || excludedCount !== losses.size ||
        !isDeepStrictEqual(evidence.fetchCounts, { rawCount, parsedCount: rawCount, validCount: expected.size, parseDiscardCount: 0, validationDiscardCount: excludedCount })) return undefined;
    if (outputJobs) {
      if (outputJobs.length !== expected.size || new Set(outputJobs.map(j => j.sourceJobId)).size !== outputJobs.length) return undefined;
      for (const job of outputJobs) {
        const item = job.sourceJobId && expected.get(job.sourceJobId);
        if (!item) return undefined;
        const cities = item.locations.map(l => String(l.cityName ?? l.provinceName ?? l.country).replace(/\s+/gu, " ").trim());
        const published = String(item.raw.publishedAt);
        if (job.companyId !== plan.company.id || job.sourceId !== plan.source.id || job.sourceKind !== "SOCIAL" || job.atsKind !== "MOKA" ||
            job.officialTitle !== String(item.raw.title).replace(/\s+/gu, " ").trim() || job.officialUrl !== `${BAYER_MOKA_CAMPAIGN}#/job/${encodeURIComponent(String(item.raw.id))}` ||
            job.locationRaw !== cities.join("、") || !isDeepStrictEqual(job.cities, cities) || job.officialPublishedAt !== new Date(`${published}+08:00`).toISOString() ||
            job.listUrl !== BAYER_MOKA_CAMPAIGN) return undefined;
      }
    }
    return { excludedCount };
  } catch { return undefined; }
}

export function decryptBayerArtifact(artifact: Pick<SourceFetchArtifactDraft, "body">, iv: string): Record<string, unknown> {
  const text = textBody(artifact);
  if (!hasUniqueJsonObjectKeys(text)) throw new Error("Bayer envelope has duplicate keys");
  const e = JSON.parse(text), cipher = createDecipheriv("aes-128-cbc", Buffer.from(e.necromancer), Buffer.from(iv));
  const decoded = cipher.update(e.data, "base64", "utf8") + cipher.final("utf8");
  if (!hasUniqueJsonObjectKeys(decoded)) throw new Error("Bayer payload has duplicate keys");
  const root = record(JSON.parse(decoded));
  if (!root) throw new Error("Bayer payload is not an object");
  return root;
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
