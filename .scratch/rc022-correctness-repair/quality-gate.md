# RC022 Correctness Repair Quality Gate

Gate level: **Standard** — the task changes release-sensitive search and source-qualification behavior, then publishes a candidate to an external private cloud repository; all actions are reversible, but unsupported completion claims could contaminate release evidence.

Decision: **HOLD** until every hard gate has current evidence.

| Gate | Severity | Threshold | Method and evidence | Status |
| --- | --- | --- | --- | --- |
| Product correctness | Hard | Unsupported/broad city searches are rejected; APAC-only Pfizer evidence cannot qualify; explicit mainland-city evidence still works without accepting foreign conflicts | Red-to-green public-seam regression tests plus full suite | PASS — supported-city/API tests and five Pfizer replay cases pass |
| Requirement consistency | Hard | All active first-launch/Phase 1 thresholds are 55; no third-round or post-launch semantics drift | Canonical PRD audit plus diff review | PASS — active PRD threshold references are 55 and scope remains qualification-neutral |
| Local verification | Hard | Typecheck, full test suite, production build, Prisma validation/generation path, and Git whitespace check all pass | Recorded local commands and outputs | PASS — Prisma generate/validate, typecheck, 174 files / 2,973 passed / 3 skipped, build, and diff check |
| Review closure | Hard | Final Standards and Spec reviews contain no unresolved P0/P1 correctness finding in the repair diff | Independent two-axis code review | CORE PASS / CLOUD REMEDIATION PENDING — the core repair tree passed both reviews; the hosted-runner remediation must be re-frozen and re-reviewed after the portable test-harness correction |
| Private-source safety | Hard | Pushed tree contains no credential, database dump, local CodeGraph database, or disallowed runtime evidence; repository visibility is private | Staged-tree scan, ignore verification, GitHub metadata | LOCAL PASS / REMOTE PENDING — staged tree must be rescanned after final freeze |
| Cloud acceptance | Hard | Private-repository workflow succeeds for the exact candidate commit | GitHub Actions run metadata and job logs | PENDING — diagnostic runs `30183305170` and `30183824506` exposed a too-narrow job container and then a Linux-only synthetic Git mode assumption; the production provenance guard remains unchanged while the test fixture is corrected |
| Dependency advisory | Advisory | Existing locked dependency risk is identified without unreviewed lockfile mutation | `npm audit` evidence | ACKNOWLEDGED — one existing indirect high-severity `postcss` advisory; no dependency diff |

## Failure action

- Any hard-gate failure keeps the decision at `HOLD`; repair and rerun the affected evidence.
- The dependency advisory is disclosed and does not by itself claim production security readiness. It blocks only if it prevents the build or directly affects the changed runtime path.
- Thresholds must not be lowered to obtain a pass.
