import { describe, expect, it, vi } from "vitest";
import { handlePublicApi } from "../../src/server/publicApi";

describe("public API route policy", () => {
  it("does not load job search before consent and marks internal APIs noindex", async () => {
    const deps = {
      db: {
        job: { findMany: vi.fn() },
        crawlObservation: { findFirst: vi.fn() },
        company: { findMany: vi.fn(async () => []) },
        feedback: { create: vi.fn() },
        recommendedCompany: { create: vi.fn() }
      },
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
});
