import { describe, expect, it } from "vitest";
import { assertFormalBrowserReady, FORMAL_CHROMIUM_MIN_VERSION, FORMAL_CHROMIUM_PATH,
  FORMAL_CHROMIUM_ENGINE_REALPATH, FORMAL_CHROMIUM_REALPATH } from "../../src/readiness/formalBrowserPreflight";
import { compareDottedVersions } from "../../src/readiness/productionImageContract";
describe("formal browser preflight",()=>{
 it("pins the production Linux executable",()=>expect(FORMAL_CHROMIUM_PATH).toBe("/usr/bin/chromium"));
 it("pins the production browser identity",()=>{
  expect(FORMAL_CHROMIUM_REALPATH).toBe("/opt/brave.com/brave/brave-browser");
  expect(FORMAL_CHROMIUM_ENGINE_REALPATH).toBe("/opt/brave.com/brave/brave");
 expect(FORMAL_CHROMIUM_MIN_VERSION).toBe("151.0.7922.137");
 });
 it("compares the exact four-part browser security boundary",()=>{
  expect(compareDottedVersions("151.0.7922.136","151.0.7922.137")).toBeLessThan(0);
  expect(compareDottedVersions("151.0.7922.137","151.0.7922.137")).toBe(0);
  expect(compareDottedVersions("151.0.7922.138","151.0.7922.137")).toBeGreaterThan(0);
  expect(()=>compareDottedVersions("151.invalid","151.0")).toThrow(/invalid/u);
 });
 it.runIf(process.platform!=="linux")("fails closed outside the production Linux image",async()=>{
  await expect(assertFormalBrowserReady()).rejects.toThrow(/production Linux image/u);
 });
});
