import { describe, expect, it, vi } from "vitest";
import { handlePublicApi } from "../../src/server/publicApi";

describe("public API route policy", () => {
  it.each([Number.NaN, -100])("normalizes invalid readiness timeout %s to the shared default", async (readinessTimeoutMs) => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const responsePromise = handlePublicApi(
        {
          method: "GET",
          path: "/healthz",
          query: {},
          headers: {},
          body: undefined,
          ip: "127.0.0.1"
        },
        {
          db: {} as never,
          checkDatabaseReadiness: () => new Promise<boolean>(() => undefined),
          readinessTimeoutMs
        }
      ).then((response) => {
        settled = true;
        return response;
      });

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2_499);
      await expect(responsePromise).resolves.toMatchObject({ status: 503, body: { ok: false } });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["false", async () => false],
    ["throw", async () => { throw new Error("secret database detail"); }],
    ["timeout", () => new Promise<boolean>(() => undefined)]
  ])("fails health closed without leaking database details when readiness returns %s", async (_name, checkDatabaseReadiness) => {
    const startedAt = Date.now();
    const response = await handlePublicApi(
      {
        method: "GET",
        path: "/healthz",
        query: {},
        headers: {},
        body: undefined,
        ip: "127.0.0.1"
      },
      {
        db: {} as never,
        checkDatabaseReadiness,
        readinessTimeoutMs: 25
      }
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ ok: false });
    expect(JSON.stringify(response.body)).not.toContain("secret database detail");
  });

  it("does not load job search before consent and marks internal APIs noindex", async () => {
    const deps = {
      db: {
        job: { findMany: vi.fn() },
        crawlObservation: { findFirst: vi.fn() },
        company: { findMany: vi.fn(async () => []) },
        feedback: { create: vi.fn() },
        recommendedCompany: { create: vi.fn() }
      },
      checkDatabaseReadiness: async () => true,
      now: () => new Date("2026-07-08T00:00:00.000Z")
    };

    const blocked = await handlePublicApi(
      {
        method: "GET",
        path: "/api/search",
        query: { city: "北京" },
        headers: {},
        body: undefined,
        ip: "1.2.3.4"
      },
      deps
    );

    expect(blocked.status).toBe(403);
    expect(blocked.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(deps.db.job.findMany).not.toHaveBeenCalled();
  });

  it("returns paginated coverage results with a hard cap", async () => {
    const deps = {
      db: {
        job: { findMany: vi.fn() },
        crawlObservation: { findFirst: vi.fn() },
        company: {
          findMany: vi.fn(async () =>
            Array.from({ length: 80 }, (_, index) => ({
              id: `company-${index + 1}`,
              officialChineseName: `药企 ${index + 1}`,
              officialWebsiteUrl: `https://example.com/${index + 1}`,
              pinyinName: `company ${String(index + 1).padStart(2, "0")}`
            }))
          )
        },
        feedback: { create: vi.fn() },
        recommendedCompany: { create: vi.fn() }
      },
      checkDatabaseReadiness: async () => true,
      now: () => new Date("2026-07-08T00:00:00.000Z")
    };

    const response = await handlePublicApi(
      {
        method: "GET",
        path: "/api/coverage",
        query: { keyword: "", offset: "5", limit: "50" },
        headers: { "x-job-search-consent": "accepted" },
        body: undefined,
        ip: "1.2.3.4"
      },
      deps
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      offset: 5,
      limit: 50,
      hasMore: true
    });
    expect((response.body as { companies: unknown[] }).companies).toHaveLength(50);
  });

  it("returns 400 for invalid bulk pagination before suspicious request challenge", async () => {
    const deps = {
      db: {
        job: { findMany: vi.fn() },
        crawlObservation: { findFirst: vi.fn() },
        company: { findMany: vi.fn(async () => []) },
        feedback: { create: vi.fn() },
        recommendedCompany: { create: vi.fn() }
      },
      checkDatabaseReadiness: async () => true,
      now: () => new Date("2026-07-08T00:00:00.000Z")
    };

    const response = await handlePublicApi(
      {
        method: "GET",
        path: "/api/search",
        query: { city: "北京", limit: "500", offset: "5000" },
        headers: { "x-job-search-consent": "accepted", "user-agent": "python-requests/2.31" },
        body: undefined,
        ip: "1.2.3.4"
      },
      deps
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "INVALID_REQUEST" });
    expect(deps.db.job.findMany).not.toHaveBeenCalled();
  });

  it("caps search companies and per-company jobs at the API layer", async () => {
    const deps = {
      db: {
        job: {
          findMany: vi.fn(async () =>
            Array.from({ length: 60 }, (_, companyIndex) =>
              Array.from({ length: 12 }, (_, jobIndex) => ({
                id: `job-${companyIndex + 1}-${jobIndex + 1}`,
                companyId: `company-${companyIndex + 1}`,
                officialTitle: `Role ${jobIndex + 1}`,
                auxiliaryChineseTitle: null,
                officialUrl: `https://example.com/${companyIndex + 1}/${jobIndex + 1}`,
                officialPublishedAt: new Date(`2026-07-${String((jobIndex % 9) + 1).padStart(2, "0")}T00:00:00.000Z`),
                city: "北京",
                cities: ["北京"],
                category: "SALES",
                isNew: false,
                company: {
                  id: `company-${companyIndex + 1}`,
                  officialChineseName: `药企 ${companyIndex + 1}`,
                  pinyinName: `company ${String(companyIndex + 1).padStart(2, "0")}`
                }
              }))
            ).flat()
          )
        },
        crawlObservation: {
          findFirst: vi.fn(async () => ({ crawledAt: new Date("2026-07-08T00:00:00.000Z") }))
        },
        company: { findMany: vi.fn(async () => []) },
        feedback: { create: vi.fn() },
        recommendedCompany: { create: vi.fn() }
      },
      checkDatabaseReadiness: async () => true,
      now: () => new Date("2026-07-08T00:00:00.000Z")
    };

    const response = await handlePublicApi(
      {
        method: "GET",
        path: "/api/search",
        query: { city: "北京", offset: "5", limit: "50" },
        headers: { "x-job-search-consent": "accepted" },
        body: undefined,
        ip: "1.2.3.4"
      },
      deps
    );

    expect(response.status).toBe(200);
    expect((response.body as { companies: Array<{ jobs: unknown[] }> }).companies).toHaveLength(50);
    expect((response.body as { companies: Array<{ jobs: unknown[] }> }).companies[0]?.jobs).toHaveLength(10);
    expect(
      (response.body as { companies: Array<{ id: string }> }).companies.map((company) => company.id).slice(0, 3)
    ).toEqual(["company-6", "company-7", "company-8"]);
  });

  it("returns 400 for malformed feedback and recommend-company bodies", async () => {
    const deps = {
      db: {
        job: { findMany: vi.fn() },
        crawlObservation: { findFirst: vi.fn() },
        company: { findMany: vi.fn(async () => []) },
        feedback: { create: vi.fn() },
        recommendedCompany: { create: vi.fn() }
      },
      checkDatabaseReadiness: async () => true,
      now: () => new Date("2026-07-08T00:00:00.000Z")
    };

    const feedbackResponse = await handlePublicApi(
      {
        method: "POST",
        path: "/api/feedback",
        query: {},
        headers: { "x-job-search-consent": "accepted" },
        body: "bad payload",
        ip: "1.2.3.4"
      },
      deps
    );

    const companyResponse = await handlePublicApi(
      {
        method: "POST",
        path: "/api/recommend-company",
        query: {},
        headers: { "x-job-search-consent": "accepted" },
        body: { companyName: "", officialWebsiteUrl: 123 },
        ip: "1.2.3.4"
      },
      deps
    );

    expect(feedbackResponse.status).toBe(400);
    expect(companyResponse.status).toBe(400);
    expect(deps.db.feedback.create).not.toHaveBeenCalled();
    expect(deps.db.recommendedCompany.create).not.toHaveBeenCalled();
  });
});
