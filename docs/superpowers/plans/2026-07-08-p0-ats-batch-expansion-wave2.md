# P0 ATS Batch Expansion Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise P0 readiness from `24/50` by adding deterministic ATS-grouped official-source fetchers and source plans, then running two formal DB-backed crawls until `npm run p0:readiness -- --db` reaches at least `50/50`.

**Architecture:** Keep discovery separate from formal evidence. Add reusable ATS fetchers behind `SourceFetchFunction`, route by `atsKind`, normalize each ATS payload into the existing `official-json` adapter contract, and count only persisted observations produced by `npm run p0:crawl`. First wave is Workday because the official API shape and China facets have already been verified; subsequent waves use the same test-first pattern for Hotjob/Wecruit and any other ATS group that can return structured jobs through official-chain URLs.

**Tech Stack:** TypeScript, Vitest, Node `fetch`, Prisma/PostgreSQL, existing P0 crawl CLI, existing source registry and readiness report.

## Global Constraints

- Recruitment information must come from official company pages or official-chain ATS pages only.
- A source does not count as P0 readiness evidence unless `npm run p0:readiness -- --db` sees at least two latest successful stable crawl observations for that configured verified social source.
- The formal evidence gate must keep requiring company, title, officialUrl, and location stable fields.
- Tavily, Agent Reach, web search, and browser inspection may be used only for discovery, official-chain proof, and API/selector hinting; they must not be the formal readiness evidence fetcher.
- No Tavily keys or other secrets may be committed, printed, or written into docs, tests, fixtures, reports, plans, or logs.
- P0 remains blocked until `npm run p0:readiness -- --db` reports at least 50 crawl-evidenced verified companies and exits `0`.
- Failed crawls must not increase job-missing counts and must not count as readiness evidence.
- Add production code only after a focused failing test has been run and observed.
- If a candidate ATS cannot return structured jobs deterministically, keep it out of `VERIFIED_SCRAPABLE` and record it as discovery-only or pending.

---

### Task 1: Workday Source Fetcher

**Files:**
- Create: `src/crawler/workdaySourceFetch.ts`
- Create: `tests/crawler/workdaySourceFetch.test.ts`
- Modify: `src/crawler/sourcePlan.ts`
- Modify: `src/crawler/sourceFetchRouter.ts`
- Modify: `scripts/p0-crawl.ts`
- Modify: `tests/crawler/sourceFetchRouter.test.ts`

**Interfaces:**
- Consumes: `SourceCrawlPlan` with `source.atsKind === "WORKDAY"` and `plan.workday` settings.
- Produces: `createWorkdaySourceFetch(deps?: WorkdaySourceFetchDeps): SourceFetchFunction` returning `{ ok: true, payload: { jobPostings } }` for the existing `official-json` adapter.
- Produces: optional `workday` config on official-json source plans with `tenant`, `site`, `appliedFacets`, `pageSize`, `maxPages`, and `cityHints`.

- [x] **Step 1: Write failing Workday fetcher tests**

Create `tests/crawler/workdaySourceFetch.test.ts` with tests that assert:

```ts
import { describe, expect, it } from "vitest";
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-pfizer-china", officialChineseName: "辉瑞" },
  source: {
    id: "source-pfizer-china-social",
    companyId: "company-pfizer-china",
    kind: "SOCIAL",
    atsKind: "WORKDAY",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
    officialChainEvidenceUrl: "https://www.pfizer.com/about/careers"
  },
  json: {
    jobsPath: "jobPostings",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    }
  },
  workday: {
    tenant: "pfizer",
    site: "PfizerCareers",
    appliedFacets: { Location_Country: ["china-id"] },
    pageSize: 2,
    maxPages: 2
  }
} satisfies SourceCrawlPlan;
```

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/crawler/workdaySourceFetch.test.ts
```

Expected: FAIL because `src/crawler/workdaySourceFetch.ts` does not exist.

- [x] **Step 3: Implement Workday fetcher and router wiring**

Implement `src/crawler/workdaySourceFetch.ts`, extend `SourceCrawlPlan` official-json plans with optional `workday` config, add optional `workday` fetch dependency to `createSourceFetchRouter`, and pass `workday: createWorkdaySourceFetch()` in `scripts/p0-crawl.ts`.

- [x] **Step 4: Add router tests for Workday dispatch**

Modify `tests/crawler/sourceFetchRouter.test.ts` so a `WORKDAY` plan is routed to `workday`, not fallback.

- [x] **Step 5: Verify Task 1**

Run:

```bash
npm test -- tests/crawler/workdaySourceFetch.test.ts tests/crawler/sourceFetchRouter.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 2: Workday Verified Source Plans

**Files:**
- Modify: `src/data/companyRegistry.ts`
- Modify: `src/crawler/sourcePlan.ts`
- Modify: `tests/data/companyRegistry.test.ts`
- Modify: `tests/crawler/sourcePlan.test.ts`

**Interfaces:**
- Consumes: `WORKDAY_JSON_CONFIG` and `workday` fetch config from Task 1.
- Produces: configured verified social sources for Pfizer China and Haleon China.

- [x] **Step 1: Write failing registry and source-plan tests**

Add assertions that Pfizer China and Haleon China are `VERIFIED_SCRAPABLE` Workday social sources with first-party official-chain evidence.

Add source-plan assertions for `source-pfizer-china-social` and `source-haleon-china-social` with `adapterId: "official-json"`, `json.jobsPath: "jobPostings"`, and exact Workday facet IDs.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts
```

Expected: FAIL because the registry and source plan entries are not yet configured.

- [x] **Step 3: Configure Pfizer and Haleon**

Use these formally verified Workday configs:

```ts
"source-pfizer-china-social": {
  adapterId: "official-json",
  json: WORKDAY_JSON_CONFIG,
  workday: {
    tenant: "pfizer",
    site: "PfizerCareers",
    appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
    pageSize: 20,
    maxPages: 10
  }
}
```

```ts
"source-haleon-china-social": {
  adapterId: "official-json",
  json: WORKDAY_JSON_CONFIG,
  workday: {
    tenant: "gsknch",
    site: "GSKCareers",
    appliedFacets: {
      location: [
        "03fe97f04c9a01333d3739eea7577455",
        "03fe97f04c9a01ebc5af2deea7576a55",
        "15dc3becd679105e714122093995f79f",
        "b5196703399c0188e29d0aedaf53abef"
      ]
    },
    pageSize: 20,
    maxPages: 5,
    cityHints: {
      "SHANGHAI QIANTAN PLAZA": ["上海"],
      "Suzhou Plant Tech Industry Park": ["苏州"]
    }
  }
}
```

- [x] **Step 4: Verify Task 2**

Run:

```bash
npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts tests/crawler/workdaySourceFetch.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 3: Formal Workday Crawl Evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-p0-ats-batch-expansion-wave2.md`

**Interfaces:**
- Consumes: `npm run p0:crawl -- --force --source-id ...` and DB readiness report.
- Produces: two successful persisted observations for Pfizer and Haleon.

- [x] **Step 1: Run first forced Workday crawl**

Run:

```bash
$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:crawl -- --force --source-id source-pfizer-china-social --source-id source-haleon-china-social
```

Expected: `Planned sources: 2`, `Successful sources: 2`, `Failed sources: 0`.

- [x] **Step 2: Run second forced Workday crawl**

Run the same command again.

Expected: `Planned sources: 2`, `Successful sources: 2`, `Failed sources: 0`.

- [x] **Step 3: Check readiness delta**

Run:

```bash
$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:readiness -- --db
```

Expected: crawl-evidenced verified companies increases from `24/50` to at least `26/50`. If any Workday source fails, do not mark it complete; inspect failure evidence and keep the source pending until fixed.

---

### Task 4: Next ATS Batch Loop To 50

**Files:**
- Create or Modify: ATS fetcher files under `src/crawler/*SourceFetch.ts`
- Modify: `src/crawler/sourceFetchRouter.ts`
- Modify: `scripts/p0-crawl.ts`
- Modify: `src/data/companyRegistry.ts`
- Modify: `src/crawler/sourcePlan.ts`
- Modify: relevant tests under `tests/crawler` and `tests/data`
- Modify: `docs/superpowers/plans/2026-07-08-p0-ats-batch-expansion-wave2.md`

**Interfaces:**
- Consumes: high-confidence official-chain discovery candidates from `docs/research/p0-source-discovery-candidates.json` and live official pages.
- Produces: enough configured and twice-crawled source plans for `npm run p0:readiness -- --db` to report at least `50/50`.

- [x] **Step 1: Select the next ATS group by evidence, not company order**

Use this priority order:

```text
official JSON/API > static HTML/table > ATS direct API > Playwright/browser fallback
```

For each candidate group, verify before coding:

```text
officialEntryUrl + officialChainEvidenceUrl + atsKind + deterministic selector/API hint + expected structured fields
```

- [x] **Step 2: Write failing tests for the selected group**

For a new fetcher, create `tests/crawler/<ats>SourceFetch.test.ts` first. For source plans, add exact `sourceId`, `officialEntryUrl`, `officialChainEvidenceUrl`, adapter config, and registry assertions before modifying implementation.

- [x] **Step 3: Implement the smallest reusable fetcher or direct HTML plan batch**

Only implement the adapter surface needed by tests. Do not promote a candidate to `VERIFIED_SCRAPABLE` unless the fetcher/direct HTML plan can return structured jobs with location.

- [x] **Step 4: Run two formal crawls for the batch**

Run:

```bash
$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:crawl -- --force --source-id <source-id-1> --source-id <source-id-2>
```

Run the same command twice. Expected for counted sources: no failed source.

- [x] **Step 5: Repeat until readiness reaches 50**

After each batch, run:

```bash
$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:readiness -- --db
```

If below `50/50`, repeat Task 4 with the next ATS group. If it reaches at least `50/50`, run final verification.

Completed batches:

- Workday searchText batch: Roche, MSD, BMS, Gilead, Agilent; two formal forced crawls succeeded 5/5 and DB readiness moved to `38/50`.
- Workday + Hotjob batch: Abbott, Stryker, GE HealthCare, Edwards, Medtronic, CR Sanjiu; two formal forced crawls succeeded 6/6 and DB readiness moved to `44/50`.
- Final official-source batch: Innovent, Novo Nordisk, Boehringer Ingelheim, Merck, Thermo Fisher, Sinocelltech; formal crawls succeeded, with Novo retried after one transient `fetch failed`, and DB readiness reached `50/50`.

---

### Task 5: Final Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-p0-ats-batch-expansion-wave2.md`

- [x] **Step 1: Run full project verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected: tests, typecheck, build, and Prisma validation pass; secret grep returns no matches in tracked project files.

- [x] **Step 2: Run final DB readiness gate**

Run:

```bash
$env:DATABASE_URL='postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public'; npm run p0:readiness -- --db
```

Expected: `Crawl-evidenced verified companies: 50/50` or higher and exit code `0`.

- [x] **Step 3: Commit verified changes**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-p0-ats-batch-expansion-wave2.md src tests scripts
git commit -m "feat: expand p0 ATS crawl evidence"
```

## Self-Review

- Spec coverage: The plan preserves official-chain sourcing, structured job extraction, two successful formal crawls, and the DB-backed `p0:readiness` gate.
- Placeholder scan: Unknown later candidates are intentionally excluded from code tasks until they have verified official-chain and selector/API evidence; this is not counted as readiness until formal crawls pass.
- Type consistency: Workday plan config is defined on `SourceCrawlPlan`, consumed only by `createWorkdaySourceFetch`, and routed by `createSourceFetchRouter`.
- Risk note: Reaching 50 may require more than one ATS group. Any unverified candidate remains discovery-only and must not be promoted.
