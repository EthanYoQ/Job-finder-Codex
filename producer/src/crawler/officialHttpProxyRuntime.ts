type RuntimeEnv = Readonly<Record<string, string | undefined>>;

/** Native fetch support, not the later --use-env-proxy CLI flag:
 * https://nodejs.org/api/cli.html#node_use_env_proxy1
 * https://nodejs.org/en/blog/release/v22.21.0
 * https://nodejs.org/en/blog/release/v24.0.0 */
export function supportsNativeFetchEnvProxy(version: string): boolean {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major! >= 24 || (major === 22 && minor! >= 21);
}

export class OfficialHttpProxyRuntimeError extends Error {
  readonly code = "OFFICIAL_HTTP_ENV_PROXY_UNSUPPORTED_RUNTIME";

  constructor(version: string) {
    // Never include proxy addresses, CA settings, or arbitrary environment text.
    const safeVersion = /^v?\d+\.\d+\.\d+$/u.test(version) ? version : "unknown";
    super(`Official HTTP environment proxy requires Node 22.21.0+ in major 22 or Node 24+; runtime ${safeVersion}`);
    this.name = "OfficialHttpProxyRuntimeError";
  }
}

/** Only checks capability. Proxy/CA/dispatcher configuration remains owned by
 * the existing process environment and Node startup. Injected fetches own transport. */
export function assertOfficialHttpProxyRuntime(
  env: RuntimeEnv = process.env,
  version = process.version
): void {
  if (env.NODE_USE_ENV_PROXY === "1" && !supportsNativeFetchEnvProxy(version)) {
    throw new OfficialHttpProxyRuntimeError(version);
  }
}
