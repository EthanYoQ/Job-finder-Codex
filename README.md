# A-grade delta reader observation fix

This frozen source delta contains five files and one exact patch for each of the main and compatible fallback roles. Both roles have identical changed bytes. Their source baselines are main 964be0f8385e1b5bf2028ab445c1cf0bf7e850a5 and fallback 3c29c0798de063d141b866c05e5f78f99b922e35. The source copies had no new Git commits at the 2026-10-07T10:51:31Z freeze; this backup commit is not a runtime or deployment identity.

The reader keeps the A certificate's independent observation time for source freshness. Delta job sightings instead bind to the original crawl observation. The current and GRACE-history paths retain exact source/result/batch/release/config/adapter and output-hash checks, successful-state flags, one observation, exact start/end bounds, and crawl time inside that interval. Legacy A rows without a delta wrapper and non-A paths retain their prior behavior. No stored timestamp is rewritten by this change.

## Recovery

Restore each complete matching role baseline with its package/lockfile, fixtures, generated client and physical runtime dependencies, then apply that role's five paths or patch. The existing [incremental source backup](https://github.com/EthanYoQ/Job-finder-Codex/commit/a47ed7feeb93e99d45633795cb5fecebc8c0818f) supplies the matching reader delta baseline; its parent role snapshots are recorded in SOURCE_BACKUP.json. Retain the baseline's documented exclusions and migration layout. This incremental package cannot independently recreate the original Git graph or a complete runtime.

The added tests use synthetic dates, records and injected HTTP responses. Actual database snapshots, replay inputs/results, production identities, logs, credentials and validation reports are excluded, including the original mixed-result MANIFEST.json. Its hash is retained only as provenance. The backup verified all original hashes and exact patch contexts against the prior safe baselines without running application code, tests, builds, migrations or deployment. Source preservation does not establish production rollout success.
