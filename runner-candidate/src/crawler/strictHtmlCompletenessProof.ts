import { explicitlyForeignOrNonMainlandLocation } from "./officialJsonEvidence";
import { jobQuarantineLossesMatch, restoreQuarantinedList, type JobQuarantine } from './jobQuarantine';
import { replayKelunMainlandScope } from "./kelunMainlandScope";
import {hasSanofiNativePolicy,validateSanofiNativeQuality} from "./sanofiNativeQuality";
import type {NormalizedJobRecord} from "./normalizedJob";
import { validateAbbvieChinaRowScope } from "./abbvieChinaRowScope";
import { sourcePlanConfigSha256 } from "./sourcePlan";
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
import {
  htmlTableRowFilterCoversCompletenessUniverse,
  selectHtmlTableRows
} from "./htmlTableRows";
import { strictCompletenessTrace } from "./strictCompletenessTrace";

type HtmlPlan = Extract<SourceCrawlPlan, { adapterId: "html-table" }>;
type ExactArtifact = SourceFetchArtifactDraft & { body: string; requestedUrl: string; finalUrl: string };

function htmlProofTrace(_plan: HtmlPlan, _reason: string): false {
  return strictCompletenessTrace("STRICT_HTML_PROOF", _plan.source.id, _reason);
}

/**
 * Independently replays the archived HTML responses against the source-bound
 * plan. It deliberately does not import any parsing or pagination helper from
 * the network fetcher whose declaration it is checking.
 */
export function validateStrictHtmlCompletenessProof(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  jobs?: readonly NormalizedJobRecord[]
): boolean {
  const quarantines=evidence.jobQuarantines??[];
  if(evidence.jobQuarantines?.length){
    if(!jobQuarantineLossesMatch(evidence))return false;
    evidence=restoreQuarantinedList(evidence);
  }
  if (plan.source.id === "source-kelun-social") {
    const replay = replayKelunMainlandScope(plan, evidence, jobs);
    return !!replay && validateBaseStrictHtmlCompletenessProof(plan, replay.rawEvidence, jobs);
  }
  return validateBaseStrictHtmlCompletenessProof(plan, evidence, jobs,quarantines);
}

function validateBaseStrictHtmlCompletenessProof(
  plan: HtmlPlan, evidence: PersistentSourceFetchEvidence, jobs?: readonly NormalizedJobRecord[],quarantines:readonly JobQuarantine[]=[]
): boolean {
  try {
    if (hasSanofiNativePolicy(plan)) return validateSanofiNativeQuality(plan,evidence,jobs);
    // Neither frozen source currently has an audited explicit-empty assertion.
    // Bind the rejection to identity so legacy plans or a generic-policy replay
    // cannot restore the retired warning/HR-page zero shortcut.
    if (evidence.fetchCounts.rawCount === 0 && [
      "source-sandoz-china-social", "source-otsuka-china-social"
    ].includes(plan.source.id)) return htmlProofTrace(plan, "UNPROVEN_SOURCE_ZERO");
    const policy = plan.table.completenessProof;
    const declaration = evidence.declaredCompleteness;
    if (!policy || !declaration || declaration.scope !== "SOURCE" || declaration.channelId !== undefined ||
      evidence.supportingArtifactOnlyFailure || evidence.fetchLosses.length !== 0 ||
      evidence.fetchCounts.parseDiscardCount !== 0 || evidence.fetchCounts.validationDiscardCount !== 0 ||
      evidence.fetchCounts.rawCount !== evidence.fetchCounts.parsedCount ||
      evidence.fetchCounts.rawCount !== evidence.fetchCounts.validCount || evidence.pages.length === 0 ||
      !contiguousSequences(evidence.pages)) return htmlProofTrace(plan, "EVIDENCE_ENVELOPE");

    const artifacts = evidence.artifacts.map(exactNetworkArtifact);
    if (artifacts.some((artifact) => artifact === undefined)) return htmlProofTrace(plan, "EXACT_ARTIFACTS");
    const exact = artifacts as ExactArtifact[];
    if (plan.source.id === "source-abbvie-china-social" && (
      sourcePlanConfigSha256(plan) !== "4bc13113d0ea829b7df6935081d009ac389f24c97340390f09bbb7ad5234e5a9" ||
      !exact.every(artifact => {
        const pageSequence=evidence.pages.findIndex(page=>page.artifactLogicalKey===artifact.logicalKey),$=load(artifact.body);
        return $('.attrax-vacancy-tile').toArray().every((row,recordIndex)=>validateAbbvieChinaRowScope($.html(row))||
          quarantines.some(q=>q.pageSequence===pageSequence&&q.recordIndex===recordIndex));
      })
    )) return htmlProofTrace(plan, "ABBVIE_ROW_SCOPE_UNREVIEWED");
    if (new Set(exact.map((artifact) => artifact.logicalKey)).size !== exact.length) return htmlProofTrace(plan, "ARTIFACT_KEYS");

    if (policy.kind === "OFFICIAL_TOTAL_PAGES") {
      return plan.table.pagination?.ajaxMode === "talentbrew" &&
        plan.table.pagination.talentbrewScope === undefined
        ? validateUnpartitionedTalentbrewOfficialTotal(plan, evidence, exact)
        : validateOrdinaryTotalPages(plan, evidence, exact);
    }
    if (policy.kind === "CONFIGURED_CHANNEL_TRAVERSAL") {
      return plan.table.pagination?.ajaxMode === "talentbrew"
        ? validateTalentbrewTraversal(plan, evidence, exact)
        : plan.table.pagination?.ajaxMode === "tupu360"
          ? validateTupuTraversal(plan, evidence, exact)
          : false;
    }
    if (policy.kind === "STATIC_PUBLIC_LIST") {
      return validateStaticPublicList(plan, evidence, exact,quarantines);
    }
    return htmlProofTrace(plan, "UNSUPPORTED_POLICY");
  } catch {
    return htmlProofTrace(plan, "THREW");
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
  const officialZeroDeclaration = declaration.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value === 0;
  const officialPositiveDeclaration = declaration.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value > 0;
  if (!pagination || pagination.ajaxMode || artifacts.length !== evidence.pages.length ||
    (officialZeroDeclaration
      ? evidence.pages.length !== 1
      : officialPositiveDeclaration
        ? declaration.value !== evidence.fetchCounts.rawCount
        : declaration.kind !== "OFFICIAL_TOTAL_PAGES" || declaration.value !== evidence.pages.length)) return false;

  if (plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "NOVARTIS_CHINA_SLIDING_WINDOW_V1") {
    return validateNovartisSlidingWindow(plan, evidence, artifacts);
  }

  const seen = new Set<string>();
  let repeatedOfficialJobTotal: number | undefined;
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const page = evidence.pages[index]!;
    const artifact = artifactForPage(page, artifacts);
    const pageNumber = index + 1;
    const rawExpectedUrl = pageNumber === 1 && pagination.requestFirstPageExplicitly !== true
      ? configuredUrl(plan.source.officialEntryUrl)
      : configuredUrl(buildOrdinaryPageUrl(plan.source.officialEntryUrl, pagination, pageNumber));
    const expectedUrl = evidenceUrl(rawExpectedUrl);
    const expectedCoordinate = ordinaryCoordinate(rawExpectedUrl, pagination);
    const explicitPageTotal = officialTotalPages(artifact?.body ?? "", pagination);
    const officialJobTotal = officialExpectedJobCount(artifact?.body ?? "", pagination);
    const declaredPageTotal = explicitPageTotal ?? (
      officialJobTotal !== undefined && pagination.pageSize !== undefined
        ? Math.max(1, Math.ceil(officialJobTotal / pagination.pageSize))
        : undefined
    );
    if (officialJobTotal !== undefined && (
      repeatedOfficialJobTotal !== undefined && repeatedOfficialJobTotal !== officialJobTotal
    )) return false;
    if (officialJobTotal !== undefined) repeatedOfficialJobTotal = officialJobTotal;
    const totalDeclarationValid = index === 0 || pagination.totalPagesDeclaredOnEntryOnly !== true
      ? declaredPageTotal === evidence.pages.length
      : declaredPageTotal === undefined || declaredPageTotal <= evidence.pages.length;
    const terminationValid = officialJobTotal === 0 && evidence.pages.length === 1
      ? page.termination === "EMPTY_PAGE" && page.nextPageSignalAfter == null &&
        page.declaredTotal === 0 && page.rawJobIds.length === 0 && page.validJobIds.length === 0
      : validTermination(page, index, evidence.pages.length);
    if (!artifact || !sameUrl(artifact, expectedUrl) || artifact.channelId !== undefined ||
      page.channelId !== undefined || !equalOptional(page.requestedPage, expectedCoordinate.requestedPage) ||
      !equalOptional(page.requestedOffset, expectedCoordinate.requestedOffset) ||
      page.requestedCursor != null || page.returnedCursor != null || page.returnedPage != null ||
      page.declaredPages !== evidence.pages.length ||
      !terminationValid ||
      !matchesRequestContract(artifact, plan.table.rowSelector, index === 0 ? "entry" : "ordinary-page", index, "GET", expectedUrl, null, {
        sequence: index, ...expectedCoordinate
      }) || !totalDeclarationValid ||
      !validateStrictOrdinaryPageControls(plan, artifact.body, pageNumber, evidence.pages.length) ||
      !htmlTableRowFilterCoversCompletenessUniverse(load(artifact.body), plan.table) ||
      !replayRows(artifact.body, plan.table, page, seen)) return false;
  }
  const genericValid = declaration.artifactLogicalKey === evidence.pages[0]!.artifactLogicalKey &&
    declaration.extractorLocator === artifacts[0]!.extractorLocator &&
    evidence.fetchCounts.rawCount === seen.size &&
    (repeatedOfficialJobTotal === undefined || evidence.fetchCounts.rawCount === repeatedOfficialJobTotal) &&
    (!officialPositiveDeclaration || repeatedOfficialJobTotal === declaration.value);
  if (!genericValid) return false;
  if (officialZeroDeclaration && (repeatedOfficialJobTotal !== 0 || evidence.fetchCounts.rawCount !== 0 ||
    evidence.fetchCounts.parsedCount !== 0 || evidence.fetchCounts.validCount !== 0 ||
    evidence.fetchCounts.parseDiscardCount !== 0 || evidence.fetchCounts.validationDiscardCount !== 0 ||
    evidence.fetchLosses.length !== 0)) return false;
  return plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "BAYER_CHINA_SUCCESSFACTORS_V1"
    ? validateBayerChinaPages(plan, evidence, artifacts)
    : true;
}

function validateStrictOrdinaryPageControls(
  plan: HtmlPlan,
  html: string,
  page: number,
  totalPages: number
): boolean {
  const pagination = plan.table.pagination;
  const controls = pagination?.strictPageControls;
  if (!controls) return true;
  if (!pagination || page < 1 || page > totalPages) return false;

  const $ = load(html);
  const container = $(controls.containerSelector);
  if (container.length !== 1) return false;
  const numbered = container.find(controls.pageNumberSelector).toArray();
  const current = container.find(controls.currentPageSelector);
  const previous = container.find(controls.previousPageSelector);
  const next = container.find(controls.nextPageSelector);
  if (numbered.length === 0 || current.length !== 1 || previous.length !== 1 || next.length !== 1 ||
    !numbered.includes(current.get(0)!)) return false;

  const numberedPages = numbered.map((element) => strictInt(normalizedText($(element).text()), true));
  if (numberedPages.some((value) => value === undefined)) return false;
  const exactPages = numberedPages as number[];
  if (new Set(exactPages).size !== exactPages.length || !exactPages.includes(1) ||
    !exactPages.includes(totalPages) || !exactPages.includes(page)) return false;

  const expectedUrl = (targetPage: number): string => configuredUrl(
    targetPage === 1
      ? plan.source.officialEntryUrl
      : buildOrdinaryPageUrl(plan.source.officialEntryUrl, pagination, targetPage)
  );
  for (let index = 0; index < numbered.length; index += 1) {
    const element = $(numbered[index]!);
    const targetPage = exactPages[index]!;
    const rawHref = element.attr("href");
    if (targetPage === page) {
      if (numbered[index] !== current.get(0) || rawHref !== controls.currentHref) return false;
    } else if (!sameControlHref(rawHref, expectedUrl(targetPage), plan.source.officialEntryUrl)) {
      return false;
    }
  }

  const disabled = (element: typeof previous): boolean => new Set(
    (element.attr("class") ?? "").split(/\s+/u).filter(Boolean)
  ).has(controls.disabledClass);
  const previousPage = page === 1 ? 1 : page - 1;
  const nextPage = page === totalPages ? totalPages : page + 1;
  return sameControlHref(previous.attr("href"), expectedUrl(previousPage), plan.source.officialEntryUrl) &&
    disabled(previous) === (page === 1) &&
    sameControlHref(next.attr("href"), expectedUrl(nextPage), plan.source.officialEntryUrl) &&
    disabled(next) === (page === totalPages);
}

function sameControlHref(raw: string | undefined, expected: string, base: string): boolean {
  if (!raw) return false;
  try {
    return configuredUrl(new URL(raw, base).toString()) === expected;
  } catch {
    return false;
  }
}

function validateBayerChinaPages(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const pagination = plan.table.pagination;
  if (!pagination || !exactBayerPlan(plan) || evidence.pages.length < 1) return htmlProofTrace(plan, "BAYER_PLAN");
  const declaration = evidence.declaredCompleteness!;
  if (declaration.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value === 0) {
    if (artifacts.length !== 1 || evidence.pages.length !== 1 ||
      !matchesStrictPaginationExplicitEmptyState(artifacts[0]!.body, pagination)) {
      return htmlProofTrace(plan, "BAYER_EMPTY_MARKER");
    }
    const $ = load(artifacts[0]!.body);
    if ($(plan.table.rowSelector).length !== 0) return htmlProofTrace(plan, "BAYER_EMPTY_SELECTED_ROWS");
    const fallbackLocations = $("#searchresults tbody tr td.colLocation").toArray()
      .map((element) => normalizedText($(element).text()))
      .filter((location): location is string => location !== undefined);
    if (fallbackLocations.some((location) => location.split(",").map((part) => part.trim()).at(-1) === "CN")) {
      return htmlProofTrace(plan, "BAYER_EMPTY_CONTRADICTED");
    }
    return true;
  }
  const declaredTotals = new Set<number>();
  const jobUrls = new Set<string>();
  let observedRows = 0;

  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index]!;
    const page = evidence.pages[index]!;
    const $ = load(artifact.body);
    const resultContainers = $("#searchresults[aria-label]");
    const labels = $(".paginationLabel");
    if (resultContainers.length !== 1 || labels.length !== 1) return htmlProofTrace(plan, `BAYER_CONTAINERS:${index + 1}`);
    const aria = resultContainers.first().attr("aria-label") ?? "";
    const declaredPages = /共\s*([1-9]\d*)\s*页/u.exec(aria);
    const totalMatch = /\s*(\d+)\s*$/u.exec(labels.first().text());
    const total = totalMatch ? strictInt(totalMatch[1], false) : undefined;
    if (!declaredPages || strictInt(declaredPages[1], true) !== evidence.pages.length || total === undefined) return htmlProofTrace(plan, `BAYER_TOTALS:${index + 1}`);
    declaredTotals.add(total);

    const expectedOffset = index === 0 ? null : index * 10;
    if ((page.requestedOffset ?? null) !== expectedOffset || page.requestedPage != null ||
      page.returnedPage != null || page.requestedPageSize !== 10) return htmlProofTrace(plan, `BAYER_COORDINATES:${index + 1}`);

    const rows = $(plan.table.rowSelector).toArray();
    const finalPage = index === artifacts.length - 1;
    if (rows.length < 1 || rows.length > 10 || (!finalPage && rows.length !== 10)) return htmlProofTrace(plan, `BAYER_ROWS:${index + 1}`);
    observedRows += rows.length;
    for (const row of rows) {
      const title = $(row).find(".jobTitle.hidden-phone a.jobTitle-link");
      const location = normalizedText($(row).find("td.colLocation").text());
      const rawUrl = title.attr("href");
      const officialUrl = rawUrl ? strictSameOriginUrl(rawUrl, plan.source.officialEntryUrl) : undefined;
      const locationParts = location?.split(",").map((part) => part.trim()).filter(Boolean);
      if (title.length !== 1 || !normalizedText(title.text()) || !officialUrl ||
        !officialUrl.pathname.startsWith("/job/") || !locationParts || locationParts.length < 2 ||
        locationParts.at(-1) !== "CN" || jobUrls.has(officialUrl.toString())) return htmlProofTrace(plan, `BAYER_ROW_SCOPE:${index + 1}`);
      jobUrls.add(officialUrl.toString());
    }
  }

  const total = declaredTotals.size === 1 ? [...declaredTotals][0] : undefined;
  const valid = total !== undefined && Math.max(1, Math.ceil(total / 10)) === evidence.pages.length &&
    total === jobUrls.size && total === observedRows && total === evidence.fetchCounts.rawCount;
  return valid || htmlProofTrace(plan, "BAYER_FINAL_COUNTS");
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
    declaration.extractorLocator !== artifacts[0]!.extractorLocator) return htmlProofTrace(plan, "NOVARTIS_PLAN_OR_DECLARATION");

  const seenUrls = new Set<string>();
  const signatures = new Map<string, string>();
  const responseHashes = new Set<string>();
  const observedPageTotals: number[] = [];
  let officialJobTotal: number | undefined;
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
      !validNovartisPageTotal(officialTotalPages(artifact.body, pagination), pageNumber,
        evidence.pages.length)) return htmlProofTrace(plan, `NOVARTIS_PAGE_CONTRACT:${pageNumber}`);

    const responseHash = sha256Bytes(Buffer.from(artifact.body, "utf8")).sha256;
    if (page.responseFingerprintSha256 !== responseHash || responseHashes.has(responseHash)) return htmlProofTrace(plan, `NOVARTIS_RESPONSE_HASH:${pageNumber}`);
    responseHashes.add(responseHash);

    const $ = load(artifact.body);
    const resultTotal = strictNovartisOfficialJobTotal($);
    if (resultTotal === undefined || (officialJobTotal !== undefined && resultTotal !== officialJobTotal)) {
      return htmlProofTrace(plan, `NOVARTIS_OFFICIAL_JOB_TOTAL:${pageNumber}`);
    }
    officialJobTotal = resultTotal;
    const active = strictNovartisActivePage($);
    if (!active || active.page !== pageNumber ||
      !validNovartisPageTotal(active.totalPages, pageNumber, evidence.pages.length) ||
      !strictNovartisNextState($, pageNumber, evidence.pages.length, plan.source.officialEntryUrl)) {
      return htmlProofTrace(plan, `NOVARTIS_CONTROLS:${pageNumber}`);
    }
    const pageLabels = $(pagination.totalPagesSelector).toArray();
    const pageBodyTotal = officialTotalPages(artifact.body, pagination);
    if (pageLabels.length === 0 || pageBodyTotal === undefined || pageLabels.some((element) => {
      const title = normalizedText($(element).attr(pagination.totalPagesAttribute));
      const match = title ? /out of\s+([1-9]\d*)\s+pages/iu.exec(title) : null;
      return !match || strictInt(match[1], true) !== pageBodyTotal;
    })) return htmlProofTrace(plan, `NOVARTIS_TOTAL_LABELS:${pageNumber}`);
    observedPageTotals.push(pageBodyTotal);

    const rows = strictNovartisRows(plan, artifact.body);
    if (!rows || rows.length === 0 || !replayPageRowsAllowingOverlap(artifact.body, plan.table, page)) return htmlProofTrace(plan, `NOVARTIS_ROWS:${pageNumber}`);
    observedRows += rows.length;
    let novel = 0;
    const pageUrls = new Set<string>();
    for (const row of rows) {
      if (pageUrls.has(row.url)) return htmlProofTrace(plan, `NOVARTIS_DUPLICATE_ON_PAGE:${pageNumber}`);
      pageUrls.add(row.url);
      const previousSignature = signatures.get(row.url);
      if (previousSignature !== undefined && previousSignature !== row.signature) return htmlProofTrace(plan, `NOVARTIS_SIGNATURE_DRIFT:${pageNumber}`);
      signatures.set(row.url, row.signature);
      if (!seenUrls.has(row.url)) novel += 1;
      seenUrls.add(row.url);
    }
    if (index > 0 && novel < 1) return htmlProofTrace(plan, `NOVARTIS_NO_NOVEL_ROW:${pageNumber}`);
  }
  // Raw rows may overlap between advancing official windows. The source's
  // visible result total describes distinct jobs, so matching the raw count
  // alone cannot prove completeness.
  return (evidence.fetchCounts.rawCount === observedRows && seenUrls.size === officialJobTotal &&
    Math.max(...observedPageTotals) === evidence.pages.length) ||
    htmlProofTrace(plan, "NOVARTIS_FINAL_JOB_TOTAL");
}

function strictNovartisOfficialJobTotal($: ReturnType<typeof load>): number | undefined {
  // Novartis renders a separate .view-header for the selected China filter.
  // Ignore that label, but require exactly one unambiguous result declaration.
  const declarations = $(".view-header").toArray()
    .map((element) => normalizedText($(element).text()))
    .filter((text): text is string => text !== undefined && /^Showing\b/iu.test(text));
  if (declarations.length !== 1) return undefined;
  const match = /^Showing\s+([1-9]\d*)\s+results$/iu.exec(declarations[0]!);
  return match ? strictInt(match[1], true) : undefined;
}

function validNovartisPageTotal(value: number | undefined, page: number, traversedPages: number): boolean {
  return value !== undefined && page > 0 && value > 0 && value <= traversedPages;
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
  for (const row of selectHtmlTableRows($, plan.table)) {
    const titleLink = $(row).find("td.views-field-field-job-title a");
    const rawUrl = titleLink.attr("href");
    const url = rawUrl ? strictSameOriginUrl(rawUrl, plan.source.officialEntryUrl) : undefined;
    const title = normalizedText(titleLink.text());
    const location = normalizedText($(row).find("td.views-field-field-job-work-location").text());
    const country=$(row).find("td.views-field-field-job-country").clone();
    country.find(".alternative-locations").remove();
    const explicitChina=country.length===1 && normalizedText(country.text())==="China";
    if (titleLink.length !== 1 || !url || !title || !location || NOVARTIS_NON_MAINLAND_LOCATION.test(location) || explicitlyForeignOrNonMainlandLocation(location) ||
      !explicitChina && !strictNovartisMainlandChinaLocation(location, plan.table.strictLocationScope) ||
      !url.pathname.startsWith("/careers/career-search/job/details/") || url.search || url.hash) {
      htmlProofTrace(plan, "NOVARTIS_INVALID_ROW");
      return undefined;
    }
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

function strictNovartisMainlandChinaLocation(
  value: string,
  scope: HtmlTableConfig["strictLocationScope"]
): boolean {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!normalized) return false;
  if (NOVARTIS_NON_MAINLAND_LOCATION.test(normalized)) return false;
  if (scope?.allowUnknownEnglishLocalityWithParenthesizedMainlandProvince === true &&
    strictParenthesizedMainlandProvinceLocation(normalized)) return true;
  const withoutAdministrativeAnnotations = normalized.replace(
    /\(\s*(?:city|province|municipality|prefecture|autonomous region)\s*\)/giu,
    ""
  );
  const segments = withoutAdministrativeAnnotations
    .replace(/[()（）]/gu, ",")
    .split(/\s*[,，;；/／|｜、]\s*|\s+[—–-]\s+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.every(strictNovartisMainlandLocationSegment)) return true;

  const administrativeCores = segments.map((segment) => segment.toLocaleLowerCase("en-US")
    .replace(/[.]$/u, "")
    .replace(/\s+(?:city|province|municipality|prefecture|autonomous region)$/u, "")
    .trim());
  const hasMainlandProvinceAnchor = administrativeCores.some((segment) =>
    NOVARTIS_MAINLAND_ENGLISH_PROVINCES.has(segment));
  const hasMainlandCountryAnchor = administrativeCores.some((segment) =>
    NOVARTIS_MAINLAND_COUNTRY_NAMES.has(segment));
  const unknownLocalities = segments.filter((segment) => !strictNovartisMainlandLocationSegment(segment));
  return hasMainlandProvinceAnchor && hasMainlandCountryAnchor && unknownLocalities.length === 1 &&
    /^[A-Za-z][A-Za-z .'-]{1,48}$/u.test(unknownLocalities[0]!);
}

const NOVARTIS_MAINLAND_ENGLISH_PROVINCES = new Set([
  "anhui", "beijing", "chongqing", "fujian", "gansu", "guangdong", "guangxi", "guizhou",
  "hainan", "hebei", "heilongjiang", "henan", "hubei", "hunan", "inner mongolia", "jiangsu",
  "jiangxi", "jilin", "liaoning", "ningxia", "qinghai", "shaanxi", "shandong", "shanghai",
  "shanxi", "sichuan", "tianjin", "xinjiang", "xizang", "yunnan", "zhejiang", "neimenggu"
]);

const NOVARTIS_NON_MAINLAND_LOCATION =
  /(?:香港|澳门|台湾|海外|国外|美国|日本|新加坡|印度|德国|法国|加拿大|澳大利亚|英国|韩国)|\b(?:hong kong|macao|macau|taiwan|overseas|abroad|united states|usa|u\.s\.|switzerland|basel|zurich|paris|japan|tokyo|singapore|india|germany|france|canada|australia|united kingdom|london|south korea|seoul)\b/iu;

function strictParenthesizedMainlandProvinceLocation(value: string): boolean {
  const match = /^([A-Za-z][A-Za-z .'-]{1,48})\s*\(\s*([A-Za-z][A-Za-z ]{1,30}?)(?:\s+Province)?\s*\)$/iu.exec(value);
  if (!match) return false;
  const locality = match[1]!.toLocaleLowerCase("en-US").trim();
  const province = match[2]!.toLocaleLowerCase("en-US").trim();
  return !NOVARTIS_NON_MAINLAND_LOCATION.test(locality) &&
    NOVARTIS_MAINLAND_ENGLISH_PROVINCES.has(province);
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
  table: HtmlTableConfig,
  page: SourceFetchPageTrace
): boolean {
  const $ = load(html);
  const ids = selectHtmlTableRows($, table).map((row) =>
    `html-row:sha256:${sha256Bytes(Buffer.from($.html(row), "utf8")).sha256}`
  );
  return new Set(ids).size === ids.length &&
    JSON.stringify(ids) === JSON.stringify(page.rawJobIds) &&
    JSON.stringify(ids) === JSON.stringify(page.validJobIds);
}

function strictNovartisActivePage(
  $: ReturnType<typeof load>
): { page: number; totalPages: number } | undefined {
  const active = $(".pagination .page-link[title*=' active '][title*='out of'][title*='pages'], " +
    ".pagination .page-link[title*=' 活跃 '][title*='out of'][title*='pages']");
  if (active.length !== 1) return undefined;
  const title = normalizedText(active.first().attr("title"));
  const match = title
    ? /^page\s+([1-9]\d*)\s+(?:active|活跃)\s+out of\s+([1-9]\d*)\s+pages$/iu.exec(title)
    : null;
  const page = match ? strictInt(match[1], true) : undefined;
  const totalPages = match ? strictInt(match[2], true) : undefined;
  return page !== undefined && totalPages !== undefined ? { page, totalPages } : undefined;
}

function strictNovartisNextState(
  $: ReturnType<typeof load>,
  page: number,
  totalPages: number,
  entryUrl: string
): boolean {
  const next = $(".pagination .page-link[rel='next']");
  const title = normalizedText(next.first().attr("title"));
  if (next.length !== 1 || (title !== "Go to next page" && title !== "转到下一页")) return false;
  const href = next.first().attr("href") ?? "";
  const classes = new Set((next.first().attr("class") ?? "").split(/\s+/u).filter(Boolean));
  if (page === totalPages) return href === "" && classes.has("btn") && classes.has("disabled");
  if (classes.has("disabled")) return false;
  try {
    const actual = new URL(href, entryUrl);
    const expected = new URL(entryUrl);
    expected.searchParams.set("page", String(page));
    return actual.origin === expected.origin && actual.pathname === expected.pathname &&
      canonicalSearchParams(actual.searchParams) === canonicalSearchParams(expected.searchParams);
  } catch {
    return false;
  }
}

function canonicalSearchParams(value: URLSearchParams): string {
  return JSON.stringify([...value.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)));
}

function exactBayerPlan(plan: HtmlPlan): boolean {
  const pagination = plan.table.pagination;
  const entry = configuredUrl(plan.source.officialEntryUrl);
  return plan.source.id === "source-bayer-healthcare-social" &&
    entry === "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN" &&
    plan.table.rowSelector === "body:not(:has(label .attention.securitySearchString)) #searchresults tbody tr" &&
    plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "BAYER_CHINA_SUCCESSFACTORS_V1" &&
    pagination?.totalPagesSelector === "#searchresults[aria-label]" &&
    pagination.totalPagesAttribute === "aria-label" &&
    pagination.totalPagesPattern === "共\\s*([1-9]\\d*)\\s*页" &&
    pagination.pageSearchParam === "startrow" && pagination.pageSearchParamMode === "offset" &&
    pagination.pageSize === 10 && pagination.maxPages === 100 &&
    pagination.expectedJobCountSelector === ".paginationLabel" &&
    pagination.expectedJobCountPattern === "\\s*(\\d+)\\s*$" &&
    pagination.explicitEmptyState?.selector === "label:has(.attention.securitySearchString)" &&
    pagination.explicitEmptyState.pattern === "^当前没有符合\\s*[\"“]?China[\"”]?\\s*的空缺职位。?$";
}

function exactNovartisPlan(plan: HtmlPlan): boolean {
  const pagination = plan.table.pagination;
  return plan.source.id === "source-novartis-social" &&
    configuredUrl(plan.source.officialEntryUrl) ===
      "https://www.novartis.com.cn/careers/career-search?search_api_fulltext=&country%5B0%5D=LOC_CN&op=Submit&field_job_posted_date=All&sort=asc&order=%E8%81%8C%E4%BD%8D%E5%90%8D%E7%A7%B0" &&
    plan.table.rowSelector === "table.views-table tbody tr" &&
    plan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES" &&
    plan.table.completenessProof.sourcePolicy === "NOVARTIS_CHINA_SLIDING_WINDOW_V1" &&
    plan.table.fields.sourceJobId === undefined && plan.table.fields.sourceJobIdParts === undefined &&
    plan.table.fields.officialTitle.selector === "td.views-field-field-job-title a" &&
    plan.table.fields.officialUrl.selector === "td.views-field-field-job-title a" &&
    plan.table.fields.officialUrl.attribute === "href" &&
    plan.table.fields.locationRaw.selector === "td.views-field-field-job-work-location" &&
    plan.table.strictLocationScope?.allowUnknownEnglishLocalityWithParenthesizedMainlandProvince === true &&
    pagination?.totalPagesSelector === ".pagination .page-link[title*='out of'][title*='pages']" &&
    pagination.totalPagesAttribute === "title" &&
    pagination.totalPagesPattern === "out of\\s+([1-9]\\d*)\\s+pages" &&
    pagination.totalPagesMode === "max" && pagination.pageSearchParam === "page" &&
    pagination.pageNumberOffset === -1 && pagination.maxPages === 20 &&
    pagination.totalPagesDeclaredOnEntryOnly === true &&
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
    declaration.value !== evidence.pages.length || artifacts.length !== evidence.pages.length + 1) return htmlProofTrace(plan, "TALENTBREW_ENVELOPE");

  const entry = artifacts[0]!;
  const rawEntryUrl = configuredUrl(plan.source.officialEntryUrl);
  const entryUrl = evidenceUrl(rawEntryUrl);
  if (entry.logicalKey !== "official-html-page-0000" || entry.kind !== "OFFICIAL_COMPANY_PAGE" ||
    entry.channelId !== undefined || !sameUrl(entry, entryUrl) ||
    !matchesRequestContract(entry, "#search-results[data-ajax-url]", "entry", 0, "GET", entryUrl, null, {
      sequence: 0, channelId: null, requestedPage: queryPositiveInt(entryUrl, "CurrentPage") ?? null,
      requestedPageSize: queryPositiveInt(entryUrl, "RecordsPerPage") ?? null
    }) || declaration.artifactLogicalKey !== entry.logicalKey ||
    declaration.extractorLocator !== entry.extractorLocator) return htmlProofTrace(plan, "TALENTBREW_ENTRY_CONTRACT");

  const entryDom = load(entry.body);
  const results = entryDom("#search-results");
  if (results.length !== 1) return htmlProofTrace(plan, "TALENTBREW_ENTRY_CONTAINER");
  const ajaxRaw = results.first().attr("data-ajax-url");
  if (!ajaxRaw) return htmlProofTrace(plan, "TALENTBREW_AJAX_URL");
  const ajaxUrl = new URL(ajaxRaw, rawEntryUrl);
  if (ajaxUrl.protocol !== "https:" || ajaxUrl.origin !== new URL(rawEntryUrl).origin || ajaxUrl.hash) return htmlProofTrace(plan, "TALENTBREW_AJAX_BOUNDARY");
  const partitions = talentbrewPartitions(entryDom, scope);
  if (!partitions) return htmlProofTrace(plan, "TALENTBREW_PARTITIONS");
  const staticFilters = talentbrewStaticFilters(entryDom);
  if (!staticFilters) return htmlProofTrace(plan, "TALENTBREW_STATIC_FILTERS");

  const seen = new Set<string>();
  let globalIndex = 0;
  for (const partition of partitions) {
    const channelPages = evidence.pages.filter((page) => page.channelId === partition.channelId);
    if (channelPages.length === 0) return htmlProofTrace(plan, `TALENTBREW_CHANNEL_MISSING:${partition.channelId}`);
    let declaredPages: number | undefined;
    let declaredTotal: number | undefined;
    let pageSize: number | undefined;
    let returnedRows = 0;
    for (let channelIndex = 0; channelIndex < channelPages.length; channelIndex += 1) {
      const page = channelPages[channelIndex]!;
      const pageNumber = channelIndex + 1;
      if (page !== evidence.pages[globalIndex] || page.sequence !== globalIndex) return htmlProofTrace(plan, `TALENTBREW_SEQUENCE:${partition.channelId}:${pageNumber}`);
      const artifact = artifactForPage(page, artifacts);
      if (!artifact || artifact.channelId !== partition.channelId) return htmlProofTrace(plan, `TALENTBREW_ARTIFACT:${partition.channelId}:${pageNumber}`);
      const rawExpectedUrl = talentbrewRequestUrl(entryDom, ajaxUrl, staticFilters, partition, pageNumber);
      const expectedUrl = evidenceUrl(rawExpectedUrl);
      const expectedPageSize = queryPositiveInt(rawExpectedUrl, "RecordsPerPage") ?? null;
      if (!sameUrl(artifact, expectedUrl) || page.requestedPage !== pageNumber ||
        page.requestedPageSize !== expectedPageSize || page.returnedPage !== pageNumber ||
        !matchesRequestContract(artifact, plan.table.rowSelector, "talentbrew-page", globalIndex + 1, "GET", expectedUrl, null, {
          sequence: globalIndex + 1, channelId: partition.channelId,
          requestedPage: null, requestedPageSize: null
        }) || !validChannelTermination(page, channelIndex, channelPages.length)) return htmlProofTrace(plan, `TALENTBREW_PAGE_CONTRACT:${partition.channelId}:${pageNumber}`);
      const html = strictTalentbrewResults(artifact.body, plan.table.rowSelector);
      const pageDom = load(html);
      const returned = pageDom("#search-results");
      if (returned.length !== 1) return htmlProofTrace(plan, `TALENTBREW_RESULTS:${partition.channelId}:${pageNumber}`);
      const current = strictInt(returned.first().attr("data-current-page"), true);
      const totalPages = strictInt(returned.first().attr("data-total-pages"), true);
      const total = strictInt(returned.first().attr("data-total-job-results"), false);
      const size = strictInt(returned.first().attr("data-records-per-page"), true);
      if (current !== pageNumber || totalPages === undefined || total === undefined || size === undefined ||
        page.declaredPages !== totalPages || page.declaredTotal !== total || page.returnedPageSize !== size ||
        Math.max(1, Math.ceil(total / size)) !== totalPages) return htmlProofTrace(plan, `TALENTBREW_DECLARED_TOTAL:${partition.channelId}:${pageNumber}`);
      declaredPages ??= totalPages;
      declaredTotal ??= total;
      pageSize ??= size;
      if (declaredPages !== totalPages || declaredTotal !== total || pageSize !== size ||
        !replayRows(html, plan.table, page, seen)) return htmlProofTrace(plan, `TALENTBREW_REPLAY:${partition.channelId}:${pageNumber}`);
      returnedRows += page.rawJobIds.length;
      globalIndex += 1;
    }
    if (declaredPages !== channelPages.length || declaredTotal !== returnedRows) return htmlProofTrace(plan, `TALENTBREW_CHANNEL_TOTAL:${partition.channelId}`);
  }
  return globalIndex === evidence.pages.length && evidence.fetchCounts.rawCount === seen.size ||
    htmlProofTrace(plan, "TALENTBREW_FINAL_COUNTS");
}

function validateUnpartitionedTalentbrewOfficialTotal(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[]
): boolean {
  const pagination = plan.table.pagination;
  const declaration = evidence.declaredCompleteness!;
  if (!pagination || pagination.ajaxMode !== "talentbrew" || pagination.talentbrewScope !== undefined ||
    declaration.kind !== "OFFICIAL_TOTAL_COUNT" || declaration.value !== evidence.fetchCounts.rawCount ||
    artifacts.length !== evidence.pages.length + 1 || evidence.pages.some((page) => page.channelId !== undefined)) {
    return htmlProofTrace(plan, "TALENTBREW_TOTAL_ENVELOPE");
  }

  const entry = artifacts[0]!;
  const rawEntryUrl = configuredUrl(plan.source.officialEntryUrl);
  const entryUrl = evidenceUrl(rawEntryUrl);
  if (entry.logicalKey !== "official-html-page-0000" || entry.kind !== "OFFICIAL_COMPANY_PAGE" ||
    entry.channelId !== undefined || !sameUrl(entry, entryUrl) ||
    !matchesRequestContract(entry, "#search-results[data-ajax-url]", "entry", 0, "GET", entryUrl, null, {
      sequence: 0, channelId: null, requestedPage: queryPositiveInt(entryUrl, "CurrentPage") ?? null,
      requestedPageSize: queryPositiveInt(entryUrl, "RecordsPerPage") ?? null
    })) return htmlProofTrace(plan, "TALENTBREW_TOTAL_ENTRY_CONTRACT");

  const entryDom = load(entry.body);
  const results = entryDom("#search-results");
  const ajaxRaw = results.length === 1 ? results.first().attr("data-ajax-url") : undefined;
  if (!ajaxRaw) return htmlProofTrace(plan, "TALENTBREW_TOTAL_AJAX_URL");
  const ajaxUrl = new URL(ajaxRaw, rawEntryUrl);
  if (ajaxUrl.protocol !== "https:" || ajaxUrl.origin !== new URL(rawEntryUrl).origin || ajaxUrl.hash) {
    return htmlProofTrace(plan, "TALENTBREW_TOTAL_AJAX_BOUNDARY");
  }
  const staticFilters = talentbrewStaticFilters(entryDom);
  if (!staticFilters) return htmlProofTrace(plan, "TALENTBREW_TOTAL_STATIC_FILTERS");

  const seen = new Set<string>();
  let declaredTotal: number | undefined;
  let declaredPages: number | undefined;
  let pageSize: number | undefined;
  let rawRows = 0;
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const page = evidence.pages[index]!;
    const pageNumber = index + 1;
    const artifact = artifactForPage(page, artifacts);
    const rawExpectedUrl = talentbrewRequestUrl(entryDom, ajaxUrl, staticFilters, undefined, pageNumber);
    const expectedUrl = evidenceUrl(rawExpectedUrl);
    const expectedPageSize = queryPositiveInt(rawExpectedUrl, "RecordsPerPage") ?? null;
    if (!artifact || artifact.channelId !== undefined || !sameUrl(artifact, expectedUrl) ||
      page.sequence !== index || page.requestedPage !== pageNumber || page.returnedPage !== pageNumber ||
      page.requestedPageSize !== expectedPageSize ||
      !matchesRequestContract(artifact, plan.table.rowSelector, "talentbrew-page", index + 1, "GET", expectedUrl, null, {
        sequence: index + 1, channelId: null, requestedPage: null, requestedPageSize: null
      }) || !validTermination(page, index, evidence.pages.length)) {
      return htmlProofTrace(plan, `TALENTBREW_TOTAL_PAGE_CONTRACT:${pageNumber}`);
    }
    const html = strictTalentbrewResults(artifact.body, plan.table.rowSelector);
    const returned = load(html)("#search-results");
    const current = strictInt(returned.first().attr("data-current-page"), true);
    const totalPages = strictInt(returned.first().attr("data-total-pages"), true);
    const total = strictInt(returned.first().attr("data-total-job-results"), false);
    const size = strictInt(returned.first().attr("data-records-per-page"), true);
    if (returned.length !== 1 || current !== pageNumber || totalPages === undefined || total === undefined ||
      size === undefined || page.declaredPages !== totalPages || page.declaredTotal !== total ||
      page.returnedPageSize !== size || page.declaredCount !== size ||
      Math.max(1, Math.ceil(total / size)) !== totalPages) {
      return htmlProofTrace(plan, `TALENTBREW_TOTAL_DECLARATION:${pageNumber}`);
    }
    declaredTotal ??= total;
    declaredPages ??= totalPages;
    pageSize ??= size;
    if (declaredTotal !== total || declaredPages !== totalPages || pageSize !== size ||
      !replayRows(html, plan.table, page, seen)) {
      return htmlProofTrace(plan, `TALENTBREW_TOTAL_REPLAY:${pageNumber}`);
    }
    rawRows += page.rawJobIds.length;
  }
  const firstPageArtifact = artifactForPage(evidence.pages[0]!, artifacts);
  return declaredPages === evidence.pages.length && declaredTotal === declaration.value &&
    rawRows === declaration.value && seen.size === declaration.value &&
    firstPageArtifact !== undefined && declaration.artifactLogicalKey === firstPageArtifact.logicalKey &&
    declaration.extractorLocator === firstPageArtifact.extractorLocator ||
    htmlProofTrace(plan, "TALENTBREW_TOTAL_FINAL_COUNTS");
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
  const pageSize = tupuDeclaredPageSize(first);
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
        }) || !replayRows(artifact.body, plan.table, page, seen)) return false;
  }
  return evidence.fetchCounts.rawCount === seen.size;
}

function validateStaticPublicList(
  plan: HtmlPlan,
  evidence: PersistentSourceFetchEvidence,
  artifacts: readonly ExactArtifact[],quarantines:readonly JobQuarantine[]=[]
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
  const terminal = declaration.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value === 0
    ? evidence.pages[0]!.termination === "EMPTY_PAGE" &&
      evidence.pages[0]!.nextPageSignalAfter == null && evidence.pages[0]!.anomalyCodes.length === 0
    : validTermination(evidence.pages[0]!, 0, 1);
  if (container.length !== 1 || $(config.nextControlSelector).length !== 0 || !sameUrl(artifact, entryUrl) ||
    !matchesRequestContract(artifact, plan.table.rowSelector, "entry", 0, "GET", entryUrl, null, { sequence: 0 }) ||
    declaration.extractorLocator !== artifact.extractorLocator ||
    !terminal) return false;
  const rows = $(plan.table.rowSelector).toArray();
  if (rows.some((row) => $(row).closest(config.containerSelector).get(0) !== container.get(0) ||
    (config.excludedPartitionSelectors ?? []).some((selector) => $(row).closest(selector).length > 0))) return false;
  const seen = new Set<string>();
  const genericValid = replayRows(artifact.body, plan.table, evidence.pages[0]!, seen) &&
    evidence.fetchCounts.rawCount === seen.size &&
    ((declaration.kind === "COMPLETE_PAGE_TRAVERSAL" && declaration.value === 1) ||
      (declaration.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value === 0 && rows.length === 0));
  if (!genericValid) return false;
  if (declaration.kind === "OFFICIAL_TOTAL_COUNT" && declaration.value === 0) {
    const empty = config.explicitEmptyState;
    const markers = empty ? $(empty.selector) : undefined;
    const normalized = markers?.first().text().replace(/\s+/gu, " ").trim() ?? "";
    if (!empty || markers?.length !== 1 || !normalized || !new RegExp(empty.pattern, "u").test(normalized) ||
      (markers.get(0) !== container.get(0) && !$.contains(container.get(0)!, markers.get(0)!))) return false;
  }
  const policy = plan.table.completenessProof;
  if (policy?.kind !== "STATIC_PUBLIC_LIST") return false;
  if (policy.sourcePolicy === "APELOA_SOCIAL_TABS_V1") {
    return validateApeloaStaticPlan(plan, $, rows);
  }
  if (policy.sourcePolicy === "ASTELLAS_CHINA_PDF_ACCORDION_V1") {
    return validateAstellasStaticPlan(plan, $, rows,quarantines);
  }
  // Retired zero-only policy names intentionally fall through to rejection.
  // Do not downgrade them to the generic static-list policy.
  if (policy.sourcePolicy === "OTSUKA_CHINA_JOIN_LIST_V1") {
    return validateOtsukaStaticPlan(plan, $, rows);
  }
  if (policy.sourcePolicy === "GRAND_PHARMA_SOCIAL_ONLY_V1") {
    return validateGrandPharmaStaticPlan(plan, $, rows);
  }
  if (policy.sourcePolicy === "HUAHAI_SOCIAL_TABLE_V1") {
    return validateHuahaiStaticPlan(plan, $, rows);
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
  rows: readonly AnyNode[],quarantines:readonly JobQuarantine[]=[]
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
  for (const [index,row] of rows.entries()) {
    if(quarantines.some(q=>q.pageSequence===0&&q.recordIndex===index))continue;
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

function validateOtsukaStaticPlan(
  plan: HtmlPlan,
  $: ReturnType<typeof load>,
  rows: readonly AnyNode[]
): boolean {
  const config = plan.table.staticPublicList;
  if (!config) return false;
  return exactStaticSourceBinding(plan, {
    companyId: "company-otsuka-china",
    sourceId: "source-otsuka-china-social-2",
    entryUrl: "https://www.otsuka.com.cn/join-us/index.html",
    rowSelector: ".join-list > .join-item",
    containerSelector: ".join-list",
    nextControlSelector: ".join-list .pagination, .join-list a[rel='next'], .join-list [data-page]",
    sourceJobIdPartSelectors: [".table-td .career-title", ".table-td .col2"],
    titleSelector: ".table-td .career-title",
    locationSelector: ".table-td .col2"
  }) && config.excludedPartitionSelectors === undefined && rows.length > 0 &&
    $(config.containerSelector).length === 1 &&
    $(config.containerSelector).children(".join-item").length === rows.length &&
    rows.every((row) => Boolean(normalizedText($(row).find(".table-td .career-title").text())) &&
      Boolean(normalizedText($(row).find(".table-td .col2").text())));
}

function validateGrandPharmaStaticPlan(
  plan: HtmlPlan,
  $: ReturnType<typeof load>,
  rows: readonly AnyNode[]
): boolean {
  const config = plan.table.staticPublicList;
  const allCards = $(".job-list > .job-card");
  const campusCards = $(".job-list > .job-card:has(a[href='schooldetail.html'])");
  return exactStaticSourceBinding(plan, {
    companyId: "company-grand-pharma",
    sourceId: "source-grand-pharma-social",
    entryUrl: "https://job.grandpharma.cn/",
    rowSelector: ".job-card:has(a[href='#login'])",
    containerSelector: ".job-list",
    nextControlSelector: ".job-list .pagination, .job-list a[rel='next'], .job-list [data-page]",
    excludedPartitionSelectors: [".job-card:has(a[href='schooldetail.html'])"],
    sourceJobIdPartSelectors: [".job-title", ".job-meta span:nth-child(1)"],
    titleSelector: ".job-title",
    locationSelector: ".job-meta span:nth-child(1)"
  }) && config !== undefined && rows.length > 0 &&
    allCards.length === rows.length + campusCards.length &&
    allCards.toArray().every((card) => {
      const social = $(card).find("a[href='#login']").length === 1;
      const campus = $(card).find("a[href='schooldetail.html']").length === 1;
      return social !== campus;
    }) && rows.every((row) => Boolean(normalizedText($(row).find(".job-title").text())) &&
      Boolean(normalizedText($(row).find(".job-meta span:nth-child(1)").text())));
}

function validateHuahaiStaticPlan(
  plan: HtmlPlan,
  $: ReturnType<typeof load>,
  rows: readonly AnyNode[]
): boolean {
  const config = plan.table.staticPublicList;
  if (!config) return false;
  return exactStaticSourceBinding(plan, {
    companyId: "company-huahai",
    sourceId: "source-huahai-social",
    entryUrl: "https://www.huahaipharm.com/zpgw.html",
    rowSelector: "tr.tr_title",
    containerSelector: "table:has(tr.tr_title)",
    nextControlSelector: "table:has(tr.tr_title) .pagination, table:has(tr.tr_title) a[rel='next'], table:has(tr.tr_title) [data-page]",
    sourceJobIdPartSelectors: ["td:nth-child(1)", "td:nth-child(2)", "td:nth-child(5)"],
    titleSelector: "td:nth-child(1)",
    locationSelector: "td:nth-child(2)"
  }) && config.excludedPartitionSelectors === undefined && rows.length > 0 &&
    $(config.containerSelector).length === 1 && rows.every((row) => {
      const cells = $(row).children("td");
      const detail = $(row).next("tr.tr_content");
      return cells.length === 5 && Boolean(normalizedText(cells.eq(0).text())) &&
        Boolean(normalizedText(cells.eq(1).text())) && Boolean(normalizedText(cells.eq(4).text())) &&
        detail.length === 1 && detail.find(".apply a[href]").length === 1;
    });
}

interface ExactStaticSourceBinding {
  companyId: string;
  sourceId: string;
  entryUrl: string;
  rowSelector: string;
  containerSelector: string;
  nextControlSelector: string;
  excludedPartitionSelectors?: readonly string[];
  sourceJobIdPartSelectors: readonly string[];
  titleSelector: string;
  locationSelector: string;
}

function exactStaticSourceBinding(plan: HtmlPlan, expected: ExactStaticSourceBinding): boolean {
  const config = plan.table.staticPublicList;
  return plan.executionAuthority === "STAGED" && plan.company.id === expected.companyId &&
    plan.source.id === expected.sourceId && plan.source.companyId === expected.companyId &&
    plan.source.kind === "SOCIAL" && plan.source.atsKind === "OFFICIAL_HTML" &&
    plan.source.status === "VERIFIED_SCRAPABLE" && plan.source.officialEntryUrl === expected.entryUrl &&
    plan.source.officialChainEvidenceUrl === expected.entryUrl && plan.table.rowSelector === expected.rowSelector &&
    plan.table.pagination === undefined && config?.containerSelector === expected.containerSelector &&
    config.nextControlSelector === expected.nextControlSelector &&
    JSON.stringify(config.excludedPartitionSelectors) === JSON.stringify(expected.excludedPartitionSelectors) &&
    JSON.stringify(plan.table.fields.sourceJobIdParts) === JSON.stringify(
      expected.sourceJobIdPartSelectors.map((selector) => ({ selector }))) &&
    plan.table.fields.sourceJobId === undefined &&
    JSON.stringify(plan.table.fields.officialTitle) === JSON.stringify({ selector: expected.titleSelector }) &&
    JSON.stringify(plan.table.fields.officialUrl) === JSON.stringify({ value: expected.entryUrl }) &&
    JSON.stringify(plan.table.fields.locationRaw) === JSON.stringify({ selector: expected.locationSelector });
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
  table: HtmlTableConfig,
  page: SourceFetchPageTrace,
  globalSeen: Set<string>
): boolean {
  const $ = load(html);
  const ids = selectHtmlTableRows($, table).map((row) => {
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

function officialExpectedJobCount(
  html: string,
  pagination: NonNullable<HtmlTableConfig["pagination"]>
): number | undefined {
  if (matchesStrictPaginationExplicitEmptyState(html, pagination)) return 0;
  if (!pagination.expectedJobCountSelector) return undefined;
  const $ = load(html);
  const selected = $(pagination.expectedJobCountSelector).first();
  if (selected.length !== 1) return undefined;
  const raw = pagination.expectedJobCountAttribute
    ? selected.attr(pagination.expectedJobCountAttribute)
    : selected.text();
  if (raw === undefined) return undefined;
  const captured = pagination.expectedJobCountPattern
    ? new RegExp(pagination.expectedJobCountPattern, "u").exec(raw)?.[1]
    : raw;
  return strictInt(captured?.trim(), false);
}

function matchesStrictPaginationExplicitEmptyState(
  html: string,
  pagination: NonNullable<HtmlTableConfig["pagination"]>
): boolean {
  const empty = pagination.explicitEmptyState;
  if (!empty) return false;
  const $ = load(html);
  const markers = $(empty.selector);
  if (markers.length !== 1) return false;
  const text = normalizedText(markers.first().text());
  return text !== undefined && new RegExp(empty.pattern, "u").test(text);
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
  const sourceTotal = strictInt(results.attr("data-total-job-results"), false);
  const activeCount = activeMatches.length === 1
    ? strictInt($(activeMatches[0]!).attr("data-count"), false)
    : undefined;
  const partitionDimension = scope.allowedPartitions[0];
  const configuredFacets = [...scope.allowedPartitions, ...(scope.excludedPartitions ?? [])];
  if (activeMatches.length !== 1 || sourceTotal === undefined || activeCount !== sourceTotal ||
    results.attr("data-facet-term") !== active.id ||
    strictInt(results.attr("data-facet-type"), false) !== active.facetType ||
    !partitionDimension || configuredFacets.some((partition) =>
      partition.facetType !== partitionDimension.facetType || partition.fieldName !== partitionDimension.fieldName) ||
    new Set(scope.allowedPartitions.map((partition) => partition.channelId)).size !== scope.allowedPartitions.length) return undefined;
  const visiblePartitionFacets = $("#search-filters [data-enabled='true'] .filter-checkbox:not(:checked)")
    .filter((_index, element) => {
      const item = $(element);
      return strictInt(item.attr("data-facet-type"), false) === partitionDimension.facetType &&
        item.attr("data-field-name") === partitionDimension.fieldName;
    });
  if (visiblePartitionFacets.length !== configuredFacets.length) return undefined;
  const declaredCounts = new Map<string, number>();
  for (const configured of configuredFacets) {
    const matches = $("#search-filters [data-enabled='true'] .filter-checkbox:not(:checked)").filter((_index, element) => {
      const item = $(element);
      return item.attr("data-id") === configured.id &&
        strictInt(item.attr("data-facet-type"), false) === configured.facetType &&
        item.attr("data-field-name") === configured.fieldName && item.attr("data-display") === configured.descriptor;
    });
    const count = matches.length === 1 ? strictInt($(matches[0]!).attr("data-count"), false) : undefined;
    if (count === undefined) return undefined;
    declaredCounts.set(JSON.stringify([configured.id, configured.facetType, configured.fieldName, configured.descriptor]), count);
  }
  const configuredFacetKeys = new Set(configuredFacets.map((partition) =>
    JSON.stringify([partition.id, partition.facetType, partition.fieldName, partition.descriptor])));
  const visibleFacetKeys = new Set(visiblePartitionFacets.toArray().map((element) => {
    const item = $(element);
    return JSON.stringify([
      item.attr("data-id") ?? "",
      strictInt(item.attr("data-facet-type"), false),
      item.attr("data-field-name") ?? "",
      item.attr("data-display") ?? ""
    ]);
  }));
  const partitions = scope.allowedPartitions.flatMap((partition) => {
    const declaredCount = declaredCounts.get(
      JSON.stringify([partition.id, partition.facetType, partition.fieldName, partition.descriptor])
    );
    return declaredCount === undefined ? [] : [{ ...partition, declaredCount }];
  });
  return configuredFacetKeys.size === configuredFacets.length && visibleFacetKeys.size === configuredFacets.length &&
    [...configuredFacetKeys].every((key) => visibleFacetKeys.has(key)) &&
    partitions.length === scope.allowedPartitions.length &&
    [...declaredCounts.values()].reduce((sum, count) => sum + count, 0) === sourceTotal
    ? partitions
    : undefined;
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
  partition: TalentbrewPartition | undefined,
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
    FacetFilters: [...staticFilters, ...(partition ? [{
      ID: partition.id, FacetType: partition.facetType, Count: partition.declaredCount,
      Display: partition.descriptor, IsApplied: true, FieldName: partition.fieldName
    }] : [])],
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

function strictTalentbrewResults(body: string, rowSelector: string): string {
  assertNoDuplicateJsonKeys(body);
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid response");
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["filters", "hasContent", "hasJobs", "results"]) ||
    typeof record.results !== "string" || !record.results.trim() ||
    typeof record.filters !== "string" || !record.filters.trim() ||
    typeof record.hasJobs !== "boolean" || typeof record.hasContent !== "boolean") throw new Error("invalid response");
  const filterDom = load(record.filters);
  const filterRoots = filterDom("body").children();
  const filterRoot = filterRoots.first();
  if (filterRoots.length !== 1 || !filterRoot.is("section, div") || filterRoot.attr("id") !== "search-filters" ||
    filterRoot.find(".filter-checkbox").length === 0 ||
    filterRoot.find("script, iframe, form, object, embed").length > 0) throw new Error("invalid response");
  const resultDom = load(record.results);
  if (record.hasJobs !== (resultDom(rowSelector).length > 0)) throw new Error("invalid response");
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

function tupuDeclaredPageSize($: ReturnType<typeof load>): number | undefined {
  const onclick = $("#pageTurnUl li[onclick]").toArray()
    .map((element) => $(element).attr("onclick") ?? "")
    .map(tupuPageSize).find((value) => value !== undefined);
  if (onclick !== undefined) return onclick;
  const controls = $("#pageTurnUl li[data-action], #pageTurnUl li[data-pagenum], #pageTurnUl li[data-pagemax]")
    .toArray();
  if (controls.length === 0) return undefined;
  const sizes = new Set<number>();
  for (const element of controls) {
    const node = $(element);
    const pageNumber = strictInt(node.attr("data-pagenum") ?? undefined, true);
    const pageSize = strictInt(node.attr("data-pagemax") ?? undefined, true);
    if (node.attr("data-action") !== "pageTurn" || pageNumber === undefined || pageSize === undefined) {
      return undefined;
    }
    sizes.add(pageSize);
  }
  return sizes.size === 1 ? [...sizes][0] : undefined;
}

function tupuBody(offset: number, pageSize: number, recruitmentType: string | null): string {
  const body = new URLSearchParams({ offset: String(offset), max: String(pageSize) });
  if (recruitmentType) body.set("recruitmentType", recruitmentType);
  return body.toString();
}
