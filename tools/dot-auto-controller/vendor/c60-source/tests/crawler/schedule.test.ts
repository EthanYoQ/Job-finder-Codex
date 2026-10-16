import { describe, expect, it } from "vitest";
import {
  isSourceDueForScheduledRun,
  nextP0CrawlWindow,
  nextP0SchedulerWindow,
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

describe("12-hour P0 crawl schedule policy", () => {
  it("uses 00:01 and 12:01 China-time windows with exact boundaries", () => {
    expect(P0_CRAWL_WINDOWS).toEqual(["00:01", "12:01"]);

    expect(nextP0CrawlWindow(new Date("2026-07-07T16:00:59.999Z"))).toEqual({
      label: "00:01",
      startsAt: "2026-07-07T16:01:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-07-07T16:01:00.000Z"))).toEqual({
      label: "12:01",
      startsAt: "2026-07-08T04:01:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-07-07T16:01:00.001Z"))).toEqual({
      label: "12:01",
      startsAt: "2026-07-08T04:01:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-12-31T16:00:59.999Z"))).toEqual({
      label: "00:01",
      startsAt: "2026-12-31T16:01:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-12-31T16:01:00.000Z"))).toEqual({
      label: "12:01",
      startsAt: "2027-01-01T04:01:00.000Z"
    });
    expect(nextP0CrawlWindow(new Date("2026-07-08T04:01:00.000Z"))).toEqual({
      label: "00:01", startsAt: "2026-07-08T16:01:00.000Z"
    });
  });

  it("runs one catch-up after each 12-hour boundary only when that window has no attempt", () => {
    const afterWindow = new Date("2026-07-07T16:02:00.000Z");
    expect(nextP0SchedulerWindow(afterWindow)).toEqual({
      label: "00:01",
      startsAt: "2026-07-07T16:01:00.000Z"
    });
    expect(nextP0SchedulerWindow(afterWindow, new Date("2026-07-07T16:00:59.999Z"))).toEqual({
      label: "00:01",
      startsAt: "2026-07-07T16:01:00.000Z"
    });
    expect(nextP0SchedulerWindow(afterWindow, new Date("2026-07-07T16:01:00.000Z"))).toEqual({
      label: "12:01",
      startsAt: "2026-07-08T04:01:00.000Z"
    });
    expect(nextP0SchedulerWindow(afterWindow, new Date("2026-07-07T16:02:00.000Z"))).toEqual({
      label: "12:01",
      startsAt: "2026-07-08T04:01:00.000Z"
    });
    const afterNoonWindow = new Date("2026-07-08T04:02:00.000Z");
    expect(nextP0SchedulerWindow(afterNoonWindow)).toEqual({
      label: "12:01",
      startsAt: "2026-07-08T04:01:00.000Z"
    });
    expect(nextP0SchedulerWindow(afterNoonWindow, new Date("2026-07-08T04:01:00.000Z"))).toEqual({
      label: "00:01",
      startsAt: "2026-07-08T16:01:00.000Z"
    });
  });

  it("waits for 00:01 before the daily window instead of catching up yesterday", () => {
    expect(nextP0SchedulerWindow(new Date("2026-07-07T16:00:59.999Z"))).toEqual({
      label: "00:01",
      startsAt: "2026-07-07T16:01:00.000Z"
    });
  });

  it("marks sources with no previous successful crawl as due", () => {
    expect(
      isSourceDueForScheduledRun(sourceState(), new Date("2026-07-08T02:00:00.000Z"))
    ).toBe(true);
  });

  it("does not mark sources already successfully crawled in the current window as due", () => {
    const now = new Date("2026-07-07T18:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-07T16:15:00.000Z"
        }),
        now
      )
    ).toBe(false);
  });

  it("treats timezone-less successful crawl strings as invalid schedule evidence", () => {
    const now = new Date("2026-07-07T18:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-08T00:15:00"
        }),
        now
      )
    ).toBe(true);
  });

  it("uses crawl window start boundaries inclusively", () => {
    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-07T16:01:00.000Z"
        }),
        new Date("2026-07-07T16:01:00.000Z")
      )
    ).toBe(false);
    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-07T16:00:59.999Z"
        }),
        new Date("2026-07-07T16:01:00.000Z")
      )
    ).toBe(true);
    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-07T16:01:00.000Z"
        }),
        new Date("2026-07-07T16:01:00.000Z")
      )
    ).toBe(false);
  });

  it("marks sources last successfully crawled before the current window as due", () => {
    const now = new Date("2026-07-08T18:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          lastSuccessfulCrawlAt: "2026-07-07T18:00:00.000Z"
        }),
        now
      )
    ).toBe(true);
  });

  it("keeps sources with three consecutive failures due for retry or attention", () => {
    const now = new Date("2026-07-07T18:00:00.000Z");

    expect(
      isSourceDueForScheduledRun(
        sourceState({
          consecutiveFailureCount: 3,
          lastSuccessfulCrawlAt: "2026-07-07T16:15:00.000Z"
        }),
        now
      )
    ).toBe(true);
  });
});
