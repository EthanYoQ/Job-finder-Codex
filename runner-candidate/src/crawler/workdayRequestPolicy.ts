import { randomInt, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseOfficialRetryAfter } from "./officialRetryAfter";

type AccessStatus = 403 | 429;
type Cooldown = { status: AccessStatus; until: number };
type Cooldowns = { family?: Cooldown; hosts: Record<string, Cooldown> };
type Scope = { file: string; nextRequestAt: number; cooldowns?: Cooldowns };

const scopes = new AsyncLocalStorage<Scope>();
const effectiveRetryHeaders = new WeakMap<Response, string>();
const challengeCooldownMs = 40 * 60_000;
const plainRateLimitCooldownMs = 60_000;

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
export function withWorkdayRequestPolicy<T>(stateRoot: string, run: () => Promise<T>): Promise<T> {
  return scopes.run({ file: join(stateRoot, "workday-cooldown.json"), nextRequestAt: 0 }, run);
}

export function currentWorkdayPolicyRoot(): string | undefined {
  const scope = scopes.getStore();
  return scope ? dirname(scope.file) : undefined;
}

export function reloadWorkdayCooldowns(): void {
  const scope = scopes.getStore();
  if (scope) delete scope.cooldowns;
}

function workdayHost(raw: string): string | undefined {
  const { protocol, hostname } = new URL(raw);
  return protocol === "https:" && hostname.endsWith(".myworkdayjobs.com") ? hostname : undefined;
}

function activeCooldown(value: Cooldown | undefined, now: number): value is Cooldown {
  return (value?.status === 403 || value?.status === 429) && Number.isSafeInteger(value.until) && value.until > now;
}

function loadCooldowns(scope: Scope, now: number): Cooldowns {
  if (scope.cooldowns) return scope.cooldowns;
  try {
    const saved = JSON.parse(readFileSync(scope.file, "utf8")) as Cooldowns;
    const hosts = Object.fromEntries(Object.entries(saved.hosts ?? {}).filter(([host, value]) =>
      host.endsWith(".myworkdayjobs.com") && activeCooldown(value, now)));
    return scope.cooldowns = { hosts, ...(activeCooldown(saved.family, now) ? { family: saved.family } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return scope.cooldowns = { hosts: {} };
  }
}

function assertAvailable(scope: Scope, host: string, now: number): void {
  const { family, hosts } = loadCooldowns(scope, now);
  const tenant = hosts[host];
  const cooldown = family && family.until >= (tenant?.until ?? 0) ? family : tenant;
  if (activeCooldown(cooldown, now)) throw new WorkdayCooldownError(cooldown.status, cooldown.until - now);
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
    const now = Date.now();
    assertAvailable(scope, host, now);
    const waitMs = scope.nextRequestAt - now;
    if (waitMs <= 0) {
      scope.nextRequestAt = now + randomInt(500, 1201);
      return;
    }
    await sleep(waitMs, undefined, { signal }).catch(error => {
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
  if (!challenge && status === 403) return undefined;
  const now = Date.now();
  const retryAfter = parseOfficialRetryAfter(headers.get("retry-after"), now);
  const delayMs = Math.max(challenge ? challengeCooldownMs : plainRateLimitCooldownMs,
    retryAfter && "delayMs" in retryAfter ? retryAfter.delayMs : 0);
  const cooldowns = loadCooldowns(scope, now);
  const previous = challenge ? cooldowns.family : cooldowns.hosts[host];
  const until = Math.max(now + delayMs, previous?.until ?? 0);
  if (previous?.until !== until) {
    const cooldown: Cooldown = { status, until };
    if (challenge) cooldowns.family = cooldown;
    else cooldowns.hosts[host] = cooldown;
    const temporary = scope.file + "." + randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, JSON.stringify(cooldowns) + "\n", { flag: "wx", mode: 0o600 });
      renameSync(temporary, scope.file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return until - now;
}

export function workdayRetryAfterHeader(response: Response): string | null {
  return effectiveRetryHeaders.get(response) ?? response.headers.get("retry-after");
}

export async function observeWorkdayResponse(url: string, response: Response, signal: AbortSignal): Promise<void> {
  if (!scopes.getStore() || (response.status !== 429 && response.status !== 403) || !workdayHost(url)) return;
  const finalUrl = response.url || url;
  if (!workdayHost(finalUrl)) return;
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
  const delayMs = recordWorkdayAccessResponse(finalUrl, response.status, headers, challengeHtml);
  if (delayMs !== undefined) effectiveRetryHeaders.set(response, String(Math.ceil(delayMs / 1000)));
}
