import { describe, expect, it } from "vitest";
import { assertFormalBrowserReady, FORMAL_CHROMIUM_PATH } from "../../src/readiness/formalBrowserPreflight";
describe("formal browser preflight",()=>{
 it("pins the production Linux executable",()=>expect(FORMAL_CHROMIUM_PATH).toBe("/usr/bin/chromium"));
 it.runIf(process.platform!=="linux")("fails closed outside the production Linux image",async()=>{
  await expect(assertFormalBrowserReady()).rejects.toThrow(/production Linux image/u);
 });
});
