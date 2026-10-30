import { load } from "cheerio";
import { CITY_PENDING } from "../domain/jobLocation";
import { phenomOfficialPostedDate } from "./phenomOfficialPostedDate";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { sensitiveOfficialJsonField, officialJsonRawLocator, persistentOfficialJsonJobId } from "./officialJsonEvidence";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";

export const ROCHE_NATIVE_DETAIL_POLICY = "ROCHE_WORKDAY_NATIVE_V1" as const;
const ORIGIN = "https://roche.wd3.myworkdayjobs.com";
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const clean = (value: string) => value.trim().replace(/\s+/gu, " ");
// Locality aliases corroborate official Chinese labels; they never rewrite them.
const CITIES: Record<string, string> = {
  Shanghai:"上海", Beijing:"北京", Zhengzhou:"郑州", Chengdu:"成都", Hangzhou:"杭州", Guangzhou:"广州", Shenyang:"沈阳",
  Wuhan:"武汉", Changsha:"长沙", Tianjin:"天津", Nanjing:"南京", Shenzhen:"深圳", Taiyuan:"太原", Harbin:"哈尔滨",
  Urumqi:"乌鲁木齐", Xian:"西安", Suzhou:"苏州", Nanchang:"南昌", Dalian:"大连", Kaifeng:"开封", Ningbo:"宁波",
  Zhuzhou:"株洲", Guiyang:"贵阳", Jiaxing:"嘉兴", Jinan:"济南", Neijiang:"内江", Qingdao:"青岛", Xuzhou:"徐州",
  Yinchuan:"银川", Xiamen:"厦门", Changchun:"长春", Maoming:"茂名", Chongqing:"重庆", Shijiazhuang:"石家庄",
  Shaoxing:"绍兴", Shaoyang:"邵阳", Kunming:"昆明"
};

/** The listed native URL owns its entire publication path, including a returned -1 suffix. */
export function rocheNativeDetailUrl(raw: Record<string, unknown>): string | undefined {
  if (!text(raw.reqId) || !/^\d{6}-\d+$/u.test(raw.reqId) || raw.jobId !== raw.reqId ||
    raw.jobSeqNo !== `ROCHGLOBAL${raw.reqId.replace("-", "")}EXTERNALZHCN` || !text(raw.applyUrl)) return undefined;
  try {
    const url = new URL(raw.applyUrl);
    if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash || url.href !== raw.applyUrl) return undefined;
    const match = /^\/roche-ext(\/job\/[^/]+\/[^/]*_(\d{6}-\d+)(?:-[1-9]\d*)?)\/apply$/u.exec(url.pathname);
    return match?.[2] === raw.reqId ? `${ORIGIN}/wday/cxs/roche/roche-ext${match[1]}` : undefined;
  } catch { return undefined; }
}

function rocheDetailBound(raw: Record<string, unknown>, artifact: SourceFetchArtifactDraft | undefined, startedAt: string, status: number): boolean {
  const url = rocheNativeDetailUrl(raw), time = artifact && Date.parse(artifact.capturedAt), start = Date.parse(startedAt);
  if (!url || !artifact || artifact.logicalKey !== `roche-detail-${raw.reqId}` || artifact.kind !== "ATS_API_RESPONSE" ||
    artifact.requestedUrl !== url || artifact.finalUrl !== url || artifact.httpStatus !== status || artifact.bodyRepresentation !== "EXACT" ||
    !/^application\/json(?:;|$)/iu.test(artifact.contentType ?? "") || artifact.extractorLocator !== "roche-workday-jobposting-v1" ||
    !Number.isFinite(time) || !Number.isFinite(start) || time! < start || time! > start + 30 * 60_000) return false;
  return true;
}

export function rocheNativeDetail(raw: Record<string, unknown>, artifact: SourceFetchArtifactDraft | undefined, startedAt: string):
  { title: string; officialUrl: string; locationRaw: string; cities: string[]; officialPublishedAt?: string } | undefined {
  if (!artifact || !rocheDetailBound(raw,artifact,startedAt,200) ||
    !text(raw.title) || raw.siteType !== "external" || raw.visibilityType !== "External" || raw.locale !== "zh_cn" ||
    !Array.isArray(raw.jobVisibility) || !raw.jobVisibility.includes("external") ||
    !Array.isArray(raw.multi_location) || !raw.multi_location.length || !raw.multi_location.every(text)) return undefined;
  const body = typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8");
  if (!hasUniqueJsonObjectKeys(body)) return undefined;
  let info: Record<string, unknown> | undefined;
  try { info = record(record(JSON.parse(body))?.jobPostingInfo); } catch { return undefined; }
  const externalUrl = (raw.applyUrl as string).replace(/\/apply$/u, "");
  if (!info || info.jobReqId !== raw.reqId || !text(info.title) || sensitiveOfficialJsonField({ title: info.title }) ||
    info.jobPostingSiteId !== "roche-ext" || info.jobPostingId !== new URL(externalUrl).pathname.split("/").at(-1) ||
    info.externalUrl !== externalUrl || info.posted !== true || info.canApply !== true || !text(info.jobDescription) ||
    !load(info.jobDescription).text().trim() || !text(info.location) ||
    (info.additionalLocations !== undefined && (!Array.isArray(info.additionalLocations) || !info.additionalLocations.every(text)))) return undefined;
  const mainland = raw.multi_location.filter(value => /(?:^|,\s*)中国大陆$/u.test(value));
  if (!mainland.length) return undefined;
  const listCities = [...new Set(mainland.map(value => value.split(",")[0]!.trim()))];
  const nativeLocations = [info.location, ...((info.additionalLocations as string[] | undefined) ?? [])];
  const nativeCities = [...new Set(nativeLocations.flatMap(value => CITIES[value] ? [CITIES[value]!] : []))];
  const nativeChina = record(info.country)?.descriptor === "China";
  // A foreign primary country needs a positively matching mainland alternative.
  if (!nativeChina && !nativeCities.some(city => listCities.includes(city))) return undefined;
  const unresolvedNative = nativeLocations.some(value => !CITIES[value] && (nativeChina || value === "China"));
  const cities = !unresolvedNative && listCities.length === nativeCities.length && listCities.every(city => nativeCities.includes(city))
    ? listCities : [CITY_PENDING];
  const postedDate = phenomOfficialPostedDate(raw.postedDate);
  const officialPublishedAt = postedDate && info.startDate === postedDate.slice(0, 10) ? postedDate : undefined;
  // Native title is authoritative after exact identity binding; both titles remain in their exact artifacts.
  return { title: clean(info.title), officialUrl: raw.applyUrl as string, locationRaw: mainland.map(clean).join(" | "), cities,
    ...(officialPublishedAt ? {officialPublishedAt} : {}) };
}

// Only the user-approved listed identity may retain old data on its exact official denial.
export function rocheDeniedDetail(raw: Record<string, unknown>, artifact: SourceFetchArtifactDraft | undefined, startedAt: string): boolean {
  if (raw.reqId !== "202610-125686" || !artifact || !rocheDetailBound(raw,artifact,startedAt,403)) return false;
  try { const body=typeof artifact.body==="string"?artifact.body:Buffer.from(artifact.body).toString("utf8");
    if(!hasUniqueJsonObjectKeys(body))return false;
    const denied=record(JSON.parse(body));
    return denied?.errorCode==="S22"&&denied.httpStatus===403&&denied.message==="permission denied";
  } catch { return false; }
}
export function rocheDeniedLoss(raw: Record<string, unknown>, pageSequence: number, recordIndex: number, recordedAt: string): PersistentSourceFetchEvidence["fetchLosses"][number] {
  return {stage:"VALIDATION",reason:"Roche approved official denial isolated; preserve existing row and its time",rawLocator:officialJsonRawLocator(raw,recordIndex),
    details:{code:"ROCHE_DETAIL_DENIED",pageSequence,recordIndex,noteCode:"NO_OMISSION_NOT_VERIFIED"},recordedAt};
}
/** Used only after strict replay has bound the loss to the exact fresh list/detail. */
export function rocheQuarantinedSourceJobIds(evidence: PersistentSourceFetchEvidence): Set<string> {
  return new Set(evidence.fetchLosses.some(loss=>loss.details.code==="ROCHE_DETAIL_DENIED")
    ?[persistentOfficialJsonJobId("ROCHGLOBAL202610125686EXTERNALZHCN")]:[]);
}
