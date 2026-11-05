import { createDecipheriv, createHash } from "node:crypto";
import { load } from "cheerio";
import { hasMainlandCountryLocation, mokaDisplayCities } from "./hengruiMainlandGeography";
import { containsSensitiveAdapterValue } from "./adapters/safeAdapterValue";
import type { NormalizedJobRecord } from "./normalizedJob";
import { validateExecutablePlanChannelBinding, type SourceCrawlPlan } from "./sourcePlan";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl, type PersistentSourceFetchEvidence, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";

const POLICY = "HENGRUI_EXPLICIT_US_WALTHAM_OR_HONG_KONG_ONLY_V1";
const CAMPAIGN = "https://app.mokahr.com/social-recruitment/hengrui/145996";
const LIST = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
const DETAIL = "https://app.mokahr.com/api/outer/ats-apply/website/job";

export interface VerifiedMokaScopeExclusion {
  rawLocatorSha256: string;
  /** Absolute raw ordinal, unlike the page-local locator's recordIndex. */
  recordIndex: number;
  code: "VERIFIED_MOKA_OUT_OF_MAINLAND_SCOPE";
}

export function hasHengruiScopeExclusionPolicy(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.moka?.scopeExclusionProof === POLICY;
}

/** Independent replay of immutable original rows. OUT_OF_SCOPE labels alone never grant an allowance. */
export function replayHengruiScopeExclusionProof(
  plan: SourceCrawlPlan,
  input: PersistentSourceFetchEvidence,
  outputJobs?: readonly NormalizedJobRecord[]
): { exclusions: VerifiedMokaScopeExclusion[] } | undefined {
  try {
    if (!hasHengruiScopeExclusionPolicy(plan) || plan.executionAuthority !== "STAGED" ||
        plan.adapterId !== "official-json" || !plan.moka ||
        plan.company.id !== "company-hengrui" || plan.source.companyId !== "company-hengrui" ||
        plan.source.id !== "source-hengrui-social" || plan.source.atsKind !== "MOKA" ||
        plan.source.officialEntryUrl !== `${CAMPAIGN}#/jobs` ||
        plan.source.officialChainEvidenceUrl !== "https://www.hengrui.com/development/joinUs.html" ||
        plan.moka.expectedOrgId !== "hengrui" || plan.moka.expectedSiteId !== "145996" ||
        plan.moka.expectedMode !== "social" || plan.moka.campaignUrl !== CAMPAIGN ||
        plan.moka.hydrateMissingLocationsFromDetail !== true || plan.moka.publishedWithinDays !== undefined ||
        plan.moka.allowDetailSiteIdOmission !== undefined || plan.moka.allowedEntryRedirect !== undefined) return undefined;
    validateExecutablePlanChannelBinding(plan);
    const evidence = parsePersistentSourceFetchEvidence(input);
    const declared = evidence.declaredCompleteness;
    if (evidence.supportingArtifactOnlyFailure || !evidence.pages.length || !declared ||
        declared.kind !== "OFFICIAL_TOTAL_COUNT" || declared.scope !== "SOURCE" || declared.channelId !== undefined ||
        declared.artifactLogicalKey !== evidence.pages[0]!.artifactLogicalKey) return undefined;
    const artifacts = new Map(evidence.artifacts.map(a => [a.logicalKey, a]));
    if (artifacts.size !== evidence.artifacts.length) return undefined;
    const used = new Set<string>();
    const entry = artifacts.get("moka-entry-0000");
    if (!entry || !exactArtifact(entry, CAMPAIGN, "OFFICIAL_COMPANY_PAGE") || entry.extractorLocator !== "html:#init-data[value]") return undefined;
    used.add(entry.logicalKey);
    const $ = load(bodyText(entry));
    if ($("#init-data").length !== 1) return undefined;
    const init = jsonRecord($("#init-data").attr("value") ?? "");
    const org = record(init?.org);
    const iv = text(init?.aesIv);
    if (!iv || Buffer.byteLength(iv) !== 16 || org?.id !== "hengrui" ||
        String(init?.siteId ?? org?.siteId) !== "145996" || init?.mode !== "social") return undefined;
    const lossByLocator = new Map(evidence.fetchLosses.map(loss => [loss.rawLocator, loss]));
    if (lossByLocator.size !== evidence.fetchLosses.length) return undefined;
    const seenIds = new Set<string>();
    const expectedOutputs = new Map<string, { title: string; cities: string[]; displayCities: string[]; url: string }>();
    const exclusions: VerifiedMokaScopeExclusion[] = [];
    let rawCount = 0;
    for (let sequence = 0; sequence < evidence.pages.length; sequence++) {
      const page = evidence.pages[sequence]!;
      const artifact = artifacts.get(page.artifactLogicalKey);
      const logicalKey = page.artifactLogicalKey;
      const offset = sequence * 50;
      if (!artifact || page.artifactLogicalKey !== logicalKey || !exactArtifact(artifact, LIST, "PAGINATION_PAGE") ||
          page.sequence !== sequence || page.requestedOffset !== offset || page.requestedPageSize !== 50 ||
          page.channelId != null || page.requestedCursor != null || page.returnedCursor != null ||
          page.requestedPage != null || page.returnedPage != null || page.returnedPageSize != null ||
          page.declaredCount != null || page.declaredPages != null ||
          page.capturedAt !== artifact.capturedAt ||
          page.responseFingerprintSha256 !== hash(bodyText(artifact))) return undefined;
      used.add(logicalKey);
      const root = decrypt(artifact, iv);
      const data = record(root?.data);
      if (root?.success !== true || !data || !Array.isArray(data.jobs)) return undefined;
      const totals = [[record(data.jobStats)?.total, "$.data.jobStats.total"], [data.total, "$.data.total"], [data.count, "$.data.count"]] as const;
      const total = totals.find(([value]) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
      if (!total || total[0] !== declared.value || page.declaredTotal !== declared.value ||
          (data.offset !== undefined && data.offset !== offset) || (page.returnedOffset ?? undefined) !== data.offset) return undefined;
      const locator = requestContractV2Locator(
        `moka-envelope-v1|raw:${logicalKey}|request:offset=${offset},limit=50|init:moka-entry-0000|decrypt:aes-128-cbc-v1|json:${total[1]}`,
        { family: "moka", role: "page", method: "POST", url: LIST,
          body: { orgId: "hengrui", siteId: "145996", limit: 50, offset, needStat: true, isCampusJob: false, site: "social", locale: "zh-CN" },
          coordinate: { sequence, requestedOffset: offset, requestedPage: null, requestedPageSize: 50 } });
      if (artifact.extractorLocator !== locator || (sequence === 0 && declared.extractorLocator !== locator)) return undefined;
      const rawIds: string[] = [], validIds: string[] = [];
      for (let index = 0; index < data.jobs.length; index++) {
        const raw = record(data.jobs[index]);
        const id = jobId(raw), title = text(raw?.title);
        if (!raw || !id || !title || seenIds.has(id) || containsSensitiveAdapterValue(id) || containsSensitiveAdapterValue(title)) return undefined;
        seenIds.add(id);
        const evidenceId = `sha256:${hash(JSON.stringify(id))}`;
        rawIds.push(evidenceId);
        const rawLocator = `${logicalKey}#page-${sequence}#record-${index}#sha256:${hash(JSON.stringify(raw))}`;
        let locations = raw.locations;
        if (locations !== undefined && (!Array.isArray(locations) || !locations.every(exactLocationShape))) return undefined;
        if (!locationTexts(locations)?.length) {
          const detailKey = `moka-detail-${String(sequence).padStart(4, "0")}-${String(index).padStart(4, "0")}`;
          const detail = artifacts.get(detailKey);
          const detailLocator = requestContractV2Locator(`moka-detail-v2|request:jobId64=${Buffer.from(id).toString("base64url")}`,
            { family: "moka", role: "detail", method: "POST", url: DETAIL,
              body: { orgId: "hengrui", siteId: "145996", jobId: id, locale: "zh-CN" }, coordinate: { sequence, recordIndex: index } });
          if (!detail || !exactArtifact(detail, DETAIL, "ATS_API_RESPONSE") || detail.extractorLocator !== detailLocator) return undefined;
          used.add(detailKey);
          const detailRoot = decrypt(detail, iv);
          const hydrated = detailRoot?.success === true ? record(detailRoot.data) : jsonRecord(bodyText(detail));
          if (!hydrated || jobId(hydrated) !== id || hydrated.orgId !== "hengrui" || String(hydrated.siteId) !== "145996") return undefined;
          locations = hydrated.locations;
        }
        let cities = locationTexts(locations);
        if (!cities?.length || cities.some(containsSensitiveAdapterValue)) return undefined;
        const loss = lossByLocator.get(rawLocator);
        const hongKongOnly = Array.isArray(locations) && locations.length > 0 && locations.every(exactHongKongLocation);
        if (exactWalthamLocations(locations) || hongKongOnly) {
          // Exclusion must be evidenced by the original raw list row, never a rewritten/hydrated foreign row.
          if (!(hongKongOnly
                ? Array.isArray(raw.locations) && raw.locations.length > 0 && raw.locations.every(exactHongKongLocation)
                : exactWalthamLocations(raw.locations)) || !loss || loss.stage !== "VALIDATION" ||
              loss.reason !== (hongKongOnly ? "Hengrui record is explicitly outside mainland China scope" : "Moka record is explicitly outside China scope") || loss.recordedAt !== artifact.capturedAt ||
              loss.details?.code !== "OUT_OF_SCOPE" || loss.details.pageSequence !== sequence || loss.details.recordIndex !== index ||
              Object.keys(loss.details).sort().join(",") !== "code,pageSequence,recordIndex") return undefined;
          exclusions.push({ rawLocatorSha256: hash(rawLocator), recordIndex: rawCount + index, code: "VERIFIED_MOKA_OUT_OF_MAINLAND_SCOPE" });
        } else {
          const mainlandLocations = Array.isArray(locations) ? locations.filter(location => !exactHongKongLocation(location)) : [];
          cities = locationTexts(mainlandLocations);
          if (loss || !exactMainlandLocations(mainlandLocations) || !cities?.length) return undefined;
          const url = new URL(CAMPAIGN); url.hash = `/job/${encodeURIComponent(id)}`;
          expectedOutputs.set(evidenceId, { title: clean(title), cities: cities.map(clean), displayCities: mokaDisplayCities(mainlandLocations), url: url.toString() });
          validIds.push(evidenceId);
        }
      }
      if (!sameSet(page.rawJobIds, rawIds) || !sameSet(page.validJobIds, validIds)) return undefined;
      rawCount += data.jobs.length;
      const last = sequence === evidence.pages.length - 1;
      const expectedTermination = !last ? "CONTINUE" : declared.value === 0 ? "EMPTY_PAGE"
        : expectedOutputs.size === declared.value ? "DECLARED_TOTAL_REACHED" : "NEXT_ABSENT";
      if (data.jobs.length > 50 || (!last && data.jobs.length !== 50) ||
          (page.nextPageSignalBefore ?? null) !== (sequence === 0 ? null : String(offset)) ||
          (page.nextPageSignalAfter ?? null) !== (last ? null : String(offset + 50)) ||
          page.termination !== expectedTermination) return undefined;
    }
    const counts = evidence.fetchCounts;
    if (used.size !== artifacts.size || rawCount !== declared.value || rawCount !== seenIds.size ||
        counts.rawCount !== rawCount || counts.parsedCount !== rawCount || counts.parseDiscardCount !== 0 ||
        counts.validCount !== expectedOutputs.size || counts.validationDiscardCount !== exclusions.length ||
        exclusions.length !== evidence.fetchLosses.length || rawCount !== expectedOutputs.size + exclusions.length) return undefined;
    if (outputJobs !== undefined) {
      if (outputJobs.length !== expectedOutputs.size || new Set(outputJobs.map(j => j.sourceJobId)).size !== outputJobs.length) return undefined;
      for (const job of outputJobs) {
        const expected = job.sourceJobId && expectedOutputs.get(job.sourceJobId);
        if (!expected || job.companyId !== plan.company.id || job.sourceId !== plan.source.id || job.sourceKind !== "SOCIAL" || job.atsKind !== "MOKA" ||
            job.officialChineseCompanyName !== plan.company.officialChineseName || job.officialTitle !== expected.title ||
            job.officialUrl !== expected.url || job.locationRaw !== expected.cities.join("、") ||
            JSON.stringify(job.cities) !== JSON.stringify(expected.displayCities) || job.listUrl !== sanitizeEvidenceHttpUrl(plan.source.officialEntryUrl) ||
            job.category !== "其他" || job.auxiliaryChineseTitle !== undefined || job.officialPublishedAt !== undefined ||
            job.evidence.officialEntryUrl !== sanitizeEvidenceHttpUrl(plan.source.officialEntryUrl) ||
            job.evidence.officialChainEvidenceUrl !== plan.source.officialChainEvidenceUrl) return undefined;
      }
    }
    return { exclusions };
  } catch { return undefined; }
}

function exactArtifact(a: SourceFetchArtifactDraft, url: string, kind: SourceFetchArtifactDraft["kind"]): boolean {
  return a.kind === kind && a.bodyRepresentation !== "REDACTED" && a.httpStatus === 200 &&
    a.requestedUrl === sanitizeEvidenceHttpUrl(url) && a.finalUrl === sanitizeEvidenceHttpUrl(url) &&
    a.channelId === undefined && (kind === "OFFICIAL_COMPANY_PAGE" ? /^text\/html\b/i : /^(?:application|text)\/json\b/i).test(a.contentType ?? "");
}
function bodyText(a: SourceFetchArtifactDraft): string { return typeof a.body === "string" ? a.body : Buffer.from(a.body).toString("utf8"); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown): string | undefined { return typeof value === "string" ? value.trim() || undefined : undefined; }
function clean(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function jobId(value: Record<string, unknown> | undefined): string | undefined { return text(value?.id) ?? (typeof value?.id === "number" && Number.isSafeInteger(value.id) ? String(value.id) : undefined); }
function jsonRecord(value: string): Record<string, unknown> | undefined { try { return hasUniqueJsonObjectKeys(value) ? record(JSON.parse(value)) : undefined; } catch { return undefined; } }
function decrypt(a: SourceFetchArtifactDraft, iv: string): Record<string, unknown> | undefined {
  try {
    const envelope = jsonRecord(bodyText(a));
    if (typeof envelope?.data !== "string" || typeof envelope.necromancer !== "string" || Buffer.byteLength(envelope.necromancer) !== 16) return undefined;
    const decipher = createDecipheriv("aes-128-cbc", Buffer.from(envelope.necromancer), Buffer.from(iv));
    return jsonRecord(decipher.update(envelope.data, "base64", "utf8") + decipher.final("utf8"));
  } catch { return undefined; }
}
function locationTexts(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every(exactLocationShape)) return undefined;
  const cities = value.map(v => text(v.cityName ?? v.provinceName ?? v.country));
  return cities.every(v => v !== undefined) ? cities as string[] : undefined;
}
function exactWalthamLocations(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(v => record(v) &&
    v.cityId === undefined && v.provinceId === undefined &&
    ["美国", "United States", "US", "USA"].includes(v.country) &&
    ["沃尔瑟姆", "Waltham"].includes(v.cityName) && ["马萨诸塞州", "Massachusetts", "MA"].includes(v.provinceName));
}
function exactMainlandLocations(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(hasMainlandCountryLocation);
}
function sameSet(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }

function exactHongKongLocation(value: unknown): boolean {
  const location = record(value);
  return location?.country === "中国" && location.cityName === "香港" && location.provinceName === "香港" &&
    location.cityId === 810000 && location.provinceId === 810000;
}

function exactLocationShape(value: unknown): boolean {
  const location = record(value);
  if (!location) return false;
  if (typeof location.country !== "string" || !location.country.trim()) return false;
  for (const key of ["cityName", "provinceName"]) {
    if (location[key] !== undefined && (typeof location[key] !== "string" || !(location[key] as string).trim())) return false;
  }
  for (const key of ["cityId", "provinceId"]) {
    if (location[key] !== undefined && (typeof location[key] !== "number" || !Number.isSafeInteger(location[key]) || (location[key] as number) <= 0)) return false;
  }
  return location.id === undefined || typeof location.id === "string" && location.id.trim().length > 0 ||
    typeof location.id === "number" && Number.isSafeInteger(location.id) && location.id >= 0;
}
