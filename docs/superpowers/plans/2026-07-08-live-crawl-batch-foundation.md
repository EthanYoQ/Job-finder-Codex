# P0 Live Crawl Batch Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect verified source plans, Tavily-backed source fetching, prior crawl state, lifecycle decisions, and ingestion execution into a testable P0 crawl batch runner.

**Architecture:** Keep the batch runner dependency-injected. Tavily fetching is one `SourceFetchFunction`; database reads and writes are delegate interfaces; the runner orchestrates existing pure functions without creating public APIs or background workers.

**Tech Stack:** TypeScript, Vitest, existing Tavily wrapper, existing crawler contracts, Prisma-like delegates.

## Global Constraints

- Data acquisition must start from company official homepages or official recruitment pages; third-party ATS pages are allowed only when reached from the official chain.
- P0 front-end jobs must come from social recruitment only; campus entries are recorded as source metadata but excluded from search and crawl runs.
- Deterministic adapters produce normalized records; AI is not the primary scraper.
- Failed crawls must record observations but must not increment missing-job counters in lifecycle decisions.
- Baseline completion must be explicit; first baseline results are visible but are not marked new.
- Jobs missing from two consecutive successful source crawls are hidden from front end and marked suspected offline; failed crawls do not increment missing counts.
- No public API, bulk export, deep pagination, admin UI, deployment worker, cron scheduler, security/WAF config, or 50-company verification is introduced by this plan.
- CodeGraph is currently not initialized in this workspace; do not claim CodeGraph-backed structural verification until `codegraph init -i` has been run.

---

## File Structure

- `src/crawler/tavilySourceFetch.ts`: create a `SourceFetchFunction` backed by `extractOfficialSourceWithTavily`.
- `tests/crawler/tavilySourceFetch.test.ts`: fetcher tests using fake Tavily extract calls.
- `src/db/prismaMappers.ts`: add reverse category and lifecycle mappers for persisted rows.
- `tests/db/prismaMappers.test.ts`: prove reverse mappings.
- `src/db/crawlStateRepository.ts`: map persisted job/source/observation rows into `JobSnapshot` and `SourceScheduleState`.
- `tests/db/crawlStateRepository.test.ts`: state mapping tests.
- `src/crawler/runCrawlBatch.ts`: orchestrate due source crawl runs and ingestion command execution.
- `tests/crawler/runCrawlBatch.test.ts`: batch runner tests using fake fetchers and fake DB delegates.
- `docs/superpowers/plans/2026-07-08-live-crawl-batch-foundation.md`: mark plan progress after verification.

---

### Task 1: Tavily Source Fetch Function

**Files:**
- Create: `src/crawler/tavilySourceFetch.ts`
- Create: `tests/crawler/tavilySourceFetch.test.ts`

**Interfaces:**
- Consumes: `SourceCrawlPlan` from `src/crawler/sourcePlan.ts`; `SourceFetchFunction` from `src/crawler/runSourceCrawl.ts`; `extractOfficialSourceWithTavily` and `TavilyExtractDeps` from `src/crawler/tavily.ts`.
- Produces: `createTavilySourceFetch(deps): SourceFetchFunction`.

- [x] **Step 1: Write failing Tavily source fetch tests**

Create `tests/crawler/tavilySourceFetch.test.ts` with three concrete tests:

```ts
import { describe, expect, it } from "vitest";
import { createTavilyKeyRing } from "../../src/crawler/tavily";
import { createTavilySourceFetch } from "../../src/crawler/tavilySourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const htmlPlan: SourceCrawlPlan = {
  adapterId: "html-table",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_HTML",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://example.com/careers",
    officialChainEvidenceUrl: "https://example.com"
  },
  table: {
    rowSelector: "tr",
    fields: {
      officialTitle: { selector: ".title" },
      officialUrl: { selector: ".title a", attribute: "href" },
      locationRaw: { selector: ".city" }
    }
  }
};

const jsonPlan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: htmlPlan.company,
  source: { ...htmlPlan.source, atsKind: "OFFICIAL_JSON" },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "url",
      locationRaw: "location"
    }
  }
};

describe("createTavilySourceFetch", () => {
  it("extracts only the official entry URL and returns HTML content for html-table plans", async () => {
    const calls: unknown[] = [];
    const fetch = createTavilySourceFetch({
      keyRing: createTavilyKeyRing(["key-1"]),
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      extract: async (call) => {
        calls.push(call);
        return {
          ok: true,
          data: {
            results: [{ url: "https://example.com/careers", rawContent: "<table><tr></tr></table>" }],
            failedResults: []
          }
        };
      }
    });

    await expect(fetch(htmlPlan)).resolves.toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      html: "<table><tr></tr></table>"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      apiKey: "key-1",
      urls: ["https://example.com/careers"],
      extractDepth: "advanced"
    });
  });

  it("parses JSON raw content for official-json plans", async () => {
    const fetch = createTavilySourceFetch({
      keyRing: createTavilyKeyRing(["key-1"]),
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      extract: async () => ({
        ok: true,
        data: {
          results: [{ url: "https://example.com/careers", rawContent: "{\"jobs\":[{\"id\":\"1\"}]}" }],
          failedResults: []
        }
      })
    });

    await expect(fetch(jsonPlan)).resolves.toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: { jobs: [{ id: "1" }] }
    });
  });

  it("returns a failed fetch result when Tavily has no usable official content", async () => {
    const fetch = createTavilySourceFetch({
      keyRing: createTavilyKeyRing(["key-1"]),
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      extract: async () => ({ ok: true, data: { results: [], failedResults: [] } })
    });

    await expect(fetch(htmlPlan)).resolves.toEqual({
      ok: false,
      capturedAt: "2026-07-08T00:00:00.000Z",
      failureReason: "Tavily returned no content for https://example.com/careers"
    });
  });
});
```

- [x] **Step 2: Run Tavily source fetch tests to verify they fail**

Run:

```bash
npm test -- tests/crawler/tavilySourceFetch.test.ts
```

Expected: FAIL because `src/crawler/tavilySourceFetch.ts` does not exist.

- [x] **Step 3: Implement Tavily source fetch**

Create `src/crawler/tavilySourceFetch.ts` with:

- `createTavilySourceFetch(deps)` returning a `SourceFetchFunction`;
- only `plan.source.officialEntryUrl` in the Tavily `urls` array;
- query text `${plan.company.officialChineseName} 社会招聘 职位`;
- `extractDepth: "advanced"` and `chunksPerSource: 3`;
- `capturedAt` from `deps.now?.()` or `new Date()`;
- HTML plans return `{ ok: true, capturedAt, html: rawContent }`;
- JSON plans parse raw JSON or fenced ```json code block; invalid JSON returns `{ ok: false, capturedAt, failureReason }`;
- empty Tavily results return `{ ok: false, capturedAt, failureReason }`.

- [x] **Step 4: Verify Task 1**

Run:

```bash
npm test -- tests/crawler/tavilySourceFetch.test.ts tests/crawler/tavily.test.ts
npm run typecheck
```

Expected: focused tests and typecheck pass.

- [x] **Step 5: Commit Task 1**

Run:

```bash
git add src/crawler/tavilySourceFetch.ts tests/crawler/tavilySourceFetch.test.ts
git commit -m "feat: add tavily source fetch function"
```

Expected: commit created.

---

### Task 2: Crawl State Repository Mapping

**Files:**
- Modify: `src/db/prismaMappers.ts`
- Modify: `tests/db/prismaMappers.test.ts`
- Create: `src/db/crawlStateRepository.ts`
- Create: `tests/db/crawlStateRepository.test.ts`

**Interfaces:**
- Consumes: persisted job/source/observation rows from Prisma-like delegates.
- Produces: `fromPrismaJobCategory(name)`, `fromPrismaLifecycleStatus(name)`, `toJobSnapshots(rows)`, `toSourceScheduleState(sourceId, observations)`.

- [x] **Step 1: Write failing mapper and state tests**

Extend `tests/db/prismaMappers.test.ts` with reverse mapping assertions:

```ts
import { fromPrismaJobCategory, fromPrismaLifecycleStatus } from "../../src/db/prismaMappers";

it("maps Prisma job category names back to domain Chinese labels", () => {
  expect(fromPrismaJobCategory("SALES")).toBe("销售");
  expect(fromPrismaJobCategory("MARKET_ACCESS_GOVERNMENT")).toBe("市场准入/政府事务");
  expect(fromPrismaJobCategory("CORPORATE_FUNCTIONS")).toBe("职能");
});

it("maps Prisma lifecycle status names back to crawler lifecycle strings", () => {
  expect(fromPrismaLifecycleStatus("ACTIVE")).toBe("ACTIVE");
  expect(fromPrismaLifecycleStatus("SUSPECTED_OFFLINE")).toBe("SUSPECTED_OFFLINE");
  expect(fromPrismaLifecycleStatus("OFFLINE")).toBe("OFFLINE");
});
```

Create `tests/db/crawlStateRepository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toJobSnapshots, toSourceScheduleState } from "../../src/db/crawlStateRepository";

describe("crawl state repository mappers", () => {
  it("maps persisted active jobs into lifecycle snapshots", () => {
    const snapshots = toJobSnapshots([
      {
        dedupeKey: "source-1:job-1",
        companyId: "company-1",
        sourceId: "source-1",
        sourceJobId: "job-1",
        officialTitle: "Regional Sales Manager",
        auxiliaryChineseTitle: "区域销售经理",
        officialUrl: "https://example.com/jobs/1",
        listUrl: "https://example.com/jobs",
        locationRaw: "北京",
        city: "北京",
        cities: ["北京"],
        category: "SALES",
        officialPublishedAt: new Date("2026-07-07T00:00:00.000Z"),
        firstSeenAt: new Date("2026-07-08T00:00:00.000Z"),
        lastSeenAt: new Date("2026-07-08T12:00:00.000Z"),
        missingSuccessCount: 1,
        lifecycleStatus: "ACTIVE",
        source: {
          atsKind: "OFFICIAL_HTML",
          kind: "SOCIAL",
          status: "VERIFIED_SCRAPABLE",
          officialEntryUrl: "https://example.com/careers",
          officialChainEvidenceUrl: "https://example.com"
        },
        company: { officialChineseName: "测试药企" }
      }
    ]);

    expect(snapshots[0]).toMatchObject({
      dedupeKey: "source-1:job-1",
      lifecycleStatus: "ACTIVE",
      missingSuccessfulCrawlCount: 1,
      record: {
        category: "销售",
        cities: ["北京"],
        officialPublishedAt: "2026-07-07T00:00:00.000Z",
        evidence: {
          officialEntryUrl: "https://example.com/careers",
          officialChainEvidenceUrl: "https://example.com"
        }
      }
    });
  });

  it("computes source schedule state from latest observations", () => {
    const state = toSourceScheduleState("source-1", [
      { crawledAt: new Date("2026-07-08T12:00:00.000Z"), successful: false },
      { crawledAt: new Date("2026-07-08T00:00:00.000Z"), successful: false },
      { crawledAt: new Date("2026-07-07T12:00:00.000Z"), successful: true },
      { crawledAt: new Date("2026-07-07T00:00:00.000Z"), successful: false }
    ]);

    expect(state).toEqual({
      sourceId: "source-1",
      lastSuccessfulCrawlAt: new Date("2026-07-07T12:00:00.000Z"),
      consecutiveFailureCount: 2
    });
  });
});
```

- [x] **Step 2: Run mapper and state tests to verify they fail**

Run:

```bash
npm test -- tests/db/prismaMappers.test.ts tests/db/crawlStateRepository.test.ts
```

Expected: FAIL because reverse mappers and state repository do not exist.

- [x] **Step 3: Implement reverse mappers and crawl state mapping**

Implement reverse maps in `src/db/prismaMappers.ts`. Create `src/db/crawlStateRepository.ts` with row interfaces and pure mappers:

- `toJobSnapshots(rows)` reconstructs `JobSnapshot[]` for lifecycle reducer input;
- source kind must be `"SOCIAL"` because P0 jobs are social-only;
- `officialPublishedAt` is omitted when persisted value is null;
- `isBaseline` is `false` for previous persisted snapshots;
- `toSourceScheduleState(sourceId, observations)` sorts observations descending, finds latest successful crawl, and counts consecutive latest failures before that success.

- [x] **Step 4: Verify Task 2**

Run:

```bash
npm test -- tests/db/prismaMappers.test.ts tests/db/crawlStateRepository.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [x] **Step 5: Commit Task 2**

Run:

```bash
git add src/db/prismaMappers.ts tests/db/prismaMappers.test.ts src/db/crawlStateRepository.ts tests/db/crawlStateRepository.test.ts
git commit -m "feat: map persisted crawl state"
```

Expected: commit created.

---

### Task 3: Crawl Batch Runner

**Files:**
- Create: `src/crawler/runCrawlBatch.ts`
- Create: `tests/crawler/runCrawlBatch.test.ts`

**Interfaces:**
- Consumes: `SourceCrawlPlan`, `SourceFetchFunction`, `applyCrawlObservation`, `buildIngestionCommands`, `executeIngestionCommands`, `isSourceDueForScheduledRun`, and state mappers from Task 2.
- Produces: `runP0CrawlBatch(plans, deps)` and summary type `P0CrawlBatchResult`.

- [x] **Step 1: Write failing batch runner tests**

Create `tests/crawler/runCrawlBatch.test.ts` with tests for:

- skipped source when schedule says not due;
- due source creates a crawl batch, runs fetch, applies lifecycle, and executes observation/job upserts;
- failed source records failed observation but does not upsert lifecycle job changes.

Use fake DB delegates with `crawlBatch.create`, `crawlBatch.update`, `crawlObservation.create`, and `job.upsert`.

- [x] **Step 2: Run batch runner tests to verify they fail**

Run:

```bash
npm test -- tests/crawler/runCrawlBatch.test.ts
```

Expected: FAIL because `src/crawler/runCrawlBatch.ts` does not exist.

- [x] **Step 3: Implement crawl batch runner**

Create `src/crawler/runCrawlBatch.ts` with:

- `RunP0CrawlBatchDeps` containing injected `db`, `fetch`, `now`, `getPreviousJobs(sourceId)`, `getRecentObservations(sourceId)`, and `isBaselineCompleted(sourceId)`;
- `db.crawlBatch.create({ data: { startedAt, status: "SUCCESS" } })` returning `{ id }`;
- for each plan, compute source schedule state from recent observations and skip when not due;
- for due sources, run `runSourceCrawl`, then `applyCrawlObservation`, then `buildIngestionCommands`, then `executeIngestionCommands`;
- pass `baselineCompletedBeforeCrawl` from `isBaselineCompleted(sourceId)`;
- final `db.crawlBatch.update({ where: { id }, data: { finishedAt, status } })`;
- final status is `"FAILED"` when any source result is failed, otherwise `"SUCCESS"`;
- summary includes `batchId`, `plannedSourceCount`, `dueSourceCount`, `successfulSourceCount`, `failedSourceCount`, and `skippedSourceCount`.

- [x] **Step 4: Verify Task 3**

Run:

```bash
npm test -- tests/crawler/runCrawlBatch.test.ts tests/crawler/runSourceCrawl.test.ts tests/db/ingestionRepository.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [x] **Step 5: Commit Task 3**

Run:

```bash
git add src/crawler/runCrawlBatch.ts tests/crawler/runCrawlBatch.test.ts
git commit -m "feat: run p0 crawl batches"
```

Expected: commit created.

---

### Task 4: Live Crawl Batch Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-live-crawl-batch-foundation.md`
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

Append progress entries noting this plan implements Tavily-backed fetch construction, persisted crawl-state mapping, and testable batch orchestration, but still does not implement a cron scheduler, admin UI, production deployment, WAF/rate limits, backups, monitoring, or 50 live verified companies.

- [x] **Step 3: Commit verification marker**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-live-crawl-batch-foundation.md
git commit -m "docs: complete live crawl batch foundation plan"
```

Expected: commit created if the plan file changed.

---

## Self-Review

Spec coverage:

- Covers a Tavily-backed `SourceFetchFunction` that starts from official entry URLs.
- Covers mapping persisted jobs and observations back into lifecycle/schedule inputs.
- Covers a batch runner that filters due sources, runs deterministic adapters, applies lifecycle rules, and writes ingestion commands.
- Does not implement cron scheduling, a production worker process, admin controls, deployment security, backups, monitoring, or the 50 live verified company gate.

Placeholder scan:

- No deferred-work markers or open-ended implementation placeholders are required.
- Tests use concrete values and expected outputs.

Type consistency:

- `createTavilySourceFetch` returns the existing `SourceFetchFunction`.
- `toJobSnapshots` returns existing `JobSnapshot[]`.
- `runP0CrawlBatch` consumes the existing source plans, fetch function, lifecycle reducer, ingestion command builder, and ingestion repository executor.
