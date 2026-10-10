import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { productionTsxProcessArgs } from "../../src/ops/productionTsxProcess";

describe("production TypeScript process command", () => {
  it("uses the pinned local loader without starting the tsx CLI IPC server", () => {
    expect(productionTsxProcessArgs("scripts/p0-crawl.ts", ["--force"])).toEqual([
      "--import", "./node_modules/tsx/dist/loader.mjs",
      "scripts/p0-crawl.ts",
      "--force"
    ]);
  });
  it.each([{ args: [] }, { args: ["argument with spaces", "--flag=value with spaces"] }])(
    "executes a real typed child and preserves argument boundaries: $args", ({ args }) => {
      const directory = mkdtempSync(join(tmpdir(), "job-finder-tsx-process-"));
      try {
        const script = join(directory, "typed child.ts");
        writeFileSync(script, 'interface Payload { ok: boolean; args: string[] }\nconst result: Payload = { ok: true, args: process.argv.slice(2) };\nprocess.stdout.write(JSON.stringify(result));\n');
        const result = spawnSync(process.execPath, productionTsxProcessArgs(script, args), {
          cwd: process.cwd(), encoding: "utf8", timeout: 10_000
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ ok: true, args });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );
});
