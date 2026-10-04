import { load as loadHtml } from "cheerio";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import type { OfficialJsonFetchConfig } from "./officialJsonSourceFetch";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId, safeOfficialJsonEvidenceUrl, officialJsonRawLocator } from "./officialJsonEvidence";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export const NOVO_CHINA_LOCATION_POLICY = "NOVO_CHINA_NESTED_LOCATION_V2" as const;
export const NOVO_NATIVE_APPLICATION_POLICY = "NOVO_NATIVE_APPLICATION_V1" as const;
export const NOVO_CHINA_ENDPOINT = "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
const ENTRY = "https://www.novonordisk.com.cn/careers/find-a-job/career-search-results.html?searchText=&countries=China&categories=";
const SOURCE_ID = "source-novo-nordisk-china-social", COMPANY_ID = "company-novo-nordisk-china";
// Reviewed public list locations. A new pair requires review; a contradictory
// country/state/city must never be hidden behind a pending-city marker.
const LOCATIONS = [
  { city: "Beijing", state: "Beijing", normalized: "北京" },
  { city: "Shanghai", state: "Shanghai", normalized: "上海" },
  { city: "Hangzhou", state: "Zhejiang", normalized: "杭州" },
  { city: "Daqing", state: "Heilongjiang", normalized: "大庆" },
  { city: "Songyuan", state: "Jilin", normalized: "松原" },
  { city: "Changchun", state: "Jilin", normalized: "长春" }
] as const;
const RAW_FIELDS = ["jobId", "jobTitle", "jobLocale", "jobLocationLabel", "jobCountry", "jobCategory", "jobSubCategory", "jobState", "jobCity"];
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => same(Object.keys(value).sort(), [...keys].sort());
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function pair(value: unknown): { label: string; value: string } | undefined {
  const raw = record(value);
  return raw && exactKeys(raw, ["label", "value"]) && text(raw.label) && text(raw.value)
    ? { label: raw.label, value: raw.value } : undefined;
}
function pairs(value: unknown): Array<{ label: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(pair);
  return values.every((item): item is { label: string; value: string } => item !== undefined) &&
    new Set(values.map(item => item.value)).size === values.length ? values : undefined;
}

export function exactNovoChinaBootstrap(input: {
  config: OfficialJsonFetchConfig; entryUrl: string; sourceIdentity: { id: string; companyId: string }; endpoint: string
}): boolean {
  return input.sourceIdentity.id === SOURCE_ID && input.sourceIdentity.companyId === COMPANY_ID &&
    input.entryUrl === ENTRY && input.endpoint === NOVO_CHINA_ENDPOINT &&
    same(input.config, { kind: "novo-nordisk", endpointUrl: NOVO_CHINA_ENDPOINT, cityScopePolicy: NOVO_CHINA_LOCATION_POLICY, applicationStatusPolicy: NOVO_NATIVE_APPLICATION_POLICY });
}

export function exactNovoChinaQualityPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "novo-nordisk" &&
    exactNovoChinaBootstrap({ config: plan.officialJsonFetch, entryUrl: plan.source.officialEntryUrl,
      sourceIdentity: plan.source, endpoint: plan.officialJsonFetch.endpointUrl }) &&
    plan.company.id === COMPANY_ID && plan.company.officialChineseName === "诺和诺德中国" &&
    plan.company.category === "FOREIGN_PHARMA" && plan.source.kind === "SOCIAL" &&
    plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialChainEvidenceUrl === "https://www.novonordisk.com.cn/careers.html" &&
    same(plan.json, { jobsPath: "jobs", fields: { sourceJobId: "sourceJobId", officialTitle: "title",
      officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" }, defaultCategory: "其他" }) &&
    !plan.workday && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource;
}

type Projection = { sourceJobId: string; title: string; locationRaw: string; cities: string[]; officialUrl: string };
/** No source date exists in this nine-field response. Native category and
 * subcategory pairs remain intact in the retained artifact, with no new mapping. */
export function parseNovoChinaResponse(body: string): { rawJobs: Record<string, unknown>[]; jobs: Projection[]; total: number } | undefined {
  if (!hasUniqueJsonObjectKeys(body)) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return undefined; }
  const root = record(parsed), data = record(root?.data);
  if (!root || !exactKeys(root, ["data", "status", "message"]) || root.status !== 200 || root.message !== "success" ||
    !data || !exactKeys(data, ["executionTimeMs", "totalMatches", "keywordParam", "localeParam", "countriesParam", "categoriesParam", "subCategories", "states", "cities", "jobs"]) ||
    !count(data.executionTimeMs) || !count(data.totalMatches) || data.keywordParam !== "" || data.localeParam !== "zh-cn" ||
    !same(data.countriesParam, ["China"]) || !same(data.categoriesParam, []) || !Array.isArray(data.jobs) || data.jobs.length !== data.totalMatches) return undefined;
  const states = pairs(data.states), cities = pairs(data.cities), subcategories = pairs(data.subCategories);
  if (!states || !cities || !subcategories ||
    states.some(item => item.label !== item.value || !LOCATIONS.some(location => location.state === item.value)) ||
    cities.some(item => item.label !== item.value || !LOCATIONS.some(location => location.city === item.value))) return undefined;
  const rawJobs: Record<string, unknown>[] = [], jobs: Projection[] = [], ids = new Set<string>();
  for (const value of data.jobs) {
    const raw = record(value);
    if (!raw || !exactKeys(raw, RAW_FIELDS) || typeof raw.jobId !== "string" || !/^[1-9][0-9]{5}\.en_GB$/u.test(raw.jobId) ||
      raw.jobLocale !== "en_GB" || !text(raw.jobTitle) || ids.has(raw.jobId) || !same(pair(raw.jobCountry), { label: "China", value: "China" })) return undefined;
    const state = pair(raw.jobState), city = pair(raw.jobCity), category = pair(raw.jobCategory), subcategory = pair(raw.jobSubCategory);
    const location = LOCATIONS.find(item => item.city === city?.value && item.state === state?.value);
    if (!state || !city || !location || state.label !== state.value || city.label !== city.value ||
      raw.jobLocationLabel !== `China, ${location.city}` || !category || !subcategory ||
      !states.some(item => same(item, state)) || !cities.some(item => same(item, city)) ||
      !subcategories.some(item => same(item, subcategory))) return undefined;
    ids.add(raw.jobId); rawJobs.push(raw);
    jobs.push({ sourceJobId: persistentOfficialJsonJobId(raw.jobId), title: raw.jobTitle.replace(/\s+/gu, " ").trim(),
      locationRaw: raw.jobLocationLabel, cities: [location.normalized],
      officialUrl: new URL(`/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.${raw.jobId}.html`, ENTRY).href });
  }
  return { rawJobs, jobs, total: data.totalMatches };
}

const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
export function novoNativeDetailBase(body: string): string | undefined {
  const $ = loadHtml(body), path = $("#careersearchresults input[ref=jobAdUrl]");
  return path.length === 1 && path.attr("value") === "/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad"
    ? new URL(path.attr("value")!, ENTRY).href : undefined;
}

/** Follow the actual native apply href, including its tenant and requisition binding. */
export function novoNativeApplicationUrl(body: string, detailUrl: string, jobId: string): string | undefined {
  const $ = loadHtml(body);
  if (!clean($("#careerjobdisplay h1").text()) || clean($("#careerjobdisplay").text()).length < 200) return undefined;
  const links = [...new Set($("#careerjobdisplay a[href]").toArray().map(node => $(node).attr("href")!)
    .filter(href => href.includes("career_job_req_id=")))];
  if (links.length !== 1) return undefined;
  try {
    const url = new URL(links[0]!, detailUrl), query = url.searchParams;
    if (url.origin !== "https://career2.successfactors.eu" || url.pathname !== "/career" || url.username || url.password || url.hash ||
      [...query].length !== 6 || query.get("company") !== "novonordisk" || query.get("career_job_req_id") !== jobId.split(".")[0] ||
      query.get("career_ns") !== "job_listing" || query.get("navBarLevel") !== "JOB_SEARCH" ||
      query.get("rcm_site_locale") !== "en_GB" || query.get("selected_lang") !== "en_GB") return undefined;
    return url.href;
  } catch { return undefined; }
}

export function novoApplicationStatus(body: string, finalUrl: string, city: string): { status: "ACTIVE" | "CLOSED"; title?: string } | undefined {
  let url: URL;
  try { url = new URL(finalUrl); } catch { return undefined; }
  if (url.origin !== "https://careers.novonordisk.com" || url.username || url.password || url.search || url.hash ||
    !/^\/job\/[^/]+\/[0-9]+\/$/u.test(url.pathname)) return undefined;
  const $ = loadHtml(body), job = $(".jobDisplay .job"), text = clean(job.text());
  const links = $(".jobDisplay a.apply[href]").toArray().filter(node => /^Apply now/u.test(clean($(node).text())));
  const closed = text.includes("Thank you for your interest unfortunately, we are no longer accepting applicants to this position.");
  if (closed) return links.length === 0 ? { status: "CLOSED" } : undefined;
  const title = clean(job.find("[data-careersite-propertyid=title]").text());
  const location = clean(job.find(".jobGeoLocation").text()).split(/,\s*/u);
  const postingId = url.pathname.split("/").at(-2);
  if (!title || location[0] !== city || location.at(-1) !== "CN" || links.length === 0 ||
    !links.every(node => {
      const apply = new URL($(node).attr("href")!, url);
      return apply.origin === url.origin && apply.pathname === `/talentcommunity/apply/${postingId}/` &&
        apply.search === "?locale=en_GB" && !apply.hash;
    })) return undefined;
  return { status: "ACTIVE", title };
}

export function novoClosedLoss(raw: Record<string, unknown>, recordIndex: number, recordedAt: string): PersistentSourceFetchEvidence["fetchLosses"][number] {
  return { stage: "VALIDATION", reason: "Novo official application explicitly no longer accepts applicants",
    rawLocator: officialJsonRawLocator(raw, recordIndex),
    details: { code: "OFFICIAL_APPLICATION_CLOSED", pageSequence: 0, recordIndex }, recordedAt };
}

/** Only explicit closure produces a loss; unavailable or ambiguous pages fail the source. */
export function replayNovoChinaRows(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, output: readonly NormalizedJobRecord[], capturedAt: string): boolean {
  if (!exactNovoChinaQualityPlan(plan) || evidence.pages.length !== 1) return false;
  const artifact = evidence.artifacts[0], page = evidence.pages[0]!;
  if (!artifact) return false;
  const body = (a: typeof artifact) => typeof a.body === "string" ? a.body : Buffer.from(a.body).toString("utf8");
  const exact = (a: typeof artifact, requested: string, json = false) => a.httpStatus === 200 &&
    a.requestedUrl === safeOfficialJsonEvidenceUrl(requested) &&
    (a.bodyRepresentation === undefined || a.bodyRepresentation === "EXACT") &&
    a.rawBodySha256 === undefined && a.redactionDescriptors === undefined &&
    (json ? /^application\/json(?:\s*;|$)/iu : /^(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/iu).test(a.contentType ?? "");
  if (!exact(artifact, NOVO_CHINA_ENDPOINT, true) || artifact.kind !== "ATS_API_RESPONSE" ||
    artifact.finalUrl !== safeOfficialJsonEvidenceUrl(NOVO_CHINA_ENDPOINT) ||
    createHash("sha256").update(body(artifact), "utf8").digest("hex") !== page.responseFingerprintSha256) return false;
  const parsed = parseNovoChinaResponse(body(artifact)), entry = evidence.artifacts[1];
  if (!parsed || !entry || !exact(entry, ENTRY) || entry.finalUrl !== safeOfficialJsonEvidenceUrl(ENTRY) ||
    entry.logicalKey !== "novo-native-entry" || !novoNativeDetailBase(body(entry)) ||
    evidence.artifacts.length !== 2 + parsed.total * 2) return false;
  const expected: Projection[] = [], losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  for (let i = 0; i < parsed.total; i++) {
    const raw = parsed.rawJobs[i]!, projection = parsed.jobs[i]!, detail = evidence.artifacts[2 + i * 2]!, application = evidence.artifacts[3 + i * 2]!;
    if (!exact(detail, projection.officialUrl) || detail.finalUrl !== projection.officialUrl || detail.logicalKey !== `novo-detail-${raw.jobId}` ||
      detail.kind !== "OFFICIAL_COMPANY_PAGE" || application.kind !== "OFFICIAL_COMPANY_PAGE" || application.logicalKey !== `novo-application-${raw.jobId}`) return false;
    const href = novoNativeApplicationUrl(body(detail), projection.officialUrl, String(raw.jobId));
    if (!href || !exact(application, href)) return false;
    const state = novoApplicationStatus(body(application), application.finalUrl!, String(record(raw.jobCity)!.value));
    if (!state) return false;
    if (state.status === "CLOSED") losses.push(novoClosedLoss(raw, i, application.capturedAt));
    else expected.push({ ...projection, title: state.title! });
  }
  const counts = evidence.fetchCounts;
  if (counts.rawCount !== parsed.total || counts.parsedCount !== parsed.total || counts.validCount !== expected.length ||
    counts.parseDiscardCount !== 0 || counts.validationDiscardCount !== losses.length || !same(evidence.fetchLosses, losses) ||
    output.length !== expected.length || new Set(output.map(job => job.sourceJobId)).size !== output.length ||
    !same(page.rawJobIds, parsed.rawJobs.map((raw, index) => irreversibleOfficialJsonEvidenceId([index, raw]))) ||
    !same(page.validJobIds, expected.map(job => irreversibleOfficialJsonEvidenceId(job.sourceJobId)))) return false;
  const byId = new Map(expected.map(job => [job.sourceJobId, job]));
  return output.every(job => {
    const raw = job.sourceJobId ? byId.get(job.sourceJobId) : undefined;
    const publicEntry = new URL(ENTRY); publicEntry.search = "";
    return raw && typeof job.isBaseline === "boolean" && same(job, {
      sourceJobId: raw.sourceJobId, companyId: COMPANY_ID, sourceId: SOURCE_ID,
      sourceKind: "SOCIAL", atsKind: "OFFICIAL_JSON", officialChineseCompanyName: "诺和诺德中国",
      officialTitle: raw.title, officialUrl: raw.officialUrl, listUrl: publicEntry.toString(),
      locationRaw: raw.locationRaw, cities: raw.cities, category: "其他", isBaseline: job.isBaseline,
      evidence: { officialEntryUrl: publicEntry.toString(),
        officialChainEvidenceUrl: "https://www.novonordisk.com.cn/careers.html", capturedAt }
    });
  });
}

/** Invoked only after owned admission replay has verified every closure body. */
export function novoClosedSourceJobIds(evidence: PersistentSourceFetchEvidence): Set<string> {
  const raw = evidence.artifacts[0]?.body;
  const parsed = raw === undefined ? undefined : parseNovoChinaResponse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
  return new Set(evidence.fetchLosses.flatMap(loss => {
    const row = parsed?.rawJobs[(loss.details as { recordIndex: number }).recordIndex];
    return row ? [persistentOfficialJsonJobId(String(row.jobId))] : [];
  }));
}
