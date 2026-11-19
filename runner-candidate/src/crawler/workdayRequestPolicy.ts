import { randomInt, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseOfficialRetryAfter } from "./officialRetryAfter";

type AccessStatus = 403 | 429;
type Cooldown = { status: AccessStatus; until: number; hits?: number };
type Cooldowns = { family?: Cooldown; hosts: Record<string, Cooldown> };
export type WorkdayPolicyOptions = { minSpacingMs?: number; maxSpacingMs?: number };
type Scope = { file: string; nextRequestAt: number; minSpacingMs: number; maxSpacingMs: number; cooldowns?: Cooldowns };

const scopes = new AsyncLocalStorage<Scope>();
export interface WorkdayTransportObservation {
  kind: "HTTP_RESPONSE" | "LOCAL_DEFERRED";
  observedAt: number;
  status: AccessStatus;
  retryAt?: number;
}
const transportObservers = new AsyncLocalStorage<(observation: WorkdayTransportObservation) => void>();

export function withWorkdayTransportObservation<T>(
  observe: (observation: WorkdayTransportObservation) => void,
  run: () => Promise<T>
): Promise<T> {
  return transportObservers.run(observe, run);
}

const effectiveRetryHeaders = new WeakMap<Response, string>();
const defaultMinSpacingMs = 2_200;
const defaultMaxSpacingMs = 3_200;
const challengeCooldownStepsMs = [5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000] as const;
const plainRateLimitCooldownMs = 60_000;
const maxStaleHostRetentionMs = 6 * 3600_000;

export class WorkdayCooldownError extends Error {
  readonly code = "WORKDAY_COOLDOWN";
  constructor(readonly status: AccessStatus, readonly retryAfterMs: number) {
    super("Workday request skipped during access cooldown");
    this.name = "WorkdayCooldownError";
  }
}

export function isWorkdayCooldownError(error: unknown): error is WorkdayCooldownError {
  return error instanceof WorkdayCooldownError;
}

/** Scheduled and manual collector entries both hold the portable lease. */
export function withWorkdayRequestPolicy<T>(
  stateRoot: string,
  run: () => Promise<T>,
  options: WorkdayPolicyOptions = {}
): Promise<T> {
  const minSpacingMs = options.minSpacingMs ?? defaultMinSpacingMs;
  const maxSpacingMs = Math.max(minSpacingMs, options.maxSpacingMs ?? defaultMaxSpacingMs);
  return scopes.run({ file: join(stateRoot, "workday-cooldown.json"), nextRequestAt: 0, minSpacingMs, maxSpacingMs }, run);
}

function nextSpacingMs(scope: Scope): number {
  return scope.minSpacingMs >= scope.maxSpacingMs
    ? scope.minSpacingMs
    : randomInt(scope.minSpacingMs, scope.maxSpacingMs + 1);
}

export function currentWorkdayPolicyRoot(): string | undefined {
  const scope = scopes.getStore();
  return scope ? dirname(scope.file) : undefined;
}

export function finishIsolatedWorkdayTraversal(): void {
  const scope = scopes.getStore();
  if (!scope) return;
  delete scope.cooldowns;
  scope.nextRequestAt = Math.max(scope.nextRequestAt, performance.now() + nextSpacingMs(scope));
}

function workdayHost(raw: string): string | undefined {
  const { protocol, hostname } = new URL(raw);
  return protocol === "https:" && hostname.endsWith(".myworkdayjobs.com") ? hostname : undefined;
}

function activeCooldown(value: Cooldown | undefined, now: number): value is Cooldown {
  return (value?.status === 403 || value?.status === 429) && Number.isSafeInteger(value.until) && value.until > now;
}

function retainedCooldown(value: Cooldown | undefined, now: number): value is Cooldown {
  return (value?.status === 403 || value?.status === 429) && Number.isSafeInteger(value.until) &&
    value.until + maxStaleHostRetentionMs > now;
}

function loadCooldowns(scope: Scope, now: number): Cooldowns {
  if (scope.cooldowns) return scope.cooldowns;
  try {
    const saved = JSON.parse(readFileSync(scope.file, "utf8")) as Cooldowns;
    const hosts = Object.fromEntries(Object.entries(saved.hosts ?? {}).filter(([host, value]) =>
      host.endsWith(".myworkdayjobs.com") && retainedCooldown(value, now)));
    return scope.cooldowns = { hosts, ...(activeCooldown(saved.family, now) ? { family: saved.family } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return scope.cooldowns = { hosts: {} };
  }
}

function saveCooldowns(scope: Scope, cooldowns: Cooldowns): void {
  const temporary = scope.file + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, JSON.stringify(cooldowns) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, scope.file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function assertAvailable(scope: Scope, host: string, now: number): void {
  const { family, hosts } = loadCooldowns(scope, now);
  const tenant = hosts[host];
  const cooldown = family && family.until >= (tenant?.until ?? 0) ? family : tenant;
  if (activeCooldown(cooldown, now)) {
    transportObservers.getStore()?.({ kind: "LOCAL_DEFERRED", observedAt: now,
      status: cooldown.status, retryAt: cooldown.until });
    throw new WorkdayCooldownError(cooldown.status, cooldown.until - now);
  }
}

export function assertWorkdayAvailable(url: string): void {
  const scope = scopes.getStore();
  if (!scope) return;
  const host = workdayHost(url);
  if (host) assertAvailable(scope, host, Date.now());
}

export async function waitForWorkdayRequest(url: string, signal?: AbortSignal): Promise<void> {
  const scope = scopes.getStore();
  if (!scope) return;
  const host = workdayHost(url);
  if (!host) return;
  for (;;) {
    signal?.throwIfAborted();
    assertAvailable(scope, host, Date.now());
    const monoNow = performance.now();
    const waitMs = scope.nextRequestAt - monoNow;
    if (waitMs <= 0) {
      scope.nextRequestAt = monoNow + nextSpacingMs(scope);
      return;
    }
    await sleep(Math.ceil(waitMs), undefined, { signal }).catch(error => {
      signal?.throwIfAborted();
      throw error;
    });
  }
}

export function isWorkdayChallengeHtml(body: string): boolean {
  return body.includes("/cdn-cgi/challenge-platform/") || body.includes("Enable JavaScript and cookies to continue");
}

/** Records a real access response. Returns a retry floor for policy, never for evidence. */
export function recordWorkdayAccessResponse(url: string, status: number, headers: Headers, challengeHtml = false): number | undefined {
  const scope = scopes.getStore();
  if (!scope || (status !== 403 && status !== 429)) return undefined;
  const host = workdayHost(url);
  if (!host) return undefined;
  const challenge = headers.get("cf-mitigated") === "challenge" || challengeHtml;
  const now = Date.now();
  if (!challenge && status === 403) {
    transportObservers.getStore()?.({ kind: "HTTP_RESPONSE", observedAt: now, status });
    return undefined;
  }
  const retryAfter = parseOfficialRetryAfter(headers.get("retry-after"), now);
  const cooldowns = loadCooldowns(scope, now);
  // New restrictions belong to the responding host. Existing family entries are
  // still enforced by assertAvailable until their recorded deadline expires.
  const previous = cooldowns.hosts[host];
  const priorHits = previous?.hits ?? (previous && previous.until > now ? 1 : 0);
  const hits = challenge
    ? (previous && previous.until > now ? Math.max(priorHits, 1) : priorHits + 1)
    : (previous?.hits ?? 0);
  const baseDelayMs = challenge
    ? challengeCooldownStepsMs[Math.min(Math.max(hits - 1, 0), challengeCooldownStepsMs.length - 1)]!
    : plainRateLimitCooldownMs;
  const delayMs = Math.max(baseDelayMs, retryAfter && "delayMs" in retryAfter ? retryAfter.delayMs : 0);
  const until = Math.max(now + delayMs, previous?.until ?? 0);
  const retryAt = Math.max(until, cooldowns.family?.until ?? 0);
  transportObservers.getStore()?.({ kind: "HTTP_RESPONSE", observedAt: now, status, retryAt });
  if (previous?.until !== until || (hits > 0 && previous?.hits !== hits)) {
    const cooldown: Cooldown = { status, until, ...(hits > 0 ? { hits } : {}) };
    cooldowns.hosts[host] = cooldown;
    saveCooldowns(scope, cooldowns);
  }
  return retryAt - now;
}

export function workdayRetryAfterHeader(response: Response): string | null {
  return effectiveRetryHeaders.get(response) ?? response.headers.get("retry-after");
}

export async function observeWorkdayResponse(url: string, response: Response, signal: AbortSignal): Promise<void> {
  const scope = scopes.getStore();
  if (!scope || !workdayHost(url)) return;
  const finalUrl = response.url || url;
  const finalHost = workdayHost(finalUrl);
  if (!finalHost) return;
  scope.nextRequestAt = Math.max(scope.nextRequestAt, performance.now() + nextSpacingMs(scope));
  if (response.status >= 200 && response.status < 400) {
    const cooldowns = loadCooldowns(scope, Date.now());
    if (cooldowns.hosts[finalHost]) {
      delete cooldowns.hosts[finalHost];
      saveCooldowns(scope, cooldowns);
    }
    return;
  }
  if (response.status !== 429 && response.status !== 403) return;
  const { headers } = response;
  let challengeHtml = false;
  if (headers.get("cf-mitigated") !== "challenge" && /^text\/html(?:;|$)/iu.test(headers.get("content-type") ?? "")) {
    const reader = response.clone().body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      const limit = 64 * 1024;
      let remaining = limit, body = "";
      const cancel = () => { void reader.cancel().catch(() => undefined); };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        signal.throwIfAborted();
        while (remaining > 0) {
          const { done, value } = await reader.read();
          if (done) break;
          body += decoder.decode(value.subarray(0, remaining), { stream: true });
          remaining -= value.byteLength;
          if (isWorkdayChallengeHtml(body)) { challengeHtml = true; break; }
        }
      } catch {
        challengeHtml = false;
      } finally {
        signal.removeEventListener("abort", cancel);
        cancel();
      }
    }
  }
  signal.throwIfAborted();
  const delayMs = recordWorkdayAccessResponse(finalUrl, response.status, headers, challengeHtml);
  if (delayMs !== undefined) effectiveRetryHeaders.set(response, String(Math.ceil(delayMs / 1000)));
}
