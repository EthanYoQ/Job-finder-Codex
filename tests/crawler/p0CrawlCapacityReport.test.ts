import { describe, expect, it } from "vitest";
import { estimateCrawlCapacity } from "../../scripts/p0-crawl-capacity-report";

describe("p0 crawl capacity report", () => {
  it("estimates twice-daily capacity for HTTP and browser-backed sources", () => {
    expect(
      estimateCrawlCapacity({
        sourceCount: 50,
        httpSourceCount: 45,
        browserSourceCount: 5,
        httpConcurrency: 6,
        browserConcurrency: 1,
        avgHttpSeconds: 8,
        avgBrowserSeconds: 45
      })
    ).toEqual({
      sourceCount: 50,
      estimatedOnePassSeconds: 289,
      estimatedTwiceDailySeconds: 578,
      notes: [
        "HTTP/API sources are estimated in 8 batches at concurrency 6.",
        "Browser fallback sources are estimated in 5 batches at concurrency 1."
      ]
    });
  });
});
