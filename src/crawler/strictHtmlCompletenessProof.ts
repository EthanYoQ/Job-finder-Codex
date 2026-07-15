import { parseExpression } from "@babel/parser";
import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import type { HtmlTableConfig } from "./adapters/types";
import type { SourceCrawlPlan } from "./sourcePlan";
import {
  sanitizeEvidenceHttpUrl,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchArtifactDraft,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";
import { requestContractV2Locator } from "./strictPageRequestContract";

type HtmlPlan = Extract<SourceCrawlPlan, { adapterId: "html-table" }>;
type ExactArtifact = SourceFetchArtifactDraft & { body: string; requestedUrl: string; finalUrl: string };

/**
 * Independently replays the archived HTML responses against the source-bound
 * plan. It deliberately does not import any parsing or pagination helper from
 * the network fetcher whose declaration it is checking.
 */
export function validateStrictHtmlCompletenessProof(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence
): boolean {
  try {
    const policy = plan.table.completenessProof;
    const declaration = evidence.declaredCompleteness;
    if (!policy || !declaration || declaration.scope !== "SOURCE" || declaration.channelId !== undefined ||
      evidence.supportingArtifactOnlyFailure || evidence.fetchLosses.length !== 0 ||
      evidence.fetchCounts.parseDiscardCount !== 0 || evidence.fetchCounts.validationDiscardCount !== 0 ||
      evidence.fetchCounts.rawCount !== evidence.fetchCounts.parsedCount ||
      evidence.fetchCounts.rawCount !== evidence.fetchCounts.validCount || evidence.pages.length === 0 ||
      !contiguousSequences(evidence.pages)) return false;

    const artifacts = evidence.artifacts.map(exactNetworkArtifact);
    if (artifacts.some((artifact) => artifact === undefined)) return false;
    const exact = artifacts as ExactArtifact[];
    if (new Set(exact.map((artifact) => artifact.logicalKey)).size !== exact.length) return false;

    if (policy.kind === "OFFICIAL_TOTAL_PAGES") {
      return validateOrdinaryTotalPages(plan, evidence, exact);
    }
    if (policy.kind === "CONFIGURED_CHANNEL_TRAVERSAL") {
      return plan.table.pagination?.ajaxMode === "talentbrew"
        ? validateTalentbrewTraversal(plan, evidence, exact)
        : plan.table.pagination?.ajaxMode === "tupu360"
          ? validateTupuTraversal(plan, evidence, exact)
          : false;
    }
    if (policy.kind === "STATIC_PUBLIC_LIST") {
      return validateStaticPublicList(plan, evidence, exact);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns the only source-bound adapter dedupe exception supported by the
 * strict HTML gate. Undefined means the ordinary lossless one-row/one-job
 * boundary remains mandatory.
 */
export function strictHtmlExpectedAdapterOutputCount(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence
): number | undefined {
  try {
    if (plan.source.id !== "source-novartis-social" ||
      plan.table.completenessProof?.kind !== "OFFICIAL_TOTAL_PAGES" ||
      plan.table.completenessProof.sourcePolicy !== "NOVARTIS_CHINA_SLIDING_WINDOW_V1" ||
      !validateStrictHtmlCompletenessProof(plan, evidence)) return undefined;
    const artifacts = evidence.artifacts.map(exactNetworkArtifact);
    if (artifacts.some((artifact) => artifact === undefined)) return undefined;
    const urls = novartisOfficialJobUrls(plan, artifacts as ExactArtifact[]);
    return urls?.size;
  } catch {
    return undefined;
  }
}

function validateOrdinaryTotalPages(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const pagination = plan.table.pagination;
  const declaration = evidence.declaredCompleteness!;
  if (!pagination || pagination.ajaxMode || declaration.kind !== "OFFICIAL_TOTAL_PAGES" ||
    declaration.value !== evidence.pages.length || artifacts.length !== evidence.pages.length) return false;

  if (plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "NOVARTIS_CHINA_SLIDING_WINDOW_V1") {
    return validateNovartisSlidingWindow(plan, evidence, artifacts);
  }

  const seen = new Set<string>();
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const page = evidence.pages[index]!;
    const artifact = artifactForPage(page, artifacts);
    const pageNumber = index + 1;
    const rawExpectedUrl = pageNumber === 1
      ? configuredUrl(plan.source.officialEntryUrl)
      : configuredUrl(buildOrdinaryPageUrl(plan.source.officialEntryUrl, pagination, pageNumber));
    const expectedUrl = evidenceUrl(rawExpectedUrl);
    const expectedCoordinate = ordinaryCoordinate(rawExpectedUrl, pagination);
    if (!artifact || !sameUrl(artifact, expectedUrl) || artifact.channelId !== undefined ||
      page.channelId !== undefined || !equalOptional(page.requestedPage, expectedCoordinate.requestedPage) ||
      !equalOptional(page.requestedOffset, expectedCoordinate.requestedOffset) ||
      page.requestedCursor != null || page.returnedCursor != null || page.returnedPage != null ||
      page.declaredPages !== evidence.pages.length ||
      !validTermination(page, index, evidence.pages.length) ||
      !matchesRequestContract(artifact, plan.table.rowSelector, index === 0 ? "entry" : "ordinary-page", index, "GET", expectedUrl, null, {
        sequence: index, ...expectedCoordinate
      }) || officialTotalPages(artifact.body, pagination) !== evidence.pages.length ||
      !replayRows(artifact.body, plan.table.rowSelector, page, seen)) return false;
  }
  const genericValid = declaration.artifactLogicalKey === evidence.pages[0]!.artifactLogicalKey &&
    declaration.extractorLocator === artifacts[0]!.extractorLocator &&
    evidence.fetchCounts.rawCount === seen.size;
  if (!genericValid) return false;
  return plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "BAYER_CHINA_SUCCESSFACTORS_V1"
    ? validateBayerChinaPages(plan, evidence, artifacts)
    : true;
}

function validateBayerChinaPages(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const pagination = plan.table.pagination;
  if (!pagination || !exactBayerPlan(plan) || evidence.pages.length < 1) return false;
  const declaredTotals = new Set<number>();
  const jobUrls = new Set<string>();
  let observedRows = 0;

  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index]!;
    const page = evidence.pages[index]!;
    const $ = load(artifact.body);
    const resultContainers = $("#searchresults[aria-label]");
    const labels = $(".paginationLabel");
    if (resultContainers.length !== 1 || labels.length !== 1) return false;
    const aria = resultContainers.first().attr("aria-label") ?? "";
    const declaredPages = /共\s*([1-9]\d*)\s*页/u.exec(aria);
    const totalMatch = /\s*(\d+)\s*$/u.exec(labels.first().text());
    const total = totalMatch ? strictInt(totalMatch[1], false) : undefined;
    if (!declaredPages || strictInt(declaredPages[1], true) !== evidence.pages.length || total === undefined) return false;
    declaredTotals.add(total);

    const expectedOffset = index === 0 ? null : index * 10;
    if ((page.requestedOffset ?? null) !== expectedOffset || page.requestedPage != null ||
      page.returnedPage != null || page.requestedPageSize !== 10) return false;

    const rows = $(plan.table.rowSelector).toArray();
    const finalPage = index === artifacts.length - 1;
    if (rows.length < 1 || rows.length > 10 || (!finalPage && rows.length !== 10)) return false;
    observedRows += rows.length;
    for (const row of rows) {
      const title = $(row).find(".jobTitle.hidden-phone a.jobTitle-link");
      const location = normalizedText($(row).find("td.colLocation").text());
      const rawUrl = title.attr("href");
      const officialUrl = rawUrl ? strictSameOriginUrl(rawUrl, plan.source.officialEntryUrl) : undefined;
      const locationParts = location?.split(",").map((part) => part.trim()).filter(Boolean);
      if (title.length !== 1 || !normalizedText(title.text()) || !officialUrl ||
        !officialUrl.pathname.startsWith("/job/") || !locationParts || locationParts.length < 2 ||
        locationParts.at(-1) !== "CN" || jobUrls.has(officialUrl.toString())) return false;
      jobUrls.add(officialUrl.toString());
    }
  }

  const total = declaredTotals.size === 1 ? [...declaredTotals][0] : undefined;
  const valid = total !== undefined && Math.max(1, Math.ceil(total / 10)) === evidence.pages.length &&
    total === jobUrls.size && total === observedRows && total === evidence.fetchCounts.rawCount;
  return valid;
}

function validateNovartisSlidingWindow(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const pagination = plan.table.pagination;
  const declaration = evidence.declaredCompleteness!;
  if (!pagination || !exactNovartisPlan(plan) ||
    declaration.artifactLogicalKey !== evidence.pages[0]!.artifactLogicalKey ||
    declaration.extractorLocator !== artifacts[0]!.extractorLocator) return false;

  const seenUrls = new Set<string>();
  const signatures = new Map<string, string>();
  const responseHashes = new Set<string>();
  let observedRows = 0;
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const pageNumber = index + 1;
    const page = evidence.pages[index]!;
    const artifact = artifactForPage(page, artifacts);
    const rawExpectedUrl = pageNumber === 1
      ? configuredUrl(plan.source.officialEntryUrl)
      : configuredUrl(buildOrdinaryPageUrl(plan.source.officialEntryUrl, pagination, pageNumber));
    const expectedUrl = evidenceUrl(rawExpectedUrl);
    const expectedCoordinate = { requestedPage: pageNumber };
    if (!artifact || !sameUrl(artifact, expectedUrl) || artifact.channelId !== undefined ||
      page.channelId !== undefined || page.requestedPage !== pageNumber || page.returnedPage !== pageNumber ||
      page.requestedOffset != null || page.returnedOffset != null || page.requestedPageSize != null ||
      page.returnedPageSize != null || page.requestedCursor != null || page.returnedCursor != null ||
      page.declaredPages !== evidence.pages.length || !validTermination(page, index, evidence.pages.length) ||
      !matchesRequestContract(artifact, plan.table.rowSelector, index === 0 ? "entry" : "ordinary-page", index,
        "GET", expectedUrl, null, { sequence: index, ...expectedCoordinate }) ||
      officialTotalPages(artifact.body, pagination) !== evidence.pages.length) return false;

    const responseHash = sha256Bytes(Buffer.from(artifact.body, "utf8")).sha256;
    if (page.responseFingerprintSha256 !== responseHash || responseHashes.has(responseHash)) return false;
    responseHashes.add(responseHash);

    const $ = load(artifact.body);
    const active = strictNovartisActivePage($);
    if (!active || active.page !== pageNumber || active.totalPages !== evidence.pages.length ||
      !strictNovartisNextState($, pageNumber, evidence.pages.length)) return false;
    const pageLabels = $(pagination.totalPagesSelector).toArray();
    if (pageLabels.length === 0 || pageLabels.some((element) => {
      const title = normalizedText($(element).attr(pagination.totalPagesAttribute));
      const match = title ? /out of\s+([1-9]\d*)\s+pages/iu.exec(title) : null;
      return !match || strictInt(match[1], true) !== evidence.pages.length;
    })) return false;

    const rows = strictNovartisRows(plan, artifact.body);
    if (!rows || rows.length === 0 || !replayPageRowsAllowingOverlap(artifact.body, plan.table.rowSelector, page)) return false;
    observedRows += rows.length;
    let novel = 0;
    const pageUrls = new Set<string>();
    for (const row of rows) {
      if (pageUrls.has(row.url)) return false;
      pageUrls.add(row.url);
      const previousSignature = signatures.get(row.url);
      if (previousSignature !== undefined && previousSignature !== row.signature) return false;
      signatures.set(row.url, row.signature);
      if (!seenUrls.has(row.url)) novel += 1;
      seenUrls.add(row.url);
    }
    if (index > 0 && novel < 1) return false;
  }
  return evidence.fetchCounts.rawCount === observedRows && seenUrls.size > 0;
}

function novartisOfficialJobUrls(
  plan: HtmlPlan,
  artifacts: readonly ExactArtifact[]
): Set<string> | undefined {
  const urls = new Set<string>();
  for (const artifact of artifacts) {
    const rows = strictNovartisRows(plan, artifact.body);
    if (!rows) return undefined;
    rows.forEach((row) => urls.add(row.url));
  }
  return urls;
}

function strictNovartisRows(
  plan: HtmlPlan,
  html: string
): Array<{ url: string; signature: string }> | undefined {
  const $ = load(html);
  const rows: Array<{ url: string; signature: string }> = [];
  for (const row of $(plan.table.rowSelector).toArray()) {
    const titleLink = $(row).find("td.views-field-field-job-title a");
    const rawUrl = titleLink.attr("href");
    const url = rawUrl ? strictSameOriginUrl(rawUrl, plan.source.officialEntryUrl) : undefined;
    const title = normalizedText(titleLink.text());
    const location = normalizedText($(row).find("td.views-field-field-job-work-location").text());
    if (titleLink.length !== 1 || !url || !title || !location ||
      !strictNovartisMainlandChinaLocation(location) ||
      !url.pathname.startsWith("/careers/career-search/job/details/") || url.search || url.hash) return undefined;
    rows.push({ url: url.toString(), signature: JSON.stringify({ title, location }) });
  }
  return rows;
}

const NOVARTIS_MAINLAND_ENGLISH_LOCATIONS = new Set([
  "anhui", "beijing", "changchun", "changsha", "chengdu", "chongqing", "dalian", "dongguan",
  "foshan", "fujian", "fuzhou", "gansu", "guangdong", "guangxi", "guangzhou", "guizhou",
  "haikou", "hainan", "hangzhou", "harbin", "hebei", "hefei", "heilongjiang", "henan",
  "hohhot", "hubei", "hunan", "inner mongolia", "jiangsu", "jiangxi", "jinan", "jilin",
  "kunming", "lanzhou", "liaoning", "nanchang", "nanjing", "nanning", "nantong", "ningbo",
  "ningxia", "qingdao", "qinghai", "sanya", "shaanxi", "shandong", "shanghai", "shanxi",
  "shenyang", "shenzhen", "shijiazhuang", "sichuan", "suzhou", "taiyuan", "tianjin", "urumqi",
  "wenzhou", "wuhan", "wuxi", "xiamen", "xi'an", "xian", "xinjiang", "xizang", "yantai",
  "yunnan", "zhengzhou", "zhejiang", "zhuhai"
]);

const NOVARTIS_MAINLAND_COUNTRY_NAMES = new Set([
  "china", "china mainland", "mainland china", "people's republic of china", "pr china", "prc", "cn", "chn"
]);

const NOVARTIS_MAINLAND_CHINESE_LOCATIONS = [
  "黑龙江", "内蒙古", "乌鲁木齐", "石家庄", "呼和浩特", "哈尔滨", "西双版纳",
  "北京", "上海", "天津", "重庆", "河北", "山西", "辽宁", "吉林", "江苏", "浙江", "安徽",
  "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西", "海南", "四川", "贵州",
  "云南", "陕西", "甘肃", "青海", "宁夏", "新疆", "西藏", "长春", "长沙", "成都", "大连",
  "东莞", "佛山", "福州", "广州", "海口", "杭州", "合肥", "济南", "昆明", "兰州", "南昌",
  "南京", "南宁", "南通", "宁波", "青岛", "三亚", "沈阳", "深圳", "苏州", "太原", "温州",
  "武汉", "无锡", "厦门", "西安", "烟台", "郑州", "珠海"
] as const;

function strictNovartisMainlandChinaLocation(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  const withoutAdministrativeAnnotations = normalized.replace(
    /\(\s*(?:city|province|municipality|prefecture|autonomous region)\s*\)/giu,
    ""
  );
  const segments = withoutAdministrativeAnnotations
    .replace(/[()（）]/gu, ",")
    .split(/\s*[,，;；/／|｜、]\s*|\s+[—–-]\s+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 0 && segments.every(strictNovartisMainlandLocationSegment);
}

function strictNovartisMainlandLocationSegment(segment: string): boolean {
  const lower = segment.toLocaleLowerCase("en-US").replace(/[.]$/u, "").trim();
  if (NOVARTIS_MAINLAND_COUNTRY_NAMES.has(lower)) return true;

  const administrativeCore = lower.replace(
    /\s+(?:city|province|municipality|prefecture|autonomous region)$/u,
    ""
  ).trim();
  if (NOVARTIS_MAINLAND_ENGLISH_LOCATIONS.has(administrativeCore)) return true;

  for (const country of NOVARTIS_MAINLAND_COUNTRY_NAMES) {
    if (lower.startsWith(`${country} `) && strictNovartisMainlandLocationSegment(lower.slice(country.length + 1))) {
      return true;
    }
    if (lower.endsWith(` ${country}`) && strictNovartisMainlandLocationSegment(lower.slice(0, -(country.length + 1)))) {
      return true;
    }
  }

  return strictNovartisMainlandChineseLocation(segment);
}

function strictNovartisMainlandChineseLocation(segment: string): boolean {
  let remaining = segment.replace(/\s+/gu, "");
  for (const country of ["中华人民共和国", "中国大陆", "中国"] as const) {
    if (remaining === country) return true;
    if (remaining.startsWith(country)) remaining = remaining.slice(country.length);
    if (remaining.endsWith(country)) remaining = remaining.slice(0, -country.length);
  }
  if (!remaining) return false;

  let matched = false;
  while (remaining) {
    const location = NOVARTIS_MAINLAND_CHINESE_LOCATIONS.find((candidate) => remaining.startsWith(candidate));
    if (!location) return false;
    matched = true;
    remaining = remaining.slice(location.length).replace(
      /^(?:维吾尔自治区|壮族自治区|回族自治区|自治区|特别行政区|省|市)/u,
      ""
    );
  }
  return matched;
}

function replayPageRowsAllowingOverlap(
  html: string,
  selector: string,
  page: SourceFetchPageTrace
): boolean {
  const $ = load(html);
  const ids = $(selector).toArray().map((row) =>
    `html-row:sha256:${sha256Bytes(Buffer.from($.html(row), "utf8")).sha256}`
  );
  return new Set(ids).size === ids.length &&
    JSON.stringify(ids) === JSON.stringify(page.rawJobIds) &&
    JSON.stringify(ids) === JSON.stringify(page.validJobIds);
}

function strictNovartisActivePage(
  $: ReturnType<typeof load>
): { page: number; totalPages: number } | undefined {
  const active = $(".pagination .page-link[title*='active'][title*='out of'][title*='pages']");
  if (active.length !== 1) return undefined;
  const title = normalizedText(active.first().attr("title"));
  const match = title ? /^page\s+([1-9]\d*)\s+active\s+out of\s+([1-9]\d*)\s+pages$/iu.exec(title) : null;
  const page = match ? strictInt(match[1], true) : undefined;
  const totalPages = match ? strictInt(match[2], true) : undefined;
  return page !== undefined && totalPages !== undefined ? { page, totalPages } : undefined;
}

function strictNovartisNextState(
  $: ReturnType<typeof load>,
  page: number,
  totalPages: number
): boolean {
  const next = $(".pagination .page-link[rel='next']");
  if (next.length !== 1 || normalizedText(next.first().attr("title")) !== "Go to next page") return false;
  const href = next.first().attr("href") ?? "";
  const classes = new Set((next.first().attr("class") ?? "").split(/\s+/u).filter(Boolean));
  return page < totalPages
    ? href === `?page=${page}` && !classes.has("disabled")
    : href === "" && classes.has("btn") && classes.has("disabled");
}

function exactBayerPlan(plan: HtmlPlan): boolean {
  const pagination = plan.table.pagination;
  const entry = configuredUrl(plan.source.officialEntryUrl);
  return plan.source.id === "source-bayer-healthcare-social" &&
    entry === "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN" &&
    plan.table.rowSelector === "#searchresults tbody tr" &&
    plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "BAYER_CHINA_SUCCESSFACTORS_V1" &&
    pagination?.totalPagesSelector === "#searchresults[aria-label]" &&
    pagination.totalPagesAttribute === "aria-label" &&
    pagination.totalPagesPattern === "共\\s*([1-9]\\d*)\\s*页" &&
    pagination.pageSearchParam === "startrow" && pagination.pageSearchParamMode === "offset" &&
    pagination.pageSize === 10 && pagination.maxPages === 100 &&
    pagination.expectedJobCountSelector === ".paginationLabel" &&
    pagination.expectedJobCountPattern === "\\s*(\\d+)\\s*$";
}

function exactNovartisPlan(plan: HtmlPlan): boolean {
  const pagination = plan.table.pagination;
  return plan.source.id === "source-novartis-social" &&
    configuredUrl(plan.source.officialEntryUrl) ===
      "https://prod1.novartis.com/careers/career-search/tag/LOC_CN" &&
    plan.table.rowSelector === "table.views-table tbody tr" &&
    plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "NOVARTIS_CHINA_SLIDING_WINDOW_V1" &&
    plan.table.fields.sourceJobId === undefined && plan.table.fields.sourceJobIdParts === undefined &&
    plan.table.fields.officialTitle.selector === "td.views-field-field-job-title a" &&
    plan.table.fields.officialUrl.selector === "td.views-field-field-job-title a" &&
    plan.table.fields.officialUrl.attribute === "href" &&
    plan.table.fields.locationRaw.selector === "td.views-field-field-job-work-location" &&
    pagination?.totalPagesSelector === ".pagination .page-link[title*='out of'][title*='pages']" &&
    pagination.totalPagesAttribute === "title" &&
    pagination.totalPagesPattern === "out of\\s+([1-9]\\d*)\\s+pages" &&
    pagination.totalPagesMode === "max" && pagination.pageSearchParam === "page" &&
    pagination.pageNumberOffset === -1 && pagination.maxPages === 20 &&
    pagination.officialWindowMode === "NOVARTIS_PAGE_WINDOW_V1";
}

function strictSameOriginUrl(value: string, base: string): URL | undefined {
  try {
    const url = new URL(value, base);
    const origin = new URL(base).origin;
    return url.protocol === "https:" && url.origin === origin && !url.username && !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizedText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  return normalized || undefined;
}

function validateTalentbrewTraversal(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const pagination = plan.table.pagination;
  const scope = pagination?.talentbrewScope;
  const declaration = evidence.declaredCompleteness!;
  if (!pagination || !scope || declaration.kind !== "COMPLETE_PAGE_TRAVERSAL" ||
    declaration.value !== evidence.pages.length || artifacts.length !== evidence.pages.length + 1) return false;

  const entry = artifacts[0]!;
  const rawEntryUrl = configuredUrl(plan.source.officialEntryUrl);
  const entryUrl = evidenceUrl(rawEntryUrl);
  if (entry.logicalKey !== "official-html-page-0000" || entry.kind !== "OFFICIAL_COMPANY_PAGE" ||
    entry.channelId !== undefined || !sameUrl(entry, entryUrl) ||
    !matchesRequestContract(entry, "#search-results[data-ajax-url]", "entry", 0, "GET", entryUrl, null, {
      sequence: 0, channelId: null, requestedPage: queryPositiveInt(entryUrl, "CurrentPage") ?? null,
      requestedPageSize: queryPositiveInt(entryUrl, "RecordsPerPage") ?? null
    }) || declaration.artifactLogicalKey !== entry.logicalKey ||
    declaration.extractorLocator !== entry.extractorLocator) return false;

  const entryDom = load(entry.body);
  const results = entryDom("#search-results");
  if (results.length !== 1) return false;
  const ajaxRaw = results.first().attr("data-ajax-url");
  if (!ajaxRaw) return false;
  const ajaxUrl = new URL(ajaxRaw, rawEntryUrl);
  if (ajaxUrl.protocol !== "https:" || ajaxUrl.origin !== new URL(rawEntryUrl).origin || ajaxUrl.hash) return false;
  const partitions = talentbrewPartitions(entryDom, scope);
  if (!partitions) return false;
  const staticFilters = talentbrewStaticFilters(entryDom);
  if (!staticFilters) return false;

  const seen = new Set<string>();
  let globalIndex = 0;
  for (const partition of partitions) {
    const channelPages = evidence.pages.filter((page) => page.channelId === partition.channelId);
    if (channelPages.length === 0) return false;
    let declaredPages: number | undefined;
    let declaredTotal: number | undefined;
    let pageSize: number | undefined;
    let returnedRows = 0;
    for (let channelIndex = 0; channelIndex < channelPages.length; channelIndex += 1) {
      const page = channelPages[channelIndex]!;
      if (page !== evidence.pages[globalIndex] || page.sequence !== globalIndex) return false;
      const artifact = artifactForPage(page, artifacts);
      if (!artifact || artifact.channelId !== partition.channelId) return false;
      const pageNumber = channelIndex + 1;
      const rawExpectedUrl = talentbrewRequestUrl(entryDom, ajaxUrl, staticFilters, partition, pageNumber);
      const expectedUrl = evidenceUrl(rawExpectedUrl);
      const expectedPageSize = queryPositiveInt(rawExpectedUrl, "RecordsPerPage") ?? null;
      if (!sameUrl(artifact, expectedUrl) || page.requestedPage !== pageNumber ||
        page.requestedPageSize !== expectedPageSize || page.returnedPage !== pageNumber ||
        !matchesRequestContract(artifact, plan.table.rowSelector, "talentbrew-page", globalIndex + 1, "GET", expectedUrl, null, {
          sequence: globalIndex + 1, channelId: partition.channelId,
          requestedPage: null, requestedPageSize: null
        }) || !validChannelTermination(page, channelIndex, channelPages.length)) return false;
      const html = strictTalentbrewResults(artifact.body);
      const pageDom = load(html);
      const returned = pageDom("#search-results");
      if (returned.length !== 1) return false;
      const current = strictInt(returned.first().attr("data-current-page"), true);
      const totalPages = strictInt(returned.first().attr("data-total-pages"), true);
      const total = strictInt(returned.first().attr("data-total-job-results"), false);
      const size = strictInt(returned.first().attr("data-records-per-page"), true);
      if (current !== pageNumber || totalPages === undefined || total === undefined || size === undefined ||
        page.declaredPages !== totalPages || page.declaredTotal !== total || page.returnedPageSize !== size ||
        partition.declaredCount !== total || Math.max(1, Math.ceil(total / size)) !== totalPages) return false;
      declaredPages ??= totalPages;
      declaredTotal ??= total;
      pageSize ??= size;
      if (declaredPages !== totalPages || declaredTotal !== total || pageSize !== size ||
        !replayRows(html, plan.table.rowSelector, page, seen)) return false;
      returnedRows += page.rawJobIds.length;
      globalIndex += 1;
    }
    if (declaredPages !== channelPages.length || declaredTotal !== returnedRows) return false;
  }
  return globalIndex === evidence.pages.length && evidence.fetchCounts.rawCount === seen.size;
}

function validateTupuTraversal(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const declaration = evidence.declaredCompleteness!;
  if (declaration.kind !== "COMPLETE_PAGE_TRAVERSAL" || declaration.value !== evidence.pages.length ||
    artifacts.length !== evidence.pages.length) return false;
  const rawEntryUrl = configuredUrl(plan.source.officialEntryUrl);
  const entryUrl = evidenceUrl(rawEntryUrl);
  const entry = artifacts[0]!;
  const first = load(entry.body);
  const totalPages = tupuTotalPages(first("#pageTurnUl li:first-child").first().text());
  const pageSize = first("#pageTurnUl li[onclick]").toArray()
    .map((element) => first(element).attr("onclick") ?? "")
    .map(tupuPageSize).find((value) => value !== undefined);
  const siteCode = new URL(rawEntryUrl).pathname.split("/").filter(Boolean)[0];
  if (!siteCode || totalPages !== evidence.pages.length || pageSize === undefined ||
    declaration.artifactLogicalKey !== evidence.pages[0]!.artifactLogicalKey ||
    declaration.extractorLocator !== entry.extractorLocator) return false;
  const endpoint = new URL(`/${siteCode}/position/nextPageList`, rawEntryUrl).toString();
  const recruitmentType = new URL(rawEntryUrl).searchParams.get("recruitmentType");
  const seen = new Set<string>();
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const page = evidence.pages[index]!;
    const artifact = artifactForPage(page, artifacts);
    const offset = index === 0 ? null : index * pageSize;
    const body = index === 0 ? null : tupuBody(offset!, pageSize, recruitmentType);
    const expectedUrl = index === 0 ? entryUrl : evidenceUrl(endpoint);
    const base = plan.table.rowSelector;
    if (!artifact || artifact.channelId !== undefined || page.channelId !== undefined ||
      !sameUrl(artifact, expectedUrl) || page.requestedOffset !== offset ||
      (page.requestedPageSize ?? null) !== (index === 0 ? null : pageSize) ||
      !validTermination(page, index, evidence.pages.length) ||
      !matchesRequestContract(artifact, base, index === 0 ? "entry" : "tupu360-page", index,
        index === 0 ? "GET" : "POST", expectedUrl, body, {
          sequence: index, requestedOffset: offset, requestedPageSize: index === 0 ? null : pageSize
        }) || !replayRows(artifact.body, plan.table.rowSelector, page, seen)) return false;
  }
  return evidence.fetchCounts.rawCount === seen.size;
}

function validateStaticPublicList(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const config = plan.table.staticPublicList;
  const declaration = evidence.declaredCompleteness!;
  if (!config || evidence.pages.length !== 1 || artifacts.length !== 1 ||
    !["COMPLETE_PAGE_TRAVERSAL", "OFFICIAL_TOTAL_COUNT"].includes(declaration.kind) ||
    declaration.artifactLogicalKey !== evidence.pages[0]!.artifactLogicalKey) return false;
  const artifact = artifacts[0]!;
  const entryUrl = evidenceUrl(configuredUrl(plan.source.officialEntryUrl));
  const $ = load(artifact.body);
  const container = $(config.containerSelector);
  if (container.length !== 1 || $(config.nextControlSelector).length !== 0 || !sameUrl(artifact, entryUrl) ||
    !matchesRequestContract(artifact, plan.table.rowSelector, "entry", 0, "GET", entryUrl, null, { sequence: 0 }) ||
    declaration.extractorLocator !== artifact.extractorLocator ||
    !validTermination(evidence.pages[0]!, 0, 1)) return false;
  const rows = $(plan.table.rowSelector).toArray();
  if (rows.some((row) => $(row).closest(config.containerSelector).get(0) !== container.get(0) ||
    (config.excludedPartitionSelectors ?? []).some((selector) => $(row).closest(selector).length > 0))) return false;
  const seen = new Set<string>();
  const genericValid = replayRows(artifact.body, plan.table.rowSelector, evidence.pages[0]!, seen) &&
    evidence.fetchCounts.rawCount === seen.size &&
    ((declaration.kind === "COMPLETE_PAGE_TRAVERSAL" && declaration.value === 1) ||
      (declaration.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value === 0 && rows.length === 0));
  if (!genericValid) return false;
  const policy = plan.table.completenessProof;
  if (policy?.kind !== "STATIC_PUBLIC_LIST") return false;
  if (policy.sourcePolicy === "APELOA_SOCIAL_TABS_V1") {
    return validateApeloaStaticPlan(plan, $, rows);
  }
  if (policy.sourcePolicy === "ASTELLAS_CHINA_PDF_ACCORDION_V1") {
    return validateAstellasStaticPlan(plan, $, rows);
  }
  return policy.sourcePolicy === undefined;
}

function validateApeloaStaticPlan(
  plan: HtmlPlan,
  $: ReturnType<typeof load>,
  rows: readonly AnyNode[]
): boolean {
  const config = plan.table.staticPublicList;
  if (plan.source.id !== "source-apeloa-social" ||
    configuredUrl(plan.source.officialEntryUrl) !== "https://www.apeloa.com/join.html" ||
    plan.table.rowSelector !== ".join2 .tab-content > .main:first-child > .ev" ||
    config?.containerSelector !== ".join2 .tab-content > .main:first-child" ||
    config.nextControlSelector !== ".join2 .pagination, .join2 a[rel='next'], .join2 [data-page]" ||
    JSON.stringify(config.excludedPartitionSelectors) !==
      JSON.stringify([".join2 .tab-content > .main:nth-child(2)"]) ||
    config.allowRedactedPositivePartial !== undefined || rows.length === 0 || $(".join2").length !== 1) return false;
  const tabs = $(".join2 > .C-wrap > .tabbar > .ev, .join2 > .tabbar > .ev");
  const tabContainers = $(".join2 .tabbar");
  const tabLabels = tabs.toArray().map((element) => normalizedText($(element).find("h2").text()));
  const partitions = $(".join2 .tab-content > .main");
  if (tabContainers.length !== 1 || tabs.length !== 2 ||
    JSON.stringify(tabLabels) !== JSON.stringify(["社会招聘", "校园招聘"]) || partitions.length !== 2) return false;
  const social = partitions.get(0)!;
  const campus = partitions.get(1)!;
  return rows.every((row) => $.contains(social, row)) &&
    !rows.some((row) => $.contains(campus, row));
}

function validateAstellasStaticPlan(
  plan: HtmlPlan,
  $: ReturnType<typeof load>,
  rows: readonly AnyNode[]
): boolean {
  const config = plan.table.staticPublicList;
  if (plan.source.id !== "source-astellas-china-social" ||
    configuredUrl(plan.source.officialEntryUrl) !== "https://www.astellas.com/en/careers/china-recruitment" ||
    plan.table.rowSelector !== "a[href$='.pdf'][href*='/global/zh/']" ||
    config?.containerSelector !== ".cmp-accordion[data-cmp-is='accordion']" ||
    config.nextControlSelector !== ".pagination, a[rel='next'], [data-page]" ||
    config.excludedPartitionSelectors !== undefined || config.allowRedactedPositivePartial !== undefined ||
    plan.table.pagination !== undefined || plan.table.fields.officialTitle.selector !== "span:first-child" ||
    rows.length === 0) return false;
  const accordions = $(config.containerSelector);
  const allPdfs: AnyNode[] = $("a[href$='.pdf']").toArray();
  if (accordions.length !== 1 || allPdfs.length !== rows.length ||
    rows.some((row) => !allPdfs.includes(row))) return false;
  const seenUrls = new Set<string>();
  for (const row of rows) {
    const element = $(row);
    const rawUrl = element.attr("href");
    const url = rawUrl ? strictSameOriginUrl(rawUrl, plan.source.officialEntryUrl) : undefined;
    const firstSpan = element.children("span:first-child");
    if (!url || !url.pathname.includes("/global/zh/") || !url.pathname.endsWith(".pdf") ||
      firstSpan.length !== 1 || !normalizedText(firstSpan.text()) || seenUrls.has(url.toString())) return false;
    seenUrls.add(url.toString());
  }
  return true;
}

function exactNetworkArtifact(artifact: SourceFetchArtifactDraft): ExactArtifact | undefined {
  return typeof artifact.body === "string" && artifact.bodyRepresentation === "EXACT" &&
    artifact.requestedUrl !== undefined && artifact.finalUrl !== undefined &&
    artifact.httpStatus !== undefined && artifact.httpStatus >= 200 && artifact.httpStatus < 300 &&
    artifact.requestedUrl === artifact.finalUrl
    ? artifact as ExactArtifact
    : undefined;
}

function artifactForPage(page: SourceFetchPageTrace, artifacts: readonly ExactArtifact[]): ExactArtifact | undefined {
  return artifacts.find((artifact) => artifact.logicalKey === page.artifactLogicalKey);
}

function replayRows(
  html: string,
  selector: string,
  page: SourceFetchPageTrace,
  globalSeen: Set<string>
): boolean {
  const $ = load(html);
  const ids = $(selector).toArray().map((row) => {
    const raw = $.html(row);
    return `html-row:sha256:${sha256Bytes(Buffer.from(raw, "utf8")).sha256}`;
  });
  if (new Set(ids).size !== ids.length || ids.some((id) => globalSeen.has(id)) ||
    JSON.stringify(ids) !== JSON.stringify(page.rawJobIds) ||
    JSON.stringify(ids) !== JSON.stringify(page.validJobIds)) return false;
  ids.forEach((id) => globalSeen.add(id));
  return true;
}

function matchesRequestContract(
  artifact: ExactArtifact,
  baseLocator: string,
  role: string,
  sequence: number,
  method: "GET" | "POST",
  url: string,
  body: string | null,
  coordinate: unknown
): boolean {
  const expected = requestContractV2Locator(baseLocator, {
    family: "html", role, method, url, body, coordinate
  });
  return artifact.extractorLocator === expected && sequence >= 0;
}

function sameUrl(artifact: ExactArtifact, expected: string): boolean {
  return configuredUrl(artifact.requestedUrl) === expected && configuredUrl(artifact.finalUrl) === expected;
}

function configuredUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) throw new Error("unsafe URL");
  return parsed.toString();
}

function evidenceUrl(value: string): string {
  const url = new URL(configuredUrl(value));
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.normalize("NFKC").toLowerCase().replace(/[^a-z]/g, "");
    if (normalized.includes("keyword")) url.searchParams.delete(key);
  }
  return sanitizeEvidenceHttpUrl(url.toString());
}

function contiguousSequences(pages: readonly SourceFetchPageTrace[]): boolean {
  return pages.every((page, index) => page.sequence === index);
}

function validTermination(page: SourceFetchPageTrace, index: number, count: number): boolean {
  return page.termination === (index + 1 < count ? "CONTINUE" : "NEXT_ABSENT") &&
    page.anomalyCodes.length === 0;
}

function validChannelTermination(page: SourceFetchPageTrace, index: number, count: number): boolean {
  return validTermination(page, index, count);
}

function equalOptional(left: number | null | undefined, right: number | undefined): boolean {
  return (left ?? undefined) === right;
}

function buildOrdinaryPageUrl(
  entryUrl: string,
  pagination: NonNullable<HtmlTableConfig["pagination"]>,
  page: number
): string {
  const value = pagination.pageSearchParamMode === "offset" && pagination.pageSize !== undefined
    ? (page - 1) * pagination.pageSize
    : page + (pagination.pageNumberOffset ?? 0);
  if (pagination.pageUrlTemplate) return pagination.pageUrlTemplate.replace("{page}", String(value));
  const url = new URL(entryUrl);
  url.searchParams.set(pagination.pageSearchParam, String(value));
  return url.toString();
}

function ordinaryCoordinate(
  requestUrl: string,
  pagination: NonNullable<HtmlTableConfig["pagination"]>
): { requestedPage?: number; requestedOffset?: number } {
  const url = new URL(requestUrl);
  let raw = url.searchParams.get(pagination.pageSearchParam);
  if (raw === null && pagination.pageUrlTemplate) {
    const [prefix, suffix] = pagination.pageUrlTemplate.split("{page}");
    if (prefix !== undefined && suffix !== undefined && requestUrl.startsWith(prefix) && requestUrl.endsWith(suffix)) {
      raw = requestUrl.slice(prefix.length, requestUrl.length - suffix.length);
    }
  }
  const value = strictInt(raw ?? undefined, false);
  if (pagination.officialWindowMode === "NOVARTIS_PAGE_WINDOW_V1") {
    if (raw === null) return { requestedPage: 1 };
    return value === undefined ? {} : { requestedPage: value - (pagination.pageNumberOffset ?? 0) };
  }
  if (value === undefined) return {};
  return pagination.pageSearchParamMode === "offset" ? { requestedOffset: value } : { requestedPage: value };
}

function officialTotalPages(html: string, pagination: NonNullable<HtmlTableConfig["pagination"]>): number | undefined {
  const $ = load(html);
  const values = $(pagination.totalPagesSelector).toArray().flatMap((element) => {
    const selected = $(element);
    const raw = selected.attr(pagination.totalPagesAttribute) ??
      (pagination.totalPagesPattern ? selected.text() : undefined);
    if (raw === undefined) return [];
    const captured = pagination.totalPagesPattern
      ? new RegExp(pagination.totalPagesPattern, "u").exec(raw)?.[1]
      : raw;
    const value = strictInt(captured?.trim(), true);
    return value === undefined ? [] : [value];
  });
  if (values.length === 0) return undefined;
  return pagination.totalPagesMode === "max" ? Math.max(...values) : values[0];
}

type TalentbrewPartition = {
  channelId: string;
  id: string;
  facetType: number;
  fieldName: string;
  descriptor: string;
  declaredCount: number;
};
type TalentValue = string | number | boolean | null | TalentValue[] | { [key: string]: TalentValue };

function talentbrewPartitions(
  $: ReturnType<typeof load>,
  scope: NonNullable<NonNullable<HtmlTableConfig["pagination"]>["talentbrewScope"]>
): TalentbrewPartition[] | undefined {
  const results = $("#search-results").first();
  const active = scope.requiredActiveFacet;
  const activeMatches = $("#search-filters [data-enabled='false'] .filter-checkbox").filter((_index, element) => {
    const item = $(element);
    return item.attr("checked") !== undefined && item.attr("data-id") === active.id &&
      strictInt(item.attr("data-facet-type"), false) === active.facetType &&
      item.attr("data-display") === active.descriptor;
  });
  if (activeMatches.length !== 1 || results.attr("data-facet-term") !== active.id ||
    strictInt(results.attr("data-facet-type"), false) !== active.facetType ||
    scope.allowedPartitions.length === 0 ||
    new Set(scope.allowedPartitions.map((partition) => partition.channelId)).size !== scope.allowedPartitions.length) return undefined;
  const partitions: TalentbrewPartition[] = [];
  for (const configured of scope.allowedPartitions) {
    const matches = $("#search-filters [data-enabled='true'] .filter-checkbox:not(:checked)").filter((_index, element) => {
      const item = $(element);
      return item.attr("data-id") === configured.id &&
        strictInt(item.attr("data-facet-type"), false) === configured.facetType &&
        item.attr("data-field-name") === configured.fieldName && item.attr("data-display") === configured.descriptor;
    });
    const count = matches.length === 1 ? strictInt($(matches[0]!).attr("data-count"), false) : undefined;
    if (count === undefined) return undefined;
    partitions.push({ ...configured, declaredCount: count });
  }
  return partitions;
}

function talentbrewStaticFilters($: ReturnType<typeof load>): TalentValue[] | undefined {
  const values: TalentValue[] = [];
  for (const element of $("#search-filters [data-enabled='false'] .filter-checkbox").toArray()) {
    const item = $(element);
    if (item.attr("checked") === undefined) continue;
    const facetType = strictInt(item.attr("data-facet-type"), false);
    const count = strictInt(item.attr("data-count"), false);
    if (facetType === undefined || count === undefined) return undefined;
    values.push({
      ID: item.attr("data-id") ?? "", FacetType: facetType, Count: count,
      Display: item.attr("data-display") ?? "", IsApplied: true,
      FieldName: item.attr("data-field-name") ?? ""
    });
  }
  return values;
}

function talentbrewRequestUrl(
  $: ReturnType<typeof load>,
  endpoint: URL,
  staticFilters: TalentValue[],
  partition: TalentbrewPartition,
  page: number
): string {
  const results = $("#search-results").first();
  const filters = $("#search-filters").first();
  const numberOr = (element: typeof results, attr: string, fallback: number): number =>
    strictInt(element.attr(attr), false) ?? fallback;
  const criteria: Record<string, TalentValue> = {
    ActiveFacetID: numberOr(results, "data-active-facet-id", 0),
    RecordsPerPage: numberOr(results, "data-records-per-page", 20),
    TotalContentResults: numberOr(results, "data-total-content-results", 0),
    Distance: numberOr(results, "data-distance", 50),
    RadiusUnitType: numberOr(filters, "data-radius-unit-type", 2),
    Keywords: results.attr("data-keywords") ?? "", Location: results.attr("data-location") ?? "",
    Latitude: results.attr("data-latitude") ?? "", Longitude: results.attr("data-longitude") ?? "",
    ShowRadius: results.attr("data-show-radius") ?? "False", IsPagination: page > 1 ? "True" : "False",
    CustomFacetName: results.attr("data-custom-facet-name") ?? "",
    FacetTerm: results.attr("data-facet-term") ?? "",
    FacetType: strictInt(results.attr("data-facet-type"), false) ?? null,
    FacetFilters: [...staticFilters, {
      ID: partition.id, FacetType: partition.facetType, Count: partition.declaredCount,
      Display: partition.descriptor, IsApplied: true, FieldName: partition.fieldName
    }],
    SearchResultsModuleName: results.attr("data-search-results-module-name") ?? null,
    SearchFiltersModuleName: filters.attr("data-search-filters-module-name") ?? null,
    SortCriteria: numberOr(results, "data-sort-criteria", 0),
    SortDirection: numberOr(results, "data-sort-direction", 1),
    SearchType: numberOr(results, "data-search-type", 1),
    CategoryFacetTerm: results.attr("data-category-facet-term") ?? "",
    CategoryFacetType: strictInt(results.attr("data-category-facet-type"), false) ?? null,
    LocationFacetTerm: results.attr("data-location-facet-term") ?? "",
    LocationFacetType: strictInt(results.attr("data-location-facet-type"), false) ?? null,
    KeywordType: results.attr("data-keyword-type") ?? "", LocationType: results.attr("data-location-type") ?? "",
    LocationPath: results.attr("data-location-path") ?? "", OrganizationIds: results.attr("data-organization-ids") ?? "",
    PostalCode: results.attr("data-postal-code") ?? "", ResultsType: numberOr(results, "data-results-type", 0),
    fc: filters.attr("data-filtered-categories") ?? "", fl: filters.attr("data-filtered-locations") ?? "",
    fcf: filters.attr("data-filtered-custom-facet") ?? "", afc: filters.attr("data-filtered-advanced-categories") ?? "",
    afl: filters.attr("data-filtered-advanced-locations") ?? "", afcf: filters.attr("data-filtered-advanced-custom-facet") ?? "",
    CurrentPage: page
  };
  endpoint.search = encodeTalentbrew(criteria);
  return endpoint.toString();
}

function encodeTalentbrew(criteria: Record<string, TalentValue>): string {
  const pairs: string[] = [];
  const append = (key: string, value: TalentValue): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        if (plainObject(child)) Object.entries(child).forEach(([name, nested]) => append(`${key}[${index}].${name}`, nested));
        else append(`${key}[${index}]`, child);
      });
    } else if (plainObject(value)) {
      Object.entries(value).forEach(([name, child]) => append(`${key}.${name}`, child));
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value == null ? "" : String(value))}`);
    }
  };
  Object.entries(criteria).forEach(([key, value]) => append(key, value));
  return pairs.join("&").replace(/%20/g, "+");
}

function plainObject(value: TalentValue): value is { [key: string]: TalentValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictTalentbrewResults(body: string): string {
  assertNoDuplicateJsonKeys(body);
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid response");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "results" && key !== "hasContent") ||
    typeof record.results !== "string" ||
    (record.hasContent !== undefined && typeof record.hasContent !== "boolean")) throw new Error("invalid response");
  return record.results;
}

function assertNoDuplicateJsonKeys(body: string): void {
  const ast = parseExpression(`(${body})`, { sourceType: "script", plugins: ["typescript"] });
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "ObjectExpression") {
      const keys = new Set<string>();
      for (const property of node.properties) {
        if (property.type !== "ObjectProperty" || property.computed ||
          !["Identifier", "StringLiteral", "NumericLiteral"].includes(property.key.type)) throw new Error("invalid JSON object");
        const key = property.key.type === "Identifier" ? property.key.name : String(property.key.value);
        if (keys.has(key)) throw new Error("duplicate JSON key");
        keys.add(key);
        visit(property.value);
      }
    } else if (node.type === "ArrayExpression") {
      node.elements.forEach(visit);
    }
  };
  visit(ast);
}

function queryPositiveInt(url: string, key: string): number | undefined {
  return strictInt(new URL(url).searchParams.get(key) ?? undefined, true);
}

function strictInt(value: string | undefined, positive: boolean): number | undefined {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/u.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && (!positive || number > 0) ? number : undefined;
}

function tupuTotalPages(value: string): number | undefined {
  const match = /^\s*共\s*([1-9]\d*)\s*页\s*$/u.exec(value);
  return match ? strictInt(match[1], true) : undefined;
}

function tupuPageSize(value: string): number | undefined {
  const match = /^\s*pageTurn\(\s*\d+\s*,\s*([1-9]\d*)(?:\.0+)?\s*\)\s*$/u.exec(value);
  return match ? strictInt(match[1], true) : undefined;
}

function tupuBody(offset: number, pageSize: number, recruitmentType: string | null): string {
  const body = new URLSearchParams({ offset: String(offset), max: String(pageSize) });
  if (recruitmentType) body.set("recruitmentType", recruitmentType);
  return body.toString();
}
