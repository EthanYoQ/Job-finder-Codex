import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  capturePlanBoundHtmlRenderedTraversal,
  PLAN_BOUND_HTML_TRAVERSAL_POLICIES
} from "../../src/crawler/planBoundHtmlTraversalValidator";

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

  it("rejects Astellas controls that alias the same declared partition", async () => {
    const sourceId = "source-astellas-china-social" as const;
    const entryUrl = PLAN_BOUND_HTML_TRAVERSAL_POLICIES[sourceId].entryUrl;
    const close = vi.fn(async () => undefined);
    await expect(capturePlanBoundHtmlRenderedTraversal({
      sourceId,
      entryUrl,
      launchBrowser: async () => astellasBrowser({
        entryUrl,
        close,
        controlClicks: [vi.fn(), vi.fn(), vi.fn()],
        controlIds: ["panel-1", "panel-1", "panel-3"]
      })
    })).rejects.toThrow("share a partition");
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

function astellasBrowser(input: {
  entryUrl: string;
  close: () => Promise<void>;
  controlClicks: Array<ReturnType<typeof vi.fn>>;
  controlIds?: string[];
}) {
  const policy = PLAN_BOUND_HTML_TRAVERSAL_POLICIES["source-astellas-china-social"];
  let currentUrl = input.entryUrl;
  const urls = ["role-one", "role-two", "role-three"].map((id) =>
    `https://www.astellas.com/content/dam/astellas-com/global/zh/careers/${id}.pdf`);
  const controls = input.controlClicks.map((click, index) => ({
    getAttribute: async (name: string) => name === "aria-controls"
      ? input.controlIds?.[index] ?? `panel-${index + 1}`
      : null,
    click: async () => {
      await click();
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

function response(url: string) {
  return { status: () => 200, url: () => url };
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
