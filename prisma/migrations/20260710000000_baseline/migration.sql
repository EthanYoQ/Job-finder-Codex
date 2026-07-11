-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'ENTRY_FOUND_PENDING_ADAPTER', 'VERIFIED_SCRAPABLE', 'TEMP_UNSCRAPABLE', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('SOCIAL', 'CAMPUS');

-- CreateEnum
CREATE TYPE "AtsKind" AS ENUM ('OFFICIAL_HTML', 'OFFICIAL_JSON', 'MOKA', 'BEISEN_ZHIYE', 'WORKDAY', 'SUCCESSFACTORS', 'REDSEA', 'BROWSER_FALLBACK', 'UNKNOWN', 'HOTJOB_WECRUIT');

-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "RequiredJobField" AS ENUM ('company', 'title', 'officialUrl', 'location');

-- CreateEnum
CREATE TYPE "CompletenessStatus" AS ENUM ('VERIFIED', 'NEEDS_MANUAL_COMPLETENESS_REVIEW', 'INCOMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "CompletenessEvidenceKind" AS ENUM ('OFFICIAL_TOTAL_COUNT', 'OFFICIAL_TOTAL_PAGES', 'COMPLETE_PAGE_TRAVERSAL', 'WEAK_MANUAL_SAMPLE', 'FETCH_FAILURE');

-- CreateEnum
CREATE TYPE "JobCategory" AS ENUM ('销售', '市场', '商务', '渠道', 'KA', '医学事务', '临床运营', '注册', '药物警戒/安全', '研发/科学', '生产/工程', '质量', '市场准入/政府事务', '数据/IT', '供应链/采购', '职能', '其他');

-- CreateEnum
CREATE TYPE "JobLifecycleStatus" AS ENUM ('ACTIVE', 'SUSPECTED_OFFLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'REVIEWED', 'CLOSED', 'SPAM');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN');

-- CreateEnum
CREATE TYPE "AdminSessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ManualCrawlStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "officialChineseName" TEXT NOT NULL,
    "officialWebsiteUrl" TEXT NOT NULL,
    "pinyinName" TEXT NOT NULL,
    "inclusionReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "atsKind" "AtsKind" NOT NULL,
    "officialEntryUrl" TEXT NOT NULL,
    "officialChainEvidenceUrl" TEXT NOT NULL,
    "campusEntryUrl" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlBatch" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "CrawlStatus" NOT NULL,

    CONSTRAINT "CrawlBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlObservation" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "crawledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "successful" BOOLEAN NOT NULL,
    "structuredJobCount" INTEGER NOT NULL DEFAULT 0,
    "stableRequiredFields" "RequiredJobField"[],
    "failureReason" TEXT,
    "expectedJobCount" INTEGER,
    "completenessBlockerReason" TEXT,
    "completenessEvidenceKind" "CompletenessEvidenceKind",
    "completenessEvidenceUrl" TEXT,
    "completenessStatus" "CompletenessStatus",
    "pageSize" INTEGER,
    "pagesVisited" INTEGER,
    "totalPages" INTEGER,

    CONSTRAINT "CrawlObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sourceJobId" TEXT,
    "officialTitle" TEXT NOT NULL,
    "auxiliaryChineseTitle" TEXT,
    "officialUrl" TEXT NOT NULL,
    "listUrl" TEXT,
    "locationRaw" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" "JobCategory" NOT NULL,
    "secondaryCategory" "JobCategory",
    "classificationConfidence" DOUBLE PRECISION,
    "classificationRationale" TEXT,
    "classificationModelVersion" TEXT,
    "classificationHardRuleHit" TEXT,
    "humanCorrectedCategory" "JobCategory",
    "humanCorrectedSecondaryCategory" "JobCategory",
    "humanCorrectionReason" TEXT,
    "humanCorrectedAt" TIMESTAMP(3),
    "officialPublishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingSuccessCount" INTEGER NOT NULL DEFAULT 0,
    "lifecycleStatus" "JobLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "visibleInFrontend" BOOLEAN NOT NULL DEFAULT true,
    "isNew" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "jobId" TEXT,
    "issueType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "contact" TEXT,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendedCompany" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "officialWebsiteUrl" TEXT,
    "recruitmentEntryUrl" TEXT,
    "reason" TEXT,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendedCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "AdminSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditEvent" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualCrawlRequest" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ManualCrawlStatus" NOT NULL DEFAULT 'QUEUED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "ManualCrawlRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_officialChineseName_key" ON "Company"("officialChineseName");

-- CreateIndex
CREATE INDEX "Company_pinyinName_idx" ON "Company"("pinyinName");

-- CreateIndex
CREATE INDEX "RecruitmentSource_companyId_kind_idx" ON "RecruitmentSource"("companyId", "kind");

-- CreateIndex
CREATE INDEX "RecruitmentSource_status_idx" ON "RecruitmentSource"("status");

-- CreateIndex
CREATE INDEX "CrawlObservation_sourceId_crawledAt_idx" ON "CrawlObservation"("sourceId", "crawledAt");

-- CreateIndex
CREATE INDEX "CrawlObservation_successful_idx" ON "CrawlObservation"("successful");

-- CreateIndex
CREATE INDEX "Job_city_category_idx" ON "Job"("city", "category");

-- CreateIndex
CREATE INDEX "Job_companyId_lifecycleStatus_idx" ON "Job"("companyId", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "Job_visibleInFrontend_lifecycleStatus_idx" ON "Job"("visibleInFrontend", "lifecycleStatus");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_sourceId_dedupeKey_key" ON "Job"("sourceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendedCompany_status_createdAt_idx" ON "RecommendedCompany"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccessEvent_ip_occurredAt_idx" ON "AccessEvent"("ip", "occurredAt");

-- CreateIndex
CREATE INDEX "AccessEvent_eventType_occurredAt_idx" ON "AccessEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_role_idx" ON "AdminUser"("role");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AdminSession_adminUserId_status_idx" ON "AdminSession"("adminUserId", "status");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_adminUserId_createdAt_idx" ON "AdminAuditEvent"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_action_createdAt_idx" ON "AdminAuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "ManualCrawlRequest_sourceId_status_idx" ON "ManualCrawlRequest"("sourceId", "status");

-- CreateIndex
CREATE INDEX "ManualCrawlRequest_requestedById_createdAt_idx" ON "ManualCrawlRequest"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "ManualCrawlRequest_status_createdAt_idx" ON "ManualCrawlRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RecruitmentSource" ADD CONSTRAINT "RecruitmentSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlObservation" ADD CONSTRAINT "CrawlObservation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CrawlBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditEvent" ADD CONSTRAINT "AdminAuditEvent_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualCrawlRequest" ADD CONSTRAINT "ManualCrawlRequest_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RecruitmentSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualCrawlRequest" ADD CONSTRAINT "ManualCrawlRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
