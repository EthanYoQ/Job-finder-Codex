# Persisted Readiness Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the P0 readiness gate consume persisted crawl observations from the database, so real crawl evidence can move the gate from `0/50` toward launch readiness.

**Architecture:** Add a mapper from persisted company/source/observation rows into the existing pure `getP0ReadinessReport` input shape. Add a small Prisma-backed readiness function and a CLI `--db` mode; the default CLI remains static registry mode.

**Tech Stack:** TypeScript, Vitest, Prisma Client types, existing readiness report, existing Prisma mapper conventions.

## Global Constraints

- Do not mark additional companies as `VERIFIED_SCRAPABLE`.
- Do not insert, fake, or count fixture observations as production evidence.
- P0 readiness remains blocked until persisted data contains 50 companies with two latest successful stable crawl observations.
- Default `npm run p0:readiness` must keep working without `DATABASE_URL`.
- `npm run p0:readiness -- --db` may require a configured database, but tests must use fake delegates and must not connect to a real DB.
- No public APIs, bulk export, admin UI, deployment scripts, WAF config, monitoring, backups, or live network calls are introduced by this plan.
- Do not print or store Tavily keys or other secrets.

---

### Task 1: Persisted Readiness Mapper

**Files:**
- Modify: `src/db/prismaMappers.ts`
- Create: `src/readiness/persistedReadiness.ts`
- Test: `tests/readiness/persistedReadiness.test.ts`

**Interfaces:**
- Consumes: `getP0ReadinessReport(input)`, Prisma enum names from `src/db/prismaMappers.ts`.
- Produces:
  - `fromPrismaRequiredJobField(field: PrismaRequiredJobFieldName): RequiredJobField`
  - `PersistedReadinessCompanyRow`
  - `toP0ReadinessInput(rows: readonly PersistedReadinessCompanyRow[]): P0ReadinessInput`

- [ ] **Step 1: Write the failing mapper test**

Create `tests/readiness/persistedReadiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getP0ReadinessReport } from "../../src/readiness/p0Readiness";
import {
  toP0ReadinessInput,
  type PersistedReadinessCompanyRow
} from "../../src/readiness/persistedReadiness";

const persistedBeigene: PersistedReadinessCompanyRow = {
  id: "company-beigene",
  officialChineseName: "百济神州",
  officialWebsiteUrl: "https://www.beonemedicines.com.cn/",
  pinyinName: "baiji-shenzhou",
  inclusionReason: "知名 Biotech、已实测",
  sources: [
    {
      id: "source-beigene-social",
      companyId: "company-beigene",
      kind: "SOCIAL",
      atsKind: "MOKA",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl:
        "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs",
      officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/",
      campusEntryUrl: null,
      crawlObservations: [
        {
          id: "obs-newest",
          sourceId: "source-beigene-social",
          crawledAt: new Date("2026-07-08T20:00:00.000Z"),
          successful: true,
          structuredJobCount: 50,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: null
        },
        {
          id: "obs-older",
          sourceId: "source-beigene-social",
          crawledAt: new Date("2026-07-08T08:00:00.000Z"),
          successful: true,
          structuredJobCount: 50,
          stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
          failureReason: null
        }
      ]
    }
  ]
};

describe("persisted readiness mapper", () => {
  it("maps persisted Prisma-style rows into the pure readiness gate input", () => {
    const input = toP0ReadinessInput([persistedBeigene]);

    expect(input.companies?.[0]).toMatchObject({
      id: "company-beigene",
      officialChineseName: "百济神州",
      officialWebsiteUrl: "https://www.beonemedicines.com.cn/"
    });
    expect(input.observationsBySource?.["source-beigene-social"]).toEqual([
      expect.objectContaining({
        id: "obs-newest",
        stableRequiredFields: ["company", "title", "officialUrl", "location"]
      }),
      expect.objectContaining({
        id: "obs-older",
        stableRequiredFields: ["company", "title", "officialUrl", "location"]
      })
    ]);
  });

  it("lets persisted stable observations count as crawl-evidenced readiness", () => {
    const report = getP0ReadinessReport(toP0ReadinessInput([persistedBeigene]));

    expect(report.crawlEvidencedVerifiedCompanies).toBe(1);
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "CANDIDATE_POOL_OUT_OF_RANGE"
    );
    expect(report.blockers.map((blocker) => blocker.code)).toContain(
      "VERIFIED_COMPANIES_BELOW_50"
    );
  });

  it("does not count failed latest observations even when an older pair succeeded", () => {
    const rows: PersistedReadinessCompanyRow[] = [
      {
        ...persistedBeigene,
        sources: [
          {
            ...persistedBeigene.sources[0]!,
            crawlObservations: [
              {
                id: "obs-failed-latest",
                sourceId: "source-beigene-social",
                crawledAt: new Date("2026-07-09T08:00:00.000Z"),
                successful: false,
                structuredJobCount: 0,
                stableRequiredFields: [],
                failureReason: "blocked"
              },
              ...persistedBeigene.sources[0]!.crawlObservations
            ]
          }
        ]
      }
    ];

    const report = getP0ReadinessReport(toP0ReadinessInput(rows));

    expect(report.crawlEvidencedVerifiedCompanies).toBe(0);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/readiness/persistedReadiness.test.ts`

Expected: FAIL because `src/readiness/persistedReadiness.ts` and `fromPrismaRequiredJobField` do not exist.

- [ ] **Step 3: Add reverse required-field mapper**

Modify `src/db/prismaMappers.ts`:

```ts
const PRISMA_TO_REQUIRED_FIELD = Object.fromEntries(
  Object.entries(REQUIRED_FIELD_TO_PRISMA).map(([field, prismaName]) => [prismaName, field])
) as Record<PrismaRequiredJobFieldName, RequiredJobField>;
```

Add export:

```ts
export function fromPrismaRequiredJobField(
  field: PrismaRequiredJobFieldName
): RequiredJobField {
  return PRISMA_TO_REQUIRED_FIELD[field];
}
```

- [ ] **Step 4: Implement persisted mapper**

Create `src/readiness/persistedReadiness.ts`:

```ts
import type { ATSKind, SourceKind, VerificationStatus } from "../domain/company";
import type { CandidateCompany } from "../data/companyRegistry";
import {
  fromPrismaRequiredJobField,
  type PrismaRequiredJobFieldName
} from "../db/prismaMappers";
import type { P0ReadinessInput } from "./p0Readiness";

export interface PersistedReadinessObservationRow {
  id: string;
  sourceId: string;
  crawledAt: Date;
  successful: boolean;
  structuredJobCount: number;
  stableRequiredFields: readonly PrismaRequiredJobFieldName[];
  failureReason: string | null;
}

export interface PersistedReadinessSourceRow {
  id: string;
  companyId: string;
  kind: SourceKind;
  atsKind: ATSKind;
  status: VerificationStatus;
  officialEntryUrl: string;
  officialChainEvidenceUrl: string;
  campusEntryUrl: string | null;
  crawlObservations: readonly PersistedReadinessObservationRow[];
}

export interface PersistedReadinessCompanyRow {
  id: string;
  officialChineseName: string;
  officialWebsiteUrl: string;
  pinyinName: string;
  inclusionReason: string;
  sources: readonly PersistedReadinessSourceRow[];
}

export function toP0ReadinessInput(
  rows: readonly PersistedReadinessCompanyRow[]
): P0ReadinessInput {
  return {
    companies: rows.map(toCandidateCompany),
    observationsBySource: Object.fromEntries(
      rows.flatMap((company) =>
        company.sources.map((source) => [
          source.id,
          source.crawlObservations.map((observation) => ({
            id: observation.id,
            sourceId: observation.sourceId,
            crawledAt: observation.crawledAt,
            successful: observation.successful,
            structuredJobCount: observation.structuredJobCount,
            stableRequiredFields: observation.stableRequiredFields.map(fromPrismaRequiredJobField),
            ...(observation.failureReason === null
              ? {}
              : { failureReason: observation.failureReason })
          }))
        ])
      )
    )
  };
}

function toCandidateCompany(row: PersistedReadinessCompanyRow): CandidateCompany {
  return {
    id: row.id,
    officialChineseName: row.officialChineseName,
    officialWebsiteUrl: row.officialWebsiteUrl,
    pinyinName: row.pinyinName,
    inclusionReason: row.inclusionReason,
    sources: row.sources.map((source) => ({
      id: source.id,
      companyId: source.companyId,
      kind: source.kind,
      atsKind: source.atsKind,
      status: source.status,
      officialEntryUrl: source.officialEntryUrl,
      officialChainEvidenceUrl: source.officialChainEvidenceUrl,
      ...(source.campusEntryUrl === null ? {} : { campusEntryUrl: source.campusEntryUrl })
    }))
  };
}
```

- [ ] **Step 5: Run focused verification**

Run: `npm test -- tests/readiness/persistedReadiness.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/db/prismaMappers.ts src/readiness/persistedReadiness.ts tests/readiness/persistedReadiness.test.ts
git commit -m "feat: map persisted readiness evidence"
```

### Task 2: Prisma-backed Readiness Report

**Files:**
- Create: `src/readiness/prismaReadiness.ts`
- Test: `tests/readiness/prismaReadiness.test.ts`

**Interfaces:**
- Consumes: `toP0ReadinessInput(rows)` and `getP0ReadinessReport(input)`.
- Produces:
  - `P0ReadinessPrismaDb`
  - `getP0ReadinessReportFromDb(db: P0ReadinessPrismaDb): Promise<P0ReadinessReport>`

- [ ] **Step 1: Write the failing DB report test**

Create `tests/readiness/prismaReadiness.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  getP0ReadinessReportFromDb,
  type P0ReadinessPrismaDb
} from "../../src/readiness/prismaReadiness";

describe("Prisma readiness report", () => {
  it("queries companies, sources, and latest crawl observations for the readiness gate", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "company-beigene",
        officialChineseName: "百济神州",
        officialWebsiteUrl: "https://www.beonemedicines.com.cn/",
        pinyinName: "baiji-shenzhou",
        inclusionReason: "知名 Biotech、已实测",
        sources: [
          {
            id: "source-beigene-social",
            companyId: "company-beigene",
            kind: "SOCIAL",
            atsKind: "MOKA",
            status: "VERIFIED_SCRAPABLE",
            officialEntryUrl:
              "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs",
            officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/",
            campusEntryUrl: null,
            crawlObservations: [
              {
                id: "obs-2",
                sourceId: "source-beigene-social",
                crawledAt: new Date("2026-07-08T20:00:00.000Z"),
                successful: true,
                structuredJobCount: 50,
                stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
                failureReason: null
              },
              {
                id: "obs-1",
                sourceId: "source-beigene-social",
                crawledAt: new Date("2026-07-08T08:00:00.000Z"),
                successful: true,
                structuredJobCount: 50,
                stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"],
                failureReason: null
              }
            ]
          }
        ]
      }
    ]);
    const db = { company: { findMany } } satisfies P0ReadinessPrismaDb;

    const report = await getP0ReadinessReportFromDb(db);

    expect(findMany).toHaveBeenCalledWith({
      include: {
        sources: {
          include: {
            crawlObservations: {
              orderBy: { crawledAt: "desc" },
              take: 2
            }
          }
        }
      },
      orderBy: { pinyinName: "asc" }
    });
    expect(report.crawlEvidencedVerifiedCompanies).toBe(1);
    expect(report.canLaunchP0).toBe(false);
  });
});
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `npm test -- tests/readiness/prismaReadiness.test.ts`

Expected: FAIL because `src/readiness/prismaReadiness.ts` does not exist.

- [ ] **Step 3: Implement Prisma report**

Create `src/readiness/prismaReadiness.ts`:

```ts
import { getP0ReadinessReport, type P0ReadinessReport } from "./p0Readiness";
import {
  toP0ReadinessInput,
  type PersistedReadinessCompanyRow
} from "./persistedReadiness";

export interface P0ReadinessPrismaDb {
  company: {
    findMany(args: {
      include: {
        sources: {
          include: {
            crawlObservations: {
              orderBy: { crawledAt: "desc" };
              take: 2;
            };
          };
        };
      };
      orderBy: { pinyinName: "asc" };
    }): Promise<PersistedReadinessCompanyRow[]>;
  };
}

const READINESS_COMPANY_QUERY = {
  include: {
    sources: {
      include: {
        crawlObservations: {
          orderBy: { crawledAt: "desc" as const },
          take: 2 as const
        }
      }
    }
  },
  orderBy: { pinyinName: "asc" as const }
};

export async function getP0ReadinessReportFromDb(
  db: P0ReadinessPrismaDb
): Promise<P0ReadinessReport> {
  const rows = await db.company.findMany(READINESS_COMPANY_QUERY);

  return getP0ReadinessReport(toP0ReadinessInput(rows));
}
```

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/readiness/prismaReadiness.test.ts tests/readiness/persistedReadiness.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/readiness/prismaReadiness.ts tests/readiness/prismaReadiness.test.ts
git commit -m "feat: add database readiness report"
```

### Task 3: CLI Database Mode

**Files:**
- Modify: `scripts/p0-readiness-report.ts`
- Test: `tests/readiness/p0ReadinessReportCli.test.ts`

**Interfaces:**
- Consumes: `getP0ReadinessReportFromDb(db)`.
- Produces: `npm run p0:readiness -- --db` database-backed mode.

- [ ] **Step 1: Add CLI behavior tests**

Modify `tests/readiness/p0ReadinessReportCli.test.ts` by adding:

```ts
  it("prints usage for the database readiness mode without exposing secrets", () => {
    const output = execFileSync(
      process.platform === "win32" ? "cmd.exe" : "npx",
      process.platform === "win32"
        ? ["/d", "/s", "/c", "npx", "tsx", "scripts/p0-readiness-report.ts", "--help"]
        : ["tsx", "scripts/p0-readiness-report.ts", "--help"],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    expect(output).toContain("Usage: npm run p0:readiness -- [--db]");
    expect(output).toContain("--db");
    expect(output).not.toMatch(/tvly-dev-[A-Za-z0-9_-]+/);
  });
```

- [ ] **Step 2: Run focused CLI test and verify it fails**

Run: `npm test -- tests/readiness/p0ReadinessReportCli.test.ts`

Expected: FAIL because `--help` is not implemented.

- [ ] **Step 3: Implement CLI modes**

Modify `scripts/p0-readiness-report.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { getP0ReadinessReport, type P0ReadinessReport } from "../src/readiness/p0Readiness";
import { getP0ReadinessReportFromDb } from "../src/readiness/prismaReadiness";

const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log("Usage: npm run p0:readiness -- [--db]");
  console.log("");
  console.log("Without --db, uses the static candidate registry and no persisted observations.");
  console.log("With --db, reads companies, sources, and the latest two crawl observations per source from PostgreSQL.");
  process.exit(0);
}

const report = args.has("--db") ? await reportFromDb() : getP0ReadinessReport();

printReport(report);
process.exitCode = report.canLaunchP0 ? 0 : 1;

async function reportFromDb(): Promise<P0ReadinessReport> {
  const prisma = new PrismaClient();
  try {
    return await getP0ReadinessReportFromDb(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

function printReport(report: P0ReadinessReport): void {
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
}
```

- [ ] **Step 4: Run focused verification**

Run: `npm test -- tests/readiness/p0ReadinessReportCli.test.ts`

Expected: PASS.

Run: `npm run p0:readiness`

Expected: exits `1`, still uses static mode, and still reports `0/50`.

Run: `npm run p0:readiness -- --help`

Expected: exits `0` and prints usage.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add scripts/p0-readiness-report.ts tests/readiness/p0ReadinessReportCli.test.ts
git commit -m "feat: add database readiness CLI mode"
```

### Task 4: Full Verification And Plan Completion

**Files:**
- Modify: `docs/superpowers/plans/2026-07-08-persisted-readiness-evidence.md`

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
npm run p0:readiness -- --help
git grep -n -E "tvly-dev-[A-Za-z0-9_-]+" -- . ':!.superpowers'
```

Expected:
- `npm test`, `npm run typecheck`, `npm run build`, and `npm run prisma:validate` pass.
- Default `npm run p0:readiness` exits `1` and remains static `0/50` until persisted DB observations are loaded.
- `npm run p0:readiness -- --help` exits `0`.
- Tavily key grep has no matches.

- [ ] **Step 2: Mark checkboxes complete**

Only after Step 1 verification, change every task checkbox in this plan from `[ ]` to `[x]`.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add docs/superpowers/plans/2026-07-08-persisted-readiness-evidence.md
git commit -m "docs: complete persisted readiness evidence plan"
```

## Self-Review

- Spec coverage: this plan connects persisted crawl observations to the readiness gate and CLI without fabricating production evidence.
- Placeholder scan: no TODO/TBD placeholders are present.
- Type consistency: persisted rows map into `P0ReadinessInput`; Prisma query retrieves only latest two observations per source.
