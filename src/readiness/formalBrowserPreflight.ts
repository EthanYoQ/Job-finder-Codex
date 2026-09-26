import { constants, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { chromium } from "playwright-core";
import { compareDottedVersions, PRODUCTION_BROWSER_ENGINE_REALPATH,
  PRODUCTION_BROWSER_MIN_ENGINE_VERSION } from "./productionImageContract";

export const FORMAL_CHROMIUM_PATH = "/usr/bin/chromium";
export const FORMAL_CHROMIUM_REALPATH = "/opt/brave.com/brave/brave-browser";
export const FORMAL_CHROMIUM_ENGINE_REALPATH = PRODUCTION_BROWSER_ENGINE_REALPATH;
export const FORMAL_CHROMIUM_MIN_VERSION = PRODUCTION_BROWSER_MIN_ENGINE_VERSION;
export const FORMAL_CHROMIUM_ARGS = ["--disable-dev-shm-usage"] as const;
export async function assertFormalBrowserReady(): Promise<void> { await inspectFormalBrowserReady(); }
export async function inspectFormalBrowserReady(): Promise<string> {
  return (await inspectFormalBrowserRuntime()).engineVersion;
}
export async function inspectFormalBrowserRuntime(): Promise<{ engineVersion: string; engineExecutableRealpath: string }> {
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
    const engineExecutableRealpath = await resolveBrowserEngineExecutable(process.pid);
    if (engineExecutableRealpath !== FORMAL_CHROMIUM_ENGINE_REALPATH) {
      throw new Error("formal browser process does not execute the fixed production engine");
    }
    return { engineVersion: match[1]!, engineExecutableRealpath };
  } finally {
    await browser.close();
  }
}

async function resolveBrowserEngineExecutable(rootPid: number): Promise<string> {
  const deadline = Date.now() + 2_000;
  do {
    const match = scanBrowserEngineExecutable(rootPid);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error("formal browser engine process identity is missing");
}

function scanBrowserEngineExecutable(rootPid: number): string | null {
  const pending = [rootPid], visited = new Set<number>(), executables = new Set<string>();
  while (pending.length > 0) {
    const pid = pending.pop()!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    let childText: string;
    try { childText = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8"); }
    catch { continue; }
    for (const token of childText.trim().split(/\s+/u).filter(Boolean)) {
      const child = Number(token);
      if (!Number.isSafeInteger(child) || child <= 0) continue;
      pending.push(child);
      try { executables.add(readlinkSync(`/proc/${child}/exe`)); } catch { /* exited child */ }
    }
  }
  const matches = [...executables].filter((path) => path === FORMAL_CHROMIUM_ENGINE_REALPATH);
  return matches.length === 1 ? matches[0]! : null;
}
