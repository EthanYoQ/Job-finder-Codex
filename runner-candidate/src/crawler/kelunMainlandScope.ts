import { load } from "cheerio";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import type { SourceFetchResult } from "./runSourceCrawl";
import type { NormalizedJobRecord } from "./normalizedJob";
import { parsePersistentSourceFetchEvidence, sha256Bytes, type PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "./paginationEvidence";

export const KELUN_MAINLAND_POLICY = "KELUN_CATEGORY_MAINLAND_V1" as const;
export const KELUN_CONFIG_SHA256 = "9fe0cb0d7c308567f6010aa6181f36c595b97df739ecd528cab97070f47572cb";
export const KELUN_ENTRY = "https://kelun.zhiye.com/social?r=&p=1%5E2&c=&d=&k=";
export function exactKelunMainlandPlan(plan: SourceCrawlPlan): boolean {
  return plan.adapterId === "html-table" && plan.executionAuthority === "STAGED" &&
    plan.source.id === "source-kelun-social" && plan.company.id === "company-kelun" &&
    plan.source.companyId === "company-kelun" && plan.source.officialEntryUrl === KELUN_ENTRY &&
    sourcePlanConfigSha256(plan) === KELUN_CONFIG_SHA256;
}
export type KelunScopeDecision = "MAINLAND" | "EXPLICIT_OUTSIDE" | "UNKNOWN";
// Source-local vocabulary copied from the reviewed repository CNSTAFF/Fosun
// province/prefecture identities. No job IDs, live counts or network lookup.
const PROVINCES = new Map<string, string>([
  ["北京", "11"],
  ["天津", "12"],
  ["河北", "13"],
  ["山西", "14"],
  ["内蒙古", "15"],
  ["辽宁", "21"],
  ["吉林", "22"],
  ["黑龙江", "23"],
  ["上海", "31"],
  ["江苏", "32"],
  ["浙江", "33"],
  ["安徽", "34"],
  ["福建", "35"],
  ["江西", "36"],
  ["山东", "37"],
  ["河南", "41"],
  ["湖北", "42"],
  ["湖南", "43"],
  ["广东", "44"],
  ["广西", "45"],
  ["海南", "46"],
  ["重庆", "50"],
  ["四川", "51"],
  ["贵州", "52"],
  ["云南", "53"],
  ["西藏", "54"],
  ["陕西", "61"],
  ["甘肃", "62"],
  ["青海", "63"],
  ["宁夏", "64"],
  ["新疆", "65"],
]);
const PREFECTURES: ReadonlyArray<readonly [string, string]> = [
  ["13", "石家庄 唐山 秦皇岛 邯郸 邢台 保定 张家口 承德 沧州 廊坊 衡水"],
  ["14", "太原 大同 阳泉 长治 晋城 朔州 晋中 运城 忻州 临汾 吕梁"],
  ["15", "呼和浩特 包头 乌海 赤峰 通辽 鄂尔多斯 呼伦贝尔 巴彦淖尔 乌兰察布 兴安盟 锡林郭勒盟 阿拉善盟"],
  ["21", "沈阳 大连 鞍山 抚顺 本溪 丹东 锦州 营口 阜新 辽阳 盘锦 铁岭 朝阳 葫芦岛"],
  ["22", "长春 吉林 四平 辽源 通化 白山 松原 白城 延边 延边朝鲜族自治州"],
  ["23", "哈尔滨 齐齐哈尔 鸡西 鹤岗 双鸭山 大庆 伊春 佳木斯 七台河 牡丹江 黑河 绥化 大兴安岭"],
  ["32", "南京 无锡 徐州 常州 苏州 南通 连云港 淮安 盐城 扬州 镇江 泰州 宿迁"],
  ["33", "杭州 宁波 温州 嘉兴 湖州 绍兴 金华 衢州 舟山 台州 丽水"],
  ["34", "合肥 芜湖 蚌埠 淮南 马鞍山 淮北 铜陵 安庆 黄山 滁州 阜阳 宿州 六安 亳州 池州 宣城"],
  ["35", "福州 厦门 莆田 三明 泉州 漳州 南平 龙岩 宁德"],
  ["36", "南昌 景德镇 萍乡 九江 新余 鹰潭 赣州 吉安 宜春 抚州 上饶"],
  ["37", "济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽"],
  ["41", "郑州 开封 洛阳 平顶山 安阳 鹤壁 新乡 焦作 濮阳 许昌 漯河 三门峡 南阳 商丘 信阳 周口 驻马店 济源"],
  ["42", "武汉 黄石 十堰 宜昌 襄阳 鄂州 荆门 孝感 荆州 黄冈 咸宁 随州 恩施 神农架 潜江 仙桃 天门"],
  ["43", "长沙 株洲 湘潭 衡阳 邵阳 岳阳 常德 张家界 益阳 郴州 永州 怀化 娄底 湘西"],
  ["44", "广州 韶关 深圳 珠海 汕头 佛山 江门 湛江 茂名 肇庆 惠州 梅州 汕尾 河源 阳江 清远 东莞 中山 潮州 揭阳 云浮"],
  ["45", "南宁 柳州 桂林 梧州 北海 防城港 钦州 贵港 玉林 百色 贺州 河池 来宾 崇左"],
  ["46", "海口 三亚 三沙 儋州"],
  ["51", "成都 自贡 攀枝花 泸州 德阳 绵阳 广元 遂宁 内江 乐山 南充 眉山 宜宾 广安 达州 雅安 巴中 资阳 阿坝 甘孜 凉山"],
  ["52", "贵阳 六盘水 遵义 安顺 毕节 铜仁 黔西南 黔东南 黔南"],
  ["53", "昆明 曲靖 玉溪 保山 昭通 丽江 普洱 临沧 楚雄 红河 文山 西双版纳 大理 德宏 怒江 迪庆"],
  ["54", "拉萨 日喀则 昌都 林芝 山南 那曲 阿里"],
  ["61", "西安 铜川 宝鸡 咸阳 渭南 延安 汉中 榆林 安康 商洛"],
  ["62", "兰州 嘉峪关 金昌 白银 天水 武威 张掖 平凉 酒泉 庆阳 定西 陇南 临夏 甘南"],
  ["63", "西宁 海东 海北 黄南 海南州 果洛 玉树 海西"],
  ["64", "银川 石嘴山 吴忠 固原 中卫"],
  ["65", "乌鲁木齐 克拉玛依 吐鲁番 哈密 昌吉 博尔塔拉 巴音郭楞 阿克苏 克孜勒苏 喀什 和田 伊犁 塔城 阿勒泰 石河子 阿拉尔 图木舒克 五家渠 北屯 铁门关 双河 可克达拉 昆玉 胡杨河 新星"],
];
const CITY_PROVINCES = new Map<string, string>([
  ...[...PROVINCES].filter(([, code]) => ["11", "12", "31", "50"].includes(code)),
  ...PREFECTURES.flatMap(([code, names]) => names.split(" ").map(name => [name, code] as [string, string]))
]);


// Exact Chengdu district tuples; positive province/city identity remains mandatory.
// Unlisted district tails and nationwide-only labels stay UNKNOWN.
const DISTRICTS = new Map([["成都", new Set(["青羊区", "双流区"])]]);
const OUTSIDE = new Set([
  "香港", "香港特别行政区", "香港特別行政區", "hong kong", "hong kong sar", "hong kong sar china",
  "澳门", "澳門", "澳门特别行政区", "澳門特別行政區", "macau", "macao",
  "台湾", "台灣", "taiwan", "美国", "united states", "usa", "英国", "united kingdom",
  "日本", "japan", "新加坡", "singapore", "德国", "germany", "法国", "france",
  "澳大利亚", "australia", "加拿大", "canada", "韩国", "south korea"
]);
const COUNTRY = new Set(["中国", "china", "cn", "中华人民共和国"]);
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const key = (value: string) => clean(value.normalize("NFKC")).toLowerCase();
function mainlandHierarchy(value: string): boolean {
  let parts = value.split(/[-·・]/u).map(key);
  if (COUNTRY.has(parts[0]!)) parts = parts.slice(1);
  if (!parts.length || parts.some(part => !part)) return false;
  if (parts.length === 1) {
    const core = parts[0]!.replace(/(?:维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/u, "");
    return PROVINCES.has(core) || CITY_PROVINCES.has(core);
  }
  const province = PROVINCES.get(parts[0]!.replace(/(?:维吾尔自治区|壮族自治区|回族自治区|自治区|省|市)$/u, ""));
  const city = parts[1]!.replace(/市$/u, "");
  return !!province && CITY_PROVINCES.get(city) === province &&
    (parts.length === 2 || parts.length === 3 && DISTRICTS.get(city)?.has(parts[2]!) === true);
}
function outsideHierarchy(value: string): boolean {
  if (OUTSIDE.has(key(value))) return true;
  const parts = value.split(/[-·・]/u).map(key);
  return parts.length === 2 && COUNTRY.has(parts[0]!) && OUTSIDE.has(parts[1]!);
}
export function classifyKelunLocation(locationRaw: string): KelunScopeDecision {
  const alternatives = locationRaw.normalize("NFKC").split(/[,;、/|\n]/u).map(clean);
  if (!alternatives.length || alternatives.some(value => !value)) return "UNKNOWN";
  if (alternatives.every(mainlandHierarchy)) return "MAINLAND";
  if (alternatives.every(outsideHierarchy)) return "EXPLICIT_OUTSIDE";
  return "UNKNOWN";
}
// These three original nationwide labels were explicitly reviewed for this
// source on 2026-10-07. This is an identity-bound exception, not a nationwide
// location rule. A changed subject/title, ID or location needs new review.
const REVIEWED_NATIONWIDE_TITLES = new Map([
  ["230783266", "科伦博泰-区域市场经理（北区或南区）(J12400)"],
  ["230690782", "科伦嘉讯-省区经理(J11794)"],
  ["230685318", "科伦嘉讯-业务经理(J11762)"]
]);
function classifyKelunRowScope(sourceJobId: string, title: string, locationRaw: string): KelunScopeDecision {
  const ordinary = classifyKelunLocation(locationRaw);
  const reviewedTitle = REVIEWED_NATIONWIDE_TITLES.get(sourceJobId);
  return ordinary === "UNKNOWN" && key(locationRaw) === "全国" && reviewedTitle !== undefined &&
    key(title) === key(reviewedTitle) ? "MAINLAND" : ordinary;
}

function validDetailContext(url: URL, pageSequence: number): boolean {
  if (!url.search) return true;
  const canonical = (params: URLSearchParams) => JSON.stringify([...params].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)));
  const entry = new URL(KELUN_ENTRY).searchParams;
  const page = new URLSearchParams({p: "1^2", PageIndex: String(pageSequence + 1)});
  const fullPage = new URLSearchParams(entry);
  fullPage.set("PageIndex", String(pageSequence + 1));
  return canonical(url.searchParams) === canonical(entry) || pageSequence > 0 &&
    (canonical(url.searchParams) === canonical(page) || canonical(url.searchParams) === canonical(fullPage));
}
export interface KelunScopeRow {
  pageSequence: number; recordIndex: number; artifactLogicalKey: string;
  sourceJobId: string; officialUrl: string; title: string; locationRaw: string;
  rawHtml: string; rawId: string; decision: KelunScopeDecision;
}
/** Re-select original rows at their original page and row positions. This does
 * not trust fetch counts, projected payloads, loss claims or normalized jobs. */
export function inspectKelunScopeRows(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence): KelunScopeRow[] {
  if (!exactKelunMainlandPlan(plan)) throw Error("KELUN_SCOPE_BINDING_INVALID");
  const rows: KelunScopeRow[] = [], seen = new Set<string>();
  if (evidence.pages.length !== evidence.artifacts.length) throw Error("KELUN_SCOPE_ARTIFACT_SET");
  for (const page of evidence.pages) {
    const artifact = evidence.artifacts.find(item => item.logicalKey === page.artifactLogicalKey);
    if (!artifact || artifact.bodyRepresentation !== "EXACT" || typeof artifact.body !== "string" ||
      page.responseFingerprintSha256 !== sha256Bytes(Buffer.from(artifact.body)).sha256) throw Error("KELUN_SCOPE_ORIGINAL_REQUIRED");
    const $ = load(artifact.body);
    const selected = $(".jobsTable tr:not(.title)").toArray();
    const pageRows = selected.map((element, recordIndex): KelunScopeRow => {
      const row = $(element), link = row.find("td:nth-child(1) a"), location = row.find("td:nth-child(5)");
      if (link.length !== 1 || location.length !== 1 || !clean(link.text())) throw Error("KELUN_SCOPE_ROW_STRUCTURE");
      const url = new URL(link.attr("href") ?? "", KELUN_ENTRY);
      const match = /^\/job_show\/([1-9][0-9]*)$/u.exec(url.pathname);
      if (!match || url.origin !== "https://kelun.zhiye.com" || !validDetailContext(url, page.sequence) || url.hash || url.username || url.password || seen.has(match[1]!))
        throw Error("KELUN_SCOPE_IDENTITY_INVALID");
      seen.add(match[1]!);
      const rawHtml = $.html(element), locationRaw = clean(location.attr("title") ?? "");
      const visible = key(location.text()), full = key(locationRaw);
      const clipped = /(?:\.{3}|…)$/.test(visible) && full.startsWith(visible.replace(/(?:\.{3}|…)$/u, ""));
      const decision = visible && visible !== full && !clipped ? "UNKNOWN" : classifyKelunRowScope(match[1]!, clean(link.text()), locationRaw);
      return { pageSequence: page.sequence, recordIndex, artifactLogicalKey: artifact.logicalKey,
        sourceJobId: match[1]!, officialUrl: url.toString(), title: clean(link.text()), locationRaw,
        rawHtml, rawId: `html-row:sha256:${sha256Bytes(Buffer.from(rawHtml)).sha256}`, decision };
    });
    if (JSON.stringify(pageRows.map(row => row.rawId)) !== JSON.stringify(page.rawJobIds)) throw Error("KELUN_SCOPE_RAW_ROWS_MISMATCH");
    rows.push(...pageRows);
  }
  if (rows.length !== evidence.fetchCounts.rawCount || rows.length !== evidence.fetchCounts.parsedCount)
    throw Error("KELUN_SCOPE_RAW_COUNTS_MISMATCH");
  return rows;
}
export function kelunScopeCounts(rows: readonly KelunScopeRow[]) {
  return { rawCount: rows.length, mainlandCount: rows.filter(row => row.decision === "MAINLAND").length,
    outsideCount: rows.filter(row => row.decision === "EXPLICIT_OUTSIDE").length,
    unknownCount: rows.filter(row => row.decision === "UNKNOWN").length };
}
export function kelunScopeLoss(row: KelunScopeRow, capturedAt: string): PersistentSourceFetchEvidence["fetchLosses"][number] {
  const code = row.decision === "EXPLICIT_OUTSIDE" ? "KELUN_EXPLICIT_OUTSIDE_MAINLAND" : "KELUN_GEOGRAPHY_UNKNOWN";
  return { stage: "VALIDATION", reason: code,
    rawLocator: `${row.artifactLogicalKey}#row:${row.recordIndex};id:${row.sourceJobId};${row.rawId}`,
    details: { code, field: "locationRaw", pageSequence: row.pageSequence, recordIndex: row.recordIndex,
      noteCode: KELUN_MAINLAND_POLICY }, recordedAt: capturedAt };
}
/** The exact archived bodies and every raw row remain unchanged. Only the
 * adapter-facing payload and valid set are projected. No new requests. */
export function projectKelunMainlandFetch(plan: SourceCrawlPlan, result: SourceFetchResult): SourceFetchResult {
  if (plan.source.id !== "source-kelun-social" || !result.ok) return result;
  const hold = (failureReason: string, fetchEvidence = result.fetchEvidence): SourceFetchResult => ({
    ok: false, capturedAt: result.capturedAt, failureReason,
    ...(fetchEvidence ? { fetchEvidence } : {})
  });
  try {
    if (!exactKelunMainlandPlan(plan) || !result.fetchEvidence || !("html" in result)) return hold("KELUN_SCOPE_BINDING_INVALID");
    const original = parsePersistentSourceFetchEvidence(result.fetchEvidence);
    if (original.fetchLosses.length || original.fetchCounts.rawCount !== original.fetchCounts.validCount ||
      original.fetchCounts.parseDiscardCount || original.fetchCounts.validationDiscardCount) return hold("KELUN_SCOPE_ORIGINAL_LOSS");
    const rows = inspectKelunScopeRows(plan, original), counts = kelunScopeCounts(rows);
    if (!rows.length) return hold("KELUN_OFFICIAL_ZERO_UNPROVEN");
    const projected = structuredClone(original);
    for (const page of projected.pages) page.validJobIds = rows.filter(row => row.pageSequence === page.sequence && row.decision === "MAINLAND").map(row => row.rawId);
    projected.fetchCounts.validCount = counts.mainlandCount;
    projected.fetchCounts.validationDiscardCount = counts.outsideCount + counts.unknownCount;
    projected.fetchLosses = rows.filter(row => row.decision !== "MAINLAND").map(row =>
      kelunScopeLoss(row, projected.artifacts.find(a => a.logicalKey === row.artifactLogicalKey)!.capturedAt));
    if (counts.unknownCount) {
      delete projected.declaredCompleteness;
      return hold("KELUN_GEOGRAPHY_UNKNOWN", parsePersistentSourceFetchEvidence(projected));
    }
    const options = { expectedChannelIds: [], filteredOutput: true, allowMissingReturnedPage: true };
    const evidence = deriveCanonicalPaginationEvidence({ evidence: projected, ...options });
    return { ...result, html: `<table class="jobsTable">${rows.filter(row => row.decision === "MAINLAND").map(row => row.rawHtml).join("\n")}</table>`,
      fetchEvidence: evidence, paginationEvaluation: evaluatePaginationEvidence({ evidence, ...options }) };
  } catch { return hold("KELUN_SCOPE_REPLAY_REQUIRED"); }
}
/** Strict replay derives both exhaustive sets from archived originals. The
 * lossless evidence view is only for the unchanged generic HTML page gate. */
export function replayKelunMainlandScope(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence,
  jobs?: readonly NormalizedJobRecord[]): { rawEvidence: PersistentSourceFetchEvidence; rows: KelunScopeRow[] } | undefined {
  try {
    const rows = inspectKelunScopeRows(plan, evidence), counts = kelunScopeCounts(rows);
    if (!rows.length || counts.unknownCount || evidence.fetchCounts.parseDiscardCount !== 0 ||
      evidence.fetchCounts.validCount !== counts.mainlandCount || evidence.fetchCounts.validationDiscardCount !== counts.outsideCount) return;
    const expectedLosses = rows.filter(row => row.decision === "EXPLICIT_OUTSIDE").map(row =>
      kelunScopeLoss(row, evidence.artifacts.find(a => a.logicalKey === row.artifactLogicalKey)!.capturedAt));
    if (JSON.stringify(evidence.fetchLosses) !== JSON.stringify(expectedLosses)) return;
    for (const page of evidence.pages) if (JSON.stringify(page.validJobIds) !== JSON.stringify(rows.filter(row =>
      row.pageSequence === page.sequence && row.decision === "MAINLAND").map(row => row.rawId))) return;
    const mainland = rows.filter(row => row.decision === "MAINLAND");
    if (jobs !== undefined && (jobs.length !== mainland.length || jobs.some((job, index) => {
      const row = mainland[index]!;
      return job.companyId !== plan.company.id || job.sourceId !== plan.source.id || job.sourceJobId !== row.sourceJobId ||
        job.officialUrl !== row.officialUrl || job.officialTitle !== row.title || job.locationRaw !== row.locationRaw ||
        JSON.stringify(job.cities) !== JSON.stringify(row.locationRaw.split(/[,，;；、/]/u).map(clean).filter(Boolean));
    }))) return;
    const rawEvidence = structuredClone(evidence);
    rawEvidence.fetchCounts.validCount = counts.rawCount; rawEvidence.fetchCounts.validationDiscardCount = 0;
    rawEvidence.fetchLosses = [];
    rawEvidence.pages.forEach(page => { page.validJobIds = [...page.rawJobIds]; });
    return { rawEvidence, rows };
  } catch { return; }
}
