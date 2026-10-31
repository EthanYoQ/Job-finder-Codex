# Scheduled failure retry correction

Removed the portable-only retry timestamp that deferred every unsuccessful capture until the next Beijing 00:01/12:01 window. A failed capture without an accepted same-window success can now be retried in a new batch by the next refresh. An accepted same-window success remains deduplicated even after later failures. Existing UNKNOWN checks and fenced recovery are unchanged; no batch is replayed and no historical state is modified.

Changed consumers: `portableScheduleObservations.ts`, `crawlStateRepository.ts`, and `schedule.ts`. No new queue, timer, source configuration, database constraint or server operation was added.

Validation:

- Ten targeted Node tests passed, covering four real source plans (CSPC, Merck, Novo and Organon) with synthetic NOT_ATTEMPTED failures, same-window success deduplication, retry after a previous-window success, UNKNOWN preservation, Beijing schedule boundaries and existing recovery behavior.
- Focused TypeScript check: zero changed-file errors; 33 pre-existing transitive errors remain.
- `git diff --check` passed with the repository's CRLF files accounted for.
- Read-only inspection of the authorized private export confirms CR Pharma's 2026-10-31 04:21:04.631Z and CSL's 04:24:40.795Z scheduled observations bind to COMMITTED + VERIFIED results, with all four success flags true. Their same-window skips are valid. These imported captures do not count as new-candidate captures or stable-day evidence.

No real record or certificate was copied into project fixtures. The private inspection report contains only source IDs, success timestamps and state classifications. Deployment and real retry acceptance remain the deployment thread's responsibility.
