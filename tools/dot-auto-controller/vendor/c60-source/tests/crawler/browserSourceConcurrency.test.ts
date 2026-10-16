import { describe, expect, it } from "vitest";
import { acquireBrowserSourcePermit } from "../../src/crawler/browserSourceConcurrency";

describe("browser source concurrency", () => {
  it("admits one browser source at a time and releases the permit after failure cleanup", async () => {
    const events: string[] = [];
    const firstRelease = await acquireBrowserSourcePermit();
    events.push("first-entered");
    const second = acquireBrowserSourcePermit().then((release) => {
      events.push("second-entered");
      release();
    });
    await Promise.resolve();
    expect(events).toEqual(["first-entered"]);
    firstRelease();
    await second;
    expect(events).toEqual(["first-entered", "second-entered"]);
  });
});
