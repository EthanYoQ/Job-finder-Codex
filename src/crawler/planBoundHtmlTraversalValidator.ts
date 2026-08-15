import { createHash } from "node:crypto";
import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";
import { companyRecruitmentExecutionConfigsBySourceId } from "./companyRecruitmentProfiles";
import { tagBGradeIndependentTraversalFailure } from "./independentTraversalDiagnostics";
import { officialBrowserTimeoutMs } from "./officialHttpRuntimeLimits";

export const PLAN_BOUND_HTML_TRAVERSAL_POLICIES = Object.freeze({
  "source-novartis-social": {
    companyId: "company-novartis",
    entryUrl: "https://prod1.novartis.com/careers/career-search/tag/LOC_CN",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_OFFICIAL_TOTAL_PAGES",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-novartis-social-browser-traversal-validation",
    readySelector: "table.views-table",
    rowSelector: "table.views-table tbody tr",
    nextSelector: ".pager__item--next a[href], .pagination a[rel='next'][href]",
    key: {
      kind: "OFFICIAL_URL",
      selector: "td.views-field-field-job-title a",
      origin: "https://prod1.novartis.com",
      pathPrefix: "/careers/career-search/job/details/",
      dedupe: "OFFICIAL_URL"
    },
    allowMainPageOverlapAcrossPages: true,
    maxPages: 20
  },
  "source-astellas-china-social": {
    companyId: "company-astellas-china",
    entryUrl: "https://www.astellas.com/en/careers/china-recruitment",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_STATIC_PUBLIC_LIST",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-astellas-china-social-browser-traversal-validation",
    readySelector: ".cmp-accordion__button",
    revealSelector: ".cmp-accordion__button",
    expectedRevealControlCount: 3,
    blockingOverlay: {
      dismissSelector: "#onetrust-reject-all-handler",
      rootSelector: "#onetrust-consent-sdk"
    },
    rowSelector: "a[href$='.pdf'][href*='/global/zh/']",
    nextSelector: ".pagination a[rel='next'][href], a[rel='next'][href]",
    key: {
      kind: "OFFICIAL_URL",
      selector: ":scope",
      origin: "https://www.astellas.com",
      pathPrefix: "/content/dam/astellas-com/global/zh/",
      dedupe: "URL_SOURCE_JOB_ID",
      sourceJobIdPattern: "/([^/]+)\\.pdf$"
    },
    maxPages: 1
  },
  "source-otsuka-china-social-2": {
    companyId: "company-otsuka-china",
    entryUrl: "https://www.otsuka.com.cn/join-us/index.html",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_STATIC_PUBLIC_LIST",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-otsuka-china-social-2-browser-traversal-validation",
    readySelector: ".join-list",
    rowSelector: ".join-list > .join-item",
    nextSelector: ".join-list .pagination a[href], .join-list a[rel='next'][href], .join-list [data-page]",
    key: { kind: "SYNTHETIC_SOURCE_JOB_ID", partSelectors: [".table-td .career-title", ".table-td .col2"] },
    maxPages: 1
  },
  "source-grand-pharma-social": {
    companyId: "company-grand-pharma",
    entryUrl: "https://job.grandpharma.cn/",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_STATIC_PUBLIC_LIST",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-grand-pharma-social-browser-traversal-validation",
    readySelector: ".job-list",
    rowSelector: ".job-card:has(a[href='#login'])",
    nextSelector: ".job-list .pagination a[href], .job-list a[rel='next'][href], .job-list [data-page]",
    key: { kind: "SYNTHETIC_SOURCE_JOB_ID", partSelectors: [".job-title", ".job-meta span:nth-child(1)"] },
    maxPages: 1
  },
  "source-huahai-social": {
    companyId: "company-huahai",
    entryUrl: "https://www.huahaipharm.com/zpgw.html",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_STATIC_PUBLIC_LIST",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-huahai-social-browser-traversal-validation",
    readySelector: "table:has(tr.tr_title)",
    rowSelector: "tr.tr_title",
    nextSelector: "table:has(tr.tr_title) .pagination a[href], table:has(tr.tr_title) a[rel='next'][href], table:has(tr.tr_title) [data-page]",
    key: { kind: "SYNTHETIC_SOURCE_JOB_ID", partSelectors: ["td:nth-child(1)", "td:nth-child(2)", "td:nth-child(5)"] },
    maxPages: 1
  },
  "source-fosun-pharma-social": {
    companyId: "company-fosun-pharma",
    entryUrl: "https://fosunpharma.zhiye.com/social",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_OFFICIAL_TOTAL_PAGES",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-fosun-pharma-social-browser-traversal-validation",
    readySelector: "table tr:has(td:nth-child(1) a[href*='/socialxq?jobId='])",
    readyState: "attached",
    rowSelector: "table tr:has(td:nth-child(1) a[href*='/socialxq?jobId='])",
    nextSelector: ".page a.next:not(.disabled):has-text('下一页')[href]",
    pageCoordinate: { kind: "QUERY", firstPath: "/social", pagePath: "/social/", parameter: "PageIndex" },
    navigationWaitUntil: "commit",
    followNextHref: true,
    key: { kind: "OFFICIAL_URL", selector: "td:nth-child(1) a", origin: "https://fosunpharma.zhiye.com", pathPrefix: "/socialxq", dedupe: "OFFICIAL_URL", allowedSearchParam: "jobId", searchParamRequired: true },
    maxPages: 20
  },
  "source-kelun-social": {
    companyId: "company-kelun",
    entryUrl: "https://kelun.zhiye.com/social",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_OFFICIAL_TOTAL_PAGES",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-kelun-social-browser-traversal-validation",
    readySelector: ".jobsTable tr:not(.title)",
    rowSelector: ".jobsTable tr:not(.title)",
    nextSelector: "a.next:has-text('下一页')[href*='PageIndex=']",
    pageCoordinate: { kind: "QUERY", firstPath: "/social", pagePath: "/social/", parameter: "PageIndex" },
    navigationWaitUntil: "commit",
    followNextHref: true,
    key: { kind: "OFFICIAL_URL", selector: "td:nth-child(1) a", origin: "https://kelun.zhiye.com", pathPrefix: "/job_show/", dedupe: "OFFICIAL_URL", allowedSearchParam: "PageIndex" },
    maxPages: 20
  },
  "source-tongrentang-social": {
    companyId: "company-tongrentang",
    entryUrl: "https://www.tongrentang.com/newsList/54/1.html",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v1",
    mainRetrievalPath: "HTTP_HTML_OFFICIAL_TOTAL_PAGES",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-tongrentang-social-browser-traversal-validation",
    readySelector: "a[href*='/menu54/newsDetail/']:has-text('招聘')",
    rowSelector: "a[href*='/menu54/newsDetail/']:has-text('招聘')",
    nextSelector: ".page li.next > a[href]",
    pageCoordinate: { kind: "PATH_PAGE", prefix: "/newsList/54/", suffix: ".html" },
    key: { kind: "OFFICIAL_URL", selector: ":scope", origin: "https://www.tongrentang.com", pathPrefix: "/menu54/newsDetail/", dedupe: "URL_SOURCE_JOB_ID", sourceJobIdPattern: "/([^/]+)\\.html$" },
    maxPages: 10
  },
  "source-sanofi-china-social": {
    companyId: "company-sanofi-china",
    entryUrl: "https://jobs.sanofi.com/en/location/china-country-jobs/2649/1814991/2",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v2",
    mainRetrievalPath: "HTTP_HTML_CONFIGURED_CHANNEL_TRAVERSAL",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-sanofi-china-social-browser-traversal-validation",
    readySelector: "#search-results",
    rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
    nextSelector: "#search-results a.next:not(.disabled)",
    key: {
      kind: "OFFICIAL_URL",
      selector: "a[href*='/job/']",
      origin: "https://jobs.sanofi.com",
      pathPrefix: "/en/job/",
      dedupe: "URL_SOURCE_JOB_ID",
      sourceJobIdPattern: "/2649/([1-9][0-9]*)$"
    },
    talentbrewScope: true,
    maxPages: 25
  },
  "source-takeda-china-social": {
    companyId: "company-takeda-china",
    entryUrl: "https://jobs.takeda.com/location/china-jobs/1113/1814991/2",
    retrievalPath: "PLAYWRIGHT_RENDERED_HTML_NEXT_LINK_TRAVERSAL",
    validatorImplementationId: "plan-bound-html-playwright-traversal-v2",
    mainRetrievalPath: "HTTP_HTML_CONFIGURED_CHANNEL_TRAVERSAL",
    matchKeyKind: "JOB_DEDUPE_KEY",
    artifactLogicalKey: "source-takeda-china-social-browser-traversal-validation",
    readySelector: "#search-results",
    rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
    nextSelector: "#search-results a.next:not(.disabled)",
    key: {
      kind: "OFFICIAL_URL",
      selector: "a[href*='/job/']",
      origin: "https://jobs.takeda.com",
      pathPrefix: "/job/",
      dedupe: "URL_SOURCE_JOB_ID",
      sourceJobIdPattern: "/1113/([1-9][0-9]*)$"
    },
    talentbrewScope: true,
    maxPages: 30
  }
} as const);

export type PlanBoundHtmlTraversalSourceId = keyof typeof PLAN_BOUND_HTML_TRAVERSAL_POLICIES;

export const PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS = Object.freeze(
  Object.keys(PLAN_BOUND_HTML_TRAVERSAL_POLICIES) as PlanBoundHtmlTraversalSourceId[]
);

export const PLAN_BOUND_HTML_REQUIRED_CERTIFICATES = Object.freeze(
  Object.fromEntries(PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS.map((sourceId) => [
    sourceId,
    PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].companyId
  ])) as Readonly<Record<PlanBoundHtmlTraversalSourceId,
    typeof PLAN_BOUND_HTML_TRAVERSAL_POLICIES[PlanBoundHtmlTraversalSourceId]["companyId"]>>
);

export interface PlanBoundHtmlRenderedPartitionCapture {
  controlIndex: number;
  controlId: string;
  matchKeys: string[];
}

export interface PlanBoundHtmlRenderedPageCapture {
  pageNumber: number;
  declaredTotalPages: number;
  channelId?: string;
  declaredTotalJobs?: number;
  matchKeys: string[];
  rawMatchKeys: string[];
  nextControlPresent: boolean;
  partitions?: PlanBoundHtmlRenderedPartitionCapture[];
}

export function isPlanBoundHtmlTraversalSourceId(value: string): value is PlanBoundHtmlTraversalSourceId {
  return Object.prototype.hasOwnProperty.call(PLAN_BOUND_HTML_TRAVERSAL_POLICIES, value);
}

async function runBrowserStage<T>(input: {
  operation: () => T | Promise<T>;
  signal: AbortSignal | undefined;
  failureCode: "B_GRADE_BROWSER_NAVIGATION_FAILED" | "B_GRADE_BROWSER_READINESS_FAILED";
}): Promise<T> {
  try {
    const result = await input.operation();
    if (input.signal?.aborted) {
      throw tagBGradeIndependentTraversalFailure(
        input.signal.reason,
        "B_GRADE_VALIDATOR_ABORTED"
      );
    }
    return result;
  } catch (error) {
    if (input.signal?.aborted) {
      throw tagBGradeIndependentTraversalFailure(
        input.signal.reason,
        "B_GRADE_VALIDATOR_ABORTED"
      );
    }
    throw tagBGradeIndependentTraversalFailure(error, input.failureCode);
  }
}

export function assertPlanBoundHtmlValidationMatchKey(
  sourceId: PlanBoundHtmlTraversalSourceId,
  value: string
): void {
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
  const prefix = `${sourceId}:`;
  if (!value.startsWith(prefix)) throw new Error("Plan-bound HTML validation match key source mismatch");
  const payload = value.slice(prefix.length);
  if (policy.key.kind === "SYNTHETIC_SOURCE_JOB_ID") {
    if (!/^html:sha256:[0-9a-f]{64}$/u.test(payload)) {
      throw new Error("Plan-bound HTML validation synthetic match key is invalid");
    }
    return;
  }
  if (policy.key.dedupe === "URL_SOURCE_JOB_ID") {
    if (!payload || payload.includes("/") || payload.includes("\\") || payload.includes("\u0000")) {
      throw new Error("Plan-bound HTML validation source job ID is invalid");
    }
    return;
  }
  assertOfficialJobUrl(policy, payload);
}

export async function capturePlanBoundHtmlRenderedTraversal(input: {
  sourceId: PlanBoundHtmlTraversalSourceId;
  entryUrl: string;
  signal?: AbortSignal;
  launchBrowser?: () => Promise<Pick<import("playwright-core").Browser, "newPage" | "close">>;
}): Promise<{ observedAt: string; pages: PlanBoundHtmlRenderedPageCapture[] }> {
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.sourceId];
  const browserTimeoutMs = officialBrowserTimeoutMs();
  const navigationWaitUntil: "commit" | "domcontentloaded" =
    "navigationWaitUntil" in policy ? policy.navigationWaitUntil : "domcontentloaded";
  const readinessState: "attached" | "visible" =
    "readyState" in policy ? policy.readyState : "visible";
  if (input.entryUrl !== policy.entryUrl) throw new Error("Plan-bound HTML browser validator entry URL mismatch");
  if (input.signal?.aborted) throw input.signal.reason;
  const releaseBrowserPermit = await acquireBrowserSourcePermit(input.signal);
  try {
    const browser = await (input.launchBrowser
      ? input.launchBrowser()
      : launchProductionBrowser(browserTimeoutMs));
    let closePromise: Promise<void> | undefined;
    const closeBrowser = () => closePromise ??= browser.close();
    const abort = () => { void closeBrowser().catch(() => undefined); };
    if (input.signal?.aborted) {
      await closeBrowser();
      throw input.signal.reason;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    let operationFailed = false;
    try {
      if ("talentbrewScope" in policy) {
        return {
          observedAt: new Date().toISOString(),
          pages: await captureTalentbrewPartitions(
            browser,
            input.sourceId,
            input.entryUrl,
            browserTimeoutMs,
            input.signal
          )
        };
      }
      const page = await browser.newPage();
      await runBrowserStage({
        signal: input.signal,
        failureCode: "B_GRADE_BROWSER_NAVIGATION_FAILED",
        operation: async () => {
          const navigation = await page.goto(input.entryUrl, {
            waitUntil: navigationWaitUntil,
            timeout: browserTimeoutMs
          });
          assertNavigation(input.sourceId, navigation, input.entryUrl, 1);
        }
      });
      await runBrowserStage({
        signal: input.signal,
        failureCode: "B_GRADE_BROWSER_READINESS_FAILED",
        operation: () => page.locator(policy.readySelector).first()
          .waitFor({ state: readinessState, timeout: browserTimeoutMs })
      });
      let declaredPartitions: PlanBoundHtmlRenderedPartitionCapture[] | undefined;
      if ("revealSelector" in policy) {
        let partitionFailureCode: Parameters<typeof tagBGradeIndependentTraversalFailure>[1] =
          "B_GRADE_PARTITION_CONTROL_SET_FAILED";
        try {
          const reveal = page.locator(policy.revealSelector);
          const revealCount = await reveal.count();
          if (revealCount !== policy.expectedRevealControlCount) {
            throw new Error("Plan-bound HTML browser validator reveal-control set invalid");
          }
          await page.waitForFunction(({ selector, count }) => {
            const controls = [...document.querySelectorAll(selector)];
            return controls.length === count && controls.every((control) =>
              ["true", "false"].includes(control.getAttribute("aria-expanded") ?? ""));
          }, { selector: policy.revealSelector, count: policy.expectedRevealControlCount }, {
            timeout: browserTimeoutMs
          });
          partitionFailureCode = "B_GRADE_PARTITION_EXPANSION_FAILED";
          const dismissBlockingOverlay = async (): Promise<boolean> => {
            const overlayDismiss = page.locator(policy.blockingOverlay.dismissSelector);
            const overlayDismissCount = await overlayDismiss.count();
            if (overlayDismissCount > 1) {
              throw new Error("Plan-bound HTML browser validator found multiple overlay-dismiss controls");
            }
            if (overlayDismissCount !== 1 || !await overlayDismiss.isVisible()) return false;
            await overlayDismiss.click({ timeout: 10_000 });
            await page.locator(policy.blockingOverlay.rootSelector)
              .waitFor({ state: "hidden", timeout: 10_000 });
            return true;
          };
          await dismissBlockingOverlay();
          const controlIds = new Set<string>();
          declaredPartitions = [];
          for (let index = 0; index < revealCount; index += 1) {
            partitionFailureCode = "B_GRADE_PARTITION_DECLARATION_FAILED";
            const control = reveal.nth(index);
            const controls = await control.getAttribute("aria-controls");
            const panelPresent = controls
              ? await page.evaluate((id) => Boolean(document.getElementById(id)), controls)
              : false;
            if (!controls || !panelPresent) {
              throw new Error(`Plan-bound HTML browser validator declared partition is malformed: ` +
                `controls=${Boolean(controls)},panel=${panelPresent}`);
            }
            if (controlIds.has(controls)) {
              throw new Error("Plan-bound HTML browser validator reveal controls share a partition");
            }
            controlIds.add(controls);
            partitionFailureCode = "B_GRADE_PARTITION_EXPANSION_FAILED";
            const expansionState = await control.getAttribute("aria-expanded");
            if (expansionState === "false") {
              try {
                await control.click({ timeout: 10_000 });
              } catch (error) {
                if (input.signal?.aborted || !await dismissBlockingOverlay()) throw error;
                await control.click({ timeout: 10_000 });
              }
            } else if (expansionState !== "true") {
              throw new Error("Plan-bound HTML browser validator reveal-control expansion state invalid");
            }
            await page.waitForFunction((id) => {
              const panel = document.getElementById(id);
              const control = [...document.querySelectorAll("[aria-controls]")]
                .find((candidate) => candidate.getAttribute("aria-controls") === id);
              return control?.getAttribute("aria-expanded") === "true" &&
                panel !== null && panel.getAttribute("aria-hidden") !== "true";
            }, controls, { timeout: 10_000 });
            partitionFailureCode = "B_GRADE_PARTITION_URL_NORMALIZATION_FAILED";
            await normalizeRevealNavigation(page, policy.entryUrl, index);
            partitionFailureCode = "B_GRADE_PARTITION_ROW_EXTRACTION_FAILED";
            const partitionLocator = page.locator(`[id=${JSON.stringify(controls)}] ${policy.rowSelector}`);
            const partitionMatchKeys = await readMatchKeysFromLocator(partitionLocator, input.sourceId, policy);
            if (partitionMatchKeys.length < 1) {
              throw new Error("Plan-bound HTML browser validator declared partition is empty");
            }
            declaredPartitions.push({ controlIndex: index + 1, controlId: controls, matchKeys: partitionMatchKeys });
          }
          partitionFailureCode = "B_GRADE_PARTITION_COVERAGE_FAILED";
          const controlledRows = await page.locator(policy.revealSelector).evaluateAll((controls, rowSelector) => {
            const rows = controls.flatMap((control) => {
              const id = control.getAttribute("aria-controls");
              return id ? [...(document.getElementById(id)?.querySelectorAll(rowSelector) ?? [])] : [];
            });
            return { controlled: new Set(rows).size, global: document.querySelectorAll(rowSelector).length };
          }, policy.rowSelector);
          if (controlledRows.controlled !== controlledRows.global) {
            throw new Error("Plan-bound HTML browser validator rows escaped the declared partitions");
          }
        } catch (error) {
          if (input.signal?.aborted) {
            throw tagBGradeIndependentTraversalFailure(
              input.signal.reason,
              "B_GRADE_VALIDATOR_ABORTED"
            );
          }
          throw tagBGradeIndependentTraversalFailure(error, partitionFailureCode);
        }
      }
      const capturedPages: Array<Omit<PlanBoundHtmlRenderedPageCapture, "declaredTotalPages">> = [];
      const seenPageUrls = new Set<string>();
      const seenMatchKeys = new Set<string>();
      for (let pageNumber = 1; pageNumber <= policy.maxPages; pageNumber += 1) {
        if (input.signal?.aborted) throw input.signal.reason;
        const pageUrl = page.url();
        assertPageUrl(input.sourceId, pageUrl, pageNumber);
        if (seenPageUrls.has(pageUrl)) throw new Error("Plan-bound HTML browser validator repeated a page URL");
        seenPageUrls.add(pageUrl);
        const rawMatchKeys = await readMatchKeys(page, input.sourceId, policy);
        const matchKeys = rawMatchKeys.filter((key) => {
          if (seenMatchKeys.has(key)) return false;
          seenMatchKeys.add(key);
          return true;
        });
        if (matchKeys.length === 0) {
          throw new Error("Plan-bound HTML browser validator page added no new jobs");
        }
        const next = page.locator(policy.nextSelector);
        const activeNextControl = await findUniqueVisibleActiveNextControl(next, pageUrl);
        const nextControlPresent = activeNextControl !== undefined;
        capturedPages.push({
          pageNumber,
          matchKeys,
          rawMatchKeys,
          nextControlPresent,
          ...(declaredPartitions ? { partitions: declaredPartitions } : {})
        });
        if (!nextControlPresent) break;
        if (pageNumber === policy.maxPages) {
          throw new Error("Plan-bound HTML browser validator reached its maximum page limit");
        }
        if ("followNextHref" in policy && policy.followNextHref === true) {
          const nextHref = await activeNextControl.getAttribute("href");
          if (!nextHref?.trim()) throw new Error("Plan-bound HTML browser validator next-page href is missing");
          const targetUrl = new URL(nextHref, pageUrl).toString();
          assertPageUrl(input.sourceId, targetUrl, pageNumber + 1);
          await runBrowserStage({
            signal: input.signal,
            failureCode: "B_GRADE_BROWSER_NAVIGATION_FAILED",
            operation: async () => {
              const navigation = await page.goto(targetUrl, {
                waitUntil: navigationWaitUntil,
                timeout: browserTimeoutMs
              });
              assertNavigation(input.sourceId, navigation, targetUrl, pageNumber + 1);
            }
          });
        } else {
          const previousUrl = pageUrl;
          await runBrowserStage({
            signal: input.signal,
            failureCode: "B_GRADE_BROWSER_NAVIGATION_FAILED",
            operation: () => Promise.all([
              page.waitForURL((url) => url.toString() !== previousUrl, { timeout: browserTimeoutMs }),
              activeNextControl.click({ timeout: 10_000 })
            ])
          });
        }
        await runBrowserStage({
          signal: input.signal,
          failureCode: "B_GRADE_BROWSER_READINESS_FAILED",
          operation: () => page.locator(policy.readySelector).first()
            .waitFor({ state: readinessState, timeout: browserTimeoutMs })
        });
      }
      if (capturedPages.length === 0 || capturedPages.at(-1)?.nextControlPresent !== false) {
        throw new Error("Plan-bound HTML browser validator did not prove terminal pagination");
      }
      const totalPages = capturedPages.length;
      return {
        observedAt: new Date().toISOString(),
        pages: capturedPages.map((captured) => ({ ...captured, declaredTotalPages: totalPages }))
      };
    } catch (error) {
      operationFailed = true;
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", abort);
      try {
        await closeBrowser();
      } catch (closeError) {
        if (!operationFailed) throw closeError;
      }
    }
  } finally {
    releaseBrowserPermit();
  }
}

interface TalentbrewPartitionPolicy {
  channelId: string;
  id: string;
  facetType: number;
  fieldName: string;
  descriptor: string;
}

interface TalentbrewTraversalPolicy {
  requiredActiveFacet: { id: string; facetType: number; descriptor: string };
  allowedPartitions: readonly TalentbrewPartitionPolicy[];
  excludedPartitions: readonly Omit<TalentbrewPartitionPolicy, "channelId">[];
  totalPagesSelector: string;
  totalPagesAttribute: string;
  totalJobsSelector: string;
  totalJobsAttribute: string;
  sourceJobIdSelector: string;
  sourceJobIdAttribute: string;
}

async function captureTalentbrewPartitions(
  browser: Pick<import("playwright-core").Browser, "newPage">,
  sourceId: PlanBoundHtmlTraversalSourceId,
  entryUrl: string,
  browserTimeoutMs: number,
  signal?: AbortSignal
): Promise<PlanBoundHtmlRenderedPageCapture[]> {
  const registered = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
  if (!("talentbrewScope" in registered)) throw new Error("TalentBrew traversal policy is unavailable");
  const scope = configuredTalentbrewTraversalPolicy(sourceId);
  const pages: PlanBoundHtmlRenderedPageCapture[] = [];
  const seenMatchKeys = new Set<string>();
  for (let partitionIndex = 0; partitionIndex < scope.allowedPartitions.length; partitionIndex += 1) {
    const partition = scope.allowedPartitions[partitionIndex]!;
    const page = await browser.newPage();
    try {
      await runBrowserStage({
        signal,
        failureCode: "B_GRADE_BROWSER_NAVIGATION_FAILED",
        operation: async () => {
          const navigation = await page.goto(entryUrl, {
            waitUntil: "domcontentloaded",
            timeout: browserTimeoutMs
          });
          assertNavigation(sourceId, navigation, entryUrl, 1);
        }
      });
      await runBrowserStage({
        signal,
        failureCode: "B_GRADE_BROWSER_READINESS_FAILED",
        operation: async () => {
          await page.locator(registered.readySelector).first()
            .waitFor({ state: "visible", timeout: browserTimeoutMs });
          await page.waitForLoadState("load", { timeout: browserTimeoutMs });
        }
      });
      if (signal?.aborted) throw signal.reason;
      await assertFreshTalentbrewScope(page, scope, browserTimeoutMs);
      const filterSelector = talentbrewFacetSelector(partition);
      const filter = page.locator(filterSelector);
      if (await filter.count() !== 1 || await filter.isChecked()) {
        throw new Error("TalentBrew browser validator allowed partition control is invalid");
      }
      const declaredPartitionJobs = parseNonnegativeInteger(await filter.getAttribute("data-count"));
      if (declaredPartitionJobs === undefined) {
        throw new Error("TalentBrew browser validator partition count is invalid");
      }
      const ajaxEndpoint = await readTalentbrewAjaxEndpoint(page, entryUrl, scope);
      const [partitionResponseUrl] = await Promise.all([
        waitForTalentbrewResponse(page, ajaxEndpoint, partition, browserTimeoutMs),
        filter.evaluate((element) => (element as HTMLInputElement).click())
      ]);
      assertTalentbrewPartitionResponse(partitionResponseUrl, partition);
      try {
        await page.waitForFunction(({ selector, resultsSelector, currentAttribute, totalAttribute, expectedTotal }) => {
          const checkbox = document.querySelector(selector) as HTMLInputElement | null;
          const results = document.querySelector(resultsSelector);
          return checkbox !== null && results?.getAttribute(currentAttribute) === "1" &&
            results.getAttribute(totalAttribute) === expectedTotal;
        }, {
          selector: filterSelector,
          resultsSelector: scope.totalPagesSelector,
          currentAttribute: "data-current-page",
          totalAttribute: scope.totalJobsAttribute,
          expectedTotal: String(declaredPartitionJobs)
        }, { timeout: browserTimeoutMs });
      } catch (error) {
        if (signal?.aborted) {
          throw tagBGradeIndependentTraversalFailure(signal.reason, "B_GRADE_VALIDATOR_ABORTED");
        }
        const state = await page.evaluate(({ selector, resultsSelector, totalAttribute }) => {
          const checkbox = document.querySelector(selector) as HTMLInputElement | null;
          const results = document.querySelector(resultsSelector);
          return { checked: checkbox?.checked ?? null, current: results?.getAttribute("data-current-page") ?? null,
            total: results?.getAttribute(totalAttribute) ?? null };
        }, { selector: filterSelector, resultsSelector: scope.totalPagesSelector, totalAttribute: scope.totalJobsAttribute });
        throw tagBGradeIndependentTraversalFailure(
          new Error(`TalentBrew browser validator partition did not become active: ` +
            `checked=${state.checked},current=${state.current ?? "missing"},total=${state.total ?? "missing"}`),
          "B_GRADE_BROWSER_READINESS_FAILED"
        );
      }
      const declaration = await readTalentbrewDeclaration(page, scope);
      if (declaration.totalJobs !== declaredPartitionJobs || declaration.totalPages > registered.maxPages) {
        throw new Error("TalentBrew browser validator page declaration exceeds the registered limit");
      }
      let observedRows = 0;
      for (let pageNumber = 1; pageNumber <= declaration.totalPages; pageNumber += 1) {
        if (signal?.aborted) throw signal.reason;
        assertPageUrl(sourceId, page.url(), pageNumber);
        const current = await readTalentbrewDeclaration(page, scope);
        if (current.currentPage !== pageNumber || current.totalPages !== declaration.totalPages ||
            current.totalJobs !== declaration.totalJobs) {
          throw new Error("TalentBrew browser validator page declaration changed");
        }
        const rawMatchKeys = await readTalentbrewMatchKeys(page, sourceId, registered, scope);
        if ((rawMatchKeys.length < 1 && declaration.totalJobs !== 0) ||
            rawMatchKeys.some((key) => seenMatchKeys.has(key))) {
          throw new Error("TalentBrew browser validator contains an empty or overlapping partition page");
        }
        rawMatchKeys.forEach((key) => seenMatchKeys.add(key));
        observedRows += rawMatchKeys.length;
        const next = page.locator(registered.nextSelector);
        const activeNextCount = await next.count();
        const expectedNext = pageNumber < declaration.totalPages;
        if (activeNextCount !== (expectedNext ? 1 : 0)) {
          throw new Error("TalentBrew browser validator next-page control mismatch");
        }
        pages.push({
          channelId: partition.channelId,
          pageNumber,
          declaredTotalPages: declaration.totalPages,
          declaredTotalJobs: declaration.totalJobs,
          matchKeys: rawMatchKeys,
          rawMatchKeys,
          nextControlPresent: expectedNext
        });
        if (!expectedNext) continue;
        const previousFingerprint = await talentbrewPageFingerprint(page, registered.rowSelector, scope);
        const [nextResponseUrl] = await Promise.all([
          waitForTalentbrewResponse(page, ajaxEndpoint, partition, browserTimeoutMs),
          next.first().evaluate((element) => (element as HTMLElement).click())
        ]);
        assertTalentbrewPartitionResponse(nextResponseUrl, partition);
        await runBrowserStage({
          signal,
          failureCode: "B_GRADE_BROWSER_READINESS_FAILED",
          operation: async () => {
            await page.waitForFunction(({ resultsSelector, currentAttribute, expected, rowSelector, previous }) => {
              const results = document.querySelector(resultsSelector);
              const ids = [...document.querySelectorAll(rowSelector)].map((row) =>
                row.querySelector("button.js-save-job-btn")?.getAttribute("data-job-id") ?? "").sort();
              return results?.getAttribute(currentAttribute) === expected && JSON.stringify(ids) !== previous;
            }, {
              resultsSelector: scope.totalPagesSelector,
              currentAttribute: "data-current-page",
              expected: String(pageNumber + 1),
              rowSelector: registered.rowSelector,
              previous: previousFingerprint
            }, { timeout: browserTimeoutMs });
            await page.locator(registered.readySelector).first()
              .waitFor({ state: "visible", timeout: browserTimeoutMs });
          }
        });
      }
      if (observedRows !== declaration.totalJobs) {
        throw new Error("TalentBrew browser validator partition total does not reconcile");
      }
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return pages;
}

function configuredTalentbrewTraversalPolicy(sourceId: PlanBoundHtmlTraversalSourceId): TalentbrewTraversalPolicy {
  const registered = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
  const config = companyRecruitmentExecutionConfigsBySourceId[sourceId];
  const table = config?.adapterId === "html-table" ? config.table : undefined;
  const pagination = table?.pagination;
  const scope = pagination?.ajaxMode === "talentbrew" ? pagination.talentbrewScope : undefined;
  const sourceJobId = table?.fields.sourceJobId;
  const officialUrl = table?.fields.officialUrl;
  if (!("talentbrewScope" in registered) || !table || table.rowSelector !== registered.rowSelector ||
      !pagination || pagination.maxPages !== registered.maxPages ||
      pagination.totalPagesSelector !== "#search-results" || pagination.totalPagesAttribute !== "data-total-pages" ||
      pagination.expectedJobCountSelector !== "#search-results" ||
      pagination.expectedJobCountAttribute !== "data-total-job-results" || !scope ||
      sourceJobId?.selector !== "button.js-save-job-btn" || sourceJobId.attribute !== "data-job-id" ||
      !officialUrl || officialUrl.selector !== "a[href*='/job/']" || officialUrl.attribute !== "href" ||
      scope.requiredActiveFacet.id !== "1814991" || scope.requiredActiveFacet.facetType !== 2 ||
      scope.allowedPartitions.length < 1 ||
      new Set(scope.allowedPartitions.map(({ channelId }) => channelId)).size !== scope.allowedPartitions.length ||
      new Set(scope.allowedPartitions.map(({ id, facetType, fieldName }) => `${id}\u001f${facetType}\u001f${fieldName}`)).size !==
        scope.allowedPartitions.length ||
      scope.allowedPartitions.some(({ facetType, fieldName }) => facetType !== 5 || !fieldName.trim()) ||
      (scope.excludedPartitions ?? []).some(({ id, facetType, fieldName }) => facetType !== 5 || !id.trim() || !fieldName.trim())) {
    throw new Error("TalentBrew browser validator configuration contract mismatch");
  }
  const allowedIdentity = new Set(scope.allowedPartitions.map(({ id, facetType, fieldName }) =>
    `${id}\u001f${facetType}\u001f${fieldName}`));
  if ((scope.excludedPartitions ?? []).some(({ id, facetType, fieldName }) =>
    allowedIdentity.has(`${id}\u001f${facetType}\u001f${fieldName}`))) {
    throw new Error("TalentBrew browser validator partition policy overlaps");
  }
  return {
    requiredActiveFacet: scope.requiredActiveFacet,
    allowedPartitions: scope.allowedPartitions,
    excludedPartitions: scope.excludedPartitions ?? [],
    totalPagesSelector: pagination.totalPagesSelector,
    totalPagesAttribute: pagination.totalPagesAttribute,
    totalJobsSelector: pagination.expectedJobCountSelector,
    totalJobsAttribute: pagination.expectedJobCountAttribute,
    sourceJobIdSelector: sourceJobId.selector,
    sourceJobIdAttribute: sourceJobId.attribute
  };
}

async function assertFreshTalentbrewScope(
  page: import("playwright-core").Page,
  scope: TalentbrewTraversalPolicy,
  browserTimeoutMs: number
): Promise<void> {
  const results = page.locator(scope.totalPagesSelector);
  const [facetTerm, facetType, sourceTotalRaw] = await Promise.all([
    results.getAttribute("data-facet-term"),
    results.getAttribute("data-facet-type"),
    results.getAttribute(scope.totalJobsAttribute)
  ]);
  const sourceTotal = parseNonnegativeInteger(sourceTotalRaw);
  if (facetTerm !== scope.requiredActiveFacet.id || facetType !== String(scope.requiredActiveFacet.facetType) ||
      sourceTotal === undefined) {
    throw new Error("TalentBrew browser validator required China facet declaration changed");
  }
  const configured = [...scope.allowedPartitions, ...scope.excludedPartitions];
  for (const fieldName of new Set(configured.map((partition) => partition.fieldName))) {
    const dimension = page.locator(`input.filter-checkbox[data-facet-type="5"]` +
      `[data-field-name=${JSON.stringify(fieldName)}]`);
    await dimension.first().waitFor({ state: "attached", timeout: browserTimeoutMs });
    const actualIds = await dimension.evaluateAll((controls) => controls.map((control) =>
      control.getAttribute("data-id")?.trim() ?? "").sort());
    const expectedIds = configured.filter((partition) => partition.fieldName === fieldName)
      .map((partition) => partition.id).sort(compareUtf8);
    if (actualIds.some((id) => !id) || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
      throw new Error(`TalentBrew browser validator partition universe changed: ${fieldName}`);
    }
  }
  let partitionTotal = 0;
  for (const partition of configured) {
    const control = page.locator(talentbrewFacetSelector(partition));
    const count = parseNonnegativeInteger(await control.getAttribute("data-count"));
    if (await control.count() !== 1 || await control.isChecked() ||
        await control.getAttribute("data-display") !== partition.descriptor ||
        count === undefined) {
      throw new Error("TalentBrew browser validator partition control set is invalid");
    }
    partitionTotal += count;
  }
  if (partitionTotal !== sourceTotal) {
    throw new Error("TalentBrew browser validator partition totals do not cover the China facet");
  }
}

function talentbrewFacetSelector(partition: Omit<TalentbrewPartitionPolicy, "channelId">): string {
  return `input.filter-checkbox[data-id=${JSON.stringify(partition.id)}]` +
    `[data-facet-type=${JSON.stringify(String(partition.facetType))}]` +
    `[data-field-name=${JSON.stringify(partition.fieldName)}]`;
}

async function readTalentbrewDeclaration(
  page: import("playwright-core").Page,
  scope: TalentbrewTraversalPolicy
): Promise<{ currentPage: number; totalPages: number; totalJobs: number }> {
  const results = page.locator(scope.totalPagesSelector);
  if (scope.totalPagesSelector !== scope.totalJobsSelector || await results.count() !== 1) {
    throw new Error("TalentBrew browser validator result declaration is ambiguous");
  }
  const [currentRaw, pagesRaw, jobsRaw] = await Promise.all([
    results.getAttribute("data-current-page"),
    results.getAttribute(scope.totalPagesAttribute),
    results.getAttribute(scope.totalJobsAttribute)
  ]);
  const currentPage = parsePositiveInteger(currentRaw);
  const totalPages = parsePositiveInteger(pagesRaw);
  const totalJobs = parseNonnegativeInteger(jobsRaw);
  if (!currentPage || !totalPages || totalJobs === undefined || currentPage > totalPages) {
    throw new Error("TalentBrew browser validator result declaration is invalid");
  }
  return { currentPage, totalPages, totalJobs };
}

async function talentbrewPageFingerprint(
  page: import("playwright-core").Page,
  rowSelector: string,
  scope: TalentbrewTraversalPolicy
): Promise<string> {
  const ids = await page.locator(rowSelector).evaluateAll((rows, binding) => rows.map((row) =>
    row.querySelector(binding.selector)?.getAttribute(binding.attribute) ?? ""), {
    selector: scope.sourceJobIdSelector,
    attribute: scope.sourceJobIdAttribute
  });
  return JSON.stringify(ids.sort(compareUtf8));
}

async function readTalentbrewMatchKeys(
  page: import("playwright-core").Page,
  sourceId: PlanBoundHtmlTraversalSourceId,
  policy: typeof PLAN_BOUND_HTML_TRAVERSAL_POLICIES[PlanBoundHtmlTraversalSourceId],
  scope: TalentbrewTraversalPolicy
): Promise<string[]> {
  const locator = page.locator(policy.rowSelector);
  const matchKeys = await readMatchKeysFromLocator(locator, sourceId, policy);
  const declaredIds = await locator.evaluateAll((rows, binding) => rows.map((row) =>
    row.querySelector(binding.selector)?.getAttribute(binding.attribute)?.trim() ?? ""), {
    selector: scope.sourceJobIdSelector,
    attribute: scope.sourceJobIdAttribute
  });
  const expectedKeys = declaredIds.map((id) => id ? `${sourceId}:${id}` : "").sort(compareUtf8);
  if (expectedKeys.some((key) => !key.slice(sourceId.length + 1)) ||
      JSON.stringify(expectedKeys) !== JSON.stringify(matchKeys)) {
    throw new Error("TalentBrew browser validator row identity does not reconcile");
  }
  return matchKeys;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value || !/^[1-9][0-9]*$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseNonnegativeInteger(value: string | null): number | undefined {
  if (value === null || !/^(0|[1-9][0-9]*)$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function readTalentbrewAjaxEndpoint(
  page: import("playwright-core").Page,
  entryUrl: string,
  scope: TalentbrewTraversalPolicy
): Promise<URL> {
  const raw = await page.locator(scope.totalPagesSelector).getAttribute("data-ajax-url");
  if (!raw) throw new Error("TalentBrew browser validator AJAX endpoint is missing");
  const endpoint = new URL(raw, entryUrl);
  const entry = new URL(entryUrl);
  if (endpoint.protocol !== "https:" || endpoint.origin !== entry.origin || endpoint.username || endpoint.password ||
      endpoint.hash) {
    throw new Error("TalentBrew browser validator AJAX endpoint escaped the registered source");
  }
  return endpoint;
}

async function waitForTalentbrewResponse(
  page: import("playwright-core").Page,
  endpoint: URL,
  partition: TalentbrewPartitionPolicy,
  browserTimeoutMs: number
): Promise<string> {
  const response = await page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return candidate.request().method() === "GET" && url.origin === endpoint.origin &&
      url.pathname === endpoint.pathname && talentbrewResponseHasPartition(url, partition);
  }, { timeout: browserTimeoutMs });
  const failure = await response.finished();
  if (failure || response.status() < 200 || response.status() >= 400) {
    throw new Error("TalentBrew browser validator AJAX request failed");
  }
  return response.url();
}

function talentbrewResponseHasPartition(url: URL, partition: TalentbrewPartitionPolicy): boolean {
  const query = url.searchParams;
  const indexes = [...query.keys()].flatMap((key) => /^FacetFilters\[([0-9]+)\]\.ID$/u.exec(key)?.[1] ?? []);
  return indexes.some((index) => query.get(`FacetFilters[${index}].ID`) === partition.id &&
    query.get(`FacetFilters[${index}].FacetType`) === String(partition.facetType) &&
    query.get(`FacetFilters[${index}].FieldName`) === partition.fieldName &&
    query.get(`FacetFilters[${index}].Display`) === partition.descriptor &&
    query.get(`FacetFilters[${index}].IsApplied`)?.toLowerCase() === "true");
}

function assertTalentbrewPartitionResponse(responseUrl: string, partition: TalentbrewPartitionPolicy): void {
  const query = new URL(responseUrl).searchParams;
  const indexes = [...query.keys()].flatMap((key) => {
    const matched = /^FacetFilters\[([0-9]+)\]\.ID$/u.exec(key);
    return matched ? [matched[1]!] : [];
  });
  const applied = indexes.filter((index) => query.get(`FacetFilters[${index}].FieldName`) === partition.fieldName);
  if (applied.length !== 1) throw new Error("TalentBrew browser validator partition request is ambiguous");
  const index = applied[0]!;
  if (query.get(`FacetFilters[${index}].ID`) !== partition.id ||
      query.get(`FacetFilters[${index}].FacetType`) !== String(partition.facetType) ||
      query.get(`FacetFilters[${index}].Display`) !== partition.descriptor ||
      query.get(`FacetFilters[${index}].IsApplied`)?.toLowerCase() !== "true") {
    throw new Error(`TalentBrew browser validator partition request does not match the configured scope: ` +
      `${query.get(`FacetFilters[${index}].ID`) ?? "missing"}|` +
      `${query.get(`FacetFilters[${index}].FacetType`) ?? "missing"}|` +
      `${query.get(`FacetFilters[${index}].Display`) ?? "missing"}|` +
      `${query.get(`FacetFilters[${index}].IsApplied`) ?? "missing"};expected=` +
      `${partition.id}|${partition.facetType}|${partition.descriptor}`);
  }
}

async function normalizeRevealNavigation(
  page: import("playwright-core").Page,
  entryUrl: string,
  revealIndex: number
): Promise<void> {
  if (page.url() === entryUrl) return;
  const actual = new URL(page.url());
  const entry = new URL(entryUrl);
  if (actual.origin !== entry.origin || actual.pathname !== entry.pathname || actual.search !== entry.search ||
      !new RegExp(`^#section-accordion-[a-z0-9]+-${revealIndex}$`, "u").test(actual.hash)) {
    throw new Error("Plan-bound HTML browser validator reveal control changed the registered source URL");
  }
  await page.evaluate((target) => history.replaceState(null, "", target), entryUrl);
  if (page.url() !== entryUrl) {
    throw new Error("Plan-bound HTML browser validator could not normalize reveal-control navigation");
  }
}

async function launchProductionBrowser(
  browserTimeoutMs: number
): Promise<Pick<import("playwright-core").Browser, "newPage" | "close">> {
  const { chromium } = await import("playwright-core");
  const { FORMAL_CHROMIUM_ARGS, FORMAL_CHROMIUM_PATH } = await import("../readiness/formalBrowserPreflight");
  return chromium.launch({
    ...(process.platform === "linux"
      ? { executablePath: FORMAL_CHROMIUM_PATH, args: [...FORMAL_CHROMIUM_ARGS] }
      : { channel: "chrome" as const }),
    headless: true,
    timeout: browserTimeoutMs
  });
}

async function readMatchKeys(
  page: import("playwright-core").Page,
  sourceId: PlanBoundHtmlTraversalSourceId,
  policy: typeof PLAN_BOUND_HTML_TRAVERSAL_POLICIES[PlanBoundHtmlTraversalSourceId]
): Promise<string[]> {
  return readMatchKeysFromLocator(page.locator(policy.rowSelector), sourceId, policy);
}

async function readMatchKeysFromLocator(
  locator: import("playwright-core").Locator,
  sourceId: PlanBoundHtmlTraversalSourceId,
  policy: typeof PLAN_BOUND_HTML_TRAVERSAL_POLICIES[PlanBoundHtmlTraversalSourceId]
): Promise<string[]> {
  const rawRows = await locator.evaluateAll((rows, key) => rows.map((row) => {
    if (key.kind === "OFFICIAL_URL") {
      const target = key.selector === ":scope" ? row : row.querySelector(key.selector);
      return target instanceof HTMLAnchorElement ? target.href : "";
    }
    return key.partSelectors.map((selector) =>
      row.querySelector(selector)?.textContent?.replace(/\s+/gu, " ").trim() ?? "");
  }), policy.key);
  if (rawRows.some((row) => typeof row === "string" ? !row : row.some((part) => !part))) {
    throw new Error("Plan-bound HTML browser validator found an incomplete rendered row");
  }
  const matchKeys = rawRows.map((row) => {
    if (typeof row === "string") {
      if (policy.key.kind !== "OFFICIAL_URL") {
        throw new Error("Plan-bound HTML browser validator key policy mismatch");
      }
      assertOfficialJobUrl(policy, row);
      if (policy.key.dedupe === "OFFICIAL_URL") return `${sourceId}:${row}`;
      const matched = new RegExp(policy.key.sourceJobIdPattern, "u").exec(new URL(row).pathname)?.[1];
      if (!matched) throw new Error("Plan-bound HTML browser validator URL source job ID is missing");
      return `${sourceId}:${matched}`;
    }
    return `${sourceId}:html:sha256:${createHash("sha256")
      .update(row.join("\u001f"), "utf8").digest("hex")}`;
  });
  if (new Set(matchKeys).size !== matchKeys.length) {
    throw new Error("Plan-bound HTML browser validator found duplicate match keys on one page");
  }
  return matchKeys.sort(compareUtf8);
}

async function findUniqueVisibleActiveNextControl(
  locator: import("playwright-core").Locator,
  currentPageUrl: string
): Promise<import("playwright-core").Locator | undefined> {
  const count = await locator.count();
  let active: import("playwright-core").Locator | undefined;
  const current = new URL(currentPageUrl);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const href = await candidate.getAttribute("href");
    const ariaDisabled = await candidate.getAttribute("aria-disabled");
    const className = await candidate.getAttribute("class");
    const target = href?.trim() ? new URL(href, currentPageUrl) : undefined;
    const targetsCurrentPage = target !== undefined && target.origin === current.origin &&
      target.pathname === current.pathname && target.search === current.search;
    const navigable = ariaDisabled !== "true" &&
      !className?.split(/\s+/u).some((part) => part === "disabled") &&
      !targetsCurrentPage && Boolean(href?.trim() || await candidate.getAttribute("data-page"));
    if (!navigable) continue;
    if (!await candidate.isVisible()) {
      throw new Error("Plan-bound HTML browser validator active next control is hidden");
    }
    if (active) throw new Error("Plan-bound HTML browser validator found multiple active next controls");
    active = candidate;
  }
  return active;
}

function assertNavigation(
  sourceId: PlanBoundHtmlTraversalSourceId,
  response: import("playwright-core").Response | null,
  requestedUrl: string,
  pageNumber: number
): void {
  if (!response || response.status() < 200 || response.status() >= 400) {
    throw new Error("Plan-bound HTML browser validator navigation failed");
  }
  assertPageUrl(sourceId, response.url(), pageNumber);
  if (pageNumber === 1 && new URL(response.url()).origin !== new URL(requestedUrl).origin) {
    throw new Error("Plan-bound HTML browser validator navigation origin changed");
  }
}

function assertPageUrl(sourceId: PlanBoundHtmlTraversalSourceId, value: string, pageNumber: number): void {
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
  const actual = new URL(value);
  const entry = new URL(policy.entryUrl);
  if (actual.username || actual.password || actual.hash || actual.origin !== entry.origin) {
    throw new Error("Plan-bound HTML browser validator page URL escaped the registered source");
  }
  if ("pageCoordinate" in policy) {
    const coordinate = policy.pageCoordinate;
    if (coordinate.kind === "QUERY") {
      const expectedPath = pageNumber === 1 ? coordinate.firstPath : coordinate.pagePath;
      const expectedPage = pageNumber === 1 ? null : String(pageNumber);
      if (actual.pathname !== expectedPath || actual.searchParams.get(coordinate.parameter) !== expectedPage ||
          [...actual.searchParams.keys()].some((key) => key !== coordinate.parameter)) {
        throw new Error("Plan-bound HTML browser validator query page coordinate mismatch");
      }
    } else if (actual.pathname !== `${coordinate.prefix}${pageNumber}${coordinate.suffix}` ||
        actual.search !== "") {
      throw new Error("Plan-bound HTML browser validator path page coordinate mismatch");
    }
  } else if (sourceId === "source-novartis-social") {
    if (actual.pathname !== entry.pathname) {
      throw new Error("Novartis browser validator path mismatch");
    }
    const expectedPage = pageNumber === 1 ? null : String(pageNumber - 1);
    if (actual.searchParams.get("page") !== expectedPage ||
        [...actual.searchParams.keys()].some((key) => key !== "page")) {
      throw new Error("Novartis browser validator page coordinate mismatch");
    }
  } else if (actual.pathname !== entry.pathname || actual.search !== "") {
    throw new Error("Static HTML browser validator added unexpected query parameters");
  }
}

function assertOfficialJobUrl(
  policy: typeof PLAN_BOUND_HTML_TRAVERSAL_POLICIES[PlanBoundHtmlTraversalSourceId],
  value: string
): void {
  if (policy.key.kind !== "OFFICIAL_URL") throw new Error("Official URL policy is unavailable");
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.origin !== policy.key.origin ||
      !url.pathname.startsWith(policy.key.pathPrefix)) {
    throw new Error("Plan-bound HTML browser validator job URL escaped the registered source");
  }
  const allowedSearchParam = "allowedSearchParam" in policy.key ? policy.key.allowedSearchParam : undefined;
  if (allowedSearchParam) {
    const value = url.searchParams.get(allowedSearchParam);
    const required = "searchParamRequired" in policy.key && policy.key.searchParamRequired === true;
    if ((required && !value) || (value !== null && !/^[1-9][0-9]*$/u.test(value)) ||
        [...url.searchParams.keys()].some((key) => key !== allowedSearchParam)) {
      throw new Error("Plan-bound HTML browser validator job URL query is invalid");
    }
  } else if (url.search !== "") {
    throw new Error("Plan-bound HTML browser validator job URL added unexpected query parameters");
  }
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}
