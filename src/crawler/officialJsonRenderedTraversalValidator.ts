import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";
import { tagBGradeIndependentTraversalFailure } from "./independentTraversalDiagnostics";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId } from "./officialJsonEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";

export const OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES = Object.freeze({
  "source-cspc-social": {
    companyId: "company-cspc",
    entryUrl: "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/0beb3022-3214-4333-a2e7-20786c4916d5/officeWebsite.mob",
    retrievalPath: "PLAYWRIGHT_OFFICIAL_UI_NETWORK_TRAVERSAL",
    validatorImplementationId: "cspc-redsea-playwright-network-traversal-v1",
    mainRetrievalPath: "HTTP_REDSEA_ZP_CHANNEL_TRAVERSAL",
    matchKeyKind: "SOURCE_JOB_ID",
    artifactLogicalKey: "cspc-redsea-browser-network-validation"
  },
  "source-nhu-social": {
    companyId: "company-nhu",
    entryUrl: "https://xinhecheng1.zhiye.com/social/jobs",
    retrievalPath: "PLAYWRIGHT_OFFICIAL_UI_NETWORK_TRAVERSAL",
    validatorImplementationId: "nhu-beisen-playwright-network-traversal-v1",
    mainRetrievalPath: "HTTP_BEISEN_JOBAD_PAGINATION",
    matchKeyKind: "SOURCE_JOB_ID",
    artifactLogicalKey: "nhu-beisen-browser-network-validation"
  },
  "source-xiuzheng-social": {
    companyId: "company-xiuzheng",
    entryUrl: "https://www.xiuzheng.com/#/recruit",
    retrievalPath: "PLAYWRIGHT_OFFICIAL_UI_NETWORK_TRAVERSAL",
    validatorImplementationId: "xiuzheng-playwright-network-traversal-v1",
    mainRetrievalPath: "HTTP_XIUZHENG_JOB_LIST_PAGINATION",
    matchKeyKind: "SOURCE_JOB_ID",
    artifactLogicalKey: "xiuzheng-browser-network-validation"
  }
} as const);

export type OfficialJsonRenderedTraversalSourceId = keyof typeof OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES;
export const OFFICIAL_JSON_RENDERED_TRAVERSAL_SOURCE_IDS = Object.freeze(
  Object.keys(OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES) as OfficialJsonRenderedTraversalSourceId[]
);
export const OFFICIAL_JSON_RENDERED_REQUIRED_CERTIFICATES = Object.freeze(Object.fromEntries(
  Object.entries(OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES).map(([sourceId, policy]) => [sourceId, policy.companyId])
) as Record<OfficialJsonRenderedTraversalSourceId,
  typeof OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES[OfficialJsonRenderedTraversalSourceId]["companyId"]>);

export interface OfficialJsonRenderedRawRow {
  sourceJobId: string;
  rawEvidenceId: string;
  scopeMarker: string;
  scopeDecision: "INCLUDED_MAINLAND" | "EXCLUDED_AUDITED";
  recordIndex: number;
  rawPayload: Record<string, unknown>;
}

export interface OfficialJsonRenderedPageCapture {
  channelId: string;
  pageNumber: number;
  declaredTotalPages: number;
  declaredTotalJobs: number;
  uiRequestCandidateIds: readonly string[];
  rawRows: readonly OfficialJsonRenderedRawRow[];
  nextControlPresent: boolean;
}

export interface OfficialJsonRenderedReplay {
  matchKeys: string[];
  rawSourceJobIds: string[];
  rawEvidenceIds: string[];
  excludedSourceJobIds: string[];
  rawCount: number;
  excludedCount: number;
}

export function isOfficialJsonRenderedTraversalSourceId(
  sourceId: string
): sourceId is OfficialJsonRenderedTraversalSourceId {
  return Object.prototype.hasOwnProperty.call(OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES, sourceId);
}

export async function captureOfficialJsonRenderedTraversal(input: {
  sourceId: OfficialJsonRenderedTraversalSourceId;
  entryUrl: string;
  signal?: AbortSignal;
  launchBrowser?: () => Promise<Pick<import("playwright-core").Browser, "newPage" | "close">>;
}): Promise<{ observedAt: string; pages: OfficialJsonRenderedPageCapture[] }> {
  const policy = OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES[input.sourceId];
  if (input.entryUrl !== policy.entryUrl) throw new Error("Official JSON browser validator entry URL mismatch");
  if (input.signal?.aborted) throw input.signal.reason;
  const release = await acquireBrowserSourcePermit(input.signal);
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
      try {
        const pages = input.sourceId === "source-cspc-social"
          ? await captureCspc(page, input.entryUrl, input.signal)
          : input.sourceId === "source-nhu-social"
            ? await captureNhu(page, input.entryUrl, input.signal)
            : await captureXiuzheng(page, input.entryUrl, input.signal);
        replayOfficialJsonRenderedTraversal(input.sourceId, pages);
        return { observedAt: new Date().toISOString(), pages };
      } finally {
        await page.close().catch(() => undefined);
      }
    } finally {
      input.signal?.removeEventListener("abort", abort);
      await closeBrowser();
    }
  } finally {
    release();
  }
}

export function replayOfficialJsonRenderedTraversal(
  sourceId: OfficialJsonRenderedTraversalSourceId,
  pages: readonly OfficialJsonRenderedPageCapture[]
): OfficialJsonRenderedReplay {
  if (pages.length < 1 || pages.length > 5) throw new Error("Official JSON browser validation page count is invalid");
  const rawSourceJobIds: string[] = [];
  const rawEvidenceIds: string[] = [];
  const matchKeys: string[] = [];
  const excludedSourceJobIds: string[] = [];
  const declaredTotalJobs = pages[0]!.declaredTotalJobs;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    if (page.pageNumber !== index + 1 || page.declaredTotalPages !== pages.length ||
        page.declaredTotalJobs !== declaredTotalJobs || page.nextControlPresent !== (index < pages.length - 1) ||
        !page.channelId.trim()) {
      throw new Error("Official JSON browser validation pagination equation mismatch");
    }
    if (sourceId === "source-cspc-social") {
      const responseRequestIds = page.rawRows.map((row) => row.rawPayload.REQUEST_ID);
      if (page.uiRequestCandidateIds.length < page.rawRows.length ||
          new Set(page.uiRequestCandidateIds).size !== page.uiRequestCandidateIds.length ||
          page.uiRequestCandidateIds.some((value) => !uuid(value)) ||
          responseRequestIds.some((value) => typeof value !== "string" ||
            !page.uiRequestCandidateIds.includes(value))) {
        throw new Error("CSPC browser validation request scope is invalid");
      }
    } else if (page.uiRequestCandidateIds.length !== 0) {
      throw new Error("Official JSON browser validation has an unexpected request scope");
    }
    for (let recordIndex = 0; recordIndex < page.rawRows.length; recordIndex += 1) {
      const row = page.rawRows[recordIndex]!;
      if (!row.sourceJobId.trim() || !/^sha256:[0-9a-f]{64}$/u.test(row.rawEvidenceId) || !row.scopeMarker.trim()) {
        throw new Error("Official JSON browser validation raw row is invalid");
      }
      assertRawRowIdentity(sourceId, row, recordIndex);
      const expectedDecision = replayScopeDecision(sourceId, row.scopeMarker);
      if (row.scopeDecision !== expectedDecision) {
        throw new Error("Official JSON browser validation scope decision mismatch");
      }
      rawSourceJobIds.push(row.sourceJobId);
      rawEvidenceIds.push(row.rawEvidenceId);
      if (row.scopeDecision === "INCLUDED_MAINLAND") matchKeys.push(row.sourceJobId);
      else excludedSourceJobIds.push(row.sourceJobId);
    }
  }
  if (rawSourceJobIds.length !== declaredTotalJobs ||
      new Set(rawSourceJobIds).size !== rawSourceJobIds.length ||
      new Set(rawEvidenceIds).size !== rawEvidenceIds.length ||
      new Set(matchKeys).size !== matchKeys.length) {
    throw new Error("Official JSON browser validation raw set does not reconcile");
  }
  return {
    matchKeys: canonical(matchKeys),
    rawSourceJobIds: canonical(rawSourceJobIds),
    rawEvidenceIds: canonical(rawEvidenceIds),
    excludedSourceJobIds: canonical(excludedSourceJobIds),
    rawCount: rawSourceJobIds.length,
    excludedCount: excludedSourceJobIds.length
  };
}

async function captureCspc(
  page: import("playwright-core").Page,
  entryUrl: string,
  signal?: AbortSignal
): Promise<OfficialJsonRenderedPageCapture[]> {
  const endpointPath = "/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob";
  const officialOrigin = new URL(entryUrl).origin;
  const [response, navigation] = await Promise.all([
    page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.origin === officialOrigin && url.pathname === endpointPath &&
        candidate.request().method() === "POST";
    }, { timeout: 30_000 }),
    page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
  ]);
  assertNavigation(navigation, entryUrl);
  if (signal?.aborted) throw signal.reason;
  if (response.status() !== 200) throw new Error("CSPC browser validator initial request failed");
  const frame = page.frameLocator("#recruit-content-iframe");
  const search = frame.getByText("搜索", { exact: true });
  if (await search.count() !== 1) throw new Error("CSPC browser validator search control mismatch");
  if ((await frame.locator(".vxe-table--body tbody tr").allTextContents()).length !== 0) {
    throw new Error("CSPC browser validator search did not start from the unrendered list state");
  }
  const request = new URLSearchParams(response.request().postData() ?? "");
  const channelId = "0beb3022-3214-4333-a2e7-20786c4916d5";
  const requestedIds = (request.get("push_request_id") ?? "").split(",").filter(Boolean);
  const expectedRequestKeys = ["channelQrId", "sortName", "peopleId", "root_id", "shareStaff",
    "push_request_id", "keyword", "ftl_list_stru_id"].sort(compareUtf8);
  if (response.status() !== 200 || request.get("channelQrId") !== channelId || request.get("root_id") !== "cspc" ||
      request.get("sortName") !== "zri.ext_rankNum" || request.get("peopleId") !== "" ||
      request.get("shareStaff") !== "" || request.get("keyword") !== "" || request.get("ftl_list_stru_id") !== "" ||
      JSON.stringify([...request.keys()].sort(compareUtf8)) !== JSON.stringify(expectedRequestKeys) ||
      requestedIds.length < 1 || new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some((value) => !uuid(value))) {
    throw new Error("CSPC browser validator request contract mismatch");
  }
  const root = parseRecord(await response.text());
  if (root.state !== "1" || root.total !== "" || !Array.isArray(root.jsonList) || root.jsonList.length < 1) {
    throw new Error("CSPC browser validator response schema is invalid");
  }
  const rows = root.jsonList.map((raw, recordIndex) => {
    if (!isRecord(raw) || typeof raw.REQUEST_ID !== "string" || !uuid(raw.REQUEST_ID)) {
      throw new Error("CSPC browser validator official ID is invalid");
    }
    if (!requestedIds.includes(raw.REQUEST_ID)) {
      throw new Error("CSPC browser validator response escaped the rendered UI request scope");
    }
    return rawRow(`${channelId}:${raw.REQUEST_ID}`, irreversibleOfficialJsonEvidenceId(raw.REQUEST_ID), "SOCIAL_CHANNEL",
      "INCLUDED_MAINLAND", recordIndex, raw);
  });
  let rendered = false;
  const renderAttemptTimeouts = [250, 2_000, 27_750] as const;
  for (const timeoutMs of renderAttemptTimeouts) {
    if (rendered) break;
    if (signal?.aborted) throw signal.reason;
    await search.click();
    if (signal?.aborted) throw signal.reason;
    rendered = await waitForCspcRenderedRows(frame, rows, timeoutMs, signal);
  }
  if (!rendered) throw new Error("CSPC browser validator rendered list does not match its official response");
  if (signal?.aborted) throw signal.reason;
  const disabledNextCount = await frame.locator(".vxe-pager--next-btn.is--disabled").count();
  const disabledJumpNextCount = await frame.locator(".vxe-pager--jump-next.is--disabled").count();
  const continuationCount = await frame
    .locator(".vxe-pager--next-btn:not(.is--disabled), [class*='load-more']:visible").count();
  if (signal?.aborted) throw signal.reason;
  if (disabledNextCount !== 1 || disabledJumpNextCount !== 1 || continuationCount !== 0) {
    throw new Error("CSPC browser validator rendered list has an untraversed continuation control");
  }
  return [{ channelId, pageNumber: 1, declaredTotalPages: 1, declaredTotalJobs: rows.length,
    uiRequestCandidateIds: requestedIds,
    rawRows: rows, nextControlPresent: false }];
}

async function captureNhu(
  page: import("playwright-core").Page,
  entryUrl: string,
  signal?: AbortSignal
): Promise<OfficialJsonRenderedPageCapture[]> {
  const endpointPath = "/api/Jobad/GetJobAdPageList";
  const officialOrigin = new URL(entryUrl).origin;
  const responseForPage = (pageIndex: number) => page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    if (url.origin !== officialOrigin || url.pathname !== endpointPath ||
        candidate.request().method() !== "POST") return false;
    try { return parseRecord(candidate.request().postData() ?? "{}").PageIndex === pageIndex; }
    catch { return false; }
  }, { timeout: 30_000 });
  const [firstResponse, navigation] = await Promise.all([
    responseForPage(0),
    page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
  ]);
  assertNavigation(navigation, entryUrl);
  if (signal?.aborted) throw signal.reason;
  const first = await parseNhuResponse(firstResponse, 0);
  const declaredTotalPages = Math.max(1, Math.ceil(first.declaredTotalJobs / 20));
  if (declaredTotalPages > 5) throw new Error("NHU browser validator page declaration is invalid");
  const captures = [first];
  for (let pageIndex = 1; pageIndex < declaredTotalPages; pageIndex += 1) {
    if (signal?.aborted) throw signal.reason;
    const [response] = await Promise.all([
      responseForPage(pageIndex),
      page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    ]);
    captures.push(await parseNhuResponse(response, pageIndex));
  }
  if (captures.some((capture) => capture.declaredTotalJobs !== first.declaredTotalJobs)) {
    throw new Error("NHU browser validator declared total changed");
  }
  return captures.map((capture, index) => ({
    channelId: "source:source-nhu-social:default",
    pageNumber: index + 1,
    declaredTotalPages,
    declaredTotalJobs: first.declaredTotalJobs,
    uiRequestCandidateIds: [],
    rawRows: capture.rawRows,
    nextControlPresent: index < declaredTotalPages - 1
  }));
}

async function parseNhuResponse(
  response: import("playwright-core").Response,
  expectedPageIndex: number
): Promise<{ declaredTotalJobs: number; rawRows: OfficialJsonRenderedRawRow[] }> {
  const requestBody = response.request().postData() ?? "{}";
  const expectedDisplayFields = ["Category", "Kind", "LocId", "PostDate", "WorkWeChatQrCode"];
  const expectedRequestKeys = ["PageIndex", "PageSize", "Category", "KeyWords", "SpecialType", "PortalId",
    "DisplayFields"];
  const request = parseStrictJsonRequest(requestBody, expectedRequestKeys);
  if (response.status() !== 200 || request.PageIndex !== expectedPageIndex || request.PageSize !== 20 ||
      JSON.stringify(request.Category) !== JSON.stringify(["1"]) || request.KeyWords !== "" ||
      request.SpecialType !== 0 || request.PortalId !== "" ||
      JSON.stringify(request.DisplayFields) !== JSON.stringify(expectedDisplayFields)) {
    throw new Error("NHU browser validator request contract mismatch");
  }
  const root = parseRecord(await response.text());
  if (root.Code !== 200 || !Number.isSafeInteger(root.Count) || Number(root.Count) < 0 ||
      !Array.isArray(root.Data) || root.Data.length > 20 ||
      root.Data.length !== Math.min(20, Math.max(0, Number(root.Count) - expectedPageIndex * 20))) {
    throw new Error("NHU browser validator response schema is invalid");
  }
  const rawRows = root.Data.map((raw, recordIndex) => {
    if (!isRecord(raw) || typeof raw.Id !== "string" || !uuid(raw.Id) ||
        !Array.isArray(raw.LocNames) || raw.LocNames.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("NHU browser validator raw row is invalid");
    }
    const locations = raw.LocNames as string[];
    const marker = JSON.stringify([...locations].sort(compareUtf8));
    return rawRow(persistentOfficialJsonJobId(raw.Id), irreversibleOfficialJsonEvidenceId(raw.Id), marker,
      replayScopeDecision("source-nhu-social", marker), recordIndex, raw);
  });
  return { declaredTotalJobs: Number(root.Count), rawRows };
}

async function captureXiuzheng(
  page: import("playwright-core").Page,
  entryUrl: string,
  signal?: AbortSignal
): Promise<OfficialJsonRenderedPageCapture[]> {
  const officialOrigin = new URL(entryUrl).origin;
  const homeUrl = `${officialOrigin}/`;
  const navigation = await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  assertNavigation(navigation, homeUrl);
  const humanResources = page.getByText("人力资源", { exact: true });
  await waitForUniqueXiuzhengControl(humanResources, "route", signal);
  await Promise.all([
    page.waitForURL(`${officialOrigin}/#/humanResource`, { timeout: 30_000 }),
    humanResources.click()
  ]);
  const pages: OfficialJsonRenderedPageCapture[] = [];
  let expectedTotal: number | undefined;
  let expectedPages: number | undefined;
  const responseForPage = (pageNumber: number) => page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    if (url.origin !== officialOrigin || url.pathname !== "/front/human-resource/job-list" ||
        candidate.request().method() !== "POST") return false;
    try {
      const request = parseRecord(candidate.request().postData() ?? "{}");
      return request.page === pageNumber;
    } catch {
      return false;
    }
  }, { timeout: 30_000 });
  const more = page.getByText("查看更多", { exact: true });
  await waitForUniqueXiuzhengControl(more, "list", signal);
  let pendingResponse = responseForPage(1);
  const [firstResponse] = await Promise.all([
    pendingResponse,
    page.waitForURL(`${officialOrigin}/#/humanmore`, { timeout: 30_000 }),
    more.click()
  ]);
  for (let pageNumber = 1; pageNumber <= 5; pageNumber += 1) {
    if (signal?.aborted) throw signal.reason;
    const response = pageNumber === 1 ? firstResponse : await pendingResponse;
    const request = parseStrictJsonRequest(response.request().postData() ?? "{}", ["page", "page_size"]);
    if (request.page !== pageNumber || request.page_size !== 10) {
      throw new Error("Xiuzheng browser validator request contract mismatch");
    }
    if (response.status() !== 200 || !(response.headers()["content-type"] ?? "").toLowerCase().includes("application/json")) {
      throw new Error("Xiuzheng browser validator request failed");
    }
    const root = parseRecord(await response.text());
    const data = isRecord(root.data) ? root.data : undefined;
    if (root.code !== 0 || !data || !Number.isSafeInteger(data.total) || Number(data.total) < 0 ||
        !Number.isSafeInteger(data.current_page) || data.current_page !== pageNumber ||
        !Number.isSafeInteger(data.last_page) || Number(data.last_page) < 1 ||
        !Number.isSafeInteger(data.per_page) || data.per_page !== 10 || !Array.isArray(data.data)) {
      throw new Error("Xiuzheng browser validator response schema is invalid");
    }
    expectedTotal ??= Number(data.total);
    expectedPages ??= Number(data.last_page);
    if (Number(data.total) !== expectedTotal || Number(data.last_page) !== expectedPages || expectedPages > 5) {
      throw new Error("Xiuzheng browser validator pagination declaration changed");
    }
    const rows = data.data.map((raw, recordIndex) => {
      if (!isRecord(raw) || !(typeof raw.id === "number" || typeof raw.id === "string") ||
          !/^\d+$/u.test(String(raw.id)) || typeof raw.name !== "string" || !raw.name.trim()) {
        throw new Error("Xiuzheng browser validator raw row is invalid");
      }
      const marker = raw.name.trim();
      return rawRow(String(raw.id),
        irreversibleOfficialJsonEvidenceId([recordIndex, raw]), marker,
        replayScopeDecision("source-xiuzheng-social", marker), recordIndex, raw);
    });
    await assertXiuzhengRenderedRows(page, rows, expectedPages, pageNumber);
    pages.push({ channelId: "source:source-xiuzheng-social:default", pageNumber,
      declaredTotalPages: expectedPages, declaredTotalJobs: expectedTotal, rawRows: rows,
      uiRequestCandidateIds: [],
      nextControlPresent: pageNumber < expectedPages });
    if (pageNumber === expectedPages) break;
    const nextPage = pageNumber + 1;
    const nextControl = page.getByRole("button", { name: String(nextPage), exact: true });
    if (await nextControl.count() !== 1) throw new Error("Xiuzheng browser validator next control mismatch");
    pendingResponse = responseForPage(nextPage);
    await nextControl.click();
  }
  return pages;
}

async function waitForUniqueXiuzhengControl(
  locator: import("playwright-core").Locator,
  label: "route" | "list",
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw tagBGradeIndependentTraversalFailure(signal.reason, "B_GRADE_VALIDATOR_ABORTED");
  }
  const visibleLocator = locator.filter({ visible: true });
  try {
    await visibleLocator.first().waitFor({ state: "visible", timeout: 30_000 });
    if (signal?.aborted) {
      throw tagBGradeIndependentTraversalFailure(signal.reason, "B_GRADE_VALIDATOR_ABORTED");
    }
    const visibleCount = await visibleLocator.count();
    if (signal?.aborted) {
      throw tagBGradeIndependentTraversalFailure(signal.reason, "B_GRADE_VALIDATOR_ABORTED");
    }
    if (visibleCount !== 1) {
      throw new Error(`Xiuzheng browser validator ${label} control readiness failed`);
    }
  } catch (error) {
    if (signal?.aborted) {
      throw tagBGradeIndependentTraversalFailure(signal.reason, "B_GRADE_VALIDATOR_ABORTED");
    }
    throw tagBGradeIndependentTraversalFailure(error, "B_GRADE_BROWSER_READINESS_FAILED");
  }
}

async function assertXiuzhengRenderedRows(
  page: import("playwright-core").Page,
  rows: readonly OfficialJsonRenderedRawRow[],
  declaredTotalPages: number,
  currentPage: number
): Promise<void> {
  const titles = page.locator(".tabs_detail_content_item .tabs_detail_content_item_left span");
  const expectedTitles = rows.map((row) => String(row.rawPayload.name).normalize("NFKC").trim());
  const expectedPageButtons = Array.from({ length: declaredTotalPages }, (_, index) => String(index + 1));
  const deadline = Date.now() + 30_000;
  do {
    const renderedTitles = (await titles.allTextContents()).map((value) => value.normalize("NFKC").trim());
    const visibleButtons = (await page.locator(".pagination button:visible").allTextContents())
      .map((value) => value.normalize("NFKC").trim());
    const declaredPageButtons = canonical(visibleButtons.filter((value) => /^\d+$/u.test(value)));
    const activePageButtons = (await page.locator(".pagination button.active:visible").allTextContents())
      .map((value) => value.normalize("NFKC").trim());
    if (JSON.stringify(renderedTitles) === JSON.stringify(expectedTitles) &&
        JSON.stringify(declaredPageButtons) === JSON.stringify(expectedPageButtons) &&
        JSON.stringify(activePageButtons) === JSON.stringify([String(currentPage)])) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error("Xiuzheng browser validator rendered list does not match its official response");
}

async function waitForCspcRenderedRows(
  frame: import("playwright-core").FrameLocator,
  rows: readonly OfficialJsonRenderedRawRow[],
  timeoutMs: number,
  signal?: AbortSignal
): Promise<boolean> {
  const renderedRows = frame.locator(".vxe-table--body tbody tr");
  const deadline = Date.now() + timeoutMs;
  do {
    if (signal?.aborted) throw signal.reason;
    const renderedText = (await renderedRows.allTextContents()).map((value) => value.normalize("NFKC"));
    if (signal?.aborted) throw signal.reason;
    if (renderedText.length === rows.length && renderedText.every((text, index) => {
      const raw = rows[index]!.rawPayload;
      return typeof raw.PUBLISH_NAME === "string" && text.includes(raw.PUBLISH_NAME.normalize("NFKC")) &&
        (typeof raw.work_place !== "string" || text.includes(raw.work_place.normalize("NFKC"))) &&
        (typeof raw.UPDATE_TIME !== "string" || text.includes(raw.UPDATE_TIME.normalize("NFKC")));
    })) {
      if (signal?.aborted) throw signal.reason;
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (signal?.aborted) throw signal.reason;
  } while (Date.now() < deadline);
  return false;
}

function parseStrictJsonRequest(body: string, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!hasUniqueJsonObjectKeys(body)) {
    throw new Error("Official JSON browser validator request has ambiguous JSON keys");
  }
  const parsed = parseRecord(body);
  if (JSON.stringify(Object.keys(parsed).sort(compareUtf8)) !==
      JSON.stringify([...expectedKeys].sort(compareUtf8))) {
    throw new Error("Official JSON browser validator request has unexpected keys");
  }
  return parsed;
}

function replayScopeDecision(
  sourceId: OfficialJsonRenderedTraversalSourceId,
  marker: string
): OfficialJsonRenderedRawRow["scopeDecision"] {
  if (sourceId === "source-cspc-social") {
    if (marker !== "SOCIAL_CHANNEL") throw new Error("CSPC browser validator scope marker mismatch");
    return "INCLUDED_MAINLAND";
  }
  if (sourceId === "source-xiuzheng-social") {
    return marker === "用人理念" ? "EXCLUDED_AUDITED" : "INCLUDED_MAINLAND";
  }
  let locations: unknown;
  try { locations = JSON.parse(marker); } catch { throw new Error("NHU browser validator scope marker is invalid"); }
  if (!Array.isArray(locations) || locations.length < 1 ||
      locations.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("NHU browser validator scope marker is invalid");
  }
  const normalized = locations.map((value) => String(value).normalize("NFKC").trim());
  if (normalized.some((value) => MAINLAND_PREFIXES.some((prefix) => value.startsWith(prefix)))) {
    return "INCLUDED_MAINLAND";
  }
  if (normalized.every((value) => /^(?:日本|日本[·・].+)$/u.test(value))) return "EXCLUDED_AUDITED";
  throw new Error("NHU browser validator location is outside the audited scope policy");
}

function rawRow(
  sourceJobId: string,
  rawEvidenceId: string,
  scopeMarker: string,
  scopeDecision: OfficialJsonRenderedRawRow["scopeDecision"],
  recordIndex: number,
  rawPayload: Record<string, unknown>
): OfficialJsonRenderedRawRow {
  return { sourceJobId, rawEvidenceId, scopeMarker, scopeDecision, recordIndex, rawPayload };
}

function assertRawRowIdentity(
  sourceId: OfficialJsonRenderedTraversalSourceId,
  row: OfficialJsonRenderedRawRow,
  expectedRecordIndex: number
): void {
  if (row.recordIndex !== expectedRecordIndex || !isRecord(row.rawPayload)) {
    throw new Error("Official JSON browser validation raw row identity mismatch");
  }
  let expectedSourceJobId: string;
  let expectedRawEvidenceId: string;
  let expectedMarker: string;
  if (sourceId === "source-cspc-social") {
    const id = row.rawPayload.REQUEST_ID;
    if (typeof id !== "string" || !uuid(id)) throw new Error("CSPC browser validator raw identity is invalid");
    expectedSourceJobId = `0beb3022-3214-4333-a2e7-20786c4916d5:${id}`;
    expectedRawEvidenceId = irreversibleOfficialJsonEvidenceId(id);
    expectedMarker = "SOCIAL_CHANNEL";
  } else if (sourceId === "source-nhu-social") {
    const id = row.rawPayload.Id;
    const locations = row.rawPayload.LocNames;
    if (typeof id !== "string" || !uuid(id) || !Array.isArray(locations) ||
        locations.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("NHU browser validator raw identity is invalid");
    }
    expectedSourceJobId = persistentOfficialJsonJobId(id);
    expectedRawEvidenceId = irreversibleOfficialJsonEvidenceId(id);
    expectedMarker = JSON.stringify((locations as string[]).slice().sort(compareUtf8));
  } else {
    const id = row.rawPayload.id;
    const name = row.rawPayload.name;
    if (!(typeof id === "number" || typeof id === "string") || !/^\d+$/u.test(String(id)) ||
        typeof name !== "string" || !name.trim()) {
      throw new Error("Xiuzheng browser validator raw identity is invalid");
    }
    expectedSourceJobId = String(id);
    expectedRawEvidenceId = irreversibleOfficialJsonEvidenceId([row.recordIndex, row.rawPayload]);
    expectedMarker = name.trim();
  }
  if (row.sourceJobId !== expectedSourceJobId || row.rawEvidenceId !== expectedRawEvidenceId ||
      row.scopeMarker !== expectedMarker) {
    throw new Error("Official JSON browser validation raw row identity mismatch");
  }
}

function assertNavigation(response: import("playwright-core").Response | null, expectedUrl: string): void {
  if (!response || response.status() < 200 || response.status() >= 400 || response.url() !== expectedUrl) {
    throw new Error("Official JSON browser validator navigation failed");
  }
}

function parseRecord(body: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new Error("Official JSON browser validator response is invalid JSON"); }
  if (!isRecord(value)) throw new Error("Official JSON browser validator response root is invalid");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function canonical(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUtf8);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
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

const MAINLAND_PREFIXES = Object.freeze([
  "北京市", "天津市", "上海市", "重庆市", "河北省", "山西省", "辽宁省", "吉林省", "黑龙江省",
  "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省", "河南省", "湖北省", "湖南省",
  "广东省", "海南省", "四川省", "贵州省", "云南省", "陕西省", "甘肃省", "青海省", "内蒙古",
  "广西", "西藏", "宁夏", "新疆"
] as const);
