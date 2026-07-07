import { describe, expect, it } from "vitest";
import {
  isSourceDueForScheduledRun,
  nextP0CrawlWindow,
  P0_CRAWL_WINDOWS,
  type SourceScheduleState
} from "../../src/crawler/schedule";

function sourceState(overrides: Partial<SourceScheduleState> = {}): SourceScheduleState {
  return {
    sourceId: "source-test-social",
    consecutiveFailureCount: 0,
    ...overrides
  };
}

describe("twice-daily P0 crawl schedule policy", () => {
  it("uses 08:00 and 20:00 China time as default P0 windows", () => {
    expect(P0_CRAWL_WINDOWS).toEqual(["08:00", "20:00"]);

    expect(nextP0CrawlWindow(new Date("2026-07-07T23:59:59.999Z"))).toEqual({
      label: "08:00",
      startsAt: "2026-07-08T00:00:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-07-08T00:00:00.000Z"))).toEqual({
      label: "20:00",
      startsAt: "2026-07-08T12:00:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-07-08T01:00:00.000Z"))).toEqual({
      label: "20:00",
      startsAt: "2026-07-08T12:00:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-07-08T12:00:00.000Z"))).toEqual({
      label: "08:00",
      startsAt: "2026-07-09T00:00:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-07-08T13:00:00.000Z"))).toEqual({
      label: "08:00",
      startsAt: "2026-07-09T00:00:00.000Z"
    });
  });

  it("marks sources with no previous successful crawl as due", () => {
    expect(
      isSourceDueForScheduledRun(sourceState(), new Date("2026-07-08T02:00:00.000Z"))
    ).toBe(true);
  });

  it("does not mark sources already successfully crawled in the current window as due", () => {
    const now = new Date("2026-07-08T02:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-08T00:15:00.000Z"
        }),
        now
      )
    ).toBe(false);
  });

  it("treats timezone-less successful crawl strings as invalid schedule evidence", () => {
    const now = new Date("2026-07-08T02:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-08T08:15:00"
        }),
        now
      )
    ).toBe(true);
  });

  it("uses crawl window start boundaries inclusively", () => {
    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-08T00:00:00.000Z"
        }),
        new Date("2026-07-08T00:00:00.000Z")
      )
    ).toBe(false);
    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-08T11:59:59.999Z"
        }),
        new Date("2026-07-08T12:00:00.000Z")
      )
    ).toBe(true);
    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-08T12:00:00.000Z"
        }),
        new Date("2026-07-08T12:00:00.000Z")
      )
    ).toBe(false);
  });

  it("marks sources last successfully crawled before the current window as due", () => {
    const now = new Date("2026-07-08T13:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-08T01:00:00.000Z"
        }),
        now
      )
    ).toBe(true);
  });

  it("keeps sources with three consecutive failures due for retry or attention", () => {
    const now = new Date("2026-07-08T02:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          consecutiveFailureCount: 3,
          lastSuccessfulCrawlAt: "2026-07-08T00:15:00.000Z"
        }),
        now
      )
    ).toBe(true);
  });
});
