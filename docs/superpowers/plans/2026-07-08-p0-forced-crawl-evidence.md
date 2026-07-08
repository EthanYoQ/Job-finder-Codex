# P0 Forced Crawl Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal `p0:crawl -- --force` option so a real manual crawl can bypass the twice-daily schedule gate and persist a second successful observation for verified sources during P0 validation.

**Architecture:** Extend the existing crawl batch scheduler boundary with an explicit `force` option that affects only source due/skipped decisions. Keep normal scheduled behavior unchanged by default, and wire the CLI option through the existing command orchestration layer.

**Tech Stack:** TypeScript, Vitest, Prisma-backed P0 crawl CLI, existing `runP0CrawlBatch`, existing `p0:readiness -- --db`.

## Global Constraints

- Do not mark additional companies as `VERIFIED_SCRAPABLE`.
- Do not insert, fake, or count fixture observations as production evidence.
- Forced crawl still performs the real source fetch and persists real crawl observations.
- Default `npm run p0:crawl` behavior must keep respecting the schedule gate.
- `npm run p0:crawl -- --force` may require `DATABASE_URL` and source fetch credentials depending on selected sources.
- `--force` is an internal validation/admin tool; it does not add public APIs, public UI, deployment scripts, WAF config, monitoring, backups, source expansion, or live verification for new companies.
- Do not print or store Tavily keys or other secrets.

---

### Task 1: Crawl Batch Force Option

**Files:**
- Modify: `src/crawler/runCrawlBatch.ts`
- Test: `tests/crawler/runCrawlBatch.test.ts`

**Interfaces:**
- Consumes: existing `runP0CrawlBatch(plans, deps)`.
- Produces: optional `force?: boolean` on `RunP0CrawlBatchDeps`.

- [ ] **Step 1: Write failing force behavior test**

Modify `tests/crawler/runCrawlBatch.test.ts` by adding this test inside `describe("runP0CrawlBatch", () => { ... })`:

```ts
  it("runs a source in the current schedule window when force is enabled", async () => {
    const plan = planFor("source-beigene-social");
    const db = fakeDb();
    const fetch = vi.fn(async () => ({
      ok: true as const,
      capturedAt: CAPTURED_AT,
      payload: {
        success: true,
        data: {
          jobs: [
            {
              id: "beigene-job-1",
              title: "Research Chief",
              officialUrl: "https://app.mokahr.com/apply/beigene/98934#/job/beigene-job-1",
              locationRaw: "上海市",
              cities: ["上海市"]
            }
          ]
        }
      }
    }));

    const result = await runP0CrawlBatch([plan], {
      db,
      fetch,
      now: NOW,
      force: true,
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [
        {
          crawledAt: new Date("2026-07-08T00:15:00.000Z"),
          successful: true
        }
      ],
      isBaselineCompleted: async () => true
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      plannedSourceCount: 1,
      dueSourceCount: 1,
      successfulSourceCount: 1,
      failedSourceCount: 0,
      skippedSourceCount: 0
    });
  });
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/crawler/runCrawlBatch.test.ts`

Expected: FAIL because `force` is not supported and the source is skipped.

- [ ] **Step 3: Implement force option**

Modify `src/crawler/runCrawlBatch.ts`:

```ts
export interface RunP0CrawlBatchDeps {
  db: PrismaIngestionDb & {
    crawlBatch: PrismaCrawlBatchDb;
  };
  fetch: SourceFetchFunction;
  now: Date | (() => Date);
  force?: boolean;
  getPreviousJobs(sourceId: string): Promise<readonly JobSnapshot[]>;
  getRecentObservations(sourceId: string): Promise<readonly PersistedCrawlObservationRow[]>;
  isBaselineCompleted(sourceId: string): Promise<boolean>;
}
```

Then change the due check inside the loop to:

```ts
      if (!deps.force && !isSourceDueForScheduledRun(sourceState, batchStartedAt)) {
        skippedSourceCount += 1;
        continue;
      }
```

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/crawler/runCrawlBatch.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/crawler/runCrawlBatch.ts tests/crawler/runCrawlBatch.test.ts
git commit -m "feat: support forced P0 crawl batches"
```

---

### Task 2: P0 Crawl CLI Force Wiring

**Files:**
- Modify: `src/crawler/p0CrawlCommand.ts`
- Modify: `scripts/p0-crawl.ts`
- Test: `tests/crawler/p0CrawlCommand.test.ts`
- Test: `tests/crawler/p0CrawlCli.test.ts`

**Interfaces:**
- Consumes: `RunP0CrawlBatchDeps.force`.
- Produces: `parseP0CrawlArgs(["--force"])` and `npm run p0:crawl -- --force`.

- [ ] **Step 1: Write failing command and CLI tests**

Modify `tests/crawler/p0CrawlCommand.test.ts`:

```ts
  it("parses force and passes it into the batch runner", async () => {
    expect(parseP0CrawlArgs(["--source-id", "source-test-social", "--force"])).toEqual({
      help: false,
      sourceIds: ["source-test-social"],
      force: true
    });

    const runP0CrawlBatch = vi.fn(async () => ({
      batchId: "batch-1",
      plannedSourceCount: 1,
      dueSourceCount: 1,
      successfulSourceCount: 1,
      failedSourceCount: 0,
      skippedSourceCount: 0
    }));

    await runP0CrawlCommand({
      plans: [plan],
      companies: [company],
      options: { help: false, sourceIds: [], force: true },
      db: {
        company: { upsert: vi.fn() },
        recruitmentSource: { upsert: vi.fn() },
        job: { findMany: vi.fn(), upsert: vi.fn() },
        crawlObservation: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
        crawlBatch: { create: vi.fn(), update: vi.fn() }
      },
      fetch: vi.fn(),
      now: () => new Date("2026-07-08T08:00:00.000Z"),
      syncPlannedSourcesToDb: vi.fn(async () => ({ companyCount: 1, sourceCount: 1 })),
      createRuntimeDeps: vi.fn(() => ({
        getPreviousJobs: async () => [],
        getRecentObservations: async () => [],
        isBaselineCompleted: async () => false
      })),
      runP0CrawlBatch
    });

    expect(runP0CrawlBatch).toHaveBeenCalledWith(
      [plan],
      expect.objectContaining({ force: true })
    );
  });
```

Modify `tests/crawler/p0CrawlCli.test.ts` help test:

```ts
    expect(output).toContain("--force");
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/crawler/p0CrawlCommand.test.ts tests/crawler/p0CrawlCli.test.ts`

Expected: FAIL because `--force` is not parsed or printed.

- [ ] **Step 3: Implement force parsing and wiring**

Modify `src/crawler/p0CrawlCommand.ts`:

```ts
export interface P0CrawlOptions {
  help: boolean;
  sourceIds: string[];
  force?: boolean;
}
```

Add this branch in `parseP0CrawlArgs`:

```ts
    if (arg === "--force") {
      continue;
    }
```

Before returning from `parseP0CrawlArgs`, compute:

```ts
  return { help: false, sourceIds, force: args.includes("--force") };
```

In `runP0CrawlCommand`, pass:

```ts
    force: options.force,
```

Modify `scripts/p0-crawl.ts` help text:

```ts
  console.log("Use --force to bypass the schedule gate for manual validation crawls.");
```

When calling `runP0CrawlCommand` after pre-selecting plans, keep only the force option:

```ts
    options: { help: false, sourceIds: [], force: options.force },
```

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/crawler/p0CrawlCommand.test.ts tests/crawler/p0CrawlCli.test.ts tests/crawler/runCrawlBatch.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/crawler/p0CrawlCommand.ts scripts/p0-crawl.ts tests/crawler/p0CrawlCommand.test.ts tests/crawler/p0CrawlCli.test.ts
git commit -m "feat: add forced P0 crawl CLI option"
```

---

### Task 3: Forced Crawl Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-p0-forced-crawl-evidence.md`

**Interfaces:**
- Consumes: Tasks 1-2.
- Produces: completed plan checkboxes after verification, plus real local evidence that one configured source can reach `1/50` with two successful forced/manual crawls.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
npm run p0:crawl -- --help
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected:
- `npm test`, `npm run typecheck`, `npm run build`, and `npm run prisma:validate` pass.
- `npm run p0:crawl -- --help` exits `0` and includes `--force`.
- Tavily key grep has no matches.

- [ ] **Step 2: Run real forced Beigene crawl against local PostgreSQL**

With process-level `DATABASE_URL` only, run:

```bash
npm run p0:crawl -- --source-id source-beigene-social --force
```

Expected:
- exits `0`.
- reports `Successful sources: 1`.
- does not require Tavily credentials because the selected source is Moka.

- [ ] **Step 3: Verify database readiness evidence**

With the same process-level `DATABASE_URL`, run:

```bash
npm run p0:readiness -- --db
```

Expected:
- exits `1`.
- reports `Candidate companies: 110`.
- reports `Crawl-evidenced verified companies: 1/50`.
- still blocks on `VERIFIED_COMPANIES_BELOW_50`.

- [ ] **Step 4: Mark checkboxes complete**

Only after Steps 1-3 verification, change every task checkbox in this plan from `[ ]` to `[x]`.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-p0-forced-crawl-evidence.md
git commit -m "docs: complete forced crawl evidence plan"
```

## Self-Review

- Spec coverage: this plan supports manual real re-crawl evidence without changing verified company status or fabricating observations.
- Placeholder scan: no placeholders are present.
- Type consistency: `force` flows from CLI args to command options to `runP0CrawlBatch` dependencies.
