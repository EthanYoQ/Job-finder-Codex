// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertOfficialHttpProxyRuntime, OfficialHttpProxyRuntimeError, supportsNativeFetchEnvProxy
} from "../../src/crawler/officialHttpProxyRuntime";
import { fetchWithOfficialTimeout } from "../../src/crawler/officialHttpRuntimeLimits";

const versionDescriptor = Object.getOwnPropertyDescriptor(process, "version")!;
afterEach(() => {
  Object.defineProperty(process, "version", versionDescriptor);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("official native fetch environment proxy capability", () => {
  it.each([
    ["v22.19.0", false], ["22.20.99", false], ["v22.21.0", true], ["v22.23.3", true],
    ["v23.11.0", false], ["v24.0.0", true], ["v24.5.0", true], ["v25.0.0", true],
    ["v22.21.0-rc.1", false], ["v24.0.0-nightly", false], ["22.021.0", false], ["invalid", false]
  ])("checks the official fetch feature boundary for %s", (version, supported) => {
    expect(supportsNativeFetchEnvProxy(version)).toBe(supported);
  });

  it("leaves the existing path alone when environment proxy support is not requested", () => {
    for (const flag of [undefined, "0", "", "true"]) {
      expect(() => assertOfficialHttpProxyRuntime({ NODE_USE_ENV_PROXY: flag }, "v22.19.0")).not.toThrow();
    }
  });

  it("reads without mutating the environment and omits proxy and CA values from errors", () => {
    const env = Object.freeze({ NODE_USE_ENV_PROXY: "1", HTTPS_PROXY: "http://private-user:private-pass@proxy.test:8080",
      HTTP_PROXY: "http://other-private-proxy.test", NO_PROXY: "private-bypass.test", NODE_EXTRA_CA_CERTS: "/private/ca.pem" });
    const before = JSON.stringify(env);
    let error: unknown;
    try { assertOfficialHttpProxyRuntime(env, "v22.19.0"); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(OfficialHttpProxyRuntimeError);
    expect(error).toMatchObject({ code: "OFFICIAL_HTTP_ENV_PROXY_UNSUPPORTED_RUNTIME" });
    const serialized = String(error) + JSON.stringify(error);
    expect(serialized).toContain("v22.19.0");
    for (const value of [env.HTTPS_PROXY, env.HTTP_PROXY, env.NO_PROXY, env.NODE_EXTRA_CA_CERTS]) {
      expect(serialized).not.toContain(value);
    }
    expect(JSON.stringify(env)).toBe(before);
    expect(String(new OfficialHttpProxyRuntimeError(env.HTTPS_PROXY))).not.toContain(env.HTTPS_PROXY);
    expect(() => assertOfficialHttpProxyRuntime(env, "v22.23.3")).not.toThrow();
  });

  it("blocks the production default fetch before making any HTTP call on an old runtime", async () => {
    Object.defineProperty(process, "version", { ...versionDescriptor, value: "v22.19.0" });
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    const nativeFetch = vi.fn().mockResolvedValue(new Response("unreachable"));
    vi.stubGlobal("fetch", nativeFetch);
    await expect(fetchWithOfficialTimeout("https://official.example.test"))
      .rejects.toMatchObject({ code: "OFFICIAL_HTTP_ENV_PROXY_UNSUPPORTED_RUNTIME" });
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it("keeps injected transport tests independent of the native runtime", async () => {
    Object.defineProperty(process, "version", { ...versionDescriptor, value: "v22.19.0" });
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    const fetchImpl = vi.fn().mockResolvedValue(new Response("fixture"));
    const response = await fetchWithOfficialTimeout("https://official.example.test", {}, { fetchImpl });
    expect(await response.text()).toBe("fixture");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([["v22.19.0", "0"], ["v22.21.0", "1"], ["v24.0.0", "1"]])(
    "allows the production fetch path with runtime %s and proxy flag %s", async (version, flag) => {
      Object.defineProperty(process, "version", { ...versionDescriptor, value: version });
      vi.stubEnv("NODE_USE_ENV_PROXY", flag);
      const nativeFetch = vi.fn().mockResolvedValue(new Response("fixture"));
      vi.stubGlobal("fetch", nativeFetch);
      expect(await (await fetchWithOfficialTimeout("https://official.example.test")).text()).toBe("fixture");
      expect(nativeFetch).toHaveBeenCalledOnce();
    }
  );
});
