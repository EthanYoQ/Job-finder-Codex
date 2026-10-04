# Sanofi native-authority header candidate backup

Source checkpoint: `4c67b32fb6eed18c45d172bad5d44cb19a6b0c6a`, with parent `4acb35abfe104e38caf9cc75204b73fead6ab6ef`. At the 2026-10-04 18:15 UTC report this was a frozen candidate, not registered, freshly qualified or deployed.

This safe snapshot retains 862 original source/test/config files plus this guide and `SOURCE_BACKUP.json`. Seventeen source/test files differ from the prior backup; the eighteenth changed file was an internal recovery note and is excluded. Included bytes, source paths, file modes, Git blobs and SHA-256 values are recorded.

## Technical scope

Only the main Chinese collector has the narrow foreign-header fallback. Its own list/schema/requisition and verbatim metadata apply URL must agree, while the displaced header/body/apply block must be internally coherent. The independent collector remains strict. Both paths bind each job's exact identity, full description hash, native identity and mainland location; fallback native requests prohibit redirects.

The B evidence binds the independent artifact hash into a derived anomaly record, without changing network originals. Issuance and reading validate this identity set and compare exact persisted artifact hashes/tuples. The Sanofi-specific reader/preflight selects seven metadata fields: releaseCandidateId, batchId, sourceResultId, sourceId, kind, extractorLocator and sha256. Actual responses, database rows or control packets are not included here.

## Verification and recovery

Reported checks passed 206 tests in nine targeted suites, changed-path TypeScript validation and the Vite build. Private original replay/adversarial review passed, but those inputs are excluded. A broader initial typecheck found 13 unrelated existing test errors; no whole-repository typecheck, full test suite, database integration, fresh HTTP request or live qualification is claimed.

47 tracked non-source/evidence files are excluded, including retained job bodies, actual database/SQL/control material and internal operational/recovery notes. Credentials, environment/private profiles, generated dependencies/builds, runtime state, uncommitted files and local Git history are excluded. The optional original replay code is preserved, but its `SANOFI_HEADER_CAPTURE_ROOT` inputs must be restored separately with authorization. Other retained-evidence tests have the same boundary.

Before future qualification, publisher and web reader must share this evidence contract. Preflight needs the exact persisted metadata tuple/locator checks. Generic readiness and fixed-cohort inputs that do not supply these commitments fail closed; this candidate does not expand those generic input structures.

Workflow source remains under `backup/disabled-workflows/`, with no active workflow. This branch does not run CI, merge or deploy. Its safe backup commit is a separate identity and is not a formal production candidate number; any runtime requires independent build identity and registration.

