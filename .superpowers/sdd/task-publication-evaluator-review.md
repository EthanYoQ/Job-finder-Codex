# Independent review: company publication eligibility

## Verdict

**PASS**

Commit reviewed: `fe4bcf9 feat: derive company publication eligibility`

No blocking implementation finding was identified. All hard gates from the corrected brief passed. One non-blocking Minor documentation finding remains in the tracked implementation report.

## Findings

### Minor — compatibility test count is not reproducible from the reviewed commit

`.superpowers/sdd/task-publication-evaluator-report.md:65` records the four confirmed-roster / Phase 1 / source-plan authority files as **37/37**. In an isolated tracked-tree snapshot of `fe4bcf9`, those exact four files contain and pass **35/35** tests.

The downstream `8936a07` source-plan/adapter commit adds one test to each source-plan file, and that later tree passes 37/37. The report therefore captured parallel/downstream work rather than the exact target commit without saying so.

This is evidence-provenance/documentation drift, not a publication evaluator defect: the exact commit passes 35/35, the downstream compatibility tree passes 37/37, and all evaluator hard gates below pass. It does **not** block merge of `fe4bcf9`.

## Standard quality gate

| Gate | Severity | Threshold | Independent evidence | Status |
| --- | --- | --- | --- | --- |
| Canonical directory authority | Hard | Exact canonical 60 records, 30 foreign + 30 domestic, independent of DB rows | Empty-DB probe returned exact canonical IDs, 60/30/30, and both exact exclusions | PASS |
| Read/query contract | Hard | One batched source-result query; explicit eligible batch kinds; no Company/Job/Observation/N+1 reads or writes | Proxy DB observed one `crawlBatchSourceResult.findMany`; static scan found the single call site and no mutation method | PASS |
| Attempt truth and adjacency | Hard | Terminal zero-observation failures remain; RUNNING batches are ignored; terminal inconsistencies break; two adjacent current-config successes are required | Focused tests plus independent sequence probe covered failure, RUNNING, missing batch finish, config mismatch, and ordering | PASS |
| Sticky qualification and current health | Hard | Later failure retains eligibility but degrades health; one recovery success remains degraded; two restore healthy | Independent sequence probe reproduced sticky/degraded/one-recovery/two-recovery transitions | PASS |
| Company all-of and dynamic denominator | Hard | Every staged source qualifies; any canonical official SOCIAL entry/chain source not staged keeps VERIFYING | Multi-source tests passed; downstream real Otsuka probe with two canonical official sources and only one staged stayed VERIFYING after two successes | PASS |
| Strict tuple correction | Hard | Null `officialEntryId` and empty surface/channel arrays do not block an otherwise qualifying staged result | Focused qualification and repository tests passed using null/empty strict tuple fields | PASS |
| Scope and immutability | Hard | No schema/migration/registry/source-plan mutation; no hard-coded passing count; read-only evaluator only | Commit contains only six scoped files; protected blob/tree IDs match parent; implementation scan found no mutation calls or 46/50/58/60 constants | PASS |
| Verification | Hard | Focused, typecheck, authority integration, and diff-check pass on the target tree | 36/36 focused; whole typecheck exit 0; 35/35 target-tree authority tests; `git diff --check` passed | PASS |
| Report reproducibility | Advisory | Reported test totals identify the tree actually tested | Report says 37 while target commit has 35; downstream tree explains the difference | FAIL (Minor) |

Decision: **PASS**. The sole advisory failure is non-blocking.

## Key independent evidence

### Canonical authority and one-query probe

Using an exact archived tracked tree of `fe4bcf9` and an in-memory read-only DB proxy:

```text
query calls:              1
companies:                60
foreign / domestic:       30 / 30
company ids exact:        true
queried source ids:       equal to internally derived staged plans
batch kinds:              FULL_RELEASE, SCHEDULED, BASELINE
authorized exclusions:    company-humanwell, company-north-china-pharma
state count total:        60
health count total:       60
```

No DB Company, Job, or CrawlObservation surface existed on the proxy. Any access other than `crawlBatchSourceResult` would have thrown.

### Event sequence probe

The independent pure-domain matrix verified:

- two current-config successes qualify and are healthy;
- success → zero-observation terminal failure → success does not qualify;
- qualification remains sticky after a later failure while health becomes degraded;
- one recovery success remains degraded and the second restores healthy;
- a terminal-looking source row inside a RUNNING batch is completely ignored;
- a terminal batch missing `batchFinishedAt` remains a breaking non-qualifying event;
- a config mismatch between successes breaks adjacency;
- null/empty strict-oracle tuple fields remain accepted.

### Dynamic Otsuka coverage probe

The next canonical source-plan tree (`8936a07`) gives `company-otsuka-china` two canonical official SOCIAL entry/chain sources but stages only `source-otsuka-china-social-2`. Feeding two fully qualifying current-config results for that staged source produced:

```text
state:                VERIFYING
health:               NOT_APPLICABLE
eligibleSourceIds:    []
reasonCode:           OFFICIAL_ENTRY_NOT_AUTOMATED
PUBLISHING count:     0
query calls:          1
```

This confirms the rule is derived from canonical source identities and adapts to a changed plan denominator; it is not a company-name exception or a fixed passing count.

## Commands and results

- Exact `fe4bcf9` tracked-tree focused suite:
  `npx vitest run tests/domain/publicationEligibility.test.ts tests/db/publicationEligibilityRepository.test.ts --maxWorkers=2 --minWorkers=2`
  — **2 files, 36/36 passed**.
- Exact target-tree authority suite:
  `tests/data/confirmedCompanyRosterV3.test.ts`, `tests/data/phase1ScopePolicy.test.ts`, `tests/crawler/sourcePlan.test.ts`, `tests/crawler/sourcePlanChannels.test.ts`
  — **4 files, 35/35 passed**.
- Downstream `8936a07` compatibility rerun of the same four files — **37/37 passed**.
- Exact target-tree `tsc --noEmit --project tsconfig.json` — passed.
- `git diff --check fe4bcf9^ fe4bcf9` and `git show --check fe4bcf9` — passed.

The shared worktree later entered an unrelated `stagedMonitoringIdentity.test.ts` RED phase, so a subsequent current-tree typecheck failed on that missing future module. It is outside `fe4bcf9`; the isolated exact-target typecheck above passed and is the evidence used for this verdict.

## Scope verification

Only these six files entered `fe4bcf9`:

- `.superpowers/sdd/task-publication-evaluator-brief.md`
- `.superpowers/sdd/task-publication-evaluator-report.md`
- `src/domain/publicationEligibility.ts`
- `src/db/publicationEligibilityRepository.ts`
- `tests/domain/publicationEligibility.test.ts`
- `tests/db/publicationEligibilityRepository.test.ts`

`prisma/schema.prisma`, the migrations tree, canonical registry, source-plan authority, crawler/scheduler, scripts, search/API/UI/readiness, outputs, and progress ledger are parent/commit identical or absent from the diff. No live DB, crawl, migration, seed, registry sync, deployment, or real output mutation was performed during review.
