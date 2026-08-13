import { createHash } from "node:crypto";
import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";

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
  matchKeys: string[];
  rawMatchKeys: string[];
  nextControlPresent: boolean;
  partitions?: PlanBoundHtmlRenderedPartitionCapture[];
}

export function isPlanBoundHtmlTraversalSourceId(value: string): value is PlanBoundHtmlTraversalSourceId {
  return Object.prototype.hasOwnProperty.call(PLAN_BOUND_HTML_TRAVERSAL_POLICIES, value);
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
  if (input.entryUrl !== policy.entryUrl) throw new Error("Plan-bound HTML browser validator entry URL mismatch");
  if (input.signal?.aborted) throw input.signal.reason;
  const releaseBrowserPermit = await acquireBrowserSourcePermit(input.signal);
  try {
    const browser = await (input.launchBrowser ?? launchProductionBrowser)();
    let closePromise: Promise<void> | undefined;
    const closeBrowser = () => closePromise ??= browser.close();
    const abort = () => { void closeBrowser().catch(() => undefined); };
    if (input.signal?.aborted) {
      await closeBrowser();
      throw input.signal.reason;
    }
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const page = await browser.newPage();
      const navigation = await page.goto(input.entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      assertNavigation(input.sourceId, navigation, input.entryUrl, 1);
      await page.locator(policy.readySelector).first().waitFor({ state: "visible", timeout: 30_000 });
      let declaredPartitions: PlanBoundHtmlRenderedPartitionCapture[] | undefined;
      if ("revealSelector" in policy) {
        const reveal = page.locator(policy.revealSelector);
        const revealCount = await reveal.count();
        if (revealCount !== policy.expectedRevealControlCount) {
          throw new Error("Plan-bound HTML browser validator reveal-control set invalid");
        }
        await page.waitForFunction(({ selector, count }) => {
          const controls = [...document.querySelectorAll(selector)];
          return controls.length === count && controls.every((control) =>
            ["true", "false"].includes(control.getAttribute("aria-expanded") ?? ""));
        }, { selector: policy.revealSelector, count: policy.expectedRevealControlCount }, { timeout: 30_000 });
        const controlIds = new Set<string>();
        declaredPartitions = [];
        for (let index = 0; index < revealCount; index += 1) {
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
          await control.click({ timeout: 10_000 });
          await page.waitForFunction((id) => {
            const panel = document.getElementById(id);
            return panel !== null && panel.getAttribute("aria-hidden") !== "true";
          }, controls, { timeout: 10_000 });
          await normalizeRevealNavigation(page, policy.entryUrl, index);
          const partitionLocator = page.locator(`[id=${JSON.stringify(controls)}] ${policy.rowSelector}`);
          const partitionMatchKeys = await readMatchKeysFromLocator(partitionLocator, input.sourceId, policy);
          if (partitionMatchKeys.length < 1) {
            throw new Error("Plan-bound HTML browser validator declared partition is empty");
          }
          declaredPartitions.push({ controlIndex: index + 1, controlId: controls, matchKeys: partitionMatchKeys });
        }
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
        const activeNextCount = await countActiveNextControls(next);
        if (activeNextCount > 1) throw new Error("Plan-bound HTML browser validator found multiple active next controls");
        const nextControlPresent = activeNextCount === 1;
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
        const previousUrl = pageUrl;
        await Promise.all([
          page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 30_000 }),
          next.first().click({ timeout: 10_000 })
        ]);
        await page.locator(policy.readySelector).first().waitFor({ state: "visible", timeout: 30_000 });
      }
      if (capturedPages.length === 0 || capturedPages.at(-1)?.nextControlPresent !== false) {
        throw new Error("Plan-bound HTML browser validator did not prove terminal pagination");
      }
      const totalPages = capturedPages.length;
      return {
        observedAt: new Date().toISOString(),
        pages: capturedPages.map((captured) => ({ ...captured, declaredTotalPages: totalPages }))
      };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      await closeBrowser();
    }
  } finally {
    releaseBrowserPermit();
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

async function launchProductionBrowser(): Promise<Pick<import("playwright-core").Browser, "newPage" | "close">> {
  const { chromium } = await import("playwright-core");
  const { FORMAL_CHROMIUM_ARGS, FORMAL_CHROMIUM_PATH } = await import("../readiness/formalBrowserPreflight");
  return chromium.launch({
    ...(process.platform === "linux"
      ? { executablePath: FORMAL_CHROMIUM_PATH, args: [...FORMAL_CHROMIUM_ARGS] }
      : { channel: "chrome" as const }),
    headless: true,
    timeout: 30_000
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

async function countActiveNextControls(locator: import("playwright-core").Locator): Promise<number> {
  const count = await locator.count();
  let active = 0;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const href = await candidate.getAttribute("href");
    const ariaDisabled = await candidate.getAttribute("aria-disabled");
    const className = await candidate.getAttribute("class");
    if (ariaDisabled !== "true" && !className?.split(/\s+/u).some((part) => part === "disabled") &&
        (href?.trim() || await candidate.getAttribute("data-page"))) active += 1;
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
  if (actual.username || actual.password || actual.hash || actual.origin !== entry.origin || actual.pathname !== entry.pathname) {
    throw new Error("Plan-bound HTML browser validator page URL escaped the registered source");
  }
  if (sourceId === "source-novartis-social") {
    const expectedPage = pageNumber === 1 ? null : String(pageNumber - 1);
    if (actual.searchParams.get("page") !== expectedPage ||
        [...actual.searchParams.keys()].some((key) => key !== "page")) {
      throw new Error("Novartis browser validator page coordinate mismatch");
    }
  } else if (actual.search !== "") {
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
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}
