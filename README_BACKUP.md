# Prepared portable42 capture observation host, revision 2

This source-only backup contains a separate observation starter, shell-command builder, exact source patch, synthetic fixtures/tests and an independent process-tree sampler. At the 2026-10-05 11:28 UTC handoff it was prepared for future naturally due collection, with no real Jb peak measurement established. The original starter, producer42, dependencies and registered runtime identities are unchanged.

The observed starter SHA256 is `0bf4d5fb3fb599ee441e587bb6de6c61c353fe76650d0185a2b952774119b3be`; sampler SHA256 is `18bc3c99319b3af0941b6499bf71b5bfcd7d5808003a6b2c8e8a1a20eae88a85`. The original starter is identified by `49e2f7cd1eca99833b8eb4ffca529307ddbc4bb88d2fef429903f544e1f13ba3`. These external files have no original Git commit. SOURCE_BACKUP.json records exact file bytes, modes and hashes.

## Changes and verification

The starter adds an early batch string check, verifies one fixed sampler path and SHA256, wraps the original capture command in the same exec/PID namespace for observation, and repeats the original 60-second bootstrap freshness check before launch. The capture command itself remains byte-for-byte unchanged. The wrapper records observer and target exits separately and returns the original target exit code; an observer failure must not kill the target or hide its outcome.

Backup review identified that the first revision tried to read the external sampler through a host-restricted file helper. Revision 2 instead checks the fixed path with sha256sum while preserving the original host scope. The first revision was never uploaded. The author reports tests of the actual extracted starter prelaunch block: fixed-path hash check, host-restricted reader never called, wrong hash rejected, stale bootstrap rejected and original capture command unchanged.

The author also reports three real shell tests using synthetic processes: target exit 7 stays 7, exit 0 stays 0, and sampler failure 2 does not kill or mask a successful target. JavaScript/shell syntax and an additional synthetic sampler scheduling check passed. These are bounded synthetic checks, not full CI or a real collection/memory measurement. The backup only inspected source, exact hashes and patch correspondence; it did not execute tests, source, database operations or process sampling.

## Observation limits

The sampler verifies an exact root argv token and follows that PID plus observed descendants, retaining known live orphans. It sends no target signals, changes no target limits and performs no network activity. It writes observation output to a separate directory; command-line contents are checked but not saved.

RSS is sampled every second and PSS every five seconds in this wrapper. Observed peaks are lower bounds: short spikes/processes may be missed, process reads are sequential, and nothing before the first sample is covered. RSS totals may double-count shared pages. Per-process lifetime VmHWM must not be summed. Independent browsers/services outside the tree are not attributed, and visible shared-environment meminfo is not Jb memory usage.

## Recovery and archive boundaries

Seven source/test/patch files are included with this README, SOURCE_BACKUP.json and a newly generated allowlist SHA256SUMS. The sampler is stored under memory-observation; the starter and tests still expect its original fixed absolute path and hash. Restore that reviewed placement, or perform separately reviewed adaptation and revalidation. Existing producer, host/session helpers and authorized configuration are separate prerequisites; this is not a complete registered runtime environment.

Actual runs, memory samples/process snapshots, SQL/control/DB/public JSON, raw evidence, environment, credentials, runtime identity, SELFTEST outputs and internal reports are excluded. Checksum coverage is limited to the uploaded files other than SHA256SUMS itself.

There are no active workflows in this tree. Archiving it does not authorize a collection or live sampling run, and performs no CI, merge, default-branch update or deployment.
