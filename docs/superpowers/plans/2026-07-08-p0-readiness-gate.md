# P0 Readiness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runnable, auditable P0 readiness gate so launch status is based on candidate coverage, configured crawl plans, and crawl-observation evidence instead of registry labels alone.

**Architecture:** Keep the gate as a pure TypeScript reporting module that imports the existing candidate registry, source crawl planner, and domain verification logic. Add a small CLI script for operators to print the report without exposing secrets or adding public APIs.

**Tech Stack:** TypeScript, Vitest, tsx, existing crawler/source-plan modules, existing domain verification module.

## Global Constraints

- P0 launch remains blocked until the candidate pool has 80-120 companies and at least 50 companies meet the full “已验证可抓取” definition.
- “已验证可抓取” requires an official social recruitment source, official-chain evidence, a configured crawl plan, and at least two latest successful stable crawl observations with company, title, officialUrl, and location fields.
- P0 front-end jobs come from social recruitment only; campus entries are recorded but never count toward the P0 job launch gate.
- Do not mark additional companies as `VERIFIED_SCRAPABLE` without official-chain and crawl-observation evidence.
- Do not introduce public APIs, bulk export, admin UI, deployment scripts, WAF config, monitoring, backups, or real live network calls in this plan.
- Do not print or store Tavily keys or other secrets.

---

### Task 1: Pure P0 Readiness Report

**Files:**
- Create: `src/readiness/p0Readiness.ts`
- Test: `tests/readiness/p0Readiness.test.ts`

**Interfaces:**
- Consumes: `candidateCompanies`, `buildSourceCrawlPlans(companies)`, `isVerifiedScrapable(source, observations)`, `P0_MIN_VERIFIED_SCRAPABLE_COMPANIES`.
- Produces:
  - `P0ReadinessBlockerCode`
  - `P0ReadinessReport`
  - `getP0ReadinessReport(input?: P0ReadinessInput): P0ReadinessReport`

- [x] **Step 1: Write the failing report test**

Create `tests/readiness/p0Readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { P0_MIN_VERIFIED_SCRAPABLE_COMPANIES } from "../../src/domain/verification";
import { getP0ReadinessReport } from "../../src/readiness/p0Readiness";

describe("P0 readiness report", () => {
  it("keeps the current project blocked until 50 crawl-evidenced companies are ready", () => {
    const report = getP0ReadinessReport();

    expect(report.totalCandidates).toBeGreaterThanOrEqual(80);
    expect(report.totalCandidates).toBeLessThanOrEqual(120);
    expect(report.requiredVerifiedCompanies).toBe(P0_MIN_VERIFIED_SCRAPABLE_COMPANIES);
    expect(report.crawlEvidencedVerifiedCompanies).toBeLessThan(50);
    expect(report.canLaunchP0).toBe(false);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_COMPANIES_BELOW_50"
    );
  });

  it("flags registry sources that are labelled verified but cannot be planned for crawl", () => {
    const report = getP0ReadinessReport();

    expect(report.declaredVerifiedSocialSources).toBeGreaterThan(
      report.configuredVerifiedSocialSources
    );
    expect(report.verifiedSourcesMissingCrawlPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "source-beigene-social",
          companyId: "company-beigene",
          companyName: "百济神州"
        })
      ])
    );
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN"
    );
  });

  it("allows a synthetic launch only when 50 companies have configured plans and stable observations", () => {
    const readyCompanies = Array.from({ length: 80 }, (_, index) => ({
      id: `company-ready-${index}`,
      officialChineseName: `测试药企${index}`,
      pinyinName: `ceshi-${index}`,
      officialWebsiteUrl: `https://company-${index}.example.com`,
      inclusionReason: "测试样本",
      sources: [
        {
          id: `source-ready-${index}-social`,
          companyId: `company-ready-${index}`,
          kind: "SOCIAL" as const,
          atsKind: "OFFICIAL_JSON" as const,
          status: index < 50 ? ("VERIFIED_SCRAPABLE" as const) : ("ENTRY_FOUND_PENDING_ADAPTER" as const),
          officialEntryUrl: `https://company-${index}.example.com/jobs`,
          officialChainEvidenceUrl: `https://company-${index}.example.com/careers`
        }
      ]
    }));
    const configuredSourceIds = new Set(
      readyCompanies.slice(0, 50).map((company) => company.sources[0]!.id)
    );
    const observationsBySource = Object.fromEntries(
      readyCompanies.slice(0, 50).map((company) => {
        const sourceId = company.sources[0]!.id;
        return [
          sourceId,
          [
            {
              id: `${sourceId}-crawl-1`,
              sourceId,
              crawledAt: new Date("2026-07-07T08:00:00Z"),
              successful: true,
              structuredJobCount: 3,
              stableRequiredFields: ["company", "title", "officialUrl", "location"] as const
            },
            {
              id: `${sourceId}-crawl-2`,
              sourceId,
              crawledAt: new Date("2026-07-07T20:00:00Z"),
              successful: true,
              structuredJobCount: 3,
              stableRequiredFields: ["company", "title", "officialUrl", "location"] as const
            }
          ]
        ];
      })
    );

    const report = getP0ReadinessReport({
      companies: readyCompanies,
      configuredSourceIds,
      observationsBySource
    });

    expect(report.crawlEvidencedVerifiedCompanies).toBe(50);
    expect(report.blockers).toEqual([]);
    expect(report.canLaunchP0).toBe(true);
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/readiness/p0Readiness.test.ts`

Expected: FAIL because `src/readiness/p0Readiness.ts` does not exist.

- [x] **Step 3: Implement the readiness report**

Create `src/readiness/p0Readiness.ts`:

```ts
import { buildSourceCrawlPlans } from "../crawler/sourcePlan";
import { candidateCompanies, type CandidateCompany } from "../data/companyRegistry";
import type { CrawlObservation, RecruitmentSource } from "../domain/company";
import {
  isVerifiedScrapable,
  P0_MIN_VERIFIED_SCRAPABLE_COMPANIES
} from "../domain/verification";

export type P0ReadinessBlockerCode =
  | "CANDIDATE_POOL_OUT_OF_RANGE"
  | "VERIFIED_COMPANIES_BELOW_50"
  | "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN";

export interface P0ReadinessBlocker {
  code: P0ReadinessBlockerCode;
  message: string;
}

export interface P0ReadinessSourceIssue {
  sourceId: string;
  companyId: string;
  companyName: string;
}

export interface P0ReadinessReport {
  totalCandidates: number;
  requiredVerifiedCompanies: number;
  declaredVerifiedSocialSources: number;
  configuredVerifiedSocialSources: number;
  crawlEvidencedVerifiedCompanies: number;
  verifiedSourcesMissingCrawlPlan: P0ReadinessSourceIssue[];
  blockers: P0ReadinessBlocker[];
  canLaunchP0: boolean;
}

export interface P0ReadinessInput {
  companies?: readonly CandidateCompany[];
  configuredSourceIds?: ReadonlySet<string>;
  observationsBySource?: Record<string, CrawlObservation[]>;
}

export function getP0ReadinessReport(input: P0ReadinessInput = {}): P0ReadinessReport {
  const companies = input.companies ?? candidateCompanies;
  const configuredSourceIds =
    input.configuredSourceIds ??
    new Set(buildSourceCrawlPlans(companies).map((plan) => plan.source.id));
  const observationsBySource = input.observationsBySource ?? {};
  const declaredVerifiedSources = companies.flatMap((company) =>
    company.sources
      .filter((source) => source.kind === "SOCIAL" && source.status === "VERIFIED_SCRAPABLE")
      .map((source) => ({ company, source }))
  );
  const verifiedSourcesMissingCrawlPlan = declaredVerifiedSources
    .filter(({ source }) => !configuredSourceIds.has(source.id))
    .map(({ company, source }) => ({
      sourceId: source.id,
      companyId: company.id,
      companyName: company.officialChineseName
    }));
  const configuredVerifiedSocialSources = declaredVerifiedSources.filter(({ source }) =>
    configuredSourceIds.has(source.id)
  );
  const crawlEvidencedVerifiedCompanies = companies.filter((company) =>
    company.sources.some((source) => {
      if (!configuredSourceIds.has(source.id)) return false;
      const completeSource = toCompleteRecruitmentSource(company, source);
      return completeSource
        ? isVerifiedScrapable(completeSource, observationsBySource[source.id] ?? [])
        : false;
    })
  ).length;
  const blockers = buildBlockers({
    totalCandidates: companies.length,
    crawlEvidencedVerifiedCompanies,
    verifiedSourcesMissingCrawlPlan
  });

  return {
    totalCandidates: companies.length,
    requiredVerifiedCompanies: P0_MIN_VERIFIED_SCRAPABLE_COMPANIES,
    declaredVerifiedSocialSources: declaredVerifiedSources.length,
    configuredVerifiedSocialSources: configuredVerifiedSocialSources.length,
    crawlEvidencedVerifiedCompanies,
    verifiedSourcesMissingCrawlPlan,
    blockers,
    canLaunchP0: blockers.length === 0
  };
}

function toCompleteRecruitmentSource(
  company: CandidateCompany,
  source: CandidateCompany["sources"][number]
): RecruitmentSource | undefined {
  if (!company.officialWebsiteUrl || !source.officialEntryUrl || !source.officialChainEvidenceUrl) {
    return undefined;
  }

  return {
    id: source.id,
    companyId: source.companyId,
    kind: source.kind,
    atsKind: source.atsKind,
    officialEntryUrl: source.officialEntryUrl,
    officialChainEvidenceUrl: source.officialChainEvidenceUrl,
    status: source.status
  };
}

function buildBlockers({
  totalCandidates,
  crawlEvidencedVerifiedCompanies,
  verifiedSourcesMissingCrawlPlan
}: {
  totalCandidates: number;
  crawlEvidencedVerifiedCompanies: number;
  verifiedSourcesMissingCrawlPlan: readonly P0ReadinessSourceIssue[];
}): P0ReadinessBlocker[] {
  const blockers: P0ReadinessBlocker[] = [];

  if (totalCandidates < 80 || totalCandidates > 120) {
    blockers.push({
      code: "CANDIDATE_POOL_OUT_OF_RANGE",
      message: `P0 candidate pool must contain 80-120 companies; current count is ${totalCandidates}.`
    });
  }

  if (crawlEvidencedVerifiedCompanies < P0_MIN_VERIFIED_SCRAPABLE_COMPANIES) {
    blockers.push({
      code: "VERIFIED_COMPANIES_BELOW_50",
      message: `P0 requires at least ${P0_MIN_VERIFIED_SCRAPABLE_COMPANIES} crawl-evidenced verified companies; current count is ${crawlEvidencedVerifiedCompanies}.`
    });
  }

  if (verifiedSourcesMissingCrawlPlan.length > 0) {
    blockers.push({
      code: "VERIFIED_SOURCE_WITHOUT_CRAWL_PLAN",
      message: `${verifiedSourcesMissingCrawlPlan.length} declared verified social source(s) are missing crawl-plan configuration.`
    });
  }

  return blockers;
}
```

- [x] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/readiness/p0Readiness.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [x] **Step 5: Commit Task 1**

Run:

```bash
git add src/readiness/p0Readiness.ts tests/readiness/p0Readiness.test.ts
git commit -m "feat: add P0 readiness report"
```

### Task 2: Operator Readiness Report CLI

**Files:**
- Create: `scripts/p0-readiness-report.ts`
- Modify: `package.json`
- Test: `tests/readiness/p0ReadinessReportCli.test.ts`

**Interfaces:**
- Consumes: `getP0ReadinessReport()`.
- Produces: npm script `p0:readiness` that prints a markdown report and exits `1` when P0 is blocked.

- [x] **Step 1: Write the failing CLI test**

Create `tests/readiness/p0ReadinessReportCli.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("P0 readiness CLI", () => {
  it("prints the current readiness blockers without secrets", () => {
    let output = "";
    let exitCode = 0;

    try {
      output = execFileSync("npx", ["tsx", "scripts/p0-readiness-report.ts"], {
        cwd: process.cwd(),
        encoding: "utf8"
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      exitCode = failure.status ?? 1;
      output = failure.stdout ?? "";
    }

    expect(exitCode).toBe(1);
    expect(output).toContain("# P0 Readiness Report");
    expect(output).toContain("Can launch P0: no");
    expect(output).toContain("VERIFIED_COMPANIES_BELOW_50");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  });
});
```

- [x] **Step 2: Run the focused CLI test and verify it fails**

Run: `npm test -- tests/readiness/p0ReadinessReportCli.test.ts`

Expected: FAIL because `scripts/p0-readiness-report.ts` does not exist.

- [x] **Step 3: Implement the CLI script**

Create `scripts/p0-readiness-report.ts`:

```ts
import { getP0ReadinessReport } from "../src/readiness/p0Readiness";

const report = getP0ReadinessReport();

console.log("# P0 Readiness Report");
console.log("");
console.log(`Can launch P0: ${report.canLaunchP0 ? "yes" : "no"}`);
console.log(`Candidate companies: ${report.totalCandidates}`);
console.log(`Declared verified social sources: ${report.declaredVerifiedSocialSources}`);
console.log(`Configured verified social sources: ${report.configuredVerifiedSocialSources}`);
console.log(
  `Crawl-evidenced verified companies: ${report.crawlEvidencedVerifiedCompanies}/${report.requiredVerifiedCompanies}`
);

if (report.verifiedSourcesMissingCrawlPlan.length > 0) {
  console.log("");
  console.log("## Verified sources missing crawl plans");
  for (const issue of report.verifiedSourcesMissingCrawlPlan) {
    console.log(`- ${issue.companyName} (${issue.companyId}, ${issue.sourceId})`);
  }
}

if (report.blockers.length > 0) {
  console.log("");
  console.log("## Blockers");
  for (const blocker of report.blockers) {
    console.log(`- ${blocker.code}: ${blocker.message}`);
  }
}

process.exitCode = report.canLaunchP0 ? 0 : 1;
```

- [x] **Step 4: Add npm script**

Modify `package.json`:

```json
"p0:readiness": "tsx scripts/p0-readiness-report.ts"
```

Keep the existing scripts unchanged.

- [x] **Step 5: Run focused verification**

Run: `npm test -- tests/readiness/p0ReadinessReportCli.test.ts`

Expected: PASS.

Run: `npm run p0:readiness`

Expected: prints the report and exits with code `1` while P0 remains blocked.

- [x] **Step 6: Commit Task 2**

Run:

```bash
git add scripts/p0-readiness-report.ts package.json tests/readiness/p0ReadinessReportCli.test.ts
git commit -m "feat: add P0 readiness report CLI"
```

### Task 3: Document Current Readiness Evidence

**Files:**
- Modify: `docs/prd/pharma-job-aggregator-prd.md`
- Modify: `docs/superpowers/specs/2026-07-07-pharma-job-aggregator-design.md`

**Interfaces:**
- Consumes: `npm run p0:readiness`.
- Produces: documentation note that the canonical P0 launch gate is the readiness report, not raw registry status labels.

- [x] **Step 1: Add PRD readiness note**

In `docs/prd/pharma-job-aggregator-prd.md`, add this paragraph after the existing P0 launch blocking paragraph:

```md
The implementation must use `npm run p0:readiness` as the local launch-gate check. A company source status label alone is not enough for P0 readiness; the check must also confirm a configured crawl plan and two latest successful stable crawl observations. If the report exits non-zero, the project remains internal/prototype only.
```

- [x] **Step 2: Add spec readiness note**

In `docs/superpowers/specs/2026-07-07-pharma-job-aggregator-design.md`, add this paragraph after the “已验证可抓取”的判定标准 list:

```md
Implementation note: `npm run p0:readiness` is the canonical local readiness check. Registry labels, official URLs, and source-plan configuration are treated as separate evidence layers; a source is not P0 launch evidence unless the readiness report also sees two latest successful stable crawl observations.
```

- [x] **Step 3: Run doc-focused checks**

Run: `npm run p0:readiness`

Expected: prints the readiness report, exits `1`, and includes no Tavily key material.

Run: `git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'`

Expected: no matches.

- [x] **Step 4: Commit Task 3**

Run:

```bash
git add docs/prd/pharma-job-aggregator-prd.md docs/superpowers/specs/2026-07-07-pharma-job-aggregator-design.md
git commit -m "docs: document P0 readiness gate"
```

### Task 4: Full Verification And Plan Completion

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-p0-readiness-gate.md`

**Interfaces:**
- Consumes: all changes from Tasks 1-3.
- Produces: completed plan checkboxes only after fresh verification.

- [x] **Step 1: Run full verification**

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
- `npm run p0:readiness` exits `1` because P0 is still blocked; this is expected and must not be treated as a test failure.
- Tavily key grep has no matches.

- [x] **Step 2: Mark checkboxes complete**

Only after Step 1 verification, change every checkbox in this plan from `[ ]` to `[x]`.

- [x] **Step 3: Commit Task 4**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-p0-readiness-gate.md
git commit -m "docs: complete P0 readiness gate plan"
```

## Self-Review

- Spec coverage: this plan implements a canonical local readiness gate for the PRD’s 50-company blocker. It does not implement the 50 live verified companies, admin UI screens, production deployment, WAF/rate limits, monitoring, or backups.
- Placeholder scan: no TODO/TBD placeholders are present.
- Type consistency: the report consumes existing registry source objects and converts only complete social sources into the domain `RecruitmentSource` shape before calling `isVerifiedScrapable`.
