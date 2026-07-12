# P0 Recovery and Release Evidence Plan

> **Controlling plan:** This plan supersedes every 2026-07-09 and 2026-07-10 data-completion, source-patching, fresh-crawl, and release-readiness plan. Superseded plans remain immutable historical evidence and are not completion evidence.
>
> **Controlling PRD scope:** Exactly 30 foreign pharmaceutical companies plus exactly 30 domestic pharmaceutical companies. A target company may not be replaced merely because its public recruitment surface is difficult to crawl. Job completeness is judged only inside recruitment entries that are publicly linked or explicitly endorsed by the company's official website at capture time.
>
> **Blocked-company rule:** A target without a public official-website-linked social recruitment entry remains in the roster with `NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME`; it is never replaced to make readiness green, and that no-link status is not by itself a crawl-completeness blocker. Except for the two exact `USER_AUTHORIZED_PHASE1_EXCLUSION` records defined below, a target with a public official-website-linked social recruitment entry that cannot be completely crawled remains blocked until that entry passes the evidence gate. The exclusions remain roster members and never imply complete job coverage.
>
> **Trust state:** `TRUST_FREEZE` / data confidence D. No job-count, readiness, launch, or manual-review claim is valid until a release candidate (RC) satisfies every gate in this plan.

**Goal:** Produce a clean, reproducible P0 release candidate whose code, database, two full official-link crawl batches, independent official-link oracle, QA report, and production-operability evidence all bind to one immutable manifest.

**Active Goal:** `019f4b10-36e1-75e0-8586-1e4beec344ee`

**Resumed from Goal:** `019f4295-1a92-7202-8e38-1bdd8cec8351`

**Goal objective (as overridden by the 2026-07-13 user authorization):** 完成 Job-search PRD 一期的端到端生产上线：严格保留用户确认的 30 家外资医药企业和 30 家国内制药企业固定名单；对该固定名单中除 `company-humanwell` 与 `company-north-china-pharma` 两项用户授权一期排除企业之外的所有目标企业，建立可独立证明公司官网招聘链接内社招职位完整性的官方招聘 source/channel 数据链路；实现准确职位抓取、AI 岗位分类、英文标题中文辅助翻译、生命周期、搜索聚合、后台运营、安全反爬、隐私、部署、备份、监控和每日两次调度；通过同一可复现 RC 下的全量验证与独立 QA。不得用替换企业、硬编码通过数量、放松门禁、历史绿灯或生产 adapter 自证来完成目标。该完整性判断不要求证明公司不存在其它未由官网公开链接或明确背书的社招渠道。本期不以 `job.orz.md` 的域名解析、证书或外部可访问性作为 Goal、部署门禁或最终交付条件。

**Goal judgment standard update (2026-07-12):** For each target company, completion evidence covers the social-recruitment jobs visible from official website-linked recruitment entries only. The denominator is the audited inventory of official website links, redirects, ATS tenants, pages, APIs, filters, and channels reachable from those entries at capture time. The release claim must not imply coverage of hidden ATS tenants, WeChat-only postings, third-party boards, regional legal-entity channels, or other recruitment paths that are not publicly linked or explicitly endorsed by the official company website.

**Goal judgment standard update (2026-07-13, user-authorized override):** The immutable roster remains exactly 30 foreign pharmaceutical companies plus exactly 30 domestic pharmaceutical companies. The canonical company IDs `company-humanwell` and `company-north-china-pharma` remain in that roster but MUST be marked `USER_AUTHORIZED_PHASE1_EXCLUSION`. They are dynamically excluded by company identity and status from Phase 1 official-entry completeness, the formal crawl denominator, independent source/channel QA, and release blocking. Their jobs MUST NOT be claimed complete. Every other roster company (58 under this exact authorization) remains in scope for official-website-linked or explicitly endorsed social-recruitment completeness. The number 58 is descriptive evidence derived from the roster and exclusion records, not a hard-coded passing threshold; all code and gates MUST calculate the denominator dynamically. `job.orz.md`, its DNS, certificate, and external-access state are fully outside this Goal, its deployment gate, and its final deliverable; all other deployment, application-security, backup, monitoring, scheduler, privacy, and compliance requirements remain in force.

**Recovery point:** `outputs/p0-rc/p0-rc-20260710-001/`

**Execution method:** Use systematic debugging for every anomaly, TDD for every behavior change, fail-closed evidence gates, and an independent read-only QA agent after each major recovery stage. Evidence gaps are reported as facts, hypotheses, validation paths, and temporary containment only.

## Goal execution index

This index is the controlling execution order. Detailed requirements later in this document are assigned to these phases even where older section headings retain historical numbering.

| Phase | Scope | Status | Exit evidence |
| --- | --- | --- | --- |
| 0 | Goal/RC baseline and reproducible environment | COMPLETED | Git/runtime hashes, pre-mutation backup, successful restore-to-test, DB snapshot, manifest authorization |
| 1 | Batch, evidence, transaction, pagination, official-chain, and readiness gates | COMPLETED | RED-GREEN tests, migrations, full engineering checks, independent read-only review |
| 2 | Strict 30+30 roster and official-link source/channel model before the 2026-07-13 scope delta | COMPLETED | Human-readable roster, machine official-link oracle seed, official-chain archive, no unauthorized replacements |
| 3 | PRD lifecycle and grace-set data-quality invariants | COMPLETED | 1/2/3 miss, failure/incomplete, reappearance, transaction, and set-reconciliation tests |
| 4 | 2026-07-13 dynamic scope-delta implementation plus AI classification, translation, durable human corrections, and manual crawl worker | IN_PROGRESS | RED-GREEN scope-policy tests, exact changed-code RC evidence, and real queue/worker/DB evidence |
| 5 | Two formal complete official-link rebuild batches in one RC | PENDING | Two immutable completed batches and fresh zero-blocker DB gates |
| 6 | Real-DB product and admin acceptance | PENDING | Product/admin workflows and browser matrix evidence against the RC database |
| 7 | Deployment, security, backup, monitoring, scheduler, and compliance | PENDING | Production-operability tests and compliance sign-off evidence |
| 8 | Independent QA, repair loop, and final release evidence | PENDING | Independent oracle for every dynamically in-scope company, global exclusion-policy/disclosure verification, no P0/P1 findings, final 60-company table |

Only one phase may be `IN_PROGRESS`. A phase cannot advance until its exit evidence exists under the active RC.

## G1-G9 baseline

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

Goal completion is prohibited while any row is not `PASS` with fresh RC-bound evidence.

---

## Global invariants

1. No historical green report, mixed-batch observation, adapter `SUCCESS`, or count-only equality proves completeness.
2. Tavily, Agent Reach, search engines, ATS tenant discovery, and third-party job boards are discovery inputs only. Readiness evidence must be archived from the official company chain or the official recruitment system it endorses.
3. Every artifact lives under `outputs/p0-rc/<rcId>/` and references the RC manifest.
4. Any code, roster, source-plan, database, or oracle change invalidates the current RC and starts a new RC.
5. Any blocked official-website-linked social recruitment entry for a dynamically in-scope company blocks RC completion while preserving evidence for companies that passed. A company with no public official-website-linked social recruitment entry is retained in the 60-company roster with an explicit no-link status and does not create a crawl-completeness blocker. `company-humanwell` and `company-north-china-pharma` remain roster members marked `USER_AUTHORIZED_PHASE1_EXCLUSION`; they are excluded from this blocking rule without any claim that their jobs are complete.
6. The formal crawl/QA denominator is derived from the immutable roster minus records carrying the authorized exclusion status for the exact canonical company IDs above. Code, tests, manifests, and reports may not hard-code an expected passing company count.
7. No failed, incomplete, blocked, skipped, stale, or non-atomic crawl may drive lifecycle removal.
8. No PRD business rule may be weakened to make a technical gate pass.

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

## Phase 4 - Formal full-data rebuild

Under one RC, commit, roster hash, source-plan hash, source-config hash, schema version, and database snapshot lineage:

0. Before a formal crawl, implement the 2026-07-13 scope delta with RED-GREEN tests proving canonical-ID/status-driven exclusion, dynamic denominator derivation, absence of a hard-coded passing total, and truthful exclusion disclosure. RC008 predates this delta and cannot prove it; the implementation and tests must bind to the exact changed-code RC.
1. Run two complete full official-link crawl batches.
2. Each batch requires the planned denominator to equal the audited official website-linked social recruitment entry set dynamically derived from the fixed roster after applying exact `USER_AUTHORIZED_PHASE1_EXCLUSION` records, skipped 0, and 100% transport, adapter success, completeness, and atomic commit for that denominator. No expected passing total may be hard-coded.
3. Archive every official website-linked source's expected evidence, pagination proof, counters, collision/discard ledger, canonical job-key set/hash, active set/hash, and official-chain evidence.
4. Both batches must complete; data-quality must report zero blockers; readiness must consume only those batches.
5. Any blocked official website-linked social recruitment entry for a dynamically in-scope company blocks the RC. Preserve passing evidence and investigate through systematic debugging; do not replace the company, hard-code a total, relax a gate, or change lifecycle semantics. A no-public-official-link company status remains auditable roster evidence, not a crawl-completeness blocker. The two exact authorized exclusions are not researched, crawled, or counted as completeness blockers in Phase 1 and must never receive a job-completeness claim.

## Phase 5 - Independent oracle and QA

- The QA agent must be new to the RC, read-only, and prohibited from modifying code or DB.
- Build an independent official website-linked entry/source/channel oracle for every dynamically in-scope company. Production adapters may not self-certify. Do not perform any company-level official-entry, source, channel, or completeness review for `company-humanwell` or `company-north-china-pharma`; independently verify only the global policy mechanics and final disclosure, without using either excluded company as a source-completeness subject.
- For official totals, archive the raw official evidence. Without totals, independently traverse all pages/channels reachable from each official website-linked entry and archive first/middle/last pages, fingerprints, and job-ID sets.
- Manually verify every historical incident source, low-count source, no-total source, and new/changed adapter; stratified-sample at least 20% of the remainder using a fixed seed derived from the RC ID.
- The QA report records reviewer/agent ID, RC ID, commit SHA, DB snapshot hash, both batch IDs, source-plan hash, oracle version, and raw evidence paths.
- Any confirmed finding starts: independent QA finding -> one hypothesis -> TDD repair -> new RC -> two new full crawls -> new independent QA. Never overwrite old QA.

## Phase 6 - Complete remaining P0 data capabilities

- Implement an AI-first classification queue and translation cache. Keyword/Python rules may enforce hard constraints or fallback behavior but are not the primary classifier.
- Persist primary/secondary category, confidence, rationale, model version, hard-rule hits, official title, and Chinese auxiliary title.
- Route low-confidence roles to `OTHER` plus an admin review queue.
- Human corrections take precedence over model output, drive frontend/search behavior, and survive subsequent ingestion.
- Implement manual crawl request consumption with `QUEUED -> RUNNING -> SUCCESS/FAILED`, ownership/locking, and audit logs.
- Verify mandatory city, category, keyword, company aggregation, and official outbound links against the rebuilt real database.

## Phase 7 - Production release closure

- Prove repeatable migration, seed, and admin bootstrap from an empty database.
- Use one scheduling owner for the two Beijing-time daily windows and a distributed lock preventing overlapping batches.
- Deliver and test a real alert notifier.
- Perform a real backup and restore-to-test drill with integrity checks.
- Configure and test deployment-level TLS where applicable, WAF/CDN or equivalent edge controls, trusted-proxy-only origin access, and shared rate limiting; an in-memory map is not sufficient production protection. Only checks specific to `job.orz.md`—its DNS, its certificate, and its external accessibility—are outside this Goal and gate; equivalent checks for any other deployed endpoint remain required.
- Complete privacy policy coverage for data categories, purposes, access control, retention, deletion/export contact workflow, and leave cross-border legal review as a blocker until signed off.

## Final release gate

The exact phrase `PRD Phase 1 complete` is prohibited unless all are fresh and linked in one reproducible RC:

- Clean/reproducible RC with code and evidence bound to a commit.
- Exact 30+30 roster, no unauthorized replacements.
- Two complete official-link batches from the same RC.
- Independent official website-linked source/channel oracle for every dynamically in-scope company; blocked official-link entry count zero within that derived denominator. The two authorized exclusions receive no company-level official-entry/source/completeness QA; only global exclusion-policy mechanics and final disclosure are verified.
- Data-quality, readiness, and launch-readiness all pass from the RC database.
- Classification, translation, durable human correction, and manual crawl request loops pass against real data.
- Fresh DB migration/seed succeeds.
- Backup restore, monitor alert, scheduler lock, and deployment-level security/edge/origin protection tests pass; only `job.orz.md`-specific DNS, certificate, and external-access checks are excluded.
- Fresh full test suite, typecheck, build, and Prisma validation pass.
- New independent QA has no P0/P1 findings.
- Final 60-company table contains company, official website, official website-linked recruitment entry inventory, campus status, included source/channels, official count or page-traversal proof, crawled count, job-set hash, evidence URL/path, both batch IDs, no-public-link status where applicable, authorized-exclusion status where applicable, and QA status. For the two authorized exclusions, company-level official-entry/source/completeness and QA fields are explicitly not applicable, no company-level review is performed, and no complete-job claim is made.
- Final release notes explicitly disclose that 人福医药 (`company-humanwell`) and 华北制药 (`company-north-china-pharma`) are user-authorized Phase 1 exclusions, that no job-completeness claim is made for either company, and that `job.orz.md` accessibility is not a Phase 1 deliverable.

## RC008 evidence preservation after the 2026-07-13 scope authorization

- RC008's already-passed code, image, database, empty-database, backup/restore, edge/security, and independent-QA artifacts remain immutable historical, reusable evidence for unchanged gates.
- This controlling-plan update by itself does not create a new RC and does not require rerunning an unchanged passed gate.
- Any implementation change required to encode dynamic exclusions, and both formal crawl batches, must bind their code, manifest, database lineage, source-plan/config hashes, and independent QA to their exact immutable RC. Historical RC008 evidence may support unchanged gates but may not self-certify changed code or new formal crawl results.

## Current baseline and immediate next action

- Phases 0-3 are complete. Phase 4 is the sole `IN_PROGRESS` phase; Phases 5-8 remain pending.
- RC008 preserves reviewed, exact-image, database, empty-database, backup/restore, security/edge, full-engineering, and independent-QA evidence for unchanged gates. It is not by itself final evidence for later changed code or formal crawls.
- The immutable roster remains exactly 30 foreign plus 30 domestic companies. The 2026-07-13 policy requires 人福医药 and 华北制药 to remain roster members as exact `USER_AUTHORIZED_PHASE1_EXCLUSION` records outside Phase 1 completeness/source-QA/release-blocking scope; RC008 predates this policy, so its dynamic implementation is not yet proven.
- Immediate action: encode and verify dynamic exclusion behavior under TDD if the current implementation does not already enforce it, then continue the remaining-company formal crawls and exact-RC-bound final QA. Do not research the two excluded companies and do not perform `job.orz.md` DNS, certificate, or external-access work.
