# P0 Recovery and Release Evidence Plan

> **Controlling plan:** This plan supersedes every 2026-07-09 and 2026-07-10 data-completion, source-patching, fresh-crawl, and release-readiness plan. Superseded plans remain immutable historical evidence and are not completion evidence.
>
> **Controlling PRD scope:** Exactly 30 foreign pharmaceutical companies plus exactly 30 domestic pharmaceutical companies. A target company may not be replaced merely because its public recruitment surface is difficult to crawl. Job completeness is judged only inside recruitment entries that are publicly linked or explicitly endorsed by the company's official website at capture time.
>
> **Blocked-company rule:** A target without a public official-website-linked social recruitment entry remains in the roster with `NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME`; it is never replaced to make readiness green, and that no-link status is not by itself a crawl-completeness blocker. A target with a public official-website-linked social recruitment entry that cannot be completely crawled remains blocked until that entry passes the evidence gate.
>
> **Trust state:** `TRUST_FREEZE` / data confidence D. No job-count, readiness, launch, or manual-review claim is valid until a release candidate (RC) satisfies every gate in this plan.

**Goal:** Produce a clean, reproducible P0 release candidate whose code, database, two full official-link crawl batches, independent official-link oracle, QA report, and production-operability evidence all bind to one immutable manifest.

**Active Goal:** `019f4b10-36e1-75e0-8586-1e4beec344ee`

**Resumed from Goal:** `019f4295-1a92-7202-8e38-1bdd8cec8351`

**Goal objective:** 完成 Job-search PRD 一期的端到端生产上线：严格覆盖用户确认的 30 家外资医药企业和 30 家国内制药企业，建立可独立证明公司官网招聘链接内社招职位完整性的官方招聘 source/channel 数据链路；实现准确职位抓取、AI 岗位分类、英文标题中文辅助翻译、生命周期、搜索聚合、后台运营、安全反爬、隐私、部署、备份、监控和每日两次调度；通过同一可复现 RC 下的全量验证与独立 QA，并以 job.orz.md 可安全稳定访问为最终交付。不得用替换企业、硬编码总数、放松门禁、历史绿灯或生产 adapter 自证来完成目标。该完整性判断不要求证明公司不存在其它未由官网公开链接或明确背书的社招渠道。

**Goal judgment standard update (2026-07-12):** For each target company, completion evidence covers the social-recruitment jobs visible from official website-linked recruitment entries only. The denominator is the audited inventory of official website links, redirects, ATS tenants, pages, APIs, filters, and channels reachable from those entries at capture time. The release claim must not imply coverage of hidden ATS tenants, WeChat-only postings, third-party boards, regional legal-entity channels, or other recruitment paths that are not publicly linked or explicitly endorsed by the official company website.

**Recovery point:** `outputs/p0-rc/p0-rc-20260710-001/`

**Execution method:** Use systematic debugging for every anomaly, TDD for every behavior change, fail-closed evidence gates, and an independent read-only QA agent after each major recovery stage. Evidence gaps are reported as facts, hypotheses, validation paths, and temporary containment only.

## Goal execution index

This index is the controlling execution order. Detailed requirements later in this document are assigned to these phases even where older section headings retain historical numbering.

| Phase | Scope | Status | Exit evidence |
| --- | --- | --- | --- |
| 0 | Goal/RC baseline and reproducible environment | BLOCKED_PHASE0_BACKUP_TOOLCHAIN | Git/runtime hashes, pre-mutation backup, successful restore-to-test, DB snapshot, manifest authorization |
| 1 | Batch, evidence, transaction, pagination, official-chain, and readiness gates | PENDING | RED-GREEN tests, migrations, full engineering checks, independent read-only review |
| 2 | Strict 30+30 roster and official-link source/channel model | PENDING | Human-readable roster, machine official-link oracle seed, official-chain archive, no unauthorized replacements |
| 3 | PRD lifecycle and grace-set data-quality invariants | PENDING | 1/2/3 miss, failure/incomplete, reappearance, transaction, and set-reconciliation tests |
| 4 | AI classification, translation, durable human corrections, and manual crawl worker | PENDING | Real queue/worker/DB evidence and regression tests |
| 5 | Two formal complete official-link rebuild batches in one RC | PENDING | Two immutable completed batches and fresh zero-blocker DB gates |
| 6 | Real-DB product and admin acceptance | PENDING | Product/admin workflows and browser matrix evidence against the RC database |
| 7 | Deployment, security, backup, monitoring, scheduler, and compliance | PENDING | Production-operability tests and compliance sign-off evidence |
| 8 | Independent QA, repair loop, and final release evidence | PENDING | Independent oracle for 60 companies, no P0/P1 findings, final 60-company table |

Only one phase may be `IN_PROGRESS`. A phase cannot advance until its exit evidence exists under the active RC.

## G1-G9 baseline

| Gate | Baseline | Reason |
| --- | --- | --- |
| G1 scope consistency | FAIL | Current registry explicitly permits `国内制药递补`, contains a known 28 foreign + 30 domestic + 2 replacement composition, and includes slash-joined company names. |
| G2 official chain and coverage | FAIL | Latest readable audit reports only 40 strong and 20 incomplete sources; official website-linked recruitment entries are not independently inventoried. |
| G3 provable crawl completeness | FAIL | Batch, provenance, transaction, pagination, loss accounting, and official-total/page-traversal evidence gaps are confirmed for the official website-linked entry scope. |
| G4 two formal rebuilds | BLOCKED | No two completed immutable batches exist under one reproducible RC. |
| G5 classification/translation/lifecycle | FAIL | AI-first queue/translation are absent and current one-miss lifecycle conflicts with PRD semantics. |
| G6 user product | PARTIAL_NOT_VERIFIED | Some UI exists, but real-RC DB and required browser matrix evidence are absent. |
| G7 admin/operations | FAIL | Manual crawl worker and complete review/alert workflows are not proven end-to-end. |
| G8 production/security/compliance | BLOCKED_NOT_VERIFIED | Fresh deploy, restore drill, notifier, scheduler lock, edge controls, and legal judgment are absent. |
| G9 engineering/independent QA | BLOCKED | No final-RC fresh command bundle or independent 60-company official-link oracle exists. |

Goal completion is prohibited while any row is not `PASS` with fresh RC-bound evidence.

---

## Global invariants

1. No historical green report, mixed-batch observation, adapter `SUCCESS`, or count-only equality proves completeness.
2. Tavily, Agent Reach, search engines, ATS tenant discovery, and third-party job boards are discovery inputs only. Readiness evidence must be archived from the official company chain or the official recruitment system it endorses.
3. Every artifact lives under `outputs/p0-rc/<rcId>/` and references the RC manifest.
4. Any code, roster, source-plan, database, or oracle change invalidates the current RC and starts a new RC.
5. Any blocked official-website-linked social recruitment entry blocks RC completion while preserving evidence for companies that passed. A company with no public official-website-linked social recruitment entry is retained in the 60-company roster with an explicit no-link status and does not create a crawl-completeness blocker.
6. No failed, incomplete, blocked, skipped, stale, or non-atomic crawl may drive lifecycle removal.
7. No PRD business rule may be weakened to make a technical gate pass.

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

- Readiness accepts only all observations for the audited official website-linked social-recruitment denominator from the same completed full batch, RC, commit, source-plan hash, and source-config hash, together with exact company-level audit/no-link adjudication for all 60 roster companies.
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

- Produce a human-readable 60-company roster and machine-readable official-link source/channel oracle seed.
- Request code review and an independent read-only roster/source-chain QA.

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

1. Run two complete full official-link crawl batches.
2. Each batch requires the planned denominator to equal the audited official website-linked social recruitment entry set for the 60-company roster, skipped 0, and 100% transport, adapter success, completeness, and atomic commit for that denominator.
3. Archive every official website-linked source's expected evidence, pagination proof, counters, collision/discard ledger, canonical job-key set/hash, active set/hash, and official-chain evidence.
4. Both batches must complete; data-quality must report zero blockers; readiness must consume only those batches.
5. Any blocked official website-linked social recruitment entry blocks the RC. Preserve passing evidence and investigate through systematic debugging; do not replace the company, hard-code a total, relax a gate, or change lifecycle semantics. A no-public-official-link company status remains auditable roster evidence, not a crawl-completeness blocker.

## Phase 5 - Independent oracle and QA

- The QA agent must be new to the RC, read-only, and prohibited from modifying code or DB.
- Build an independent official website-linked entry/source/channel oracle for all 60 companies. Production adapters may not self-certify.
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
- Configure and test `job.orz.md`, TLS, WAF/CDN, trusted-proxy-only origin access, and shared rate limiting; an in-memory map is not sufficient production protection.
- Complete privacy policy coverage for data categories, purposes, access control, retention, deletion/export contact workflow, and leave cross-border legal review as a blocker until signed off.

## Final release gate

The exact phrase `PRD Phase 1 complete` is prohibited unless all are fresh and linked in one reproducible RC:

- Clean/reproducible RC with code and evidence bound to a commit.
- Exact 30+30 roster, no unauthorized replacements.
- Two complete official-link batches from the same RC.
- Independent official website-linked source/channel oracle for all 60 companies; blocked official-link entry count zero.
- Data-quality, readiness, and launch-readiness all pass from the RC database.
- Classification, translation, durable human correction, and manual crawl request loops pass against real data.
- Fresh DB migration/seed succeeds.
- Backup restore, monitor alert, scheduler lock, TLS/WAF/origin protection tests pass.
- Fresh full test suite, typecheck, build, and Prisma validation pass.
- New independent QA has no P0/P1 findings.
- Final 60-company table contains company, official website, official website-linked recruitment entry inventory, campus status, included source/channels, official count or page-traversal proof, crawled count, job-set hash, evidence URL/path, both batch IDs, no-public-link status where applicable, and QA status.

## Current baseline and immediate next action

- Imported independent-audit fact: trust level D; latest readable audit reported 40 `VERIFIED_STRONG` and 20 `INCOMPLETE`.
- Imported independent-audit fact: historical 60/60/zero-issue reports conflict with the latest audit and are invalid as release evidence.
- Imported independent-audit fact: the inherited workspace is heavily dirty and prior reports are not bound to a reproducible commit/database snapshot.
- Imported independent-audit fact: offline code checks passed previously, while DB-backed launch readiness did not; these results are historical only.
- Unverified today: Docker/PostgreSQL health, precise current dirty-file counts, whether the interrupted batch committed any partial state, and whether an existing database backup is restorable.
- Immediate action: finish Phase 0 probes and backup/restore before any migration, crawl, lifecycle mutation, or readiness run.
