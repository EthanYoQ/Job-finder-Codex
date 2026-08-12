# Task: Derive per-company staged publication eligibility

## Purpose

Build one shared, read-only truth for which companies may publish official jobs. A company becomes publishable only after every current staged official source has two adjacent qualifying completed attempts. Later failure keeps last-known jobs publishable but marks health degraded. The exact fixed 60-company directory must remain visible regardless of DB rows.

Read `.superpowers/sdd/task-publication-evaluator-design.md` first, then apply the correction below about strict-oracle tuple fields.

## Files in scope

- new `src/domain/publicationEligibility.ts`
- new `src/db/publicationEligibilityRepository.ts`
- new `tests/domain/publicationEligibility.test.ts`
- new `tests/db/publicationEligibilityRepository.test.ts`
- `.superpowers/sdd/task-publication-evaluator-report.md`

Do not change schema/migrations, crawler/scheduler, registry data, search/API/UI/readiness, scripts, outputs, control docs, or progress ledger. Do not run a live DB, crawl, migration, seed, registry sync, or deployment.

## Authority and query contract

1. Repository public entry accepts only a read-only DB interface. It internally asserts canonical exact 30+30 `candidateCompanies`, builds `buildStagedSourceCrawlPlans(candidateCompanies)`, verifies explicit STAGED executable plans and unique exact company ownership, and derives each current `sourcePlanConfigSha256` itself. It accepts no caller companies/plans/source ids/hashes/counts.
2. Execute exactly one batched `crawlBatchSourceResult.findMany` for all staged source ids, including relation-selected batch facts and up to two observations per result. Eligible batch kinds are explicitly `FULL_RELEASE | SCHEDULED | BASELINE`; MANUAL and null kinds do not participate. Do not query Company, Job, or CrawlObservation separately and do not perform per-source reads.
3. Map every `CrawlBatchSourceResult` to a completed/in-flight attempt event. A terminal source failure with zero observations remains an event and breaks adjacent success; never filter failed rows before adjacency evaluation. Canonically sort by batch startedAt, batchId UTF-8, source startedAt, source-result id UTF-8. Reject duplicate batch/source attempts and tuple drift.
4. Directory authority is the canonical registry, never DB Company rows. Output exact canonical 60 records and dynamically reduce all state/health/eligible counts from those records. No hard-coded passing total or current 46/50/58 count.

## Qualifying attempt

An attempt qualifies only when all are true:

- source belongs to the current staged plan and `sourceConfigHash` equals its current plan config hash;
- completed terminal result with transport/adapter/completeness/atomic states `SUCCEEDED/SUCCEEDED/VERIFIED/COMMITTED`;
- exactly one observation bound to the exact source-result/source/config tuple;
- observation `successful`, transport, adapter, completeness and atomic booleans are all strictly true and status is VERIFIED;
- observation structured count equals result dedupe-output count; expected counts agree, and when expected is present output equals expected;
- official zero jobs requires exact `0/0/0`; positive results require stable COMPANY, TITLE, OFFICIAL_URL and LOCATION fields.

Important correction to the design report: do **not** require nonempty `officialEntryId`, `officialSurfaceIds`, or `officialChannelIds` for staged qualification. Current SCHEDULED pending rows are created without strict signed-oracle tuples. Official authority is instead the canonical executable STAGED plan plus the exact current plan-config hash and atomic observation. Those optional strict-evidence columns must not become an accidental permanent zero-eligibility gate.

In-flight RUNNING/PENDING rows do not qualify and do not break an already completed sequence. A terminal batch/result inconsistency is a non-qualifying completed failure.

## Evaluation rules

- Per source, scan the full ordered completed-event sequence. The first adjacent pair of qualifying current-config attempts sets sticky `hasQualifiedCurrentConfig=true` and `qualifiedAt` to the second completion. Any failure, config mismatch, missing observation, or invalid result breaks adjacency before qualification.
- Qualification is sticky only for the current config. A config change naturally resets it. After qualification, failure does not revoke eligibility or last-known jobs.
- Health is current: HEALTHY only when the latest two completed events are qualifying. After a failure, one success is still DEGRADED; two adjacent recovery successes restore HEALTHY.
- A multi-source company publishes only when **all** current staged sources qualify. Never use `some()`.
- A company also remains `VERIFYING` when any canonical SOCIAL source with an official entry/chain has no current staged plan, even if its staged subset has qualified. This is derived from canonical source identities, never a company-name exception. It prevents a partially automated official-source set (for example, one executable page plus one still-pending official page) from being counted as a stable complete company. Only when every canonical official SOCIAL source is staged and every staged source qualifies may the company become `PUBLISHING`.
- Company state priority:
  1. exact user-authorized exclusions -> `USER_AUTHORIZED_PHASE1_EXCLUSION`;
  2. exact no-public-link status -> `NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME`;
  3. staged plans -> `PUBLISHING` only when all qualify, otherwise `VERIFYING`;
  4. no plan but canonical SOCIAL source has official entry and official-chain URL -> `OFFICIAL_LINK_ONLY`;
  5. otherwise `VERIFYING`.
- PUBLISHING companies expose all their staged source ids as eligible. PUBLISHING health is HEALTHY only when all sources are healthy, else DEGRADED. Other states are NOT_APPLICABLE.
- Return canonical company identity, official website, a deterministic official careers link from canonical sources when present, staged/eligible source ids, qualified/last-attempt/last-success times, reason code, and global eligible ids/count maps.

## TDD minimum

Capture RED before implementation. Cover at least:

- 0/1/2 successes; success-failure-success; two successes then failure; one/two recovery successes;
- zero-observation terminal failure breaks adjacency;
- old/current config reset and config mismatch inserted between successes;
- every result/observation boolean/state/count/cardinality/tuple/stable-field failure closes eligibility;
- exact official 0/0/0 succeeds while 0/null and mismatched positive totals fail;
- two-source all-of rule; exclusion/no-link/link-only/verifying priority;
- input permutation stability and duplicate attempt rejection;
- repository performs exactly one query, explicitly excludes manual/null kinds, derives its own canonical plans/hashes, keeps all 60 when rows are absent, ignores extra unplanned rows, and dynamically reduces state counts;
- staged success with empty strict-oracle tuple fields can qualify, proving the corrected boundary.

Run:

`npx vitest run tests/domain/publicationEligibility.test.ts tests/db/publicationEligibilityRepository.test.ts --maxWorkers=2 --minWorkers=2`

Then `npm run typecheck` and `git diff --check`.

Commit only scoped files with message `feat: derive company publication eligibility`. Report RED/GREEN evidence, commit, files, and concerns. Return status, commit, tests, and concerns.
