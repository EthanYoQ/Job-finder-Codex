import { parseNovoTimeoutReceipt, novoNativeTimeoutArtifact, novoNativeTimeoutRetryArtifact, type NovoTimeoutRetryStart } from "./novoNativeTimeout";
import { NOVO_NATIVE_RETRY, novoNativeGatewayFailureArtifact, novoNativeGatewayReplayFinalUrl, novoNativeGatewayRetryArtifact, type NovoNativeGatewayRetryStart } from "./novoNativeGatewayRetry";
import { load as loadHtml } from "cheerio";
import { createHash } from "node:crypto";
import { isDeepStrictEqual as same } from "node:util";
import type { OfficialJsonFetchConfig } from "./officialJsonSourceFetch";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId, safeOfficialJsonEvidenceUrl, officialJsonRawLocator } from "./officialJsonEvidence";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { reviewedMainlandCity } from "./reviewedMainlandCity";

export const NOVO_CHINA_LOCATION_POLICY = "NOVO_CHINA_NESTED_LOCATION_V2" as const;
export const NOVO_NATIVE_APPLICATION_POLICY = "NOVO_NATIVE_APPLICATION_V1" as const;
export const NOVO_CHINA_ENDPOINT = "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
const ENTRY = "https://www.novonordisk.com.cn/careers/find-a-job/career-search-results.html?searchText=&countries=China&categories=";
const SOURCE_ID = "source-novo-nordisk-china-social", COMPANY_ID = "company-novo-nordisk-china";
// Retain source-specific reviewed pairs and reuse the shared reviewed geography.
// A contradictory or unknown country/state/city never becomes city-pending.
const LOCATIONS = [
  { city: "Beijing", state: "Beijing", normalized: "北京" },
  { city: "Shanghai", state: "Shanghai", normalized: "上海" },
  { city: "Hangzhou", state: "Zhejiang", normalized: "杭州" },
  { city: "Daqing", state: "Heilongjiang", normalized: "大庆" },
  { city: "Songyuan", state: "Jilin", normalized: "松原" },
  { city: "Changchun", state: "Jilin", normalized: "长春" }
] as const;
function novoChinaCity(city: string, state: string): string | undefined {
  return LOCATIONS.find(item => item.city === city && item.state === state)?.normalized ?? reviewedMainlandCity(city, state);
}
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
    states.some(item => item.label !== item.value || !cities.some(city => novoChinaCity(city.value, item.value))) ||
    cities.some(item => item.label !== item.value || !states.some(state => novoChinaCity(item.value, state.value)))) return undefined;
  const rawJobs: Record<string, unknown>[] = [], jobs: Projection[] = [], ids = new Set<string>();
  for (const value of data.jobs) {
    const raw = record(value);
    if (!raw || !exactKeys(raw, RAW_FIELDS) || typeof raw.jobId !== "string" || !/^[1-9][0-9]{5}\.en_GB$/u.test(raw.jobId) ||
      raw.jobLocale !== "en_GB" || !text(raw.jobTitle) || ids.has(raw.jobId) || !same(pair(raw.jobCountry), { label: "China", value: "China" })) return undefined;
    const state = pair(raw.jobState), city = pair(raw.jobCity), category = pair(raw.jobCategory), subcategory = pair(raw.jobSubCategory);
    const normalizedCity = state && city ? novoChinaCity(city.value, state.value) : undefined;
    if (!state || !city || !normalizedCity || state.label !== state.value || city.label !== city.value ||
      raw.jobLocationLabel !== `China, ${city.value}` || !category || !subcategory ||
      !states.some(item => same(item, state)) || !cities.some(item => same(item, city)) ||
      !subcategories.some(item => same(item, subcategory))) return undefined;
    ids.add(raw.jobId); rawJobs.push(raw);
    jobs.push({ sourceJobId: persistentOfficialJsonJobId(raw.jobId), title: raw.jobTitle.replace(/\s+/gu, " ").trim(),
      locationRaw: raw.jobLocationLabel, cities: [normalizedCity],
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

/** A native link is not evidence of a usable JD. Inspect only the unique visible
 * right column, never title/location/apply chrome or recruitment boilerplate.
 * Unrecognised/ambiguous content stays UNKNOWN; it is not an explicit closure. */
export function novoNativeDetailHasSubstantiveDescription(body: string): boolean {
  const $ = loadHtml(body), root = $("#careerjobdisplay"), details = root.find(".job-display-details.right-column");
  if (root.length !== 1 || details.length !== 1) return false;
  const hidden = (node: Parameters<typeof $>[0]) => {
    const element = $(node), style = element.attr("style") ?? "";
    return element.is("[hidden], [inert], [aria-hidden=true], .hidden, .hide, .d-none, .sr-only, .visually-hidden") ||
      /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|content-visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0*)?)(?:\s*!important)?\s*(?:;|$)/iu.test(style);
  };
  if (details.parents().addBack().toArray().some(hidden)) return false;
  const content = details.clone();
  content.find(".job-display-info, .job-display-details-buttons, a, button, form, input, script, style, template, noscript, svg, h1, h2, h3, h4, h5, h6").remove();
  content.find("*").toArray().filter(hidden).forEach(node => $(node).remove());
  content.find("br").replaceWith("\n");
  // Preserve actual paragraphs/list items (including Chinese/bilingual and
  // heading-free narratives). Do not add unrelated blocks to meet a page length.
  const blockSelector = "p, li, td, div, section, article";
  const metadata = new Set(root.find("h1, .job-display-info p").toArray().map(node => clean($(node).text())));
  const blocks = content.find(blockSelector).addBack().toArray();
  return blocks.some(node => {
    // Read a block's own text separately from nested blocks. A genuine direct
    // narrative must not disappear merely because a footer div follows it.
    const block = $(node).clone(); block.find(blockSelector).remove();
    const value = clean(block.text().replace(/[\u200B-\u200D\uFEFF]/gu, ""));
    if (!value || metadata.has(value)) return false;
    // Formatting alone cannot distinguish a heading from a bold duty. Reject
    // label-only combinations, while retaining substantive bold paragraphs.
    const withoutLabels = value.replace(/\b(?:the|this|your|and|about|key|main|job|role|position|summary|responsibilities|duties|tasks|qualifications|requirements|education|background|professional|experience|skills|competencies|design|development|leadership|management)\b/giu, "")
      .replace(/(?:重要职责|岗位职责|主要工作任务|任职资格|任职要求|教育背景|专业经验|职位介绍|职位描述)/gu, "");
    if (!/\p{L}/u.test(withoutLabels)) return false;
    if (/^(?:[\s*•\-–—.\d()]+)?(?:TBD\b|TBC\b|N\/?A\b|to be (?:defined|confirmed|completed|updated)|coming soon|no (?:job )?description|(?:please\s+)?(?:insert|enter|add|write|describe)\b|待补充|待完善|暂无|敬请期待|请(?:填写|输入|补充)|此处填写)/iu.test(value)) return false;
    if (/\b(?:TBD|TBC)\b|\[(?:\s*(?:insert|enter|add|write|describe|TBD|TBC)\b)[^\]]*\]|\b(?:to be|will be) (?:defined|confirmed|completed|updated|specified|added)(?:\s+later)?\b|(?:待填写|待补充|此处填写|请填写)/iu.test(value)) return false;
    if (/^(?:We commit to an inclusive recruitment process|(?:We are |Novo Nordisk is an? )?(?:an? )?equal opportunity employer|At Novo Nordisk[,，]|Working at Novo Nordisk|About Novo Nordisk|For over (?:a century|\d+ years)|When you join Novo Nordisk|在诺和诺德|关于诺和诺德|您在寻找一家)/iu.test(value)) return false;
    if (/^(?:develop|build|grow|advance|shape|start|launch|explore|discover)\b.*\b(?:your career|career opportunities|exciting opportunities|career with us)\b/iu.test(value)) return false;
    if (/^(?:发挥您|发展您|开启|探索|加入我们|携手).*(?:职业生涯|职业发展|精彩机会|美好未来)/u.test(value)) return false;
    // A concise degree-plus-discipline requirement is substantive without
    // padding, sentence punctuation or a particular heading/format.
    if (/\b(?:ph\.?d\.?|(?:bachelor|master)[’']?s?(?: degree)?)\s+(?:in|of)\s+[a-z]{3,}/iu.test(value) ||
      /\p{Script=Han}{2,12}(?:本科|硕士|博士|大专)(?:及以上)?学历/u.test(value)) return true;
    // Require role-bearing content, not just a heading keyword. These are
    // language-level duty/qualification signals, not job IDs or heading names.
    const dutyOrQualification = /(?:负责|任职者需要|应聘者需要|承担|开展|制定|执行|设计|建立|维护|推动|分析|具备|学历|工作经验|相关.{0,8}经验)|\b(?:responsible for|accountable for|(?:you will|(?:this |the )?(?:role|position) (?:involves|includes|entails)) (?:design(?:ing)?|develop(?:ing)?|lead(?:ing)?|manag(?:e|ing)|perform(?:ing)?|analy[sz](?:e|ing)|support(?:ing)?|conduct(?:ing)?|coordinat(?:e|ing)|implement(?:ing)?|take ownership)|(?:candidate|applicant)s? (?:will|must|should|need)|(?:bachelor|master)[’']?s? degree|ph\.?d\.?|(?:professional|industrial|relevant|working|hands.on) experience|years?[’']? (?:of )?experience|experience (?:in|with))\b|^(?:[\s•●\-–—\d.)]+)?(?:design(?:ing)?|develop(?:ing)?|lead(?:ing)?|manag(?:e|ing)|coordinat(?:e|ing)|conduct(?:ing)?|perform(?:ing)?|deliver(?:ing)?|execut(?:e|ing)|support(?:ing)?|analy[sz](?:e|ing)|build(?:ing)?|driv(?:e|ing)|ensur(?:e|ing)|provid(?:e|ing)|maintain(?:ing)?|implement(?:ing)?|contribut(?:e|ing)|serv(?:e|ing)|own(?:ing)?|plan(?:ning)?)\b/iu;
    if (!dutyOrQualification.test(value)) return false;
    const chinese = value.match(/\p{Script=Han}/gu) ?? [], words = value.toLowerCase().match(/[a-z]+(?:['’\-][a-z]+)*/gu) ?? [];
    return (chinese.length >= 20 && new Set(chinese).size >= 12) ||
      (words.length >= 8 && new Set(words).size >= 6 && words.join("").length >= 40 &&
        /\b(?:and|or|the|a|an|to|for|with|in|of|across|through|within|using|from|by|into|on)\b|[,;:]/iu.test(value));
  });
}

/** Bind the native apply href independently of JD sufficiency. A valid link alone is not publishable. */
export function novoNativeApplicationUrl(body: string, detailUrl: string, jobId: string): string | undefined {
  const $ = loadHtml(body);
  if ($("#careerjobdisplay").length !== 1 || !clean($("#careerjobdisplay h1").text())) return undefined;
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

export function novoInsufficientDetailLoss(raw: Record<string, unknown>, recordIndex: number, recordedAt: string): PersistentSourceFetchEvidence["fetchLosses"][number] {
  return { stage: "VALIDATION", reason: "Novo native detail has no substantive job description",
    rawLocator: officialJsonRawLocator(raw, recordIndex),
    details: { code: "NOVO_DETAIL_INSUFFICIENT", pageSequence: 0, recordIndex }, recordedAt };
}

/** Replay every list member. Insufficient JD is unpublished, never explicit closure;
 * unavailable or unbound pages still fail the source. */
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
    entry.logicalKey !== "novo-native-entry" || !novoNativeDetailBase(body(entry))) return false;
  let cursor = 2, previousTime = Date.parse(entry.capturedAt);
  let sourceDeadlineAt: string | undefined;
  if (!Number.isFinite(previousTime) || previousTime < Date.parse(capturedAt) || previousTime < Date.parse(artifact.capturedAt)) return false;
  const observeDeadline = (deadline: string): boolean => {
    if (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) > Date.parse(capturedAt) + NOVO_NATIVE_RETRY.sourceMs ||
        (sourceDeadlineAt !== undefined && deadline !== sourceDeadlineAt)) return false;
    sourceDeadlineAt = deadline;
    return true;
  };
  const readNative = (requestedUrl: string, logicalKey: string, application: boolean): typeof artifact | undefined => {
    const failed = evidence.artifacts[cursor];
    let retryStartedAt: string | undefined, failedFinalUrl: string | undefined;
    if (failed?.logicalKey === `${logicalKey}-http-error-1`) {
      if (Date.parse(failed.capturedAt) < previousTime) return undefined;
      const retry = evidence.artifacts[cursor + 1];
      if (!retry || !hasUniqueJsonObjectKeys(body(retry))) return undefined;
      try {
        const start = JSON.parse(body(retry)) as NovoNativeGatewayRetryStart;
        const regeneratedFailure = novoNativeGatewayFailureArtifact({ status: failed.httpStatus!, body: body(failed),
          finalUrl: novoNativeGatewayReplayFinalUrl(failed.finalUrl, requestedUrl, application),
          contentType: failed.contentType!, capturedAt: failed.capturedAt }, requestedUrl, logicalKey);
        const regeneratedStart = novoNativeGatewayRetryArtifact(start, failed, requestedUrl, logicalKey, application);
        if (!same({ ...failed, id: regeneratedFailure.id }, regeneratedFailure) ||
            !same({ ...retry, id: regeneratedStart.id }, regeneratedStart) || !observeDeadline(start.sourceDeadlineAt)) return undefined;
        retryStartedAt = start.startedAt; failedFinalUrl = failed.finalUrl;
      } catch { return undefined; }
      cursor += 2;
    } else if (failed?.logicalKey === `${logicalKey}-request-error-1`) {
      if (!hasUniqueJsonObjectKeys(body(failed))) return undefined;
      try {
        const receipt = parseNovoTimeoutReceipt(JSON.parse(body(failed)), requestedUrl);
        const regenerated = novoNativeTimeoutArtifact(receipt, requestedUrl, logicalKey, 1);
        const retry = evidence.artifacts[cursor + 1];
        if (!retry || !hasUniqueJsonObjectKeys(body(retry))) return undefined;
        const start = JSON.parse(body(retry)) as NovoTimeoutRetryStart;
        const regeneratedStart = novoNativeTimeoutRetryArtifact(start, receipt, requestedUrl, logicalKey);
        if (!same({ ...failed, id: regenerated.id }, regenerated) || !same({ ...retry, id: regeneratedStart.id }, regeneratedStart) ||
            Date.parse(receipt.requestStartedAt) < previousTime || !observeDeadline(receipt.sourceDeadlineAt)) return undefined;
        retryStartedAt = start.startedAt;
      } catch { return undefined; }
      cursor += 2;
    }
    const page = evidence.artifacts[cursor++];
    if (!page || !exact(page, requestedUrl) || page.logicalKey !== logicalKey || page.kind !== "OFFICIAL_COMPANY_PAGE" ||
        page.extractorLocator !== logicalKey || !Number.isFinite(Date.parse(page.capturedAt)) || Date.parse(page.capturedAt) < previousTime ||
        (retryStartedAt !== undefined && (Date.parse(page.capturedAt) < Date.parse(retryStartedAt) ||
          Date.parse(page.capturedAt) > Date.parse(retryStartedAt) + NOVO_NATIVE_RETRY.requestMs)) ||
        (sourceDeadlineAt !== undefined && Date.parse(page.capturedAt) >= Date.parse(sourceDeadlineAt))) return undefined;
    if (failedFinalUrl && new URL(failedFinalUrl).pathname.startsWith("/job/") && page.finalUrl !== failedFinalUrl) return undefined;
    previousTime = Date.parse(page.capturedAt);
    return page;
  };
  const expected: Projection[] = [], losses: PersistentSourceFetchEvidence["fetchLosses"] = [];
  for (let i = 0; i < parsed.total; i++) {
    const raw = parsed.rawJobs[i]!, projection = parsed.jobs[i]!;
    const detail = readNative(projection.officialUrl, `novo-detail-${raw.jobId}`, false);
    if (!detail || detail.finalUrl !== projection.officialUrl) return false;
    const href = novoNativeApplicationUrl(body(detail), projection.officialUrl, String(raw.jobId));
    if (!href) return false;
    if (!novoNativeDetailHasSubstantiveDescription(body(detail))) {
      losses.push(novoInsufficientDetailLoss(raw, i, detail.capturedAt));
      continue;
    }
    const application = readNative(href, `novo-application-${raw.jobId}`, true);
    if (!application) return false;
    const state = novoApplicationStatus(body(application), application.finalUrl!, String(record(raw.jobCity)!.value));
    if (!state) return false;
    if (state.status === "CLOSED") losses.push(novoClosedLoss(raw, i, application.capturedAt));
    else expected.push({ ...projection, title: state.title! });
  }
  if (cursor !== evidence.artifacts.length) return false;
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

/** Invoked only after owned admission has replayed each exclusion against its original body. */
export function novoSourceJobExclusions(evidence: PersistentSourceFetchEvidence): { closed: Set<string>; insufficient: Set<string> } {
  const raw = evidence.artifacts[0]?.body;
  const parsed = raw === undefined ? undefined : parseNovoChinaResponse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
  const closed = new Set<string>(), insufficient = new Set<string>();
  for (const loss of evidence.fetchLosses) {
    const { code, recordIndex } = loss.details as { code: string; recordIndex: number };
    const row = parsed?.rawJobs[recordIndex];
    if (!row) continue;
    const id = persistentOfficialJsonJobId(String(row.jobId));
    if (code === "OFFICIAL_APPLICATION_CLOSED") closed.add(id);
    if (code === "NOVO_DETAIL_INSUFFICIENT") insufficient.add(id);
  }
  return { closed, insufficient };
}
