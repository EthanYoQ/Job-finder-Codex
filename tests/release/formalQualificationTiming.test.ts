import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectQualificationPair } from "../../src/release/formalQualificationTiming";

const now = new Date("2026-08-13T00:00:00.000Z");
const batch = (id: string, finishedAt: string | null) => ({
  id, finishedAt: finishedAt === null ? null : new Date(finishedAt)
});

describe("formal qualification receipt CLI pair selection", () => {
  it.each([
    "2026-08-12T18:00:00.000Z",
    "2026-08-12T15:00:00.000Z",
    "2026-08-12T12:00:00.001Z"
  ])("selects the newest valid 6–12 hour pair ending at %s", (finishedAt) => {
    const newest = batch("round-2", now.toISOString());
    const close = batch("too-close", "2026-08-12T20:00:00.000Z");
    const qualified = batch("round-1", finishedAt);
    const older = batch("older-12-hour-round", "2026-08-12T12:00:00.000Z");
    const batches = [newest, close, qualified, older];
    expect(selectQualificationPair(batches, now)).toEqual([newest, qualified]);
    expect(batches).toEqual([newest, close, qualified, older]);
  });

  it("skips a 5:59:59.999 interval and selects the exact six-hour pair", () => {
    const newest = batch("round-2", now.toISOString());
    const tooClose = batch("too-close", "2026-08-12T18:00:00.001Z");
    const qualified = batch("round-1", "2026-08-12T18:00:00.000Z");
    expect(selectQualificationPair([newest, tooClose, qualified], now)).toEqual([newest, qualified]);
  });

  it("selects an exact 72-hour-old candidate but leaves older evidence for fail-closed validation", () => {
    const newest = batch("round-2", now.toISOString());
    const close = batch("too-close", "2026-08-12T20:00:00.000Z");
    const oldestAllowed = batch("round-1", "2026-08-10T00:00:00.000Z");
    expect(selectQualificationPair([newest, close, oldestAllowed], now)).toEqual([newest, oldestAllowed]);
    const stale = batch("stale", "2026-08-09T23:59:59.999Z");
    expect(selectQualificationPair([newest, close, stale], now)).toEqual([newest, close]);
  });

  it("preserves the diagnostic fallback when no qualified pair exists", () => {
    const incomplete = batch("unfinished", null);
    const invalid = batch("invalid-time", "invalid");
    expect(selectQualificationPair([incomplete, invalid], now)).toEqual([incomplete, invalid]);
    expect(selectQualificationPair([], now)).toEqual([]);
    expect(selectQualificationPair([incomplete], now)).toEqual([incomplete]);
  });

  it("wires the receipt CLI to the shared selector without a private timing override", () => {
    const script = readFileSync("scripts/p0-authoritative-launch-receipt.ts", "utf8");
    expect(script).toMatch(/import\s*\{\s*selectQualificationPair\s*\}\s*from\s*["']\.\.\/src\/release\/formalQualificationTiming["']/u);
    expect(script).toContain("batches: selectQualificationPair(batches, evaluatedAt)");
    expect(script).not.toMatch(/function\s+selectQualificationPair/u);
  });
});
