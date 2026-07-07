# P0 Crawl Orchestration And Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect verified official-source metadata, deterministic adapters, crawl lifecycle decisions, and database-ready ingestion actions into a tested P0 crawler orchestration layer.

**Architecture:** Keep this layer pure and dependency-injected. Source plans describe which adapter and source metadata to use; the runner accepts a fetch dependency and adapter registry; ingestion builds Prisma-ready command objects without opening a database connection; schedule policy returns deterministic run windows. This plan deliberately avoids live crawling and PostgreSQL writes so each behavior remains testable.

**Tech Stack:** TypeScript, Vitest, existing crawler contracts, existing source registry, existing lifecycle reducer, Node.js runtime.

## Global Constraints

- Information gathering and official-source extraction work must prefer Tavily first; live fetchers are dependency-injected and not hardcoded in tests.
- Data acquisition must start from company official homepages or official recruitment pages; third-party ATS pages are allowed only when reached from the official chain.
- P0 front-end jobs must come from social recruitment only; campus entries are recorded as source metadata but excluded from search and crawl runs.
- Deterministic adapters produce normalized records; AI is not the primary scraper.
- Failed crawls must record observations but must not increment missing-job counters in lifecycle decisions.
- Baseline completion must be explicit; first baseline results are visible but are not marked new.
- No database connection, public API, bulk export, deep pagination, or stable third-party data contract is introduced by this plan.

---

## File Structure

- `src/crawler/sourcePlan.ts`: source-run plan model, adapter config metadata, eligible-source filtering.
- `tests/crawler/sourcePlan.test.ts`: source planning tests.
- `src/crawler/runSourceCrawl.ts`: dependency-injected single-source runner.
- `tests/crawler/runSourceCrawl.test.ts`: runner tests using fixtures and fake fetchers.
- `src/crawler/ingestion.ts`: Prisma-ready ingestion command builder from crawl results and lifecycle decisions.
- `tests/crawler/ingestion.test.ts`: ingestion action tests.
- `src/crawler/schedule.ts`: twice-daily schedule and source due policy.
- `tests/crawler/schedule.test.ts`: schedule tests.

---

### Task 1: Source Crawl Plan

**Files:**
- Create: `src/crawler/sourcePlan.ts`
- Create: `tests/crawler/sourcePlan.test.ts`

**Interfaces:**
- Produces: `SourceCrawlPlan`, `buildSourceCrawlPlans(companies)`, `getPlanBySourceId(plans, sourceId)`.
- Consumes: `CandidateCompany`, `CandidateRecruitmentSource` from `src/data/companyRegistry.ts`; adapter config types from `src/crawler/adapters/types.ts`.

- [ ] **Step 1: Write failing source-plan tests**

Create `tests/crawler/sourcePlan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("source crawl planning", () => {
  it("creates crawl plans only for social sources with official entry and chain evidence", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);

    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((plan) => plan.source.kind === "SOCIAL")).toBe(true);
    expect(plans.every((plan) => plan.source.officialEntryUrl)).toBe(true);
    expect(plans.every((plan) => plan.source.officialChainEvidenceUrl)).toBe(true);
    expect(plans.some((plan) => plan.company.id === "company-hengrui")).toBe(false);
  });

  it("assigns deterministic adapter ids for representative source types", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")?.adapterId).toBe("official-json");
    expect(getPlanBySourceId(plans, "source-novartis-social")?.adapterId).toBe("html-table");
    expect(getPlanBySourceId(plans, "source-fosun-pharma-social")?.adapterId).toBe("html-table");
    expect(getPlanBySourceId(plans, "source-cspc-social")?.adapterId).toBe("official-json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/crawler/sourcePlan.test.ts
```

Expected: FAIL because `src/crawler/sourcePlan.ts` does not exist.

- [ ] **Step 3: Implement source crawl plans**

Create `src/crawler/sourcePlan.ts` with:

```ts
import type { CandidateCompany, CandidateRecruitmentSource } from "../data/companyRegistry";
import type { HtmlTableConfig, OfficialJsonConfig } from "./adapters/types";

export type CrawlAdapterId = "official-json" | "html-table";

export type SourceCrawlPlan =
  | {
      adapterId: "official-json";
      company: { id: string; officialChineseName: string };
      source: Required<Pick<CandidateRecruitmentSource, "id" | "companyId" | "kind" | "atsKind" | "status" | "officialEntryUrl" | "officialChainEvidenceUrl">>;
      json: OfficialJsonConfig;
    }
  | {
      adapterId: "html-table";
      company: { id: string; officialChineseName: string };
      source: Required<Pick<CandidateRecruitmentSource, "id" | "companyId" | "kind" | "atsKind" | "status" | "officialEntryUrl" | "officialChainEvidenceUrl">>;
      table: HtmlTableConfig;
    };

const REPRESENTATIVE_CONFIGS: Record<string, Pick<SourceCrawlPlan, "adapterId"> & Record<string, unknown>> = {
  "source-astrazeneca-social": {
    adapterId: "official-json",
    json: {
      jobsPath: "data.jobs",
      fields: {
        sourceJobId: "id",
        officialTitle: "title",
        auxiliaryChineseTitle: "titleCn",
        officialUrl: "url",
        locationRaw: "location",
        cities: "cities",
        category: "category",
        officialPublishedAt: "publishedAt"
      }
    } satisfies OfficialJsonConfig
  },
  "source-novartis-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "table[data-testid='jobs'] tbody tr",
      fields: {
        sourceJobId: { selector: "[data-field='id']" },
        officialTitle: { selector: "[data-field='title']" },
        officialUrl: { selector: "[data-field='title'] a", attribute: "href" },
        locationRaw: { selector: "[data-field='city']" },
        category: { selector: "[data-field='category']" }
      }
    } satisfies HtmlTableConfig
  },
  "source-fosun-pharma-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job-table tbody tr",
      fields: {
        sourceJobId: { selector: ".job-id" },
        officialTitle: { selector: ".job-title" },
        officialUrl: { selector: ".job-title a", attribute: "href" },
        locationRaw: { selector: ".job-city" },
        category: { selector: ".job-category" }
      }
    } satisfies HtmlTableConfig
  },
  "source-cspc-social": {
    adapterId: "official-json",
    json: {
      jobsPath: "result.list",
      fields: {
        sourceJobId: "jobCode",
        officialTitle: "jobName",
        officialUrl: "applyUrl",
        locationRaw: "workPlace",
        cities: "cityList",
        category: "positionType"
      }
    } satisfies OfficialJsonConfig
  }
};

export function buildSourceCrawlPlans(companies: readonly CandidateCompany[]): SourceCrawlPlan[] {
  return companies.flatMap((company) =>
    company.sources.flatMap((source) => {
      if (source.kind !== "SOCIAL" || !source.officialEntryUrl || !source.officialChainEvidenceUrl) {
        return [];
      }

      const config = REPRESENTATIVE_CONFIGS[source.id];
      if (!config) {
        return [];
      }

      const plannedSource = {
        id: source.id,
        companyId: source.companyId,
        kind: source.kind,
        atsKind: source.atsKind,
        status: source.status,
        officialEntryUrl: source.officialEntryUrl,
        officialChainEvidenceUrl: source.officialChainEvidenceUrl
      };

      const plannedCompany = {
        id: company.id,
        officialChineseName: company.officialChineseName
      };

      return config.adapterId === "official-json"
        ? [{ adapterId: "official-json", company: plannedCompany, source: plannedSource, json: config.json as OfficialJsonConfig }]
        : [{ adapterId: "html-table", company: plannedCompany, source: plannedSource, table: config.table as HtmlTableConfig }];
    })
  );
}

export function getPlanBySourceId(
  plans: readonly SourceCrawlPlan[],
  sourceId: string
): SourceCrawlPlan | undefined {
  return plans.find((plan) => plan.source.id === sourceId);
}
```

- [ ] **Step 4: Verify Task 1**

Run:

```bash
npm test -- tests/crawler/sourcePlan.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/crawler/sourcePlan.ts tests/crawler/sourcePlan.test.ts
git commit -m "feat: plan official source crawl runs"
```

Expected: commit created.

---

### Task 2: Single Source Crawl Runner

**Files:**
- Create: `src/crawler/runSourceCrawl.ts`
- Create: `tests/crawler/runSourceCrawl.test.ts`

**Interfaces:**
- Produces: `runSourceCrawl(plan, deps)`, `SourceFetchResult`, `SourceFetchFunction`.
- Consumes: `SourceCrawlPlan`, `officialJsonAdapter`, `htmlTableAdapter`.

- [ ] **Step 1: Write failing runner tests**

Create tests for:

- an official JSON plan uses the JSON adapter and returns normalized jobs;
- an HTML plan uses the HTML adapter and returns normalized jobs;
- failed fetch returns a failed observation without adapter execution;
- non-baseline crawl passes `isBaseline: false` through to normalized jobs.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/crawler/runSourceCrawl.test.ts
```

Expected: FAIL because runner does not exist.

- [ ] **Step 3: Implement dependency-injected runner**

Implement `runSourceCrawl(plan, deps)` as a pure async function. `deps.fetch(plan)` returns:

```ts
type SourceFetchResult =
  | { ok: true; capturedAt: string; payload: unknown }
  | { ok: true; capturedAt: string; html: string }
  | { ok: false; capturedAt: string; failureReason: string };
```

Runner selects adapter by `plan.adapterId`, returns the adapter result, and never opens a network connection itself.

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm test -- tests/crawler/runSourceCrawl.test.ts tests/crawler/adapters.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/crawler/runSourceCrawl.ts tests/crawler/runSourceCrawl.test.ts
git commit -m "feat: run single source crawls"
```

Expected: commit created.

---

### Task 3: Ingestion Command Builder

**Files:**
- Create: `src/crawler/ingestion.ts`
- Create: `tests/crawler/ingestion.test.ts`

**Interfaces:**
- Produces: `buildIngestionCommands(result, lifecycleDecisions)`, `IngestionCommand`.
- Consumes: `CrawlAdapterResult`, `LifecycleDecision`.

- [ ] **Step 1: Write failing ingestion tests**

Create tests for:

- success result produces crawl observation insert and job upsert commands;
- suspected/offline lifecycle statuses become hidden front-end eligibility flags;
- failed result produces only crawl observation insert and no job upserts.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/crawler/ingestion.test.ts
```

Expected: FAIL because ingestion builder does not exist.

- [ ] **Step 3: Implement ingestion command builder**

Implement command union:

```ts
export type IngestionCommand =
  | { type: "UPSERT_CRAWL_OBSERVATION"; observation: CrawlAdapterResult["observation"] }
  | { type: "UPSERT_JOB"; dedupeKey: string; record: NormalizedJobRecord; lifecycleStatus: LifecycleStatus; visibleInFrontend: boolean; isNew: boolean; firstSeenAt: string; lastSeenAt: string; missingSuccessfulCrawlCount: number };
```

`visibleInFrontend` is true only for `ACTIVE`.

- [ ] **Step 4: Verify Task 3**

Run:

```bash
npm test -- tests/crawler/ingestion.test.ts tests/crawler/lifecycle.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/crawler/ingestion.ts tests/crawler/ingestion.test.ts
git commit -m "feat: build crawl ingestion commands"
```

Expected: commit created.

---

### Task 4: Twice-Daily Schedule Policy

**Files:**
- Create: `src/crawler/schedule.ts`
- Create: `tests/crawler/schedule.test.ts`

**Interfaces:**
- Produces: `P0_CRAWL_WINDOWS`, `isSourceDueForScheduledRun(sourceState, now)`, `nextP0CrawlWindow(now)`.

- [ ] **Step 1: Write failing schedule tests**

Create tests proving:

- default P0 windows are `08:00` and `20:00` China time labels;
- sources with no previous successful crawl are due;
- sources already successfully crawled in the current window are not due;
- sources with three consecutive failures remain due for retry/attention.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/crawler/schedule.test.ts
```

Expected: FAIL because schedule policy does not exist.

- [ ] **Step 3: Implement schedule policy**

Implement deterministic string/date helpers only; do not add timers or background workers in this task.

- [ ] **Step 4: Verify Task 4**

Run:

```bash
npm test -- tests/crawler/schedule.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/crawler/schedule.ts tests/crawler/schedule.test.ts
git commit -m "feat: add twice daily crawl schedule policy"
```

Expected: commit created.

---

### Task 5: Orchestration Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-crawl-orchestration-and-ingestion.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected: all test/build/schema commands pass; grep returns no matches.

- [ ] **Step 2: Mark progress**

Append progress entries noting this plan implements crawl orchestration and ingestion commands, but still does not implement live crawler deployment, PostgreSQL writes, admin UI, or 50 live verified companies.

- [ ] **Step 3: Commit verification marker**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-crawl-orchestration-and-ingestion.md .superpowers/sdd/progress.md
git commit -m "docs: complete crawl orchestration plan"
```

Expected: commit created if files changed.

---

## Self-Review

Spec coverage:

- Covers official social-source crawl planning.
- Covers deterministic adapter orchestration without live network calls.
- Covers ingestion actions that preserve lifecycle visibility, new labels, and failed observations.
- Covers twice-daily schedule policy as pure logic.
- Does not implement live fetcher wiring, PostgreSQL writes, admin manual recrawl, deployment worker process, or 50 live verified companies.

Placeholder scan:

- No real Tavily keys are included.
- No TODO/TBD placeholders are required for implementation.

Type consistency:

- `SourceCrawlPlan`, `SourceFetchResult`, `IngestionCommand`, and `P0_CRAWL_WINDOWS` are defined before downstream tasks use them.

Execution choice:

- Execute with `superpowers:subagent-driven-development` when subagents are available; otherwise use `superpowers:executing-plans`.
