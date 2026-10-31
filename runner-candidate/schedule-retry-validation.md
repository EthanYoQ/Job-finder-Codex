# Scheduled failure retry correction

Removed the portable-only retry timestamp that deferred every unsuccessful capture until the next Beijing 00:01/12:01 window. A failed capture without an accepted same-window success can now be retried in a new batch by the next refresh. An accepted same-window success remains deduplicated even after later failures. Existing UNKNOWN checks and fenced recovery are unchanged; no batch is replayed and no historical state is modified.

Changed consumers: `portableScheduleObservations.ts`, `crawlStateRepository.ts`, and `schedule.ts`. No new queue, timer, source configuration, database constraint or server operation was added.

Validation:

- Ten targeted Node tests passed, covering four real source plans (CSPC, Merck, Novo and Organon) with synthetic NOT_ATTEMPTED failures, same-window success deduplication, retry after a previous-window success, UNKNOWN preservation, Beijing schedule boundaries and existing recovery behavior.
- Focused TypeScript check: zero changed-file errors; 33 pre-existing transitive errors remain.
- `git diff --check` passed with the repository's CRLF files accounted for.
- Read-only inspection of the authorized private export confirms CR Pharma's 2026-10-31 04:21:04.631Z and CSL's 04:24:40.795Z scheduled observations bind to COMMITTED + VERIFIED results, with all four success flags true. Their same-window skips are valid. These imported captures do not count as new-candidate captures or stable-day evidence.

No real record or certificate was copied into project fixtures. The private inspection report contains only source IDs, success timestamps and state classifications. Deployment and real retry acceptance remain the deployment thread's responsibility.

## TRUE_A / TRUE_B observation correction

The non-portable reader also used `CrawlObservation.successful` alone. That flag can be true after a successful adapter run whose committed evidence still needs completeness review, as observed for Pfizer after independent validation failed. `crawlRuntimeRepository.ts` now reads the existing bound `sourceResult` relation and treats an observation as scheduling success only when its original success flag is true and the result is both VERIFIED and COMMITTED. Unverified, unbound and uncommitted observations remain unsuccessful scheduling history. No stored observation or result is changed, and the separate UNKNOWN write guard remains in place.

Eight targeted tests passed: two new legacy-reader cases plus the six portable retry/UNKNOWN cases. They cover Pfizer-shaped committed but unverified evidence, missing bindings, pending and rolled-back writes, actual same-slot success, cross-slot retry and unchanged input records. Focused TypeScript checking found zero changed-file errors and the same 33 existing transitive diagnostics. CR/CSL retain the portable reader and their previously verified same-slot successes still deduplicate. No live fetch or server action was performed for this correction.
