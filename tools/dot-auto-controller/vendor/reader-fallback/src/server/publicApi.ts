import { z, ZodError } from "zod";
import { COMPANY_EXPANSION_PAGE_SIZE, PortableSearchRequestSchema, SearchRequestSchema } from "../domain/search";
import { canonicalPhase1ScopeCounts } from "../data/phase1ScopePolicy";
import {
  searchJobsFromDatabase,
  type PrismaJobSearchDb,
  type PublicationSnapshotReader
} from "./jobSearchService";
import {
  createFeedback,
  createRecommendedCompany,
  type FeedbackDb,
  type RequestContext
} from "./feedbackService";
import { checkRateLimit, classifySuspiciousRequest, createMemoryRateLimitStore, type RateLimitStore } from "./rateLimit";
import { listCompanyCoverage, type CoverageDb } from "./coverageService";
import { getStaticDocument } from "./staticDocuments";
import { normalizePostgresReadinessTimeout } from "./postgresReadiness";
import type { PortablePublicSnapshot, PortableSnapshotRead, SnapshotReadTiming } from "../db/portablePublicSnapshotRepository";
import { searchPortableSnapshot, coverageFromPortableSnapshot } from "./portablePublicationApi";

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
  checkDatabaseReadiness: () => Promise<boolean>;
  readinessTimeoutMs?: number;
  now?: () => Date;
  rateLimitStore?: RateLimitStore;
  readPublicationSnapshot?: PublicationSnapshotReader;
  /** HTTP finish/close barrier; omitted by non-HTTP callers. */
  responseFinished?: Promise<void>;
  recordTiming?: SnapshotReadTiming;
  readPortableSnapshot?: (() => Promise<PortablePublicSnapshot>) & {
    readWithStatus?: (responseFinished?: Promise<void>, recordTiming?: SnapshotReadTiming) => Promise<PortableSnapshotRead>;
  };
}

const DEFAULT_RATE_LIMIT_STORE = createMemoryRateLimitStore();
const SEARCH_API_LIMIT = 50;
const COVERAGE_API_LIMIT = canonicalPhase1ScopeCounts.fixedRosterCompanyCount;
const API_MAX_WINDOW = 500;

function apiPaginationSchema(defaultLimit: number, maxLimit: number) {
  return z
  .object({
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit)
  })
  .refine((value) => value.offset + value.limit <= API_MAX_WINDOW, {
    message: "Pagination exceeds the controlled loading cap"
  });
}

const SearchApiPaginationSchema = apiPaginationSchema(SEARCH_API_LIMIT, SEARCH_API_LIMIT);
const CoverageApiPaginationSchema = apiPaginationSchema(COVERAGE_API_LIMIT, COVERAGE_API_LIMIT);

const FeedbackInputSchema = z.object({
  issueType: z.string().trim().min(1),
  description: z.string().trim().min(1),
  contact: z.string().trim().min(1).optional(),
  companyId: z.string().trim().min(1).optional(),
  jobId: z.string().trim().min(1).optional()
}).superRefine((value, context) => {
  const privacy = value.issueType === "PRIVACY_EXPORT" || value.issueType === "PRIVACY_DELETE";
  if (privacy && (!value.contact || value.companyId !== undefined || value.jobId !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid privacy request" });
  }
  if (!privacy && value.contact !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "contact is reserved for privacy requests" });
  }
});

const RecommendedCompanyInputSchema = z.object({
  companyName: z.string().trim().min(1),
  officialWebsiteUrl: z.string().trim().min(1)
});

export async function handlePublicApi(request: PublicApiRequest, deps: PublicApiDeps): Promise<PublicApiResponse> {
  const headers = createBaseHeaders(request.path);

  if (request.path === "/privacy" || request.path === "/terms") {
    const document = getStaticDocument(request.path.slice(1) as "privacy" | "terms");
    return {
      status: 200,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
      body: `${document.title}\n\n${document.body}`
    };
  }

  if (request.path === "/robots.txt") {
    return {
      status: 200,
      headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
      body: "User-agent: *\nDisallow: /api/\nDisallow: /admin/\n"
    };
  }

  if (request.path === "/livez") {
    return {
      status: 200,
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
      body: { ok: true }
    };
  }

  if (request.path === "/readyz" || request.path === "/healthz") {
    const ok = await getBoundedDatabaseReadiness(deps);
    return {
      status: ok ? 200 : 503,
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
      body: { ok }
    };
  }

  if (request.path.startsWith("/api/")) {
    const consent = request.headers["x-job-search-consent"];
    const isPrivacyFeedback = request.path === "/api/feedback" && request.method === "POST" &&
      isPrivacyIssueType(request.body);

    if (consent !== "accepted" && !isPrivacyFeedback) {
      return {
        status: 403,
        headers,
        body: { error: "CONSENT_REQUIRED" }
      };
    }

    const paginationValidation = validateApiPagination(request);

    if (!paginationValidation.success) {
      return invalidRequest(headers, paginationValidation.error);
    }

    const context = toRequestContext(request);
    const suspicious = classifySuspiciousRequest({
      path: request.path,
      query: normalizeStringQuery(request.query),
      userAgent: context.userAgent,
      maxLimit: request.path === "/api/coverage" ? COVERAGE_API_LIMIT : SEARCH_API_LIMIT
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
      const searchSchema = deps.readPortableSnapshot ? PortableSearchRequestSchema : SearchRequestSchema;
      const parsed = searchSchema.safeParse(normalizeSearchRequest(request.query));

      if (!parsed.success) {
        return invalidRequest(headers, parsed.error);
      }

      const read = deps.readPortableSnapshot;
      const readStartedAt = performance.now();
      const display = read ? await (read.readWithStatus?.(deps.responseFinished, deps.recordTiming) ?? read().then(snapshot => ({snapshot}))) : undefined;
      if (read) deps.recordTiming?.("read", performance.now() - readStartedAt);
      const projectStartedAt = performance.now();
      const result = display
        ? {...searchPortableSnapshot(parsed.data, display.snapshot), ...("snapshotRefresh" in display ? {snapshotRefresh: display.snapshotRefresh} : {})}
        : await searchJobsFromDatabase(parsed.data, deps.db, deps.readPublicationSnapshot);
      const pagedCompanies = result.companies.slice(
        paginationValidation.data.offset,
        paginationValidation.data.offset + paginationValidation.data.limit
      );
      if (read) deps.recordTiming?.("project", performance.now() - projectStartedAt);

      return {
        status: 200,
        headers,
        body: {
          ...result,
          companies: pagedCompanies.map((company) => ({
            ...company,
            jobs: deps.readPortableSnapshot ? company.jobs : company.jobs.slice(0, COMPANY_EXPANSION_PAGE_SIZE)
          }))
        }
      };
    }

    if (request.path === "/api/coverage" && request.method === "GET") {
      const coverageRequest = {
          keyword: getSingleValue(request.query.keyword) ?? "",
          offset: paginationValidation.data.offset,
          limit: paginationValidation.data.limit
        };
      const read = deps.readPortableSnapshot;
      const readStartedAt = performance.now();
      const display = read ? await (read.readWithStatus?.(deps.responseFinished, deps.recordTiming) ?? read().then(snapshot => ({snapshot}))) : undefined;
      if (read) deps.recordTiming?.("read", performance.now() - readStartedAt);
      const projectStartedAt = performance.now();
      const result = display
        ? {...coverageFromPortableSnapshot(coverageRequest, display.snapshot), ...("snapshotRefresh" in display ? {snapshotRefresh: display.snapshotRefresh} : {})}
        : await listCompanyCoverage(coverageRequest, deps.db, deps.readPublicationSnapshot);
      if (read) deps.recordTiming?.("project", performance.now() - projectStartedAt);
      return {
        status: 200,
        headers,
        body: result
      };
    }

    if (request.path === "/api/feedback" && request.method === "POST") {
      const body = normalizeFeedbackInput(request.body);

      if (!body.success) {
        return invalidRequest(headers, body.error);
      }

      const result = await createFeedback(body.data, context, deps.db);
      return {
        status: 201,
        headers,
        body: result
      };
    }

    if (request.path === "/api/recommend-company" && request.method === "POST") {
      const body = normalizeRecommendedCompanyInput(request.body);

      if (!body.success) {
        return invalidRequest(headers, body.error);
      }

      const result = await createRecommendedCompany(body.data, context, deps.db);
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

async function getBoundedDatabaseReadiness(deps: PublicApiDeps): Promise<boolean> {
  const timeoutMs = normalizePostgresReadinessTimeout(deps.readinessTimeoutMs);
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => deps.checkDatabaseReadiness()),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
    province: getSingleValue(query.province),
    categories: getMultiValue(query.categories),
    keyword: getSingleValue(query.keyword),
    companyIds: getMultiValue(query.companyIds),
    sort: getSingleValue(query.sort),
    newWithinDays: parseOptionalNumber(getSingleValue(query.newWithinDays))
  };
}

function validateApiPagination(request: PublicApiRequest) {
  if (
    request.method === "GET" &&
    (request.path === "/api/search" || request.path === "/api/coverage")
  ) {
    const schema = request.path === "/api/coverage"
      ? CoverageApiPaginationSchema
      : SearchApiPaginationSchema;
    return schema.safeParse({
      offset: getSingleValue(request.query.offset),
      limit: getSingleValue(request.query.limit)
    });
  }

  return SearchApiPaginationSchema.safeParse({});
}

function normalizeFeedbackInput(body: unknown) {
  const parsed = FeedbackInputSchema.safeParse(body);

  if (!parsed.success) {
    return parsed;
  }

  return {
    success: true as const,
    data: {
      issueType: parsed.data.issueType,
      description: parsed.data.description,
      ...(parsed.data.companyId === undefined ? {} : { companyId: parsed.data.companyId }),
      ...(parsed.data.jobId === undefined ? {} : { jobId: parsed.data.jobId }),
      ...(parsed.data.contact === undefined ? {} : { contact: parsed.data.contact })
    }
  };
}

function isPrivacyIssueType(body: unknown): boolean {
  if (typeof body !== "object" || body === null || !("issueType" in body)) return false;
  return body.issueType === "PRIVACY_EXPORT" || body.issueType === "PRIVACY_DELETE";
}

function normalizeRecommendedCompanyInput(body: unknown) {
  return RecommendedCompanyInputSchema.safeParse(body);
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
