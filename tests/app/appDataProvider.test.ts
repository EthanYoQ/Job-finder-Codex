import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_DIRECTORY_PAGE_SIZE,
  createDemoAppDataProvider,
  createHttpAppDataProvider
} from "../../src/app/appDataProvider";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3Members";
import { getStaticDocument } from "../../src/server/staticDocuments";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createHttpAppDataProvider", () => {
  it("maps frontend search filters to the consent-gated server API contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ companies: [], totalJobs: 0, lastUpdatedAt: null })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await createHttpAppDataProvider().searchJobs({
      city: "北京",
      keyword: "MSL",
      categories: ["市场准入/政府事务"],
      onlyNew: true,
      sort: "LATEST"
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const parsedUrl = new URL(String(url), "https://job.orz.md");

    expect(parsedUrl.pathname).toBe("/api/search");
    expect(parsedUrl.searchParams.get("city")).toBe("北京");
    expect(parsedUrl.searchParams.get("keyword")).toBe("MSL");
    expect(parsedUrl.searchParams.get("categories")).toBe("市场准入/政府事务");
    expect(parsedUrl.searchParams.get("newWithinDays")).toBe("7");
    expect(parsedUrl.searchParams.get("sort")).toBe("LATEST_POSTED");
    expect(init).toMatchObject({
      headers: { "x-job-search-consent": "accepted" }
    });
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
