import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import { CITY_PENDING } from "../domain/jobLocation";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { currentOfficialSourceAttemptSignal, fetchWithOfficialTimeout, officialHttpTimeoutMs } from "./officialHttpRuntimeLimits";
import type { WorkdayHttpRequest, WorkdayDetailHttpRequest, WorkdayHttpResponse } from "./workdaySourceFetch";

export const AMGEN_MAINLAND_POLICY = "AMGEN_MAINLAND_DETAIL_V1" as const;
export const CSL_MAINLAND_POLICY = "CSL_MAINLAND_DETAIL_V1" as const;
export const WORKDAY_MAINLAND_SOURCE_BODY_LIMIT = 8 * 1024 * 1024;
export const WORKDAY_MAINLAND_MAX_DETAILS = 32;
export const WORKDAY_MAINLAND_BODY_LIMIT = 2 * 1024 * 1024;
export const WORKDAY_MAINLAND_DETAIL_BODY_LIMIT = 1024 * 1024;
const CHINA_ID = "6cb77610a8a543aea2d6bc10457e35d4";
const PROFILES = {
  "source-amgen-china-social": { companyId: "company-amgen-china", name: "安进中国", tenant: "amgen", site: "Careers",
    entry: "https://amgen.wd1.myworkdayjobs.com/Careers", chain: "https://careers.amgen.com/en/location/china-jobs/87/1814991/2",
    countryFacet: "LocationCountry", policy: AMGEN_MAINLAND_POLICY, maxPages: 3 },
  "source-csl-china-social": { companyId: "company-csl-china", name: "杰特贝林", tenant: "csl", site: "CSL_External",
    entry: "https://csl.wd1.myworkdayjobs.com/zh-CN/CSL_External", chain: "https://www.csl.com/careers",
    countryFacet: "locationCountry", policy: CSL_MAINLAND_POLICY, maxPages: 10 }
} as const;
type Profile = typeof PROFILES[keyof typeof PROFILES];
const record = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) => keys.every(key => Object.hasOwn(v, key));
const hash = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const normalizedText = (v: string) => v.replace(/\s+/gu, " ").trim();
const bodyText = (a: SourceFetchArtifactDraft) => typeof a.body === "string" ? a.body : Buffer.from(a.body).toString("utf8");
function profile(plan: SourceCrawlPlan): Profile | undefined { return PROFILES[plan.source.id as keyof typeof PROFILES]; }
export function hasWorkdayMainlandSource(sourceId: string): boolean { return Object.hasOwn(PROFILES, sourceId); }
export function requiresWorkdayMainlandQuality(plan: SourceCrawlPlan): boolean {
  return hasWorkdayMainlandSource(plan.source.id) || (plan.adapterId === "official-json" && plan.workday?.mainlandQualityPolicy !== undefined);
}
export function exactWorkdayMainlandQualityPlan(plan: SourceCrawlPlan): boolean {
  const p = profile(plan);
  return !!p && plan.adapterId === "official-json" && plan.company.id === p.companyId && plan.source.companyId === p.companyId &&
    plan.company.officialChineseName === p.name && plan.company.category === "FOREIGN_PHARMA" && plan.source.kind === "SOCIAL" &&
    plan.source.atsKind === "WORKDAY" && plan.source.status === "VERIFIED_SCRAPABLE" && plan.source.officialEntryUrl === p.entry &&
    plan.source.officialChainEvidenceUrl === p.chain && same(plan.workday, { tenant: p.tenant, site: p.site,
      ...(p.tenant === "amgen" ? { laterZeroTotalPolicy: "AMGEN_AUDITED_EXACT_RECONCILIATION" } : {}),
      appliedFacets: { [p.countryFacet]: [CHINA_ID] }, pageSize: 20, maxPages: p.maxPages, mainlandQualityPolicy: p.policy }) &&
    same(plan.json, { jobsPath: "jobPostings", fields: { sourceJobId: "sourceJobId", officialTitle: "title",
      officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" }, defaultCategory: "其他" }) &&
    !plan.officialJsonFetch && !plan.moka && !plan.hotjob && !plan.hotjobLegacy && !plan.profileBoundSource;
}

// City vocabulary only, never job IDs or live counts. Ambiguous transliterations
// are deliberately excluded from canonical mapping even when mainland is proven.
const CITIES: Readonly<Record<string, string>> = {
  Shanghai: "上海", Beijing: "北京", Guangzhou: "广州", Tianjin: "天津", Wenzhou: "温州", Nantong: "南通", Nanjing: "南京",
  Suzhou: "苏州", Shenzhen: "深圳", Hangzhou: "杭州", Wuhan: "武汉", Chengdu: "成都", Chongqing: "重庆", Zhengzhou: "郑州",
  Shenyang: "沈阳", Changsha: "长沙", Xuzhou: "徐州", Nanning: "南宁", Nanchang: "南昌", Kunming: "昆明", Guiyang: "贵阳", Yuxi: "玉溪", Jieyang: "揭阳",
  Lianyungang: "连云港", Ordos: "鄂尔多斯", Dali: "大理", Yueyang: "岳阳", Qinhuangdao: "秦皇岛", "Yulin (Shaanxi)": "榆林",
  Yichang: "宜昌", Jiaozuo: "焦作", Kaifeng: "开封", Zhumadian: "驻马店", Zhoukou: "周口", Liuzhou: "柳州", Wuhu: "芜湖",
  Shantou: "汕头", "Xi'an": "西安", Xiamen: "厦门", Urumqi: "乌鲁木齐",
  Harbin: "哈尔滨", Nanchong: "南充", Xinxiang: "新乡", Neijiang: "内江"
};
const CSL_FIELD_SALES = "APAC, CN, Field Sales, CSL Behring";
const PENDING_NAMES = new Set(["Taizhou", "JTaizhou", "Longnan", "Fuyang", "Field/Remote", "Xing'an Meng", "Zhaoqing", "Jingmen"]);
function descriptorCity(p: Profile, descriptor: unknown): string | undefined {
  if (!text(descriptor) || explicitlyForeignOrNonMainlandLocation(descriptor)) return undefined;
  if (p.tenant === "csl" && descriptor === CSL_FIELD_SALES) return CITY_PENDING;
  const name = p.tenant === "amgen" ? /^China\s+- (.+)$/u.exec(descriptor)?.[1]
    : /^APAC, CN, (.+), CSL Behring$/u.exec(descriptor)?.[1];
  if (!name) return undefined;
  return CITIES[name] ?? CITY_PENDING;
}
function titleCities(title: string): string[] {
  const aliases = [...Object.entries(CITIES), ...[...PENDING_NAMES].filter(name => name !== "Field/Remote").map(name => [name, CITY_PENDING] as const)];
  return [...new Set(aliases.flatMap(([name, city]) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^a-z])${escaped}(?=$|[^a-z])`, "iu").test(title) || title.includes(city) ? [city] : [];
  }))];
}
/** Reuse the conservative vocabulary on independently verified native detail locations. */
export function projectAmgenNativeCities(title: string, locations: readonly string[], requisitionDescriptor: string): string[] | undefined {
  const p = PROFILES["source-amgen-china-social"], mapped = locations.map(value => descriptorCity(p, value)), reqCity = descriptorCity(p, requisitionDescriptor);
  if (!mapped.length || mapped.some(city => !city) || !reqCity) return undefined;
  const cities = [...new Set(mapped as string[])];
  return cities.includes(CITY_PENDING) || (reqCity !== CITY_PENDING && !cities.includes(reqCity)) || conflict(title, cities) ? [CITY_PENDING] : cities;
}
function conflict(title: string, cities: readonly string[]): boolean { return titleCities(title).some(city => !cities.includes(city)); }
function slug(descriptor: string): string { return descriptor.replace(/[()']/gu, "").replace(/, /gu, "-").replace(/ /gu, "-"); }
export type MainlandWorkdayRow = { raw: Record<string, unknown>; path: string; reqId: string; title: string; opaqueCount?: number; listCity?: string; requiresDetail: boolean };
export function parseWorkdayMainlandRow(plan: SourceCrawlPlan, candidate: unknown): MainlandWorkdayRow | undefined {
  const p = profile(plan), raw = record(candidate);
  if (!p || !raw ||
    !text(raw.title) || !text(raw.externalPath) || !text(raw.locationsText) ||
    !Array.isArray(raw.bulletFields)) return undefined;
  const bullets = raw.bulletFields;
  const requisitions = bullets.filter(value => typeof value === "string" && /^R-[1-9][0-9]*$/u.test(value));
  const reqId = p.tenant === "amgen" && bullets.length === 1 ? bullets[0] : p.tenant === "csl" &&
    requisitions.length === 1 && bullets.filter(value => value === "China").length === 1 ? requisitions[0] : undefined;
  const pathMatch = /^\/job\/([A-Za-z0-9-]+)\/([A-Za-z0-9-]+_(R-[0-9]+)(?:-[1-9][0-9]*)?)$/u.exec(raw.externalPath);
  if (!text(reqId) || !/^R-[1-9][0-9]*$/u.test(reqId) || pathMatch?.[3] !== reqId) return undefined;
  const opaque = /^([2-9][0-9]*) Locations$/u.exec(raw.locationsText), opaqueCount = opaque ? Number(opaque[1]) : undefined;
  const listCity = descriptorCity(p, raw.locationsText);
  if (opaqueCount === undefined && (!listCity || pathMatch[1] !== slug(raw.locationsText))) return undefined;
  if (opaqueCount !== undefined && (!Number.isSafeInteger(opaqueCount) || opaqueCount > 100)) return undefined;
  const title = normalizedText(raw.title);
  return { raw, path: raw.externalPath, reqId, title, ...(opaqueCount !== undefined ? { opaqueCount } : {}),
    ...(listCity ? { listCity } : {}), requiresDetail: opaqueCount !== undefined || (p.tenant === "csl" && raw.locationsText === CSL_FIELD_SALES) || (listCity !== CITY_PENDING && !!listCity && conflict(title, [listCity])) };
}
export function workdayMainlandDetailUrl(plan: SourceCrawlPlan, row: MainlandWorkdayRow): string {
  const p = profile(plan)!; return `${new URL(p.entry).origin}/wday/cxs/${p.tenant}/${p.site}${row.path}`;
}
export function workdayMainlandDetailLocator(plan: SourceCrawlPlan, row: MainlandWorkdayRow, sequence: number, recordIndex: number): string {
  return requestContractV2Locator("$.jobPostingInfo", { family: "workday", role: "mainland-detail", method: "GET",
    url: workdayMainlandDetailUrl(plan, row), body: null, coordinate: { sequence, recordIndex, externalPath: row.path, requisitionId: row.reqId } });
}
export type MainlandProjection = { sourceJobId: string; title: string; officialUrl: string; locationRaw: string; cities: string[]; locations: string[] };
function country(value: unknown, alpha2: boolean): boolean {
  const v = record(value); return !!v && exactKeys(v, ["descriptor", "id", ...(alpha2 ? ["alpha2Code"] : [])]) &&
    v.descriptor === "China" && v.id === CHINA_ID && (!alpha2 || v.alpha2Code === "CN");
}
export function projectWorkdayMainlandRow(plan: SourceCrawlPlan, row: MainlandWorkdayRow, detailBody?: string): MainlandProjection | undefined {
  const p = profile(plan)!; let locations: string[] = [row.raw.locationsText as string]; let descriptorConflict = false;
  const officialUrl = `${new URL(p.entry).origin}/${p.site}${row.path}`;
  if (row.requiresDetail !== (detailBody !== undefined)) return undefined;
  if (detailBody !== undefined) {
    if (Buffer.byteLength(detailBody, "utf8") > WORKDAY_MAINLAND_DETAIL_BODY_LIMIT || !hasUniqueJsonObjectKeys(detailBody)) return undefined;
    const root = record(JSON.parse(detailBody)), info = record(root?.jobPostingInfo), requisition = record(info?.jobRequisitionLocation);
    if (!root || root.userAuthenticated !== false || !info || !text(info.id) || !/^[a-f0-9]{32}$/u.test(info.id) || !text(info.title) || normalizedText(info.title) !== row.title ||
      info.jobReqId !== row.reqId || info.jobPostingId !== row.path.split("/").at(-1) || info.jobPostingSiteId !== p.site ||
      info.externalUrl !== officialUrl || info.posted !== true || info.canApply !== true || !country(info.country, false) ||
      !requisition || !exactKeys(requisition, ["descriptor", "country"]) || !country(requisition.country, true) || !descriptorCity(p, requisition.descriptor) ||
      !text(info.location) ||
      (info.additionalLocations !== undefined && !Array.isArray(info.additionalLocations))) return undefined;
    locations = [info.location, ...(info.additionalLocations as unknown[] | undefined ?? [])] as string[];
    if (!locations.every(value => descriptorCity(p, value)) || new Set(locations).size !== locations.length ||
      (row.opaqueCount !== undefined ? locations.length !== row.opaqueCount : locations.length !== 1 || info.location !== row.raw.locationsText) ||
      row.path.split("/")[2] !== slug(info.location)) return undefined;
    const reqCity = descriptorCity(p, requisition.descriptor)!;
    descriptorConflict = reqCity !== CITY_PENDING && !locations.some(value => descriptorCity(p, value) === reqCity);
  }
  const cities = [...new Set(locations.map(value => descriptorCity(p, value)!))];
  return { sourceJobId: `workday:sha256:${hash(row.path)}`, title: row.title, officialUrl, locationRaw: locations.join(" | "), locations,
    cities: cities.includes(CITY_PENDING) || descriptorConflict || conflict(row.title, cities) ? [CITY_PENDING] : cities };
}

function facetGroups(v: unknown, parameter: string): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.flatMap(child => facetGroups(child, parameter));
  const r = record(v); return r ? [...(r.facetParameter === parameter ? [r] : []), ...facetGroups(r.values, parameter)] : [];
}
function firstFacets(p: Profile, root: Record<string, unknown>): boolean {
  const countries=facetGroups(root.facets,p.countryFacet);
  if(countries.length!==1||!Array.isArray(countries[0]!.values))return false;
  const china=countries[0]!.values.map(record).filter(value=>value&&(value.id===CHINA_ID||value.descriptor==='China'));
  return china.length===1&&china[0]!.id===CHINA_ID&&china[0]!.descriptor==='China'&&china[0]!.count===root.total;
}
function exactArtifact(a: SourceFetchArtifactDraft, url: string, limit: number): boolean {
  return a.requestedUrl === url && a.finalUrl === url && a.httpStatus === 200 && /^application\/json(?:\s*;|$)/iu.test(a.contentType ?? "") &&
    (a.bodyRepresentation === undefined || a.bodyRepresentation === "EXACT") && a.rawBodySha256 === undefined && a.redactionDescriptors === undefined &&
    Buffer.byteLength(bodyText(a), "utf8") <= limit;
}
export function projectWorkdayMainlandEvidence(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence): MainlandProjection[] | undefined {
  if(evidence.jobQuarantines?.length&&!verifyWorkdayJobQuarantines(plan,evidence))return undefined;
  if (!exactWorkdayMainlandQualityPlan(plan) || evidence.fetchLosses.some(loss=>loss.details.code!=='JOB_QUARANTINED') || !evidence.pages.length) return undefined;
  const p = profile(plan)!, endpoint = `${new URL(p.entry).origin}/wday/cxs/${p.tenant}/${p.site}/jobs`;
  const artifacts = new Map(evidence.artifacts.map(a => [a.logicalKey, a])), used = new Set<string>(), ids = new Set<string>();
  if (artifacts.size !== evidence.artifacts.length || evidence.pages.length > p.maxPages ||
    evidence.artifacts.reduce((sum, a) => sum + Buffer.byteLength(bodyText(a), "utf8"), 0) > WORKDAY_MAINLAND_SOURCE_BODY_LIMIT ||
    evidence.artifacts.filter(a => a.logicalKey.startsWith("workday-detail-")).length > WORKDAY_MAINLAND_MAX_DETAILS) return undefined;
  const jobs: MainlandProjection[] = []; let total: number | undefined;
  for (let sequence = 0; sequence < evidence.pages.length; sequence++) {
    const page = evidence.pages[sequence]!, key = `workday-page-${String(sequence).padStart(4, "0")}`, a = artifacts.get(key);
    if (page.sequence !== sequence || page.artifactLogicalKey !== key || !a || a.kind !== "PAGINATION_PAGE" || !exactArtifact(a, endpoint, WORKDAY_MAINLAND_BODY_LIMIT)) return undefined;
    used.add(key); const body = bodyText(a);
    if (!hasUniqueJsonObjectKeys(body) || page.responseFingerprintSha256 !== hash(body)) return undefined;
    const root = record(JSON.parse(body));
    if (!root || !count(root.total) || !Array.isArray(root.jobPostings)) return undefined;
    if (sequence === 0) { total = root.total; if (!firstFacets(p, root)) return undefined; }
    else if (p.tenant === "amgen" && root.total === 0) { if (!same(root.facets, [])) return undefined; }
    else if (root.total !== total || !firstFacets(p, root)) return undefined;
    if (page.declaredTotal !== root.total || root.jobPostings.length !== Math.min(20, total! - sequence * 20) ||
      a.extractorLocator !== requestContractV2Locator("$.total", { family: "workday", role: "page", method: "POST", url: endpoint,
        body: { appliedFacets: { [p.countryFacet]: [CHINA_ID] }, limit: 20, offset: sequence * 20 },
        coordinate: { sequence, requestedOffset: sequence * 20, requestedPage: sequence, requestedPageSize: 20 } })) return undefined;
    const rawIds: string[] = [], validIds: string[] = [];
    for (let index = 0; index < root.jobPostings.length; index++) {
      const raw = root.jobPostings[index], row = parseWorkdayMainlandRow(plan, raw);
      rawIds.push(workdayRawObservationId(plan,raw,sequence,index));
      if(evidence.jobQuarantines?.some(q=>q.pageSequence===sequence&&q.recordIndex===index)){
        const detailKey=`workday-detail-${String(sequence).padStart(4,'0')}-${String(index).padStart(4,'0')}`,detail=artifacts.get(detailKey);
        if(detail){if(!row||detail.requestedUrl!==workdayMainlandDetailUrl(plan,row)||detail.extractorLocator!==workdayMainlandDetailLocator(plan,row,sequence,index))return undefined;used.add(detailKey);}
        continue;
      }
      if (!row || ids.has(row.reqId)) return undefined;
      ids.add(row.reqId); let detailBody: string | undefined;
      if (row.requiresDetail) {
        const detailKey = `workday-detail-${String(sequence).padStart(4, "0")}-${String(index).padStart(4, "0")}`, detail = artifacts.get(detailKey);
        if (!detail || detail.kind !== "ATS_API_RESPONSE" || !exactArtifact(detail, workdayMainlandDetailUrl(plan, row), WORKDAY_MAINLAND_DETAIL_BODY_LIMIT) ||
          detail.extractorLocator !== workdayMainlandDetailLocator(plan, row, sequence, index)) return undefined;
        used.add(detailKey); detailBody = bodyText(detail);
      }
      const job = projectWorkdayMainlandRow(plan, row, detailBody); if (!job) return undefined;
      jobs.push(job); validIds.push(`sha256:${hash(JSON.stringify(job.sourceJobId))}`);
    }
    if (!same(page.rawJobIds, rawIds) || !same(page.validJobIds, validIds)) return undefined;
  }
  const counts = evidence.fetchCounts;
  const quarantined=evidence.jobQuarantines?.length??0;
  if (used.size !== artifacts.size || jobs.length+quarantined !== total || evidence.pages.length !== Math.max(1, Math.ceil(total! / 20)) ||
    counts.rawCount !== total || counts.parsedCount !== total || counts.validCount+quarantined !== total || counts.parseDiscardCount || counts.validationDiscardCount!==quarantined) return undefined;
  return jobs;
}
export function replayWorkdayMainlandQuality(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence, output: readonly NormalizedJobRecord[], capturedAt: string): boolean {
  if (!requiresWorkdayMainlandQuality(plan)) return true;
  const rows = projectWorkdayMainlandEvidence(plan, evidence);
  if (!rows || output.length !== rows.length || new Set(output.map(j => j.sourceJobId)).size !== output.length) return false;
  const p = profile(plan)!, byId = new Map(rows.map(r => [r.sourceJobId, r]));
  return output.every(job => {
    const row = job.sourceJobId ? byId.get(job.sourceJobId) : undefined;
    return row && typeof job.isBaseline === "boolean" && same(job, { companyId: p.companyId, sourceId: plan.source.id, sourceKind: "SOCIAL", atsKind: "WORKDAY",
      officialChineseCompanyName: p.name, officialTitle: row.title, officialUrl: row.officialUrl, listUrl: p.entry,
      sourceJobId: row.sourceJobId, locationRaw: row.locationRaw, cities: row.cities, category: "其他", isBaseline: job.isBaseline,
      evidence: { officialEntryUrl: p.entry, officialChainEvidenceUrl: p.chain, capturedAt } });
  });
}

/** Exact-source transport only. The deadline and source cancellation remain live
 * through bounded body consumption, with no redirects or retry route. */
export async function fetchWorkdayMainlandHttp(request: WorkdayHttpRequest | WorkdayDetailHttpRequest): Promise<WorkdayHttpResponse> {
  const controller = new AbortController(), source = currentOfficialSourceAttemptSignal();
  const abort = () => controller.abort(source?.reason), deadline = setTimeout(() => controller.abort(new Error("Workday mainland body deadline exceeded")), officialHttpTimeoutMs());
  if (source?.aborted) abort(); else source?.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => { void reader?.cancel(controller.signal.reason).catch(() => undefined); };
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await fetchWithOfficialTimeout(request.url, { method: request.method, headers: request.headers,
      ...("body" in request ? { body: request.body } : {}), signal: controller.signal, redirect: "error" });
    const limit = request.method === "GET" ? WORKDAY_MAINLAND_DETAIL_BODY_LIMIT : WORKDAY_MAINLAND_BODY_LIMIT;
    const declared = response.headers.get("content-length");
    if (declared && (!/^[0-9]+$/u.test(declared) || Number(declared) > limit)) { void response.body?.cancel().catch(() => undefined); throw Error("Workday mainland body exceeds byte limit"); }
    if (!response.body) throw Error("Workday mainland response body is missing");
    reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      controller.signal.throwIfAborted(); const chunk = await reader.read(); controller.signal.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.byteLength; if (length > limit) { void reader.cancel().catch(() => undefined); throw Error("Workday mainland body exceeds byte limit"); }
      chunks.push(chunk.value);
    }
    return { status: response.status, finalUrl: response.url, contentType: response.headers.get("content-type") ?? "",
      body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), capturedAt: new Date().toISOString() };
  } finally { clearTimeout(deadline); source?.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", cancel); reader?.releaseLock(); }
}
import {verifyWorkdayJobQuarantines,workdayRawObservationId} from './workdayJobQuarantine';
