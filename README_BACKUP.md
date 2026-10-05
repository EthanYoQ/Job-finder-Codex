# Offline Sanofi paired publisher candidate

Original source commit: 46beb14fcca2dd05854f45781abbc1b43da90ea1. Actual direct parent: 4c67b32fb6eed18c45d172bad5d44cb19a6b0c6a. Status at 2026-10-05 16:58 UTC: offline candidate, unregistered, not freshly captured and undeployed.

Paired Web source: 7e5390495bc41b846d6a4a6d12a7f9061bbb745f, preserved on [the paired Web backup branch](https://github.com/EthanYoQ/Job-finder-Codex/tree/backup/sanofi-paired-web-20261005-1700).

Five runtime files change only the shared context SQL and seven-field propagation through fixed-cohort audit and authoritative launch. The Sanofi verifier, source plan/configuration, Chinese parsing/replay, package and schema are unchanged from the publisher baseline. Two synthetic regression files are added. The safe tree contains 864 source/test/config/asset files plus two backup metadata files; 48 tracked files remain excluded.

The implementation reports 12 suites / 260 focused tests, a 25-root focused TypeScript check and a Vite build passing. The new wiring tests cover pre-capture/next-run compiler use, locked identical query, first/latest baseline and tampered/missing metadata, including no extra Sanofi read for Bayer/CTTQ. This is not complete formal qualification or real Schema48 publication success.

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

