# P0 Staged Launch and Release Evidence Plan

> **Controlling plan:** This plan supersedes every 2026-07-09 and 2026-07-10 data-completion, source-patching, fresh-crawl, and release-readiness plan. Superseded plans remain immutable historical evidence and are not completion evidence.
>
> **Controlling PRD scope:** Exactly 30 foreign pharmaceutical companies plus exactly 30 domestic pharmaceutical companies, with no substitutions. All 60 remain visible in the company directory. Job publication is decided per company and covers only publicly reachable social-recruitment scope supplied by an official website, official careers page, or recruitment system explicitly endorsed by one of those sites.
>
> **Per-company publishing rule:** A failed, incomplete, or pending company cannot publish automatic jobs, but it does not block another eligible company's publication. The current completion target is at least 55 companies with two consecutive verified rounds. Routine daily publication has no global company-count switch: each currently eligible company continues updating independently. A company without a public official careers link remains visible as `NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME`. The two exact `USER_AUTHORIZED_PHASE1_EXCLUSION` records remain roster members and never imply complete job coverage.
>
> **Evidence state:** Prior `TRUST_FREEZE`, Phase 0-3, and RC008 artifacts remain historical evidence for unchanged behavior only. They do not prove current deployment or current job data. Current claims require the fresh, proportionate evidence defined by the active stages below.

**Goal:** 上线 Job Finder 一期：固定 30 家外资药企和 30 家国内药企全部进入官方招聘目录；只展示来源可验证的官方职位，每天北京时间 00:01 独立更新，单家公司失败不影响其他公司；人福医药、华北制药保留并标记为用户授权一期排除；推进到至少 55 家公司连续两轮验证通过并稳定自动更新。

**Active Goal:** `019f4b10-36e1-75e0-8586-1e4beec344ee`

**Runtime Goal synchronization (2026-07-16):** The Goal service and this plan now use the same at-least-55 completion target. Daily publication remains independent per company; one currently verified company can update without waiting for the other companies. `job.orz.md`, AI classification, and auxiliary translation are not release blockers.

**Resumed from Goal:** `019f4295-1a92-7202-8e38-1bdd8cec8351`

**Staged-launch contract (2026-07-13 user-authorized override):**

- The roster is immutable: exactly 30 foreign plus 30 domestic pharmaceutical companies. `company-humanwell` and `company-north-china-pharma` stay in the roster as user-authorized Phase 1 exclusions, and their job completeness is not claimed.
- Every company appears in the directory. Allowed truthful states include verifying, official-link-only, no public official careers link at capture time, and user-authorized exclusion.
- A company becomes eligible for automatic job publishing only after two consecutive successful, stable crawls of its publicly reachable official social-recruitment scope. Eligibility and threshold counts are calculated from records; no hard-coded pass count is valid.
- The current Goal completes only when at least 55 companies are stably auto-updating after two consecutive verified rounds. Daily publication remains per-company even when the current total later falls below 55.
- One scheduled crawl runs daily at 00:01 China time. A complete success expires after 30 hours; explicit source failure hides that company's jobs immediately while preserving stored records.
- Last-success timestamps, failed-crawl non-deletion, search, official outbound links, basic security/privacy, backup/restore, monitoring, deployment, and final independent read-only QA remain release requirements.
- After the rule and company configuration are frozen, run exactly two fresh scheduled-scope rounds. If the second round still leaves fewer than 55 stable companies, pause the task and notify the user; do not start a third round or lower the threshold.
- `job.orz.md`, AI classification, auxiliary translation, advanced manual operations, cryptographic oracle/signature work, independent QA after every stage, and rebuilding all evidence after every change are explicitly non-blocking. Existing implementations may remain; unavailable enrichment falls back to official original titles and basic categories.
- A second, independently implemented field-by-field parser that defeats synthetic in-process payload/evidence substitution is post-launch hardening, not an initial-release gate. The actual sealed production fetch path must still bind every published job to an allowed official source, and final QA must sample fresh-round titles, locations, and outbound URLs against the archived official response; release notes must not claim adversarial per-field replay coverage that was not implemented.

**Official-source boundary:** Published jobs may come only from official websites, official careers pages, or recruitment systems explicitly endorsed by those sites. Search engines, ATS discovery, and third-party job boards may provide leads but never published job records. The completeness claim is limited to publicly reachable social-recruitment scope linked or endorsed by the official site at capture time; it does not cover hidden ATS tenants, WeChat-only postings, or unendorsed third-party channels.

**Historical recovery point:** `outputs/p0-rc/p0-rc-20260710-001/`

**Execution method:** Use systematic debugging for anomalies, TDD for behavior changes, per-company fail-closed publishing eligibility, change-impact-based evidence refresh, and final independent read-only QA. Evidence gaps are reported as facts, hypotheses, validation paths, and temporary containment only.

## Goal execution index

This index is the controlling execution order. At most one stage may be `IN_PROGRESS`; historical Phase 0-3 headings later in the document are evidence records and are not active stages.

| Phase | Scope | Status | Exit evidence |
| --- | --- | --- | --- |
| 1 | Goal and document sync | COMPLETED | PRD and this controlling plan carry the exact staged Goal and contain no active all-or-nothing release rule |
| 2 | Fresh code/test/data/deployment baseline | COMPLETED | Current Git, test, data, deployment, and operational facts recorded without treating historical artifacts as current proof |
| 3 | Per-company publishing eligibility and truthful directory states | COMPLETED | All 60 companies visible; official-source-only publishing; two-crawl eligibility derived from records; exclusions disclosed |
| 4 | Two fresh crawl runs and a 60-company status table | IN_PROGRESS | Two fresh run records plus one table covering every roster company, its evidence-derived state, and last-success timestamp |
| 5 | Release-candidate operational rehearsal | PENDING | Verified subset with daily 00:01 schedule, search, official links, security/privacy, backup/restore, monitoring, and failure-safe lifecycle checks |
| 6 | At least 55 stable companies and release candidate | PENDING | Record-derived eligible-company count is at least 55; after two fresh rounds a lower count pauses the task and notifies the user |
| 7 | Final independent read-only QA and Goal completion | PENDING | Independent QA validates staged rules, operational evidence, official-source-only jobs, and the final 60-company table |

Only one stage may be `IN_PROGRESS`. A stage advances only after its own exit evidence exists; unchanged historical evidence may be reused when its applicability is explicitly verified.

## Historical G1-G9 baseline

The table below preserves the prior all-or-nothing RC assessment as historical evidence. Its non-`PASS` rows do not block the staged public beta or replace the active stage gates above; they may support only unchanged behavior after applicability is checked.

| Gate | Baseline | Reason |
| --- | --- | --- |
| G1 scope consistency | PARTIAL_PENDING_SCOPE_DELTA | RC008 establishes the fixed 30 foreign plus 30 domestic roster with no replacements, but predates the 2026-07-13 authorization and does not prove dynamic exclusion behavior. G1 requires RED-GREEN policy tests and exact changed-code RC evidence before it can pass. |
| G2 official chain and coverage | PARTIAL_PENDING_FORMAL_CRAWL | RC008 preserves the reviewed official-link model and source-chain evidence. Final evidence still requires capture-time coverage for every dynamically in-scope company. The two authorized exclusions receive no company-level official-entry/source/completeness review; only the global exclusion-policy mechanics and final disclosure are verified. |
| G3 provable crawl completeness | PARTIAL_ENGINEERING_PASS | RC008 preserves passing batch, provenance, transaction, pagination, loss-accounting, and verifier implementation evidence. Completeness remains unproven until the formal dynamically scoped crawl batches pass. |
| G4 two formal rebuilds | PENDING | Two completed immutable formal batches for the dynamically derived denominator are not yet final-RC evidence. |
| G5 classification/translation/lifecycle | PARTIAL_RC008_EVIDENCE | Lifecycle engineering evidence is preserved; final AI classification, translation, correction, and real-data closure remains in progress. |
| G6 user product | PARTIAL_RC008_EVIDENCE | Existing product/build evidence is reusable, but final acceptance must run against the exact changed-code/formal-crawl RC and its database. |
| G7 admin/operations | PARTIAL_RC008_EVIDENCE | Existing worker/admin/monitoring engineering evidence is reusable; final real-operational closure remains pending. |
| G8 production/security/compliance | PARTIAL_RC008_EVIDENCE | RC008 image, empty-DB, backup/restore, edge, and bounded runtime evidence is preserved. Remaining deployment, notifier, scheduler, privacy, and compliance gates exclude only `job.orz.md`-specific DNS/certificate/external-access checks; equivalent checks for any other deployed endpoint remain required. |
| G9 engineering/independent QA | PARTIAL_RC008_EVIDENCE | RC008 engineering and independent QA evidence remains reusable, but final changed code and formal crawls require fresh exact-RC-bound independent QA for every dynamically in-scope company plus global exclusion-policy/disclosure verification. The excluded companies receive no company-level source/completeness QA. |

The superseded rule that every row had to become `PASS` before any launch is not active. Current Goal completion follows the per-company eligibility, at-least-55, operational, and final-QA gates in this plan.

---

## Global invariants

1. No historical green report, mixed-batch observation, adapter `SUCCESS`, or count-only equality proves a current company eligible or a deployment current.
2. Published jobs come only from an official website, official careers page, or recruitment system explicitly endorsed by one of those sites. Tavily, Agent Reach, search engines, ATS tenant discovery, and third-party job boards are discovery inputs only.
3. The immutable roster remains exactly 30 foreign plus 30 domestic pharmaceutical companies with no substitutions. All 60 appear in the directory.
4. `company-humanwell` and `company-north-china-pharma` remain roster members marked `USER_AUTHORIZED_PHASE1_EXCLUSION`; no job-completeness claim is made for either.
5. A company is eligible for automatic job publishing only after two consecutive successful, stable crawls cover its publicly reachable official social-recruitment scope. Eligibility and all thresholds are calculated from records, never hard-coded as pass results.
6. A blocked or pending company blocks only its own automatic job publication. Before first launch, the release candidate remains internal-only below 45. After the initial release gate passes, routine publication has no global minimum: a later drop below 45 triggers repair and alerting but does not hide other eligible companies.
7. Companies not yet eligible stay visible with a truthful state such as verifying, official-link-only, no public official careers link at capture time, or user-authorized exclusion.
8. No failed, incomplete, blocked, skipped, stale, or non-atomic crawl may drive lifecycle removal. Preserve the last successful timestamp and previously verified jobs according to lifecycle rules.
9. A change invalidates only evidence materially affected by that change. Preserve traceability and rerun impacted checks; do not require a new full evidence rebuild for unchanged gates.
10. AI classification, auxiliary translation, advanced manual operations, cryptographic oracle/signature work, every-stage independent QA, and `job.orz.md` work are non-blocking. Original titles and basic categories are the required fallback.
11. Daily 00:01 China-time scheduling, 30-hour freshness enforcement, search, official outbound links, basic security/privacy, backup/restore, monitoring, deployment, and final independent read-only QA remain mandatory release requirements.
12. No PRD business rule may be weakened to make a technical gate pass.

## Preserved Phase 0-3 historical evidence

The following Phase 0-3 records are retained as historical evidence for unchanged behavior. They do not override the active staged-launch rules and do not prove current code, deployment, database contents, or job freshness.

## Phase 0 - Freeze and restore a reproducible environment

### 0.1 Freeze the inherited workspace

- Record `git HEAD`, branch, complete porcelain status, tracked/untracked counts, and diff stat without modifying or staging inherited changes.
- Hash the lockfile, Prisma schema/migrations, company registry, source-plan/config, crawler adapters, readiness rules, and controlling plan.
- Record the inherited audit baseline separately from newly observed facts.
- Create a unique RC directory and immutable manifest skeleton. Do not overwrite prior reports.

### 0.2 Restore infrastructure without destroying evidence

- Probe Docker daemon, compose services, PostgreSQL port 5432, database connectivity, schema version, and database size.
- Before migration, backfill, seed, lifecycle update, or crawl, inventory Docker volumes and take a restorable PostgreSQL dump plus volume metadata.
- Restore the backup into a separate test database and run a checksum/count smoke test before accepting the backup.
- Record backup path/hash, restored database hash, schema migration state, source set, config hash, and runtime versions in the RC manifest.

### 0.3 Phase gate

- Reproducible environment facts are captured by commands and artifacts, not conversation memory.
- DB changes are prohibited until backup restore is proven.
- If shell, Docker, or DB probing is blocked, keep `TRUST_FREEZE` and record the blocker; do not continue to a crawl.

## Phase 1 - Repair gates and the evidence model before crawling official website-linked sources

All behavior changes follow RED-GREEN-REFACTOR.

### 1.1 Batch identity and success semantics

- A `CrawlBatch` starts `RUNNING` and reaches `SUCCESS` only after every planned source atomically commits a completeness-verified result.
- Persist and report separate `transportSuccess`, `adapterSuccess`, and `completenessVerified` states. `INCOMPLETE` is never a complete source.
- Persist `rcId`, `batchId`, `commitSha`, `sourcePlanHash`, `sourceConfigHash`, `adapterVersion`, `startedAt`, and `finishedAt` on every observation.
- A full batch records its exact planned source IDs and rejects skipped, extra, missing, or config-mismatched sources.

### 1.2 Atomic source commit

- Commit observation, normalized job-set replacement/upserts, lifecycle transitions, audit counters, and batch source status in one database transaction.
- Add fault-injection tests proving interruption cannot leave jobs without an observation or an observation without its complete job set.

### 1.3 Readiness provenance

- Readiness accepts only all observations for the dynamically derived audited official website-linked social-recruitment denominator from the same completed full batch, RC, commit, source-plan hash, and source-config hash, together with exact company-level audit/no-link adjudication for every dynamically in-scope company and global exclusion-policy/roster-disclosure evidence. The excluded companies receive no company-level official-entry, source, channel, or completeness audit.
- Enforce a documented freshness limit and reject historical-observation stitching.
- Require two completed full batches from the same RC for final release evidence.
- Compare canonical job-key sets and hashes in addition to counts.

### 1.4 Loss accounting and pagination proof

- Persist `rawCount`, `parsedCount`, `validCount`, `dedupeInputCount`, `dedupeOutputCount`, collision groups, and every discard reason.
- Standard pagination telemetry records requested/returned cursor or offset, response fingerprint, page job-ID set/hash, declared total, next-page signal, and termination reason.
- Fail closed on repeated pages, non-advancing cursor/offset, unchanged job-ID sets with a claimed next page, unstable official totals, intermediate empty pages, or max-page exhaustion while a next page remains.
- Every adapter gets a regression fixture where page 1 is valid but incomplete.

### 1.5 Evidence truthfulness

- `OFFICIAL_TOTAL_COUNT` requires an archived official raw response/page and extraction coordinates. Hard-coded constants, `jobs.length`, configured channel count, or adapter self-calculation cannot use this label.
- Official-chain evidence archives the company page, outgoing link or redirect chain, final ATS URL/tenant, timestamps, response hashes, and screenshots/raw responses where appropriate.
- ATS existence alone is discovery, not ownership proof.

### 1.6 Phase gate and review

- Targeted tests, complete test suite, typecheck, build, Prisma validation, and migration validation pass.
- Request code review and launch a new independent, read-only QA agent that did not implement Phase 1.
- All P0/P1 findings create a single-hypothesis TDD repair before Phase 2.

## Phase 2 - Restore the company, source, and channel model

### 2.1 Strict roster

- Restore the user-confirmed, immutable 30 foreign + 30 domestic pharmaceutical roster.
- Remove replacement semantics from P0 readiness. Record excluded device, diagnostics, life-science-tool, medtech, and consumer-health companies outside the 60-company target set.
- Preserve `company-humanwell` and `company-north-china-pharma` inside that roster. The later 2026-07-13 scope contract requires `USER_AUTHORIZED_PHASE1_EXCLUSION` and canonical-ID/status-driven denominator selection; its implementation/evidence belongs to Phase 4 and is not claimed by the completed pre-delta Phase 2 evidence.
- Log the roster decision source and hash in the RC manifest and PRD/spec change history.

### 2.2 Expected official website-linked recruitment entries

- Model a company-level expected set of recruitment entries that are publicly linked or explicitly endorsed by the company's official website at capture time. The expected set can contain zero or more social sources, brands, legal entities, business units, ATS tenants, pages, APIs, filters, and channels reachable from those official links.
- Each source/channel records social/campus classification, include/exclude reason, China scope, official backlink or redirect evidence, adapter kind, and independent oracle status.
- A source may not silently stand in for another recruitment entry that is publicly linked or explicitly endorsed by the official company website. The oracle does not need to prove that no unlinked, hidden, third-party, or WeChat-only social recruitment paths exist.

### 2.3 Mandatory investigations

- CSPC: independently prove whether official-website-linked Redsea channels are social, whether campus roles are excluded, and whether each included channel is reachable from an official website link or redirect chain.
- Workday/Phenom: archive unfiltered, China-facet, locale, keyword, and business-unit count comparisons inside the official website-linked entry; prove filters are not narrower than the intended China social scope for that entry.
- A company with no public official-website-linked social recruitment entry remains in the fixed roster as `NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME`, with capture evidence and timestamp.

### 2.4 Phase gate and review

- Produce a human-readable 60-company roster and machine-readable official-link source/channel oracle seed. Both must disclose the two exact authorized exclusions and must not claim their jobs or official-entry coverage are complete.
- Request code review and an independent read-only roster/source-chain QA for dynamically in-scope companies. The authorized exclusions receive no company-level official-entry, source, or completeness QA; review is limited to the global policy mechanics and required release disclosure.

## Phase 3 - Restore PRD lifecycle semantics

### 3.1 Required behavior

- First verified successful miss: retain visible `ACTIVE` job with miss count 1.
- Second verified successful miss: hide job and mark `SUSPECTED_OFFLINE` with miss count 2.
- Third verified successful miss: remain hidden and mark `OFFLINE` with miss count 3.
- Failed, incomplete, blocked, skipped, or non-atomic crawls do not increment misses.
- A reappearing job resets its miss count and returns to visible `ACTIVE`.

### 3.2 Correct data-quality invariant

- Validate `activeVisibleSet = latestVerifiedCrawlSet + legalFirstMissGraceSet`.
- Do not require mechanical equality between latest structured count and active visible count.
- Persist the grace-set IDs/hash and prove every extra visible job is exactly one verified miss old.

### 3.3 TDD matrix

- RED-GREEN tests cover first, second, third miss; failed crawl; incomplete crawl; blocked crawl; and reappearance.
- Integration tests cover source transaction rollback and data-quality set reconciliation.

### 3.4 Phase gate and review

- Request code review and independent read-only verification of PRD lifecycle behavior.

## Active Stage 1 - Goal and document sync

- Put the exact staged Goal in the PRD and this controlling plan.
- Remove active all-or-nothing rules while preserving historical Phase 0-3 and RC008 evidence for unchanged behavior.
- Verify both documents for fixed 30+30 scope, the two authorized exclusions, per-company publication, at least 55 stable companies, daily 00:01 updates, 30-hour freshness, the two-round stop condition, official-source-only jobs, and explicit non-blocking enrichment/`job.orz.md` language.
- Exit with a documentation-only commit and a report that records commands and concerns. This stage is complete once the controlling index marks it `COMPLETED`.

## Active Stage 2 - Fresh code/test/data/deployment baseline

- Record current Git state, runtime versions, code/test results, database facts, crawl records, deployment state, scheduler state, backup/restore state, monitoring state, and privacy/security state before making readiness claims.
- Verify which Phase 0-3 and RC008 artifacts still bind to unchanged behavior. Treat them as historical support only; do not claim they prove current deployment or data.
- Use change-impact analysis to identify affected evidence. Refresh affected checks and preserve valid unchanged evidence rather than rebuilding every historical artifact after every change.
- Report blockers by stage and company without converting missing evidence into a passing state.

## Active Stage 3 - Per-company publishing eligibility and truthful directory states

- Keep exactly 30 foreign plus 30 domestic roster records with no substitutions, and display all 60 in the directory.
- Preserve `company-humanwell` and `company-north-china-pharma` as `USER_AUTHORIZED_PHASE1_EXCLUSION` and make no job-completeness claim for either.
- Derive each company's state from records. Supported public states include verifying, official-link-only, `NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME`, eligible/auto-updating, and user-authorized exclusion.
- Supply published jobs only from official websites, official careers pages, or recruitment systems explicitly endorsed by those sites. Discovery-only sources cannot publish jobs.
- Require two consecutive successful, stable crawls of the company's publicly reachable official social-recruitment scope before automatic publication. A failed or pending company affects only itself.
- When AI classification or auxiliary translation is unavailable, publish otherwise eligible jobs with the official original title and a basic category.

## Active Stage 4 - Two fresh crawl runs and a 60-company status table

- Keep the perpetual production scheduler stopped during first-launch qualification. Invoke `npm run p0:staged-crawl -- --force` exactly twice against the isolated release-candidate database, then evaluate readiness. Enable the daily scheduler only after the initial release gate passes.
- Create the immutable `BUILDING` release-candidate row only through the current-image bootstrap command after exact migration/checksum validation. While that row remains `BUILDING`, the crawl entry point must reject a third `SCHEDULED` batch and any prior batch whose identity drifts from the current candidate.
- Run two fresh scheduled-scope crawl rounds and retain run identity, company/source scope, start/finish time, outcome, counters, evidence location, and last-success timestamp.
- For each company being considered for automatic publication, prove that its two most recent qualifying observations are consecutive, successful, stable, and cover its publicly reachable official social-recruitment scope.
- A failed, incomplete, blocked, or skipped observation cannot qualify the company and cannot delete previously verified jobs. Preserve passing evidence for other companies.
- Produce one 60-company table containing roster group, company ID/name, official website/recruitment entry, publishing state, exclusion/no-link disclosure, qualifying run IDs, last success, job count where applicable, and evidence path.
- Calculate roster totals, exclusions, eligible-company count, and the at-least-55 threshold from records. Do not hard-code a passing count.
- After the changed rules and company configuration are frozen, execute exactly two fresh rounds. If the second round still produces fewer than 55 stable companies, pause and notify the user without starting a third round.

## Active Stage 5 - Release-candidate operational rehearsal

- The currently eligible subset may be rehearsed in an isolated release-candidate environment. Goal completion still requires the at-least-55 threshold.
- Show all 60 companies and their truthful state. Expose jobs only for companies that pass per-company publishing eligibility, and make every job link traceable to an allowed official source.
- Run and verify one update each day at 00:01 Beijing time with one scheduling owner and overlap protection. Show a truthful last-success timestamp, expire it from publication at 30 hours, and do not advance it on failure.
- Verify city/search behavior, official outbound links, failed-crawl non-deletion, lifecycle behavior, deployment, basic application security, privacy/terms, backup creation and restore-to-test, monitoring, and real alert delivery.
- AI classification, auxiliary translation, advanced manual operations, cryptographic oracle/signature work, every-stage independent QA, and `job.orz.md` DNS/certificate/external-access work remain non-blocking. Preserve existing implementations but use official-title/basic-category fallback when enrichment is unavailable.
- Record the deployed revision, data snapshot/run IDs, endpoint, operational check evidence, known company-level gaps, and rollback/containment path without treating historical RC008 as current deployment proof.

## Active Stage 6 - At least 55 stable companies and release candidate

- Continue company-by-company source adaptation, verification, and daily 00:01 operation after the internal candidate preview without replacing roster members or lowering the two-consecutive-crawl rule.
- Compute the eligible stable auto-updating count from current company, source, and observation records. Formal Phase 1 completion requires this count to be at least 55.
- Keep every remaining company in the directory with a truthful state and a next investigation or maintenance action. Those companies continue as post-launch work and do not block formal completion after the threshold is reached.
- After release is approved, keep daily publication strictly per-company. A later total below 55 is an operational incident to alert and repair, not a switch that clears successful companies from search.
- Preserve company-level failure evidence and previously passing companies; do not reset the entire program or rebuild unrelated evidence for a local source change.

## Active Stage 7 - Final independent read-only QA and Goal completion

- Use an independent read-only reviewer that did not implement the final changes and cannot modify code, database, deployment, or evidence.
- Verify the exact 30+30 roster with no substitutions; all 60 directory states; explicit `USER_AUTHORIZED_PHASE1_EXCLUSION` disclosure for `company-humanwell` and `company-north-china-pharma`; and no completeness claim for either exclusion.
- Recalculate from records that at least 55 companies have two consecutive successful, stable qualifying crawls and are auto-updating. Sample published jobs and trace each to an allowed official source; investigate all known incident, low-count, no-total, or changed-adapter cases that can affect the completion claim.
- Verify the two fresh crawl runs, final 60-company status table, daily 00:01 scheduler, 30-hour freshness and truthful last-success behavior, failed-crawl non-deletion, search, official outbound links, deployment, security/privacy, backup/restore, monitoring, and alert evidence.
- Record reviewer identity, revision, database/data snapshot, run IDs, evidence paths, findings, and disposition. Confirmed material findings repair only the affected behavior/evidence and trigger proportionate retesting; they do not automatically require every unchanged stage to be rebuilt.

## Final staged-release gate

The exact phrase `PRD Phase 1 complete` and the first external release are prohibited unless current evidence proves all of the following:

- The roster is exactly 30 foreign plus 30 domestic pharmaceutical companies with no substitutions, and all 60 appear in the directory with truthful states.
- `company-humanwell` and `company-north-china-pharma` are disclosed as user-authorized Phase 1 exclusions, with no job-completeness claim.
- At least 55 companies, counted dynamically from records, have two consecutive successful stable crawls of their publicly reachable official social-recruitment scope and are auto-updating.
- Every published job sampled or checked traces to an official website, official careers page, or recruitment system explicitly endorsed by one of those sites.
- Two fresh crawl runs and the final 60-company table support the current state; pending companies remain visible and do not block completion.
- Daily 00:01 China-time scheduling, 30-hour freshness, last-success timestamps, failed-crawl non-deletion, search, official outbound links, deployment, basic security/privacy, backup/restore, monitoring, real alerts, and final independent read-only QA pass.
- AI classification, auxiliary translation, advanced manual operations, cryptographic oracle/signature work, every-stage independent QA, `job.orz.md`, and full evidence reconstruction after every change are not required to pass. Official-title/basic-category fallback works where enrichment is unavailable.

## RC008 historical evidence preservation after the staged-launch authorization

- RC008's already-passed code, image, database, empty-database, backup/restore, edge/security, and independent-QA artifacts remain immutable historical, reusable evidence for unchanged gates.
- This controlling-plan update by itself does not create a new RC and does not require rerunning an unchanged passed gate.
- Historical RC008 evidence may support unchanged behavior only after applicability is checked. It may not self-certify current deployment, current data, staged per-company publishing eligibility, the at-least-45 count, or the two fresh crawl runs.
- Future changes invalidate and refresh only materially affected evidence. Preserve revision/data/run traceability, but do not rebuild unrelated historical evidence solely because one component or company changed.

## Current baseline and immediate next action

- Active Stage 4, two fresh crawl runs and a 60-company status table, is the sole `IN_PROGRESS` stage. Active Stages 1-3 are complete and Active Stages 5-7 are `PENDING`.
- Historical Phase 0-3 and RC008 evidence remains preserved for unchanged behavior but is not current deployment/data proof.
- The immutable roster remains exactly 30 foreign plus 30 domestic companies. 人福医药 (`company-humanwell`) and 华北制药 (`company-north-china-pharma`) remain roster members as exact `USER_AUTHORIZED_PHASE1_EXCLUSION` records without job-completeness claims.
- The frozen `p0-rc-20260715-010` candidate already completed its exact two permitted Stage 4 rounds and produced 12 record-derived stable companies against the 45-company first-launch threshold. It remains historical failed-candidate evidence; no third crawl may run against it, and it is not an external release.
- The user's 2026-07-15 continuation authorizes a new repair cycle. Preserve the prior candidate, image, backup/restore, isolated-database, and independent-review evidence; diagnose and repair only the affected company/source and summary behavior using tests first. After the fixes and configuration are frozen, create a new candidate and run exactly two new rounds. If that new candidate remains below 45 after its second round, pause and notify the user without a third round.

## RC011 outcome and RC012 authorization (2026-07-15)

- Frozen candidate `p0-rc-20260715-011` completed exactly two scheduled qualification rounds and produced 22 record-derived stable companies against the 45-company first-launch threshold. It is `INVALIDATED`, remains immutable historical evidence, and may never run a third round.
- The 60-company status after RC011 is 22 `PUBLISHING`, 31 `VERIFYING`, 5 `OFFICIAL_LINK_ONLY`, and 2 `USER_AUTHORIZED_PHASE1_EXCLUSION`. This is not an external release.
- The user explicitly authorized a new repair candidate after reviewing the RC011 pause. Preserve RC011's image, database, two batches, pause bundle, company table, backup/restore evidence, and independent review.
- RC012 work starts from the frozen RC011 code revision. Diagnose the non-publishing companies from RC011 evidence, repair affected source behavior with RED tests first, and freeze a new image and isolated candidate only after code review passes.
- After RC012 code and source configuration are frozen, run exactly two new qualification rounds. At least 45 record-derived stable companies permits final deployment and independent release QA; fewer than 45 pauses again without a third round.
- The 45-company threshold remains an initial external-launch gate only. After a release passes it, daily 00:01 publication remains per company: a healthy company updates independently and a failed company does not suppress other companies.

## RC014 baseline and RC015 at-least-55 continuation (2026-07-16)

- Deployed RC014 remains the immutable 50-company stable baseline and is not mutated while RC015 is built and qualified in isolation.
- RC015 repairs or adds at least five independently profile-bound official sources. Company-specific source, scope, pagination, failure, and completeness rules live in that company's recruitment profile or dedicated adapter/verifier; shared crawl code must not acquire company identifiers or scattered company exceptions.
- After RC015 code and source configuration are frozen and its isolated database passes a fresh PostgreSQL 16 backup/restore comparison, run exactly two new full scheduled-scope qualification rounds.
- Goal completion requires at least 55 record-derived eligible companies in both RC015 rounds. Fewer than 55 after round two pauses the candidate without a third round. Successful companies continue publishing independently after release.
