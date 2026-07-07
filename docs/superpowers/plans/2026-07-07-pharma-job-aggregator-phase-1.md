# Pharma Job Aggregator Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested Phase 1 foundation for company source management, verification gating, controlled search contracts, and privacy/SEO route policy before any Product Design UI implementation.

**Architecture:** Start with a TypeScript domain layer and test harness, then add Prisma schema and route-policy/query-contract modules. Phase 1 deliberately avoids final UI: the Product Design workflow still requires three visual directions and a selected target before frontend implementation.

**Tech Stack:** TypeScript, Vitest, Zod, Prisma, PostgreSQL-ready schema, Node.js runtime.

## Global Constraints

- P0 candidate pool target is 80-120 companies.
- Formal P0 launch is blocked until at least 50 companies are marked `VERIFIED_SCRAPABLE`.
- `VERIFIED_SCRAPABLE` requires official chain evidence, structured job records, two successful stable crawls, and company/title/officialUrl/location fields.
- City is required for search; job category filter, keyword filter, and company filter are optional; normalized job records still store a main category, and low-confidence classifications are stored as `其他`.
- No public API, no bulk export, no deep pagination, no stable third-party query contract.
- Before privacy consent, only privacy policy, service terms, and static homepage shell may be accessed.
- Search-result pages and city/category result pages must not be indexed.
- Company expansion must use controlled loading with a hard server-side cap.
- Frontend UI implementation is out of this plan until Product Design produces three visual directions and the user selects one.
- Current workspace is not a git repository. Task 1 initializes git so later task commit steps can run.

---

## File Structure

- `package.json`: Node scripts, dependencies, and engine floor.
- `tsconfig.json`: TypeScript configuration.
- `vitest.config.ts`: test runner configuration.
- `.gitignore`: generated files and secrets exclusions.
- `.env.example`: local environment variable contract.
- `src/domain/company.ts`: company, source, crawl, and verification domain types.
- `src/domain/verification.ts`: verification-gate functions.
- `src/domain/search.ts`: search input/output contracts and controlled expansion constants.
- `src/domain/route-policy.ts`: consent, SEO, indexing, and analytics route decisions.
- `prisma/schema.prisma`: PostgreSQL-ready data model.
- `tests/domain/verification.test.ts`: verification gate tests.
- `tests/domain/search.test.ts`: search and expansion contract tests.
- `tests/domain/route-policy.test.ts`: privacy and SEO policy tests.
- `tests/prisma/schema.test.ts`: schema validation smoke test.

---

### Task 1: Project Harness And Domain Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/domain/company.ts`
- Test: `tests/domain/verification.test.ts`

**Interfaces:**
- Produces: `Company`, `RecruitmentSource`, `CrawlObservation`, `VerificationStatus`, `ATSKind`, `SourceKind`, `RequiredJobField` types from `src/domain/company.ts`.
- Later tasks consume these types in verification, Prisma mapping, route policy, and admin workflows.

- [ ] **Step 1: Initialize git repository**

Run:

```bash
git init
```

Expected: repository initialized and future `git status --short` succeeds.

- [ ] **Step 2: Create project harness files**

Create `package.json`:

```json
{
  "name": "job-search",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prisma:validate": "prisma validate --schema prisma/schema.prisma"
  },
  "dependencies": {
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "prisma": "^6.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
.env.local
.next/
playwright-report/
test-results/
```

Create `.env.example`:

```dotenv
DATABASE_URL="postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD_HASH="replace-with-argon2id-hash"
```

- [ ] **Step 3: Install dependencies**

Run:

```bash
npm install
```

Expected: `node_modules/` and `package-lock.json` are created; command exits 0.

- [ ] **Step 4: Write failing domain type test**

Create `tests/domain/verification.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Company, RecruitmentSource } from "../../src/domain/company";

describe("company source domain", () => {
  it("represents a company with official social and campus source separation", () => {
    const socialSource: RecruitmentSource = {
      id: "source-hengrui-social",
      companyId: "company-hengrui",
      kind: "SOCIAL",
      atsKind: "MOKA",
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/careers",
      status: "VERIFIED_SCRAPABLE"
    };

    const company: Company = {
      id: "company-hengrui",
      officialChineseName: "江苏恒瑞医药股份有限公司",
      officialWebsiteUrl: "https://www.hengrui.com",
      pinyinName: "jiang su heng rui yi yao gu fen you xian gong si",
      inclusionReason: "国内头部药企、已实测",
      sources: [socialSource]
    };

    expect(company.sources[0]?.kind).toBe("SOCIAL");
    expect(company.sources[0]?.status).toBe("VERIFIED_SCRAPABLE");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run:

```bash
npm test -- tests/domain/verification.test.ts
```

Expected: FAIL because `src/domain/company.ts` does not exist.

- [ ] **Step 6: Implement domain types**

Create `src/domain/company.ts`:

```ts
export type VerificationStatus =
  | "UNVERIFIED"
  | "ENTRY_FOUND_PENDING_ADAPTER"
  | "VERIFIED_SCRAPABLE"
  | "TEMP_UNSCRAPABLE"
  | "EXCLUDED";

export type SourceKind = "SOCIAL" | "CAMPUS";

export type ATSKind =
  | "OFFICIAL_HTML"
  | "OFFICIAL_JSON"
  | "MOKA"
  | "BEISEN_ZHIYE"
  | "WORKDAY"
  | "SUCCESSFACTORS"
  | "REDSEA"
  | "BROWSER_FALLBACK"
  | "UNKNOWN";

export type RequiredJobField = "company" | "title" | "officialUrl" | "location";

export interface CrawlObservation {
  id: string;
  sourceId: string;
  crawledAt: Date;
  successful: boolean;
  stableRequiredFields: RequiredJobField[];
  structuredJobCount: number;
  failureReason?: string;
}

export interface RecruitmentSource {
  id: string;
  companyId: string;
  kind: SourceKind;
  atsKind: ATSKind;
  officialEntryUrl: string;
  officialChainEvidenceUrl: string;
  campusEntryUrl?: string;
  status: VerificationStatus;
}

export interface Company {
  id: string;
  officialChineseName: string;
  officialWebsiteUrl: string;
  pinyinName: string;
  inclusionReason: string;
  sources: RecruitmentSource[];
}
```

- [ ] **Step 7: Run test and typecheck**

Run:

```bash
npm test -- tests/domain/verification.test.ts
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example src/domain/company.ts tests/domain/verification.test.ts
git commit -m "chore: add typed project harness"
```

Expected: commit created.

---

### Task 2: Verification Gate Logic

**Files:**
- Modify: `tests/domain/verification.test.ts`
- Create: `src/domain/verification.ts`

**Interfaces:**
- Consumes: `RecruitmentSource`, `CrawlObservation`, `RequiredJobField`, `Company` from `src/domain/company.ts`.
- Produces: `isVerifiedScrapable(source, observations): boolean`, `countVerifiedCompanies(companies, observationsBySource): number`, `canLaunchP0(companies, observationsBySource): boolean`.

- [ ] **Step 1: Add failing verification tests**

Append to `tests/domain/verification.test.ts`:

```ts
import {
  canLaunchP0,
  countVerifiedCompanies,
  isVerifiedScrapable
} from "../../src/domain/verification";
import type { CrawlObservation } from "../../src/domain/company";

const requiredFields = ["company", "title", "officialUrl", "location"] as const;

describe("verified scrapable gate", () => {
  const source: RecruitmentSource = {
    id: "source-astrazeneca-social",
    companyId: "company-astrazeneca",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
    officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers",
    status: "ENTRY_FOUND_PENDING_ADAPTER"
  };

  it("rejects sources that have only one successful crawl", () => {
    const observations: CrawlObservation[] = [
      {
        id: "crawl-1",
        sourceId: source.id,
        crawledAt: new Date("2026-07-07T08:00:00Z"),
        successful: true,
        structuredJobCount: 12,
        stableRequiredFields: [...requiredFields]
      }
    ];

    expect(isVerifiedScrapable(source, observations)).toBe(false);
  });

  it("accepts sources with official evidence and two successful stable crawls", () => {
    const observations: CrawlObservation[] = [
      {
        id: "crawl-1",
        sourceId: source.id,
        crawledAt: new Date("2026-07-07T08:00:00Z"),
        successful: true,
        structuredJobCount: 12,
        stableRequiredFields: [...requiredFields]
      },
      {
        id: "crawl-2",
        sourceId: source.id,
        crawledAt: new Date("2026-07-07T20:00:00Z"),
        successful: true,
        structuredJobCount: 12,
        stableRequiredFields: [...requiredFields]
      }
    ];

    expect(isVerifiedScrapable(source, observations)).toBe(true);
  });

  it("blocks P0 launch until at least 50 companies are verified scrapable", () => {
    const companies: Company[] = Array.from({ length: 49 }, (_, index) => ({
      id: `company-${index}`,
      officialChineseName: `测试药企${index}`,
      officialWebsiteUrl: `https://example-${index}.com`,
      pinyinName: `ce shi yao qi ${index}`,
      inclusionReason: "测试样本",
      sources: [
        {
          ...source,
          id: `source-${index}`,
          companyId: `company-${index}`
        }
      ]
    }));
    const observationsBySource = Object.fromEntries(
      companies.map((company) => {
        const sourceId = company.sources[0]!.id;
        return [
          sourceId,
          [
            {
              id: `${sourceId}-crawl-1`,
              sourceId,
              crawledAt: new Date("2026-07-07T08:00:00Z"),
              successful: true,
              structuredJobCount: 1,
              stableRequiredFields: [...requiredFields]
            },
            {
              id: `${sourceId}-crawl-2`,
              sourceId,
              crawledAt: new Date("2026-07-07T20:00:00Z"),
              successful: true,
              structuredJobCount: 1,
              stableRequiredFields: [...requiredFields]
            }
          ] satisfies CrawlObservation[]
        ];
      })
    );

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(49);
    expect(canLaunchP0(companies, observationsBySource)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/domain/verification.test.ts
```

Expected: FAIL because `src/domain/verification.ts` does not exist.

- [ ] **Step 3: Implement verification logic**

Create `src/domain/verification.ts`:

```ts
import type {
  Company,
  CrawlObservation,
  RecruitmentSource,
  RequiredJobField
} from "./company";

const REQUIRED_FIELDS: RequiredJobField[] = ["company", "title", "officialUrl", "location"];
const REQUIRED_SUCCESSFUL_STABLE_CRAWLS = 2;
export const P0_MIN_VERIFIED_SCRAPABLE_COMPANIES = 50;

export function isVerifiedScrapable(
  source: RecruitmentSource,
  observations: CrawlObservation[]
): boolean {
  if (source.kind !== "SOCIAL") return false;
  if (!source.officialEntryUrl || !source.officialChainEvidenceUrl) return false;

  const successfulStableCrawls = observations.filter((observation) => {
    if (!observation.successful) return false;
    if (observation.structuredJobCount <= 0) return false;

    return REQUIRED_FIELDS.every((field) =>
      observation.stableRequiredFields.includes(field)
    );
  });

  return successfulStableCrawls.length >= REQUIRED_SUCCESSFUL_STABLE_CRAWLS;
}

export function countVerifiedCompanies(
  companies: Company[],
  observationsBySource: Record<string, CrawlObservation[]>
): number {
  return companies.filter((company) =>
    company.sources.some((source) =>
      isVerifiedScrapable(source, observationsBySource[source.id] ?? [])
    )
  ).length;
}

export function canLaunchP0(
  companies: Company[],
  observationsBySource: Record<string, CrawlObservation[]>
): boolean {
  return (
    companies.length >= 80 &&
    companies.length <= 120 &&
    countVerifiedCompanies(companies, observationsBySource) >=
      P0_MIN_VERIFIED_SCRAPABLE_COMPANIES
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test -- tests/domain/verification.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/domain/verification.ts tests/domain/verification.test.ts
git commit -m "feat: enforce verified scrapable launch gate"
```

Expected: commit created.

---

### Task 3: Search And Controlled Expansion Contracts

**Files:**
- Create: `src/domain/search.ts`
- Create: `tests/domain/search.test.ts`

**Interfaces:**
- Produces: `JobCategory`, `JOB_CATEGORIES`, `SearchRequestSchema`, `CompanyExpansionRequestSchema`, `COMPANY_EXPANSION_PAGE_SIZE`, `COMPANY_EXPANSION_MAX_RETURNED`.
- Later API and frontend tasks consume these contracts.

- [ ] **Step 1: Write failing search contract tests**

Create `tests/domain/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COMPANY_EXPANSION_MAX_RETURNED,
  COMPANY_EXPANSION_PAGE_SIZE,
  JOB_CATEGORIES,
  CompanyExpansionRequestSchema,
  SearchRequestSchema
} from "../../src/domain/search";

describe("search request contract", () => {
  it("requires city and accepts optional category, keyword, company, sort, and new-job filters", () => {
    const parsed = SearchRequestSchema.parse({
      city: "北京",
      categories: ["销售", "医学事务"],
      keyword: "MSL 肿瘤",
      companyIds: ["company-novartis"],
      sort: "COMPANY_PINYIN_ASC",
      newWithinDays: 7
    });

    expect(parsed.city).toBe("北京");
    expect(parsed.categories).toEqual(["销售", "医学事务"]);
  });

  it("rejects empty city", () => {
    expect(() => SearchRequestSchema.parse({ city: "" })).toThrow();
  });

  it("keeps all 17 P0 job categories", () => {
    expect(JOB_CATEGORIES).toEqual([
      "销售",
      "市场",
      "商务",
      "渠道",
      "KA",
      "医学事务",
      "临床运营",
      "注册",
      "药物警戒/安全",
      "研发/科学",
      "生产/工程",
      "质量",
      "市场准入/政府事务",
      "数据/IT",
      "供应链/采购",
      "职能",
      "其他"
    ]);
  });
});

describe("company expansion contract", () => {
  it("uses controlled loading limits for company expansion", () => {
    expect(COMPANY_EXPANSION_PAGE_SIZE).toBe(10);
    expect(COMPANY_EXPANSION_MAX_RETURNED).toBe(50);
  });

  it("rejects requests beyond the hard expansion cap", () => {
    expect(() =>
      CompanyExpansionRequestSchema.parse({
        companyId: "company-hengrui",
        offset: 50,
        limit: 10
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/domain/search.test.ts
```

Expected: FAIL because `src/domain/search.ts` does not exist.

- [ ] **Step 3: Implement search contracts**

Create `src/domain/search.ts`:

```ts
import { z } from "zod";

export const JOB_CATEGORIES = [
  "销售",
  "市场",
  "商务",
  "渠道",
  "KA",
  "医学事务",
  "临床运营",
  "注册",
  "药物警戒/安全",
  "研发/科学",
  "生产/工程",
  "质量",
  "市场准入/政府事务",
  "数据/IT",
  "供应链/采购",
  "职能",
  "其他"
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

const JobCategorySchema = z.enum(JOB_CATEGORIES);

export const SearchSortSchema = z.enum([
  "COMPANY_PINYIN_ASC",
  "LATEST_POSTED",
  "MATCHING_JOB_COUNT_DESC"
]);

export const SearchRequestSchema = z.object({
  city: z.string().trim().min(1),
  categories: z.array(JobCategorySchema).default([]),
  keyword: z.string().trim().max(120).optional(),
  companyIds: z.array(z.string().trim().min(1)).default([]),
  sort: SearchSortSchema.default("COMPANY_PINYIN_ASC"),
  newWithinDays: z.literal(7).optional()
});

export const COMPANY_EXPANSION_PAGE_SIZE = 10;
export const COMPANY_EXPANSION_MAX_RETURNED = 50;

export const CompanyExpansionRequestSchema = z
  .object({
    companyId: z.string().trim().min(1),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(COMPANY_EXPANSION_PAGE_SIZE).default(COMPANY_EXPANSION_PAGE_SIZE)
  })
  .refine((value) => value.offset + value.limit <= COMPANY_EXPANSION_MAX_RETURNED, {
    message: "Company expansion exceeds the controlled loading cap"
  });
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test -- tests/domain/search.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/domain/search.ts tests/domain/search.test.ts
git commit -m "feat: add search and expansion contracts"
```

Expected: commit created.

---

### Task 4: Privacy Consent And SEO Route Policy

**Files:**
- Create: `src/domain/route-policy.ts`
- Create: `tests/domain/route-policy.test.ts`

**Interfaces:**
- Produces: `canAccessWithoutConsent(pathname): boolean`, `isIndexableRoute(pathname): boolean`, `shouldLoadOperationalAnalytics(pathname, hasConsent): boolean`.
- Later route handlers and middleware consume these policy functions.

- [ ] **Step 1: Write failing route policy tests**

Create `tests/domain/route-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  canAccessWithoutConsent,
  isIndexableRoute,
  shouldLoadOperationalAnalytics
} from "../../src/domain/route-policy";

describe("privacy consent route policy", () => {
  it("allows policy and terms before consent", () => {
    expect(canAccessWithoutConsent("/privacy")).toBe(true);
    expect(canAccessWithoutConsent("/terms")).toBe(true);
  });

  it("allows only the static homepage shell before consent", () => {
    expect(canAccessWithoutConsent("/")).toBe(true);
    expect(canAccessWithoutConsent("/companies")).toBe(false);
    expect(canAccessWithoutConsent("/search?city=北京")).toBe(false);
  });

  it("does not load operational analytics before consent", () => {
    expect(shouldLoadOperationalAnalytics("/", false)).toBe(false);
    expect(shouldLoadOperationalAnalytics("/search", false)).toBe(false);
    expect(shouldLoadOperationalAnalytics("/search", true)).toBe(true);
  });
});

describe("SEO route policy", () => {
  it("indexes only minimal static routes", () => {
    expect(isIndexableRoute("/")).toBe(true);
    expect(isIndexableRoute("/privacy")).toBe(true);
    expect(isIndexableRoute("/terms")).toBe(true);
  });

  it("does not index result pages, APIs, admin, or deep data paths", () => {
    expect(isIndexableRoute("/search")).toBe(false);
    expect(isIndexableRoute("/city/beijing/category/sales")).toBe(false);
    expect(isIndexableRoute("/api/search")).toBe(false);
    expect(isIndexableRoute("/admin")).toBe(false);
    expect(isIndexableRoute("/companies")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/domain/route-policy.test.ts
```

Expected: FAIL because `src/domain/route-policy.ts` does not exist.

- [ ] **Step 3: Implement route policy**

Create `src/domain/route-policy.ts`:

```ts
const PUBLIC_STATIC_ROUTES = new Set(["/", "/privacy", "/terms"]);

function normalizePathname(pathname: string): string {
  const [pathOnly] = pathname.split("?");
  if (!pathOnly || pathOnly === "") return "/";
  return pathOnly.endsWith("/") && pathOnly.length > 1
    ? pathOnly.slice(0, -1)
    : pathOnly;
}

export function canAccessWithoutConsent(pathname: string): boolean {
  return PUBLIC_STATIC_ROUTES.has(normalizePathname(pathname));
}

export function isIndexableRoute(pathname: string): boolean {
  return PUBLIC_STATIC_ROUTES.has(normalizePathname(pathname));
}

export function shouldLoadOperationalAnalytics(
  pathname: string,
  hasConsent: boolean
): boolean {
  if (!hasConsent) return false;
  return !["/privacy", "/terms"].includes(normalizePathname(pathname));
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npm test -- tests/domain/route-policy.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/domain/route-policy.ts tests/domain/route-policy.test.ts
git commit -m "feat: add privacy and seo route policy"
```

Expected: commit created.

---

### Task 5: PostgreSQL Data Model

**Files:**
- Create: `prisma/schema.prisma`
- Create: `tests/prisma/schema.test.ts`

**Interfaces:**
- Consumes: domain concepts from previous tasks.
- Produces: Prisma schema with companies, recruitment sources, crawl batches, crawl observations, jobs, feedback, recommended companies, and access events.

- [ ] **Step 1: Write failing schema validation test**

Create `tests/prisma/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

describe("prisma schema", () => {
  it("validates the PostgreSQL data model", () => {
    const output = execFileSync(
      "npx",
      ["prisma", "validate", "--schema", "prisma/schema.prisma"],
      { encoding: "utf8" }
    );

    expect(output).toContain("The schema at prisma/schema.prisma is valid");
  });
});
```

- [ ] **Step 2: Run schema test to verify it fails**

Run:

```bash
npm test -- tests/prisma/schema.test.ts
```

Expected: FAIL because `prisma/schema.prisma` does not exist.

- [ ] **Step 3: Implement Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum VerificationStatus {
  UNVERIFIED
  ENTRY_FOUND_PENDING_ADAPTER
  VERIFIED_SCRAPABLE
  TEMP_UNSCRAPABLE
  EXCLUDED
}

enum SourceKind {
  SOCIAL
  CAMPUS
}

enum AtsKind {
  OFFICIAL_HTML
  OFFICIAL_JSON
  MOKA
  BEISEN_ZHIYE
  WORKDAY
  SUCCESSFACTORS
  REDSEA
  BROWSER_FALLBACK
  UNKNOWN
}

enum CrawlStatus {
  SUCCESS
  FAILED
}

enum JobLifecycleStatus {
  ACTIVE
  SUSPECTED_OFFLINE
  OFFLINE
}

enum FeedbackStatus {
  OPEN
  REVIEWED
  CLOSED
  SPAM
}

model Company {
  id                  String              @id @default(cuid())
  officialChineseName String              @unique
  officialWebsiteUrl  String
  pinyinName          String
  inclusionReason     String
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  sources             RecruitmentSource[]
  jobs                Job[]

  @@index([pinyinName])
}

model RecruitmentSource {
  id                       String              @id @default(cuid())
  companyId                String
  kind                     SourceKind
  atsKind                  AtsKind
  officialEntryUrl         String
  officialChainEvidenceUrl String
  campusEntryUrl           String?
  status                   VerificationStatus  @default(UNVERIFIED)
  createdAt                DateTime            @default(now())
  updatedAt                DateTime            @updatedAt
  company                  Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  crawlObservations        CrawlObservation[]
  jobs                     Job[]

  @@index([companyId, kind])
  @@index([status])
}

model CrawlBatch {
  id           String             @id @default(cuid())
  startedAt    DateTime           @default(now())
  finishedAt   DateTime?
  status       CrawlStatus
  observations CrawlObservation[]
}

model CrawlObservation {
  id                   String            @id @default(cuid())
  sourceId             String
  batchId              String
  crawledAt            DateTime          @default(now())
  successful           Boolean
  structuredJobCount   Int               @default(0)
  stableRequiredFields String[]
  failureReason        String?
  source               RecruitmentSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  batch                CrawlBatch        @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@index([sourceId, crawledAt])
  @@index([successful])
}

model Job {
  id                    String             @id @default(cuid())
  companyId             String
  sourceId              String
  sourceJobId           String?
  officialTitle         String
  auxiliaryChineseTitle String?
  officialUrl           String
  listUrl               String?
  locationRaw           String
  city                  String
  category              String
  officialPublishedAt   DateTime?
  firstSeenAt           DateTime           @default(now())
  lastSeenAt            DateTime           @default(now())
  missingSuccessCount   Int                @default(0)
  lifecycleStatus       JobLifecycleStatus @default(ACTIVE)
  company               Company            @relation(fields: [companyId], references: [id], onDelete: Cascade)
  source                RecruitmentSource  @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@unique([sourceId, sourceJobId])
  @@index([city, category])
  @@index([companyId, lifecycleStatus])
  @@index([firstSeenAt])
}

model Feedback {
  id          String         @id @default(cuid())
  companyId   String?
  jobId       String?
  issueType   String
  description String
  contact     String?
  ip          String
  userAgent   String
  status      FeedbackStatus @default(OPEN)
  createdAt   DateTime       @default(now())

  @@index([status, createdAt])
}

model RecommendedCompany {
  id                    String         @id @default(cuid())
  companyName            String
  officialWebsiteUrl     String?
  recruitmentEntryUrl    String?
  reason                 String?
  ip                     String
  userAgent              String
  status                 FeedbackStatus @default(OPEN)
  createdAt              DateTime       @default(now())

  @@index([status, createdAt])
}

model AccessEvent {
  id          String   @id @default(cuid())
  ip          String
  userAgent   String
  path        String
  eventType   String
  occurredAt  DateTime @default(now())
  metadata    Json?

  @@index([ip, occurredAt])
  @@index([eventType, occurredAt])
}
```

- [ ] **Step 4: Run schema test and direct validation**

Run:

```bash
npm test -- tests/prisma/schema.test.ts
npm run prisma:validate
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add prisma/schema.prisma tests/prisma/schema.test.ts package.json package-lock.json
git commit -m "feat: add postgres data model"
```

Expected: commit created.

---

### Task 6: Phase 1 Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-07-pharma-job-aggregator-phase-1.md`

**Interfaces:**
- Consumes all Phase 1 files.
- Produces no new runtime interface; verifies the foundation is coherent.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: TypeScript exits 0.

- [ ] **Step 3: Run Prisma validation**

Run:

```bash
npm run prisma:validate
```

Expected: Prisma reports schema valid.

- [ ] **Step 4: Confirm Product Design UI gate remains closed**

Run:

```bash
rg -n "visual directions|visual target|Product Design" docs/superpowers/specs/2026-07-07-pharma-job-aggregator-design.md
```

Expected: output includes the requirement that Phase 3 frontend development needs Product Design brief confirmation, three visual directions, and a selected visual target.

- [ ] **Step 5: Commit final plan execution marker**

Run:

```bash
git status --short
git add docs/superpowers/plans/2026-07-07-pharma-job-aggregator-phase-1.md
git commit -m "docs: add phase 1 implementation plan"
```

Expected: commit created if the plan file was not committed earlier; if only this plan file is already committed, `git status --short` is empty and no commit is needed.

---

## Self-Review

Spec coverage:

- Covers the 50-company verified-scrapable gate.
- Covers official source and structured crawl evidence at the domain level.
- Covers city-required search input contract.
- Covers controlled company expansion.
- Covers privacy-before-use and conservative SEO route policy.
- Covers PostgreSQL data model for company sources, jobs, feedback, recommendations, access events, and crawl observations.
- Does not implement final search UI, admin UI, crawler adapters, deployment, backups, monitoring, WAF, or Product Design visual implementation. Those are separate implementation plans because they are independent subsystems.

Placeholder scan:

- No placeholder markers or open-ended implementation steps are included.

Type consistency:

- `VerificationStatus`, `SourceKind`, `ATSKind`, `CrawlObservation`, `Company`, and `RecruitmentSource` names are consistent across tests and implementation steps.
- Search constants and route-policy function names are defined before later consumption.
