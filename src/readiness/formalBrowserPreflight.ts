import { execFileSync } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { chromium } from "playwright-core";

export const FORMAL_CHROMIUM_PATH = "/usr/bin/chromium";
export const FORMAL_CHROMIUM_ARGS = ["--disable-dev-shm-usage"] as const;
export async function assertFormalBrowserReady(): Promise<void> {
  if (process.platform !== "linux") throw new Error("formal browser readiness is supported only by the production Linux image");
  if (process.getuid?.() === 0) throw new Error("formal browser readiness requires a non-root service user with Chromium sandbox support");
  const real = realpathSync(FORMAL_CHROMIUM_PATH);
  if (real !== FORMAL_CHROMIUM_PATH) throw new Error("formal Chromium path must be the fixed production realpath");
  await access(real, constants.X_OK);
  const version = execFileSync(real, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim();
  if (!/^Chromium \d+/u.test(version)) throw new Error("formal Chromium version probe failed");
  const browser = await chromium.launch({ executablePath: FORMAL_CHROMIUM_PATH, headless: true,
    args: [...FORMAL_CHROMIUM_ARGS] });
  await browser.close();
}
