import { constants, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { chromium } from "playwright-core";
import { compareDottedVersions, PRODUCTION_BROWSER_MIN_ENGINE_VERSION } from "./productionImageContract";

export const FORMAL_CHROMIUM_PATH = "/usr/bin/chromium";
export const FORMAL_CHROMIUM_REALPATH = "/opt/brave.com/brave/brave-browser";
export const FORMAL_CHROMIUM_MIN_VERSION = PRODUCTION_BROWSER_MIN_ENGINE_VERSION;
export const FORMAL_CHROMIUM_ARGS = ["--disable-dev-shm-usage"] as const;
export async function assertFormalBrowserReady(): Promise<void> { await inspectFormalBrowserReady(); }
export async function inspectFormalBrowserReady(): Promise<string> {
  if (process.platform !== "linux") throw new Error("formal browser readiness is supported only by the production Linux image");
  if (process.getuid?.() === 0) throw new Error("formal browser readiness requires a non-root service user with Chromium sandbox support");
  const real = realpathSync(FORMAL_CHROMIUM_PATH);
  if (real !== FORMAL_CHROMIUM_REALPATH) throw new Error("formal browser path does not resolve to the fixed production binary");
  await access(real, constants.X_OK);
  const browser = await chromium.launch({ executablePath: FORMAL_CHROMIUM_PATH, headless: true,
    args: [...FORMAL_CHROMIUM_ARGS] });
  try {
    const version = browser.version();
    const match = /(\d+\.\d+\.\d+\.\d+)$/u.exec(version);
    if (!match || compareDottedVersions(match[1]!, FORMAL_CHROMIUM_MIN_VERSION) < 0) {
      throw new Error("formal browser version probe failed");
    }
    return match[1]!;
  } finally {
    await browser.close();
  }
}
