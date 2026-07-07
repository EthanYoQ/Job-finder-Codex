# P0 Persistence And Search Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move P0 crawler output from pure command objects into a Prisma/PostgreSQL-ready persistence boundary and expose an internal job-search query service that can later replace the static front-end data.

**Architecture:** Keep database access behind narrow interfaces so tests use in-memory delegates instead of a live PostgreSQL instance. Ingestion writes use existing `IngestionCommand` objects and a batch context. Search reads return the existing company-grouped result shape while preserving city-required, category-optional, pinyin-default sorting behavior.

**Tech Stack:** TypeScript, Vitest, Prisma Client, PostgreSQL schema, existing crawler/domain contracts.

## Global Constraints

- Data acquisition must start from company official homepages or official recruitment pages; persistence must store official source links only.
- P0 front-end jobs must come from social recruitment only; campus entries are recorded as source metadata but excluded from search and crawl runs.
- Baseline completion must be explicit; first baseline results are visible but are not marked new.
- Jobs missing from two consecutive successful source crawls are hidden from front end and marked suspected offline; failed crawls do not increment missing counts.
- Search pages and internal query services are implementation details, not public product APIs.
- No public API, bulk export, deep pagination, admin UI, deployment worker, live crawling, or 50-company verification is introduced by this plan.
- CodeGraph is currently not initialized in this workspace; do not claim CodeGraph-backed structural verification until `codegraph init -i` has been run.

---

## File Structure

- `package.json`, `package-lock.json`: add Prisma Client runtime dependency.
- `prisma/schema.prisma`: store front-end visibility, new-label state, and multi-city evidence for persisted jobs.
- `tests/prisma/schema.test.ts`: lock the schema additions.
- `src/db/prismaMappers.ts`: map domain Chinese categories and crawler statuses to Prisma enum values.
- `tests/db/prismaMappers.test.ts`: prove every domain category and required field maps to a Prisma enum.
- `src/db/ingestionRepository.ts`: execute ingestion commands against a Prisma-like delegate.
- `tests/db/ingestionRepository.test.ts`: prove observation create and job upsert shapes.
- `src/server/jobSearchService.ts`: internal DB-backed company-grouped search service.
- `tests/server/jobSearchService.test.ts`: prove city-required search, grouping, filters, and sorting.

---

### Task 1: Prisma Runtime And Job Schema

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `prisma/schema.prisma`
- Modify: `tests/prisma/schema.test.ts`

**Interfaces:**
- Produces: generated Prisma Client runtime dependency and schema fields `Job.cities`, `Job.visibleInFrontend`, `Job.isNew`.
- Consumes: existing `Job` model and existing schema validation script.

- [x] **Step 1: Write failing schema tests**

Add this test to `tests/prisma/schema.test.ts`:

```ts
it("stores frontend visibility, new labels, and multi-city job evidence", () => {
  expect(schema).toMatch(/visibleInFrontend\s+Boolean\s+@default\(true\)/);
  expect(schema).toMatch(/isNew\s+Boolean\s+@default\(false\)/);
  expect(schema).toMatch(/cities\s+String\[\]\s+@default\(\[\]\)/);
  expect(schema).toMatch(/@@index\(\[visibleInFrontend,\s*lifecycleStatus\]\)/);
});
```

- [x] **Step 2: Run schema tests to verify they fail**

Run:

```bash
npm test -- tests/prisma/schema.test.ts
```

Expected: FAIL because the new `Job` fields and index do not exist.

- [x] **Step 3: Install Prisma Client runtime**

Run:

```bash
npm install @prisma/client@^6.0.0
```

Expected: `package.json` and `package-lock.json` include `@prisma/client`.

- [x] **Step 4: Add persisted front-end state to the Job model**

Modify `prisma/schema.prisma` inside `model Job`:

```prisma
  locationRaw           String
  city                  String
  cities                String[]           @default([])
  category              JobCategory
```

and below `lifecycleStatus`:

```prisma
  missingSuccessCount   Int                @default(0)
  lifecycleStatus       JobLifecycleStatus @default(ACTIVE)
  visibleInFrontend     Boolean            @default(true)
  isNew                 Boolean            @default(false)
```

and add this index with the other `Job` indexes:

```prisma
  @@index([visibleInFrontend, lifecycleStatus])
```

- [x] **Step 5: Verify Task 1**

Run:

```bash
npm test -- tests/prisma/schema.test.ts
npm run prisma:validate
npm run typecheck
```

Expected: schema tests, Prisma validation, and typecheck pass.

- [x] **Step 6: Commit Task 1**

Run:

```bash
git add package.json package-lock.json prisma/schema.prisma tests/prisma/schema.test.ts
git commit -m "feat: add prisma runtime and persisted job state"
```

Expected: commit created.

---

### Task 2: Prisma Enum Mappers

**Files:**
- Create: `src/db/prismaMappers.ts`
- Create: `tests/db/prismaMappers.test.ts`

**Interfaces:**
- Consumes: `JOB_CATEGORIES` and `JobCategory` from `src/domain/search.ts`; `RequiredJobField` from `src/domain/company.ts`; `LifecycleStatus` from `src/crawler/lifecycle.ts`.
- Produces: `toPrismaJobCategory(category)`, `toPrismaRequiredJobField(field)`, `toPrismaLifecycleStatus(status)`.

- [x] **Step 1: Write failing mapper tests**

Create `tests/db/prismaMappers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { JOB_CATEGORIES } from "../../src/domain/search";
import {
  toPrismaJobCategory,
  toPrismaLifecycleStatus,
  toPrismaRequiredJobField
} from "../../src/db/prismaMappers";

describe("Prisma enum mappers", () => {
  it("maps every domain job category to the Prisma enum name", () => {
    const mapped = JOB_CATEGORIES.map((category) => toPrismaJobCategory(category));

    expect(mapped).toEqual([
      "SALES",
      "MARKETING",
      "BUSINESS",
      "CHANNEL",
      "KA",
      "MEDICAL_AFFAIRS",
      "CLINICAL_OPERATIONS",
      "REGULATORY",
      "DRUG_SAFETY",
      "RESEARCH_SCIENCE",
      "MANUFACTURING_ENGINEERING",
      "QUALITY",
      "MARKET_ACCESS_GOVERNMENT",
      "DATA_IT",
      "SUPPLY_CHAIN_PROCUREMENT",
      "CORPORATE_FUNCTIONS",
      "OTHER"
    ]);
  });

  it("maps crawler required fields to the Prisma enum names", () => {
    expect(["company", "title", "officialUrl", "location"].map(toPrismaRequiredJobField)).toEqual([
      "COMPANY",
      "TITLE",
      "OFFICIAL_URL",
      "LOCATION"
    ]);
  });

  it("maps lifecycle status strings to Prisma enum names", () => {
    expect(["ACTIVE", "SUSPECTED_OFFLINE", "OFFLINE"].map(toPrismaLifecycleStatus)).toEqual([
      "ACTIVE",
      "SUSPECTED_OFFLINE",
      "OFFLINE"
    ]);
  });
});
```

- [x] **Step 2: Run mapper tests to verify they fail**

Run:

```bash
npm test -- tests/db/prismaMappers.test.ts
```

Expected: FAIL because `src/db/prismaMappers.ts` does not exist.

- [x] **Step 3: Implement Prisma enum mappers**

Create `src/db/prismaMappers.ts` with total mappings for the project enums:

```ts
import type { RequiredJobField } from "../domain/company";
import type { JobCategory } from "../domain/search";
import type { LifecycleStatus } from "../crawler/lifecycle";

export type PrismaJobCategoryName =
  | "SALES"
  | "MARKETING"
  | "BUSINESS"
  | "CHANNEL"
  | "KA"
  | "MEDICAL_AFFAIRS"
  | "CLINICAL_OPERATIONS"
  | "REGULATORY"
  | "DRUG_SAFETY"
  | "RESEARCH_SCIENCE"
  | "MANUFACTURING_ENGINEERING"
  | "QUALITY"
  | "MARKET_ACCESS_GOVERNMENT"
  | "DATA_IT"
  | "SUPPLY_CHAIN_PROCUREMENT"
  | "CORPORATE_FUNCTIONS"
  | "OTHER";

export type PrismaRequiredJobFieldName = "COMPANY" | "TITLE" | "OFFICIAL_URL" | "LOCATION";
export type PrismaLifecycleStatusName = "ACTIVE" | "SUSPECTED_OFFLINE" | "OFFLINE";

const JOB_CATEGORY_TO_PRISMA = {
  销售: "SALES",
  市场: "MARKETING",
  商务: "BUSINESS",
  渠道: "CHANNEL",
  KA: "KA",
  医学事务: "MEDICAL_AFFAIRS",
  临床运营: "CLINICAL_OPERATIONS",
  注册: "REGULATORY",
  "药物警戒/安全": "DRUG_SAFETY",
  "研发/科学": "RESEARCH_SCIENCE",
  "生产/工程": "MANUFACTURING_ENGINEERING",
  质量: "QUALITY",
  "市场准入/政府事务": "MARKET_ACCESS_GOVERNMENT",
  "数据/IT": "DATA_IT",
  "供应链/采购": "SUPPLY_CHAIN_PROCUREMENT",
  职能: "CORPORATE_FUNCTIONS",
  其他: "OTHER"
} as const satisfies Record<JobCategory, PrismaJobCategoryName>;

const REQUIRED_FIELD_TO_PRISMA = {
  company: "COMPANY",
  title: "TITLE",
  officialUrl: "OFFICIAL_URL",
  location: "LOCATION"
} as const satisfies Record<RequiredJobField, PrismaRequiredJobFieldName>;

const LIFECYCLE_TO_PRISMA = {
  ACTIVE: "ACTIVE",
  SUSPECTED_OFFLINE: "SUSPECTED_OFFLINE",
  OFFLINE: "OFFLINE"
} as const satisfies Record<LifecycleStatus, PrismaLifecycleStatusName>;

export function toPrismaJobCategory(category: JobCategory): PrismaJobCategoryName {
  return JOB_CATEGORY_TO_PRISMA[category];
}

export function toPrismaRequiredJobField(field: RequiredJobField): PrismaRequiredJobFieldName {
  return REQUIRED_FIELD_TO_PRISMA[field];
}

export function toPrismaLifecycleStatus(status: LifecycleStatus): PrismaLifecycleStatusName {
  return LIFECYCLE_TO_PRISMA[status];
}
```

- [x] **Step 4: Verify Task 2**

Run:

```bash
npm test -- tests/db/prismaMappers.test.ts
npm run typecheck
```

Expected: mapper tests and typecheck pass.

- [x] **Step 5: Commit Task 2**

Run:

```bash
git add src/db/prismaMappers.ts tests/db/prismaMappers.test.ts
git commit -m "feat: map domain enums to prisma values"
```

Expected: commit created.

---

### Task 3: Ingestion Command Executor

**Files:**
- Create: `src/db/ingestionRepository.ts`
- Create: `tests/db/ingestionRepository.test.ts`

**Interfaces:**
- Consumes: `IngestionCommand` from `src/crawler/ingestion.ts`; mapper functions from Task 2.
- Produces: `executeIngestionCommands(commands, context, db)` and `PrismaIngestionDb`.

- [x] **Step 1: Write failing ingestion repository tests**

Create `tests/db/ingestionRepository.test.ts` with tests that use fake delegates:

```ts
import { describe, expect, it, vi } from "vitest";
import { executeIngestionCommands, type PrismaIngestionDb } from "../../src/db/ingestionRepository";
import type { IngestionCommand } from "../../src/crawler/ingestion";

function fakeDb(): PrismaIngestionDb & { calls: { observations: unknown[]; jobs: unknown[] } } {
  const calls = { observations: [] as unknown[], jobs: [] as unknown[] };
  return {
    calls,
    crawlObservation: {
      create: vi.fn((args: unknown) => {
        calls.observations.push(args);
        return Promise.resolve(args);
      })
    },
    job: {
      upsert: vi.fn((args: unknown) => {
        calls.jobs.push(args);
        return Promise.resolve(args);
      })
    }
  };
}

const observationCommand: IngestionCommand = {
  type: "UPSERT_CRAWL_OBSERVATION",
  observation: {
    id: "obs-1",
    sourceId: "source-1",
    crawledAt: new Date("2026-07-08T00:00:00.000Z"),
    successful: true,
    stableRequiredFields: ["company", "title", "officialUrl", "location"],
    structuredJobCount: 1
  }
};

const jobCommand: IngestionCommand = {
  type: "UPSERT_JOB",
  dedupeKey: "source-1:job-1",
  lifecycleStatus: "ACTIVE",
  visibleInFrontend: true,
  isNew: false,
  firstSeenAt: "2026-07-08T00:00:00.000Z",
  lastSeenAt: "2026-07-08T00:00:00.000Z",
  missingSuccessfulCrawlCount: 0,
  record: {
    companyId: "company-1",
    sourceId: "source-1",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialChineseCompanyName: "测试药企",
    officialTitle: "Regional Sales Manager",
    auxiliaryChineseTitle: "区域销售经理",
    officialUrl: "https://example.com/jobs/1",
    listUrl: "https://example.com/jobs",
    sourceJobId: "job-1",
    locationRaw: "北京/上海",
    cities: ["北京", "上海"],
    category: "销售",
    officialPublishedAt: "2026-07-07T00:00:00.000Z",
    isBaseline: true,
    evidence: {
      officialEntryUrl: "https://example.com/careers",
      officialChainEvidenceUrl: "https://example.com",
      capturedAt: "2026-07-08T00:00:00.000Z"
    }
  }
};

describe("executeIngestionCommands", () => {
  it("creates crawl observations with batch context and mapped stable fields", async () => {
    const db = fakeDb();

    await executeIngestionCommands([observationCommand], { batchId: "batch-1" }, db);

    expect(db.calls.observations).toEqual([
      {
        data: {
          sourceId: "source-1",
          batchId: "batch-1",
          crawledAt: new Date("2026-07-08T00:00:00.000Z"),
          successful: true,
          structuredJobCount: 1,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: undefined
        }
      }
    ]);
  });

  it("upserts jobs with official links, all cities, visibility, and new-label state", async () => {
    const db = fakeDb();

    await executeIngestionCommands([jobCommand], { batchId: "batch-1" }, db);

    expect(db.calls.jobs).toHaveLength(1);
    expect(db.calls.jobs[0]).toMatchObject({
      where: { sourceId_dedupeKey: { sourceId: "source-1", dedupeKey: "source-1:job-1" } },
      create: {
        companyId: "company-1",
        sourceId: "source-1",
        dedupeKey: "source-1:job-1",
        officialTitle: "Regional Sales Manager",
        auxiliaryChineseTitle: "区域销售经理",
        officialUrl: "https://example.com/jobs/1",
        listUrl: "https://example.com/jobs",
        locationRaw: "北京/上海",
        city: "北京",
        cities: ["北京", "上海"],
        category: "SALES",
        lifecycleStatus: "ACTIVE",
        visibleInFrontend: true,
        isNew: false
      },
      update: {
        lastSeenAt: new Date("2026-07-08T00:00:00.000Z"),
        missingSuccessCount: 0,
        lifecycleStatus: "ACTIVE",
        visibleInFrontend: true,
        isNew: false
      }
    });
  });
});
```

- [x] **Step 2: Run ingestion repository tests to verify they fail**

Run:

```bash
npm test -- tests/db/ingestionRepository.test.ts
```

Expected: FAIL because `src/db/ingestionRepository.ts` does not exist.

- [x] **Step 3: Implement ingestion executor**

Create `src/db/ingestionRepository.ts` that:

- accepts `batchId` in context;
- creates crawl observations using mapped stable fields;
- upserts jobs by `sourceId_dedupeKey`;
- stores primary display city as `record.cities[0]`;
- stores all normalized cities in `cities`;
- stores `visibleInFrontend` and `isNew` directly from the ingestion command;
- maps Chinese job categories and lifecycle statuses through `src/db/prismaMappers.ts`.

- [x] **Step 4: Verify Task 3**

Run:

```bash
npm test -- tests/db/ingestionRepository.test.ts tests/db/prismaMappers.test.ts
npm run typecheck
```

Expected: ingestion repository tests, mapper tests, and typecheck pass.

- [x] **Step 5: Commit Task 3**

Run:

```bash
git add src/db/ingestionRepository.ts tests/db/ingestionRepository.test.ts
git commit -m "feat: execute crawler ingestion commands"
```

Expected: commit created.

---

### Task 4: Internal DB Search Service

**Files:**
- Create: `src/server/jobSearchService.ts`
- Create: `tests/server/jobSearchService.test.ts`

**Interfaces:**
- Consumes: `SearchRequestSchema` from `src/domain/search.ts`; mapper functions from Task 2.
- Produces: `searchJobsFromDatabase(request, db)` returning `{ companies, totalJobs, lastUpdatedAt }`.

- [x] **Step 1: Write failing search service tests**

Create `tests/server/jobSearchService.test.ts` with fake job rows and a fake delegate:

```ts
import { describe, expect, it, vi } from "vitest";
import { searchJobsFromDatabase, type PrismaJobSearchDb } from "../../src/server/jobSearchService";

function dbReturning(rows: unknown[], lastUpdatedAt = new Date("2026-07-08T00:00:00.000Z")): PrismaJobSearchDb {
  return {
    job: {
      findMany: vi.fn(() => Promise.resolve(rows))
    },
    crawlObservation: {
      findFirst: vi.fn(() => Promise.resolve({ crawledAt: lastUpdatedAt }))
    }
  };
}

const rows = [
  {
    id: "job-2",
    companyId: "company-b",
    officialTitle: "Medical Science Liaison",
    auxiliaryChineseTitle: "MSL 医学科学联络官",
    officialUrl: "https://example.com/b/2",
    officialPublishedAt: new Date("2026-07-08T00:00:00.000Z"),
    city: "北京",
    cities: ["北京"],
    category: "MEDICAL_AFFAIRS",
    isNew: true,
    company: { id: "company-b", officialChineseName: "百济神州", pinyinName: "bai ji shen zhou" }
  },
  {
    id: "job-1",
    companyId: "company-a",
    officialTitle: "Regional Sales Manager",
    auxiliaryChineseTitle: "区域销售经理",
    officialUrl: "https://example.com/a/1",
    officialPublishedAt: new Date("2026-07-07T00:00:00.000Z"),
    city: "北京",
    cities: ["北京", "全国"],
    category: "SALES",
    isNew: false,
    company: { id: "company-a", officialChineseName: "阿斯利康", pinyinName: "a si li kang" }
  }
];

describe("searchJobsFromDatabase", () => {
  it("requires city before reading jobs", async () => {
    const db = dbReturning(rows);

    await expect(searchJobsFromDatabase({ city: "", categories: [] }, db)).rejects.toThrow();
    expect(db.job.findMany).not.toHaveBeenCalled();
  });

  it("returns company-grouped results sorted by pinyin A-Z by default", async () => {
    const result = await searchJobsFromDatabase({ city: "北京", categories: [] }, dbReturning(rows));

    expect(result.totalJobs).toBe(2);
    expect(result.lastUpdatedAt).toBe("2026-07-08T00:00:00.000Z");
    expect(result.companies.map((company) => company.companyName)).toEqual(["阿斯利康", "百济神州"]);
  });

  it("passes city, category, keyword, company, active visibility, and new filters into the DB query", async () => {
    const db = dbReturning(rows);

    await searchJobsFromDatabase(
      {
        city: "北京",
        categories: ["销售"],
        keyword: "肿瘤",
        companyIds: ["company-a"],
        sort: "LATEST_POSTED",
        newWithinDays: 7
      },
      db
    );

    expect(db.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          visibleInFrontend: true,
          lifecycleStatus: "ACTIVE",
          companyId: { in: ["company-a"] },
          category: { in: ["SALES"] },
          isNew: true
        }),
        include: { company: true }
      })
    );
  });
});
```

- [x] **Step 2: Run search service tests to verify they fail**

Run:

```bash
npm test -- tests/server/jobSearchService.test.ts
```

Expected: FAIL because `src/server/jobSearchService.ts` does not exist.

- [x] **Step 3: Implement internal search service**

Create `src/server/jobSearchService.ts` that:

- parses input with `SearchRequestSchema`;
- does not read jobs when city is blank or invalid;
- queries only `visibleInFrontend: true` and `lifecycleStatus: "ACTIVE"`;
- filters city by `cities has selected city`, primary `city`, `全国`, or `中国`;
- maps selected Chinese categories through `toPrismaJobCategory`;
- passes `companyIds`, keyword OR fields, and `isNew` when provided;
- groups returned rows by company;
- returns companies sorted by pinyin by default, by latest official publish time for `LATEST_POSTED`, and by matching job count for `MATCHING_JOB_COUNT_DESC`.

- [x] **Step 4: Verify Task 4**

Run:

```bash
npm test -- tests/server/jobSearchService.test.ts tests/domain/search.test.ts
npm run typecheck
```

Expected: search service tests, domain search tests, and typecheck pass.

- [x] **Step 5: Commit Task 4**

Run:

```bash
git add src/server/jobSearchService.ts tests/server/jobSearchService.test.ts
git commit -m "feat: add internal database job search service"
```

Expected: commit created.

---

### Task 5: Persistence Foundation Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-persistence-and-search-foundation.md`
- Modify: `.superpowers/sdd/progress.md`

- [x] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected: all test/build/schema commands pass; grep returns no matches.

- [x] **Step 2: Mark progress**

Append progress entries noting this plan implements Prisma runtime, persisted job state, ingestion execution, and internal search service, but still does not implement live fetcher deployment, admin UI, public deployment security, backups, monitoring, or 50 live verified companies.

- [x] **Step 3: Commit verification marker**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-persistence-and-search-foundation.md
git commit -m "docs: complete persistence search foundation plan"
```

Expected: commit created if the plan file changed.

---

## Self-Review

Spec coverage:

- Covers PostgreSQL/Prisma runtime dependency and schema fields needed for visible jobs, new labels, and multi-city evidence.
- Covers database execution for crawl observations and job upserts.
- Covers an internal city-required search service with company grouping, pinyin default sorting, category filtering, keyword filtering, company filtering, and new-job filtering.
- Does not implement live crawler deployment, real scheduled worker process, admin UI, public HTTP routes, Docker Compose, WAF/rate limits, backups, monitoring, or 50 live verified companies.

Placeholder scan:

- No deferred-work markers or open-ended implementation placeholders are required.
- Tests use concrete values and expected outputs.

Type consistency:

- `executeIngestionCommands` consumes existing `IngestionCommand` objects.
- `searchJobsFromDatabase` consumes `SearchRequestSchema`-compatible input and returns company-grouped results compatible with the current front-end data shape.
