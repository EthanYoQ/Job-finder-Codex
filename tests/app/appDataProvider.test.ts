import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpAppDataProvider } from "../../src/app/appDataProvider";

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
