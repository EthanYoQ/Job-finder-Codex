import { describe, expect, it } from "vitest";
import {
  checkRateLimit,
  classifySuspiciousRequest,
  createMemoryRateLimitStore
} from "../../src/server/rateLimit";

describe("rate limit and suspicious request policy", () => {
  it("allows normal browsing and blocks bursts over the configured window", () => {
    const store = createMemoryRateLimitStore();
    const base = { key: "ip:1.2.3.4", now: new Date("2026-07-08T00:00:00.000Z"), windowMs: 60_000, max: 3 };

    expect(checkRateLimit(base, store).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: new Date("2026-07-08T00:00:10.000Z") }, store).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: new Date("2026-07-08T00:00:20.000Z") }, store).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: new Date("2026-07-08T00:00:30.000Z") }, store)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
      remaining: 0
    });
  });

  it("challenges bulk-looking requests without challenging document routes", () => {
    expect(classifySuspiciousRequest({ path: "/privacy", query: {}, userAgent: "Mozilla/5.0" }).action).toBe(
      "ALLOW"
    );
    expect(
      classifySuspiciousRequest({
        path: "/api/search",
        query: { limit: "500", offset: "5000" },
        userAgent: "python-requests/2.31"
      }).action
    ).toBe("CHALLENGE");
  });
});
