# P0 Crawl CLI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local/production crawl command that syncs configured official crawl sources into PostgreSQL, runs the existing P0 crawl batch, and leaves persisted crawl observations visible to `npm run p0:readiness -- --db`.

**Architecture:** Keep crawler orchestration behind small testable modules: one module syncs planned source metadata into Prisma, one module reads previous crawl state from Prisma, one module orchestrates a P0 crawl command with injected dependencies, and the script file only wires real Prisma/Tavily/Moka dependencies. This plan does not add any new verified companies; it only lets real evidence for currently configured source plans be persisted and counted.

**Tech Stack:** TypeScript, Vitest, Prisma Client types, existing `runP0CrawlBatch`, existing source fetch router, Moka fetcher, Tavily fetcher, existing readiness CLI.

## Global Constraints

- Do not mark additional companies as `VERIFIED_SCRAPABLE`.
- Do not insert, fake, or count fixture observations as production evidence.
- P0 readiness remains blocked until persisted data contains 50 companies with two latest successful stable crawl observations.
- `npm run p0:crawl` may require `DATABASE_URL` and Tavily credentials for non-Moka sources, but tests must use fake delegates and must not connect to a real database or network.
- Only companies referenced by `buildSourceCrawlPlans(candidateCompanies)` are synced by this plan.
- If a planned company is missing `officialWebsiteUrl`, registry sync must throw instead of writing a fake URL.
- No public APIs, admin UI screens, deployment scripts, WAF config, monitoring, backups, source expansion, or live internet verification for new companies are introduced by this plan.
- Do not print or store Tavily keys or other secrets.

---

### Task 1: Planned Source Registry Sync

**Files:**
- Create: `src/db/companyRegistrySync.ts`
- Test: `tests/db/companyRegistrySync.test.ts`

**Interfaces:**
- Consumes: `SourceCrawlPlan`, `CandidateCompany`.
- Produces:
  - `CompanyRegistrySyncDb`
  - `syncPlannedSourcesToDb(plans: readonly SourceCrawlPlan[], companies: readonly CandidateCompany[], db: CompanyRegistrySyncDb): Promise<CompanyRegistrySyncResult>`

- [x] **Step 1: Write the failing registry sync test**

Create `tests/db/companyRegistrySync.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { CandidateCompany } from "../../src/data/companyRegistry";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { syncPlannedSourcesToDb } from "../../src/db/companyRegistrySync";

const plannedCompany: CandidateCompany = {
  id: "company-test",
  officialChineseName: "测试药企",
  officialWebsiteUrl: "https://example.com",
  pinyinName: "ceshi-yaoqi",
  inclusionReason: "测试来源",
  sources: [
    {
      id: "source-test-social",
      companyId: "company-test",
      kind: "SOCIAL",
      atsKind: "MOKA",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
      officialChainEvidenceUrl: "https://example.com/careers"
    }
  ]
};

const plan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: {
    id: plannedCompany.id,
    officialChineseName: plannedCompany.officialChineseName
  },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  }
};

function fakeDb() {
  return {
    company: {
      upsert: vi.fn(async (args: unknown) => args)
    },
    recruitmentSource: {
      upsert: vi.fn(async (args: unknown) => args)
    }
  };
}

describe("syncPlannedSourcesToDb", () => {
  it("upserts only companies and sources referenced by crawl plans", async () => {
    const db = fakeDb();

    const result = await syncPlannedSourcesToDb([plan], [plannedCompany], db);

    expect(result).toEqual({ companyCount: 1, sourceCount: 1 });
    expect(db.company.upsert).toHaveBeenCalledWith({
      where: { id: "company-test" },
      create: {
        id: "company-test",
        officialChineseName: "测试药企",
        officialWebsiteUrl: "https://example.com",
        pinyinName: "ceshi-yaoqi",
        inclusionReason: "测试来源"
      },
      update: {
        officialChineseName: "测试药企",
        officialWebsiteUrl: "https://example.com",
        pinyinName: "ceshi-yaoqi",
        inclusionReason: "测试来源"
      }
    });
    expect(db.recruitmentSource.upsert).toHaveBeenCalledWith({
      where: { id: "source-test-social" },
      create: {
        id: "source-test-social",
        companyId: "company-test",
        kind: "SOCIAL",
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
        officialChainEvidenceUrl: "https://example.com/careers",
        status: "VERIFIED_SCRAPABLE"
      },
      update: {
        kind: "SOCIAL",
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
        officialChainEvidenceUrl: "https://example.com/careers",
        status: "VERIFIED_SCRAPABLE"
      }
    });
  });

  it("throws instead of writing fake company website URLs", async () => {
    const db = fakeDb();
    const companyWithoutWebsite = {
      ...plannedCompany,
      officialWebsiteUrl: undefined
    };

    await expect(
      syncPlannedSourcesToDb([plan], [companyWithoutWebsite], db)
    ).rejects.toThrow("company-test is missing officialWebsiteUrl");

    expect(db.company.upsert).not.toHaveBeenCalled();
    expect(db.recruitmentSource.upsert).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/db/companyRegistrySync.test.ts`

Expected: FAIL because `src/db/companyRegistrySync.ts` does not exist.

- [x] **Step 3: Implement registry sync**

Create `src/db/companyRegistrySync.ts`:

```ts
import type { SourceCrawlPlan } from "../crawler/sourcePlan";
import type { CandidateCompany } from "../data/companyRegistry";

export interface CompanyRegistrySyncResult {
  companyCount: number;
  sourceCount: number;
}

export interface CompanyRegistrySyncDb {
  company: {
    upsert(args: {
      where: { id: string };
      create: {
        id: string;
        officialChineseName: string;
        officialWebsiteUrl: string;
        pinyinName: string;
        inclusionReason: string;
      };
      update: {
        officialChineseName: string;
        officialWebsiteUrl: string;
        pinyinName: string;
        inclusionReason: string;
      };
    }): Promise<unknown>;
  };
  recruitmentSource: {
    upsert(args: {
      where: { id: string };
      create: {
        id: string;
        companyId: string;
        kind: "SOCIAL";
        atsKind: string;
        officialEntryUrl: string;
        officialChainEvidenceUrl: string;
        status: string;
      };
      update: {
        kind: "SOCIAL";
        atsKind: string;
        officialEntryUrl: string;
        officialChainEvidenceUrl: string;
        status: string;
      };
    }): Promise<unknown>;
  };
}

export async function syncPlannedSourcesToDb(
  plans: readonly SourceCrawlPlan[],
  companies: readonly CandidateCompany[],
  db: CompanyRegistrySyncDb
): Promise<CompanyRegistrySyncResult> {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const plannedCompanyIds = new Set(plans.map((plan) => plan.company.id));

  let companyCount = 0;
  for (const companyId of plannedCompanyIds) {
    const company = companyById.get(companyId);
    if (!company) {
      throw new Error(`${companyId} is missing from candidateCompanies`);
    }
    if (!company.officialWebsiteUrl) {
      throw new Error(`${companyId} is missing officialWebsiteUrl`);
    }

    await db.company.upsert({
      where: { id: company.id },
      create: {
        id: company.id,
        officialChineseName: company.officialChineseName,
        officialWebsiteUrl: company.officialWebsiteUrl,
        pinyinName: company.pinyinName,
        inclusionReason: company.inclusionReason
      },
      update: {
        officialChineseName: company.officialChineseName,
        officialWebsiteUrl: company.officialWebsiteUrl,
        pinyinName: company.pinyinName,
        inclusionReason: company.inclusionReason
      }
    });
    companyCount += 1;
  }

  for (const plan of plans) {
    await db.recruitmentSource.upsert({
      where: { id: plan.source.id },
      create: {
        id: plan.source.id,
        companyId: plan.company.id,
        kind: "SOCIAL",
        atsKind: plan.source.atsKind,
        officialEntryUrl: plan.source.officialEntryUrl,
        officialChainEvidenceUrl: plan.source.officialChainEvidenceUrl,
        status: plan.source.status
      },
      update: {
        kind: "SOCIAL",
        atsKind: plan.source.atsKind,
        officialEntryUrl: plan.source.officialEntryUrl,
        officialChainEvidenceUrl: plan.source.officialChainEvidenceUrl,
        status: plan.source.status
      }
    });
  }

  return {
    companyCount,
    sourceCount: plans.length
  };
}
```

- [x] **Step 4: Run focused verification**

Run: `npm test -- tests/db/companyRegistrySync.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit Task 1**

Run:

```bash
git add src/db/companyRegistrySync.ts tests/db/companyRegistrySync.test.ts
git commit -m "feat: sync planned crawl sources to database"
```

---

### Task 2: Prisma Crawl Runtime State

**Files:**
- Create: `src/db/crawlRuntimeRepository.ts`
- Test: `tests/db/crawlRuntimeRepository.test.ts`

**Interfaces:**
- Consumes: `toJobSnapshots`, `PersistedJobRow`, `PersistedCrawlObservationRow`.
- Produces:
  - `PrismaCrawlRuntimeDb`
  - `createPrismaCrawlRuntimeDeps(db: PrismaCrawlRuntimeDb)`

- [x] **Step 1: Write the failing runtime repository test**

Create `tests/db/crawlRuntimeRepository.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPrismaCrawlRuntimeDeps } from "../../src/db/crawlRuntimeRepository";

function fakeDb() {
  return {
    job: {
      findMany: vi.fn(async () => [
        {
          dedupeKey: "source-test-social:job-1",
          companyId: "company-test",
          sourceId: "source-test-social",
          sourceJobId: "job-1",
          officialTitle: "医学信息沟通专员",
          auxiliaryChineseTitle: null,
          officialUrl: "https://example.com/jobs/job-1",
          listUrl: null,
          locationRaw: "北京",
          city: "北京",
          cities: ["北京"],
          category: "SALES",
          officialPublishedAt: null,
          firstSeenAt: new Date("2026-07-07T08:00:00.000Z"),
          lastSeenAt: new Date("2026-07-08T08:00:00.000Z"),
          missingSuccessCount: 0,
          lifecycleStatus: "ACTIVE",
          source: {
            atsKind: "MOKA",
            kind: "SOCIAL",
            status: "VERIFIED_SCRAPABLE",
            officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
            officialChainEvidenceUrl: "https://example.com/careers"
          },
          company: {
            officialChineseName: "测试药企"
          }
        }
      ])
    },
    crawlObservation: {
      findMany: vi.fn(async () => [
        {
          crawledAt: new Date("2026-07-08T20:00:00.000Z"),
          successful: false
        },
        {
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          successful: true
        }
      ]),
      findFirst: vi.fn(async () => ({ id: "crawl-1" }))
    }
  };
}

describe("createPrismaCrawlRuntimeDeps", () => {
  it("reads previous jobs, recent observations, and baseline status for a source", async () => {
    const db = fakeDb();
    const deps = createPrismaCrawlRuntimeDeps(db);

    const previousJobs = await deps.getPreviousJobs("source-test-social");
    const observations = await deps.getRecentObservations("source-test-social");
    const baselineCompleted = await deps.isBaselineCompleted("source-test-social");

    expect(db.job.findMany).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social" },
      include: {
        source: {
          select: {
            atsKind: true,
            kind: true,
            status: true,
            officialEntryUrl: true,
            officialChainEvidenceUrl: true
          }
        },
        company: {
          select: {
            officialChineseName: true
          }
        }
      },
      orderBy: { lastSeenAt: "desc" }
    });
    expect(previousJobs[0]?.record.officialChineseCompanyName).toBe("测试药企");
    expect(previousJobs[0]?.record.category).toBe("销售");
    expect(db.crawlObservation.findMany).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social" },
      select: { crawledAt: true, successful: true },
      orderBy: { crawledAt: "desc" },
      take: 10
    });
    expect(observations).toEqual([
      {
        crawledAt: new Date("2026-07-08T20:00:00.000Z"),
        successful: false
      },
      {
        crawledAt: new Date("2026-07-08T08:00:00.000Z"),
        successful: true
      }
    ]);
    expect(db.crawlObservation.findFirst).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social", successful: true },
      select: { id: true },
      orderBy: { crawledAt: "asc" }
    });
    expect(baselineCompleted).toBe(true);
  });
});
```

- [x] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/db/crawlRuntimeRepository.test.ts`

Expected: FAIL because `src/db/crawlRuntimeRepository.ts` does not exist.

- [x] **Step 3: Implement runtime repository**

Create `src/db/crawlRuntimeRepository.ts`:

```ts
import { toJobSnapshots, type PersistedJobRow, type PersistedCrawlObservationRow } from "./crawlStateRepository";

export interface PrismaCrawlRuntimeDb {
  job: {
    findMany(args: {
      where: { sourceId: string };
      include: {
        source: {
          select: {
            atsKind: true;
            kind: true;
            status: true;
            officialEntryUrl: true;
            officialChainEvidenceUrl: true;
          };
        };
        company: {
          select: {
            officialChineseName: true;
          };
        };
      };
      orderBy: { lastSeenAt: "desc" };
    }): Promise<PersistedJobRow[]>;
  };
  crawlObservation: {
    findMany(args: {
      where: { sourceId: string };
      select: { crawledAt: true; successful: true };
      orderBy: { crawledAt: "desc" };
      take: 10;
    }): Promise<PersistedCrawlObservationRow[]>;
    findFirst(args: {
      where: { sourceId: string; successful: true };
      select: { id: true };
      orderBy: { crawledAt: "asc" };
    }): Promise<{ id: string } | null>;
  };
}

export function createPrismaCrawlRuntimeDeps(db: PrismaCrawlRuntimeDb) {
  return {
    async getPreviousJobs(sourceId: string) {
      const rows = await db.job.findMany({
        where: { sourceId },
        include: {
          source: {
            select: {
              atsKind: true,
              kind: true,
              status: true,
              officialEntryUrl: true,
              officialChainEvidenceUrl: true
            }
          },
          company: {
            select: {
              officialChineseName: true
            }
          }
        },
        orderBy: { lastSeenAt: "desc" }
      });

      return toJobSnapshots(rows);
    },
    async getRecentObservations(sourceId: string) {
      return db.crawlObservation.findMany({
        where: { sourceId },
        select: { crawledAt: true, successful: true },
        orderBy: { crawledAt: "desc" },
        take: 10
      });
    },
    async isBaselineCompleted(sourceId: string) {
      const firstSuccess = await db.crawlObservation.findFirst({
        where: { sourceId, successful: true },
        select: { id: true },
        orderBy: { crawledAt: "asc" }
      });

      return firstSuccess !== null;
    }
  };
}
```

- [x] **Step 4: Run focused verification**

Run: `npm test -- tests/db/crawlRuntimeRepository.test.ts tests/db/crawlStateRepository.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit Task 2**

Run:

```bash
git add src/db/crawlRuntimeRepository.ts tests/db/crawlRuntimeRepository.test.ts
git commit -m "feat: read crawl runtime state from database"
```

---

### Task 3: P0 Crawl Command Orchestration

**Files:**
- Create: `src/crawler/p0CrawlCommand.ts`
- Test: `tests/crawler/p0CrawlCommand.test.ts`

**Interfaces:**
- Consumes: `syncPlannedSourcesToDb`, `runP0CrawlBatch`, `SourceCrawlPlan`.
- Produces:
  - `parseP0CrawlArgs(args: readonly string[]): P0CrawlOptions`
  - `selectP0CrawlPlans(plans: readonly SourceCrawlPlan[], options: P0CrawlOptions): SourceCrawlPlan[]`
  - `runP0CrawlCommand(deps: RunP0CrawlCommandDeps): Promise<P0CrawlCommandResult>`
  - `formatP0CrawlResult(result: P0CrawlCommandResult): string`

- [x] **Step 1: Write the failing command test**

Create `tests/crawler/p0CrawlCommand.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { CandidateCompany } from "../../src/data/companyRegistry";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import {
  formatP0CrawlResult,
  parseP0CrawlArgs,
  runP0CrawlCommand,
  selectP0CrawlPlans
} from "../../src/crawler/p0CrawlCommand";

const plan = {
  adapterId: "official-json",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  }
} satisfies SourceCrawlPlan;

const company = {
  id: "company-test",
  officialChineseName: "测试药企",
  officialWebsiteUrl: "https://example.com",
  pinyinName: "ceshi",
  inclusionReason: "测试",
  sources: []
} satisfies CandidateCompany;

describe("P0 crawl command", () => {
  it("parses help and source filters", () => {
    expect(parseP0CrawlArgs(["--help"])).toEqual({ help: true, sourceIds: [] });
    expect(parseP0CrawlArgs(["--source-id", "source-test-social"])).toEqual({
      help: false,
      sourceIds: ["source-test-social"]
    });
    expect(() => parseP0CrawlArgs(["--source-id"])).toThrow("--source-id requires a value");
  });

  it("selects requested plans and rejects unknown source ids", () => {
    expect(selectP0CrawlPlans([plan], { help: false, sourceIds: [] })).toEqual([plan]);
    expect(selectP0CrawlPlans([plan], { help: false, sourceIds: ["source-test-social"] })).toEqual([plan]);
    expect(() =>
      selectP0CrawlPlans([plan], { help: false, sourceIds: ["missing-source"] })
    ).toThrow("Unknown source id: missing-source");
  });

  it("syncs planned sources before running the batch", async () => {
    const calls: string[] = [];
    const result = await runP0CrawlCommand({
      plans: [plan],
      companies: [company],
      options: { help: false, sourceIds: [] },
      db: {},
      fetch: vi.fn(),
      now: () => new Date("2026-07-08T08:00:00.000Z"),
      syncPlannedSourcesToDb: vi.fn(async () => {
        calls.push("sync");
        return { companyCount: 1, sourceCount: 1 };
      }),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch: vi.fn(async () => {
        calls.push("batch");
        return {
          batchId: "batch-1",
          plannedSourceCount: 1,
          dueSourceCount: 1,
          successfulSourceCount: 1,
          failedSourceCount: 0,
          skippedSourceCount: 0
        };
      })
    });

    expect(calls).toEqual(["sync", "batch"]);
    expect(result).toEqual({
      syncedCompanyCount: 1,
      syncedSourceCount: 1,
      batch: {
        batchId: "batch-1",
        plannedSourceCount: 1,
        dueSourceCount: 1,
        successfulSourceCount: 1,
        failedSourceCount: 0,
        skippedSourceCount: 0
      }
    });
    expect(formatP0CrawlResult(result)).toContain("Successful sources: 1");
  });
});
```

- [x] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/crawler/p0CrawlCommand.test.ts`

Expected: FAIL because `src/crawler/p0CrawlCommand.ts` does not exist.

- [x] **Step 3: Implement command orchestration**

Create `src/crawler/p0CrawlCommand.ts`:

```ts
import type { CandidateCompany } from "../data/companyRegistry";
import type { CompanyRegistrySyncDb, CompanyRegistrySyncResult } from "../db/companyRegistrySync";
import type { PrismaCrawlRuntimeDb } from "../db/crawlRuntimeRepository";
import type { RunP0CrawlBatchDeps, P0CrawlBatchResult } from "./runCrawlBatch";
import type { SourceFetchFunction } from "./runSourceCrawl";
import type { SourceCrawlPlan } from "./sourcePlan";

export interface P0CrawlOptions {
  help: boolean;
  sourceIds: string[];
}

export interface P0CrawlCommandResult {
  syncedCompanyCount: number;
  syncedSourceCount: number;
  batch: P0CrawlBatchResult;
}

export interface RuntimeDeps {
  getPreviousJobs: RunP0CrawlBatchDeps["getPreviousJobs"];
  getRecentObservations: RunP0CrawlBatchDeps["getRecentObservations"];
  isBaselineCompleted: RunP0CrawlBatchDeps["isBaselineCompleted"];
}

export interface RunP0CrawlCommandDeps {
  plans: readonly SourceCrawlPlan[];
  companies: readonly CandidateCompany[];
  options: P0CrawlOptions;
  db: CompanyRegistrySyncDb & PrismaCrawlRuntimeDb & RunP0CrawlBatchDeps["db"];
  fetch: SourceFetchFunction;
  now: Date | (() => Date);
  syncPlannedSourcesToDb(
    plans: readonly SourceCrawlPlan[],
    companies: readonly CandidateCompany[],
    db: CompanyRegistrySyncDb
  ): Promise<CompanyRegistrySyncResult>;
  createRuntimeDeps(db: PrismaCrawlRuntimeDb): RuntimeDeps;
  runP0CrawlBatch(
    plans: readonly SourceCrawlPlan[],
    deps: RunP0CrawlBatchDeps
  ): Promise<P0CrawlBatchResult>;
}

export function parseP0CrawlArgs(args: readonly string[]): P0CrawlOptions {
  const sourceIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      return { help: true, sourceIds: [] };
    }
    if (arg === "--source-id") {
      const sourceId = args[index + 1];
      if (!sourceId || sourceId.startsWith("--")) {
        throw new Error("--source-id requires a value");
      }
      sourceIds.push(sourceId);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help: false, sourceIds };
}

export function selectP0CrawlPlans(
  plans: readonly SourceCrawlPlan[],
  options: P0CrawlOptions
): SourceCrawlPlan[] {
  if (options.sourceIds.length === 0) {
    return [...plans];
  }

  const planBySourceId = new Map(plans.map((plan) => [plan.source.id, plan]));
  return options.sourceIds.map((sourceId) => {
    const plan = planBySourceId.get(sourceId);
    if (!plan) {
      throw new Error(`Unknown source id: ${sourceId}`);
    }
    return plan;
  });
}

export async function runP0CrawlCommand({
  plans,
  companies,
  options,
  db,
  fetch,
  now,
  syncPlannedSourcesToDb,
  createRuntimeDeps,
  runP0CrawlBatch
}: RunP0CrawlCommandDeps): Promise<P0CrawlCommandResult> {
  const selectedPlans = selectP0CrawlPlans(plans, options);
  const syncResult = await syncPlannedSourcesToDb(selectedPlans, companies, db);
  const runtimeDeps = createRuntimeDeps(db);
  const batch = await runP0CrawlBatch(selectedPlans, {
    db,
    fetch,
    now,
    ...runtimeDeps
  });

  return {
    syncedCompanyCount: syncResult.companyCount,
    syncedSourceCount: syncResult.sourceCount,
    batch
  };
}

export function formatP0CrawlResult(result: P0CrawlCommandResult): string {
  return [
    "# P0 Crawl Batch",
    "",
    `Synced companies: ${result.syncedCompanyCount}`,
    `Synced sources: ${result.syncedSourceCount}`,
    `Batch id: ${result.batch.batchId}`,
    `Planned sources: ${result.batch.plannedSourceCount}`,
    `Due sources: ${result.batch.dueSourceCount}`,
    `Successful sources: ${result.batch.successfulSourceCount}`,
    `Failed sources: ${result.batch.failedSourceCount}`,
    `Skipped sources: ${result.batch.skippedSourceCount}`
  ].join("\n");
}
```

- [x] **Step 4: Run focused verification**

Run: `npm test -- tests/crawler/p0CrawlCommand.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit Task 3**

Run:

```bash
git add src/crawler/p0CrawlCommand.ts tests/crawler/p0CrawlCommand.test.ts
git commit -m "feat: orchestrate P0 crawl command"
```

---

### Task 4: P0 Crawl CLI Wiring

**Files:**
- Create: `scripts/p0-crawl.ts`
- Modify: `package.json`
- Test: `tests/crawler/p0CrawlCli.test.ts`

**Interfaces:**
- Consumes: `runP0CrawlCommand`, `syncPlannedSourcesToDb`, `createPrismaCrawlRuntimeDeps`, existing source fetchers.
- Produces: `npm run p0:crawl -- [--source-id <sourceId>]`.

- [x] **Step 1: Write the failing CLI help test**

Create `tests/crawler/p0CrawlCli.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runCli(args: string[]): string {
  return execFileSync(
    process.platform === "win32" ? "cmd.exe" : "npx",
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-crawl.ts", ...args]
      : ["tsx", "scripts/p0-crawl.ts", ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8"
    }
  );
}

describe("P0 crawl CLI", () => {
  it("prints usage without requiring database or Tavily credentials", () => {
    const output = runCli(["--help"]);

    expect(output).toContain("Usage: npm run p0:crawl -- [--source-id <sourceId>]");
    expect(output).toContain("--source-id");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  });
});
```

- [x] **Step 2: Run focused CLI test and verify it fails**

Run: `npm test -- tests/crawler/p0CrawlCli.test.ts`

Expected: FAIL because `scripts/p0-crawl.ts` does not exist.

- [x] **Step 3: Implement CLI wiring**

Create `scripts/p0-crawl.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { candidateCompanies } from "../src/data/companyRegistry";
import { syncPlannedSourcesToDb } from "../src/db/companyRegistrySync";
import { createPrismaCrawlRuntimeDeps } from "../src/db/crawlRuntimeRepository";
import {
  formatP0CrawlResult,
  parseP0CrawlArgs,
  runP0CrawlCommand
} from "../src/crawler/p0CrawlCommand";
import { runP0CrawlBatch } from "../src/crawler/runCrawlBatch";
import { createMokaSourceFetch } from "../src/crawler/mokaSourceFetch";
import { createSourceFetchRouter } from "../src/crawler/sourceFetchRouter";
import { buildSourceCrawlPlans } from "../src/crawler/sourcePlan";
import { createTavilyKeyRing } from "../src/crawler/tavily";
import { createTavilySourceFetch } from "../src/crawler/tavilySourceFetch";

function printHelp(): void {
  console.log("Usage: npm run p0:crawl -- [--source-id <sourceId>]");
  console.log("");
  console.log("Runs configured P0 official-source crawl plans and persists observations to PostgreSQL.");
  console.log("Use --source-id more than once to run selected sources only.");
}

function readTavilyKeys(env: NodeJS.ProcessEnv): string[] {
  return [
    ...(env.TAVILY_API_KEYS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    ...(env.TAVILY_API_KEY ? [env.TAVILY_API_KEY] : [])
  ];
}

let options;
try {
  options = parseP0CrawlArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  printHelp();
  process.exit(2);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

const keyRing = createTavilyKeyRing(readTavilyKeys(process.env));
const fetch = createSourceFetchRouter({
  moka: createMokaSourceFetch(),
  fallback: createTavilySourceFetch({ keyRing })
});

const prisma = new PrismaClient();

try {
  const result = await runP0CrawlCommand({
    plans: buildSourceCrawlPlans(candidateCompanies),
    companies: candidateCompanies,
    options,
    db: prisma,
    fetch,
    now: () => new Date(),
    syncPlannedSourcesToDb,
    createRuntimeDeps: createPrismaCrawlRuntimeDeps,
    runP0CrawlBatch
  });

  console.log(formatP0CrawlResult(result));
  process.exitCode = result.batch.failedSourceCount > 0 ? 1 : 0;
} finally {
  await prisma.$disconnect();
}
```

Modify `package.json` scripts block by adding:

```json
"p0:crawl": "tsx scripts/p0-crawl.ts"
```

- [x] **Step 4: Run focused verification**

Run: `npm test -- tests/crawler/p0CrawlCli.test.ts tests/crawler/p0CrawlCommand.test.ts`

Expected: PASS.

Run: `npm run p0:crawl -- --help`

Expected: exits `0`, prints usage, and does not require `DATABASE_URL` or Tavily keys.

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit Task 4**

Run:

```bash
git add scripts/p0-crawl.ts package.json tests/crawler/p0CrawlCli.test.ts
git commit -m "feat: add P0 crawl CLI"
```

---

### Task 5: Full Verification And Plan Completion

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-p0-crawl-cli-foundation.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: completed plan checkboxes only after fresh verification.

- [x] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
npm run p0:crawl -- --help
npm run p0:readiness
npm run p0:readiness -- --help
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected:
- `npm test`, `npm run typecheck`, `npm run build`, and `npm run prisma:validate` pass.
- `npm run p0:crawl -- --help` exits `0`.
- Default `npm run p0:readiness` exits `1` and remains static `0/50` until persisted DB observations are loaded.
- `npm run p0:readiness -- --help` exits `0`.
- Tavily key grep has no matches.

- [x] **Step 2: Mark checkboxes complete**

Only after Step 1 verification, change every task checkbox in this plan from `[ ]` to `[x]`.

- [x] **Step 3: Commit Task 5**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-p0-crawl-cli-foundation.md
git commit -m "docs: complete P0 crawl CLI foundation plan"
```

## Self-Review

- Spec coverage: this plan implements the missing executable bridge from configured official crawl plans to persisted database observations, without fabricating evidence or expanding verified company status.
- Placeholder scan: no placeholder tasks are present; every code task includes file paths, expected commands, and concrete behavior.
- Type consistency: plan functions pass existing `runP0CrawlBatch` dependencies, reuse existing source fetchers, and keep database-facing operations behind narrow fakeable interfaces.
