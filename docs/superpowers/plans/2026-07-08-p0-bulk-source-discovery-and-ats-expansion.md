# P0 Bulk Source Discovery And ATS Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move P0 readiness from the current verified evidence count toward `50/50` by replacing one-company-at-a-time expansion with batch official-entry discovery, ATS grouping, deterministic adapters, and two formal database-backed crawl observations per company.

**Architecture:** Discovery and formal evidence are separate phases. Tavily, Agent Reach, Exa, Jina, browser inspection, and search engines may discover official entry URLs, official-chain evidence URLs, ATS kinds, and selector/API hints, but only the project crawler output persisted to PostgreSQL can count as readiness evidence. Formal crawl order is official JSON/API, direct HTML/table, ATS direct API, then Playwright/browser fallback only for sources that cannot be fetched with HTTP.

**Tech Stack:** TypeScript, Vitest, Cheerio, Node `fetch`, Prisma/PostgreSQL, existing P0 crawl CLI, Agent Reach/Exa/Tavily for discovery only.

## Global Constraints

- Recruitment information must come from official company pages or official-chain ATS pages only.
- A source does not count as P0 readiness evidence unless `npm run p0:readiness -- --db` sees two latest successful stable crawl observations for that configured verified social source.
- The formal evidence gate must keep requiring company, title, officialUrl, and location stable fields.
- Tavily, Agent Reach, Exa, Jina, browser inspection, and search engines may be used for discovery, but they must not be the formal readiness evidence fetcher.
- No Tavily keys or other secrets may be committed, printed, or written into docs, tests, fixtures, reports, plans, or logs.
- P0 launch remains blocked until at least 50 crawl-evidenced verified companies are reported by `npm run p0:readiness -- --db`.
- Do not mark a company `VERIFIED_SCRAPABLE` until it has first-party official-chain evidence and a deterministic configured source plan.
- Failed crawls must not increase job-missing counts and must not count as readiness evidence.
- Browser/Playwright fallback is allowed only after HTTP/API extraction is insufficient; benchmark it separately because 2 vCPU / 2 GB is prototype-only.
- Current 2 vCPU / 2 GB server is suitable only for prototype validation; stable operation target is 4 vCPU / 8 GB RAM.

---

### Task 1: Formal Readiness Evidence Guard

**Files:**
- Create: `src/crawler/unsupportedSourceFetch.ts`
- Create: `tests/crawler/unsupportedSourceFetch.test.ts`
- Modify: `scripts/p0-crawl.ts`
- Modify: `tests/crawler/p0CrawlCli.test.ts`

**Interfaces:**
- Consumes: `SourceFetchFunction` from `src/crawler/runSourceCrawl.ts`.
- Produces: `createUnsupportedSourceFetch(): SourceFetchFunction`.

- [x] **Step 1: Write the failing tests**

Create `tests/crawler/unsupportedSourceFetch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createUnsupportedSourceFetch } from "../../src/crawler/unsupportedSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "WORKDAY",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://example.com/jobs",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      officialTitle: "title",
      officialUrl: "url",
      locationRaw: "location"
    }
  }
} satisfies SourceCrawlPlan;

describe("createUnsupportedSourceFetch", () => {
  it("fails formal crawls for source plans without a deterministic fetcher", async () => {
    const fetch = createUnsupportedSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z")
    });

    await expect(fetch(plan)).resolves.toEqual({
      ok: false,
      capturedAt: "2026-07-08T00:00:00.000Z",
      failureReason:
        "Formal readiness crawl is not configured for WORKDAY source source-test-social"
    });
  });
});
```

Modify `tests/crawler/p0CrawlCli.test.ts` to assert the formal CLI help does not describe Tavily as readiness evidence:

```ts
it("does not advertise Tavily as a formal readiness evidence fetcher", () => {
  const output = execFileSync(command, [...args, "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" }
  });

  expect(output).toContain("Runs configured P0 official-source crawl plans");
  expect(output).not.toContain("Tavily-backed readiness");
});
```

- [x] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm test -- tests/crawler/unsupportedSourceFetch.test.ts tests/crawler/p0CrawlCli.test.ts
```

Expected: FAIL because `src/crawler/unsupportedSourceFetch.ts` does not exist.

- [x] **Step 3: Implement formal unsupported fetcher and wire it into the CLI fallback**

Create `src/crawler/unsupportedSourceFetch.ts`:

```ts
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface UnsupportedSourceFetchDeps {
  now?: () => Date;
}

export function createUnsupportedSourceFetch(
  deps: UnsupportedSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    return failed(
      capturedAt,
      `Formal readiness crawl is not configured for ${plan.source.atsKind} source ${plan.source.id}`
    );
  };
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}
```

Modify `scripts/p0-crawl.ts`:

```ts
import { createUnsupportedSourceFetch } from "../src/crawler/unsupportedSourceFetch";
```

Then replace the Tavily fallback in `createSourceFetchRouter` wiring with:

```ts
  fallback: createUnsupportedSourceFetch()
```

Keep the Tavily wrapper module and tests intact for discovery tooling, but do not use it as the formal `p0:crawl` fallback.

- [x] **Step 4: Run focused verification**

Run:

```bash
npm test -- tests/crawler/unsupportedSourceFetch.test.ts tests/crawler/p0CrawlCli.test.ts tests/crawler/sourceFetchRouter.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit Task 1**

Run:

```bash
git add src/crawler/unsupportedSourceFetch.ts tests/crawler/unsupportedSourceFetch.test.ts scripts/p0-crawl.ts tests/crawler/p0CrawlCli.test.ts
git commit -m "feat: guard formal crawl evidence sources"
```

---

### Task 2: Batch Discovery Evidence Manifest

**Files:**
- Create: `src/crawler/sourceDiscovery.ts`
- Create: `tests/crawler/sourceDiscovery.test.ts`
- Create: `docs/research/p0-source-discovery-candidates.json`

**Interfaces:**
- Produces: `SourceDiscoveryCandidate`, `parseSourceDiscoveryCandidates(input: unknown): SourceDiscoveryCandidate[]`, `summarizeSourceDiscoveryCandidates(candidates)`.

- [x] **Step 1: Write the failing tests**

Create `tests/crawler/sourceDiscovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseSourceDiscoveryCandidates,
  summarizeSourceDiscoveryCandidates
} from "../../src/crawler/sourceDiscovery";

describe("source discovery candidates", () => {
  it("parses official-chain discovery candidates without making them readiness evidence", () => {
    const candidates = parseSourceDiscoveryCandidates([
      {
        companyId: "company-innovent",
        companyName: "信达生物制药（苏州）有限公司",
        officialWebsiteUrl: "https://www.innoventbio.com/",
        officialEntryUrl: "https://www.innoventbio.com/cn/careers/jobs",
        officialChainEvidenceUrl: "https://www.innoventbio.com/cn/careers",
        atsKind: "OFFICIAL_HTML",
        confidence: "HIGH",
        discoveryMethod: "official page inspection",
        selectorHint: ".job-list tr",
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      }
    ]);

    expect(candidates).toEqual([
      {
        companyId: "company-innovent",
        companyName: "信达生物制药（苏州）有限公司",
        officialWebsiteUrl: "https://www.innoventbio.com/",
        officialEntryUrl: "https://www.innoventbio.com/cn/careers/jobs",
        officialChainEvidenceUrl: "https://www.innoventbio.com/cn/careers",
        atsKind: "OFFICIAL_HTML",
        confidence: "HIGH",
        discoveryMethod: "official page inspection",
        selectorHint: ".job-list tr",
        apiHint: undefined,
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      }
    ]);
  });

  it("summarizes high-confidence candidates by ATS kind", () => {
    const candidates = parseSourceDiscoveryCandidates([
      {
        companyId: "company-a",
        companyName: "A",
        officialWebsiteUrl: "https://a.example/",
        officialEntryUrl: "https://a.example/jobs",
        officialChainEvidenceUrl: "https://a.example/careers",
        atsKind: "MOKA",
        confidence: "HIGH",
        discoveryMethod: "official page inspection",
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      },
      {
        companyId: "company-b",
        companyName: "B",
        officialWebsiteUrl: "https://b.example/",
        officialEntryUrl: "https://b.example/jobs",
        officialChainEvidenceUrl: "https://b.example/careers",
        atsKind: "MOKA",
        confidence: "LOW",
        discoveryMethod: "search result only",
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      }
    ]);

    expect(summarizeSourceDiscoveryCandidates(candidates)).toEqual({
      total: 2,
      highConfidence: 1,
      byAtsKind: { MOKA: 2 }
    });
  });
});
```

- [x] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm test -- tests/crawler/sourceDiscovery.test.ts
```

Expected: FAIL because `src/crawler/sourceDiscovery.ts` does not exist.

- [x] **Step 3: Implement discovery manifest parser**

Create `src/crawler/sourceDiscovery.ts`:

```ts
import { z } from "zod";
import type { ATSKind } from "../domain/company";

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
]) satisfies z.ZodType<ATSKind>;

const SourceDiscoveryCandidateSchema = z.object({
  companyId: z.string().min(1),
  companyName: z.string().min(1),
  officialWebsiteUrl: z.string().url(),
  officialEntryUrl: z.string().url(),
  officialChainEvidenceUrl: z.string().url(),
  atsKind: AtsKindSchema,
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  discoveryMethod: z.string().min(1),
  selectorHint: z.string().min(1).optional(),
  apiHint: z.string().min(1).optional(),
  formalEvidenceStatus: z.literal("DISCOVERED_NOT_COUNTED")
});

export type SourceDiscoveryCandidate = z.infer<typeof SourceDiscoveryCandidateSchema>;

export interface SourceDiscoverySummary {
  total: number;
  highConfidence: number;
  byAtsKind: Partial<Record<ATSKind, number>>;
}

export function parseSourceDiscoveryCandidates(input: unknown): SourceDiscoveryCandidate[] {
  return z.array(SourceDiscoveryCandidateSchema).parse(input);
}

export function summarizeSourceDiscoveryCandidates(
  candidates: readonly SourceDiscoveryCandidate[]
): SourceDiscoverySummary {
  const byAtsKind: Partial<Record<ATSKind, number>> = {};

  for (const candidate of candidates) {
    byAtsKind[candidate.atsKind] = (byAtsKind[candidate.atsKind] ?? 0) + 1;
  }

  return {
    total: candidates.length,
    highConfidence: candidates.filter((candidate) => candidate.confidence === "HIGH").length,
    byAtsKind
  };
}
```

Create `docs/research/p0-source-discovery-candidates.json` with an empty audited list:

```json
[]
```

- [x] **Step 4: Run focused verification**

Run:

```bash
npm test -- tests/crawler/sourceDiscovery.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 5: Commit Task 2**

Run:

```bash
git add src/crawler/sourceDiscovery.ts tests/crawler/sourceDiscovery.test.ts docs/research/p0-source-discovery-candidates.json
git commit -m "feat: add source discovery evidence manifest"
```

---

### Task 3: Bulk Official Entry Discovery Wave

**Files:**
- Modify: `docs/research/p0-source-discovery-candidates.json`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: `candidateCompanies` from `src/data/companyRegistry.ts`.
- Produces: at least 44 high-confidence discovery candidates that are not counted as readiness evidence.

- [x] **Step 1: Run discovery searches by ATS group**

Use Agent Reach / Exa / Tavily only for discovery. Do not save secrets. Use query families:

```bash
mcporter call 'exa.web_search_exa(query: "site:mokahr.com/apply 药业 社会招聘 Moka", numResults: 10)'
mcporter call 'exa.web_search_exa(query: "site:mokahr.com/social-recruitment 药业 社会招聘 Moka", numResults: 10)'
mcporter call 'exa.web_search_exa(query: "site:zhiye.com 药业 社会招聘", numResults: 10)'
mcporter call 'exa.web_search_exa(query: "site:myworkdayjobs.com China pharma careers", numResults: 10)'
mcporter call 'exa.web_search_exa(query: "site:successfactors.com China pharma careers", numResults: 10)'
```

For every candidate, verify the official chain by reading the company official site or official careers page. Record only candidates where the official-chain page is first-party or a first-party page links to the ATS entry.

- [x] **Step 2: Append discovery candidates**

Append candidates to `docs/research/p0-source-discovery-candidates.json` using this exact object shape:

```json
{
  "companyId": "company-innovent",
  "companyName": "信达生物制药（苏州）有限公司",
  "officialWebsiteUrl": "https://www.innoventbio.com/",
  "officialEntryUrl": "https://www.innoventbio.com/cn/careers/jobs",
  "officialChainEvidenceUrl": "https://www.innoventbio.com/cn/careers",
  "atsKind": "OFFICIAL_HTML",
  "confidence": "HIGH",
  "discoveryMethod": "official page inspection",
  "selectorHint": ".job-list tr",
  "formalEvidenceStatus": "DISCOVERED_NOT_COUNTED"
}
```

Rules:

- Use existing `companyId` values from `src/data/companyRegistry.ts`.
- Do not add a candidate if official-chain evidence is only a search result, generic ATS page, job board, or third-party article.
- Use `confidence: "HIGH"` only when the official-chain page is first-party and the entry page returns visible jobs or a detectable API/table hint.
- Use `confidence: "MEDIUM"` when official-chain evidence is first-party but selector/API details still need browser verification.
- Do not use `confidence: "LOW"` for implementation waves.

- [x] **Step 3: Validate manifest**

Run:

```bash
npm test -- tests/crawler/sourceDiscovery.test.ts
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit Task 3**

Run:

```bash
git add docs/research/p0-source-discovery-candidates.json .superpowers/sdd/progress.md
git commit -m "docs: add bulk source discovery candidates"
```

---

### Task 4: ATS-Grouped Formal Source Expansion

**Files:**
- Modify: `src/data/companyRegistry.ts`
- Modify: `src/crawler/sourcePlan.ts`
- Modify: `tests/data/companyRegistry.test.ts`
- Modify: `tests/crawler/sourcePlan.test.ts`

**Interfaces:**
- Consumes: high-confidence discovery candidates from Task 3.
- Produces: deterministic `SourceCrawlPlan[]` entries for the next verified batch.

- [ ] **Step 1: Write failing source-plan tests for the next batch**

For each selected candidate batch, add exact `getPlanBySourceId` assertions to `tests/crawler/sourcePlan.test.ts`. The minimum batch size is 10 companies per implementation wave unless fewer than 10 candidates have working official-chain selectors.

The assertion shape must be:

```ts
expect(byId.get("source-innovent-social")).toMatchObject({
  adapterId: "html-table",
  source: {
    atsKind: "OFFICIAL_HTML",
    officialEntryUrl: "https://www.innoventbio.com/cn/careers/jobs",
    officialChainEvidenceUrl: "https://www.innoventbio.com/cn/careers"
  },
  table: {
    rowSelector: ".job-list tr",
    fields: {
      officialTitle: { selector: "td:nth-child(1) a" },
      officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
      locationRaw: { selector: "td:nth-child(3)" }
    }
  }
});
```

Adjust source IDs, URLs, row selectors, and field selectors to the exact official-chain candidate being implemented.

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts
```

Expected: FAIL because the new source plans and verified registry entries are not configured yet.

- [ ] **Step 3: Update registry and source plan configs**

For each selected candidate:

- Set `officialWebsiteUrl` to the first-party official website.
- Set `status: "VERIFIED_SCRAPABLE"` only when deterministic selector/API config exists.
- Set `atsKind` to one of `MOKA`, `BEISEN_ZHIYE`, `WORKDAY`, `SUCCESSFACTORS`, `REDSEA`, `OFFICIAL_HTML`, `OFFICIAL_JSON`, or `BROWSER_FALLBACK`.
- Set `socialEntryUrl` to the official-chain social recruitment entry.
- Set `officialChainEvidenceUrl` to the first-party official page proving the chain.
- Add a matching `REPRESENTATIVE_CONFIGS[sourceId]` entry in `src/crawler/sourcePlan.ts`.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts tests/crawler/adapters.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/data/companyRegistry.ts src/crawler/sourcePlan.ts tests/data/companyRegistry.test.ts tests/crawler/sourcePlan.test.ts
git commit -m "feat: add ATS grouped verified source plans"
```

---

### Task 5: Two-Pass Formal Crawl Verification And Capacity Benchmark

**Files:**
- Create: `scripts/p0-crawl-capacity-report.ts`
- Create: `tests/crawler/p0CrawlCapacityReport.test.ts`
- Modify: `docs/superpowers/plans/2026-07-08-p0-bulk-source-discovery-and-ats-expansion.md`

**Interfaces:**
- Consumes: `buildSourceCrawlPlans(candidateCompanies)`.
- Produces: a deterministic capacity report and live database readiness evidence.

- [ ] **Step 1: Write failing capacity report tests**

Create `tests/crawler/p0CrawlCapacityReport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateCrawlCapacity } from "../../scripts/p0-crawl-capacity-report";

describe("p0 crawl capacity report", () => {
  it("estimates twice-daily capacity for HTTP and browser-backed sources", () => {
    expect(
      estimateCrawlCapacity({
        sourceCount: 50,
        httpSourceCount: 45,
        browserSourceCount: 5,
        httpConcurrency: 6,
        browserConcurrency: 1,
        avgHttpSeconds: 8,
        avgBrowserSeconds: 45
      })
    ).toEqual({
      sourceCount: 50,
      estimatedOnePassSeconds: 285,
      estimatedTwiceDailySeconds: 570,
      notes: [
        "HTTP/API sources are estimated in 8 batches at concurrency 6.",
        "Browser fallback sources are estimated in 5 batches at concurrency 1."
      ]
    });
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run:

```bash
npm test -- tests/crawler/p0CrawlCapacityReport.test.ts
```

Expected: FAIL because `scripts/p0-crawl-capacity-report.ts` does not exist.

- [ ] **Step 3: Implement capacity estimator**

Create `scripts/p0-crawl-capacity-report.ts`:

```ts
export interface CrawlCapacityInput {
  sourceCount: number;
  httpSourceCount: number;
  browserSourceCount: number;
  httpConcurrency: number;
  browserConcurrency: number;
  avgHttpSeconds: number;
  avgBrowserSeconds: number;
}

export interface CrawlCapacityEstimate {
  sourceCount: number;
  estimatedOnePassSeconds: number;
  estimatedTwiceDailySeconds: number;
  notes: string[];
}

export function estimateCrawlCapacity(input: CrawlCapacityInput): CrawlCapacityEstimate {
  const httpBatches = Math.ceil(input.httpSourceCount / input.httpConcurrency);
  const browserBatches = Math.ceil(input.browserSourceCount / input.browserConcurrency);
  const estimatedOnePassSeconds =
    httpBatches * input.avgHttpSeconds + browserBatches * input.avgBrowserSeconds;

  return {
    sourceCount: input.sourceCount,
    estimatedOnePassSeconds,
    estimatedTwiceDailySeconds: estimatedOnePassSeconds * 2,
    notes: [
      `HTTP/API sources are estimated in ${httpBatches} batches at concurrency ${input.httpConcurrency}.`,
      `Browser fallback sources are estimated in ${browserBatches} batches at concurrency ${input.browserConcurrency}.`
    ]
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const estimate = estimateCrawlCapacity({
    sourceCount: Number(process.env.P0_SOURCE_COUNT ?? 50),
    httpSourceCount: Number(process.env.P0_HTTP_SOURCE_COUNT ?? 45),
    browserSourceCount: Number(process.env.P0_BROWSER_SOURCE_COUNT ?? 5),
    httpConcurrency: Number(process.env.P0_HTTP_CONCURRENCY ?? 6),
    browserConcurrency: Number(process.env.P0_BROWSER_CONCURRENCY ?? 1),
    avgHttpSeconds: Number(process.env.P0_AVG_HTTP_SECONDS ?? 8),
    avgBrowserSeconds: Number(process.env.P0_AVG_BROWSER_SECONDS ?? 45)
  });

  console.log(JSON.stringify(estimate, null, 2));
}
```

- [ ] **Step 4: Run formal verification**

Run:

```bash
npm test -- tests/crawler/p0CrawlCapacityReport.test.ts
npm run typecheck
npm run build
npm run prisma:validate
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected:

- Tests, typecheck, build, and Prisma validation pass.
- Tavily key grep has no matches.

- [ ] **Step 5: Run two forced crawls for all configured verified sources**

With process-level `DATABASE_URL`, run the same command twice:

```bash
npm run p0:crawl -- --force
```

Expected for each run:

- exits `0`;
- reports all configured verified source plans as planned;
- reports no failed sources for the sources intended to count in this wave;
- does not require Tavily credentials.

- [ ] **Step 6: Verify database readiness evidence**

With the same process-level `DATABASE_URL`, run:

```bash
npm run p0:readiness -- --db
```

Expected:

- If `Crawl-evidenced verified companies` is below `50/50`, repeat Tasks 3-5 with the next high-confidence batch.
- If it reports `Crawl-evidenced verified companies: 50/50` or greater and exits `0`, the P0 company verification gate is satisfied.

- [ ] **Step 7: Mark checkboxes complete and commit**

Only after the formal verification commands above, update this plan's checkboxes and commit:

```bash
git add scripts/p0-crawl-capacity-report.ts tests/crawler/p0CrawlCapacityReport.test.ts docs/superpowers/plans/2026-07-08-p0-bulk-source-discovery-and-ats-expansion.md
git commit -m "docs: complete bulk source discovery and ATS expansion plan"
```

## Self-Review

- Spec coverage: This plan preserves official-chain sourcing, deterministic formal crawls, two latest successful stable observations, and the `npm run p0:readiness -- --db` launch gate.
- Placeholder scan: The only values not known before live research are real discovered source URLs and selectors; the plan requires them to be recorded as exact JSON entries and exact test assertions before implementation.
- Type consistency: `SourceDiscoveryCandidate`, `SourceDiscoverySummary`, `createUnsupportedSourceFetch`, and `estimateCrawlCapacity` are defined before later tasks consume them.
- Risk note: Some candidate websites may block HTTP or change structure during execution. Those cases must stay out of `VERIFIED_SCRAPABLE` until deterministic formal crawls succeed twice.
