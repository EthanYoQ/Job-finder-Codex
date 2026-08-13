import { describe, expect, it } from "vitest";
import { productionTsxProcessArgs } from "../../src/ops/productionTsxProcess";

describe("production TypeScript process command", () => {
  it("places the pinned local tsx CLI and script before forwarded arguments", () => {
    expect(productionTsxProcessArgs("scripts/p0-crawl.ts", ["--force"])).toEqual([
      "node_modules/tsx/dist/cli.mjs",
      "scripts/p0-crawl.ts",
      "--force"
    ]);
  });
});
