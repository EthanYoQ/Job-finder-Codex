# OFFLINE counter assertion alignment

Test-only correction based on registered native130 commit 9fd31f216134a2a9c48f33a058f94e0188e90548. Native128 already enabled preservation of a still-absent OFFLINE job count; the lifecycle suite was updated then, but one projection-receipt assertion still expected 6 -> 7.

Only the existing assertion name and expected value change to preservation at 6. No production code, registration, candidate activation, SQL, dispatch, source holds, schedule, or unknown/denied requests change. The registered source tree remains untouched to preserve its identity. Apply the patch only when preparing a later authorized source candidate.

Original pinned Node v22.23.3 and existing Vitest v3.2.7: two existing suites, baseline 89 passed / 1 stale assertion failed; corrected candidate 90 passed. No dependency installation or network collection. Candidate source files were copied unchanged from the original source tree; the local test-only node_modules symlink is excluded from this backup.

Restore the original native130 source from its existing verified backup, apply change.patch, and run existing tests/db/jobProjectionDeltaReceipt.test.ts and tests/crawler/lifecycle.test.ts. These are offline regression results, not production validation or Roche131 activation.
