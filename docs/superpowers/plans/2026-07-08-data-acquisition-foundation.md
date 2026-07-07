# P0 Data Acquisition Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested P0 data-acquisition foundation for official company source records, Tavily-assisted extraction, adapter contracts, normalized job records, and crawl lifecycle decisions.

**Architecture:** Keep scraping and ingestion logic out of the React UI. Add pure TypeScript contracts first, then a Tavily extraction wrapper with key rotation, deterministic fixture-backed adapters, and lifecycle reducers that later workers can connect to PostgreSQL, scheduled jobs, and admin tools. Live scraping is not asserted by unit tests; unit tests use fixtures and fake clients so CI stays deterministic.

**Tech Stack:** TypeScript, Vitest, Zod, Cheerio for deterministic HTML parsing, `@tavily/core` for Tavily extraction integration, Node.js runtime.

## Global Constraints

- Information gathering and official-source extraction work must prefer Tavily first; use environment-provided keys and rotate keys on quota/rate-limit failures.
- Do not hardcode API keys in source, tests, docs, or examples.
- Data acquisition must start from company official homepages or official recruitment pages; third-party ATS pages are allowed only when reached from the official chain.
- P0 front-end jobs must come from social recruitment only; campus entries are recorded as source metadata but excluded from search results.
- A company is `VERIFIED_SCRAPABLE` only when its social source has official-chain evidence, structured jobs, two successful stable crawl observations, and required company/title/officialUrl/location fields.
- The P0 launch gate remains 80-120 candidate companies and at least 50 verified-scrapable companies.
- AI is not the primary scraper. Deterministic adapters produce normalized records; AI is later used for classification, translation, and anomaly review.
- Adapter contract tests verify external behavior, not parser implementation details.
- Baseline crawl records are not marked new. New labels start only after the baseline.
- Failed crawls do not increment missing-job counters.
- Two consecutive successful misses hide a job as suspected offline; three mark it offline; reappearing jobs become active again.
- No public API, bulk export, deep pagination, or stable third-party data contract is introduced by this plan.

---

## File Structure

- `package.json`: add data acquisition dependencies and verification scripts.
- `.env.example`: add Tavily environment contract without real keys.
- `src/data/companyRegistry.ts`: initial official-source registry and candidate/verified count helpers.
- `src/crawler/normalizedJob.ts`: normalized job record schema, evidence schema, and required-field helpers.
- `src/crawler/tavily.ts`: Tavily extraction wrapper with API-key rotation and injectable client factory.
- `src/crawler/adapters/types.ts`: adapter interfaces, crawl success/failure result types, and adapter registry types.
- `src/crawler/adapters/officialJson.ts`: deterministic JSON adapter for official JSON/API and Redsea-style payloads.
- `src/crawler/adapters/htmlTable.ts`: deterministic HTML table/list adapter for official HTML, Novartis-like, and Zhiye-like fixtures.
- `src/crawler/lifecycle.ts`: baseline/new/offline lifecycle reducer for normalized job records.
- `src/crawler/fixtures/*.json|*.html`: small official-source-style fixtures used by contract tests.
- `tests/data/companyRegistry.test.ts`: registry and launch-gate tests.
- `tests/crawler/normalizedJob.test.ts`: normalized record validation tests.
- `tests/crawler/tavily.test.ts`: Tavily key rotation and failure tests.
- `tests/crawler/adapters.test.ts`: adapter contract tests.
- `tests/crawler/lifecycle.test.ts`: baseline/new/offline lifecycle tests.

---

### Task 1: Company Registry And Normalized Job Contract

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Create: `src/data/companyRegistry.ts`
- Create: `src/crawler/normalizedJob.ts`
- Create: `tests/data/companyRegistry.test.ts`
- Create: `tests/crawler/normalizedJob.test.ts`

**Interfaces:**
- Produces: `candidateCompanies`, `getSocialSources()`, `getCandidatePoolStats()`, `NormalizedJobRecordSchema`, `NormalizedJobRecord`, `hasRequiredJobFields(record)`, `buildJobDedupeKey(record)`.
- Consumes: `ATSKind`, `Company`, `RecruitmentSource`, `VerificationStatus` from `src/domain/company.ts`; `JobCategory` from `src/domain/search.ts`.

- [ ] **Step 1: Install data acquisition dependency**

Run:

```bash
npm install cheerio @tavily/core
```

Expected: `package.json` and `package-lock.json` update; install exits 0.

- [ ] **Step 2: Add failing registry tests**

Create `tests/data/companyRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  candidateCompanies,
  getCandidatePoolStats,
  getSocialSources
} from "../../src/data/companyRegistry";

describe("P0 company registry", () => {
  it("keeps the P0 candidate pool inside the required 80-120 range", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.totalCandidates).toBeGreaterThanOrEqual(80);
    expect(stats.totalCandidates).toBeLessThanOrEqual(120);
  });

  it("does not mark the registry as P0-launchable before 50 companies are verified scrapable", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.verifiedScrapableCompanies).toBeLessThan(50);
    expect(stats.canLaunchP0).toBe(false);
  });

  it("separates social sources from campus sources", () => {
    const socialSources = getSocialSources(candidateCompanies);

    expect(socialSources.length).toBeGreaterThan(0);
    expect(socialSources.every((source) => source.kind === "SOCIAL")).toBe(true);
  });
});
```

- [ ] **Step 3: Run registry test to verify it fails**

Run:

```bash
npm test -- tests/data/companyRegistry.test.ts
```

Expected: FAIL because `src/data/companyRegistry.ts` does not exist.

- [ ] **Step 4: Add failing normalized job tests**

Create `tests/crawler/normalizedJob.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NormalizedJobRecordSchema,
  buildJobDedupeKey,
  hasRequiredJobFields
} from "../../src/crawler/normalizedJob";

describe("normalized job record", () => {
  it("accepts the minimum P0 official-source job fields", () => {
    const record = NormalizedJobRecordSchema.parse({
      companyId: "company-astrazeneca",
      sourceId: "source-astrazeneca-social",
      sourceKind: "SOCIAL",
      atsKind: "OFFICIAL_JSON",
      officialChineseCompanyName: "阿斯利康制药有限公司",
      officialTitle: "Regional Sales Manager (Beijing)",
      auxiliaryChineseTitle: "区域销售经理（北京）",
      officialUrl: "https://job-search.astrazeneca.cn/job/123",
      listUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
      sourceJobId: "123",
      locationRaw: "北京",
      cities: ["北京"],
      category: "销售",
      isBaseline: true,
      evidence: {
        officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
        officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers",
        capturedAt: "2026-07-08T00:00:00.000Z"
      }
    });

    expect(hasRequiredJobFields(record)).toBe(true);
    expect(buildJobDedupeKey(record)).toBe("source-astrazeneca-social:123");
  });

  it("rejects non-social records for P0 front-end ingestion", () => {
    expect(() =>
      NormalizedJobRecordSchema.parse({
        companyId: "company-campus",
        sourceId: "source-campus",
        sourceKind: "CAMPUS",
        atsKind: "MOKA",
        officialChineseCompanyName: "测试药企",
        officialTitle: "校园招聘",
        officialUrl: "https://example.com/campus",
        locationRaw: "北京",
        cities: ["北京"],
        category: "其他",
        isBaseline: false,
        evidence: {
          officialEntryUrl: "https://example.com/campus",
          officialChainEvidenceUrl: "https://example.com/careers",
          capturedAt: "2026-07-08T00:00:00.000Z"
        }
      })
    ).toThrow();
  });
});
```

- [ ] **Step 5: Run normalized job test to verify it fails**

Run:

```bash
npm test -- tests/crawler/normalizedJob.test.ts
```

Expected: FAIL because `src/crawler/normalizedJob.ts` does not exist.

- [ ] **Step 6: Implement registry and normalized job contract**

Implement:

```ts
// src/crawler/normalizedJob.ts
import { z } from "zod";
import { JOB_CATEGORIES } from "../domain/search";

const AtsKindSchema = z.enum([
  "OFFICIAL_HTML",
  "OFFICIAL_JSON",
  "MOKA",
  "BEISEN_ZHIYE",
  "WORKDAY",
  "SUCCESSFACTORS",
  "REDSEA",
  "BROWSER_FALLBACK",
  "UNKNOWN"
]);

export const CrawlEvidenceSchema = z.object({
  officialEntryUrl: z.string().url(),
  officialChainEvidenceUrl: z.string().url(),
  capturedAt: z.string().datetime(),
  rawSnapshotRef: z.string().optional()
});

export const NormalizedJobRecordSchema = z.object({
  companyId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceKind: z.literal("SOCIAL"),
  atsKind: AtsKindSchema,
  officialChineseCompanyName: z.string().min(1),
  officialTitle: z.string().min(1),
  auxiliaryChineseTitle: z.string().min(1).optional(),
  officialUrl: z.string().url(),
  listUrl: z.string().url().optional(),
  sourceJobId: z.string().min(1).optional(),
  locationRaw: z.string().min(1),
  cities: z.array(z.string().min(1)).min(1),
  category: z.enum(JOB_CATEGORIES),
  officialPublishedAt: z.string().datetime().optional(),
  isBaseline: z.boolean(),
  evidence: CrawlEvidenceSchema
});

export type NormalizedJobRecord = z.infer<typeof NormalizedJobRecordSchema>;

export function hasRequiredJobFields(record: NormalizedJobRecord): boolean {
  return Boolean(
    record.officialChineseCompanyName &&
      record.officialTitle &&
      record.officialUrl &&
      record.locationRaw &&
      record.cities.length > 0
  );
}

export function buildJobDedupeKey(record: NormalizedJobRecord): string {
  return `${record.sourceId}:${record.sourceJobId ?? record.officialUrl}`;
}
```

For `src/data/companyRegistry.ts`, export 80-120 candidate companies using the company names from `docs/research/p0-company-and-reuse-research.md`; only mark the already-evidenced representative companies as `VERIFIED_SCRAPABLE`, and leave the rest as `UNVERIFIED` or `ENTRY_FOUND_PENDING_ADAPTER`.

Add `.env.example` keys without secrets:

```dotenv
TAVILY_API_KEYS="tvly-dev-replace-key-0,tvly-dev-replace-key-1,tvly-dev-replace-key-2"
```

- [ ] **Step 7: Verify Task 1**

Run:

```bash
npm test -- tests/data/companyRegistry.test.ts tests/crawler/normalizedJob.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git add package.json package-lock.json .env.example src/data/companyRegistry.ts src/crawler/normalizedJob.ts tests/data/companyRegistry.test.ts tests/crawler/normalizedJob.test.ts
git commit -m "feat: add source registry and normalized job contract"
```

Expected: commit created.

---

### Task 2: Tavily Extraction Wrapper With Key Rotation

**Files:**
- Create: `src/crawler/tavily.ts`
- Create: `tests/crawler/tavily.test.ts`

**Interfaces:**
- Produces: `createTavilyKeyRing(keys)`, `extractOfficialSourceWithTavily(request, deps)`, `TavilyExtractRequest`, `TavilyExtractResult`.
- Consumes: `TAVILY_API_KEYS` from environment in later CLI/worker tasks.

- [ ] **Step 1: Write failing Tavily tests**

Create `tests/crawler/tavily.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createTavilyKeyRing,
  extractOfficialSourceWithTavily
} from "../../src/crawler/tavily";

describe("Tavily extraction wrapper", () => {
  it("rotates to the next key after a quota failure", async () => {
    const keysUsed: string[] = [];
    const result = await extractOfficialSourceWithTavily(
      {
        urls: ["https://example.com/careers"],
        query: "social recruitment jobs",
        extractDepth: "advanced"
      },
      {
        keyRing: createTavilyKeyRing(["key-0", "key-1"]),
        extract: async ({ apiKey }) => {
          keysUsed.push(apiKey);
          if (apiKey === "key-0") {
            return {
              ok: false,
              retryable: true,
              error: "quota exceeded"
            };
          }
          return {
            ok: true,
            data: {
              results: [
                {
                  url: "https://example.com/careers",
                  rawContent: "职位列表 北京 Regional Sales Manager"
                }
              ],
              failedResults: []
            }
          };
        }
      }
    );

    expect(keysUsed).toEqual(["key-0", "key-1"]);
    expect(result.results[0]?.rawContent).toContain("职位列表");
  });

  it("fails without leaking key values when all keys fail", async () => {
    await expect(
      extractOfficialSourceWithTavily(
        { urls: ["https://example.com/careers"] },
        {
          keyRing: createTavilyKeyRing(["secret-key"]),
          extract: async () => ({
            ok: false,
            retryable: true,
            error: "quota exceeded for secret-key"
          })
        }
      )
    ).rejects.toThrow("Tavily extraction failed after 1 key attempt");
  });
});
```

- [ ] **Step 2: Run Tavily test to verify it fails**

Run:

```bash
npm test -- tests/crawler/tavily.test.ts
```

Expected: FAIL because `src/crawler/tavily.ts` does not exist.

- [ ] **Step 3: Implement Tavily wrapper**

Implement a wrapper that accepts injected `extract` for tests, rotates keys on retryable failures, and redacts key values from thrown errors. The default dependency should use `@tavily/core` dynamically so browser bundles do not include it:

```ts
const { tavily } = await import("@tavily/core");
const client = tavily({ apiKey });
await client.extract(urls, { extractDepth, format: "markdown", query, chunksPerSource });
```

- [ ] **Step 4: Verify Task 2**

Run:

```bash
npm test -- tests/crawler/tavily.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/crawler/tavily.ts tests/crawler/tavily.test.ts package.json package-lock.json
git commit -m "feat: add tavily extraction key rotation"
```

Expected: commit created.

---

### Task 3: Deterministic Adapter Contract And Fixtures

**Files:**
- Create: `src/crawler/adapters/types.ts`
- Create: `src/crawler/adapters/officialJson.ts`
- Create: `src/crawler/adapters/htmlTable.ts`
- Create: `src/crawler/fixtures/astrazeneca-official-json.json`
- Create: `src/crawler/fixtures/novartis-table.html`
- Create: `src/crawler/fixtures/zhiyelike-table.html`
- Create: `src/crawler/fixtures/redsea-json.json`
- Create: `tests/crawler/adapters.test.ts`

**Interfaces:**
- Produces: `SourceAdapter`, `CrawlAdapterInput`, `CrawlAdapterResult`, `officialJsonAdapter`, `htmlTableAdapter`.
- Consumes: `NormalizedJobRecord` and source metadata from Task 1.

- [ ] **Step 1: Write failing adapter contract tests**

Create `tests/crawler/adapters.test.ts` with one test each for:

- official JSON/API fixture returns at least one normalized Beijing job.
- HTML table fixture returns official title, city, category, and official URL.
- Zhiye-like table fixture maps multiple rows into normalized records.
- Redsea-style JSON fixture can produce records from network JSON payloads even when DOM is empty.

Each assertion must use `hasRequiredJobFields(record)` and must not inspect parser-private helpers.

- [ ] **Step 2: Run adapter tests to verify they fail**

Run:

```bash
npm test -- tests/crawler/adapters.test.ts
```

Expected: FAIL because adapter files do not exist.

- [ ] **Step 3: Implement adapter interfaces and deterministic adapters**

Implement:

- `officialJsonAdapter.extract(input)` for JSON arrays and nested JSON payloads.
- `htmlTableAdapter.extract(input)` using Cheerio selectors configured by task input.
- Both adapters return `{ status: "SUCCESS", jobs, observation }` when at least one job is normalized, otherwise `{ status: "FAILED", failureReason }`.

- [ ] **Step 4: Verify Task 3**

Run:

```bash
npm test -- tests/crawler/adapters.test.ts tests/crawler/normalizedJob.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/crawler/adapters src/crawler/fixtures tests/crawler/adapters.test.ts
git commit -m "feat: add source adapter contract fixtures"
```

Expected: commit created.

---

### Task 4: Crawl Lifecycle Reducer

**Files:**
- Create: `src/crawler/lifecycle.ts`
- Create: `tests/crawler/lifecycle.test.ts`

**Interfaces:**
- Produces: `applyCrawlObservation(previousJobs, currentJobs, options)`, `JobSnapshot`, `LifecycleDecision`.
- Consumes: `NormalizedJobRecord` and `buildJobDedupeKey(record)`.

- [ ] **Step 1: Write failing lifecycle tests**

Create `tests/crawler/lifecycle.test.ts` with tests for:

- first baseline crawl stores jobs with `isNew: false`;
- post-baseline newly appearing job gets `isNew: true`;
- one successful miss increments missing count but keeps active;
- two successful misses hides as `SUSPECTED_OFFLINE`;
- three successful misses marks `OFFLINE`;
- failed crawls do not increment missing count;
- reappearing jobs become `ACTIVE` and reset missing count.

- [ ] **Step 2: Run lifecycle tests to verify they fail**

Run:

```bash
npm test -- tests/crawler/lifecycle.test.ts
```

Expected: FAIL because `src/crawler/lifecycle.ts` does not exist.

- [ ] **Step 3: Implement lifecycle reducer**

Implement pure functions only. Do not add database calls in this task. Use `ACTIVE`, `SUSPECTED_OFFLINE`, and `OFFLINE` string lifecycle states compatible with Prisma enum names.

- [ ] **Step 4: Verify Task 4**

Run:

```bash
npm test -- tests/crawler/lifecycle.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/crawler/lifecycle.ts tests/crawler/lifecycle.test.ts
git commit -m "feat: add crawl lifecycle reducer"
```

Expected: commit created.

---

### Task 5: Data Acquisition Verification

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Modify: `docs/superpowers/plans/2026-07-08-data-acquisition-foundation.md`

**Interfaces:**
- Consumes all files from Tasks 1-4.
- Produces no runtime interface; verifies the new foundation is coherent and ready for later database/worker integration.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
```

Expected: all commands pass.

- [ ] **Step 2: Confirm no secrets were committed**

Run:

```bash
rg -n "tvly-dev-[A-Za-z0-9_-]+" .
```

Expected: no matches in tracked source/docs.

- [ ] **Step 3: Mark this plan complete in the progress ledger**

Append lines to `.superpowers/sdd/progress.md` for each completed task range and note that this plan still does not implement production scheduling, PostgreSQL persistence, admin UI, or 50 live verified companies.

- [ ] **Step 4: Commit verification marker**

Run:

```bash
git add .superpowers/sdd/progress.md docs/superpowers/plans/2026-07-08-data-acquisition-foundation.md
git commit -m "docs: record data acquisition foundation progress"
```

Expected: commit created if files changed.

---

## Self-Review

Spec coverage:

- Covers source registry structure and keeps the P0 80-120 / 50 verified gate explicit.
- Covers official social source separation from campus sources.
- Covers Tavily-first extraction integration and key rotation without hardcoding secrets.
- Covers normalized job records with required company/title/officialUrl/location fields.
- Covers deterministic adapter contracts for official JSON/API, HTML table/list, Zhiye-like, and Redsea-like payloads.
- Covers baseline/new/offline lifecycle rules.
- Does not implement production database ingestion, scheduled twice-daily worker, admin UI, real 50-company verification, deployment, WAF, backups, monitoring, privacy/terms pages, or public website API integration. Those require follow-up plans.

Placeholder scan:

- No task depends on unspecified implementation details; fixtures are intentionally small and deterministic.
- No API key value is included.

Type consistency:

- `NormalizedJobRecord`, `SourceAdapter`, `CrawlAdapterResult`, and lifecycle states are defined before later tasks consume them.

Execution choice:

- The user requested continuing with the superpower framework toward PRD P0 completion. Execute this plan with `superpowers:subagent-driven-development` when subagents are available; otherwise use `superpowers:executing-plans`.
