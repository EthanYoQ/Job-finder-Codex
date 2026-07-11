import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateCrawlCapacity } from "../../scripts/p0-crawl-capacity-report";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..", "..");

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

  it("prints JSON when run directly through tsx", () => {
    const stdout =
      process.platform === "win32"
        ? execFileSync(
            "cmd.exe",
            ["/d", "/s", "/c", "npx tsx scripts/p0-crawl-capacity-report.ts"],
            {
              cwd: projectRoot,
              encoding: "utf8"
            }
          )
        : execFileSync("npx", ["tsx", "scripts/p0-crawl-capacity-report.ts"], {
            cwd: projectRoot,
            encoding: "utf8"
          });

    expect(JSON.parse(stdout)).toMatchObject({
      estimatedOnePassSeconds: 289,
      estimatedTwiceDailySeconds: 578
    });
  },15_000);
});
