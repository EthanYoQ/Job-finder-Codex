import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createBrowserRuntimeQualificationReceipt,
  parseBrowserRuntimeQualificationReceipt
} from "../../src/security/browserRuntimeQualification";

const imageDigest = `sha256:${"a".repeat(64)}`;
const raw = Buffer.from(JSON.stringify({
  status: "PASS", executablePath: "/usr/bin/chromium", engineExecutableRealpath: "/opt/brave.com/brave/brave",
  engineVersion: "151.0.7922.137"
}));

function release(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    tag_name: "v1.93.136", draft: false, prerelease: false, assets: [{
      name: "brave-browser_1.93.136_amd64.deb",
      browser_download_url: "https://github.com/brave/brave-browser/releases/download/v1.93.136/brave-browser_1.93.136_amd64.deb",
      digest: "sha256:9739e5aaee4303eb4199c038b04a75d7bc7ac08314af9f763011e211dea62999"
    }],
    ...overrides
  }));
}

describe("browser runtime qualification", () => {
  it("binds the exact image, runtime probe, stable release and immutable asset", () => {
    const receipt = createBrowserRuntimeQualificationReceipt(
      raw, release(), imageDigest, new Date("2026-08-13T00:00:00.000Z")
    );
    expect(parseBrowserRuntimeQualificationReceipt(
      Buffer.from(JSON.stringify(receipt)), imageDigest
    )).toEqual(receipt);
    expect(receipt).toMatchObject({
      decision: "PASSED", browserRelease: "v1.93.136", engineVersion: "151.0.7922.137",
      engineExecutableRealpath: "/opt/brave.com/brave/brave",
      keyringAssetSha256: "9ea8725ad4241e4d30bc31b0d5213c7ce24b1dcd5247875b2de1bcba8c4e9b00"
    });
  });

  it.each([
    ["draft", { draft: true }],
    ["prerelease", { prerelease: true }],
    ["wrong tag", { tag_name: "v1.93.135" }],
    ["wrong asset digest", { assets: [{
      name: "brave-browser_1.93.136_amd64.deb",
      browser_download_url: "https://github.com/brave/brave-browser/releases/download/v1.93.136/brave-browser_1.93.136_amd64.deb",
      digest: `sha256:${"b".repeat(64)}`
    }] }],
    ["duplicated named asset", { assets: [{
      name: "brave-browser_1.93.136_amd64.deb",
      browser_download_url: "https://github.com/brave/brave-browser/releases/download/v1.93.136/brave-browser_1.93.136_amd64.deb",
      digest: "sha256:9739e5aaee4303eb4199c038b04a75d7bc7ac08314af9f763011e211dea62999"
    }, {
      name: "brave-browser_1.93.136_amd64.deb",
      browser_download_url: "https://attacker.invalid/brave.deb",
      digest: `sha256:${"b".repeat(64)}`
    }] }]
  ])("rejects a %s GitHub release", (_label, overrides) => {
    expect(() => createBrowserRuntimeQualificationReceipt(raw, release(overrides), imageDigest))
      .toThrow(/release|asset/u);
  });

  it("rejects a browser engine below the fixed security floor", () => {
    const old = Buffer.from(JSON.stringify({
      status: "PASS", executablePath: "/usr/bin/chromium", engineExecutableRealpath: "/opt/brave.com/brave/brave",
      engineVersion: "151.0.7922.136"
    }));
    expect(() => createBrowserRuntimeQualificationReceipt(old, release(), imageDigest))
      .toThrow(/probe/u);
  });

  it("rejects self-hashed thin and extended receipts", () => {
    const thinBase = { schemaVersion: 1, decision: "PASSED", imageDigest };
    const thin = { ...thinBase, contentSha256: sha(JSON.stringify(thinBase)) };
    expect(() => parseBrowserRuntimeQualificationReceipt(Buffer.from(JSON.stringify(thin)), imageDigest))
      .toThrow(/schema/u);

    const valid = createBrowserRuntimeQualificationReceipt(raw, release(), imageDigest);
    const { contentSha256: _oldHash, ...base } = valid;
    const extendedBase = { ...base, unexpected: true };
    const extended = { ...extendedBase, contentSha256: sha(JSON.stringify(extendedBase)) };
    expect(() => parseBrowserRuntimeQualificationReceipt(Buffer.from(JSON.stringify(extended)), imageDigest))
      .toThrow(/schema/u);
  });
});

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
