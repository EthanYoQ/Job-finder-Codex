import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  capturePlanBoundHtmlRenderedTraversal,
  PLAN_BOUND_HTML_TRAVERSAL_POLICIES
} from "../../src/crawler/planBoundHtmlTraversalValidator";
import { classifyBGradeIndependentTraversalFailure } from "../../src/crawler/independentTraversalDiagnostics";

describe("plan-bound HTML rendered traversal", () => {
  it("captures a terminal static list and closes the browser", async () => {
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-otsuka-china-social-2"].entryUrl;
    const close = vi.fn(async () => undefined);
    const browser = staticBrowser({
      entryUrl,
      rawRows: [["Role Two", "Shanghai"], ["Role One", "Shanghai"]],
      close
    });

    const result = await capturePlanBoundHtmlRenderedTraversal({
      sourceId: "source-otsuka-china-social-2",
      entryUrl,
      launchBrowser: async () => browser
    });

    expect(result.pages).toEqual([{
      pageNumber: 1,
      declaredTotalPages: 1,
      matchKeys: [syntheticKey("source-otsuka-china-social-2", ["Role One", "Shanghai"]),
        syntheticKey("source-otsuka-china-social-2", ["Role Two", "Shanghai"])],
      rawMatchKeys: [syntheticKey("source-otsuka-china-social-2", ["Role One", "Shanghai"]),
        syntheticKey("source-otsuka-china-social-2", ["Role Two", "Shanghai"])],
      nextControlPresent: false
    }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("traverses Novartis pages, retaining raw overlap and first-seen unique keys", async () => {
    const sourceId = "source-novartis-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    const browser = novartisBrowser({
      entryUrl,
      rowsByPage: [
        [officialNovartisUrl("a"), officialNovartisUrl("b")],
        [officialNovartisUrl("b"), officialNovartisUrl("c")]
      ],
      close
    });

    const result = await capturePlanBoundHtmlRenderedTraversal({ sourceId, entryUrl, launchBrowser: async () => browser });

    expect(result.pages).toEqual([
      {
        pageNumber: 1,
        declaredTotalPages: 2,
        rawMatchKeys: [officialKey(sourceId, "a"), officialKey(sourceId, "b")],
        matchKeys: [officialKey(sourceId, "a"), officialKey(sourceId, "b")],
        nextControlPresent: true
      },
      {
        pageNumber: 2,
        declaredTotalPages: 2,
        rawMatchKeys: [officialKey(sourceId, "b"), officialKey(sourceId, "c")],
        matchKeys: [officialKey(sourceId, "c")],
        nextControlPresent: false
      }
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      sourceId: "source-fosun-pharma-social" as const,
      pageUrls: ["https://fosunpharma.zhiye.com/social", "https://fosunpharma.zhiye.com/social/?PageIndex=2"],
      rowUrls: [["https://fosunpharma.zhiye.com/socialxq?jobId=101"],
        ["https://fosunpharma.zhiye.com/socialxq?jobId=102"]]
    },
    {
      sourceId: "source-kelun-social" as const,
      pageUrls: ["https://kelun.zhiye.com/social", "https://kelun.zhiye.com/social/?PageIndex=2"],
      rowUrls: [["https://kelun.zhiye.com/job_show/101"],
        ["https://kelun.zhiye.com/job_show/102?PageIndex=2"]]
    },
    {
      sourceId: "source-tongrentang-social" as const,
      pageUrls: ["https://www.tongrentang.com/newsList/54/1.html", "https://www.tongrentang.com/newsList/54/2.html"],
      rowUrls: [["https://www.tongrentang.com/menu54/newsDetail/one.html"],
        ["https://www.tongrentang.com/menu54/newsDetail/two.html"]]
    }
  ])("traverses and closes the registered $sourceId page coordinate", async ({ sourceId, pageUrls, rowUrls }) => {
    const close = vi.fn(async () => undefined);
    const result = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl: pageUrls[0]!,
      launchBrowser: async () => pagedOfficialBrowser({ sourceId, pageUrls, rowUrls, close })
    });

    expect(result.pages).toMatchObject([
      { pageNumber: 1, declaredTotalPages: 2, nextControlPresent: true },
      { pageNumber: 2, declaredTotalPages: 2, nextControlPresent: false }
    ]);
    expect(result.pages.flatMap((page) => page.matchKeys)).toHaveLength(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects an unregistered query on a plan-bound official job URL", async () => {
    const sourceId = "source-fosun-pharma-social" as const;
    const pageUrls = [PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl];
    const close = vi.fn(async () => undefined);
    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl: pageUrls[0]!,
      launchBrowser: async () => pagedOfficialBrowser({
        sourceId,
        pageUrls,
        rowUrls: [["https://fosunpharma.zhiye.com/socialxq?jobId=101&utm_source=forged"]],
        close
      })
    })).rejects.toThrow("job URL query is invalid");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("traverses every configured TalentBrew partition and page", async () => {
    const sourceId = "source-sanofi-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    const result = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => talentbrewBrowser({ entryUrl, close })
    });

    expect(result.pages).toEqual([
      { channelId: "employment-fixed-term", pageNumber: 1, declaredTotalPages: 2,
        declaredTotalJobs: 3, matchKeys: [`${sourceId}:81001`, `${sourceId}:81002`],
        rawMatchKeys: [`${sourceId}:81001`, `${sourceId}:81002`], nextControlPresent: true },
      { channelId: "employment-fixed-term", pageNumber: 2, declaredTotalPages: 2,
        declaredTotalJobs: 3, matchKeys: [`${sourceId}:81003`], rawMatchKeys: [`${sourceId}:81003`],
        nextControlPresent: false },
      { channelId: "employment-regular", pageNumber: 1, declaredTotalPages: 1,
        declaredTotalJobs: 1, matchKeys: [`${sourceId}:82001`], rawMatchKeys: [`${sourceId}:82001`],
        nextControlPresent: false }
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects an unregistered TalentBrew partition in the configured facet field", async () => {
    const sourceId = "source-sanofi-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => talentbrewBrowser({ entryUrl, close, extraPartitionId: "Contractor" })
    })).rejects.toThrow("partition universe changed");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the active TalentBrew page and browser once when aborted", async () => {
    const sourceId = "source-sanofi-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const controller = new AbortController();
    const close = vi.fn(async () => undefined);
    const pageClose = vi.fn(async () => undefined);
    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      signal: controller.signal,
      launchBrowser: async () => talentbrewBrowser({
        entryUrl,
        close,
        pageClose,
        onGoto: () => controller.abort(new Error("cancelled"))
      })
    })).rejects.toThrow("cancelled");
    expect(pageClose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("expands and proves every Astellas accordion partition", async () => {
    const sourceId = "source-astellas-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    const controlClicks = [vi.fn(async () => undefined), vi.fn(async () => undefined), vi.fn(async () => undefined)];
    const browser = astellasBrowser({ entryUrl, close, controlClicks });

    const result = await capturePlanBoundHtmlRenderedTraversal({ sourceId, entryUrl, launchBrowser: async () => browser });

    expect(result.pages[0]?.matchKeys).toEqual([
      `${sourceId}:role-one`, `${sourceId}:role-three`, `${sourceId}:role-two`
    ]);
    expect(result.pages[0]?.partitions).toEqual([
      { controlIndex: 1, controlId: "panel-1", matchKeys: [`${sourceId}:role-one`] },
      { controlIndex: 2, controlId: "panel-2", matchKeys: [`${sourceId}:role-two`] },
      { controlIndex: 3, controlId: "panel-3", matchKeys: [`${sourceId}:role-three`] }
    ]);
    expect(controlClicks.every((click) => click.mock.calls.length === 1)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("leaves an already-expanded Astellas partition open and expands only collapsed controls", async () => {
    const sourceId = "source-astellas-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    const controlClicks = [vi.fn(), vi.fn(), vi.fn()];

    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => astellasBrowser({
        entryUrl,
        close,
        controlClicks,
        initialExpanded: [true, false, false]
      })
    })).resolves.toMatchObject({ pages: [{ matchKeys: expect.any(Array) }] });

    expect(controlClicks.map((click) => click.mock.calls.length)).toEqual([0, 1, 1]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("dismisses the Astellas privacy overlay before expanding a partition", async () => {
    const sourceId = "source-astellas-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    const privacyReject = vi.fn(async () => undefined);
    const controlClicks = [vi.fn(), vi.fn(), vi.fn()];

    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => astellasBrowser({
        entryUrl,
        close,
        controlClicks,
        privacyReject
      })
    })).resolves.toMatchObject({ pages: [{ matchKeys: expect.any(Array) }] });

    expect(privacyReject).toHaveBeenCalledTimes(1);
    expect(controlClicks.map((click) => click.mock.calls.length)).toEqual([1, 1, 1]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("dismisses a late Astellas privacy overlay and retries the interrupted expansion once", async () => {
    const sourceId = "source-astellas-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    const privacyReject = vi.fn(async () => undefined);
    const controlClicks = [vi.fn(), vi.fn(), vi.fn()];

    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => astellasBrowser({
        entryUrl,
        close,
        controlClicks,
        privacyReject,
        privacyOverlayAppearsOnFirstControlClick: true
      })
    })).resolves.toMatchObject({ pages: [{ matchKeys: expect.any(Array) }] });

    expect(privacyReject).toHaveBeenCalledTimes(1);
    expect(controlClicks.map((click) => click.mock.calls.length)).toEqual([1, 1, 1]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects Astellas controls that alias the same declared partition", async () => {
    const sourceId = "source-astellas-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    const failure = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => astellasBrowser({
        entryUrl,
        close,
        controlClicks: [vi.fn(), vi.fn(), vi.fn()],
        controlIds: ["panel-1", "panel-1", "panel-3"]
      })
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("share a partition");
    expect(classifyBGradeIndependentTraversalFailure(failure)).toBe("B_GRADE_PARTITION_DECLARATION_FAILED");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not misclassify an active Astellas abort as a partition-proof failure", async () => {
    const sourceId = "source-astellas-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const controller = new AbortController();
    const reason = new Error("stop Astellas traversal");
    const close = vi.fn(async () => undefined);
    const failure = await capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      signal: controller.signal,
      launchBrowser: async () => astellasBrowser({
        entryUrl,
        close,
        controlClicks: [vi.fn(async () => { controller.abort(reason); throw reason; }), vi.fn(), vi.fn()]
      })
    }).catch((error: unknown) => error);

    expect(failure).toBe(reason);
    expect(classifyBGradeIndependentTraversalFailure(failure)).toBe("B_GRADE_VALIDATOR_ABORTED");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes exactly once on active abort and releases the browser permit", async () => {
    const sourceId = "source-otsuka-china-social-2" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const controller = new AbortController();
    const abortReason = new Error("stop rendered traversal");
    const close = vi.fn(async () => undefined);
    const browser = staticBrowser({
      entryUrl,
      rawRows: [["Role One", "Shanghai"]],
      close,
      onGoto: () => controller.abort(abortReason)
    });

    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      signal: controller.signal,
      launchBrowser: async () => browser
    })).rejects.toBe(abortReason);
    expect(close).toHaveBeenCalledTimes(1);

    const followupClose = vi.fn(async () => undefined);
    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => staticBrowser({
        entryUrl,
        rawRows: [["Role Two", "Shanghai"]],
        close: followupClose
      })
    })).resolves.toMatchObject({ pages: [{ nextControlPresent: false }] });
    expect(followupClose).toHaveBeenCalledTimes(1);
  });

  it("fails closed for navigation failure and multiple active next controls", async () => {
    const staticSourceId = "source-otsuka-china-social-2" as const;
    const staticEntry = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[staticSourceId].entryUrl;
    const failedClose = vi.fn(async () => undefined);
    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId: staticSourceId,
      entryUrl: staticEntry,
      launchBrowser: async () => staticBrowser({
        entryUrl: staticEntry,
        rawRows: [["Role", "Shanghai"]],
        close: failedClose,
        navigation: null
      })
    })).rejects.toThrow("navigation failed");
    expect(failedClose).toHaveBeenCalledTimes(1);

    const novartisSourceId = "source-novartis-social" as const;
    const novartisEntry = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[novartisSourceId].entryUrl;
    const multipleClose = vi.fn(async () => undefined);
    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId: novartisSourceId,
      entryUrl: novartisEntry,
      launchBrowser: async () => novartisBrowser({
        entryUrl: novartisEntry,
        rowsByPage: [[officialNovartisUrl("a")]],
        close: multipleClose,
        activeNextCount: 2
      })
    })).rejects.toThrow("multiple active next controls");
    expect(multipleClose).toHaveBeenCalledTimes(1);
  });
});

function staticBrowser(input: {
  entryUrl: string;
  rawRows: string[][];
  close: () => Promise<void>;
  navigation?: ReturnType<typeof response> | null;
  onGoto?: () => void;
}) {
  const page = {
    goto: async () => {
      input.onGoto?.();
      return input.navigation === undefined ? response(input.entryUrl) : input.navigation;
    },
    close: async () => undefined,
    url: () => input.entryUrl,
    locator: (selector: string) => ({
      first: () => ({ waitFor: async () => undefined }),
      count: async () => selector.includes("pagination") || selector.includes("[data-page]") ? 0 : 1,
      evaluateAll: async () => input.rawRows
    })
  };
  return { newPage: async () => page as never, close: input.close };
}

function novartisBrowser(input: {
  entryUrl: string;
  rowsByPage: string[][];
  close: () => Promise<void>;
  activeNextCount?: number;
}) {
  let pageIndex = 0;
  const pageUrl = () => pageIndex === 0 ? input.entryUrl : `${input.entryUrl}?page=${pageIndex}`;
  const nextItem = {
    getAttribute: async (name: string) => name === "href" ? `?page=${pageIndex + 1}` : null,
    click: async () => { pageIndex += 1; }
  };
  const page = {
    goto: async () => response(input.entryUrl),
    url: pageUrl,
    waitForURL: async (predicate: (url: URL) => boolean) => new Promise<void>((resolve, reject) => {
      setTimeout(() => predicate(new URL(pageUrl())) ? resolve() : reject(new Error("URL did not change")), 0);
    }),
    locator: (selector: string) => selector === PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-novartis-social"].rowSelector
      ? { evaluateAll: async () => input.rowsByPage[pageIndex] }
      : selector === PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-novartis-social"].nextSelector
        ? {
            count: async () => input.activeNextCount ?? (pageIndex < input.rowsByPage.length - 1 ? 1 : 0),
            nth: () => nextItem,
            first: () => nextItem
          }
        : { first: () => ({ waitFor: async () => undefined }) }
  };
  return { newPage: async () => page as never, close: input.close };
}

function pagedOfficialBrowser(input: {
  sourceId: "source-fosun-pharma-social" | "source-kelun-social" | "source-tongrentang-social";
  pageUrls: string[];
  rowUrls: string[][];
  close: () => Promise<void>;
}) {
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[input.sourceId];
  let pageIndex = 0;
  const nextItem = {
    getAttribute: async (name: string) => name === "href"
      ? input.pageUrls[Math.min(pageIndex + 1, input.pageUrls.length - 1)]!
      : null,
    click: async () => { pageIndex += 1; }
  };
  const page = {
    goto: async () => response(input.pageUrls[0]!),
    url: () => input.pageUrls[pageIndex]!,
    waitForURL: async (predicate: (url: URL) => boolean) => new Promise<void>((resolve, reject) => {
      setTimeout(() => predicate(new URL(input.pageUrls[pageIndex]!))
        ? resolve()
        : reject(new Error("URL did not change")), 0);
    }),
    locator: (selector: string) => selector === policy.rowSelector
      ? { evaluateAll: async () => input.rowUrls[pageIndex], first: () => ({ waitFor: async () => undefined }) }
      : selector === policy.nextSelector
        ? { count: async () => 1, nth: () => nextItem, first: () => nextItem }
        : { first: () => ({ waitFor: async () => undefined }) }
  };
  return { newPage: async () => page as never, close: input.close };
}

function astellasBrowser(input: {
  entryUrl: string;
  close: () => Promise<void>;
  controlClicks: Array<ReturnType<typeof vi.fn>>;
  controlIds?: string[];
  initialExpanded?: boolean[];
  privacyReject?: () => Promise<void>;
  privacyOverlayAppearsOnFirstControlClick?: boolean;
}) {
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-astellas-china-social"];
  let currentUrl = input.entryUrl;
  const urls = ["role-one", "role-two", "role-three"].map((id) =>
    `https://www.astellas.com/content/dam/astellas-com/global/zh/careers/${id}.pdf`);
  const expanded = input.controlClicks.map((_, index) => input.initialExpanded?.[index] ?? false);
  let privacyOverlayVisible = input.privacyReject !== undefined &&
    input.privacyOverlayAppearsOnFirstControlClick !== true;
  let latePrivacyOverlayTriggered = false;
  const controls = input.controlClicks.map((click, index) => ({
    getAttribute: async (name: string) => name === "aria-controls"
      ? input.controlIds?.[index] ?? `panel-${index + 1}`
      : name === "aria-expanded" ? String(expanded[index]) : null,
    click: async () => {
      if (input.privacyOverlayAppearsOnFirstControlClick && !latePrivacyOverlayTriggered) {
        latePrivacyOverlayTriggered = true;
        privacyOverlayVisible = true;
      }
      if (privacyOverlayVisible) throw new Error("privacy overlay intercepted the partition click");
      await click();
      expanded[index] = true;
      currentUrl = `${input.entryUrl}#section-accordion-c88601411d-${index}`;
    }
  }));
  const page = {
    goto: async () => response(input.entryUrl),
    url: () => currentUrl,
    waitForFunction: async () => undefined,
    evaluate: async (_callback: unknown, value: string) => {
      if (value === input.entryUrl) currentUrl = input.entryUrl;
      return true;
    },
    locator: (selector: string) => selector === policy.revealSelector
      ? {
          count: async () => controls.length,
          first: () => ({ waitFor: async () => undefined }),
          nth: (index: number) => controls[index],
          evaluateAll: async () => ({ controlled: 3, global: 3 })
        }
      : selector === "#onetrust-reject-all-handler"
        ? {
            count: async () => input.privacyReject ? 1 : 0,
            isVisible: async () => privacyOverlayVisible,
            click: async () => {
              await input.privacyReject?.();
              privacyOverlayVisible = false;
            }
          }
        : selector === "#onetrust-consent-sdk"
          ? { waitFor: async () => {
              if (privacyOverlayVisible) throw new Error("privacy overlay remained visible");
            } }
      : selector === policy.rowSelector
        ? { evaluateAll: async () => urls }
        : selector.startsWith("[id=")
          ? {
              count: async () => 1,
              evaluateAll: async () => {
                const panel = /panel-(\d)/u.exec(selector)?.[1];
                return panel ? [urls[Number(panel) - 1]] : [];
              }
            }
          : selector === policy.nextSelector
            ? { count: async () => 0 }
            : { first: () => ({ waitFor: async () => undefined }) }
  };
  return { newPage: async () => page as never, close: input.close };
}

function talentbrewBrowser(input: {
  entryUrl: string;
  close: () => Promise<void>;
  extraPartitionId?: string;
  onGoto?: () => void;
  pageClose?: () => Promise<void>;
}) {
  const sourceId = "source-sanofi-china-social" as const;
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId];
  const partitions = [
    { id: "Fixed Term (Fixed Term)", pages: [["81001", "81002"], ["81003"]] },
    { id: "Regular", pages: [["82001"]] }
  ];
  const excludedIds = ["Apprentice/Intern (Fixed Term)", "Student (Fixed Term)"];
  let partitionIndex = -1;
  let pageIndex = 0;
  const currentIds = () => partitionIndex < 0 ? ["79999"] : partitions[partitionIndex]!.pages[pageIndex]!;
  const partitionForSelector = (selector: string) => partitions.findIndex(({ id }) => selector.includes(JSON.stringify(id)));
  const allIds = [...partitions.map(({ id }) => id), ...excludedIds,
    ...(input.extraPartitionId ? [input.extraPartitionId] : [])];
  const page = {
    goto: async () => {
      partitionIndex = -1;
      pageIndex = 0;
      input.onGoto?.();
      return response(input.entryUrl);
    },
    close: input.pageClose ?? (async () => undefined),
    url: () => input.entryUrl,
    waitForLoadState: async () => undefined,
    waitForFunction: async () => undefined,
    waitForResponse: async (predicate: (candidate: ReturnType<typeof ajaxResponse>) => boolean) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const selected = partitions[Math.max(0, partitionIndex)]!;
      const url = new URL("/results", input.entryUrl);
      url.searchParams.set("FacetFilters[1].ID", selected.id);
      url.searchParams.set("FacetFilters[1].FacetType", "5");
      url.searchParams.set("FacetFilters[1].Display", selected.id);
      url.searchParams.set("FacetFilters[1].IsApplied", "true");
      url.searchParams.set("FacetFilters[1].FieldName", "job_type");
      const candidate = ajaxResponse(url.toString());
      if (!predicate(candidate)) throw new Error("Response predicate rejected the TalentBrew fixture");
      return candidate;
    },
    locator: (selector: string) => {
      if (selector === policy.rowSelector) {
        return {
          evaluateAll: async (callback: unknown) => String(callback).includes("key.kind")
            ? currentIds().map((id) => `https://jobs.sanofi.com/en/job/shanghai/role/2649/${id}`)
            : currentIds()
        };
      }
      if (selector === policy.nextSelector) {
        const next = { evaluate: async () => { pageIndex += 1; } };
        return {
          count: async () => partitionIndex >= 0 && pageIndex < partitions[partitionIndex]!.pages.length - 1 ? 1 : 0,
          first: () => next
        };
      }
      if (selector === "#search-results") {
        return {
          first: () => ({ waitFor: async () => undefined }),
          count: async () => 1,
          getAttribute: async (name: string) => name === "data-current-page"
            ? String(pageIndex + 1)
            : name === "data-total-pages"
              ? String(partitionIndex < 0 ? 1 : partitions[partitionIndex]!.pages.length)
              : name === "data-total-job-results"
                ? String(partitionIndex < 0 ? 4 : partitions[partitionIndex]!.pages.flat().length)
                : name === "data-ajax-url"
                  ? "/results"
                  : name === "data-facet-term"
                    ? "1814991"
                    : name === "data-facet-type"
                      ? "2"
                : null
        };
      }
      if (selector.includes('[data-field-name="job_type"]') && !selector.includes("data-id=")) {
        return { first: () => ({ waitFor: async () => undefined }), evaluateAll: async () => [...allIds].sort() };
      }
      const selected = partitionForSelector(selector);
      if (selected >= 0) {
        return {
          count: async () => 1,
          isChecked: async () => false,
          getAttribute: async (name: string) => name === "data-display"
            ? partitions[selected]!.id
            : name === "data-count"
              ? String(partitions[selected]!.pages.flat().length)
              : null,
          evaluate: async () => { partitionIndex = selected; pageIndex = 0; }
        };
      }
      if (excludedIds.some((id) => selector.includes(JSON.stringify(id)))) {
        const id = excludedIds.find((value) => selector.includes(JSON.stringify(value)))!;
        return { count: async () => 1, isChecked: async () => false,
          getAttribute: async (name: string) => name === "data-display" ? id : name === "data-count" ? "0" : null };
      }
      return { first: () => ({ waitFor: async () => undefined }) };
    }
  };
  return { newPage: async () => page as never, close: input.close };
}

function response(url: string) {
  return { status: () => 200, url: () => url };
}

function ajaxResponse(url: string) {
  return { status: () => 200, url: () => url, request: () => ({ method: () => "GET" }),
    finished: async () => null };
}

function syntheticKey(sourceId: string, parts: readonly string[]): string {
  return `${sourceId}:html:sha256:${createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex")}`;
}

function officialNovartisUrl(id: string): string {
  return `https://prod1.novartis.com/careers/career-search/job/details/${id}`;
}

function officialKey(sourceId: string, id: string): string {
  return `${sourceId}:${officialNovartisUrl(id)}`;
}
