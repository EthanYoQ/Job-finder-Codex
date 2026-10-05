# Offline Sanofi paired Web reader candidate

Original source commit: 7e5390495bc41b846d6a4a6d12a7f9061bbb745f. Actual direct parent: e9ab6552383a5f61e40ffcd33916c40285fcd28f, whose parent is e4cdcc66ac8ea67971d346dc178016e12f3d57bd. The reader change was introduced in e9ab655; the final commit binds the final publisher synthetic contract. Status at 2026-10-05 16:58 UTC: offline, unregistered and undeployed.

Paired publisher source: 46beb14fcca2dd05854f45781abbc1b43da90ea1, preserved on [the paired publisher backup branch](https://github.com/EthanYoQ/Job-finder-Codex/tree/backup/sanofi-paired-publisher-20261005-1700).

Six runtime files integrate the paired Sanofi reader contract while retaining the existing nonblocking verified-cache, bounded follow-up and request timing behavior. Official Chinese list → same-Req native Chinese Tupu identity remains strict, including independently persisted artifact bindings. No frontend design change is included. The safe tree contains 973 source/test/config/asset files plus two backup metadata files; 35 tracked files remain excluded.

The implementation reports 24 suites / 506 focused tests, a 32-root focused TypeScript check and a Vite build passing. Four combination tests use the final publisher's generated synthetic receipt to exercise new data, old88-before-background-switch, metadata drift HOLD and query failure preserving old version/time with FAILED. Existing nonblocking/timing tests are included. The author reports all 171 build files and 163 public files byte-identical to e4cd; generated builds are not uploaded.

## Pairing and recovery boundary

The publisher and Web reader use the same strict Sanofi receipt/identity contract. Persisted artifact metadata is independently read by exact release/batch/result/source/locator binding; inline proof hashes cannot substitute for those records. Only seven metadata fields are projected. Publisher preparation and locked re-read use the same context query, and the Sanofi publication lock group includes EvidenceArtifact.

The existing a775 reader rejects the new Sanofi identity receipt. The protected 3031 reader uses the old config and cannot be assumed to read the new B receipt; shared Job changes may also hold the old A projection, and its controller rejects database-version drift. These old versions are not a compatible rollback for a new Chinese B commit. A separate compatible fallback must be prepared and validated.

The historical A88 exception remains exactly pinned and applies only before a newer committed Chinese writer. New committed B data must meet its strict contract; invalid or expired B and unknown writers produce HOLD rather than republishing old88. The legacy FULL_RELEASE readiness path remains unsupported for new Sanofi B; HTTP reading is separate from the updated publisher formal-audit/launch entry points.

## Verification limits

All passing counts below are grouped final suite results reported by the implementation handoff, not a single full-repository run or GitHub CI. Focused TypeScript and builds passed, while existing whole-repository test type diagnostics remain. The in-memory PostgreSQL check executed only generated context SELECT over synthetic tables. It did not execute Schema48 migrations, a complete publication transaction or production concurrency/locking/permission behavior. Sanofi's synthetic CERTIFICATE_INVALID was removed in the tested formal entry points, but other synthetic sources/timing still made the overall launch NOT_READY.

There was no official new capture, production database access, registration, deployment, target runtime attestation, public five-second acceptance or browser/mobile validation. This backup did not execute source or tests. Any future runtime needs independently validated target source/build/dependencies and registration; its sanitized GitHub identity is different from the original source commit.

## Safe-source scope

Original source, necessary public assets/fonts/logos/licenses and previously approved tests/configuration are kept byte-for-byte from the fixed Git objects. Source workflow files are relocated under backup/disabled-workflows. Private historical database/control fixtures, real captures/full job bodies, operation/proof notes, user authorization text, runtime identities, environments/credentials, actual SQL/request/response payloads, generated dependencies/builds, uncommitted files and original local Git history are excluded. Dependent historical/real-page tests need those separately authorized private fixtures to be restored; their source alone does not make them runnable.

The paired Web backup includes a contract fixture with two invented jobs (R9000001/R9000002), synthetic short HTML descriptions and test-only bindings. It is intentionally included as self-authored test data, not a capture or qualification receipt. Some paired tests also depend on the separately excluded historical DB fixture.

No active workflow, CI, default-branch update, merge or deployment is performed by these independent backup branches.



## Additional offline compatible fallback

A subsequently frozen application fallback, c754d92e98d964655abdca783d9ed1e52b19c3e3 (actual parent a775), is preserved on [the a775-compatible fallback branch](https://github.com/EthanYoQ/Job-finder-Codex/tree/backup/sanofi-a775-fallback-20261005-1707). It has the same six reader contract files as the main Web and retains original a775 foreground-version-check/performance behavior, without e4cd nonblocking changes. The author reports 15 grouped suites / 383 tests, focused TypeScript and build passing. It remains unregistered and undeployed, and does not authorize replacing 3031 or relaxing database-version/schema/build/routing checks. This later cross-reference changes no source file or original cutoff status above.
