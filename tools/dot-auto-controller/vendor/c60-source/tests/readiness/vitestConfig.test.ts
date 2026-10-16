import { describe, expect, it } from "vitest";
import { vitestMaxWorkers } from "../../testExecutionContract";

describe("Vitest execution contract", () => {
  it("limits hosted CI concurrency without slowing local focused runs", () => {
    expect(vitestMaxWorkers({ CI: "true" })).toBe(2);
    expect(vitestMaxWorkers({})).toBe(4);
    expect(vitestMaxWorkers({ CI: "false" })).toBe(4);
  });
});
