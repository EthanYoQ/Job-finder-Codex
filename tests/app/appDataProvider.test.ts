import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_DIRECTORY_PAGE_SIZE,
  createDemoAppDataProvider,
  createHttpAppDataProvider
} from "../../src/app/appDataProvider";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3Members";
import { handlePublicApi } from "../../src/server/publicApi";
import { readPortablePublicSnapshot, type PortableSnapshotDb } from "../../src/db/portablePublicSnapshotRepository";
import { accepted, job, plan, NOW } from "../helpers/portablePublicSnapshotFixture";
import { getStaticDocument } from "../../src/server/staticDocuments";
import { createMemoryRateLimitStore } from "../../src/server/rateLimit";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createHttpAppDataProvider", () => {
  it("forwards snapshot status and cancellation to both read endpoints", async () => {
    const snapshotRefresh = { state: "UPDATING", version: "opaque-version", check: "signed-check" };
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ snapshotRefresh }));
    globalThis.fetch = fetchMock;
    const provider = createHttpAppDataProvider();
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const request = { city: "北京", keyword: "", categories: [], onlyNew: false, sort: "PINYIN_ASC" as const };

    expect((await provider.searchJobs(request, options)).snapshotRefresh).toEqual(snapshotRefresh);
    expect((await provider.listCoverage({ keyword: "" }, options)).snapshotRefresh).toEqual(snapshotRefresh);
    expect(fetchMock.mock.calls.map(([, init]) => init?.signal)).toEqual([controller.signal, controller.signal]);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("x-job-snapshot-check"))).toEqual([null, null]);
    await provider.searchJobs(request, { ...options, snapshotCheck: snapshotRefresh.check });
    await provider.listCoverage({ keyword: "" }, { ...options, snapshotCheck: snapshotRefresh.check });
    expect(fetchMock.mock.calls.slice(2).map(([, init]) => new Headers(init?.headers).get("x-job-snapshot-check")))
      .toEqual([snapshotRefresh.check, snapshotRefresh.check]);
    controller.abort();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it.each(["search", "coverage"] as const)("carries the %s check and response barrier through the public API", async endpoint => {
    const evidence = accepted();
    const tx = {
      crawlBatchSourceResult: { findMany: async () => [evidence.result] },
      lifecycleSetEvidenceMember: { findMany: async () => evidence.members },
      job: { findMany: async () => [job()] }
    };
    const snapshot = await readPortablePublicSnapshot({ $transaction: async work => work(tx) } as PortableSnapshotDb, { currentTime: NOW }, [plan]);
    const responseFinished = new Promise<void>(() => {});
    const readWithStatus = vi.fn(async (_responseFinished?: Promise<void>, check?: string) => ({
      snapshot,
      snapshotRefresh: { state: check === undefined ? "UPDATING" as const : "FAILED" as const, version: "display-v1", check: "signed-check" }
    }));
    const read = Object.assign(vi.fn(async () => snapshot), { readWithStatus });
    const rateLimitStore = createMemoryRateLimitStore();
    globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), "https://example.test");
      const result = await handlePublicApi({
        method: "GET", path: url.pathname, query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(new Headers(init?.headers)), body: undefined, ip: "127.0.0.99"
      }, { db: {} as never, checkDatabaseReadiness: async () => true, responseFinished, readPortableSnapshot: read, rateLimitStore });
      return { ok: result.status === 200, status: result.status, json: async () => result.body } as Response;
    });
    const provider = createHttpAppDataProvider();
    const request = (snapshotCheck?: string) => {
      const options = snapshotCheck === undefined ? {} : { snapshotCheck };
      return endpoint === "search"
        ? provider.searchJobs({ city: "北京", keyword: "", categories: [], onlyNew: false, sort: "PINYIN_ASC" }, options)
        : provider.listCoverage({ keyword: "" }, options);
    };
    const initial = await request();
    expect(initial.snapshotRefresh).toEqual({ state: "UPDATING", version: "display-v1", check: "signed-check" });
    const followUp = await request(initial.snapshotRefresh?.check);
    expect(followUp.snapshotRefresh).toEqual({ state: "FAILED", version: "display-v1", check: "signed-check" });
    expect(followUp.companies).toEqual(initial.companies);
    expect(readWithStatus).toHaveBeenNthCalledWith(1, responseFinished, undefined);
    expect(readWithStatus).toHaveBeenNthCalledWith(2, responseFinished, "signed-check");
    expect(read).not.toHaveBeenCalled();
  });

  it("maps frontend search filters to the consent-gated server API contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ companies: [], totalJobs: 0, lastUpdatedAt: null })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await createHttpAppDataProvider().searchJobs({
      province: "四川",
      city: "成都",
      keyword: "MSL",
      categories: ["市场准入/政府事务"],
      onlyNew: true,
      sort: "LATEST"
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const parsedUrl = new URL(String(url), "https://job.orz.md");

    expect(parsedUrl.pathname).toBe("/api/search");
    expect(parsedUrl.searchParams.get("province")).toBe("四川");
    expect(parsedUrl.searchParams.get("city")).toBe("成都");
    expect(parsedUrl.searchParams.get("keyword")).toBe("MSL");
    expect(parsedUrl.searchParams.get("categories")).toBe("市场准入/政府事务");
    expect(parsedUrl.searchParams.get("newWithinDays")).toBe("7");
    expect(parsedUrl.searchParams.get("sort")).toBe("LATEST_POSTED");
    expect(init).toMatchObject({
      headers: { "x-job-search-consent": "accepted" }
    });
  });

  it("carries the pending view and scoped counts through the HTTP API from the checked snapshot", async () => {
    const a = accepted();
    const tx = {
      crawlBatchSourceResult: { findMany: async () => [a.result] },
      lifecycleSetEvidenceMember: { findMany: async () => a.members },
      job: { findMany: async () => [{ ...job(), city: '中国', cities: ['中国'], locationRaw: 'China' }] }
    };
    const snapshot = await readPortablePublicSnapshot({ $transaction: async work => work(tx) } as PortableSnapshotDb, { currentTime: NOW }, [plan]);
    globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input), 'https://example.test');
      const result = await handlePublicApi({
        method: 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(new Headers(init?.headers)), body: undefined, ip: '127.0.0.99'
      }, { db: {} as never, checkDatabaseReadiness: async () => true, readPortableSnapshot: async () => snapshot });
      return { ok: result.status === 200, status: result.status, json: async () => result.body } as Response;
    });
    const provider = createHttpAppDataProvider();
    expect(provider.supportsCityPendingSearch).toBe(true);
    const result = await provider.searchJobs({ city: '城市待核', keyword: '', categories: [], onlyNew: false, sort: 'PINYIN_ASC' });
    expect(result.totalJobs).toBe(1);
    expect(result.publishedJobSummary).toEqual({ totalJobs: 1, cityPendingJobs: 1 });
    expect(result.cityFacets).toEqual(expect.arrayContaining([
      { city: '全国', province: null, jobCount: 0 }, { city: '城市待核', province: null, jobCount: 1 }
    ]));
    expect(result.companies[0]!.jobs[0]).toMatchObject({ city: '中国', cityPending: true, locationRaw: 'China' });
  });

  it("requests the complete canonical 60-company directory in one production call", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ companies: [], offset: 0, limit: 60, hasMore: false })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await createHttpAppDataProvider().listCoverage({ keyword: "" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const parsedUrl = new URL(String(url), "https://example.test");
    expect(COMPANY_DIRECTORY_PAGE_SIZE).toBe(confirmedCompanyRosterV3Members.length);
    expect(parsedUrl.pathname).toBe("/api/coverage");
    expect(parsedUrl.searchParams.get("offset")).toBe("0");
    expect(parsedUrl.searchParams.get("limit")).toBe("60");
    expect(init).toMatchObject({ headers: { "x-job-search-consent": "accepted" } });
  });

  it("reads privacy and terms as document text from public routes", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => textResponse("隐私说明\n\n正文"));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(createHttpAppDataProvider().getDocument("privacy")).resolves.toEqual({
      slug: "privacy",
      title: "隐私说明",
      body: "隐私说明\n\n正文"
    });

    expect(fetchMock).toHaveBeenCalledWith("/privacy");
  });

  it("omits consent only for privacy feedback and keeps it for ordinary feedback", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ id: "receipt-1", status: "OPEN" }));
    globalThis.fetch = fetchMock as typeof fetch;
    const provider = createHttpAppDataProvider();
    await provider.submitFeedback({ issueType: "PRIVACY_EXPORT", contact: "user@example.cn", description: "export" });
    await provider.submitFeedback({ issueType: "链接不可用", description: "broken", companyId: "c1" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ "content-type": "application/json" });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "content-type": "application/json", "x-job-search-consent": "accepted"
    });
  });
});

describe("createDemoAppDataProvider", () => {
  it("uses the canonical privacy document instead of a drifting demo copy", async () => {
    await expect(createDemoAppDataProvider().getDocument("privacy")).resolves.toEqual(
      getStaticDocument("privacy")
    );
  });

  it("rejects the legacy all-locations sentinel while retaining a concrete-city search", async () => {
    const provider = createDemoAppDataProvider();
    const request = {
      keyword: "",
      categories: [],
      onlyNew: false,
      sort: "PINYIN_ASC" as const
    };

    await expect(provider.searchJobs({ ...request, city: "全部地点" })).rejects.toThrow();
    await expect(provider.searchJobs({ ...request, city: "北京" })).resolves.toMatchObject({
      totalJobs: expect.any(Number)
    });
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response;
}

function textResponse(body: string): Response {
  return {
    ok: true,
    text: async () => body
  } as Response;
}
