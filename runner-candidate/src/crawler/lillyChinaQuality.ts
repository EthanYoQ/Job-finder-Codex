import { load as loadHtml } from "cheerio";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { explicitlyForeignOrNonMainlandLocation, irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId } from "./officialJsonEvidence";
import { CITY_PENDING } from "../domain/jobLocation";
import type { SourceCrawlPlan } from "./sourcePlan";
import { ucbOfficialPostedDate } from "./ucbOfficialPostedDate";

export const LILLY_POSTED_DATE_POLICY = "LILLY_CHINA_PHENOM_POSTED_DATE_V1" as const;
export const LILLY_CITY_SCOPE_POLICY = "LILLY_CHINA_REVIEWED_LOCATION_PENDING_V1" as const;
export const LILLY_PUBLIC_VISIBILITY_POLICY = "LILLY_CHINA_PUBLIC_VISIBILITY_V1" as const;
export const lillyOfficialPostedDate = ucbOfficialPostedDate;

export function requiresLillyChinaQuality(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") return false;
  const config = plan.officialJsonFetch;
  return plan.source.id === "source-lilly-china-social" || config.postedDatePolicy === LILLY_POSTED_DATE_POLICY ||
    config.cityScopePolicy === LILLY_CITY_SCOPE_POLICY || config.publicVisibilityPolicy === LILLY_PUBLIC_VISIBILITY_POLICY;
}
export function exactLillyChinaQualityPlan(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") return false;
  const config = plan.officialJsonFetch, fields = plan.json.fields;
  return plan.company.id === "company-lilly-china" && plan.company.officialChineseName === "礼来中国" &&
    plan.company.category === "FOREIGN_PHARMA" && plan.source.id === "source-lilly-china-social" &&
    plan.source.companyId === plan.company.id && plan.source.kind === "SOCIAL" &&
    plan.source.atsKind === "OFFICIAL_JSON" && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === "https://careers.lilly.com/us/en/search-results?keywords=China" &&
    plan.source.officialChainEvidenceUrl === "https://careers.lilly.com/global/zh/china" &&
    config.postedDatePolicy === LILLY_POSTED_DATE_POLICY && config.cityScopePolicy === LILLY_CITY_SCOPE_POLICY &&
    config.publicVisibilityPolicy === LILLY_PUBLIC_VISIBILITY_POLICY && config.countryFilter === "China" &&
    config.detailBaseUrl === "https://careers.lilly.com/us/en/job" && config.pageSize === 50 && config.maxPages === 10 &&
    JSON.stringify(config.allowedApplyOrigins) === JSON.stringify(["https://lilly.wd115.myworkdayjobs.com"]) &&
    exactFields(config, ["kind", "postedDatePolicy", "cityScopePolicy", "publicVisibilityPolicy", "countryFilter", "detailBaseUrl", "pageSize", "maxPages", "allowedApplyOrigins"]) &&
    !plan.workday && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource &&
    plan.json.jobsPath === "jobs" && plan.json.defaultCategory === "其他" &&
    exactFields(fields, ["sourceJobId", "officialTitle", "officialUrl", "locationRaw", "cities", "officialPublishedAt"]) &&
    fields.sourceJobId === "sourceJobId" && fields.officialTitle === "title" && fields.officialUrl === "officialUrl" &&
    fields.locationRaw === "locationRaw" && fields.cities === "cities" && fields.officialPublishedAt === "officialPublishedAt";
}
export function exactLillyChinaBootstrap(config: {
  widgetApiEndpoint: string; country: string; deviceType: string; locale: string; refNum: string; pageName: string; pageId: string;
}): boolean {
  return config.widgetApiEndpoint === "https://careers.lilly.com/widgets" && config.country === "us" &&
    config.deviceType === "desktop" && config.locale === "en_us" && config.refNum === "LILLUS" &&
    config.pageName === "search-results" && config.pageId === "page11-ds";
}

const RAW_FIELDS = new Set(["address", "applyUrl", "badge", "category", "city", "cityState", "cityStateCountry", "country",
  "dateCreated", "descriptionTeaser", "externalApply", "hiringManager", "isMultiCategory", "isMultiLocation", "jobId",
  "jobSeqNo", "jobVisibility", "latitude", "locale", "location", "longitude", "ml_job_parser", "ml_skills", "multi_category",
  "multi_category_array", "multi_location", "multi_location_array", "postedDate", "reqId", "siteType", "state", "title", "type",
  "visibilityType", "workerSubType"]);
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exactFields(value: object, fields: readonly string[]): boolean {
  return Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

/** Exact canonical official apply route, including same-requisition tail. */
function officialUrlLocation(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.reqId !== "string" || !/^R-\d+$/u.test(raw.reqId) || raw.jobId !== raw.reqId ||
    raw.jobSeqNo !== `LILLUS${raw.reqId.replace("-", "")}EXTERNALENUS` || typeof raw.applyUrl !== "string") return undefined;
  let url: URL; try { url = new URL(raw.applyUrl); } catch { return undefined; }
  if (url.origin !== "https://lilly.wd115.myworkdayjobs.com" || url.username || url.password || url.search || url.hash || url.href !== raw.applyUrl) return undefined;
  const match = /^\/LLY\/job\/([^/]+)\/([A-Za-z0-9_-]*)_(R-\d+)(?:-\d+)?\/apply$/u.exec(url.pathname);
  // Native detail supplies country and locality; new China URL tokens are not a source-wide failure.
  return match && match[3] === raw.reqId && /^(?:China|CN)-[A-Za-z-]+$/u.test(match[1]!) &&
    !explicitlyForeignOrNonMainlandLocation(match[1]!.replaceAll("-", " ")) ? match[1] : undefined;
}

// The exact contextual HQ introduction is company background. Remove only that
// prefix for location analysis; every appended clause is still examined.
const CORPORATE_INTRO = "At Lilly, we unite caring with discovery to make life better for people around the world. We are a global healthcare leader headquartered in Indianapolis, Indiana. Our employees around the world ";
const CURRENT_INTRO = "At Lilly, the work is demanding because patients are waiting. We unite caring with discovery to help make life better for people around the world, knowing that every decision, every detail, and ";
const NESTED_INTROS: Readonly<Record<string, readonly string[]>> = {
  descriptionTeaser_first200: [`${CORPORATE_INTRO}wo...`, `${CURRENT_INTRO}eve...`],
  descriptionTeaser_keyword: [`${CORPORATE_INTRO}work...`, `${CURRENT_INTRO}every...`],
  descriptionTeaser_ats: [`${CORPORATE_INTRO}work `, `${CURRENT_INTRO}every `, `${CURRENT_INTRO}every`]
};
const NON_LOCATION_TITLE_SUFFIXES = new Set(["Quality Assurance", "Associate", "Country Study Management", "QC Biological", "QC",
  "IDS Infrastructure", "Unified Experience", "Brand Management", "Legal Counsel", "QA Compliance", "External Innovation",
  "Neuroscience", "Site Operational Excellence Business Partner", "DIA", "PRA", "Digital HCP Engagement & Experience BP",
  "Lilly China", "免疫事业部", "免疫产品组", "心血管代谢健康事业部", "抗肿瘤事业部"]);
// Known non-mainland labels are contradiction evidence only inside an explicit
// workplace clause. A territory in a title or responsibility is merely pending.
// This vocabulary is not an exhaustive world gazetteer: unknown locations remain
// pending under the independently established structured mainland country scope.
const MAINLAND_TITLE_CITIES: ReadonlyArray<readonly [string, string]> = [
  ["Shanghai", "上海"], ["Beijing", "北京"], ["Suzhou", "苏州"], ["Guangzhou", "广州"], ["Shenzhen", "深圳"],
  ["Nanjing", "南京"], ["Hangzhou", "杭州"], ["Tianjin", "天津"], ["Chongqing", "重庆"], ["Wuhan", "武汉"],
  ["Chengdu", "成都"], ["Changsha", "长沙"], ["Jinan", "济南"], ["Dalian", "大连"], ["Zhejiang", "浙江"]
];
const PROFESSIONAL_SKILLS_WITH_LOCATION_WORDS = new Set(["microsoft office", "value-based pricing"]);
const REVIEWED_ROLE_PARENTHESES = new Set(["Sr", "Sr.", "Sr./Expert/Sr. Expert", "Sr./Principal", "Analytical Focus", "Biology Focus", "NGS sequencing Focus"]);
const FOREIGN_PLACE = /\b(?:united states|usa|u\.s\.?|boston|new york|san francisco|los angeles|seattle|indianapolis|indiana|singapore|japan|tokyo|osaka|kyoto|india|germany|france|paris|canada|australia|united kingdom|u\.k\.?|london|south korea|republic of korea|seoul|hong kong|macau|macao|taiwan|overseas|abroad)\b|美国|纽约|波士顿|旧金山|洛杉矶|西雅图|新加坡|日本|东京|大阪|京都|印度|德国|法国|巴黎|加拿大|澳大利亚|英国|伦敦|韩国|首尔|香港|澳门|台湾|海外|国外/iu;
const WORKPLACE_CLAUSES = [
  /(?:\b(?:(?:work|job|office)\s+(?:location|address)|location|office|workplace)(?:\s*[:：]\s*|\s+(?:is\s+)?))([^.;。；\r\n]+)/giu,
  /\b(?:based|located|stationed)\s+(?:in|at|out\s+of)\s+([^.;。；\r\n]+)/giu,
  /\brelocat(?:ion|e|ing)\s+to\s+([^.;。；\r\n]+)/giu,
  /\bwork(?:ing)?\s+(?:in|from|at)\s+([^.;。；\r\n]+)/giu,
  /\b(?:this\s+)?(?:role|position|job|office|workplace)\s+(?:is\s+|will\s+be\s+)(?:in|at)\s+([^.;。；\r\n]+)/giu,
  /\b([A-Za-z]+(?:[ -][A-Za-z]+)*)[ -]based\b/giu,
  /(?:工作地点|工作城市|办公地点|办公城市|岗位驻地|驻地)\s*(?:[:：]|为|是|在)\s*([^。；\r\n]+)/gu,
  /(?:本职位|本岗位|工作|办公)\s*(?:在|位于)\s*([^。；\r\n]+)/gu,
  /\bat\s+our\s+([^.;。；\r\n]+?)\s+site\b/giu
];
const LOCATION_SIGNAL = /\blocation\b|\bworkplace\b|\boffice\b|\bremote\b|\bbased\b|\blocated\b|\bstationed\b|\bheadquartered\b|工作地|工作城市|办公|驻地|本职位在|本岗位在/iu;

function textCityScope(raw: Record<string, unknown>): "AGREES" | "PENDING" | undefined {
  if (typeof raw.title !== "string" || !raw.title.trim() ||
    typeof raw.descriptionTeaser !== "string") return undefined;
  const title = raw.title.replace(/\s+/gu, " ").trim();
  const texts: string[] = [title, raw.descriptionTeaser];
  let pending = false;
  if (Object.hasOwn(raw, "ml_job_parser")) {
    if (!record(raw.ml_job_parser) || !exactFields(raw.ml_job_parser, ["descriptionTeaser", ...Object.keys(NESTED_INTROS)]) ||
      raw.ml_job_parser.descriptionTeaser !== raw.descriptionTeaser) return undefined;
    for (const [key, reviewed] of Object.entries(NESTED_INTROS)) {
      const value = raw.ml_job_parser[key];
      if (typeof value !== "string") return undefined;
      texts.push(value);
      // Novel prose survives, but does not silently inherit the old city confidence.
      if (!reviewed.includes(value)) pending = true;
    }
  }
  for (const key of ["category", "type", "workerSubType", "badge"]) {
    if (Object.hasOwn(raw, key)) {
      if (typeof raw[key] !== "string") return undefined;
      texts.push(raw[key] as string);
    }
  }
  for (const key of ["ml_skills", "multi_category"]) {
    if (Object.hasOwn(raw, key)) {
      if (!Array.isArray(raw[key]) || !(raw[key] as unknown[]).every(value => typeof value === "string")) return undefined;
      texts.push(...(raw[key] as string[]).filter(value => key !== "ml_skills" || !PROFESSIONAL_SKILLS_WITH_LOCATION_WORDS.has(value)));
    }
  }
  if (Object.hasOwn(raw, "multi_category_array")) {
    if (!Array.isArray(raw.multi_category_array)) return undefined;
    for (const value of raw.multi_category_array) {
      if (!record(value) || !exactFields(value, ["category"]) || typeof value.category !== "string") return undefined;
      texts.push(value.category);
    }
  }
  const aliases = raw.city === "Shanghai" ? ["Shanghai", "上海"] : raw.city === "Suzhou" ? ["Suzhou", "苏州"] : ["Zhejiang", "浙江"];
  const sameLocality = (value: string) => aliases.some(alias => [alias, `${alias}, China`, `${alias}, ${raw.state}, China`].includes(value.trim()));
  for (const original of texts) {
    let text = original.startsWith(CORPORATE_INTRO) ? original.slice(CORPORATE_INTRO.length) : original;
    let residual = text;
    for (const grammar of WORKPLACE_CLAUSES) {
      // Parse each grammar against the original text, never an already erased
      // suffix: a later "but based in Singapore" must remain independently visible.
      for (const match of text.matchAll(grammar)) {
        const before = text.slice(0, match.index);
        if (/\b(?:not|never)\s+(?:\w+\s+){0,2}$/iu.test(before) && !/\bnot\s+only\s+(?:\w+\s+){0,2}$/iu.test(before)) { pending = true; continue; }
        const place = match[1]!.trim();
        const targets = place.split(/\s*(?:\/|\band\b|和|或|、)\s*/iu);
        const inverted = /[ -]based\b/iu.test(match[0]) && !/^based\b/iu.test(match[0]);
        const foreignAtStart = new RegExp(`^(?:${FOREIGN_PLACE.source})`, "iu");
        const foreignAtEnd = new RegExp(`(?:${FOREIGN_PLACE.source})$`, "iu");
        if (targets.some(target => foreignAtStart.test(target)) || (inverted && foreignAtEnd.test(place))) return undefined;
        // A known place at the leading location slot can be followed by ordinary
        // responsibilities. Foreign business/customer text is not a workplace.
        const localPrefix = aliases.some(alias => place === alias || place.startsWith(`${alias} `) || place.startsWith(`${alias},`));
        if (!sameLocality(place) && !localPrefix) pending = true;
        residual = residual.replace(match[0], "");
      }
    }
    text = residual;
    // Reviewed business-unit text is not a new workplace. A mismatch still
    // removes exact-city confidence while retaining the positively China row.
    if (text.includes("business units in Shanghai")) {
      if (raw.city !== "Shanghai") pending = true;
      text = text.replaceAll("business units in Shanghai", "business units");
    }
    if (FOREIGN_PLACE.test(text) || LOCATION_SIGNAL.test(text)) pending = true;
  }
  for (const [english, chinese] of MAINLAND_TITLE_CITIES) {
    if ((new RegExp(`\\b${english}\\b`, "iu").test(title) || title.includes(chinese)) && raw.city !== english) pending = true;
  }
  for (const match of title.matchAll(/[（(]([^()（）]+)[)）]/gu)) {
    if (!REVIEWED_ROLE_PARENTHESES.has(match[1]!)) pending = true;
  }
  // A novel suffix may be a department or territory; retain it without guessing.
  const parts = title.split(/[-,，–—]/u);
  if (parts.length > 1 && !NON_LOCATION_TITLE_SUFFIXES.has(parts.at(-1)!.trim())) pending = true;
  return pending ? "PENDING" : "AGREES";
}

export function lillyPageEnvelopeValid(value: unknown): boolean {
  return record(value) && value.status === 200 && record(value.data) && Array.isArray(value.data.jobs) && value.hits === value.data.jobs.length;
}

/** Validate every geography surface before classifying a positively China row.
 * Duplicated identical alternatives are redundant labels, never extra jobs or
 * workplaces. Known contradictory primary/URL/coordinate shapes stay pending. */
export function lillyOfficialCities(raw: Record<string, unknown>): string[] | undefined {
  if (Object.keys(raw).some(key => !RAW_FIELDS.has(key)) || raw.country !== "China" || raw.isMultiLocation !== true ||
    raw.siteType !== "external" || raw.visibilityType !== "External" || raw.externalApply !== false || raw.locale !== "en_US" ||
    JSON.stringify(raw.jobVisibility) !== JSON.stringify(["external"])) return undefined;
  const textScope = textCityScope(raw);
  if (!textScope) return undefined;
  const urlLocation = officialUrlLocation(raw);
  if (!urlLocation) return undefined;
  const shanghai = raw.city === "Shanghai" && raw.state === "Shanghai";
  const suzhou = raw.city === "Suzhou" && raw.state === "Shanghai";
  const zhejiang = raw.city === "Zhejiang" && raw.state === "Zhejiang";
  if (!shanghai && !suzhou && !zhejiang) return undefined;
  const location = `${raw.city}, ${raw.state}, China`;
  const address = shanghai ? ["16F No.288 Shimen 1RD, Shanghai, 200041 Shanghai, China", "17F-19F No.288 Shimen 1RD, Shanghai, 200041 Shanghai, China"] :
    suzhou ? ["No.109, Fangzhong Jie SIP, Suzhou, 215126 Shanghai, China"] : ["Remote, Zhejiang, 999999 Zhejiang, China"];
  const top = shanghai ? ["31.22222", "121.45806"] : suzhou ? ["31.31092", "120.77415"] : ["0.0", "0.0"];
  const nested = shanghai ? [31.22222, 121.45806] : suzhou ? [31.311389, 120.618056] : [Number.MIN_VALUE, Number.MIN_VALUE];
  if (raw.location !== location || raw.cityStateCountry !== location || raw.cityState !== `${raw.city}, ${raw.state}` ||
    !address.includes(raw.address as string) || raw.latitude !== top[0] || raw.longitude !== top[1] ||
    !Array.isArray(raw.multi_location) || raw.multi_location.length < 1 || !raw.multi_location.every(value => value === location) ||
    !Array.isArray(raw.multi_location_array) || raw.multi_location_array.length !== raw.multi_location.length ||
    !raw.multi_location_array.every(value => record(value) && exactFields(value, ["location", "latlong"]) && value.location === location &&
      record(value.latlong) && exactFields(value.latlong, ["lat", "lon"]) && value.latlong.lat === nested[0] && value.latlong.lon === nested[1])) return undefined;
  // Optional non-location fields cannot smuggle nested geography under a known
  // key. Hiring-manager text is never interpreted or copied to public output.
  for (const key of ["hiringManager", "category", "type", "workerSubType", "badge", "dateCreated"]) {
    if (Object.hasOwn(raw, key) && typeof raw[key] !== "string") return undefined;
  }
  if (Object.hasOwn(raw, "dateCreated") && !lillyOfficialPostedDate(raw.dateCreated)) return undefined;
  for (const key of ["ml_skills", "multi_category"]) {
    if (Object.hasOwn(raw, key) && (!Array.isArray(raw[key]) || !(raw[key] as unknown[]).every(value => typeof value === "string"))) return undefined;
  }
  if ((Object.hasOwn(raw, "isMultiCategory") && raw.isMultiCategory !== false) ||
    (Object.hasOwn(raw, "multi_category_array") && (!Array.isArray(raw.multi_category_array) ||
      !raw.multi_category_array.every(value => record(value) && exactFields(value, ["category"]) && typeof value.category === "string")))) return undefined;
  return textScope === "AGREES" && shanghai && (urlLocation === "China-Shang-Hai-" || urlLocation === "CN-Shanghai-LAL") ? ["上海"] : [CITY_PENDING];
}

// Native Workday JobPosting is the primary workplace; Phenom's list repeats its
// Shanghai mailing address across jobs. Unknown native localities stay pending.
const NATIVE_CITIES: Readonly<Record<string, string>> = {
  "Shang Hai":"上海", "Bei Jing":"北京", "Suzhou-Manufacturing":"苏州", "Guang Zhou":"广州",
  "Nan Jing":"南京", "Ji Nan":"济南", "Urumuqi":"乌鲁木齐", "Hang Zhou":"杭州", "Xi An":"西安",
  "Chang Sha":"长沙", "Gui Yang":"贵阳", "Tian Jin":"天津", "Kun Ming":"昆明", "He Fei":"合肥",
  "Hu He Hao Te":"呼和浩特", "Zheng Zhou":"郑州", "Da Lian":"大连", "Yue Yang":"岳阳", "Quan Zhou":"泉州",
  "Zhu Hai":"珠海", "Chong Qing":"重庆", "Nan Chang":"南昌", "Fu Zhou - Fu Jian":"福州", "Xia Men":"厦门",
  "Wu Han":"武汉", "Shen Zhen":"深圳", "He Ze":"菏泽", "Shi Jia Zhuang":"石家庄", "An Shan":"鞍山",
  "Cang Zhou":"沧州", "Si Ping":"四平", "Wu Hai":"乌海", "E Er Duo Si":"鄂尔多斯",
  "Zhu Ma Dian":"驻马店", "Lang Fang":"廊坊", "Ning Bo":"宁波"
};
export function lillyNativeDetail(raw: Record<string, unknown>, artifact: SourceFetchArtifactDraft | undefined,
  startedAt: string): {status: "ACTIVE"; cities: string[]; locationRaw: string} | {status: "CLOSED"} | undefined {
  if (!artifact || !officialUrlLocation(raw) || artifact.logicalKey !== `lilly-detail-${raw.reqId}` ||
    artifact.kind !== "OFFICIAL_COMPANY_PAGE" || artifact.extractorLocator !== "lilly-workday-jobposting-v1" ||
    artifact.requestedUrl !== raw.applyUrl || artifact.finalUrl !== raw.applyUrl || artifact.httpStatus !== 200 ||
    !/^text\/html(?:;|$)/iu.test(artifact.contentType ?? "") || artifact.bodyRepresentation === "REDACTED" ||
    typeof artifact.body !== "string") return undefined;
  const time = Date.parse(artifact.capturedAt), start = Date.parse(startedAt);
  if (!Number.isFinite(time) || !Number.isFinite(start) || time < start || time > start + 30 * 60_000) return undefined;
  try {
    const $ = loadHtml(artifact.body);
    const jobs = $('script[type="application/ld+json"]').toArray().map(node => JSON.parse($(node).text()))
      .filter(value => record(value) && value["@type"] === "JobPosting");
    const workday = $('script:not([src])').toArray().map(node => $(node).text()).filter(text => /window\.workday\s*=/.test(text));
    const available = workday.some(text => /\bpostingAvailable:\s*true\b/.test(text) && !/\bpostingAvailable:\s*false\b/.test(text));
    if (available && workday.some(text => /\bpostingAvailable:\s*false\b/.test(text))) return undefined;
    // A closed Workday shell has no JD; its own og:url still binds the listed requisition.
    if (workday.length === 1 && /\bpostingAvailable:\s*false\b/.test(workday[0]!) &&
      !/\bpostingAvailable:\s*true\b/.test(workday[0]!) && /\btenant:\s*["']lilly["']/.test(workday[0]!) &&
      /\bsiteId:\s*["']LLY["']/.test(workday[0]!) && $('script[type="application/ld+json"]').length === 0 &&
      $('meta[property="og:url"]').length === 1 && $('meta[property="og:url"]').attr("content") === raw.applyUrl) return {status: "CLOSED"};
    const job = jobs.length === 1 ? jobs[0] : undefined;
    if (!available || !record(job) || !record(job.identifier) || job.identifier.value !== raw.reqId ||
      typeof job.title !== "string" || typeof raw.title !== "string" ||
      loadHtml(job.title).text().replace(/\s+/gu, " ").trim() !== raw.title.replace(/\s+/gu, " ").trim() ||
      typeof job.description !== "string" || !job.description.trim() ||
      typeof job.datePosted !== "string" || lillyOfficialPostedDate(raw.postedDate)?.slice(0, 10) !== job.datePosted ||
      !record(job.jobLocation) || !record(job.jobLocation.address)) return undefined;
    const address = job.jobLocation.address;
    if (address.addressCountry !== "China" || typeof address.addressLocality !== "string" || !address.addressLocality.trim() ||
      explicitlyForeignOrNonMainlandLocation(address.addressLocality)) return undefined;
    const city = NATIVE_CITIES[address.addressLocality.replace(/^CN: /u, "")];
    return {status: "ACTIVE", cities: [city ?? CITY_PENDING], locationRaw: `${address.addressLocality}, China`};
  } catch { return undefined; }
}

export function lillyClosedLoss(raw: Record<string, unknown>, pageSequence: number, recordIndex: number,
  recordedAt: string): PersistentSourceFetchEvidence["fetchLosses"][number] {
  return {stage: "VALIDATION", reason: "Lilly official application explicitly no longer accepts applicants",
    rawLocator: `phenom-page-${String(pageSequence).padStart(4, "0")}#record:${recordIndex}#${irreversibleOfficialJsonEvidenceId([recordIndex, raw])}`,
    details: {code: "LILLY_OFFICIAL_APPLICATION_CLOSED", pageSequence, recordIndex}, recordedAt};
}

/** Only consumed after the complete source and exact closure ledger have passed replay. */
export function lillyClosedSourceJobIds(evidence: PersistentSourceFetchEvidence): Set<string> {
  return new Set(evidence.fetchLosses.filter(loss => loss.details?.code === "LILLY_OFFICIAL_APPLICATION_CLOSED").map(loss => {
    const page = evidence.artifacts.find(artifact => artifact.logicalKey === `phenom-page-${String(loss.details!.pageSequence).padStart(4, "0")}`)!;
    const raw = JSON.parse(typeof page.body === "string" ? page.body : Buffer.from(page.body).toString("utf8"))
      .refineSearch.data.jobs[loss.details!.recordIndex as number];
    return persistentOfficialJsonJobId(raw.jobSeqNo);
  }));
}
