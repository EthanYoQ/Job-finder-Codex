import type { SourceCrawlPlan } from "./sourcePlan";
import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";

/** Existing GSK source scope, not a new source or a partial-publication allowance. */
export function hasGskNativeDetailLocations(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json") return false;
  const config = plan.moka;
  return plan.source.id === "source-gsk-china-social" && plan.company.id === "company-gsk-china" &&
    plan.source.companyId === plan.company.id && plan.source.kind === "SOCIAL" && plan.source.atsKind === "MOKA" &&
    plan.source.officialEntryUrl === "https://app.mokahr.com/social-recruitment/gsk/148067#/" &&
    config?.requisitionStatusPolicy === "GSK_NATIVE_OPEN_REQUISITIONS_V1" &&
    config.expectedOrgId === "gsk" && config.expectedSiteId === "148067" && config.expectedMode === "social" &&
    config.campaignUrl === "https://app.mokahr.com/social-recruitment/gsk/148067" &&
    config.hydrateMissingLocationsFromDetail === true && config.allowDetailSiteIdOmission === true;
}

const MAINLAND_CITIES: Readonly<Record<string, string>> = {
  Shanghai: "上海", Beijing: "北京", Tianjin: "天津", Chongqing: "重庆", Guangzhou: "广州", Shenzhen: "深圳",
  Hangzhou: "杭州", Nanjing: "南京", Suzhou: "苏州", Wuhan: "武汉", Chengdu: "成都", Zhengzhou: "郑州",
  Shenyang: "沈阳", Changsha: "长沙", Xuzhou: "徐州", Nanning: "南宁", Guiyang: "贵阳", Wenzhou: "温州",
  Nantong: "南通", Ningbo: "宁波", Wuxi: "无锡", Jinan: "济南", Qingdao: "青岛", Fuzhou: "福州",
  Kunming: "昆明", Dalian: "大连", Taiyuan: "太原", Changchun: "长春", Harbin: "哈尔滨", Xiamen: "厦门",
  Shijiazhuang: "石家庄", Urumqi: "乌鲁木齐", "Xi'an": "西安", Dongguan: "东莞", Zhuhai: "珠海"
};
const locationFieldNames = new Map([
  ["271770", "Additional job posting locations"], ["277551", "Primary job posting location"],
  ["277552", "Additional locations"], ["279542", "Primary location"]
]);
const clean = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Match a complete explicit mainland city, optionally followed by one named facility.
 * Do not infer workplace from a title, company, business region, or city substring.
 * The facility grammar is independent of job IDs and observed result counts. */
export function gskPrimaryLocationCity(value: string): string | undefined {
  const text = clean(value);
  if (explicitlyForeignOrNonMainlandLocation(text) ||
      /香港|澳门|澳門|台湾|臺灣|新加坡|\b(?:hong[ -]*kong|taipei|kaohsiung|taichung|tainan|taoyuan|keelung)\b/iu.test(text)) return undefined;
  for (const [english, chinese] of Object.entries(MAINLAND_CITIES)) {
    if (text === chinese || text === `${chinese}市` || text.toLowerCase() === english.toLowerCase()) return chinese;
    if (!text.startsWith(`${english} `)) continue;
    const facility = text.slice(english.length + 1);
    if (!/^(?:[A-Z][A-Za-z0-9'-]* ){1,5}(?:Plaza|Office|Building|Campus|Center|Centre|Tower|Park)$/u.test(facility)) return undefined;
    // A second locality or a choice/remote marker is not a facility-only suffix.
    if (/\b(?:or|and|remote|hybrid|global|unknown|multiple|various|pending)\b/iu.test(facility) ||
        Object.keys(MAINLAND_CITIES).some(city => new RegExp(`\\b${city}\\b`, "iu").test(facility))) return undefined;
    return chinese;
  }
  return undefined;
}

/** Caller first binds the official HTTP request and detail identity. This also binds
 * the list row and both native workplace fields; the exact detail stays in evidence. */
export function gskCustomDetailLocations(raw: Record<string, unknown>, detail: Record<string, unknown>): {
  locations: Array<{ country: "中国"; cityName: string }>;
  locationRaw: string;
} {
  if (typeof raw.id !== "string" || !raw.id.trim() || detail.id !== raw.id || raw.orgId !== "gsk" || detail.orgId !== "gsk" ||
      typeof raw.title !== "string" || !clean(raw.title) || typeof detail.title !== "string" || clean(raw.title) !== clean(detail.title) ||
      raw.status !== "open" || detail.status !== "open" ||
      detail.siteId !== undefined && String(detail.siteId) !== "148067" ||
      !Array.isArray(raw.locations) || raw.locations.length !== 0 || !Array.isArray(detail.locations) || detail.locations.length !== 0 ||
      raw.publishedAt !== undefined && raw.publishedAt !== detail.publishedAt) throw Error("GSK custom location identity mismatch");
  const fields = record(detail.customFields);
  if (!fields) throw Error("GSK custom workplace fields missing");
  const fieldValue = (id: string, name: string): string => {
    const field = record(fields[id]);
    if (!field || Object.keys(field).sort().join(",") !== "name,value" || field.name !== name || typeof field.value !== "string") {
      throw Error("GSK custom workplace field shape changed");
    }
    return clean(field.value);
  };
  if (fieldValue("273744", "Req status") !== "Open") throw Error("GSK custom requisition is not Open");
  const posting = fieldValue("277551", "Primary job posting location");
  const workplace = fieldValue("279542", "Primary location");
  const city = gskPrimaryLocationCity(posting);
  if (!city || posting !== workplace || gskPrimaryLocationCity(workplace) !== city ||
      fieldValue("271770", "Additional job posting locations") !== "" ||
      fieldValue("277552", "Additional locations") !== "") throw Error("GSK custom workplace is unresolved or conflicting");
  for (const [id, value] of Object.entries(fields)) {
    const field = record(value);
    if (!locationFieldNames.has(id) && field && typeof field.name === "string" &&
        /location|country|city|工作地|地点|国家|城市/iu.test(field.name) && field.value != null && String(field.value).trim() !== "") {
      throw Error("GSK has an unreviewed custom workplace field");
    }
  }
  return { locations: [{ country: "中国", cityName: city }], locationRaw: posting };
}
