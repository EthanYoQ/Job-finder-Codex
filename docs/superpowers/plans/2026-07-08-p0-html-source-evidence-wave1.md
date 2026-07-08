# P0 HTML Source Evidence Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the local P0 database evidence gate from `1/50` to a higher verified count by replacing Tavily-dependent HTML source fetching with direct official HTML fetching for verified sources and by adding two verified official-chain sources already validated in this session.

**Architecture:** Keep source-specific parsing in `sourcePlan.ts` and add a generic direct HTML fetcher for `html-table` plans. Route Moka sources to the existing Moka fetcher, HTML row/table plans to direct HTTP HTML, and only keep Tavily as the fallback for non-HTML/non-Moka plans.

**Tech Stack:** TypeScript, Vitest, Cheerio, Node `fetch`, Prisma/PostgreSQL, existing P0 crawl CLI.

## Global Constraints

- Recruitment information must come from official company pages or official-chain ATS pages only.
- P0 launch remains blocked until `npm run p0:readiness -- --db` reports at least 50 crawl-evidenced verified companies.
- A company counts as crawl-evidenced only when the latest two crawl observations for its configured verified social source are successful and stable.
- Do not commit or print Tavily keys; direct HTML and Moka validation in this plan must not require Tavily credentials.
- Do not include 石药/CSPC in this wave; its official page currently returned `403`/empty direct content and needs a separate Redsea/official-interface investigation.
- First-wave expected readiness after live verification is still blocked, approximately `6/50`, not P0 launch-ready.

---

### Task 1: Direct HTML Source Fetcher

**Files:**
- Create: `src/crawler/httpHtmlSourceFetch.ts`
- Create: `tests/crawler/httpHtmlSourceFetch.test.ts`

**Interfaces:**
- Consumes: `SourceFetchFunction`, `SourceFetchResult`, `SourceCrawlPlan`.
- Produces: `createHttpHtmlSourceFetch(deps?: HttpHtmlSourceFetchDeps): SourceFetchFunction`.

- [ ] **Step 1: Write failing tests**

Create `tests/crawler/httpHtmlSourceFetch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createHttpHtmlSourceFetch,
  type HttpHtmlRequest,
  type HttpHtmlResponse
} from "../../src/crawler/httpHtmlSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const htmlPlan: SourceCrawlPlan = {
  adapterId: "html-table",
  company: { id: "company-test", officialChineseName: "测试药企" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "BEISEN_ZHIYE",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://example.com/social",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  table: {
    rowSelector: "tr",
    fields: {
      officialTitle: { selector: "td:nth-child(1)" },
      officialUrl: { selector: "a", attribute: "href" },
      locationRaw: { selector: "td:nth-child(2)" }
    }
  }
};

const jsonPlan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: { id: "company-json", officialChineseName: "JSON药企" },
  source: {
    ...htmlPlan.source,
    id: "source-json-social",
    companyId: "company-json",
    atsKind: "OFFICIAL_JSON"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      officialTitle: "title",
      officialUrl: "url",
      locationRaw: "location"
    }
  }
};

describe("createHttpHtmlSourceFetch", () => {
  it("fetches direct HTML for html-table plans", async () => {
    const requests: HttpHtmlRequest[] = [];
    const fetchSource = createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request): Promise<HttpHtmlResponse> => {
        requests.push(request);
        return { status: 200, body: "<table><tr><td>岗位</td></tr></table>" };
      }
    });

    const result = await fetchSource(htmlPlan);

    expect(result).toEqual({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      html: "<table><tr><td>岗位</td></tr></table>"
    });
    expect(requests).toEqual([
      {
        url: "https://example.com/social",
        headers: { "User-Agent": "job-search-crawler/0.1" }
      }
    ]);
  });

  it("rejects non-html source plans without calling HTTP", async () => {
    const fetchSource = createHttpHtmlSourceFetch({
      http: async () => {
        throw new Error("must not be called");
      }
    });

    const result = await fetchSource(jsonPlan);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      failureReason: "Direct HTML source fetch only supports html-table plans"
    });
  });

  it("fails empty and non-2xx responses", async () => {
    const fetchSource = createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 403, body: "Forbidden" })
    });

    await expect(fetchSource(htmlPlan)).resolves.toMatchObject({
      ok: false,
      capturedAt: "2026-07-08T00:00:00.000Z",
      failureReason: "Direct HTML source returned HTTP 403"
    });

    const emptyFetch = createHttpHtmlSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 200, body: "   " })
    });

    await expect(emptyFetch(htmlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Direct HTML source returned empty content"
    });
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/crawler/httpHtmlSourceFetch.test.ts`

Expected: FAIL because `src/crawler/httpHtmlSourceFetch.ts` does not exist.

- [ ] **Step 3: Implement direct HTML source fetch**

Create `src/crawler/httpHtmlSourceFetch.ts`:

```ts
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface HttpHtmlRequest {
  url: string;
  headers: Record<string, string>;
}

export interface HttpHtmlResponse {
  status: number;
  body: string;
}

export type HttpHtmlClient = (request: HttpHtmlRequest) => Promise<HttpHtmlResponse>;

export interface HttpHtmlSourceFetchDeps {
  http?: HttpHtmlClient;
  now?: () => Date;
}

export function createHttpHtmlSourceFetch(
  deps: HttpHtmlSourceFetchDeps = {}
): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.adapterId !== "html-table") {
      return failed(capturedAt, "Direct HTML source fetch only supports html-table plans");
    }

    try {
      const http = deps.http ?? defaultHttpHtmlClient;
      const response = await http({
        url: plan.source.officialEntryUrl,
        headers: { "User-Agent": "job-search-crawler/0.1" }
      });

      if (response.status < 200 || response.status >= 300) {
        return failed(capturedAt, `Direct HTML source returned HTTP ${response.status}`);
      }

      if (!response.body.trim()) {
        return failed(capturedAt, "Direct HTML source returned empty content");
      }

      return {
        ok: true,
        capturedAt,
        html: response.body
      };
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

async function defaultHttpHtmlClient(request: HttpHtmlRequest): Promise<HttpHtmlResponse> {
  const response = await fetch(request.url, {
    headers: request.headers,
    redirect: "follow"
  });

  return {
    status: response.status,
    body: await response.text()
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

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/crawler/httpHtmlSourceFetch.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/crawler/httpHtmlSourceFetch.ts tests/crawler/httpHtmlSourceFetch.test.ts
git commit -m "feat: fetch official HTML sources directly"
```

---

### Task 2: HTML Fetch Routing

**Files:**
- Modify: `src/crawler/sourceFetchRouter.ts`
- Modify: `tests/crawler/sourceFetchRouter.test.ts`
- Modify: `scripts/p0-crawl.ts`

**Interfaces:**
- Consumes: `createHttpHtmlSourceFetch`.
- Produces: `SourceFetchRouterDeps.html?: SourceFetchFunction`.

- [ ] **Step 1: Write failing router test**

Modify `tests/crawler/sourceFetchRouter.test.ts` to add a test proving html-table plans use `html` before `fallback`:

```ts
it("routes html-table plans to the direct HTML fetcher when provided", async () => {
  const calls: string[] = [];
  const plan = {
    ...beisenPlan,
    adapterId: "html-table",
    table: {
      rowSelector: "tr",
      fields: {
        officialTitle: { selector: "td:nth-child(1)" },
        officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(2)" }
      }
    }
  } as const;

  const router = createSourceFetchRouter({
    moka: async () => {
      calls.push("moka");
      return { ok: false, capturedAt: "2026-07-08T00:00:00.000Z", failureReason: "wrong" };
    },
    html: async () => {
      calls.push("html");
      return { ok: true, capturedAt: "2026-07-08T00:00:00.000Z", html: "<table></table>" };
    },
    fallback: async () => {
      calls.push("fallback");
      return { ok: false, capturedAt: "2026-07-08T00:00:00.000Z", failureReason: "wrong" };
    }
  });

  await expect(router(plan)).resolves.toMatchObject({ ok: true, html: "<table></table>" });
  expect(calls).toEqual(["html"]);
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/crawler/sourceFetchRouter.test.ts`

Expected: FAIL because `html` is not accepted by `createSourceFetchRouter`.

- [ ] **Step 3: Implement routing**

Modify `src/crawler/sourceFetchRouter.ts`:

```ts
export interface SourceFetchRouterDeps {
  moka: SourceFetchFunction;
  html?: SourceFetchFunction;
  fallback: SourceFetchFunction;
}

export function createSourceFetchRouter({
  moka,
  html,
  fallback
}: SourceFetchRouterDeps): SourceFetchFunction {
  return (plan) => {
    if (plan.source.atsKind === "MOKA") {
      return moka(plan);
    }

    if (plan.adapterId === "html-table" && html) {
      return html(plan);
    }

    return fallback(plan);
  };
}
```

Modify `scripts/p0-crawl.ts`:

```ts
import { createHttpHtmlSourceFetch } from "../src/crawler/httpHtmlSourceFetch";
```

Then pass `html: createHttpHtmlSourceFetch()` when constructing `createSourceFetchRouter`.

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/crawler/sourceFetchRouter.test.ts tests/crawler/p0CrawlCli.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/crawler/sourceFetchRouter.ts tests/crawler/sourceFetchRouter.test.ts scripts/p0-crawl.ts
git commit -m "feat: route HTML crawl plans to direct fetch"
```

---

### Task 3: Wave 1 Source Plan Expansion

**Files:**
- Modify: `src/data/companyRegistry.ts`
- Modify: `src/crawler/sourcePlan.ts`
- Modify: `tests/crawler/sourcePlan.test.ts`
- Modify: `tests/data/companyRegistry.test.ts`

**Interfaces:**
- Consumes: direct HTML routing and existing Moka source fetch.
- Produces: configured crawl plans for `source-astrazeneca-social`, `source-novartis-social`, `source-fosun-pharma-social`, `source-beigene-social`, `source-hengrui-social`, and `source-kelun-social`.

- [ ] **Step 1: Write failing source-plan tests**

Modify `tests/crawler/sourcePlan.test.ts`:

```ts
it("configures direct HTML and Moka crawl plans for wave 1 verified sources", () => {
  const plans = buildSourceCrawlPlans(candidateCompanies);
  const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

  expect(byId.get("source-astrazeneca-social")).toMatchObject({
    adapterId: "html-table",
    table: {
      rowSelector: "#search-results-list li",
      fields: {
        officialTitle: { selector: "a.search-results-link h2" },
        officialUrl: { selector: "a.search-results-link", attribute: "href" },
        locationRaw: { selector: "span.job-location" }
      }
    }
  });

  expect(byId.get("source-novartis-social")).toMatchObject({
    adapterId: "html-table",
    table: {
      rowSelector: "table.views-table tbody tr",
      fields: {
        officialTitle: { selector: "td.views-field-field-job-title a" },
        officialUrl: { selector: "td.views-field-field-job-title a", attribute: "href" },
        locationRaw: { selector: "td.views-field-field-job-work-location" }
      }
    }
  });

  expect(byId.get("source-fosun-pharma-social")).toMatchObject({
    adapterId: "html-table",
    table: {
      rowSelector: "table tr",
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(4) a" }
      }
    }
  });

  expect(byId.get("source-hengrui-social")).toMatchObject({
    adapterId: "official-json",
    source: {
      atsKind: "MOKA",
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html"
    }
  });

  expect(byId.get("source-kelun-social")).toMatchObject({
    adapterId: "html-table",
    source: {
      atsKind: "BEISEN_ZHIYE",
      officialEntryUrl: "https://kelun.zhiye.com/social",
      officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html"
    },
    table: {
      rowSelector: ".jobsTable tr:not(.title)",
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(5)" }
      }
    }
  });
});
```

Modify `tests/data/companyRegistry.test.ts` to assert HengRui and Kelun have official-chain source data:

```ts
it("records official-chain evidence for wave 1 added sources", () => {
  const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

  expect(byId.get("company-hengrui")?.sources[0]).toMatchObject({
    status: "VERIFIED_SCRAPABLE",
    atsKind: "MOKA",
    officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
    officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html"
  });

  expect(byId.get("company-kelun")?.sources[0]).toMatchObject({
    status: "VERIFIED_SCRAPABLE",
    atsKind: "BEISEN_ZHIYE",
    officialEntryUrl: "https://kelun.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html"
  });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts`

Expected: FAIL because HengRui/Kelun are not configured and HTML plan selectors are still old.

- [ ] **Step 3: Update registry and source plans**

Modify `src/data/companyRegistry.ts`:

- For `company-hengrui`, add:

```ts
status: "VERIFIED_SCRAPABLE",
atsKind: "MOKA",
officialWebsiteUrl: "https://www.hengrui.com/",
officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html",
```

- For `company-kelun`, add:

```ts
status: "VERIFIED_SCRAPABLE",
atsKind: "BEISEN_ZHIYE",
officialWebsiteUrl: "https://www.kelun.com/",
socialEntryUrl: "https://kelun.zhiye.com/social",
officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html",
includeCampusPlaceholder: true
```

Modify `src/crawler/sourcePlan.ts`:

- Add a reusable Moka JSON config:

```ts
const MOKA_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "data.jobs",
  fields: {
    sourceJobId: "id",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
};
```

- Use `MOKA_JSON_CONFIG` for `source-beigene-social` and `source-hengrui-social`.
- Change `source-astrazeneca-social` to `adapterId: "html-table"` with the selectors from Step 1.
- Change `source-novartis-social` to direct `html-table` with the selectors from Step 1.
- Change `source-fosun-pharma-social` to direct `html-table` with the selectors from Step 1.
- Add `source-kelun-social` with the selectors from Step 1.

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts tests/crawler/adapters.test.ts`

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/data/companyRegistry.ts src/crawler/sourcePlan.ts tests/crawler/sourcePlan.test.ts tests/data/companyRegistry.test.ts
git commit -m "feat: add wave 1 verified source plans"
```

---

### Task 4: Wave 1 Live Evidence Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-p0-html-source-evidence-wave1.md`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: completed plan checkboxes and local PostgreSQL readiness evidence for the wave 1 sources.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected:
- Test, typecheck, build, and Prisma validation pass.
- Tavily key grep has no matches.

- [ ] **Step 2: Run two forced crawls for wave 1 sources**

With process-level `DATABASE_URL`, run the same command twice:

```bash
npm run p0:crawl -- --force --source-id source-beigene-social --source-id source-hengrui-social --source-id source-astrazeneca-social --source-id source-novartis-social --source-id source-fosun-pharma-social --source-id source-kelun-social
```

Expected for each run:
- exits `0`.
- reports `Planned sources: 6`.
- reports `Successful sources: 6`.
- reports `Failed sources: 0`.
- does not require Tavily credentials.

- [ ] **Step 3: Verify database readiness evidence**

With the same process-level `DATABASE_URL`, run:

```bash
npm run p0:readiness -- --db
```

Expected:
- exits `1`.
- reports `Candidate companies: 110`.
- reports `Crawl-evidenced verified companies: 6/50`.
- still blocks on `VERIFIED_COMPANIES_BELOW_50`.

- [ ] **Step 4: Mark checkboxes complete**

Only after Steps 1-3 verification, change every task checkbox in this plan from `[ ]` to `[x]`.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-p0-html-source-evidence-wave1.md
git commit -m "docs: complete wave 1 source evidence plan"
```

## Self-Review

- Spec coverage: this plan advances the blocking 50-company crawl-evidence gate with official-chain sources only and explicitly keeps P0 blocked below 50.
- Placeholder scan: no placeholders are present.
- Type consistency: `createHttpHtmlSourceFetch`, `SourceFetchRouterDeps.html`, and source-plan selector configs are defined before use.
- Risk note: live source content can change; if a live crawl fails, record the observed failure and do not mark the source crawl-evidenced without two latest successful observations.
