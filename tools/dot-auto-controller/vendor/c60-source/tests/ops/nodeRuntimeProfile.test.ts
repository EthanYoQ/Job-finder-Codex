// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_NODE_RUNTIME_PROFILE_PATH, parseNodeRuntimeProfile, verifyNodeRuntimeProfile
} from "../../scripts/verify-node-runtime-profile";

const profile = JSON.parse(readFileSync(DEFAULT_NODE_RUNTIME_PROFILE_PATH, "utf8"));
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture(value: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "node-runtime-profile-test-"));
  directories.push(directory);
  const path = join(directory, "profile.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

describe("attested Node runtime profile", () => {
  it("keeps the official installation provenance in the strict tracked profile", () => {
    expect(parseNodeRuntimeProfile(profile)).toEqual(profile);
    expect(profile).toMatchObject({ version: "v22.23.3", platform: "linux", arch: "x64",
      archiveSha256: "df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de",
      binarySha256: "fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48" });
  });

  it.each([
    { unexpected: "private-value" }, { latestSelectionUrl: "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" },
    { schemaVersion: 2 }, { binarySha256: "not-a-hash" },
    { binarySha256: "A".repeat(64) }, { version: "v22.19.0" }, { version: "v22.23.3-rc.1" },
    { distributionUrl: "https://untrusted.example.test/node.tar.xz" },
    { shasumsUrl: "https://nodejs.org/dist/v22.23.2/SHASUMS256.txt" }, { arch: "arm64" }
  ])("rejects invalid/unknown profile fields without echoing their contents: %#", change => {
    expect(() => parseNodeRuntimeProfile({ ...profile, ...change }))
      .toThrow("NODE_RUNTIME_PROFILE_INVALID");
  });

  it("compares the real running process version with the profile", async () => {
    const version = process.version === "v22.23.4" ? "v22.23.5" : "v22.23.4";
    const profilePath = fixture({ ...profile, version,
      distributionUrl: `https://nodejs.org/dist/${version}/node-${version}-linux-x64.tar.xz`,
      shasumsUrl: `https://nodejs.org/dist/${version}/SHASUMS256.txt` });
    await expect(verifyNodeRuntimeProfile({ profilePath })).rejects.toMatchObject({ code: "NODE_RUNTIME_VERSION_MISMATCH" });
  });

  // Only the pinned Linux x64 runtime can exercise binary matching. Other supported
  // developer runtimes still run schema/version tests without pretending to match it.
  const onPinnedRuntime = process.version === profile.version && process.platform === profile.platform && process.arch === profile.arch;
  it.skipIf(!onPinnedRuntime)("hashes the actual executable and rejects a false binary digest", async () => {
    const profilePath = fixture({ ...profile, binarySha256: "0".repeat(64) });
    await expect(verifyNodeRuntimeProfile({ profilePath })).rejects.toMatchObject({ code: "NODE_RUNTIME_BINARY_MISMATCH" });
  });

  it.skipIf(!onPinnedRuntime)("rejects a named executable that differs from the running Linux inode", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "execPath")!;
    const otherPath = fixture({ notAnExecutable: true });
    try {
      Object.defineProperty(process, "execPath", { ...descriptor, value: otherPath });
      await expect(verifyNodeRuntimeProfile()).rejects.toMatchObject({ code: "NODE_RUNTIME_BINARY_MISMATCH" });
    } finally { Object.defineProperty(process, "execPath", descriptor); }
  });

  it.skipIf(!onPinnedRuntime)("verifies the actual pinned executable without leaking environment settings", async () => {
    const result = await verifyNodeRuntimeProfile();
    expect(result).toMatchObject({ code: "NODE_RUNTIME_PROFILE_VERIFIED", execPath: process.execPath,
      version: process.version, platform: process.platform, arch: process.arch, binarySha256: profile.binarySha256 });
    expect(result.profileSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(result).sort()).toEqual(["arch", "binarySha256", "code", "execPath", "executablePath", "platform", "profileSha256", "schemaVersion", "version"]);
  });

  it("reports unreadable and malformed input with stable errors only", async () => {
    const profilePath = fixture(null);
    writeFileSync(profilePath, "{private-malformed-value");
    await expect(verifyNodeRuntimeProfile({ profilePath })).rejects.toThrow("NODE_RUNTIME_PROFILE_INVALID");
    await expect(verifyNodeRuntimeProfile({ profilePath: profilePath + ".missing" }))
      .rejects.toThrow("NODE_RUNTIME_PROFILE_UNREADABLE");
  });
});
