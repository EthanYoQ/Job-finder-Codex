# RC022 Review — Autonomous Grill Decisions

The user explicitly directed the workflow to adopt recommended decisions without returning choices for human adjudication. Each branch below records the recommended answer, evidence, and adopted decision.

## 1. Should `全部地点` remain a job-discovery mode?

**Recommended answer:** No.

**Evidence:** The product goal defines the homepage as a city-required discovery workspace. The reviewed server behavior turns `全部地点` into no city predicate and demonstrably returns an India/APAC-only job.

**Decision:** Remove the interface option, reject the legacy sentinel at request validation, and always apply a city predicate for accepted searches. Preserve nationwide and China-wide fallbacks inside a concrete-city search.

## 2. Can `APAC - Any Pfizer Site` establish China scope?

**Recommended answer:** No.

**Evidence:** APAC includes multiple countries and the reviewed fixture's primary location is India. Treating the regional descriptor as China creates a job with no concrete mainland location and contributes it to source completeness.

**Decision:** Require at least one explicit mainland China descriptor. APAC text may accompany an explicit mainland location but cannot replace it.

## 3. Which first-launch threshold is canonical?

**Recommended answer:** 55 Stable Companies.

**Evidence:** The product goal, core solution, record-derived policy, runtime policy, and two-round release contract use 55. Four later PRD statements are stale remnants of the earlier 45-company threshold.

**Decision:** Normalize all active Phase 1 and first-launch language to 55 without changing post-launch per-company publication.

## 4. Should the three structure-only review smells be implemented in this RC repair?

**Recommended answer:** No.

**Evidence:** They are judgement calls with no reproduced product failure. The proposed refactors have broad blast radius across source adapters and evidence verification.

**Decision:** Preserve them as separate ready-for-agent enhancement briefs. Exclude them from the correctness spec and cloud acceptance candidate.

## 5. Which test seams govern implementation?

**Recommended answer:** Use the highest existing public seams.

**Decision:**

- Search request parsing plus database-backed search for the city-required contract
- The discovery interface for absence of the all-locations option
- `runSourceCrawl` with the exact Pfizer source-bound replay fixture for China-scope completeness
- Product-requirement text verification for one 55-company contract
- Git's baseline-to-candidate whitespace check for clean-diff acceptance

These seams are approved autonomously under the user's decision rule.
