export interface RateLimitInput {
  key: string;
  now: Date;
  windowMs: number;
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export interface RateLimitStore {
  hits: Map<string, number[]>;
}

export interface SuspiciousRequestInput {
  path: string;
  query: Record<string, string | undefined>;
  userAgent: string;
  maxLimit?: number;
}

export interface ChallengeDecision {
  action: "ALLOW" | "CHALLENGE";
  reason?: string;
}

export function createMemoryRateLimitStore(): RateLimitStore {
  return { hits: new Map() };
}

export function checkRateLimit(input: RateLimitInput, store: RateLimitStore): RateLimitDecision {
  const nowMs = input.now.getTime();
  const validAfter = nowMs - input.windowMs;
  const previous = store.hits.get(input.key) ?? [];
  const retained = previous.filter((timestamp) => timestamp > validAfter);

  if (retained.length >= input.max) {
    const oldest = retained[0] ?? nowMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + input.windowMs - nowMs) / 1000)),
      remaining: 0
    };
  }

  retained.push(nowMs);
  store.hits.set(input.key, retained);

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, input.max - retained.length)
  };
}

export function classifySuspiciousRequest(input: SuspiciousRequestInput): ChallengeDecision {
  if (input.path === "/privacy" || input.path === "/terms") {
    return { action: "ALLOW" };
  }

  const limit = Number(input.query.limit ?? "0");
  const offset = Number(input.query.offset ?? "0");
  const userAgent = input.userAgent.toLocaleLowerCase();
  const maxLimit = input.maxLimit ?? 50;

  if (limit > maxLimit || offset > 500) {
    return { action: "CHALLENGE", reason: "bulk pagination pattern" };
  }

  if (/(python-requests|scrapy|curl|wget|bot|spider)/i.test(userAgent)) {
    return { action: "CHALLENGE", reason: "automation user agent" };
  }

  return { action: "ALLOW" };
}
