import { describe, expect, it } from "vitest";
import { parseManualCrawlWorkerArgs } from "../../src/crawler/manualCrawlWorkerCli";

describe("manual crawl worker CLI", () => {
  it("defaults to a continuous worker and supports a drain-until-idle run", () => {
    expect(parseManualCrawlWorkerArgs([])).toEqual({ help: false, stopWhenIdle: false });
    expect(parseManualCrawlWorkerArgs(["--once"])).toEqual({ help: false, stopWhenIdle: true });
    expect(parseManualCrawlWorkerArgs(["--help"])).toEqual({ help: true, stopWhenIdle: false });
  });

  it("rejects unknown arguments instead of silently changing worker behavior", () => {
    expect(() => parseManualCrawlWorkerArgs(["--source-id", "source-1"]))
      .toThrow("Unknown manual crawl worker argument");
  });
});
