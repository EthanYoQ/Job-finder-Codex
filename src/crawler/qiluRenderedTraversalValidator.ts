import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";

export interface QiluRenderedUiPageCapture {
  pageNumber: number;
  declaredTotalPages: number;
  rawRows: Array<{
    officialUrl: string;
    locationRaw: string;
    scopeDecision: "INCLUDED_MAINLAND" | "EXCLUDED_FOREIGN";
  }>;
  nextControlPresent: boolean;
}

export async function captureQiluRenderedUiTraversal(input: {
  entryUrl: string;
  signal?: AbortSignal;
  launchBrowser?: () => Promise<Pick<import("playwright-core").Browser, "newPage" | "close">>;
}): Promise<{ observedAt: string; pages: QiluRenderedUiPageCapture[] }> {
  if (input.entryUrl !== "https://qilu-pharma.zhiye.com/social/jobs") {
    throw new Error("Qilu browser validator entry URL mismatch");
  }
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
      if (!navigation || navigation.status() < 200 || navigation.status() >= 400 || navigation.url() !== input.entryUrl) {
        throw new Error("Qilu browser validator navigation failed");
      }
      await page.getByRole("row").nth(1).waitFor({ state: "visible", timeout: 30_000 });
      const totalText = await page.locator(".phoenix-pagination__totalPage").innerText();
      const totalMatch = /^\s*共\s*([1-9]\d*)\s*页\s*$/u.exec(totalText);
      const totalPages = totalMatch ? Number(totalMatch[1]) : Number.NaN;
      if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 60) {
        throw new Error("Qilu browser validator page declaration invalid");
      }
      await page.evaluate(() => {
        (window as typeof window & { __qiluCapturedUrls?: string[] }).__qiluCapturedUrls = [];
        window.open = ((url?: string | URL) => {
          (window as typeof window & { __qiluCapturedUrls: string[] }).__qiluCapturedUrls.push(String(url ?? ""));
          return null;
        }) as typeof window.open;
      });
      const pages: QiluRenderedUiPageCapture[] = [];
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        if (input.signal?.aborted) throw input.signal.reason;
        const rows = page.getByRole("row").filter({ has: page.locator("[class*='jobSpan']") });
        const rowCount = await rows.count();
        if (rowCount < 1 || rowCount > 15 || pageNumber < totalPages && rowCount !== 15) {
          throw new Error("Qilu browser validator rendered row count invalid");
        }
        const rawRows: QiluRenderedUiPageCapture["rawRows"] = [];
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          const row = rows.nth(rowIndex);
          const cells = row.getByRole("gridcell");
          if (await cells.count() !== 5) throw new Error("Qilu browser validator row shape invalid");
          const location = (await cells.nth(2).innerText()).trim();
          const before = await page.evaluate(() =>
            (window as typeof window & { __qiluCapturedUrls: string[] }).__qiluCapturedUrls.length);
          await row.locator("[class*='jobSpan']").click({ timeout: 10_000 });
          const captured = await page.evaluate(() =>
            (window as typeof window & { __qiluCapturedUrls: string[] }).__qiluCapturedUrls);
          if (captured.length !== before + 1) throw new Error("Qilu browser validator job navigation missing");
          const url = new URL(captured.at(-1)!, input.entryUrl);
          if (!isStrictQiluOfficialJobUrl(url.toString())) {
            throw new Error("Qilu browser validator job URL invalid");
          }
          rawRows.push({
            officialUrl: url.toString(),
            locationRaw: location,
            scopeDecision: qiluRenderedScopeDecision(location) ?? (() => {
              throw new Error("Qilu browser validator location scope is ambiguous or outside the audited exclusion policy");
            })()
          });
        }
        const next = page.locator(".phoenix-pagination__pageButton--next");
        const nextControlPresent = !(await next.getAttribute("class"))?.includes("--disabled");
        pages.push({ pageNumber, declaredTotalPages: totalPages, rawRows, nextControlPresent });
        if (pageNumber < totalPages) {
          if (!nextControlPresent) throw new Error("Qilu browser validator next-page control missing");
          const previousRows = await renderedRowFingerprint(page);
          await next.click({ timeout: 10_000 });
          await page.waitForFunction(({ expectedPage, previous }) => {
            const active = document.querySelector<HTMLElement>(".phoenix-pagination__numberButtonPure--clicked")?.textContent?.trim();
            const current = JSON.stringify([...document.querySelectorAll<HTMLElement>("[role='row']")]
              .filter((row) => row.querySelector("[class*='jobSpan']"))
              .map((row) => row.textContent?.replace(/\s+/gu, " ").trim() ?? ""));
            return active === String(expectedPage) && current !== previous;
          }, { expectedPage: pageNumber + 1, previous: previousRows }, { timeout: 30_000 });
          await waitForStableRenderedRows(page, input.signal);
        } else if (nextControlPresent) {
          throw new Error("Qilu browser validator terminal next control remained enabled");
        }
      }
      return { observedAt: new Date().toISOString(), pages };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      await closeBrowser();
    }
  } finally {
    releaseBrowserPermit();
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

async function renderedRowFingerprint(page: import("playwright-core").Page): Promise<string> {
  return page.getByRole("row").filter({ has: page.locator("[class*='jobSpan']") }).evaluateAll((rows) =>
    JSON.stringify(rows.map((row) => row.textContent?.replace(/\s+/gu, " ").trim() ?? "")));
}

async function waitForStableRenderedRows(page: import("playwright-core").Page, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + 30_000;
  let previous = "";
  let stableSamples = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    const current = await renderedRowFingerprint(page);
    stableSamples = current === previous ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
    previous = current;
    await page.waitForTimeout(50);
  }
  throw new Error("Qilu browser validator rendered page did not stabilize");
}

export function qiluRenderedLocationIsMainland(location: string): boolean {
  const normalized = location.trim().replace(/\s+/gu, " ");
  if (!normalized) return false;
  const parts = normalized.split(/[,，;/|·]/gu).map((part) => part.trim()).filter(Boolean);
  return parts.some((part) => {
    return /^(?:中国(?:大陆)?|全国)$/u.test(part) || MAINLAND_PROVINCE_PREFIXES.some((prefix) => part.startsWith(prefix));
  });
}

export function qiluRenderedScopeDecision(
  location: string
): "INCLUDED_MAINLAND" | "EXCLUDED_FOREIGN" | undefined {
  if (qiluRenderedLocationIsMainland(location)) return "INCLUDED_MAINLAND";
  const normalized = location.normalize("NFKC").trim().toLowerCase();
  if (!normalized || !QILU_AUDITED_EXCLUSION_MARKER.test(normalized)) return undefined;
  QILU_AUDITED_EXCLUSION_MARKER.lastIndex = 0;
  const residue = normalized
    .replace(QILU_AUDITED_EXCLUSION_MARKER, "")
    .replace(/(?:special administrative region|state|province|city|county|district|sar|特别行政区|自治区|省|州|市|县|区)/giu, "")
    .replace(/[\s,，/|;；、()（）.·_-]+/gu, "");
  QILU_AUDITED_EXCLUSION_MARKER.lastIndex = 0;
  return residue.length === 0 ? "EXCLUDED_FOREIGN" : undefined;
}

export function isStrictQiluOfficialJobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const jobAdId = url.searchParams.get("jobAdId") ?? "";
    return url.origin === "https://qilu-pharma.zhiye.com" && url.pathname === "/social/detail" &&
      url.username === "" && url.password === "" && url.hash === "" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(jobAdId) &&
      [...url.searchParams.keys()].length === 1 && [...url.searchParams.keys()][0] === "jobAdId";
  } catch {
    return false;
  }
}

const MAINLAND_PROVINCE_PREFIXES = Object.freeze([
  "北京市", "天津市", "上海市", "重庆市",
  "河北省", "山西省", "辽宁省", "吉林省", "黑龙江省", "江苏省", "浙江省", "安徽省",
  "福建省", "江西省", "山东省", "河南省", "湖北省", "湖南省", "广东省", "海南省",
  "四川省", "贵州省", "云南省", "陕西省", "甘肃省", "青海省",
  "内蒙古自治区", "广西壮族自治区", "西藏自治区", "宁夏回族自治区", "新疆维吾尔自治区"
] as const);

const QILU_AUDITED_EXCLUSION_MARKER = /(?:united states|usa|u\.s\.|boston|new york|san francisco|los angeles|seattle|hong kong|美国|纽约|波士顿|旧金山|洛杉矶|西雅图|香港)/giu;
