# Low-I/O candidate source delta

Six TypeScript source/test files and their exact patch, frozen 2026-10-06 09:04 UTC. Base source identity: `b60390477578be18d0f4319eb2a3db888c4fcb17`.

Restore the filtered base from [safe source commit 6f82160](https://github.com/EthanYoQ/Job-finder-Codex/tree/6f82160f209ac4556da8578a85de7da9ffc3ff41), then overlay the six `src/` and `tests/` files at their original paths. The patch is an alternative representation of the same changes; do not apply it again after the overlay. This delta does not establish a new original project Git or runtime identity.

Dependencies: Node.js >=22 and the base package.json/package-lock.json, TypeScript, Vitest, and `tests/helpers/portablePublicSnapshotFixture.ts` from that exact safe base. No packages were added. The filtered base's documented omissions still apply; this delta alone is not a standalone application.

`reuseIdenticalMvccSnapshot` is false by default. This is an offline, undeployed candidate. No complete CI or multi-backend PostgreSQL validation is asserted by this archive.

File byte counts, Git blob identifiers and SHA-256 hashes are in SOURCE_BACKUP.json and SHA256SUMS. Runtime data, measurements, database records, credentials, environment files, generated output and review reports are excluded.
