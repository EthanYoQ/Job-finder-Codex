# P0 Launch Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining PRD phase-one product, admin, security, deployment, backup, and monitoring requirements after the 50-company crawl-evidence gate reached readiness.

**Architecture:** Keep official-source crawling and readiness evidence as the existing crawler/readiness layer. Add a small internal API/service boundary for frontend data, consent-safe static pages, anti-bulk route policy, and operator workflows; keep the React app as a mobile-first consumer of typed data instead of static visual fixtures. Deployment remains Docker Compose oriented with PostgreSQL, web, worker/scheduler, reverse proxy, backups, and lightweight monitors.

**Tech Stack:** React 19, Vite 6, TypeScript 5.8, Vitest, Prisma 6, PostgreSQL, Node 22 built-in HTTP/process APIs, Docker Compose, Nginx, PowerShell/Bash operational scripts.

## Global Constraints

- Product name is `Job-search`.
- P0 frontend displays social recruitment jobs only; campus recruitment is recorded as source-entry state only.
- Every frontend job link must point to an official company recruitment chain: official job detail when stable, otherwise official social list or official recruitment entry.
- `npm run p0:readiness -- --db` is the canonical 50-company launch evidence gate and must keep passing with at least 50 crawl-evidenced verified companies.
- Tavily, Agent Reach, and search tools may support discovery only; they must not count as readiness evidence or frontend job data.
- City is required before job results load; category, keyword, company, and sort are optional.
- Default company ordering is official Chinese company-name pinyin A-Z; optional sorting supports latest posted and matching job count.
- Company-expanded jobs sort by official published time newest first, then job title pinyin/name.
- Frontend shows only the all-site last crawl time on the search result header; company cards do not show per-company crawl times.
- Company coverage page shows only official Chinese company names and official website links, sorted by pinyin A-Z, with simple company-name search.
- First-visit consent modal is narrow and minimal: one sentence, checkbox agreeing to privacy policy and service terms, links to those documents, and an enter button.
- If the consent modal is closed or not accepted, the website remains unusable except for privacy policy and service terms links.
- Before consent, do not load job-result data or operational analytics.
- Privacy policy and service terms must be accessible before consent and must not load job-result data.
- Service terms explicitly prohibit crawling, bulk copying, resale, and commercial reuse of site data.
- No public API, bulk export, raw data route, deep pagination, saved jobs, subscriptions, email alerts, maps, multilingual UI, in-site application, resume management, employer tooling, or recruiter account features in P0.
- Internal APIs must be paginated/limited; expanded company results enforce a hard server-side cap.
- Search result pages, city/category result pages, deep pagination, combined filter pages, internal query APIs, admin routes, batch paths, and raw data endpoints must not be indexed.
- P0 uses PostgreSQL for companies, sources, jobs, crawl batches, classifications, translations/corrections, feedback, recommended companies, access logs, and security/admin events.
- User feedback is anonymous, stores abuse signals, and can carry company/job context.
- Recommended companies enter admin review and never auto-publish to frontend coverage.
- Jobs missing from two consecutive successful source crawls are hidden from frontend and marked suspected offline in admin; three consecutive successful misses mark them offline; failed crawls do not increment missing counts.
- Crawl schedule is twice daily, with manual per-company crawl from admin.
- Backups run daily, retain 7-14 days, and support one-command restore to a test database.
- Monitoring covers uptime, CPU, memory, disk, PostgreSQL health, backups, crawl success rate, per-company failures, certificate expiry, and abnormal traffic.
- Alerts fire immediately for website down and backup failure, after three consecutive per-company crawl failures, and when global crawl success is below 80%.
- Korean-server cross-border compliance is unverified and must remain marked as requiring legal review; do not assert full legal compliance.
- UI icons must use the project icon system (`lucide-react` currently) and must not use emoji, Unicode pseudo-icons, or hand-written SVG paths.
- Preserve user/unrelated worktree changes; do not revert unrelated files.

---

## Current Evidence Baseline

- Commit `62b1d00 feat: expand p0 ATS crawl evidence` reached DB-backed readiness: `Crawl-evidenced verified companies: 50/50`.
- `src/server/jobSearchService.ts` already returns company-grouped database results with required search and sorting semantics.
- `src/app/App.tsx` is still a static visual fixture and does not consume database/API search results.
- Prisma models exist for feedback, recommended companies, access events, admin users/sessions/audit, and manual crawl requests.
- Admin code exists as backend/domain helpers only; there is no operator UI or HTTP route layer.
- No Docker Compose, Nginx, backup, restore, monitor, robots, rate-limit, or challenge implementation files were found during audit.

## File Structure

- `src/server/publicApi.ts`: typed internal JSON handlers for search, coverage, feedback, recommended company, consent-safe documents, robots, health, and admin entry points.
- `src/server/rateLimit.ts`: deterministic in-memory rate limiter and suspicious-pattern challenge classifier for tests and single-node deployment.
- `src/server/coverageService.ts`: company coverage projection from Prisma/company registry.
- `src/server/feedbackService.ts`: anonymous feedback and recommended company creation with abuse-signal capture.
- `src/server/staticDocuments.ts`: privacy policy and service terms content with anti-crawl and compliance wording.
- `src/server/opsMonitoring.ts`: monitoring and alert evaluation helpers.
- `src/app/App.tsx`: replace static-only workbench with typed data-provider driven app, consent-safe routing, coverage, feedback, recommendation, privacy, and terms flows.
- `src/app/App.css`: responsive mobile-first styling for added flows while preserving selected visual direction.
- `src/app/appDataProvider.ts`: browser data provider interfaces and demo provider for tests/dev.
- `src/admin/AdminApp.tsx`: minimal operator console components for login state, source health, manual crawl, feedback review, recommendation review, and category correction.
- `src/admin/adminViewModel.ts`: pure admin view-model helpers around existing admin operations.
- `ops/docker-compose.yml`: web, worker, scheduler, PostgreSQL, Nginx reverse proxy, backup, and monitor service composition.
- `ops/nginx.conf`: origin proxy, robots headers, rate-limit zones, API/admin no-index headers, static asset caching.
- `ops/backup.ps1`, `ops/backup.sh`: daily backup command with 14-day retention.
- `ops/restore-test.ps1`, `ops/restore-test.sh`: one-command restore into a test database.
- `ops/monitoring-check.ts`: runnable lightweight monitoring command.
- `tests/server/*.test.ts`: API, rate-limit, documents, feedback, coverage, and monitoring tests.
- `tests/app/App.test.tsx`: mobile product flow tests for consent, city search, categories, company expansion, coverage search, feedback, recommendation, privacy, and terms.
- `tests/admin/AdminApp.test.tsx`: minimal operator console tests.
- `tests/ops/*.test.ts`: backup/restore config and monitor alert tests.

---

### Task 1: Consent-Safe Internal API, Documents, Feedback, Coverage, And Rate Limits

**Files:**
- Create: `src/server/rateLimit.ts`
- Create: `src/server/staticDocuments.ts`
- Create: `src/server/coverageService.ts`
- Create: `src/server/feedbackService.ts`
- Create: `src/server/publicApi.ts`
- Test: `tests/server/rateLimit.test.ts`
- Test: `tests/server/staticDocuments.test.ts`
- Test: `tests/server/coverageService.test.ts`
- Test: `tests/server/feedbackService.test.ts`
- Test: `tests/server/publicApi.test.ts`

**Interfaces:**
- Consumes: `SearchRequestSchema` from `src/domain/search.ts`, `searchJobsFromDatabase(request, db)` from `src/server/jobSearchService.ts`, and Prisma-like delegates.
- Produces:
  - `checkRateLimit(input: RateLimitInput, store: RateLimitStore): RateLimitDecision`
  - `classifySuspiciousRequest(input: SuspiciousRequestInput): ChallengeDecision`
  - `getStaticDocument(slug: "privacy" | "terms"): StaticDocument`
  - `listCompanyCoverage(request: CoverageRequest, db: CoverageDb): Promise<CoverageResult>`
  - `createFeedback(input: FeedbackInput, context: RequestContext, db: FeedbackDb): Promise<FeedbackReceipt>`
  - `createRecommendedCompany(input: RecommendedCompanyInput, context: RequestContext, db: FeedbackDb): Promise<FeedbackReceipt>`
  - `handlePublicApi(request: PublicApiRequest, deps: PublicApiDeps): Promise<PublicApiResponse>`

- [ ] **Step 1: Write failing tests for rate limit and challenge behavior**

```typescript
import { describe, expect, it } from "vitest";
import { checkRateLimit, classifySuspiciousRequest, createMemoryRateLimitStore } from "../../src/server/rateLimit";

describe("rate limit and suspicious request policy", () => {
  it("allows normal browsing and blocks bursts over the configured window", () => {
    const store = createMemoryRateLimitStore();
    const base = { key: "ip:1.2.3.4", now: new Date("2026-07-08T00:00:00.000Z"), windowMs: 60_000, max: 3 };

    expect(checkRateLimit(base, store).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: new Date("2026-07-08T00:00:10.000Z") }, store).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: new Date("2026-07-08T00:00:20.000Z") }, store).allowed).toBe(true);
    expect(checkRateLimit({ ...base, now: new Date("2026-07-08T00:00:30.000Z") }, store)).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
      remaining: 0
    });
  });

  it("challenges bulk-looking requests without challenging document routes", () => {
    expect(classifySuspiciousRequest({ path: "/privacy", query: {}, userAgent: "Mozilla/5.0" }).action).toBe("ALLOW");
    expect(
      classifySuspiciousRequest({
        path: "/api/search",
        query: { limit: "500", offset: "5000" },
        userAgent: "python-requests/2.31"
      }).action
    ).toBe("CHALLENGE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/server/rateLimit.test.ts`
Expected: FAIL because `src/server/rateLimit.ts` does not exist.

- [ ] **Step 3: Implement rate-limit and suspicious request helpers**

```typescript
export interface RateLimitInput {
  key: string;
  now: Date;
  windowMs: number;
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export interface RateLimitStore {
  hits: Map<string, number[]>;
}

export interface SuspiciousRequestInput {
  path: string;
  query: Record<string, string | undefined>;
  userAgent: string;
}

export interface ChallengeDecision {
  action: "ALLOW" | "CHALLENGE";
  reason?: string;
}

export function createMemoryRateLimitStore(): RateLimitStore {
  return { hits: new Map() };
}

export function checkRateLimit(input: RateLimitInput, store: RateLimitStore): RateLimitDecision {
  const nowMs = input.now.getTime();
  const validAfter = nowMs - input.windowMs;
  const previous = store.hits.get(input.key) ?? [];
  const retained = previous.filter((timestamp) => timestamp > validAfter);

  if (retained.length >= input.max) {
    const oldest = retained[0] ?? nowMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + input.windowMs - nowMs) / 1000)),
      remaining: 0
    };
  }

  retained.push(nowMs);
  store.hits.set(input.key, retained);

  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, input.max - retained.length)
  };
}

export function classifySuspiciousRequest(input: SuspiciousRequestInput): ChallengeDecision {
  if (input.path === "/privacy" || input.path === "/terms") {
    return { action: "ALLOW" };
  }

  const limit = Number(input.query.limit ?? "0");
  const offset = Number(input.query.offset ?? "0");
  const userAgent = input.userAgent.toLocaleLowerCase();

  if (limit > 50 || offset > 500) {
    return { action: "CHALLENGE", reason: "bulk pagination pattern" };
  }

  if (/(python-requests|scrapy|curl|wget|bot|spider)/i.test(userAgent)) {
    return { action: "CHALLENGE", reason: "automation user agent" };
  }

  return { action: "ALLOW" };
}
```

- [ ] **Step 4: Add documents, coverage, feedback, and API tests**

```typescript
import { describe, expect, it, vi } from "vitest";
import { getStaticDocument } from "../../src/server/staticDocuments";
import { listCompanyCoverage } from "../../src/server/coverageService";
import { createFeedback, createRecommendedCompany } from "../../src/server/feedbackService";
import { handlePublicApi } from "../../src/server/publicApi";

describe("static policy documents", () => {
  it("serves consent-safe privacy and terms text with anti-crawl language", () => {
    expect(getStaticDocument("privacy").body).toContain("跨境合规事项仍需法律复核");
    expect(getStaticDocument("terms").body).toContain("禁止抓取、批量复制、转售或商业化复用");
  });
});

describe("company coverage service", () => {
  it("returns only company names and official website links sorted by pinyin", async () => {
    const db = {
      company: {
        findMany: vi.fn(async () => [
          { id: "b", officialChineseName: "百济神州", officialWebsiteUrl: "https://www.beigene.cn", pinyinName: "bai ji shen zhou" },
          { id: "a", officialChineseName: "阿斯利康", officialWebsiteUrl: "https://www.astrazeneca.com.cn", pinyinName: "a si li kang" }
        ])
      }
    };

    await expect(listCompanyCoverage({ keyword: "" }, db)).resolves.toEqual({
      companies: [
        { id: "a", companyName: "阿斯利康", officialWebsiteUrl: "https://www.astrazeneca.com.cn" },
        { id: "b", companyName: "百济神州", officialWebsiteUrl: "https://www.beigene.cn" }
      ]
    });
  });
});

describe("anonymous feedback service", () => {
  it("stores feedback and recommended company submissions with abuse signals", async () => {
    const feedbackCreates: unknown[] = [];
    const recommendedCreates: unknown[] = [];
    const db = {
      feedback: { create: vi.fn(async (args) => { feedbackCreates.push(args); return { id: "f1" }; }) },
      recommendedCompany: { create: vi.fn(async (args) => { recommendedCreates.push(args); return { id: "r1" }; }) }
    };
    const context = { ip: "1.2.3.4", userAgent: "Mozilla/5.0" };

    await expect(createFeedback({ issueType: "错误链接", description: "官方链接打不开", companyId: "c1", jobId: "j1" }, context, db)).resolves.toEqual({ id: "f1", status: "OPEN" });
    await expect(createRecommendedCompany({ companyName: "测试药企", officialWebsiteUrl: "https://example.cn" }, context, db)).resolves.toEqual({ id: "r1", status: "OPEN" });
    expect(feedbackCreates[0]).toMatchObject({ data: { ip: "1.2.3.4", userAgent: "Mozilla/5.0", companyId: "c1", jobId: "j1" } });
    expect(recommendedCreates[0]).toMatchObject({ data: { ip: "1.2.3.4", userAgent: "Mozilla/5.0", companyName: "测试药企" } });
  });
});

describe("public API route policy", () => {
  it("does not load job search before consent and marks internal APIs noindex", async () => {
    const deps = {
      db: {
        job: { findMany: vi.fn() },
        crawlObservation: { findFirst: vi.fn() },
        company: { findMany: vi.fn(async () => []) },
        feedback: { create: vi.fn() },
        recommendedCompany: { create: vi.fn() }
      },
      now: () => new Date("2026-07-08T00:00:00.000Z")
    };

    const blocked = await handlePublicApi({ method: "GET", path: "/api/search", query: { city: "北京" }, headers: {}, body: undefined, ip: "1.2.3.4" }, deps);
    expect(blocked.status).toBe(403);
    expect(blocked.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(deps.db.job.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Implement services and API handler**

Implement exactly the exported interfaces above. `handlePublicApi` must:
- allow `/privacy`, `/terms`, `/robots.txt`, and `/healthz` without consent;
- require `x-job-search-consent: accepted` for `/api/search`, `/api/coverage`, `/api/feedback`, and `/api/recommend-company`;
- set `x-robots-tag: noindex, nofollow` on all `/api/*` and `/admin/*` responses;
- enforce rate limit using `checkRateLimit`;
- reject challenge decisions with HTTP `429`;
- cap search `limit` to the schema limit and return `400` for invalid input through existing zod validation.

- [ ] **Step 6: Run task tests**

Run: `npm test -- tests/server/rateLimit.test.ts tests/server/staticDocuments.test.ts tests/server/coverageService.test.ts tests/server/feedbackService.test.ts tests/server/publicApi.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server tests/server docs/superpowers/plans/2026-07-08-p0-launch-completion.md
git commit -m "feat: add consent-safe public services"
```

---

### Task 2: Real Frontend Product Flows

**Files:**
- Create: `src/app/appDataProvider.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.css`
- Test: `tests/app/App.test.tsx`

**Interfaces:**
- Consumes: Task 1 service response shapes and existing `src/app/jobSearch.ts` domain semantics.
- Produces:
  - `AppDataProvider` interface with `searchJobs`, `listCoverage`, `submitFeedback`, `recommendCompany`, and `getDocument`.
  - `createDemoAppDataProvider()` for deterministic tests and local UI.
  - Frontend views: job discovery, coverage, feedback, recommend company, privacy policy, service terms.

- [ ] **Step 1: Replace static-only app tests with product-flow tests**

Test requirements:
- first visit shows minimal consent modal;
- closing modal locks app and leaves only reopen/policy/terms accessible;
- privacy and terms can be opened before consent and do not call `searchJobs`;
- after consent, selecting/searching city `北京` loads grouped results from the provider;
- category and keyword filters update results;
- company expansion shows jobs with official links and per-company row cap control;
- coverage page search shows company names and official website links only;
- contextual feedback carries company/job IDs;
- recommended company submission returns an admin-review message.

- [ ] **Step 2: Run frontend tests to verify failure**

Run: `npm test -- tests/app/App.test.tsx`
Expected: FAIL because the provider and supporting flows do not exist.

- [ ] **Step 3: Implement `AppDataProvider` and deterministic demo provider**

The demo provider must include at least 阿斯利康、百济神州、辉瑞、诺华、信达生物 and must expose grouped jobs with official links, categories, `isNew`, and `officialPublishedAt`. It is only a development/test provider; production uses the Task 1 API boundary.

- [ ] **Step 4: Refactor `App.tsx` to consume provider data**

Implementation requirements:
- `App` accepts optional prop `{ dataProvider?: AppDataProvider }`.
- Do not call provider search before consent.
- Keep the selected visual direction and lucide icon system.
- Keep the modal narrow and short.
- Use real state for city, keyword, categories, only-new, sort, coverage, feedback, recommendation, privacy, and terms views.
- Do not show per-company crawl time.
- Do not add “我的” saved-job account features; remove or repurpose bottom navigation to P0 flows only.

- [ ] **Step 5: Update responsive CSS**

Requirements:
- mobile-first layout remains close to the accepted blue design direction;
- no bottom blank safe-area regression;
- touch targets at least 44px;
- text does not overlap at 390px mobile width and 1280px desktop width.

- [ ] **Step 6: Run frontend tests**

Run: `npm test -- tests/app/App.test.tsx tests/app/jobSearch.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app tests/app
git commit -m "feat: connect frontend product flows"
```

---

### Task 3: Minimal Admin Console

**Files:**
- Create: `src/admin/adminViewModel.ts`
- Create: `src/admin/AdminApp.tsx`
- Test: `tests/admin/AdminApp.test.tsx`
- Test: `tests/admin/adminViewModel.test.ts`

**Interfaces:**
- Consumes: existing `src/admin/auth.ts` and `src/admin/operations.ts`.
- Produces:
  - `buildAdminDashboardModel(input: AdminDashboardInput): AdminDashboardModel`
  - `AdminApp` component for source health, manual crawl queueing, feedback review, recommendation review, and category correction.

- [ ] **Step 1: Write failing admin view tests**

Tests must prove:
- unauthenticated state shows a login form and does not show source/feedback data;
- authenticated state shows source health including consecutive failures and manual crawl buttons;
- feedback and recommended-company rows can be marked reviewed/closed;
- category correction form records human corrections;
- no raw job export or bulk download control exists.

- [ ] **Step 2: Run admin tests to verify failure**

Run: `npm test -- tests/admin/AdminApp.test.tsx tests/admin/adminViewModel.test.ts`
Expected: FAIL because admin view files do not exist.

- [ ] **Step 3: Implement admin view model**

The view model must summarize source health, sort critical failures first, and expose only minimal fields needed for operations. It must not expose raw job rows or bulk export data.

- [ ] **Step 4: Implement `AdminApp`**

Use dependency-injected handlers so tests do not require a live database. The UI may be minimal but must cover login, source health, manual crawl, feedback review, recommendation review, and category correction.

- [ ] **Step 5: Run admin tests**

Run: `npm test -- tests/admin/auth.test.ts tests/admin/operations.test.ts tests/admin/AdminApp.test.tsx tests/admin/adminViewModel.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin tests/admin
git commit -m "feat: add minimal admin console"
```

---

### Task 4: Deployment, Backup, Restore, Monitoring, Robots, And Reverse Proxy

**Files:**
- Create: `Dockerfile`
- Create: `ops/docker-compose.yml`
- Create: `ops/nginx.conf`
- Create: `ops/backup.ps1`
- Create: `ops/backup.sh`
- Create: `ops/restore-test.ps1`
- Create: `ops/restore-test.sh`
- Create: `ops/monitoring-check.ts`
- Test: `tests/ops/deploymentConfig.test.ts`
- Test: `tests/ops/backupRestore.test.ts`
- Test: `tests/server/opsMonitoring.test.ts`
- Create: `src/server/opsMonitoring.ts`

**Interfaces:**
- Consumes: Task 1 `/healthz` and existing crawl observations/readiness output.
- Produces:
  - Docker Compose services for `postgres`, `web`, `worker`, `scheduler`, `nginx`, `backup`, and `monitor`.
  - Backup scripts with 14-day retention and restore-to-test-db commands.
  - `evaluateOpsAlerts(input: OpsAlertInput): OpsAlert[]`.

- [ ] **Step 1: Write failing ops tests**

Tests must prove:
- compose defines required services and does not expose PostgreSQL publicly;
- Nginx has no-index headers for `/api`, `/admin`, `/batch`, and `/raw`;
- backup scripts use `pg_dump`, retention of 14 days, and no secrets are hard-coded;
- restore scripts target a test database and refuse production database names;
- monitoring alert helpers fire for down website, backup failure, global crawl success below 80%, three consecutive per-company failures, expiring certificate, high disk, high memory, and abnormal traffic.

- [ ] **Step 2: Run ops tests to verify failure**

Run: `npm test -- tests/ops/deploymentConfig.test.ts tests/ops/backupRestore.test.ts tests/server/opsMonitoring.test.ts`
Expected: FAIL because ops files and monitoring helpers do not exist.

- [ ] **Step 3: Implement Docker and Nginx config**

Requirements:
- target 4 vCPU / 8 GB as recommended production capacity in comments;
- do not require China ICP filing in config;
- allow Aliyun Korea as origin;
- include comments for Cloudflare or equivalent WAF/CDN in front of Nginx;
- Nginx rate-limit zones protect API/admin/search paths;
- deny `/raw`, `/batch`, and hidden files.

- [ ] **Step 4: Implement backup/restore scripts**

PowerShell and Bash scripts must both:
- read connection strings from environment variables;
- write timestamped compressed dumps;
- retain 14 days by default;
- restore only when the target database name contains `test` or `restore`.

- [ ] **Step 5: Implement monitoring helper and command**

`ops/monitoring-check.ts` reads environment variables, calls `/healthz`, optionally checks PostgreSQL through `DATABASE_URL`, loads the latest crawl/readiness summary when available, evaluates alert rules, and exits non-zero for immediate-alert states.

- [ ] **Step 6: Run ops tests**

Run: `npm test -- tests/ops/deploymentConfig.test.ts tests/ops/backupRestore.test.ts tests/server/opsMonitoring.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile ops src/server/opsMonitoring.ts tests/ops tests/server/opsMonitoring.test.ts
git commit -m "feat: add p0 deployment operations"
```

---

### Task 5: P0 Launch Readiness Aggregator And Final Verification

**Files:**
- Create: `scripts/p0-launch-readiness.ts`
- Test: `tests/readiness/p0LaunchReadiness.test.ts`
- Modify: `package.json`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: existing `npm run p0:readiness -- --db`, Task 1-4 tests, route policy, and ops scripts.
- Produces:
  - `npm run p0:launch-readiness`
  - a typed summary that marks P0 incomplete if any required gate fails.

- [ ] **Step 1: Write failing readiness aggregator tests**

Tests must prove the aggregator requires:
- `p0:readiness -- --db` success;
- frontend app flow tests;
- server route/rate-limit tests;
- admin console tests;
- backup/restore tests;
- monitoring alert tests;
- build/typecheck/prisma validation.

- [ ] **Step 2: Run readiness test to verify failure**

Run: `npm test -- tests/readiness/p0LaunchReadiness.test.ts`
Expected: FAIL because the launch readiness script does not exist.

- [ ] **Step 3: Implement launch readiness script**

The script must run commands sequentially, print a concise gate summary, redact environment variable values, and exit non-zero on the first failed gate.

- [ ] **Step 4: Add package script**

Add:

```json
"p0:launch-readiness": "tsx scripts/p0-launch-readiness.ts"
```

- [ ] **Step 5: Run final verification**

Run:
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run prisma:validate`
- `npm run p0:readiness -- --db`
- `npm run p0:launch-readiness`

Expected: all PASS. `p0:readiness -- --db` must report at least `Crawl-evidenced verified companies: 50/50`.

- [ ] **Step 6: Commit**

```bash
git add scripts/p0-launch-readiness.ts tests/readiness/p0LaunchReadiness.test.ts package.json .superpowers/sdd/progress.md
git commit -m "feat: add p0 launch readiness gate"
```

---

## Self-Review

Spec coverage:
- Data-source readiness: covered by existing DB-backed `p0:readiness -- --db` and preserved in Task 5.
- Official links only: preserved by existing crawler/readiness gate and exposed through Task 1/2 service boundaries.
- Frontend search, consent, coverage, feedback, recommendation, and policy/terms: Task 2.
- Admin login, source health, manual crawl, feedback/recommendation review, category correction: Task 3.
- Security/anti-scraping/no-index/rate-limit/challenge/robots: Task 1 and Task 4.
- Deployment, backup, restore, monitoring, alerts: Task 4.
- Final launch evidence: Task 5.

Known unresolved non-code requirement:
- Korean-server cross-border compliance remains unverified and must stay as a legal-review note in policy text; no task asserts legal compliance.

Placeholder scan:
- No `TBD`, `TODO`, or unspecified “handle edge cases” instructions are used as implementation requirements.

Type consistency:
- API, frontend provider, admin view-model, ops monitoring, and readiness script interfaces are named once and consumed by later tasks with the same names.
