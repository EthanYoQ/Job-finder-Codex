# Moka Source Fetch Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested Moka encrypted API fetch path and register the 百济神州 social recruitment source with a crawl plan.

**Architecture:** Keep Moka API handling separate from generic JSON/HTML adapters. The Moka fetcher turns a Moka recruitment page plus encrypted `jobs/v2` response into a normal JSON payload that the existing `officialJsonAdapter` can ingest. A lightweight fetch router lets future crawl batches use Moka for `MOKA` sources and the existing Tavily fetch for other configured sources.

**Tech Stack:** TypeScript, Vitest, Node `crypto`, existing `SourceFetchFunction`, existing `officialJsonAdapter`, existing readiness report.

## Global Constraints

- Do not mark any additional company as `VERIFIED_SCRAPABLE`.
- Do not count fixture or mocked observations toward the 50-company readiness gate.
- P0 readiness must remain blocked until 50 companies have two latest successful stable crawl observations.
- 百济神州 must keep first-party official-chain evidence from `https://www.beonemedicines.com.cn/careers/careers/`.
- 百济神州 official social entry may be the official Moka link reached from the official website: `https://app.mokahr.com/apply/beigene/98934?sourceToken=ac8c1724c2ec857aed0ae5d025631e2a#/jobs`.
- No public APIs, bulk export, admin UI, deployment scripts, WAF config, monitoring, backups, or real live network calls are introduced by this plan.
- Do not print or store Tavily keys or other secrets.

---

### Task 1: Moka Encrypted Source Fetcher

**Files:**
- Create: `src/crawler/mokaSourceFetch.ts`
- Test: `tests/crawler/mokaSourceFetch.test.ts`

**Interfaces:**
- Consumes: `SourceFetchFunction`, `SourceCrawlPlan`.
- Produces:
  - `MokaHttpClient`
  - `MokaSourceFetchDeps`
  - `createMokaSourceFetch(deps: MokaSourceFetchDeps): SourceFetchFunction`
  - `extractMokaInitData(html: string): MokaInitData | undefined`
  - `decryptMokaResponse(response: MokaEncryptedResponse, aesIv: string): unknown`

- [ ] **Step 1: Write the failing tests**

Create `tests/crawler/mokaSourceFetch.test.ts`:

```ts
import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMokaSourceFetch,
  decryptMokaResponse,
  extractMokaInitData,
  type MokaEncryptedResponse,
  type MokaHttpClient
} from "../../src/crawler/mokaSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const aesIv = "de7c21ed8d6f50fe";
const necromancer = "6e9ecb8e9c6c1a5e";
const capturedAt = "2026-07-08T08:00:00.000Z";
const officialEntryUrl =
  "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs";

const plan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: {
    id: "company-beigene",
    officialChineseName: "百济神州"
  },
  source: {
    id: "source-beigene-social",
    companyId: "company-beigene",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl,
    officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/"
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

function htmlWithInitData(initData: object): string {
  return `<input id="init-data" value="${escapeHtml(JSON.stringify(initData))}">`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function encryptedResponse(payload: unknown): MokaEncryptedResponse {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(necromancer), Buffer.from(aesIv));
  let data = cipher.update(JSON.stringify(payload), "utf8", "base64");
  data += cipher.final("base64");

  return { data, necromancer };
}

describe("Moka source fetch", () => {
  it("extracts Moka init data from the hidden input", () => {
    const initData = extractMokaInitData(
      htmlWithInitData({
        aesIv,
        mode: "social",
        siteId: "98934",
        org: { id: "beigene", siteId: 98934, name: "百济神州" }
      })
    );

    expect(initData).toEqual({
      aesIv,
      orgId: "beigene",
      siteId: "98934",
      mode: "social"
    });
  });

  it("decrypts a Moka encrypted response", () => {
    const decrypted = decryptMokaResponse(
      encryptedResponse({ success: true, data: { jobs: [{ id: "job-1" }] } }),
      aesIv
    );

    expect(decrypted).toEqual({ success: true, data: { jobs: [{ id: "job-1" }] } });
  });

  it("fetches Moka jobs and enriches them for the official JSON adapter", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const http: MokaHttpClient = async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return {
          status: 200,
          body: htmlWithInitData({
            aesIv,
            mode: "social",
            siteId: "98934",
            org: { id: "beigene", siteId: 98934, name: "百济神州" }
          })
        };
      }

      return {
        status: 200,
        body: JSON.stringify(
          encryptedResponse({
            success: true,
            data: {
              jobStats: { total: 1 },
              jobs: [
                {
                  id: "job-1",
                  title: "Research Chief",
                  locations: [{ cityName: "上海市", provinceName: "上海市", country: "中国" }]
                }
              ]
            }
          })
        )
      };
    };

    const fetch = createMokaSourceFetch({
      http,
      now: () => new Date(capturedAt)
    });
    const result = await fetch(plan);

    expect(result).toMatchObject({ ok: true, capturedAt });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected successful Moka payload");
    }

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      url: "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2",
      method: "POST"
    });
    expect(requests[1]?.body).toMatchObject({
      orgId: "beigene",
      siteId: "98934",
      limit: 200,
      offset: 0,
      isCampusJob: false
    });
    expect(result.payload).toMatchObject({
      success: true,
      data: {
        jobs: [
          {
            id: "job-1",
            title: "Research Chief",
            officialUrl:
              "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/job/job-1",
            locationRaw: "上海市",
            cities: ["上海市"]
          }
        ]
      }
    });
  });

  it("returns a failed fetch result when used on a non-Moka source", async () => {
    const fetch = createMokaSourceFetch({
      http: async () => ({ status: 200, body: "" }),
      now: () => new Date(capturedAt)
    });
    const result = await fetch({
      ...plan,
      source: { ...plan.source, atsKind: "OFFICIAL_JSON" }
    });

    expect(result).toEqual({
      ok: false,
      capturedAt,
      failureReason: "Moka source fetch only supports MOKA sources"
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/crawler/mokaSourceFetch.test.ts`

Expected: FAIL because `src/crawler/mokaSourceFetch.ts` does not exist.

- [ ] **Step 3: Implement the Moka source fetcher**

Create `src/crawler/mokaSourceFetch.ts`:

```ts
import { createDecipheriv } from "node:crypto";
import { load } from "cheerio";
import type { SourceFetchFunction, SourceFetchResult } from "./runSourceCrawl";

export interface MokaInitData {
  aesIv: string;
  orgId: string;
  siteId: string;
  mode: string;
}

export interface MokaEncryptedResponse {
  data: string;
  necromancer: string;
}

export interface MokaHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface MokaHttpResponse {
  status: number;
  body: string;
}

export type MokaHttpClient = (request: MokaHttpRequest) => Promise<MokaHttpResponse>;

export interface MokaSourceFetchDeps {
  http?: MokaHttpClient;
  now?: () => Date;
}

const MOKA_JOBS_ENDPOINT = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
const MOKA_PAGE_SIZE = 200;

export function createMokaSourceFetch(deps: MokaSourceFetchDeps = {}): SourceFetchFunction {
  return async (plan) => {
    const capturedAt = (deps.now ?? (() => new Date()))().toISOString();

    if (plan.source.atsKind !== "MOKA") {
      return failed(capturedAt, "Moka source fetch only supports MOKA sources");
    }

    try {
      const http = deps.http ?? defaultMokaHttpClient;
      const page = await http({
        url: plan.source.officialEntryUrl,
        method: "GET",
        headers: { "User-Agent": "job-search-crawler/0.1" }
      });
      if (page.status < 200 || page.status >= 300) {
        return failed(capturedAt, `Moka entry page returned HTTP ${page.status}`);
      }

      const initData = extractMokaInitData(page.body);
      if (!initData) {
        return failed(capturedAt, "Moka init-data was not found or incomplete");
      }

      const api = await http({
        url: MOKA_JOBS_ENDPOINT,
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          Origin: new URL(plan.source.officialEntryUrl).origin,
          Referer: plan.source.officialEntryUrl,
          "User-Agent": "job-search-crawler/0.1"
        },
        body: {
          orgId: initData.orgId,
          siteId: initData.siteId,
          limit: MOKA_PAGE_SIZE,
          offset: 0,
          needStat: true,
          isCampusJob: false,
          site: initData.mode,
          locale: "zh-CN"
        }
      });
      if (api.status < 200 || api.status >= 300) {
        return failed(capturedAt, `Moka jobs API returned HTTP ${api.status}`);
      }

      const encrypted = parseEncryptedResponse(api.body);
      if (!encrypted) {
        return failed(capturedAt, "Moka jobs API returned an invalid encrypted response");
      }

      return {
        ok: true,
        capturedAt,
        payload: enrichMokaPayload(
          decryptMokaResponse(encrypted, initData.aesIv),
          plan.source.officialEntryUrl
        )
      };
    } catch (error) {
      return failed(capturedAt, error instanceof Error ? error.message : String(error));
    }
  };
}

export function extractMokaInitData(html: string): MokaInitData | undefined {
  const $ = load(html);
  const rawValue = $("#init-data").attr("value");
  if (!rawValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as {
      aesIv?: unknown;
      mode?: unknown;
      siteId?: unknown;
      org?: { id?: unknown; siteId?: unknown };
    };
    const aesIv = typeof parsed.aesIv === "string" ? parsed.aesIv : undefined;
    const orgId = typeof parsed.org?.id === "string" ? parsed.org.id : undefined;
    const siteId = stringValue(parsed.siteId ?? parsed.org?.siteId);
    const mode = typeof parsed.mode === "string" ? parsed.mode : undefined;

    if (!aesIv || !orgId || !siteId || !mode) {
      return undefined;
    }

    return { aesIv, orgId, siteId, mode };
  } catch {
    return undefined;
  }
}

export function decryptMokaResponse(response: MokaEncryptedResponse, aesIv: string): unknown {
  const decipher = createDecipheriv(
    "aes-128-cbc",
    Buffer.from(response.necromancer, "utf8"),
    Buffer.from(aesIv, "utf8")
  );
  let decrypted = decipher.update(response.data, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return JSON.parse(decrypted);
}

async function defaultMokaHttpClient(request: MokaHttpRequest): Promise<MokaHttpResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body ? JSON.stringify(request.body) : undefined
  });

  return {
    status: response.status,
    body: await response.text()
  };
}

function parseEncryptedResponse(body: string): MokaEncryptedResponse | undefined {
  try {
    const parsed = JSON.parse(body) as Partial<MokaEncryptedResponse>;
    if (typeof parsed.data !== "string" || typeof parsed.necromancer !== "string") {
      return undefined;
    }

    return {
      data: parsed.data,
      necromancer: parsed.necromancer
    };
  } catch {
    return undefined;
  }
}

function enrichMokaPayload(payload: unknown, officialEntryUrl: string): unknown {
  if (!isObject(payload) || !isObject(payload.data) || !Array.isArray(payload.data.jobs)) {
    return payload;
  }

  return {
    ...payload,
    data: {
      ...payload.data,
      jobs: payload.data.jobs.map((job) => enrichMokaJob(job, officialEntryUrl))
    }
  };
}

function enrichMokaJob(job: unknown, officialEntryUrl: string): unknown {
  if (!isObject(job)) {
    return job;
  }

  const sourceJobId = stringValue(job.id);
  const cities = citiesFromMokaLocations(job.locations);

  return {
    ...job,
    ...(sourceJobId ? { officialUrl: buildMokaJobUrl(officialEntryUrl, sourceJobId) } : {}),
    ...(cities.length > 0 ? { locationRaw: cities.join("、"), cities } : {})
  };
}

function buildMokaJobUrl(officialEntryUrl: string, sourceJobId: string): string {
  const url = new URL(officialEntryUrl);
  url.hash = `/job/${sourceJobId}`;
  return url.toString();
}

function citiesFromMokaLocations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((location) => {
      if (!isObject(location)) {
        return undefined;
      }

      return stringValue(location.cityName ?? location.provinceName ?? location.country);
    })
    .filter((city): city is string => Boolean(city));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function failed(capturedAt: string, failureReason: string): SourceFetchResult {
  return {
    ok: false,
    capturedAt,
    failureReason
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/crawler/mokaSourceFetch.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/crawler/mokaSourceFetch.ts tests/crawler/mokaSourceFetch.test.ts
git commit -m "feat: add Moka encrypted source fetch"
```

### Task 2: Register 百济神州 Moka Crawl Plan

**Files:**
- Modify: `src/data/companyRegistry.ts`
- Modify: `src/crawler/sourcePlan.ts`
- Modify: `tests/crawler/sourcePlan.test.ts`
- Modify: `tests/readiness/p0Readiness.test.ts`

**Interfaces:**
- Consumes: existing `officialJsonAdapter` config shape.
- Produces: `buildSourceCrawlPlans(candidateCompanies)` includes `source-beigene-social`.

- [ ] **Step 1: Write failing source-plan/readiness assertions**

Modify `tests/crawler/sourcePlan.test.ts` in the deterministic adapter test:

```ts
expect(getPlanBySourceId(plans, "source-beigene-social")?.adapterId).toBe("official-json");
expect(getPlanBySourceId(plans, "source-beigene-social")?.json).toMatchObject({
  jobsPath: "data.jobs",
  fields: {
    sourceJobId: "id",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
});
```

Modify `tests/readiness/p0Readiness.test.ts` so the second test becomes:

```ts
it("does not flag declared verified sources once every verified source has a crawl plan", () => {
  const report = getP0ReadinessReport();

  expect(report.declaredVerifiedSocialSources).toBe(5);
  expect(report.configuredVerifiedSocialSources).toBe(5);
  expect(report.verifiedSourcesMissingCrawlPlan).toEqual([]);
  expect(report.blockers.map((blocker) => blocker.code)).not.toContain(
    "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN"
  );
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `npm test -- tests/crawler/sourcePlan.test.ts tests/readiness/p0Readiness.test.ts`

Expected: FAIL because Beigene is not planned yet and readiness still flags the missing crawl plan.

- [ ] **Step 3: Update Beigene registry source**

In `src/data/companyRegistry.ts`, update `company-beigene` fields:

```ts
    socialEntryUrl:
      "https://app.mokahr.com/apply/beigene/98934?sourceToken=ac8c1724c2ec857aed0ae5d025631e2a#/jobs",
    officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/",
```

Keep `status: "VERIFIED_SCRAPABLE"` and `atsKind: "MOKA"` unchanged.

- [ ] **Step 4: Add Beigene representative config**

In `src/crawler/sourcePlan.ts`, add to `REPRESENTATIVE_CONFIGS`:

```ts
  "source-beigene-social": {
    adapterId: "official-json",
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
  },
```

- [ ] **Step 5: Run focused verification**

Run: `npm test -- tests/crawler/sourcePlan.test.ts tests/readiness/p0Readiness.test.ts`

Expected: PASS.

Run: `npm run p0:readiness`

Expected: exits `1`, shows configured verified social sources `5`, no “Verified sources missing crawl plans” section, and still blocks on `VERIFIED_COMPANIES_BELOW_50` with `0/50`.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/data/companyRegistry.ts src/crawler/sourcePlan.ts tests/crawler/sourcePlan.test.ts tests/readiness/p0Readiness.test.ts
git commit -m "feat: register Beigene Moka crawl plan"
```

### Task 3: Source Fetch Router

**Files:**
- Create: `src/crawler/sourceFetchRouter.ts`
- Test: `tests/crawler/sourceFetchRouter.test.ts`

**Interfaces:**
- Consumes: `SourceFetchFunction`.
- Produces: `createSourceFetchRouter({ moka, fallback }): SourceFetchFunction`.

- [ ] **Step 1: Write the failing router test**

Create `tests/crawler/sourceFetchRouter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSourceFetchRouter } from "../../src/crawler/sourceFetchRouter";
import type { SourceFetchFunction } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const capturedAt = "2026-07-08T08:00:00.000Z";

function planWithAtsKind(atsKind: SourceCrawlPlan["source"]["atsKind"]): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "company-1", officialChineseName: "测试药企" },
    source: {
      id: `source-${atsKind}`,
      companyId: "company-1",
      kind: "SOCIAL",
      atsKind,
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: "https://example.com/jobs",
      officialChainEvidenceUrl: "https://example.com/careers"
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
}

describe("source fetch router", () => {
  it("routes Moka sources to the Moka fetcher", async () => {
    const calls: string[] = [];
    const moka: SourceFetchFunction = async () => {
      calls.push("moka");
      return { ok: true, capturedAt, payload: { data: { jobs: [] } } };
    };
    const fallback: SourceFetchFunction = async () => {
      calls.push("fallback");
      return { ok: false, capturedAt, failureReason: "unexpected fallback" };
    };

    const result = await createSourceFetchRouter({ moka, fallback })(planWithAtsKind("MOKA"));

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["moka"]);
  });

  it("routes non-Moka sources to the fallback fetcher", async () => {
    const calls: string[] = [];
    const moka: SourceFetchFunction = async () => {
      calls.push("moka");
      return { ok: false, capturedAt, failureReason: "unexpected moka" };
    };
    const fallback: SourceFetchFunction = async () => {
      calls.push("fallback");
      return { ok: true, capturedAt, payload: { data: { jobs: [] } } };
    };

    const result = await createSourceFetchRouter({ moka, fallback })(
      planWithAtsKind("OFFICIAL_JSON")
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["fallback"]);
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/crawler/sourceFetchRouter.test.ts`

Expected: FAIL because `src/crawler/sourceFetchRouter.ts` does not exist.

- [ ] **Step 3: Implement router**

Create `src/crawler/sourceFetchRouter.ts`:

```ts
import type { SourceFetchFunction } from "./runSourceCrawl";

export interface SourceFetchRouterDeps {
  moka: SourceFetchFunction;
  fallback: SourceFetchFunction;
}

export function createSourceFetchRouter({
  moka,
  fallback
}: SourceFetchRouterDeps): SourceFetchFunction {
  return (plan) => (plan.source.atsKind === "MOKA" ? moka(plan) : fallback(plan));
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/crawler/sourceFetchRouter.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/crawler/sourceFetchRouter.ts tests/crawler/sourceFetchRouter.test.ts
git commit -m "feat: add source fetch router"
```

### Task 4: Full Verification And Plan Completion

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-moka-source-fetch-foundation.md`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: completed plan checkboxes only after fresh verification.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run prisma:validate
npm run p0:readiness
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected:
- `npm test`, `npm run typecheck`, `npm run build`, and `npm run prisma:validate` pass.
- `npm run p0:readiness` exits `1` because P0 still has `0/50` crawl-evidenced verified companies. It should no longer include the missing Beigene crawl-plan blocker.
- Tavily key grep has no matches.

- [ ] **Step 2: Mark checkboxes complete**

Only after Step 1 verification, change every task checkbox in this plan from `[ ]` to `[x]`.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-moka-source-fetch-foundation.md
git commit -m "docs: complete Moka source fetch foundation plan"
```

## Self-Review

- Spec coverage: this plan implements Moka encrypted API support, registers the current missing Beigene crawl plan, and keeps readiness blocked on real crawl observations.
- Placeholder scan: no TODO/TBD placeholders are present.
- Type consistency: `createMokaSourceFetch` returns the existing `SourceFetchFunction` shape and feeds enriched payloads into the existing `officialJsonAdapter` path.
