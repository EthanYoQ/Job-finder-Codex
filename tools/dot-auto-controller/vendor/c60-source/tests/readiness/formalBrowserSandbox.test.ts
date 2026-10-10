import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  realpathSync: vi.fn(),
  access: vi.fn(),
  readFileSync: vi.fn(),
  readlinkSync: vi.fn(),
  version: vi.fn(),
  close: vi.fn()
}));

// Never import or launch a real browser in these readiness contract tests.
vi.mock("playwright-core", () => ({ chromium: { launch: mocks.launch } }));
vi.mock("node:fs", () => {
  const fs = {
    constants: { X_OK: 1 },
    realpathSync: mocks.realpathSync,
    readFileSync: mocks.readFileSync,
    readlinkSync: mocks.readlinkSync
  };
  return { ...fs, default: fs };
});
vi.mock("node:fs/promises", () => {
  const fs = { access: mocks.access };
  return { ...fs, default: fs };
});

import { inspectFormalBrowserRuntime } from "../../src/readiness/formalBrowserPreflight";

describe("formal browser sandbox", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // A test-only process facade; no OS identity or security settings change.
    vi.stubGlobal("process", { ...process, platform: "linux", getuid: () => 1000 });
    mocks.realpathSync.mockReturnValue("/opt/brave.com/brave/brave-browser");
    mocks.access.mockResolvedValue(undefined);
    mocks.readFileSync.mockImplementation((path: string) =>
      path === `/proc/${process.pid}/task/${process.pid}/children` ? "31415" : "");
    mocks.readlinkSync.mockReturnValue("/opt/brave.com/brave/brave");
    mocks.version.mockReturnValue("151.0.7922.137");
    mocks.close.mockResolvedValue(undefined);
    mocks.launch.mockResolvedValue({ version: mocks.version, close: mocks.close });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it("explicitly enables the sandbox with only the pinned launch options", async () => {
    await expect(inspectFormalBrowserRuntime()).resolves.toEqual({
      engineVersion: "151.0.7922.137",
      engineExecutableRealpath: "/opt/brave.com/brave/brave"
    });
    expect(mocks.launch.mock.calls).toEqual([[{
      executablePath: "/usr/bin/chromium",
      headless: true,
      chromiumSandbox: true,
      args: ["--disable-dev-shm-usage"]
    }]]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("propagates sandbox startup failure without a retry or unsandboxed fallback", async () => {
    const failure = new Error("Chromium sandboxing failed! No usable sandbox!");
    mocks.launch.mockRejectedValue(failure);

    await expect(inspectFormalBrowserRuntime()).rejects.toBe(failure);
    expect(mocks.launch.mock.calls).toEqual([[{
      executablePath: "/usr/bin/chromium",
      headless: true,
      chromiumSandbox: true,
      args: ["--disable-dev-shm-usage"]
    }]]);
    expect(mocks.version).not.toHaveBeenCalled();
    expect(mocks.readFileSync).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
