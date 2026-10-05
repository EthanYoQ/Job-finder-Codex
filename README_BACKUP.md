# Offline combined web candidate: verified cache and request timing

This safe source snapshot preserves candidate `e4cdcc66ac8ea67971d346dc178016e12f3d57bd`. Its actual Git parent is `a775d114668c466562660105ee52dc2306b6fdeb`; it integrates the independently prepared nonblocking behavior from `3e41e8975027e8bd7a5cff6fd8859f59ef6843eb`, whose common ancestor with a775 is `065892ee7951f1c6b1cc2c7ef2d4f3b3dbe26003`. This is not a two-parent Git merge or a production runtime identity.

At the 2026-10-05 01:24 UTC handoff, the candidate was offline, unregistered and undeployed. The reported production web was still a775 on port 3036. Collector candidates are not incorporated here. The GitHub backup is a new sanitized commit, separate from the original candidate identity.

## Included behavior

The candidate combines the existing immediate response from a verified cache with per-request numeric Server-Timing. The original HTTP response preserves its selected snapshot, version and original timestamps. Background verification begins after the fixed response group finishes; a changed version still requires complete existing validation and atomic replacement. Old displayed data is never relabeled as newly verified data.

Cold/no-cache reads, startup and projections above the 16 MiB cache limit retain strict validation. Timing belongs to the initiating request; shared readers measure their own wait and clone. Background checks and rebuilds do not mutate timing callbacks of completed or unrelated responses. Server-Timing stages may nest and must not be summed as total latency.

Process-local HMAC code supplies bounded correlation for subsequent reads. It is not access authorization or a persistent credential. Only the source code is archived, with no generated key, runtime check token or actual response. Correlation remains tied to the same process: invalid, expired or cross-process checks fail without opening another query. The client retains a five-second interval, five-attempt limit and 30-second budget; the check lifetime is 60 seconds, not a cache lifetime.

## Validation and limits

The implementation report records 251 passing tests across 16 individually completed suites, focused TypeScript passing and a real Vite build passing in 1.87 seconds with 1,608 modules. Tests ran in groups; this is not one combined run, full repository tests, full TypeScript or a green GitHub CI claim. An independent static review found no combination blocker. Existing full-repository test type diagnostics were outside scope.

No real database, collection, production deployment, public traffic, cold browser, mobile visual or public five-second acceptance was performed. Later release verification must follow the same check through bounded CURRENT after a real publication and assess initial cold access. A fast cached response does not guarantee that a just-published batch is visible in its first response within five seconds.

## Backup and recovery

The tree retains 968 exact source, test, configuration and asset files, including existing fonts, logos and licenses, plus this README and SOURCE_BACKUP.json. Sixteen source/test paths differ from the safe a775 backup; nine reuse already verified nonblocking objects. All selected source bytes come from the fixed candidate Git objects, not working-tree files. The manifest lists each path, mode, Git blob SHA, SHA256 and byte count.

The same 34 excluded tracked files remain excluded: private database/context/control fixtures, raw or retained job bodies, private captures, internal reports and operational material. Runtime/environment files, credentials, generated signing material, actual responses, benchmark inputs, build/dependency outputs, uncommitted files and original local Git history are also omitted. Some tests require these separately authorized private fixtures and cannot run from this safe source alone.

Workflow source stays under backup/disabled-workflows; no active workflow is introduced. Creating this independent backup performs no CI, default-branch update, merge or deployment. Any future runtime needs its own build, validation and registration.
