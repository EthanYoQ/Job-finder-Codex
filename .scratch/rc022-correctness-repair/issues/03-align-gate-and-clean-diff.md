# 03 — Align the 55-company gate and restore clean diff

**What to build:** Make the canonical product requirements use one 55-company First-launch Gate everywhere and remove the reviewed mechanical whitespace failure without changing runtime behavior.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Every active first-launch, internal-preview, formal Phase 1, and matching testing statement uses 55
- [x] Post-launch Routine Publication remains per company
- [x] The two-round limit, no-substitution rule, and fixed roster remain unchanged
- [x] The baseline-to-candidate Git whitespace check passes
- [x] No unrelated formatting churn is introduced

## Answer

- Updated the four active 45-company First-launch Gate statements in the canonical PRD to 55, covering internal preview, external launch, formal Phase 1 completion, and the publishing-state test.
- Preserved the fixed 60-company roster, no-substitution rule, two-round/no-third-round limit, and post-launch per-company publication semantics.
- Removed only the reviewed trailing whitespace in `src/crawler/msdDualOfficialSourceFetch.ts`.
- Verified with a threshold-context audit (no obsolete 45-company gate matches), `git diff --check`, `git diff --check aef05422bc2cba9282eb21ab2cf182a320fc5aea`, and `npm run typecheck`.
