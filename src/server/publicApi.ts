import { ZodError } from "zod";
import { SearchRequestSchema } from "../domain/search";
import { searchJobsFromDatabase, type PrismaJobSearchDb } from "./jobSearchService";
import {
  createFeedback,
  createRecommendedCompany,
  type FeedbackDb,
  type FeedbackInput,
  type RecommendedCompanyInput,
  type RequestContext
} from "./feedbackService";
import { checkRateLimit, classifySuspiciousRequest, createMemoryRateLimitStore, type RateLimitStore } from "./rateLimit";
import { listCompanyCoverage, type CoverageDb } from "./coverageService";
import { getStaticDocument } from "./staticDocuments";

export interface PublicApiRequest {
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
  ip: string;
  userAgent?: string;
}

export interface PublicApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

type PublicApiDb = PrismaJobSearchDb & CoverageDb & FeedbackDb;

export interface PublicApiDeps {
  db: PublicApiDb;
  now?: () => Date;
  rateLimitStore?: RateLimitStore;
}

const DEFAULT_RATE_LIMIT_STORE = createMemoryRateLimitStore();

export async function handlePublicApi(request: PublicApiRequest, deps: PublicApiDeps): Promise<PublicApiResponse> {
  const headers = createBaseHeaders(request.path);

  if (request.path === "/privacy" || request.path === "/terms") {
    return {
      status: 200,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
      body: getStaticDocument(request.path.slice(1) as "privacy" | "terms")
    };
  }

  if (request.path === "/robots.txt") {
    return {
      status: 200,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
      body: "User-agent: *\nDisallow: /api/\nDisallow: /admin/\n"
    };
  }

  if (request.path === "/healthz") {
    return {
      status: 200,
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
      body: { ok: true }
    };
  }

  if (request.path.startsWith("/api/")) {
    const consent = request.headers["x-job-search-consent"];

    if (consent !== "accepted") {
      return {
        status: 403,
        headers,
        body: { error: "CONSENT_REQUIRED" }
      };
    }

    const context = toRequestContext(request);
    const suspicious = classifySuspiciousRequest({
      path: request.path,
      query: normalizeStringQuery(request.query),
      userAgent: context.userAgent
    });

    if (suspicious.action === "CHALLENGE") {
      return {
        status: 429,
        headers,
        body: { error: "CHALLENGE_REQUIRED", reason: suspicious.reason }
      };
    }

    const decision = checkRateLimit(
      {
        key: `${request.ip}:${request.path}`,
        now: deps.now?.() ?? new Date(),
        windowMs: 60_000,
        max: 30
      },
      deps.rateLimitStore ?? DEFAULT_RATE_LIMIT_STORE
    );

    if (!decision.allowed) {
      return {
        status: 429,
        headers: { ...headers, "retry-after": String(decision.retryAfterSeconds) },
        body: { error: "RATE_LIMITED", remaining: decision.remaining }
      };
    }

    if (request.path === "/api/search" && request.method === "GET") {
      const parsed = SearchRequestSchema.safeParse(normalizeSearchRequest(request.query));

      if (!parsed.success) {
        return invalidRequest(headers, parsed.error);
      }

      const result = await searchJobsFromDatabase(parsed.data, deps.db);
      return {
        status: 200,
        headers,
        body: result
      };
    }

    if (request.path === "/api/coverage" && request.method === "GET") {
      const result = await listCompanyCoverage({ keyword: getSingleValue(request.query.keyword) ?? "" }, deps.db);
      return {
        status: 200,
        headers,
        body: result
      };
    }

    if (request.path === "/api/feedback" && request.method === "POST") {
      const body = normalizeFeedbackInput(request.body);
      const result = await createFeedback(body, context, deps.db);
      return {
        status: 201,
        headers,
        body: result
      };
    }

    if (request.path === "/api/recommend-company" && request.method === "POST") {
      const body = normalizeRecommendedCompanyInput(request.body);
      const result = await createRecommendedCompany(body, context, deps.db);
      return {
        status: 201,
        headers,
        body: result
      };
    }
  }

  return {
    status: 404,
    headers,
    body: { error: "NOT_FOUND" }
  };
}

function createBaseHeaders(path: string): Record<string, string> {
  if (path.startsWith("/api/") || path.startsWith("/admin/")) {
    return { "x-robots-tag": "noindex, nofollow" };
  }

  return {};
}

function toRequestContext(request: PublicApiRequest): RequestContext {
  return {
    ip: request.ip,
    userAgent: request.userAgent ?? request.headers["user-agent"] ?? ""
  };
}

function normalizeStringQuery(
  query: Record<string, string | string[] | undefined>
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, getSingleValue(value)]));
}

function normalizeSearchRequest(query: Record<string, string | string[] | undefined>): unknown {
  return {
    city: getSingleValue(query.city) ?? "",
    categories: getMultiValue(query.categories),
    keyword: getSingleValue(query.keyword),
    companyIds: getMultiValue(query.companyIds),
    sort: getSingleValue(query.sort),
    newWithinDays: parseOptionalNumber(getSingleValue(query.newWithinDays))
  };
}

function normalizeFeedbackInput(body: unknown): FeedbackInput {
  const data = asRecord(body);
  return {
    issueType: requireString(data.issueType, "issueType"),
    description: requireString(data.description, "description"),
    ...(typeof data.companyId === "string" ? { companyId: data.companyId } : {}),
    ...(typeof data.jobId === "string" ? { jobId: data.jobId } : {})
  };
}

function normalizeRecommendedCompanyInput(body: unknown): RecommendedCompanyInput {
  const data = asRecord(body);
  return {
    companyName: requireString(data.companyName, "companyName"),
    officialWebsiteUrl: requireString(data.officialWebsiteUrl, "officialWebsiteUrl")
  };
}

function getSingleValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function getMultiValue(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter((entry) => entry !== "");
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }

  return [];
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function invalidRequest(headers: Record<string, string>, error: ZodError): PublicApiResponse {
  return {
    status: 400,
    headers,
    body: {
      error: "INVALID_REQUEST",
      details: error.issues.map((issue) => issue.message)
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }

  throw new Error("Request body must be an object");
}

function requireString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  throw new Error(`Invalid ${field}`);
}
