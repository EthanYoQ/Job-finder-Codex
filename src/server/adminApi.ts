import { z } from "zod";
import {
  applyJobCategoryCorrection,
  listSourceHealth,
  queueManualCrawl,
  reviewFeedback,
  reviewRecommendedCompany,
  type AdminOperationContext,
  type AdminOperationsDb
} from "../admin/operations";
import {
  assertActiveAdminSession,
  createAdminSession,
  verifyAdminPassword,
  type AdminAuthDb
} from "../admin/auth";
import { buildAdminDashboardModel } from "../admin/adminViewModel";
import { JOB_CATEGORIES, type JobCategory } from "../domain/search";
import { ManualCrawlRequestRepositoryError } from "../db/manualCrawlRequestRepository";
import { processPrivacyRequest, type PrivacyOperationsDb } from "../admin/privacyOperations";

export interface AdminApiRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: unknown;
  ip: string;
  userAgent?: string;
}

export interface AdminApiResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

type AdminApiDb = AdminAuthDb &
  AdminOperationsDb & {
    adminUser: {
      findUnique(args: {
        where: { email: string };
        select: { id: true; passwordHash: true; disabledAt: true };
      }): Promise<{ id: string; passwordHash: string; disabledAt: Date | null } | null>;
    };
    feedback: AdminOperationsDb["feedback"] & {
      findMany(args: unknown): Promise<
        Array<{
          id: string;
          issueType: string;
          description: string;
          status: string;
          createdAt: Date;
          companyId: string | null;
          jobId: string | null;
          contact?: string | null;
        }>
      >;
    };
    recommendedCompany: AdminOperationsDb["recommendedCompany"] & {
      findMany(args: unknown): Promise<
        Array<{
          id: string;
          companyName: string;
          officialWebsiteUrl: string | null;
          recruitmentEntryUrl: string | null;
          reason: string | null;
          status: string;
          createdAt: Date;
        }>
      >;
    };
    job: AdminOperationsDb["job"] & {
      findMany(args: {
        where: {
          lifecycleStatus: "ACTIVE";
          visibleInFrontend: true;
          category: "OTHER";
          humanCorrectedCategory: null;
        };
        include: { company: { select: { officialChineseName: true } } };
        orderBy: { firstSeenAt: "desc" };
        take: 50;
      }): Promise<
        Array<{
          id: string;
          officialTitle: string;
          auxiliaryChineseTitle: string | null;
          category: string;
          company: { officialChineseName: string };
        }>
      >;
    };
  };

export interface AdminApiDeps {
  db: AdminApiDb;
  now?: () => Date;
}

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1)
});

const ManualCrawlSchema = z.object({
  sourceId: z.string().trim().min(1),
  reason: z.string().trim().min(1).default("admin-console")
});

const FeedbackReviewSchema = z.object({
  feedbackId: z.string().trim().min(1),
  status: z.enum(["REVIEWED", "CLOSED"])
});

const RecommendationReviewSchema = z.object({
  recommendationId: z.string().trim().min(1),
  status: z.enum(["REVIEWED", "CLOSED"])
});

const CategoryCorrectionSchema = z.object({
  jobId: z.string().trim().min(1),
  category: z.enum(JOB_CATEGORIES),
  secondaryCategory: z.enum(JOB_CATEGORIES).optional(),
  reason: z.string().trim().min(1)
});

const PrivacyProcessSchema = z.object({
  requestId: z.string().trim().min(1),
  action: z.enum(["EXPORT", "DELETE"]),
  verifiedContact: z.string().min(1)
});

export async function handleAdminApi(request: AdminApiRequest, deps: AdminApiDeps): Promise<AdminApiResponse> {
  const headers = { "x-robots-tag": "noindex, nofollow" };

  if (request.path === "/admin/api/login" && request.method === "POST") {
    const parsed = LoginSchema.safeParse(request.body);

    if (!parsed.success) {
      return badRequest(headers);
    }

    const adminUser = await deps.db.adminUser.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, passwordHash: true, disabledAt: true }
    });

    if (
      adminUser === null ||
      adminUser.disabledAt !== null ||
      !(await verifyAdminPassword(parsed.data.password, adminUser.passwordHash))
    ) {
      return { status: 401, headers, body: { error: "INVALID_ADMIN_CREDENTIALS" } };
    }

    const session = await createAdminSession(adminUser.id, toSessionContext(request), {
      db: deps.db,
      ...(deps.now === undefined ? {} : { now: deps.now })
    });

    return { status: 200, headers, body: session };
  }

  const session = await getAdminSession(request, deps);

  if (session === null) {
    return { status: 401, headers, body: { error: "ADMIN_AUTH_REQUIRED" } };
  }

  const operationContext: AdminOperationContext = {
    adminUserId: session.adminUserId,
    ip: request.ip,
    userAgent: request.userAgent ?? request.headers["user-agent"] ?? ""
  };

  if (request.path === "/admin/api/dashboard" && request.method === "GET") {
    const [sourceHealth, feedbackQueue, recommendationQueue, categoryCorrectionQueue] = await Promise.all([
      listSourceHealth({ db: deps.db }),
      listFeedbackQueue(deps.db),
      listRecommendationQueue(deps.db),
      listCategoryCorrectionQueue(deps.db)
    ]);

    return {
      status: 200,
      headers,
      body: buildAdminDashboardModel({
        sourceHealth,
        feedbackQueue,
        recommendationQueue,
        categoryCorrectionQueue
      })
    };
  }

  if (request.path === "/admin/api/manual-crawl" && request.method === "POST") {
    const parsed = ManualCrawlSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(headers);
    try {
      return {
        status: 202,
        headers,
        body: await queueManualCrawl(parsed.data, operationContext, { db: deps.db })
      };
    } catch (error) {
      if (error instanceof ManualCrawlRequestRepositoryError) {
        return {
          status: error.code === "ALREADY_ACTIVE" ? 409 : 422,
          headers,
          body: { error: error.code }
        };
      }
      throw error;
    }
  }

  if (request.path === "/admin/api/feedback-review" && request.method === "POST") {
    const parsed = FeedbackReviewSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(headers);
    return {
      status: 200,
      headers,
      body: await reviewFeedback(parsed.data, operationContext, { db: deps.db, ...(deps.now === undefined ? {} : { now: deps.now }) })
    };
  }

  if (request.path === "/admin/api/recommendation-review" && request.method === "POST") {
    const parsed = RecommendationReviewSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(headers);
    return {
      status: 200,
      headers,
      body: await reviewRecommendedCompany(parsed.data, operationContext, { db: deps.db, ...(deps.now === undefined ? {} : { now: deps.now }) })
    };
  }

  if (request.path === "/admin/api/privacy-process" && request.method === "POST") {
    const parsed = PrivacyProcessSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(headers);
    try {
      return { status: 200, headers, body: await processPrivacyRequest(parsed.data, operationContext, {
        db: deps.db as unknown as PrivacyOperationsDb,
        ...(deps.now === undefined ? {} : { now: deps.now })
      }) };
    } catch (error) {
      if (error instanceof Error && error.message === "PRIVACY_REQUEST_VERIFICATION_FAILED") {
        return { status: 403, headers, body: { error: error.message } };
      }
      throw error;
    }
  }

  if (request.path === "/admin/api/category-correction" && request.method === "POST") {
    const parsed = CategoryCorrectionSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(headers);
    return {
      status: 200,
      headers,
      body: await applyJobCategoryCorrection(
        {
          jobId: parsed.data.jobId,
          category: parsed.data.category,
          ...(parsed.data.secondaryCategory === undefined
            ? {}
            : { secondaryCategory: parsed.data.secondaryCategory }),
          reason: parsed.data.reason
        },
        operationContext,
        { db: deps.db }
      )
    };
  }

  return { status: 404, headers, body: { error: "NOT_FOUND" } };
}

async function getAdminSession(request: AdminApiRequest, deps: AdminApiDeps) {
  const token = readBearerToken(request.headers.authorization) ?? request.headers["x-admin-token"];
  if (!token) return null;

  try {
    return await assertActiveAdminSession(token, toSessionContext(request), {
      db: deps.db,
      ...(deps.now === undefined ? {} : { now: deps.now })
    });
  } catch {
    return null;
  }
}

function toSessionContext(request: AdminApiRequest) {
  return {
    ip: request.ip,
    userAgent: request.userAgent ?? request.headers["user-agent"] ?? ""
  };
}

function readBearerToken(value: string | undefined): string | undefined {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }

  return value.slice("Bearer ".length);
}

function badRequest(headers: Record<string, string>): AdminApiResponse {
  return { status: 400, headers, body: { error: "INVALID_REQUEST" } };
}

async function listFeedbackQueue(db: AdminApiDb) {
  const rows = await db.feedback.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return rows.map((row) => ({
    id: row.id,
    companyName: row.companyId ?? "未关联公司",
    jobTitle: row.jobId ?? "未关联职位",
    issueType: row.issueType,
    description: row.description,
    contact: row.contact ?? null,
    status: row.status,
    createdAt: row.createdAt
  }));
}

async function listRecommendationQueue(db: AdminApiDb) {
  const rows = await db.recommendedCompany.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return rows.map((row) => ({
    id: row.id,
    companyName: row.companyName,
    officialWebsiteUrl: row.officialWebsiteUrl ?? row.recruitmentEntryUrl ?? "",
    note: row.reason ?? "",
    status: row.status,
    createdAt: row.createdAt
  }));
}

async function listCategoryCorrectionQueue(db: AdminApiDb) {
  const rows = await db.job.findMany({
    where: {
      lifecycleStatus: "ACTIVE",
      visibleInFrontend: true,
      category: "OTHER",
      humanCorrectedCategory: null
    },
    include: { company: { select: { officialChineseName: true } } },
    orderBy: { firstSeenAt: "desc" },
    take: 50
  });

  return rows.map((row) => ({
    jobId: row.id,
    companyName: row.company.officialChineseName,
    jobTitle: row.auxiliaryChineseTitle ?? row.officialTitle,
    currentCategory: "其他" as JobCategory,
    suggestedCategory: "其他" as JobCategory
  }));
}
